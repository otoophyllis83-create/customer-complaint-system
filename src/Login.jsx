
import { useState } from 'react'

const API_BASE = 'http://localhost:5000'

function Login({ onAuthenticated, onBack }) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('CUSTOMER')
  const [otp, setOtp] = useState('')
  const [message, setMessage] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [otpUri, setOtpUri] = useState('')

  async function copyTotpSecret() {
    try {
      await navigator.clipboard.writeText(totpSecret)
      setMessage('Authenticator secret copied. Add it as a time-based code in your authenticator app.')
    } catch {
      setMessage('Could not copy the secret. Select and copy it manually.')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')

    try {
      const endpoint = isRegistering ? `${API_BASE}/api/register` : `${API_BASE}/api/login`
      const payload = isRegistering
        ? { fullName, email, password, role }
        : { email, password, otp }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed.')
      }

      if (isRegistering) {
        setTotpSecret(data.totpSecret)
        setOtpUri(data.otpUri)
        setMessage('Registration successful. Your authenticator app will generate the sign-in code; no code is emailed or texted.')
        setIsRegistering(false)
        setPassword('')
        setOtp('')
        return
      }

      onAuthenticated({ token: data.token, user: data.user })
    } catch (error) {
      setMessage(error.message || 'Could not authenticate.')
    }
  }

  return (
    <div className="welcome-card card">
      <h2>{isRegistering ? 'Create account' : 'Sign in'}</h2>
      <p>{isRegistering ? 'Register a new user and set up TOTP.' : 'Sign in with your email, password, and OTP.'}</p>

      <form onSubmit={handleSubmit}>
        {isRegistering && (
          <>
            <label htmlFor="fullName">Full Name</label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />

            <label htmlFor="role">Role</label>
            <select id="role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="CUSTOMER">Customer</option>
              <option value="SUPPORT">Support</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMINISTRATOR">Administrator</option>
            </select>
          </>
        )}

        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          required
        />

        {!isRegistering && (
          <>
            <label htmlFor="otp">One-time password (OTP)</label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              placeholder="123456"
              required
            />
          </>
        )}

        <div className="button-row">
          <button type="submit">{isRegistering ? 'Register' : 'Sign In'}</button>
          <button type="button" className="secondary" onClick={onBack}>Back</button>
        </div>
      </form>

      {totpSecret && (
        <div className="secret-box">
          <h3>Set up your authenticator</h3>
          <ol>
            <li>Open Google Authenticator, Microsoft Authenticator, or another TOTP app.</li>
            <li>Add an account manually using the secret below. Choose a time-based code if prompted.</li>
            <li>Enter the current 6-digit code from that app when signing in.</li>
          </ol>
          <p className="totp-secret"><strong>Setup key:</strong> <code>{totpSecret}</code></p>
          <button type="button" className="secondary copy-secret" onClick={copyTotpSecret}>
            Copy setup key
          </button>
          <details>
            <summary>Advanced setup</summary>
            <p>Authenticator setup URI: <code className="totp-uri">{otpUri}</code></p>
          </details>
          <p className="totp-warning">Keep this setup key private. Anyone with it can generate your sign-in codes.</p>
        </div>
      )}

      {message && <p role="status" aria-live="polite">{message}</p>}
      <button type="button" className="link-button" onClick={() => setIsRegistering((current) => !current)}>
        {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
      </button>
    </div>
  )
}

export default Login
