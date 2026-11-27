
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const { authenticator } = require('otplib')
const storage = require('./db')
const { memoryStore } = storage
const complaintsRouter = require('./complaints')

const app = express()
const PORT = Number(process.env.PORT || 5000)
const sessions = storage.memorySessions
const passwordResetTokens = storage.memoryResetTokens
const passwordResetRequests = new Map()
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000
const PASSWORD_RESET_RATE_LIMIT_MS = 15 * 60 * 1000
const PASSWORD_RESET_MAX_REQUESTS = 5
const MAX_BACKUP_PASSPHRASE_LENGTH = 1024
const backupRoles = new Set(['CUSTOMER', 'SUPPORT', 'MANAGER', 'ADMINISTRATOR'])
const backupStatuses = new Set(['Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed'])
const backupCategories = new Set(['General', 'Billing', 'Service', 'Product', 'Technical'])
const backupPriorities = new Set(['Low', 'Medium', 'High', 'Urgent'])

const getPepper = () => process.env.PEPPER || 'development-pepper'
const getSessionToken = (req) => req.headers['x-session-token'] || req.headers['X-Session-Token'] || null
const normalizeEmail = (email) => String(email || '').trim().toLowerCase()

function createMailTransport() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    return null
  }

  const port = Number(process.env.SMTP_PORT || 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
  })
}

function allowPasswordResetRequest(ipAddress) {
  const now = Date.now()
  const recentRequests = (passwordResetRequests.get(ipAddress) || [])
    .filter((timestamp) => now - timestamp < PASSWORD_RESET_RATE_LIMIT_MS)

  if (recentRequests.length >= PASSWORD_RESET_MAX_REQUESTS) {
    passwordResetRequests.set(ipAddress, recentRequests)
    return false
  }

  recentRequests.push(now)
  passwordResetRequests.set(ipAddress, recentRequests)
  return true
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || ''
  return address === '::1' || /^127\./.test(address) || /^::ffff:127\./i.test(address)
}

async function clearPasswordResetTokens(userId) {
  await storage.deletePasswordResetTokensForUser(userId)
  for (const [tokenHash, reset] of passwordResetTokens) {
    if (reset.userId === userId) {
      passwordResetTokens.delete(tokenHash)
    }
  }
}

async function createUser({ name, email, password, role }) {
  const normalizedEmail = normalizeEmail(email)
  const normalizedName = String(name || '').trim()
  const totpSecret = authenticator.generateSecret()
  const now = new Date().toISOString()
  const user = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    password_hash: bcrypt.hashSync(`${password}${getPepper()}`, 10),
    totp_secret: totpSecret,
    role,
    is_active: true,
    created_at: now,
    updated_at: now
  }

  const savedUser = await storage.createUser(user)
  return { user: savedUser, totpSecret }
}

function isValidAccountInput(name, email, password) {
  return typeof name === 'string'
    && name.trim().length > 0
    && name.trim().length <= 120
    && typeof email === 'string'
    && email.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && typeof password === 'string'
    && password.length >= 12
}

function accountCreatedResponse(user, totpSecret) {
  return {
    user: sanitizeUser(user),
    totpSecret,
    otpUri: authenticator.keyuri(user.email, 'Customer Complaint System', totpSecret)
  }
}

function sanitizeUser(user) {
  if (!user) return null

  const safeUser = { ...user }
  delete safeUser.password_hash
  delete safeUser.totp_secret
  return safeUser
}

function validateBackupSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.users) || !Array.isArray(snapshot.complaints) || !Array.isArray(snapshot.auditLogs)) {
    return 'Backup data must include users, complaints, and auditLogs arrays.'
  }

  const userIds = new Set()
  const emails = new Set()
  for (const user of snapshot.users) {
    if (!user || typeof user.id !== 'string' || typeof user.name !== 'string'
      || typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
      || typeof user.password_hash !== 'string' || typeof user.totp_secret !== 'string' || !user.totp_secret
      || !backupRoles.has(user.role)
      || typeof user.is_active !== 'boolean' || !Number.isFinite(Date.parse(user.created_at))
      || !Number.isFinite(Date.parse(user.updated_at))) {
      return 'Backup contains an invalid user record.'
    }
    const normalizedEmail = user.email.trim().toLowerCase()
    if (userIds.has(user.id) || emails.has(normalizedEmail)) return 'Backup contains duplicate users.'
    userIds.add(user.id)
    emails.add(normalizedEmail)
  }

  const complaintIds = new Set()
  for (const complaint of snapshot.complaints) {
    if (!complaint || typeof complaint.id !== 'string' || typeof complaint.customer_name !== 'string'
      || typeof complaint.customer_email !== 'string' || typeof complaint.subject !== 'string'
      || typeof complaint.description !== 'string' || typeof complaint.category !== 'string'
      || !backupCategories.has(complaint.category) || !backupPriorities.has(complaint.priority)
      || !backupStatuses.has(complaint.status)
      || (complaint.assigned_staff !== null && complaint.assigned_staff !== undefined && typeof complaint.assigned_staff !== 'string')
      || typeof complaint.staff_response !== 'string' || typeof complaint.resolution !== 'string'
      || !Number.isFinite(Date.parse(complaint.created_at)) || !Number.isFinite(Date.parse(complaint.updated_at))
      || (complaint.resolved_at !== null && complaint.resolved_at !== undefined && !Number.isFinite(Date.parse(complaint.resolved_at)))
      || (complaint.customer_id !== null && complaint.customer_id !== undefined && typeof complaint.customer_id !== 'string')
      || (complaint.customer_id && !userIds.has(complaint.customer_id))) {
      return 'Backup contains an invalid complaint record.'
    }
    if (complaintIds.has(complaint.id)) return 'Backup contains duplicate complaints.'
    complaintIds.add(complaint.id)
  }

  for (const log of snapshot.auditLogs) {
    if (!log || !['string', 'number'].includes(typeof log.id) || typeof log.action !== 'string'
      || !Number.isFinite(Date.parse(log.created_at))
      || (log.details !== undefined && (!log.details || typeof log.details !== 'object' || Array.isArray(log.details)))) {
      return 'Backup contains an invalid audit log record.'
    }
  }
  return null
}

function encryptBackup(snapshot, passphrase) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(passphrase, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify({
    format: 'customer-complaint-system-backup',
    version: 1,
    generatedAt: new Date().toISOString(),
    data: snapshot
  })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    format: 'customer-complaint-system-encrypted-backup',
    version: 1,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

function decryptBackup(envelope, passphrase) {
  if (!envelope || envelope.format !== 'customer-complaint-system-encrypted-backup'
    || envelope.version !== 1 || envelope.kdf !== 'scrypt' || envelope.cipher !== 'aes-256-gcm'
    || ![envelope.salt, envelope.iv, envelope.authTag, envelope.ciphertext].every((value) => typeof value === 'string')) {
    throw new Error('Unsupported or invalid backup file.')
  }

  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const authTag = Buffer.from(envelope.authTag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  if (salt.length !== 16 || iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted backup data.')
  }
  const key = crypto.scryptSync(passphrase, salt, 32)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const payload = JSON.parse(plaintext)
  if (payload?.format !== 'customer-complaint-system-backup' || payload.version !== 1) {
    throw new Error('Unsupported backup contents.')
  }
  const validationError = validateBackupSnapshot(payload.data)
  if (validationError) throw new Error(validationError)
  return payload.data
}

async function logAudit(action, userId, details = {}) {
  return storage.appendAuditLog({
    id: Date.now() + Math.random(),
    action,
    userId,
    details,
    created_at: new Date().toISOString()
  })
}

async function requireAuth(req, res, next) {
  const token = getSessionToken(req)
  let user
  try {
    user = token ? await storage.findSession(token) : null
  } catch (error) {
    return next(error)
  }

  if (!user) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  req.user = user
  next()
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to access this resource.' })
    }

    next()
  }
}

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-session-token']
}))
app.use(express.json({ limit: '25mb' }))

app.get('/', (req, res) => {
  res.json({
    message: 'Customer Complaint System backend is running!',
    version: 'role-based-complaint-system',
    databaseMode: storage.databaseEnabled ? 'postgresql' : 'memory'
  })
})

app.get('/api/health', async (req, res) => {
  const counts = await storage.getCounts()
  res.json({ status: 'ok', storage: storage.databaseEnabled ? 'postgresql' : 'memory', ...counts })
})

