function SidebarNav({
  role,
  activeSection,
  isOpen,
  collapsed,
  notificationCount,
  onNavigate,
  onLogout,
  onToggleCollapse
}) {
  const isCustomer = role === 'CUSTOMER'
  const isAdministrator = role === 'ADMINISTRATOR'
  const isStaff = ['SUPPORT', 'MANAGER', 'ADMINISTRATOR'].includes(role)
  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
    { id: 'complaints', label: isCustomer ? 'My complaints' : 'Complaint queue', icon: '▤' },
    ...(isStaff ? [{ id: 'reports', label: 'Reports', icon: '▥' }] : []),
    { id: 'notifications', label: 'Notifications', icon: '♧', badge: notificationCount },
    ...(isAdministrator ? [{ id: 'accounts', label: 'Manage accounts', icon: '♙' }] : []),
    { id: 'profile', label: 'Profile', icon: '●' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
  ]

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation menu"
          onClick={() => onNavigate(activeSection)}
        />
      )}
      <aside
        id="dashboard-navigation"
        className={`sidebar-nav${isOpen ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-heading">
          <p className="sidebar-label">MENU</p>
          <button
            type="button"
            className="sidebar-mobile-close"
            aria-label="Close navigation menu"
            onClick={() => onNavigate(activeSection)}
          >
            <span aria-hidden="true">×</span>
          </button>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-label={collapsed ? 'Expand navigation menu' : 'Collapse navigation menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand navigation menu' : 'Collapse navigation menu'}
            onClick={onToggleCollapse}
          >
            <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
          </button>
        </div>
        <nav>
          {navigationItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-link${activeSection === item.id ? ' is-active' : ''}`}
              aria-current={activeSection === item.id ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              onClick={() => onNavigate(item.id)}
            >
              <span className="sidebar-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge > 0 && <span className="sidebar-badge" aria-label={`${item.badge} unread`}>{item.badge}</span>}
            </button>
          ))}
          {isCustomer && (
            <button
              type="button"
              className="sidebar-link sidebar-link-primary"
              aria-label="New complaint"
              title="New complaint"
              onClick={() => onNavigate('new-complaint')}
            >
              <span className="sidebar-icon" aria-hidden="true">＋</span>
              <span>New complaint</span>
            </button>
          )}
        </nav>
        <div className="sidebar-note" title={isCustomer ? 'Submit a complaint and follow its progress here.' : 'Review and resolve customer complaints.'}>
          <strong>{isCustomer ? 'Need help?' : 'Team workspace'}</strong>
          <span>{isCustomer ? 'Submit a complaint and follow its progress here.' : 'Review and resolve customer complaints.'}</span>
        </div>
        <button type="button" className="sidebar-link sidebar-logout" onClick={onLogout}>
          <span className="sidebar-icon" aria-hidden="true">↪</span>
          <span>Log out</span>
        </button>
      </aside>
    </>
  )
}

export default SidebarNav
