
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { authenticator } = require('otplib')
const { memoryStore } = require('./db')
const complaintsRouter = require('./complaints')

const app = express()
const PORT = 5000
const sessions = new Map()

const getPepper = () => process.env.PEPPER || 'development-pepper'
const getSessionToken = (req) => req.headers['x-session-token'] || req.headers['X-Session-Token'] || null

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
  const { fullName, name, email, password, role } = req.body

  if (!email || !password || (!fullName && !name)) {
    return res.status(400).json({ message: 'Name, email, and password are required.' })
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const normalizedName = String(fullName || name).trim()
  const selectedRole = ['CUSTOMER', 'SUPPORT', 'MANAGER', 'ADMINISTRATOR'].includes(role)
    ? role
    : 'CUSTOMER'

  if (memoryStore.users.some((user) => user.email === normalizedEmail)) {
    return res.status(409).json({ message: 'An account with that email already exists.' })
  }

  const passwordHash = bcrypt.hashSync(`${password}${getPepper()}`, 10)
  const totpSecret = authenticator.generateSecret()
  const user = {
    id: crypto.randomUUID(),
    name: normalizedName,
    email: normalizedEmail,
    password_hash: passwordHash,
    totp_secret: totpSecret,
    role: selectedRole,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  memoryStore.users.push(user)
  logAudit('user_registered', user.id, { email: normalizedEmail, role: selectedRole })

  return res.status(201).json({
    message: 'Registration successful. Save the TOTP secret and sign in with your OTP.',
    user: sanitizeUser(user),
    totpSecret,
    otpUri: authenticator.keyuri(normalizedEmail, 'Customer Complaint System', totpSecret)
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

app.use('/complaints', (req, res, next) => {
  if (req.method === 'POST') {
    return next()
  }

  const token = getSessionToken(req)
  const user = token ? sessions.get(token) : null

  if (!user) {
    return res.status(401).json({ message: 'Authentication required to access complaints.' })
  }

  req.user = user
  next()
}, complaintsRouter)

app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`)
})
