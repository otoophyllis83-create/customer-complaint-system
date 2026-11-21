
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { memoryStore } = require('./db')

const allowedStatuses = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed']
const staffRoles = new Set(['SUPPORT', 'MANAGER', 'ADMINISTRATOR'])

const normalizeStatus = (status) => {
  return allowedStatuses.includes(status) ? status : 'Pending'
}

const canViewComplaint = (user, complaint) => {
  if (!user) return false
  if (staffRoles.has(user.role)) return true
  return complaint.customer_email === user.email
}

router.post('/', async (req, res) => {
  const { customer_name, customer_email, subject, description, category, priority } = req.body

  if (!customer_name || !customer_email || !subject || !description) {
    return res.status(400).json({ message: 'Please fill in all required fields.' })
  }

  const complaint = {
    id: crypto.randomUUID(),
    customer_name: String(customer_name).trim(),
    customer_email: String(customer_email).trim(),
    subject: String(subject).trim(),
    description: String(description).trim(),
    category: String(category || 'General').trim(),
    priority: String(priority || 'Medium').trim(),
    status: 'Pending',
    assigned_staff: null,
    staff_response: '',
    resolution: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolved_at: null
  }

  memoryStore.complaints.unshift(complaint)

  res.status(201).json({
    message: 'Complaint submitted successfully!',
    complaint
  })
})

router.get('/', async (req, res) => {
  const visibleComplaints = memoryStore.complaints
    .filter((complaint) => canViewComplaint(req.user, complaint))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  res.json({
    message: 'Complaints retrieved successfully!',
    complaints: visibleComplaints
  })
})

router.get('/:id', (req, res) => {
  const complaint = memoryStore.complaints.find((item) => item.id === req.params.id)
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' })
  }

  if (!canViewComplaint(req.user, complaint)) {
    return res.status(403).json({ message: 'You do not have permission to view this complaint.' })
  }

  res.json({ complaint })
})

router.patch('/:id/status', (req, res) => {
  const { status, staff_response, resolution, assigned_staff } = req.body
  const complaint = memoryStore.complaints.find((item) => item.id === req.params.id)

  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' })
  }

  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' })
  }

  if (!staffRoles.has(req.user.role)) {
    return res.status(403).json({ message: 'Only support staff can update complaint status.' })
  }

  complaint.status = normalizeStatus(status || complaint.status)
  if (assigned_staff !== undefined) {
    complaint.assigned_staff = String(assigned_staff).trim() || null
  }
  if (staff_response !== undefined && staff_response !== null) {
    complaint.staff_response = String(staff_response).trim()
  }
  if (resolution !== undefined && resolution !== null) {
    complaint.resolution = String(resolution).trim()
  }
  if (complaint.status === 'Resolved' || complaint.status === 'Closed') {
    complaint.resolved_at = complaint.resolved_at || new Date().toISOString()
  }
  complaint.updated_at = new Date().toISOString()

  res.json({ message: 'Complaint status updated successfully.', complaint })
})

module.exports = router
