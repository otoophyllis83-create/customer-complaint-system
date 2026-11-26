
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const { authenticator } = require('otplib')
const { memoryStore } = require('./db')
const complaintsRouter = require('./complaints')

const app = express()
const PORT = Number(process.env.PORT || 5000)
const sessions = new Map()
const passwordResetTokens = new Map()
const passwordResetRequests = new Map()
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000
const PASSWORD_RESET_RATE_LIMIT_MS = 15 * 60 * 1000
const PASSWORD_RESET_MAX_REQUESTS = 5

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

function clearPasswordResetTokens(userId) {
  for (const [tokenHash, reset] of passwordResetTokens) {
    if (reset.userId === userId) {
      passwordResetTokens.delete(tokenHash)
    }
  }
}

function createUser({ name, email, password, role }) {
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

  memoryStore.users.push(user)
  return { user, totpSecret }
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

  const { password_hash, totp_secret, ...safeUser } = user
  return safeUser
}

function logAudit(action, userId, details = {}) {
  memoryStore.auditLogs.unshift({
    id: Date.now() + Math.random(),
    action,
    userId,
    details,
    created_at: new Date().toISOString()
  })
}

function requireAuth(req, res, next) {
  const token = getSessionToken(req)
  const user = token ? sessions.get(token) : null

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
app.use(express.json())

app.use((req, res, next) => {
  const token = getSessionToken(req)
  if (token && sessions.has(token)) {
    req.user = sessions.get(token)
  }
  next()
})

app.get('/', (req, res) => {
  res.json({
    message: 'Customer Complaint System backend is running!',
    version: 'role-based-complaint-system',
    databaseMode: 'in-memory fallback'
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    users: memoryStore.users.length,
    complaints: memoryStore.complaints.length,
    auditLogs: memoryStore.auditLogs.length
  })
})

app.post('/api/register', (req, res) => {
  const { fullName, name, email, password } = req.body
  const accountName = fullName || name

  if (!isValidAccountInput(accountName, email, password)) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 12 characters.' })
  }

  const normalizedEmail = normalizeEmail(email)

  if (memoryStore.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = createUser({
    name: accountName,
    email: normalizedEmail,
    password,
    role: 'CUSTOMER'
  })
  logAudit('user_registered', user.id, { email: normalizedEmail, role: user.role })

  return res.status(201).json({
    message: 'Registration successful. Save the TOTP secret and sign in with your OTP.',
    ...accountCreatedResponse(user, totpSecret)
  })
})

app.post('/api/bootstrap-admin', (req, res) => {
  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ message: 'Administrator setup is only available from the backend machine.' })
  }

  if (memoryStore.users.some((user) => user.role === 'ADMINISTRATOR')) {
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
  if (memoryStore.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = createUser({
    name: fullName,
    email: normalizedEmail,
    password,
    role: 'ADMINISTRATOR'
  })
  delete process.env.ADMIN_SETUP_KEY
  logAudit('administrator_bootstrapped', user.id)

  return res.status(201).json({
    message: 'Administrator account created. Set up the authenticator key before signing in.',
    ...accountCreatedResponse(user, totpSecret)
  })
})

app.post('/api/admin/users', requireAuth, requireRole(['ADMINISTRATOR']), (req, res) => {
  const { fullName, email, password, role } = req.body
  const newRole = role || 'MANAGER'
  if (!['MANAGER', 'ADMINISTRATOR'].includes(newRole)) {
    return res.status(400).json({ message: 'Administrators can create Manager or Administrator accounts only.' })
  }

  if (!isValidAccountInput(fullName, email, password)) {
    return res.status(400).json({ message: 'Enter a name, valid email, and password with at least 12 characters.' })
  }

  const normalizedEmail = normalizeEmail(email)
  if (memoryStore.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const { user, totpSecret } = createUser({
    name: fullName,
    email: normalizedEmail,
    password,
    role: newRole
  })
  logAudit('staff_account_created', user.id, { createdBy: req.user.id, role: user.role })

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
  const user = memoryStore.users.find((record) => record.email === email && record.is_active)
  if (!user) {
    return res.status(202).json(genericResponse)
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  clearPasswordResetTokens(user.id)
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
      clearPasswordResetTokens(user.id)
      console.error('Password recovery email delivery failed:', error.message)
      return res.status(503).json({
        message: 'Unable to send a recovery email right now. Check SMTP configuration and try again.'
      })
    }
  }

  logAudit('password_reset_requested', user.id)
  return res.status(202).json(localConsoleMode
    ? {
        message: 'Local development recovery link created. Do not use this mode outside local testing.',
        recoveryUrl: resetUrl
      }
    : genericResponse)
})

