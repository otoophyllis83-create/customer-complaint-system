import { useEffect, useState } from 'react'
import Login from './Login'
import ComplaintForm from './ComplaintForm'
import ComplaintsList from './ComplaintsList'
import AdminUserForm from './AdminUserForm'
import SidebarNav from './SidebarNav'
import './App.css'

const API_BASE = 'http://localhost:5000'
const staffRoles = new Set(['SUPPORT', 'MANAGER', 'ADMINISTRATOR'])

function App() {
  const [session, setSession] = useState(() => {
    const storedSession = localStorage.getItem('complaint-session')
    return storedSession ? JSON.parse(storedSession) : null
  })
  const [view, setView] = useState(() => (
    new URLSearchParams(window.location.search).has('resetToken') ? 'login' : 'welcome'
  ))
  const [activeSection, setActiveSection] = useState('dashboard')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => (
    localStorage.getItem('complaint-sidebar-collapsed') === 'true'
  ))
  const [notificationBadgesEnabled, setNotificationBadgesEnabled] = useState(() => (
    session?.user?.id
      ? localStorage.getItem(`complaint-notification-preferences-${session.user.id}`) !== 'false'
      : true
  ))
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    if (!session?.user?.id) return {}
    try {
      const savedReadIds = JSON.parse(localStorage.getItem(`complaint-notifications-read-${session.user.id}`) || '[]')
      return {
        [session.user.id]: Array.isArray(savedReadIds) ? savedReadIds : []
      }
    } catch {
      return { [session.user.id]: [] }
    }
  })
  const [complaints, setComplaints] = useState([])
  const [complaintsLoading, setComplaintsLoading] = useState(() => Boolean(session?.token))
  const [complaintsError, setComplaintsError] = useState('')
  const [complaintsRefresh, setComplaintsRefresh] = useState(0)
  const [serverMessage, setServerMessage] = useState('Connecting to backend...')
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [backupFile, setBackupFile] = useState(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [authNotice, setAuthNotice] = useState('')
  const recoveryToken = new URLSearchParams(window.location.search).get('resetToken')

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then((response) => response.json())
      .then((data) => setServerMessage(data.message))
      .catch(() => setServerMessage('Could not connect to backend.'))
  }, [])

  useEffect(() => {
    if (!session?.token) {
      return undefined
    }

    const controller = new AbortController()

    fetch(`${API_BASE}/complaints`, {
      headers: { 'x-session-token': session.token },
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.message || 'Could not load complaints.')
        }
        return data
      })
      .then((data) => setComplaints(data.complaints || []))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setComplaintsError(error.message || 'Could not load complaints.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setComplaintsLoading(false)
        }
      })

    return () => controller.abort()
  }, [session?.token, complaintsRefresh])

  const handleAuthenticated = (userSession) => {
    setAuthNotice('')
    localStorage.setItem('complaint-session', JSON.stringify(userSession))
    setSession(userSession)
    setView('dashboard')
    setActiveSection('dashboard')
    setComplaintsLoading(true)
    setComplaintsError('')
    const userId = userSession.user.id
    setNotificationBadgesEnabled(localStorage.getItem(`complaint-notification-preferences-${userId}`) !== 'false')
    try {
      const savedReadIds = JSON.parse(localStorage.getItem(`complaint-notifications-read-${userId}`) || '[]')
      setReadNotificationIds((current) => ({
        ...current,
        [userId]: Array.isArray(savedReadIds) ? savedReadIds : []
      }))
    } catch {
      setReadNotificationIds((current) => ({ ...current, [userId]: [] }))
    }
  }

  const handleComplaintUpdated = (updatedComplaint) => {
    setComplaints((current) => current.map((complaint) => (
      complaint.id === updatedComplaint.id ? updatedComplaint : complaint
    )))
  }

  const refreshComplaints = () => {
    setComplaintsLoading(true)
    setComplaintsError('')
    setComplaintsRefresh((count) => count + 1)
  }

  const handleNavigation = (destination) => {
    setIsSidebarOpen(false)
    if (destination === 'new-complaint') {
      setView('complaint-form')
      return
    }

    setView('dashboard')
    setActiveSection(destination)
  }

  const handleLogout = async () => {
    if (!session?.token) {
      localStorage.removeItem('complaint-session')
      setSession(null)
      setComplaints([])
      setComplaintsLoading(false)
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
      setComplaints([])
      setComplaintsLoading(false)
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
          {authNotice && <p className="restore-notice" role="status">{authNotice}</p>}
          <Login
            recoveryToken={recoveryToken}
            onAuthenticated={handleAuthenticated}
            onBack={() => setView('welcome')}
          />
        </main>
      </div>
    )
  }

  if (view === 'complaint-form' && !session) {
    return (
      <div className="app-shell">
        <header className="header">
          <h1>Customer Complaint System</h1>
        </header>
        <main className="main-panel narrow">
          <section className="welcome-card card">
            <h2>Sign in to submit a complaint</h2>
            <p>You need a customer account to submit and track a complaint.</p>
            <button onClick={() => setView('login')}>Sign in or register</button>
            <button className="secondary" onClick={() => setView('welcome')}>Back</button>
          </section>
        </main>
      </div>
    )
  }

  if (view === 'complaint-form' && session.user.role !== 'CUSTOMER') {
    return (
      <div className="app-shell">
        <header className="header">
          <h1>Customer Complaint System</h1>
        </header>
        <main className="main-panel narrow">
          <section className="welcome-card card">
            <h2>Complaint submission unavailable</h2>
            <p>Staff accounts manage complaints and cannot submit customer complaints.</p>
            <button className="secondary" onClick={() => setView('dashboard')}>Back to dashboard</button>
          </section>
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
    const isCustomer = session.user.role === 'CUSTOMER'
    const isAdministrator = session.user.role === 'ADMINISTRATOR'
    const isStaff = staffRoles.has(session.user.role)
    const userId = session.user.id
    const notifications = complaints
      .filter((complaint) => isStaff
        || complaint.status !== 'Pending'
        || complaint.staff_response
        || complaint.resolution)
      .map((complaint) => ({
        id: isStaff
          ? `${complaint.id}:${complaint.created_at}`
          : `${complaint.id}:${complaint.updated_at}:${complaint.status}`,
        title: isStaff ? 'New customer complaint' : `Complaint ${complaint.status.toLowerCase()}`,
        detail: isStaff
          ? `${complaint.subject} · ${complaint.customer_name}`
          : `${complaint.subject}${complaint.staff_response ? ` · ${complaint.staff_response}` : ''}`,
        createdAt: isStaff ? complaint.created_at : complaint.updated_at
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const userReadNotificationIds = readNotificationIds[userId] || []
    const unreadNotificationCount = notifications.filter((item) => !userReadNotificationIds.includes(item.id)).length

    const navigateToSection = (destination) => {
      if (destination === 'notifications') {
        const nextReadIds = [...new Set([...userReadNotificationIds, ...notifications.map((item) => item.id)])]
        setReadNotificationIds((current) => ({ ...current, [userId]: nextReadIds }))
        localStorage.setItem(`complaint-notifications-read-${userId}`, JSON.stringify(nextReadIds))
      }
      handleNavigation(destination)
    }

    const toggleSidebarCollapsed = () => {
      setIsSidebarCollapsed((current) => {
        const next = !current
        localStorage.setItem('complaint-sidebar-collapsed', String(next))
        return next
      })
    }

    const toggleNotificationBadges = (enabled) => {
      setNotificationBadgesEnabled(enabled)
      localStorage.setItem(`complaint-notification-preferences-${userId}`, String(enabled))
    }

    const handleCreateBackup = async (event) => {
      event.preventDefault()
      setBackupMessage('')
      setBackupBusy(true)
      try {
        const response = await fetch(`${API_BASE}/api/admin/backup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': session.token
          },
          body: JSON.stringify({ passphrase: backupPassphrase })
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.message || 'Could not create the backup.')
        }
        const blob = await response.blob()
        const downloadUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = `customer-complaint-backup-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(downloadUrl)
        setBackupMessage('Encrypted backup downloaded. Keep the passphrase separate from the backup file.')
        setBackupPassphrase('')
      } catch (error) {
        setBackupMessage(error.message || 'Could not create the backup.')
      } finally {
        setBackupBusy(false)
      }
    }

    const handleRestoreBackup = async (event) => {
      event.preventDefault()
      setBackupMessage('')
      if (!backupFile) {
        setBackupMessage('Choose an encrypted backup file first.')
        return
      }
      setBackupBusy(true)
      try {
        const backup = JSON.parse(await backupFile.text())
        const response = await fetch(`${API_BASE}/api/admin/restore`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': session.token
          },
          body: JSON.stringify({
            backup,
            passphrase: restorePassphrase,
            confirmation: restoreConfirmation
          })
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Could not restore the backup.')

        localStorage.removeItem('complaint-session')
        setSession(null)
        setComplaints([])
        setBackupMessage('')
        setRestorePassphrase('')
        setRestoreConfirmation('')
        setBackupFile(null)
        setAuthNotice(data.message)
        setView('login')
      } catch (error) {
        setBackupMessage(error instanceof SyntaxError
          ? 'The selected file is not valid JSON.'
          : error.message || 'Could not restore the backup.')
      } finally {
        setBackupBusy(false)
      }
    }

    const statusCounts = complaints.reduce((counts, complaint) => {
      counts[complaint.status] = (counts[complaint.status] || 0) + 1
      return counts
    }, {})
    const categoryCounts = complaints.reduce((counts, complaint) => {
      counts[complaint.category] = (counts[complaint.category] || 0) + 1
      return counts
    }, {})

    return (
      <div className="app-shell">
        <header className="header dashboard-header">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isSidebarOpen}
            aria-controls="dashboard-navigation"
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            <span aria-hidden="true">{isSidebarOpen ? '×' : '☰'}</span>
          </button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">CC</span>
            <span>
              <strong>Complaint Desk</strong>
              <small>Customer support portal</small>
            </span>
          </div>
          <div className="header-actions">
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {(session.user.name || session.user.email || 'U').charAt(0).toUpperCase()}
              </span>
              <span className="user-details">
                <strong>{session.user.name}</strong>
                <small className="role-badge">{session.user.role}</small>
              </span>
            </div>
          </div>
        </header>

        <div className={`dashboard-layout${isSidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
          <div className="dashboard-sidebar-container">
            <SidebarNav
              role={session.user.role}
              activeSection={activeSection}
              isOpen={isSidebarOpen}
              collapsed={isSidebarCollapsed}
              notificationCount={notificationBadgesEnabled ? unreadNotificationCount : 0}
              onNavigate={navigateToSection}
              onToggleCollapse={toggleSidebarCollapsed}
              onLogout={() => {
                setIsSidebarOpen(false)
                handleLogout()
              }}
            />
          </div>
          <main className="dashboard-main">
            {activeSection === 'dashboard' && (
              <>
                <section className="dashboard-welcome">
                  <div>
                    <p className="eyebrow">YOUR DASHBOARD</p>
                    <h1>Good to see you, {session.user.name?.split(' ')[0] || 'there'}.</h1>
                    <p>{isCustomer
                      ? 'Keep track of your requests and get the support you need.'
                      : 'Review incoming customer complaints and help resolve them.'}</p>
                  </div>
                  {isCustomer && (
                    <button className="new-complaint-button" onClick={() => handleNavigation('new-complaint')}>
                      <span aria-hidden="true">＋</span> New complaint
                    </button>
                  )}
                </section>

                <section className="account-strip" aria-label="Account details">
                  <div>
                    <span className="account-strip-label">Signed in as</span>
                    <strong>{session.user.email}</strong>
                  </div>
                  <span className="account-access">{session.user.role} access</span>
                </section>
              </>
            )}

            {activeSection === 'accounts' && isAdministrator && (
              <section aria-label="Account administration">
                <div className="section-heading">
                  <div>
                    <h2>Manage accounts</h2>
                    <p>Create Manager or Administrator accounts.</p>
                  </div>
                </div>
                <AdminUserForm token={session.token} />
              </section>
            )}

            {(activeSection === 'dashboard' || activeSection === 'complaints') && (
              <section aria-label="Complaint overview">
                {activeSection === 'complaints' && (
                  <div className="section-heading">
                    <div>
                      <h2>{isCustomer ? 'Your complaints' : 'Complaint queue'}</h2>
                      <p>{isCustomer
                        ? 'Track the status of complaints you submitted.'
                        : 'Review and update customer complaints.'}</p>
                    </div>
                  </div>
                )}
                <ComplaintsList
                  token={session.token}
                  user={session.user}
                  complaints={complaints}
                  isLoading={complaintsLoading}
                  error={complaintsError}
                  onRefresh={refreshComplaints}
                  onComplaintUpdated={handleComplaintUpdated}
                  onCreateComplaint={() => handleNavigation('new-complaint')}
                />
              </section>
            )}

            {activeSection === 'notifications' && (
              <section className="dashboard-page" aria-label="Notifications">
                <div className="section-heading">
                  <div>
                    <h2>Notifications</h2>
                    <p>{notifications.length
                      ? `${notifications.length} recent ${notifications.length === 1 ? 'update' : 'updates'} from your complaint activity.`
                      : 'Updates about your complaints will appear here.'}</p>
                  </div>
                </div>
                {complaintsError && <p className="dashboard-error" role="alert">{complaintsError}</p>}
                {complaintsLoading ? (
                  <p className="dashboard-empty">Loading notifications…</p>
                ) : notifications.length ? (
                  <div className="notification-list">
                    {notifications.map((notification) => (
                      <article className="notification-card" key={notification.id}>
                        <span className="notification-indicator" aria-hidden="true" />
                        <div>
                          <h3>{notification.title}</h3>
                          <p>{notification.detail}</p>
                          <time dateTime={notification.createdAt}>
                            {new Date(notification.createdAt).toLocaleString()}
                          </time>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="dashboard-empty">No complaint updates yet.</p>
                )}
              </section>
            )}

            {activeSection === 'reports' && isStaff && (
              <section className="dashboard-page" aria-label="Complaint reports">
                <div className="section-heading">
                  <div>
                    <h2>Complaint reports</h2>
                    <p>Live summary of complaints visible to your staff role.</p>
                  </div>
                  <button type="button" className="outline-button"                   onClick={refreshComplaints}>
                    Refresh report
                  </button>
                </div>
                {complaintsError && <p className="dashboard-error" role="alert">{complaintsError}</p>}
                {complaintsLoading && <p className="dashboard-empty" role="status">Refreshing report data…</p>}
                <div className="report-grid">
                  <article className="report-card"><span>Total complaints</span><strong>{complaints.length}</strong></article>
                  <article className="report-card"><span>Awaiting review</span><strong>{(statusCounts.Pending || 0) + (statusCounts['Under Review'] || 0)}</strong></article>
                  <article className="report-card"><span>In progress</span><strong>{(statusCounts.Assigned || 0) + (statusCounts['In Progress'] || 0)}</strong></article>
                  <article className="report-card"><span>Resolved or closed</span><strong>{(statusCounts.Resolved || 0) + (statusCounts.Closed || 0)}</strong></article>
                </div>
                <div className="report-breakdown">
                  <h3>By status</h3>
                  {Object.entries(statusCounts).length ? Object.entries(statusCounts).map(([label, count]) => (
                    <div className="breakdown-row" key={label}><span>{label}</span><strong>{count}</strong></div>
                  )) : <p>No complaints to report yet.</p>}
                </div>
                <div className="report-breakdown">
                  <h3>By category</h3>
                  {Object.entries(categoryCounts).length ? Object.entries(categoryCounts).map(([label, count]) => (
                    <div className="breakdown-row" key={label}><span>{label}</span><strong>{count}</strong></div>
                  )) : <p>No categories to report yet.</p>}
                </div>
              </section>
            )}

            {activeSection === 'profile' && (
              <section className="dashboard-page" aria-label="Profile">
                <div className="section-heading">
                  <div>
                    <h2>Profile</h2>
                    <p>Your account identity and access level.</p>
                  </div>
                </div>
                <div className="profile-card">
                  <div className="profile-avatar" aria-hidden="true">
                    {(session.user.name || session.user.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <dl>
                    <div><dt>Name</dt><dd>{session.user.name || 'Not provided'}</dd></div>
                    <div><dt>Email</dt><dd>{session.user.email}</dd></div>
                    <div><dt>Role</dt><dd>{session.user.role}</dd></div>
                    <div><dt>Account created</dt><dd>{session.user.created_at ? new Date(session.user.created_at).toLocaleDateString() : 'Not available'}</dd></div>
                  </dl>
                </div>
              </section>
            )}

            {activeSection === 'settings' && (
              <section className="dashboard-page" aria-label="Settings">
                <div className="section-heading">
                  <div>
                    <h2>Settings</h2>
                    <p>Adjust your dashboard preferences and review account security.</p>
                  </div>
                </div>
                <div className="settings-card">
                  <label className="setting-row" htmlFor="notification-badges">
                    <span><strong>Notification badges</strong><small>Show unread activity count in the navigation menu.</small></span>
                    <input
                      id="notification-badges"
                      type="checkbox"
                      checked={notificationBadgesEnabled}
                      onChange={(event) => toggleNotificationBadges(event.target.checked)}
                    />
                  </label>
                  <label className="setting-row" htmlFor="collapsed-navigation">
                    <span><strong>Collapse navigation by default</strong><small>Keep the desktop sidebar compact between visits.</small></span>
                    <input
                      id="collapsed-navigation"
                      type="checkbox"
                      checked={isSidebarCollapsed}
                      onChange={toggleSidebarCollapsed}
                    />
                  </label>
                  <div className="security-note">
                    <strong>Sign-in protection</strong>
                    <p>Your account uses password verification and a time-based authenticator code. Contact an administrator if you need to recover account access.</p>
                  </div>
                  {isAdministrator && (
                    <section className="backup-tools" aria-labelledby="backup-heading">
                      <h3 id="backup-heading">Database backup and recovery</h3>
                      <p>Create an encrypted copy of all users, complaints, and audit history. Restore replaces current records and signs everyone out.</p>
                      <form className="backup-form" onSubmit={handleCreateBackup}>
                        <label htmlFor="backup-passphrase">Backup passphrase</label>
                        <input
                          id="backup-passphrase"
                          type="password"
                          minLength="12"
                          maxLength="1024"
                          autoComplete="new-password"
                          required
                          value={backupPassphrase}
                          onChange={(event) => setBackupPassphrase(event.target.value)}
                          placeholder="At least 12 characters"
                        />
                        <button type="submit" disabled={backupBusy}>
                          {backupBusy ? 'Working…' : 'Download encrypted backup'}
                        </button>
                      </form>
                      <form className="backup-form restore-form" onSubmit={handleRestoreBackup}>
                        <label htmlFor="restore-backup-file">Encrypted backup file</label>
                        <input
                          id="restore-backup-file"
                          type="file"
                          accept="application/json,.json"
                          required
                          onChange={(event) => setBackupFile(event.target.files?.[0] || null)}
                        />
                        <label htmlFor="restore-passphrase">Backup passphrase</label>
                        <input
                          id="restore-passphrase"
                          type="password"
                          minLength="12"
                          maxLength="1024"
                          autoComplete="current-password"
                          required
                          value={restorePassphrase}
                          onChange={(event) => setRestorePassphrase(event.target.value)}
                        />
                        <label htmlFor="restore-confirmation">Type RESTORE to replace existing data</label>
                        <input
                          id="restore-confirmation"
                          type="text"
                          required
                          value={restoreConfirmation}
                          onChange={(event) => setRestoreConfirmation(event.target.value)}
                        />
                        <button className="secondary" type="submit" disabled={backupBusy || restoreConfirmation !== 'RESTORE'}>
                          Restore backup
                        </button>
                      </form>
                      {backupMessage && <p className="form-message" role="status">{backupMessage}</p>}
                    </section>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>

        <footer className="footer dashboard-footer">
          <p>Complaint Desk · Secure customer complaint management</p>
        </footer>
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
            <button className="secondary" onClick={() => setView('login')}>Sign in to submit a complaint</button>
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
