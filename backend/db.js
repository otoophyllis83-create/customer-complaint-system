require('dotenv').config()

const crypto = require('node:crypto')
const { Pool } = require('pg')

const memoryStore = {
  users: [],
  complaints: [],
  auditLogs: []
}
const memorySessions = new Map()
const memoryResetTokens = new Map()
const databaseUrl = process.env.DATABASE_URL
const useMemoryStore = process.env.STORAGE_MODE === 'memory'
const pool = databaseUrl && !useMemoryStore
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    })
  : null
const databaseEnabled = Boolean(pool)

const toIso = (value) => value instanceof Date ? value.toISOString() : value

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password_hash: row.password_hash,
    totp_secret: row.totp_secret,
    role: row.role,
    is_active: row.is_active,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  }
}

function mapComplaint(row) {
  if (!row) return null
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    subject: row.subject,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assigned_staff: row.assigned_staff,
    staff_response: row.staff_response,
    resolution: row.resolution,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    resolved_at: row.resolved_at ? toIso(row.resolved_at) : null
  }
}

async function initializeDatabase() {
  if (!pool) {
    if (process.env.NODE_ENV === 'production' || process.env.REQUIRE_DATABASE === 'true') {
      throw new Error('Persistent PostgreSQL storage is required, but DATABASE_URL is not configured.')
    }
    console.warn('DATABASE_URL is not configured; using in-memory storage. Data will not survive a restart.')
    return false
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS ccs_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        totp_secret TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'SUPPORT', 'MANAGER', 'ADMINISTRATOR')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ccs_complaints (
        id TEXT PRIMARY KEY,
        customer_id TEXT REFERENCES ccs_users(id) ON DELETE RESTRICT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_staff TEXT,
        staff_response TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        resolved_at TIMESTAMPTZ
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ccs_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ccs_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS ccs_sessions_user_id_idx ON ccs_sessions(user_id)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS ccs_password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES ccs_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ccs_audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        user_id TEXT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS ccs_complaints_created_at_idx ON ccs_complaints(created_at DESC)')
    await client.query('CREATE INDEX IF NOT EXISTS ccs_audit_logs_created_at_idx ON ccs_audit_logs(created_at DESC)')
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`PostgreSQL schema initialization failed: ${error.message}`, { cause: error })
  } finally {
    client.release()
  }
}

async function findUserByEmail(email) {
  if (!databaseEnabled) return memoryStore.users.find((user) => user.email === email) || null
  const result = await pool.query('SELECT * FROM ccs_users WHERE email = $1', [email])
  return mapUser(result.rows[0])
}

async function findUserById(id) {
  if (!databaseEnabled) return memoryStore.users.find((user) => user.id === id) || null
  const result = await pool.query('SELECT * FROM ccs_users WHERE id = $1', [id])
  return mapUser(result.rows[0])
}

async function listUsers() {
  if (!databaseEnabled) return [...memoryStore.users]
  const result = await pool.query('SELECT * FROM ccs_users ORDER BY created_at DESC')
  return result.rows.map(mapUser)
}

async function createUser(user) {
  if (!databaseEnabled) {
    memoryStore.users.push(user)
    return user
  }
  const result = await pool.query(
    `INSERT INTO ccs_users
      (id, name, email, password_hash, totp_secret, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [user.id, user.name, user.email, user.password_hash, user.totp_secret, user.role, user.is_active, user.created_at, user.updated_at]
  )
  return mapUser(result.rows[0])
}

async function updateUser(user) {
  if (!databaseEnabled) {
    const index = memoryStore.users.findIndex((entry) => entry.id === user.id)
    if (index < 0) throw new Error('User no longer exists.')
    memoryStore.users[index] = user
    return user
  }
  const result = await pool.query(
    `UPDATE ccs_users SET name = $2, email = $3, password_hash = $4, totp_secret = $5,
      role = $6, is_active = $7, updated_at = $8 WHERE id = $1 RETURNING *`,
    [user.id, user.name, user.email, user.password_hash, user.totp_secret, user.role, user.is_active, user.updated_at]
  )
  if (!result.rows[0]) throw new Error('User no longer exists.')
  return mapUser(result.rows[0])
}

async function listComplaints() {
  if (!databaseEnabled) return [...memoryStore.complaints]
  const result = await pool.query('SELECT * FROM ccs_complaints ORDER BY created_at DESC')
  return result.rows.map(mapComplaint)
}

async function findComplaintById(id) {
  if (!databaseEnabled) return memoryStore.complaints.find((complaint) => complaint.id === id) || null
  const result = await pool.query('SELECT * FROM ccs_complaints WHERE id = $1', [id])
  return mapComplaint(result.rows[0])
}

async function createComplaint(complaint) {
  if (!databaseEnabled) {
    memoryStore.complaints.unshift(complaint)
    return complaint
  }
  const result = await pool.query(
    `INSERT INTO ccs_complaints
      (id, customer_id, customer_name, customer_email, subject, description, category, priority, status,
       assigned_staff, staff_response, resolution, created_at, updated_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      complaint.id, complaint.customer_id, complaint.customer_name, complaint.customer_email, complaint.subject,
      complaint.description, complaint.category, complaint.priority, complaint.status, complaint.assigned_staff,
      complaint.staff_response, complaint.resolution, complaint.created_at, complaint.updated_at, complaint.resolved_at
    ]
  )
  return mapComplaint(result.rows[0])
}

