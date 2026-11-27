
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const storage = require('./db')

const allowedStatuses = ['Pending', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed']
const staffRoles = new Set(['SUPPORT', 'MANAGER', 'ADMINISTRATOR'])
const allowedCategories = ['General', 'Billing', 'Service', 'Product', 'Technical']
const allowedPriorities = ['Low', 'Medium', 'High', 'Urgent']

const normalizeStatus = (status) => {
  return allowedStatuses.includes(status) ? status : 'Pending'
}

const canViewComplaint = (user, complaint) => {
  if (!user) return false
  if (staffRoles.has(user.role)) return true
  return complaint.customer_id
    ? complaint.customer_id === user.id
    : complaint.customer_email === user.email
}

router.post('/', async (req, res) => {
  if (!req.user || req.user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only signed-in customers can submit complaints.' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const category = body.category || 'General'
  const priority = body.priority || 'Medium'
  if (!subject || subject.length > 200 || !description || description.length > 5000) {
    return res.status(400).json({ message: 'Enter a subject (up to 200 characters) and description (up to 5,000 characters).' })
  }
  if (!allowedCategories.includes(category) || !allowedPriorities.includes(priority)) {
    return res.status(400).json({ message: 'Choose a valid complaint category and priority.' })
  }

  const now = new Date().toISOString()
  const complaint = {
    id: crypto.randomUUID(),
    customer_id: req.user.id,
    customer_name: req.user.name,
    customer_email: req.user.email,
    subject,
    description,
    category,
    priority,
    status: 'Pending',
    assigned_staff: null,
    staff_response: '',
    resolution: '',
    created_at: now,
    updated_at: now,
    resolved_at: null
  }

  const savedComplaint = await storage.createComplaint(complaint)

  res.status(201).json({
    message: 'Complaint submitted successfully!',
    complaint: savedComplaint
  })
})

router.get('/', async (req, res) => {
  const complaints = await storage.listComplaints()
  const visibleComplaints = complaints
    .filter((complaint) => canViewComplaint(req.user, complaint))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  res.json({
    message: 'Complaints retrieved successfully!',
    complaints: visibleComplaints
  })
})

router.get('/:id', async (req, res) => {
  const complaint = await storage.findComplaintById(req.params.id)
  if (!complaint) {
    return res.status(404).json({ message: 'Complaint not found.' })
  }

  if (!canViewComplaint(req.user, complaint)) {
    return res.status(403).json({ message: 'You do not have permission to view this complaint.' })
  }

  res.json({ complaint })
})

router.patch('/:id/status', async (req, res) => {
  const { status, staff_response, resolution, assigned_staff } = req.body
  const complaint = await storage.findComplaintById(req.params.id)

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

  const savedComplaint = await storage.updateComplaint(complaint)
  res.json({ message: 'Complaint status updated successfully.', complaint: savedComplaint })
})

module.exports = router
