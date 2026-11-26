
import { useState } from 'react'

const API_BASE = 'http://localhost:5000'

function ComplaintForm({ token, user }) {
  const [formData, setFormData] = useState({
    customer_name: user?.name || '',
    customer_email: user?.email || '',
    subject: '',
    description: '',
    category: 'General',
    priority: 'Medium'
  })

  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange(event) {
    const { name, value } = event.target

    setFormData({
      ...formData,
      [name]: value
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE}/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {})
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Could not submit complaint.')
      }

      setMessage('Complaint submitted successfully! Your complaint ID is ' + data.complaint.id + '.')

      setFormData({
        customer_name: user?.name || '',
        customer_email: user?.email || '',
        subject: '',
        description: '',
        category: 'General',
        priority: 'Medium'
      })
    } catch (error) {
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="complaint-form card">
      <h2>Submit a Complaint</h2>
      <p>Please provide your details and explain your complaint.</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="customer_name">Full Name</label>
        <input
          id="customer_name"
          name="customer_name"
          value={formData.customer_name}
          readOnly
          required
        />

        <label htmlFor="customer_email">Email Address</label>
        <input
          id="customer_email"
          name="customer_email"
          type="email"
          value={formData.customer_email}
          readOnly
          required
        />

        <label htmlFor="subject">Complaint Subject</label>
        <input
          id="subject"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          required
        />

        <label htmlFor="category">Category</label>
        <select id="category" name="category" value={formData.category} onChange={handleChange}>
          <option>General</option>
          <option>Billing</option>
          <option>Service</option>
          <option>Product</option>
          <option>Technical</option>
        </select>

        <label htmlFor="priority">Priority</label>
        <select id="priority" name="priority" value={formData.priority} onChange={handleChange}>
          <option>Low</option>
          <option>Medium</option>
          <option>High</option>
          <option>Urgent</option>
        </select>

        <label htmlFor="description">Complaint Description</label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows="5"
          required
        />

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Submit Complaint'}
        </button>
      </form>

      {message && <p role="status">{message}</p>}
    </div>
  )
}

export default ComplaintForm