app.post('/api/password-reset/complete', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!token || password.length < 12) {
    return res.status(400).json({ message: 'A valid recovery link and a password of at least 12 characters are required.' })
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const reset = passwordResetTokens.get(tokenHash)
  if (!reset || reset.expiresAt <= Date.now()) {
    passwordResetTokens.delete(tokenHash)
    return res.status(400).json({ message: 'This recovery link is invalid or expired. Request a new one.' })
  }

  const user = memoryStore.users.find((record) => record.id === reset.userId && record.is_active)
  if (!user) {
    passwordResetTokens.delete(tokenHash)
    return res.status(400).json({ message: 'This recovery link is invalid or expired. Request a new one.' })
  }

  user.password_hash = bcrypt.hashSync(`${password}${getPepper()}`, 10)
  user.totp_secret = authenticator.generateSecret()
  user.updated_at = new Date().toISOString()
  clearPasswordResetTokens(user.id)

  for (const [sessionToken, sessionUser] of sessions) {
    if (sessionUser.id === user.id) {
      sessions.delete(sessionToken)
    }
  }

  logAudit('password_reset_completed', user.id)
  return res.json({
    message: 'Password reset. Set up your authenticator again with the new key below.',
    totpSecret: user.totp_secret,
    otpUri: authenticator.keyuri(user.email, 'Customer Complaint System', user.totp_secret)
  })
})

app.post('/api/login', (req, res) => {
  const { email, password, otp } = req.body

  if (!email || !password || !otp) {
    return res.status(400).json({ message: 'Email, password, and OTP are required.' })
  }

  const user = memoryStore.users.find((record) => record.email === String(email).trim().toLowerCase())
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const passwordMatches = bcrypt.compareSync(`${password}${getPepper()}`, user.password_hash)
  if (!passwordMatches) {
    logAudit('login_failed', user.id, { reason: 'invalid_password' })
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const isOtpValid = authenticator.check(otp, user.totp_secret)
  if (!isOtpValid) {
    logAudit('login_failed', user.id, { reason: 'invalid_otp' })
    return res.status(401).json({ message: 'Invalid or expired OTP.' })
  }

  const token = crypto.randomUUID()
  sessions.set(token, user)

  logAudit('login_success', user.id, { email: user.email })

  return res.json({
    message: 'Login successful.',
    token,
    user: sanitizeUser(user)
  })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user), token: getSessionToken(req) })
})

app.post('/api/logout', requireAuth, (req, res) => {
  const token = getSessionToken(req)
  sessions.delete(token)
  logAudit('logout', req.user.id)
  res.json({ message: 'Logged out successfully.' })
})

app.get('/api/users', requireAuth, requireRole(['ADMINISTRATOR']), (req, res) => {
  res.json({
    users: memoryStore.users.map((user) => sanitizeUser(user))
  })
})

app.get('/api/admin/security-report', requireAuth, requireRole(['ADMINISTRATOR']), (req, res) => {
  const passwordHashExamples = memoryStore.users.slice(0, 3).map((user) => ({
    email: user.email,
    passwordHashStored: user.password_hash ? 'bcrypt-hash-present' : 'missing'
  }))

  res.json({
    overview: {
      totalUsers: memoryStore.users.length,
      activeUsers: memoryStore.users.filter((user) => user.is_active).length,
      disabledUsers: memoryStore.users.filter((user) => !user.is_active).length,
      totalComplaints: memoryStore.complaints.length,
      totpEnabledUsers: memoryStore.users.filter((user) => !!user.totp_secret).length,
      pepperConfigured: Boolean(process.env.PEPPER),
      saltStrategy: 'bcrypt with per-user salt',
      auditLogs: memoryStore.auditLogs.length
    },
    passwordSecurity: {
      note: 'Passwords are never stored as plain text. Each password is hashed with bcrypt using a server-side pepper value and a unique salt.',
      sampleHashes: passwordHashExamples,
      pepperProtection: 'PEPPER is stored only on the backend and not exposed in frontend code or API responses.'
    },
    auditTrail: memoryStore.auditLogs.slice(0, 10)
  })
})

app.post('/api/admin/backup-demo', requireAuth, requireRole(['ADMINISTRATOR']), (req, res) => {
  const backup = {
    generated_at: new Date().toISOString(),
    users: memoryStore.users.length,
    complaints: memoryStore.complaints.length,
    auditLogs: memoryStore.auditLogs.length,
    note: 'This is a demonstration backup snapshot for the complaint management system.'
  }

  logAudit('backup_demo', req.user.id, { action: 'backup_generated' })
  res.json({ message: 'Backup snapshot generated successfully.', backup })
})

app.use('/complaints', requireAuth, (req, res, next) => {
  if (req.method === 'POST' && req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only signed-in customers can submit complaints.' })
  }

  next()
}, complaintsRouter)

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`)
  })
}

module.exports = {
  app,
  memoryStore,
  passwordResetTokens,
  sessions
}