app.post('/api/register', async (req, res) => {
  const { fullName, name, email, password } = req.body
  const accountName = fullName || name

  if (!isValidAccountInput(accountName, email, password)) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 12 characters.' })
  }

  const normalizedEmail = normalizeEmail(email)

  if (await storage.findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = await createUser({
    name: accountName,
    email: normalizedEmail,
    password,
    role: 'CUSTOMER'
  })
  await logAudit('user_registered', user.id, { email: normalizedEmail, role: user.role })

  return res.status(201).json({
    message: 'Registration successful. Save the TOTP secret and sign in with your OTP.',
    ...accountCreatedResponse(user, totpSecret)
  })
})

app.post('/api/bootstrap-admin', async (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ message: 'Administrator setup is only available from the backend machine.' })
  }

  if ((await storage.listUsers()).some((user) => user.role === 'ADMINISTRATOR')) {
    return res.status(403).json({ message: 'An administrator has already been created.' })
  }

  const configuredSetupKey = process.env.ADMIN_SETUP_KEY
  const submittedSetupKey = typeof req.body?.setupKey === 'string' ? req.body.setupKey : ''
  if (!configuredSetupKey || !submittedSetupKey) {
    return res.status(503).json({ message: 'Administrator setup is not configured.' })
  }

  const expectedKeyHash = crypto.createHash('sha256').update(configuredSetupKey).digest()
  const submittedKeyHash = crypto.createHash('sha256').update(submittedSetupKey).digest()
  if (!crypto.timingSafeEqual(expectedKeyHash, submittedKeyHash)) {
    return res.status(403).json({ message: 'Administrator setup key is invalid.' })
  }

  const { fullName, email, password } = req.body
  if (!isValidAccountInput(fullName, email, password)) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 12 characters.' })
  }

  const normalizedEmail = normalizeEmail(email)
  if (await storage.findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = await createUser({
    name: fullName,
    email: normalizedEmail,
    password,
    role: 'ADMINISTRATOR'
  })
  delete process.env.ADMIN_SETUP_KEY
  await logAudit('administrator_bootstrapped', user.id)

  return res.status(201).json({
    message: 'Administrator account created. Set up the authenticator key before signing in.',
    ...accountCreatedResponse(user, totpSecret)
  })
})

app.post('/api/admin/users', requireAuth, requireRole(['ADMINISTRATOR']), async (req, res) => {
  const { fullName, email, password, role } = req.body
  const newRole = role || 'MANAGER'
  if (!['MANAGER', 'ADMINISTRATOR'].includes(newRole)) {
    return res.status(400).json({ message: 'Administrators can create Manager or Administrator accounts only.' })
  }

  if (!isValidAccountInput(fullName, email, password)) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 12 characters.' })
  }

  const normalizedEmail = normalizeEmail(email)
  if (await storage.findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = await createUser({
    name: fullName,
    email: normalizedEmail,
    password,
    role: newRole
  })
  await logAudit('staff_account_created', user.id, { createdBy: req.user.id, role: user.role })

  return res.status(201).json({
    message: `${user.role === 'MANAGER' ? 'Manager' : 'Administrator'} account created. Share the temporary password and authenticator key securely.`,
    ...accountCreatedResponse(user, totpSecret)
  })
})

