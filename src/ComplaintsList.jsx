
import { useEffect, useState } from 'react'

const API_BASE = 'http://localhost:5000'
const staffRoles = new Set(['SUPPORT', 'MANAGER', 'ADMINISTRATOR'])

function ComplaintsList({ token, user }) {
  const [complaints, setComplaints] = useState([])
  const [message, setMessage] = useState('Loading complaints...')
  const [statusDrafts, setStatusDrafts] = useState({})
  const [staffResponses, setStaffResponses] = useState({})
  const [resolutions, setResolutions] = useState({})
  const [updatingId, setUpdatingId] = useState(null)

  const isStaff = Boolean(user && staffRoles.has(user.role))

  useEffect(() => {
    fetch(`${API_BASE}/complaints`, {
      headers: token ? { 'x-session-token': token } : {}
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to retrieve complaints')
        }
        return response.json()
      })
      .then((data) => {
        setComplaints(data.complaints || [])
        const nextStatusDrafts = {}
        const nextStaffResponses = {}
        const nextResolutions = {}

        ;(data.complaints || []).forEach((complaint) => {
          nextStatusDrafts[complaint.id] = complaint.status
          nextStaffResponses[complaint.id] = complaint.staff_response || ''
          nextResolutions[complaint.id] = complaint.resolution || ''
        })

        setStatusDrafts(nextStatusDrafts)
        setStaffResponses(nextStaffResponses)
        setResolutions(nextResolutions)
        setMessage('')
      })
      .catch(() => {
        setMessage('Could not load complaints. Please try again.')
      })
  }, [token, user])

  async function handleStatusUpdate(complaintId) {
    const payload = {
      status: statusDrafts[complaintId] || 'Pending',
      staff_response: staffResponses[complaintId] || '',
      resolution: resolutions[complaintId] || ''
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

      setComplaints((currentComplaints) => currentComplaints.map((complaint) =>
        complaint.id === complaintId ? data.complaint : complaint
      ))
      setMessage('Complaint updated successfully.')
    } catch (error) {
      setMessage(error.message || 'Could not update complaint.')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="complaints-list card">
      <h2>Submitted Complaints</h2>

      {message && <p>{message}</p>}

      {complaints.map((complaint) => (
        <div className="complaint-card" key={complaint.id}>
          <h3>{complaint.subject}</h3>
          <p><strong>Complaint ID:</strong> {complaint.id}</p>
          <p><strong>Customer:</strong> {complaint.customer_name}</p>
          <p><strong>Email:</strong> {complaint.customer_email}</p>
          <p><strong>Category:</strong> {complaint.category || 'General'}</p>
          <p><strong>Priority:</strong> {complaint.priority || 'Medium'}</p>
          <p><strong>Description:</strong> {complaint.description}</p>
          <p><strong>Status:</strong> {complaint.status}</p>
          <p><strong>Resolution:</strong> {complaint.resolution || 'Pending review'}</p>
          <p>
            <strong>Date submitted:</strong>{' '}
            {new Date(complaint.created_at).toLocaleString()}
          </p>

          {isStaff && (
            <div className="status-editor">
              <label htmlFor={`status-${complaint.id}`}>Update status</label>
              <select
                id={`status-${complaint.id}`}
                value={statusDrafts[complaint.id] || complaint.status}
                onChange={(event) => setStatusDrafts((current) => ({
                  ...current,
                  [complaint.id]: event.target.value
                }))}
              >
                <option value="Pending">Pending</option>
                <option value="Under Review">Under Review</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>

              <label htmlFor={`staff-response-${complaint.id}`}>Staff response</label>
              <textarea
                id={`staff-response-${complaint.id}`}
                rows="3"
                value={staffResponses[complaint.id] || ''}
                onChange={(event) => setStaffResponses((current) => ({
                  ...current,
                  [complaint.id]: event.target.value
                }))}
              />

              <label htmlFor={`resolution-${complaint.id}`}>Resolution</label>
              <textarea
                id={`resolution-${complaint.id}`}
                rows="3"
                value={resolutions[complaint.id] || ''}
                onChange={(event) => setResolutions((current) => ({
                  ...current,
                  [complaint.id]: event.target.value
                }))}
              />

              <button type="button" onClick={() => handleStatusUpdate(complaint.id)} disabled={updatingId === complaint.id}>
                {updatingId === complaint.id ? 'Saving...' : 'Save update'}
              </button>
            </div>
          )}
        </div>
      ))}

      {!message && complaints.length === 0 && (
        <p>No complaints match your current access level.</p>
      )}
    </div>
  )
}

export default ComplaintsList
