
import { useState } from 'react'

const API_BASE = 'http://localhost:5000'

function Login({ onAuthenticated, onBack, recoveryToken }) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [isRequestingReset, setIsRequestingReset] = useState(false)
  const [activeRecoveryToken, setActiveRecoveryToken] = useState(recoveryToken || '')
  const [resetComplete, setResetComplete] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [message, setMessage] = useState('')
  const [recoveryUrl, setRecoveryUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [otpUri, setOtpUri] = useState('')
  const isCompletingReset = Boolean(activeRecoveryToken) && !resetComplete

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
      let endpoint
      let payload

      if (isRequestingReset) {
        endpoint = `${API_BASE}/api/password-reset/request`
        payload = { email }
      } else if (isCompletingReset) {
        if (newPassword !== confirmPassword) {
          throw new Error('The new passwords do not match.')
        }
        endpoint = `${API_BASE}/api/password-reset/complete`
        payload = { token: activeRecoveryToken, password: newPassword }
      } else {
        endpoint = isRegistering ? `${API_BASE}/api/register` : `${API_BASE}/api/login`
        payload = isRegistering
          ? { fullName, email, password }
          : { email, password, otp }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const responseBody = await response.text()
      let data
      try {
        data = responseBody ? JSON.parse(responseBody) : {}
      } catch {
        if (responseBody.trimStart().startsWith('<')) {
          throw new Error('The backend returned an HTML page instead of API data. Restart the backend so the latest account recovery endpoints are loaded.')
        }
        throw new Error('The backend returned an invalid response. Please check that it is running and try again.')
      }

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed.')
      }

      if (isRequestingReset) {
        setRecoveryUrl(data.recoveryUrl || '')
        setMessage(data.message)
        return
      }

      if (isCompletingReset) {
        setTotpSecret(data.totpSecret)
        setOtpUri(data.otpUri)
        setResetComplete(true)
        setActiveRecoveryToken('')
        setMessage(data.message)
        setNewPassword('')
        setConfirmPassword('')
        window.history.replaceState({}, document.title, window.location.pathname)
        return
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
      <h2>
        {resetComplete
          ? 'Account recovered'
          : isCompletingReset
            ? 'Reset password'
            : isRequestingReset
              ? 'Recover your account'
              : isRegistering
                ? 'Create account'
                : 'Sign in'}
      </h2>
      <p>
        {resetComplete
          ? 'Save your new authenticator key before signing in.'
          : isCompletingReset
            ? 'Choose a new password. You will also set up a new authenticator key.'
            : isRequestingReset
              ? 'Enter your account email and we will send a recovery link if it matches an account.'
              : isRegistering
                ? 'Register a new customer account and set up TOTP.'
                : 'Customers, managers, and administrators sign in here with their email, password, and OTP.'}
      </p>

      {!resetComplete && (
        <form onSubmit={handleSubmit}>
          {isCompletingReset ? (
            <>
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength="12"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength="12"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </>
          ) : (
            <>
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
                </>
              )}

              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email"
                required
              />

              {!isRequestingReset && (
                <>
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                    minLength={isRegistering ? 12 : undefined}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    required
                  />
                </>
              )}

              {!isRegistering && !isRequestingReset && (
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
            </>
          )}

          <div className="button-row">
            <button type="submit">
              {isCompletingReset
                ? 'Reset password and authenticator'
                : isRequestingReset
                  ? 'Send recovery link'
                  : isRegistering
                    ? 'Register'
                    : 'Sign In'}
            </button>
            <button type="button" className="secondary" onClick={onBack}>Back</button>
          </div>
        </form>
      )}

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
      {recoveryUrl && (
        <p role="status">
          Local testing only: <a href={recoveryUrl}>Open the recovery link</a>. Never enable this mode outside local development.
        </p>
      )}
      {!isCompletingReset && !resetComplete && (
        <>
          {!isRegistering && !isRequestingReset && (
            <button type="button" className="link-button" onClick={() => setIsRequestingReset(true)}>
              Forgot password or authenticator?
            </button>
          )}
          {isRequestingReset && (
            <button type="button" className="link-button" onClick={() => {
              setIsRequestingReset(false)
              setMessage('')
            }}>
              Back to sign in
            </button>
          )}
          {!isRequestingReset && (
            <button type="button" className="link-button" onClick={() => setIsRegistering((current) => !current)}>
              {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
            </button>
          )}
        </>
      )}
      {resetComplete && (
        <button type="button" className="link-button" onClick={() => {
          setResetComplete(false)
          setTotpSecret('')
          setOtpUri('')
          setMessage('')
        }}>
          Continue to sign in
        </button>
      )}
    </div>
  )
}

export default Login