app.post('/api/password-reset/request', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }

  if (!allowPasswordResetRequest(req.ip || 'unknown')) {
    return res.status(429).json({ message: 'Too many recovery requests. Please try again later.' })
  }

  const localConsoleMode = process.env.NODE_ENV !== 'production'
    && isLoopbackRequest(req)
    && process.env.RECOVERY_EMAIL_MODE === 'console'
  const transport = createMailTransport()
  if (!localConsoleMode && (!transport || !process.env.SMTP_FROM)) {
    return res.status(503).json({
      message: 'Account recovery email is not configured. Configure SMTP in the backend environment and try again.'
    })
  }

  const genericResponse = {
    message: 'If an account exists for that email, a recovery link will be sent shortly.'
  }
  const user = await storage.findUserByEmail(email)
  if (user && !user.is_active) {
    return res.status(202).json(genericResponse)
  }
  if (!user) {
    return res.status(202).json(genericResponse)
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await clearPasswordResetTokens(user.id)
  await storage.savePasswordResetToken(tokenHash, user.id, new Date(Date.now() + PASSWORD_RESET_TTL_MS))
  passwordResetTokens.set(tokenHash, {
    userId: user.id,
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS
  })

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  const resetUrl = `${frontendUrl}/?resetToken=${encodeURIComponent(token)}`

  if (!localConsoleMode) {
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject: 'Reset your Customer Complaint System account',
        text: `Use this one-time link within 30 minutes to reset your password and authenticator setup:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>Use this one-time link within 30 minutes to reset your password and authenticator setup:</p><p><a href="${resetUrl}">Recover your account</a></p><p>If you did not request this, you can ignore this email.</p>`
      })
    } catch (error) {
      await clearPasswordResetTokens(user.id)
      console.error('Password recovery email delivery failed:', error.message)
      return res.status(503).json({
        message: 'Unable to send a recovery email right now. Check SMTP configuration and try again.'
      })
    }
  }

  await logAudit('password_reset_requested', user.id)
  return res.status(202).json(localConsoleMode
    ? {
        message: 'Local development recovery link created. Do not use this mode outside local testing.',
        recoveryUrl: resetUrl
      }
    : genericResponse)
})

app.post('/api/password-reset/complete', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!token || password.length < 12) {
    return res.status(400).json({ message: 'A valid recovery link and a password of at least 12 characters are required.' })
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const reset = await storage.findPasswordResetToken(tokenHash)
  if (!reset || reset.expiresAt <= Date.now()) {
    passwordResetTokens.delete(tokenHash)
    await storage.deletePasswordResetToken(tokenHash)
    return res.status(400).json({ message: 'This recovery link is invalid or expired. Request a new one.' })
  }

  const user = await storage.findUserById(reset.userId)
  if (!user) {
    passwordResetTokens.delete(tokenHash)
    await storage.deletePasswordResetToken(tokenHash)
    return res.status(400).json({ message: 'This recovery link is invalid or expired. Request a new one.' })
  }
  if (!user.is_active) {
    passwordResetTokens.delete(tokenHash)
    await storage.deletePasswordResetToken(tokenHash)
    return res.status(400).json({ message: 'This recovery link is invalid or expired. Request a new one.' })
  }

  user.password_hash = bcrypt.hashSync(`${password}${getPepper()}`, 10)
  user.totp_secret = authenticator.generateSecret()
  user.updated_at = new Date().toISOString()
  await storage.updateUser(user)
  await clearPasswordResetTokens(user.id)

  await storage.deleteSessionsForUser(user.id)
  for (const [sessionToken, sessionUser] of sessions) {
    if (sessionUser.userId === user.id || sessionUser.id === user.id) sessions.delete(sessionToken)
  }

  await logAudit('password_reset_completed', user.id)
  return res.json({
    message: 'Password reset. Set up your authenticator again with the new key below.',
    totpSecret: user.totp_secret,
    otpUri: authenticator.keyuri(user.email, 'Customer Complaint System', user.totp_secret)
  })
})

app.post('/api/login', async (req, res) => {
  const { email, password, otp } = req.body

  if (!email || !password || !otp) {
    return res.status(400).json({ message: 'Email, password, and OTP are required.' })
  }

  const user = await storage.findUserByEmail(String(email).trim().toLowerCase())
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const passwordMatches = bcrypt.compareSync(`${password}${getPepper()}`, user.password_hash)
  if (!passwordMatches) {
    await logAudit('login_failed', user.id, { reason: 'invalid_password' })
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const isOtpValid = authenticator.check(otp, user.totp_secret)
  if (!isOtpValid) {
    await logAudit('login_failed', user.id, { reason: 'invalid_otp' })
    return res.status(401).json({ message: 'Invalid or expired OTP.' })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await storage.saveSession(token, user.id, expiresAt)
  sessions.set(token, { userId: user.id, expiresAt })

  await logAudit('login_success', user.id, { email: user.email })

  return res.json({
    message: 'Login successful.',
    token,
    user: sanitizeUser(user)
  })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user), token: getSessionToken(req) })
})

