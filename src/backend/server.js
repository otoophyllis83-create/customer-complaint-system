
const express = require('express')

const app = express()
const PORT = 5000

// Allow the server to receive JSON data
app.use(express.json())

// Test route
app.get('/', (req, res) => {
  res.json({
    message: 'Secure Customer Complaint System backend is running!'
  })
})

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server running at http://localhost:${PORT}`)
})
