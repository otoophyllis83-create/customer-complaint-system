import { useState } from 'react'

const API_BASE = 'http://localhost:5000'

function AdminUserForm({ token }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('MANAGER')
  const [message, setMessage] = useState('')
  const [createdUser, setCreatedUser] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setCreatedUser(null)

    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': token
        },
        body: JSON.stringify({ fullName, email, password, role })
      })
      const responseText = await response.text()
      let data
      try {
        data = responseText ? JSON.parse(responseText) : {}
      } catch {
        throw new Error('The server returned an invalid response. Please try again.')
      }

      if (!response.ok) {
        throw new Error(data.message || 'Could not create the account.')
      }

      setCreatedUser(data)
      setMessage(data.message)
      setFullName('')
      setEmail('')
      setPassword('')
    } catch (error) {
      setMessage(error.message || 'Could not create the account.')
    }
  }

  async function copySetupKey() {
    try {
      await navigator.clipboard.writeText(createdUser.totpSecret)
      setMessage('Authenticator setup key copied. Share it securely with the new account holder.')
    } catch {
      setMessage('Could not copy the setup key. Select and copy it manually.')
    }
  }

  return (
    <section className="panel-card manager-creation">
      <h2>Create an account</h2>
      <p>Create a Manager or Administrator account. Share the temporary password and authenticator key securely.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="staff-name">Full name</label>
        <input
          id="staff-name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          maxLength="120"
          required
        />
        <label htmlFor="staff-email">Email</label>
        <input
          id="staff-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="staff-role">Account role</label>
        <select id="staff-role" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="MANAGER">Manager</option>
          <option value="ADMINISTRATOR">Administrator</option>
        </select>
        <label htmlFor="staff-password">Temporary password (at least 12 characters)</label>
        <input
          id="staff-password"
          type="password"
          autoComplete="new-password"
          minLength="12"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit">Create {role === 'MANAGER' ? 'manager' : 'administrator'}</button>
      </form>
      {message && <p role="status" aria-live="polite">{message}</p>}
      {createdUser && (
        <div className="secret-box">
          <h3>{createdUser.user.role === 'MANAGER' ? 'Manager' : 'Administrator'} authenticator setup</h3>
          <p>{createdUser.user.role}: <strong>{createdUser.user.name}</strong> ({createdUser.user.email})</p>
          <p className="totp-secret"><strong>Setup key:</strong> <code>{createdUser.totpSecret}</code></p>
          <button type="button" className="secondary copy-secret" onClick={copySetupKey}>
            Copy setup key
          </button>
          <p className="totp-warning">This key is shown only when the account is created. Give it only to the account holder through a secure channel.</p>
        </div>
      )}
    </section>
  )
}

export default AdminUserForm