app.post('/api/logout', requireAuth, async (req, res) => {
  const token = getSessionToken(req)
  await storage.deleteSession(token)
  sessions.delete(token)
  await logAudit('logout', req.user.id)
  res.json({ message: 'Logged out successfully.' })
})

app.get('/api/users', requireAuth, requireRole(['ADMINISTRATOR']), async (req, res) => {
  res.json({
    users: (await storage.listUsers()).map((user) => sanitizeUser(user))
  })
})

app.get('/api/admin/security-report', requireAuth, requireRole(['ADMINISTRATOR']), async (req, res) => {
  const [users, counts, auditTrail] = await Promise.all([
    storage.listUsers(),
    storage.getCounts(),
    storage.getAuditLogs(10)
  ])
  const passwordHashExamples = users.slice(0, 3).map((user) => ({
    email: user.email,
    passwordHashStored: user.password_hash ? 'bcrypt-hash-present' : 'missing'
  }))

  res.json({
    overview: {
      totalUsers: counts.users,
      activeUsers: users.filter((user) => user.is_active).length,
      disabledUsers: users.filter((user) => !user.is_active).length,
      totalComplaints: counts.complaints,
      totpEnabledUsers: users.filter((user) => !!user.totp_secret).length,
      pepperConfigured: Boolean(process.env.PEPPER),
      saltStrategy: 'bcrypt with per-user salt',
      auditLogs: counts.auditLogs
    },
    passwordSecurity: {
      note: 'Passwords are never stored as plain text. Each password is hashed with bcrypt using a server-side pepper value and a unique salt.',
      sampleHashes: passwordHashExamples,
      pepperProtection: 'PEPPER is stored only on the backend and not exposed in frontend code or API responses.'
    },
    auditTrail
  })
})

app.post('/api/admin/backup', requireAuth, requireRole(['ADMINISTRATOR']), async (req, res) => {
  const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : ''
  if (passphrase.length < 12 || passphrase.length > MAX_BACKUP_PASSPHRASE_LENGTH) {
    return res.status(400).json({ message: `Use a backup passphrase between 12 and ${MAX_BACKUP_PASSPHRASE_LENGTH} characters.` })
  }

  const snapshot = await storage.createSnapshot()
  const backup = encryptBackup(snapshot, passphrase)
  await logAudit('backup_created', req.user.id, {
    users: snapshot.users.length,
    complaints: snapshot.complaints.length
  })
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="customer-complaint-backup-${new Date().toISOString().slice(0, 10)}.json"`)
  res.json(backup)
})

app.post('/api/admin/restore', requireAuth, requireRole(['ADMINISTRATOR']), async (req, res) => {
  if (req.body?.confirmation !== 'RESTORE') {
    return res.status(400).json({ message: 'Type RESTORE to confirm replacing all current users, complaints, and audit logs.' })
  }
  const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : ''
  if (passphrase.length < 12 || passphrase.length > MAX_BACKUP_PASSPHRASE_LENGTH
    || !req.body?.backup || typeof req.body.backup !== 'object') {
    return res.status(400).json({ message: 'Provide the backup file and its passphrase.' })
  }

  let snapshot
  try {
    snapshot = decryptBackup(req.body.backup, passphrase)
  } catch (error) {
    return res.status(400).json({ message: error.message || 'The backup file could not be decrypted.' })
  }

  await storage.restoreSnapshot(snapshot)
  sessions.clear()
  passwordResetTokens.clear()
  await logAudit('backup_restored', null, {
    users: snapshot.users.length,
    complaints: snapshot.complaints.length
  })
  res.json({
    message: 'Backup restored. All sessions were invalidated; sign in using an account from the restored backup.'
  })
})

app.use('/complaints', requireAuth, (req, res, next) => {
  if (req.method === 'POST' && req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only signed-in customers can submit complaints.' })
  }

  next()
}, complaintsRouter)

if (require.main === module) {
  storage.initializeDatabase()
    .then(() => app.listen(PORT, () => {
      console.log(`Backend server running at http://localhost:${PORT}`)
    }))
    .catch((error) => {
      console.error('Backend startup failed:', error.message)
      process.exitCode = 1
    })
}

module.exports = {
  app,
  memoryStore,
  passwordResetTokens,
  sessions
}