async function updateComplaint(complaint) {
  if (!databaseEnabled) {
    const index = memoryStore.complaints.findIndex((entry) => entry.id === complaint.id)
    if (index < 0) throw new Error('Complaint no longer exists.')
    memoryStore.complaints[index] = complaint
    return complaint
  }
  const result = await pool.query(
    `UPDATE ccs_complaints SET status = $2, assigned_staff = $3, staff_response = $4,
      resolution = $5, updated_at = $6, resolved_at = $7 WHERE id = $1 RETURNING *`,
    [complaint.id, complaint.status, complaint.assigned_staff, complaint.staff_response, complaint.resolution, complaint.updated_at, complaint.resolved_at]
  )
  if (!result.rows[0]) throw new Error('Complaint no longer exists.')
  return mapComplaint(result.rows[0])
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function saveSession(token, userId, expiresAt) {
  if (!databaseEnabled) {
    memorySessions.set(token, { userId, expiresAt })
    return
  }
  await pool.query(
    'INSERT INTO ccs_sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, NOW(), $3)',
    [hashSessionToken(token), userId, expiresAt]
  )
}

async function findSession(token) {
  if (!databaseEnabled) {
    const session = memorySessions.get(token)
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      memorySessions.delete(token)
      return null
    }
    const user = await findUserById(session.userId)
    return user?.is_active ? user : null
  }
  const result = await pool.query(
    `SELECT u.* FROM ccs_sessions s
     JOIN ccs_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
    [hashSessionToken(token)]
  )
  return mapUser(result.rows[0])
}

async function deleteSession(token) {
  if (!databaseEnabled) {
    memorySessions.delete(token)
    return
  }
  await pool.query('DELETE FROM ccs_sessions WHERE token_hash = $1', [hashSessionToken(token)])
}

async function deleteSessionsForUser(userId) {
  if (!databaseEnabled) {
    for (const [token, session] of memorySessions) {
      if (session.userId === userId) memorySessions.delete(token)
    }
    return
  }
  await pool.query('DELETE FROM ccs_sessions WHERE user_id = $1', [userId])
}

async function savePasswordResetToken(tokenHash, userId, expiresAt) {
  if (!databaseEnabled) {
    memoryResetTokens.set(tokenHash, { userId, expiresAt: new Date(expiresAt).getTime() })
    return
  }
  await pool.query(
    `INSERT INTO ccs_password_reset_tokens (token_hash, user_id, expires_at, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [tokenHash, userId, expiresAt]
  )
}

async function findPasswordResetToken(tokenHash) {
  if (!databaseEnabled) return memoryResetTokens.get(tokenHash) || null
  const result = await pool.query(
    'SELECT user_id AS "userId", expires_at AS "expiresAt" FROM ccs_password_reset_tokens WHERE token_hash = $1',
    [tokenHash]
  )
  const row = result.rows[0]
  return row ? { userId: row.userId, expiresAt: new Date(row.expiresAt).getTime() } : null
}

async function deletePasswordResetToken(tokenHash) {
  if (!databaseEnabled) {
    memoryResetTokens.delete(tokenHash)
    return
  }
  await pool.query('DELETE FROM ccs_password_reset_tokens WHERE token_hash = $1', [tokenHash])
}

async function deletePasswordResetTokensForUser(userId) {
  if (!databaseEnabled) {
    for (const [tokenHash, reset] of memoryResetTokens) {
      if (reset.userId === userId) memoryResetTokens.delete(tokenHash)
    }
    return
  }
  await pool.query('DELETE FROM ccs_password_reset_tokens WHERE user_id = $1', [userId])
}

async function appendAuditLog(log) {
  if (!databaseEnabled) {
    memoryStore.auditLogs.unshift(log)
    return log
  }
  const result = await pool.query(
    `INSERT INTO ccs_audit_logs (id, action, user_id, details, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(log.id), log.action, log.userId, JSON.stringify(log.details), log.created_at]
  )
  const row = result.rows[0]
  return { id: row.id, action: row.action, userId: row.user_id, details: row.details, created_at: toIso(row.created_at) }
}

async function getAuditLogs(limit = 10) {
  if (!databaseEnabled) return memoryStore.auditLogs.slice(0, limit)
  const result = await pool.query(
    'SELECT id, action, user_id, details, created_at FROM ccs_audit_logs ORDER BY created_at DESC LIMIT $1',
    [limit]
  )
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    userId: row.user_id,
    details: row.details,
    created_at: toIso(row.created_at)
  }))
}

async function getCounts() {
  if (!databaseEnabled) {
    return {
      users: memoryStore.users.length,
      complaints: memoryStore.complaints.length,
      auditLogs: memoryStore.auditLogs.length
    }
  }
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM ccs_users)::int AS users,
      (SELECT COUNT(*) FROM ccs_complaints)::int AS complaints,
      (SELECT COUNT(*) FROM ccs_audit_logs)::int AS "auditLogs"
  `)
  return result.rows[0]
}

async function createSnapshot() {
  if (!databaseEnabled) {
    return {
      users: [...memoryStore.users],
      complaints: [...memoryStore.complaints],
      auditLogs: [...memoryStore.auditLogs]
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const [users, complaints, auditLogs] = await Promise.all([
      client.query('SELECT * FROM ccs_users ORDER BY created_at'),
      client.query('SELECT * FROM ccs_complaints ORDER BY created_at'),
      client.query('SELECT id, action, user_id, details, created_at FROM ccs_audit_logs ORDER BY created_at')
    ])
    await client.query('COMMIT')
    return {
      users: users.rows.map(mapUser),
      complaints: complaints.rows.map(mapComplaint),
      auditLogs: auditLogs.rows.map((row) => ({
        id: row.id,
        action: row.action,
        userId: row.user_id,
        details: row.details,
        created_at: toIso(row.created_at)
      }))
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function restoreSnapshot(snapshot) {
  if (!databaseEnabled) {
    memoryStore.users.splice(0, memoryStore.users.length, ...snapshot.users)
    memoryStore.complaints.splice(0, memoryStore.complaints.length, ...snapshot.complaints)
    memoryStore.auditLogs.splice(0, memoryStore.auditLogs.length, ...snapshot.auditLogs)
    memorySessions.clear()
    memoryResetTokens.clear()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE ccs_users, ccs_complaints, ccs_sessions, ccs_password_reset_tokens, ccs_audit_logs IN EXCLUSIVE MODE')
    await client.query('DELETE FROM ccs_sessions')
    await client.query('DELETE FROM ccs_password_reset_tokens')
    await client.query('DELETE FROM ccs_complaints')
    await client.query('DELETE FROM ccs_audit_logs')
    await client.query('DELETE FROM ccs_users')

    for (const user of snapshot.users) {
      await client.query(
        `INSERT INTO ccs_users
          (id, name, email, password_hash, totp_secret, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [user.id, user.name, user.email, user.password_hash, user.totp_secret, user.role, user.is_active, user.created_at, user.updated_at]
      )
    }
    for (const complaint of snapshot.complaints) {
      await client.query(
        `INSERT INTO ccs_complaints
          (id, customer_id, customer_name, customer_email, subject, description, category, priority, status,
           assigned_staff, staff_response, resolution, created_at, updated_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          complaint.id, complaint.customer_id || null, complaint.customer_name, complaint.customer_email, complaint.subject,
          complaint.description, complaint.category, complaint.priority, complaint.status, complaint.assigned_staff,
          complaint.staff_response, complaint.resolution, complaint.created_at, complaint.updated_at, complaint.resolved_at
        ]
      )
    }
    for (const log of snapshot.auditLogs) {
      await client.query(
        'INSERT INTO ccs_audit_logs (id, action, user_id, details, created_at) VALUES ($1, $2, $3, $4, $5)',
        [String(log.id), log.action, log.userId || log.user_id || null, JSON.stringify(log.details || {}), log.created_at]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function testDatabase() {
  if (!pool) return false
  await pool.query('SELECT 1')
  return true
}

module.exports = {
  databaseEnabled,
  initializeDatabase,
  pool,
  memoryStore,
  memorySessions,
  memoryResetTokens,
  findUserByEmail,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  listComplaints,
  findComplaintById,
  createComplaint,
  updateComplaint,
  saveSession,
  findSession,
  deleteSession,
  deleteSessionsForUser,
  savePasswordResetToken,
  findPasswordResetToken,
  deletePasswordResetToken,
  deletePasswordResetTokensForUser,
  appendAuditLog,
  getAuditLogs,
  getCounts,
  createSnapshot,
  restoreSnapshot,
  testDatabase
}
