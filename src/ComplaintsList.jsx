import { useMemo, useState } from 'react'

const API_BASE = 'http://localhost:5000'
const staffRoles = new Set(['SUPPORT', 'MANAGER', 'ADMINISTRATOR'])
const statuses = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed']

function csvCell(value) {
  const text = String(value ?? '')
  const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function ComplaintsList({
  token,
  user,
  complaints,
  isLoading,
  error,
  onRefresh,
  onComplaintUpdated,
  onCreateComplaint
}) {
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [priorityFilter, setPriorityFilter] = useState('All priorities')
  const [sortOrder, setSortOrder] = useState('Newest first')
  const [statusDrafts, setStatusDrafts] = useState({})
  const [staffResponses, setStaffResponses] = useState({})
  const [resolutions, setResolutions] = useState({})
  const [updatingId, setUpdatingId] = useState(null)

  const isStaff = Boolean(user && staffRoles.has(user.role))

  const statusDraftFor = (complaint) => statusDrafts[complaint.id] ?? complaint.status
  const staffResponseFor = (complaint) => staffResponses[complaint.id] ?? complaint.staff_response ?? ''
  const resolutionFor = (complaint) => resolutions[complaint.id] ?? complaint.resolution ?? ''

  const summary = useMemo(() => ({
    total: complaints.length,
    pending: complaints.filter((complaint) => ['Pending', 'Under Review'].includes(complaint.status)).length,
    inProgress: complaints.filter((complaint) => ['Assigned', 'In Progress'].includes(complaint.status)).length,
    resolved: complaints.filter((complaint) => ['Resolved', 'Closed'].includes(complaint.status)).length
  }), [complaints])

  const filteredComplaints = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return complaints
      .filter((complaint) => {
        const searchableText = [
          complaint.id,
          complaint.subject,
          complaint.customer_name,
          complaint.customer_email,
          complaint.category,
          complaint.description
        ].join(' ').toLowerCase()

        return (!normalizedQuery || searchableText.includes(normalizedQuery))
          && (statusFilter === 'All statuses' || complaint.status === statusFilter)
          && (priorityFilter === 'All priorities' || complaint.priority === priorityFilter)
      })
      .sort((a, b) => {
        const difference = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        return sortOrder === 'Newest first' ? difference : -difference
      })
  }, [complaints, priorityFilter, query, sortOrder, statusFilter])

  function downloadCsv() {
    const columns = [
      ['Complaint ID', 'id'],
      ['Subject', 'subject'],
      ['Customer', 'customer_name'],
      ['Email', 'customer_email'],
      ['Category', 'category'],
      ['Priority', 'priority'],
      ['Status', 'status'],
      ['Description', 'description'],
      ['Resolution', 'resolution'],
      ['Submitted', 'created_at']
    ]
    const rows = [
      columns.map(([label]) => csvCell(label)).join(','),
      ...filteredComplaints.map((complaint) =>
        columns.map(([, field]) => csvCell(complaint[field])).join(',')
      )
    ]
    const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const downloadLink = document.createElement('a')
    downloadLink.href = url
    downloadLink.download = 'complaints.csv'
    document.body.append(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    URL.revokeObjectURL(url)
  }

  async function handleStatusUpdate(complaintId) {
    const payload = {
      status: statusDrafts[complaintId] || complaints.find((complaint) => complaint.id === complaintId)?.status || 'Pending',
      staff_response: staffResponses[complaintId] ?? complaints.find((complaint) => complaint.id === complaintId)?.staff_response ?? '',
      resolution: resolutions[complaintId] ?? complaints.find((complaint) => complaint.id === complaintId)?.resolution ?? ''
    }

    setUpdatingId(complaintId)
    setMessage('')

    try {
      const response = await fetch(`${API_BASE}/complaints/${complaintId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': token
        },
        body: JSON.stringify(payload)
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Failed to update complaint status.')
      }

      onComplaintUpdated(data.complaint)
      setMessage('Complaint updated successfully.')
    } catch (error) {
      setMessage(error.message || 'Could not update complaint.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="complaints-dashboard">
      <div className="stats-grid" aria-label="Complaint summary">
        <article className="stat-card stat-total">
          <span className="stat-icon" aria-hidden="true">▤</span>
          <span className="stat-label">Total complaints</span>
          <strong>{summary.total}</strong>
          <small>Visible to your account</small>
        </article>
        <article className="stat-card stat-pending">
          <span className="stat-icon" aria-hidden="true">◷</span>
          <span className="stat-label">Awaiting review</span>
          <strong>{summary.pending}</strong>
          <small>Pending or under review</small>
        </article>
        <article className="stat-card stat-progress">
          <span className="stat-icon" aria-hidden="true">↗</span>
          <span className="stat-label">In progress</span>
          <strong>{summary.inProgress}</strong>
          <small>Assigned or being handled</small>
        </article>
        <article className="stat-card stat-resolved">
          <span className="stat-icon" aria-hidden="true">✓</span>
          <span className="stat-label">Resolved</span>
          <strong>{summary.resolved}</strong>
          <small>Resolved or closed</small>
        </article>
      </div>

      <section className="complaints-list">
        <div className="complaints-toolbar">
          <div className="list-heading">
            <h2>{isStaff ? 'Manage complaints' : 'Your complaints'}</h2>
            <p>{filteredComplaints.length} of {complaints.length} requests</p>
          </div>
          <div className="toolbar-actions">
            {isStaff && (
              <button type="button" className="outline-button" onClick={downloadCsv} disabled={!filteredComplaints.length}>
                Export CSV
              </button>
            )}
            <button type="button" className="outline-button" onClick={() => {
              setMessage('')
              onRefresh()
            }} disabled={isLoading}>
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            {!isStaff && (
              <button type="button" onClick={onCreateComplaint}>New complaint</button>
            )}
          </div>
        </div>

        <div className="complaint-filters" aria-label="Filter complaints">
          <label className="search-field">
            <span className="sr-only">Search complaints</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search subject, category, or ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option>All statuses</option>
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by priority</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option>All priorities</option>
              {['Low', 'Medium', 'High', 'Urgent'].map((priority) => <option key={priority}>{priority}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Sort complaints</span>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option>Newest first</option>
              <option>Oldest first</option>
            </select>
          </label>
        </div>

        {error && <p className="dashboard-error" role="alert">{error}</p>}
        {message && <p className="inline-message" role="status">{message}</p>}
        {isLoading && <p className="empty-state" role="status">Loading complaints…</p>}
        {!isLoading && !error && !message && filteredComplaints.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">◇</span>
            <h3>{complaints.length ? 'No matching complaints' : 'Nothing here yet'}</h3>
            <p>
              {complaints.length
                ? 'Try adjusting the search or filters.'
                : 'Once you submit a request, its progress will appear here.'}
            </p>
            {!isStaff && complaints.length === 0 && (
              <button type="button" onClick={onCreateComplaint}>Submit your first complaint</button>
            )}
          </div>
        )}

        <div className="complaint-results">
          {filteredComplaints.map((complaint) => (
            <article className="complaint-card" key={complaint.id}>
              <div className="complaint-card-header">
                <div className="complaint-title">
                  <span className="category-label">{complaint.category || 'General'}</span>
                  <h3>{complaint.subject}</h3>
                </div>
                <span className={`status-pill status-${(complaint.status || 'pending').toLowerCase().replaceAll(' ', '-')}`}>
                  {complaint.status}
                </span>
              </div>
              <div className="complaint-meta">
                <span>{isStaff ? complaint.customer_name : `ID ${complaint.id.slice(0, 8)}`}</span>
                <span>{new Date(complaint.created_at).toLocaleDateString()}</span>
                <span className={`priority-label priority-${(complaint.priority || 'medium').toLowerCase()}`}>
                  {complaint.priority || 'Medium'} priority
                </span>
              </div>
              <p className="complaint-description">{complaint.description}</p>
              {complaint.staff_response && (
                <p className="response-note"><strong>Support response:</strong> {complaint.staff_response}</p>
              )}
              {complaint.resolution && (
                <p className="resolution-note"><strong>Resolution:</strong> {complaint.resolution}</p>
              )}

              {isStaff && (
                <details className="status-editor">
                  <summary>Update this complaint</summary>
                  <div className="status-editor-fields">
                    <label htmlFor={`status-${complaint.id}`}>Status</label>
                    <select
                      id={`status-${complaint.id}`}
                      value={statusDraftFor(complaint)}
                      onChange={(event) => setStatusDrafts((current) => ({
                        ...current,
                        [complaint.id]: event.target.value
                      }))}
                    >
                      {statuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <label htmlFor={`staff-response-${complaint.id}`}>Staff response</label>
                    <textarea
                      id={`staff-response-${complaint.id}`}
                      rows="3"
                      value={staffResponseFor(complaint)}
                      onChange={(event) => setStaffResponses((current) => ({
                        ...current,
                        [complaint.id]: event.target.value
                      }))}
                    />
                    <label htmlFor={`resolution-${complaint.id}`}>Resolution notes</label>
                    <textarea
                      id={`resolution-${complaint.id}`}
                      rows="3"
                      value={resolutionFor(complaint)}
                      onChange={(event) => setResolutions((current) => ({
                        ...current,
                        [complaint.id]: event.target.value
                      }))}
                    />
                    <button type="button" onClick={() => handleStatusUpdate(complaint.id)} disabled={updatingId === complaint.id}>
                      {updatingId === complaint.id ? 'Saving…' : 'Save update'}
                    </button>
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default ComplaintsList
