import { useEffect, useState } from 'react'
import Login from './Login'
import ComplaintForm from './ComplaintForm'
import ComplaintsList from './ComplaintsList'
import './App.css'

const API_BASE = 'http://localhost:5000'

function App() {
  const [session, setSession] = useState(() => {
    const storedSession = localStorage.getItem('complaint-session')
    return storedSession ? JSON.parse(storedSession) : null
  })
  const [view, setView] = useState('welcome')
  const [serverMessage, setServerMessage] = useState('Connecting to backend...')

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then((response) => response.json())
      .then((data) => setServerMessage(data.message))
      .catch(() => setServerMessage('Could not connect to backend.'))
  }, [])

  const handleAuthenticated = (userSession) => {
    localStorage.setItem('complaint-session', JSON.stringify(userSession))
    setSession(userSession)
    setView('dashboard')
  }

  const handleLogout = async () => {
    if (!session?.token) {
      localStorage.removeItem('complaint-session')
      setSession(null)
      setView('welcome')
      return
    }

    try {
      await fetch(`${API_BASE}/api/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': session.token
        }
      })
    } catch (error) {
      console.error('Logout error', error)
    } finally {
      localStorage.removeItem('complaint-session')
      setSession(null)
      setView('welcome')
    }
  }

  if (view === 'login') {
    return (
      <div className="app-shell">
        <header className="header">
          <h1>Customer Complaint System</h1>
        </header>
        <main className="main-panel narrow">
          <Login onAuthenticated={handleAuthenticated} onBack={() => setView('welcome')} />
        </main>
      </div>
    )
  }

  if (view === 'complaint-form') {
    return (
      <div className="app-shell">
        <header className="header">
          <h1>Customer Complaint System</h1>
        </header>
        <main className="main-panel stack">
          <button className="secondary" onClick={() => setView(session ? 'dashboard' : 'welcome')}>
            Back
          </button>
          <ComplaintForm token={session?.token} user={session?.user} />
        </main>
      </div>
    )
  }

  if (session) {
    return (
      <div className="app-shell">
        <header className="header dashboard-header">
          <div>
            <h1>Customer Complaint System</h1>
            <p>Welcome back, {session.user.name}</p>
          </div>
          <div className="header-actions">
            <span className="role-badge">{session.user.role}</span>
            <button onClick={handleLogout}>Log out</button>
          </div>
        </header>

        <main className="main-panel">
          <div className="panel-grid">
            <section className="panel-card">
              <h2>Complaint actions</h2>
              <button onClick={() => setView('complaint-form')}>Submit complaint</button>
              <button className="secondary" onClick={() => setView('dashboard')}>Refresh view</button>
            </section>

            <section className="panel-card">
              <h2>Account</h2>
              <p><strong>Name:</strong> {session.user.name}</p>
              <p><strong>Email:</strong> {session.user.email}</p>
              <p><strong>Role:</strong> {session.user.role}</p>
            </section>
          </div>

          <ComplaintsList token={session.token} user={session.user} />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="header">
        <h1>Customer Complaint System</h1>
        <p>{serverMessage}</p>
      </header>

      <main className="main-panel">
        <div className="welcome-card">
          <h2>Welcome</h2>
          <p>
            Submit a complaint, track its progress, and receive support
            from our team.
          </p>
          <div className="button-row">
            <button onClick={() => setView('login')}>Get Started</button>
            <button className="secondary" onClick={() => setView('complaint-form')}>Submit a Complaint</button>
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>Secure Customer Complaint Management System</p>
      </footer>
    </div>
  )
}

export default App
