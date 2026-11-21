require('dotenv').config()

const { Pool } = require('pg')

const databaseUrl = process.env.DATABASE_URL
const memoryStore = {
  users: [],
  complaints: [],
  auditLogs: []
}

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined
    })
  : null

async function testDatabase() {
  if (!pool) return false

  try {
    await pool.query('SELECT 1')
    return true
  } catch (error) {
    console.warn('Database not available, using in-memory fallback:', error.message)
    return false
  }
}

module.exports = {
  pool,
  memoryStore,
  testDatabase
}
