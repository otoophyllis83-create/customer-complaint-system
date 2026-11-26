const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const net = require('node:net')
const { once } = require('node:events')
const { test } = require('node:test')
const { authenticator } = require('otplib')

process.env.PEPPER = 'password-reset-test-pepper'
process.env.ADMIN_SETUP_KEY = 'test-admin-setup-key-with-adequate-entropy'

const { app, memoryStore, passwordResetTokens, sessions } = require('../server')

function createSmtpServer(messages) {
  return net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.write('220 local-test ESMTP\r\n')

    let input = ''
    let message = ''
    let receivingMessage = false
    let authLoginStep = 0

    socket.on('data', (chunk) => {
      input += chunk

      while (input.length) {
        if (receivingMessage) {
          const endOfMessage = input.indexOf('\r\n.\r\n')
          if (endOfMessage === -1) return

          message += input.slice(0, endOfMessage)
          input = input.slice(endOfMessage + 5)
          receivingMessage = false
          messages.push(message)
          message = ''
          socket.write('250 Message accepted\r\n')
          continue
        }

        const lineEnd = input.indexOf('\r\n')
        if (lineEnd === -1) return

        const line = input.slice(0, lineEnd)
        input = input.slice(lineEnd + 2)

        if (/^EHLO /i.test(line)) {
          socket.write('250-local-test\r\n250 AUTH PLAIN LOGIN\r\n')
        } else if (/^AUTH PLAIN /i.test(line)) {
          socket.write('235 Authentication successful\r\n')
        } else if (/^AUTH LOGIN/i.test(line)) {
          authLoginStep = 1
          socket.write('334 VXNlcm5hbWU6\r\n')
        } else if (authLoginStep === 1) {
          authLoginStep = 2
          socket.write('334 UGFzc3dvcmQ6\r\n')
        } else if (authLoginStep === 2) {
          authLoginStep = 0
          socket.write('235 Authentication successful\r\n')
        } else if (/^MAIL FROM:/i.test(line) || /^RCPT TO:/i.test(line)) {
          socket.write('250 OK\r\n')
        } else if (/^DATA$/i.test(line)) {
          receivingMessage = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (/^QUIT$/i.test(line)) {
          socket.end('221 Bye\r\n')
        } else {
          socket.write('250 OK\r\n')
        }
      }
    })
  })
}

test('role enforcement and email recovery protect customer and staff accounts', async () => {
  delete process.env.RECOVERY_EMAIL_MODE
  const smtpMessages = []
  const smtpServer = createSmtpServer(smtpMessages)
  smtpServer.listen(0, '127.0.0.1')
  await once(smtpServer, 'listening')

  Object.assign(process.env, {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtpServer.address().port),
    SMTP_SECURE: 'false',
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-password',
    SMTP_FROM: 'Customer Complaint System <noreply@example.test>',
    FRONTEND_URL: 'http://localhost:5173'
  })

  memoryStore.users.length = 0
  memoryStore.complaints.length = 0
  memoryStore.auditLogs.length = 0
  passwordResetTokens.clear()
  sessions.clear()

  const apiServer = app.listen(0, '127.0.0.1')
  await once(apiServer, 'listening')
  const apiBase = `http://127.0.0.1:${apiServer.address().port}`

  try {
    const email = 'recovery-test@example.test'
    const oldPassword = 'Old-Test-Password-123'
    const registrationResponse = await fetch(`${apiBase}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Recovery Test',
        email,
        password: oldPassword,
        role: 'ADMINISTRATOR'
      })
    })
    assert.equal(registrationResponse.status, 201)
    const registration = await registrationResponse.json()
    assert.equal(registration.user.role, 'CUSTOMER')

    const adminSetupResponse = await fetch(`${apiBase}/api/bootstrap-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'System Administrator',
        email: 'admin@example.test',
        password: 'Admin-Test-Password-123!',
        setupKey: 'incorrect-setup-key'
      })
    })
    assert.equal(adminSetupResponse.status, 403)

    const bootstrapResponse = await fetch(`${apiBase}/api/bootstrap-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'System Administrator',
        email: 'admin@example.test',
        password: 'Admin-Test-Password-123!',
        setupKey: process.env.ADMIN_SETUP_KEY
      })
    })
    assert.equal(bootstrapResponse.status, 201)
    const administrator = await bootstrapResponse.json()
    assert.equal(administrator.user.role, 'ADMINISTRATOR')

    const secondBootstrapResponse = await fetch(`${apiBase}/api/bootstrap-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Another Administrator',
        email: 'another-admin@example.test',
        password: 'Another-Admin-Password-123!',
        setupKey: process.env.ADMIN_SETUP_KEY
      })
    })
    assert.equal(secondBootstrapResponse.status, 403)

    const loginResponse = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: oldPassword,
        otp: authenticator.generate(registration.totpSecret)
      })
    })
    assert.equal(loginResponse.status, 200)
    const originalSession = await loginResponse.json()

    const unauthenticatedManagerResponse = await fetch(`${apiBase}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Unauthorized Manager',
        email: 'unauthorized-manager@example.test',
        password: 'Manager-Test-Password-123!'
      })
    })
    assert.equal(unauthenticatedManagerResponse.status, 401)

    const customerManagerResponse = await fetch(`${apiBase}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': originalSession.token
      },
      body: JSON.stringify({
        fullName: 'Unauthorized Manager',
        email: 'unauthorized-manager@example.test',
        password: 'Manager-Test-Password-123!'
      })
    })
    assert.equal(customerManagerResponse.status, 403)

    const adminLoginResponse = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: administrator.user.email,
        password: 'Admin-Test-Password-123!',
        otp: authenticator.generate(administrator.totpSecret)
      })
    })
    assert.equal(adminLoginResponse.status, 200)
    const adminSession = await adminLoginResponse.json()

    const managerResponse = await fetch(`${apiBase}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': adminSession.token
      },
      body: JSON.stringify({
        fullName: 'Created Manager',
        email: 'manager@example.test',
        password: 'Manager-Test-Password-123!',
        role: 'MANAGER'
      })
    })
    assert.equal(managerResponse.status, 201)
    const manager = await managerResponse.json()
    assert.equal(manager.user.role, 'MANAGER')
    assert.ok(manager.totpSecret)

    const secondAdministratorResponse = await fetch(`${apiBase}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': adminSession.token
      },
      body: JSON.stringify({
        fullName: 'Additional Administrator',
        email: 'additional-admin@example.test',
        password: 'Additional-Admin-Password-123!',
        role: 'ADMINISTRATOR'
      })
    })
    assert.equal(secondAdministratorResponse.status, 201)
    const additionalAdministrator = await secondAdministratorResponse.json()
    assert.equal(additionalAdministrator.user.role, 'ADMINISTRATOR')

    const additionalAdminLoginResponse = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: additionalAdministrator.user.email,
        password: 'Additional-Admin-Password-123!',
        otp: authenticator.generate(additionalAdministrator.totpSecret)
      })
    })
    assert.equal(additionalAdminLoginResponse.status, 200)

    const unsupportedRoleResponse = await fetch(`${apiBase}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': adminSession.token
      },
      body: JSON.stringify({
        fullName: 'Unsupported Role',
        email: 'unsupported-role@example.test',
        password: 'Unsupported-Role-Password-123!',
        role: 'SUPPORT'
      })
    })
    assert.equal(unsupportedRoleResponse.status, 400)

    const unauthenticatedComplaintResponse = await fetch(`${apiBase}/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Guest',
        customer_email: 'guest@example.test',
        subject: 'Unauthenticated complaint',
        description: 'This complaint must require customer login.'
      })
    })
    assert.equal(unauthenticatedComplaintResponse.status, 401)

    const adminComplaintResponse = await fetch(`${apiBase}/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': adminSession.token
      },
      body: JSON.stringify({
        customer_name: 'System Administrator',
        customer_email: administrator.user.email,
        subject: 'Must not be submitted by admin',
        description: 'Staff complaint submission must be blocked.'
      })
    })
    assert.equal(adminComplaintResponse.status, 403)

    const customerComplaintResponse = await fetch(`${apiBase}/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': originalSession.token
      },
      body: JSON.stringify({
        customer_name: 'Spoofed Name',
        customer_email: 'someone-else@example.test',
        subject: 'Customer complaint',
        description: 'Customer complaint submission remains available.',
        category: 'Billing',
        priority: 'High'
      })
    })
    assert.equal(customerComplaintResponse.status, 201)
    const submittedComplaint = (await customerComplaintResponse.json()).complaint
    assert.equal(submittedComplaint.customer_id, registration.user.id)
    assert.equal(submittedComplaint.customer_name, registration.user.name)
    assert.equal(submittedComplaint.customer_email, registration.user.email)

    const customerComplaintListResponse = await fetch(`${apiBase}/complaints`, {
      headers: { 'x-session-token': originalSession.token }
    })
    assert.equal(customerComplaintListResponse.status, 200)
    const customerComplaintList = await customerComplaintListResponse.json()
    assert.deepEqual(customerComplaintList.complaints.map((complaint) => complaint.id), [submittedComplaint.id])

    const adminComplaintListResponse = await fetch(`${apiBase}/complaints`, {
      headers: { 'x-session-token': adminSession.token }
    })
    assert.equal(adminComplaintListResponse.status, 200)
    const adminComplaintList = await adminComplaintListResponse.json()
    assert.ok(
      adminComplaintList.complaints.some((complaint) => complaint.id === submittedComplaint.id),
      'submitted customer complaint appears in the administrator queue'
    )

    const invalidComplaintResponse = await fetch(`${apiBase}/complaints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': originalSession.token
      },
      body: JSON.stringify({
        subject: '   ',
        description: 'Empty subject should not be accepted.'
      })
    })
    assert.equal(invalidComplaintResponse.status, 400)

    const invalidEmailResponse = await fetch(`${apiBase}/api/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' })
    })
    assert.equal(invalidEmailResponse.status, 400)

    const requestResponse = await fetch(`${apiBase}/api/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.toUpperCase() })
    })
    assert.equal(requestResponse.status, 202)
    assert.match((await requestResponse.json()).message, /If an account exists/)
    assert.equal(smtpMessages.length, 1)

    const message = smtpMessages[0]
    const decodedMessage = message
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    const resetToken = decodedMessage.match(/resetToken=([A-Za-z0-9_-]+)/)?.[1]
    assert.ok(resetToken, 'recovery email contains a reset link')
    assert.ok(
      passwordResetTokens.has(crypto.createHash('sha256').update(resetToken).digest('hex')),
      'stored recovery token hash matches the emailed token'
    )
    assert.match(decodedMessage, /within 30 minutes/)

    const shortPasswordResponse = await fetch(`${apiBase}/api/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'short' })
    })
    assert.equal(shortPasswordResponse.status, 400)

    const newPassword = 'New-Test-Password-456!'
    const completeResponse = await fetch(`${apiBase}/api/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: newPassword })
    })
    const completion = await completeResponse.json()
    assert.equal(completeResponse.status, 200, completion.message)
    assert.ok(completion.totpSecret)
    assert.notEqual(completion.totpSecret, registration.totpSecret)

    const replayResponse = await fetch(`${apiBase}/api/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: newPassword })
    })
    assert.equal(replayResponse.status, 400)

    const oldSessionResponse = await fetch(`${apiBase}/api/me`, {
      headers: { 'x-session-token': originalSession.token }
    })
    assert.equal(oldSessionResponse.status, 401)

    const oldLoginResponse = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: oldPassword,
        otp: authenticator.generate(registration.totpSecret)
      })
    })
    assert.equal(oldLoginResponse.status, 401)

    const newLoginResponse = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: newPassword,
        otp: authenticator.generate(completion.totpSecret)
      })
    })
    assert.equal(newLoginResponse.status, 200)

    const unknownAccountResponse = await fetch(`${apiBase}/api/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.test' })
    })
    assert.equal(unknownAccountResponse.status, 202)
    assert.equal(smtpMessages.length, 1)

    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_SECURE
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    delete process.env.SMTP_FROM
    process.env.RECOVERY_EMAIL_MODE = 'console'

    const localRequestResponse = await fetch(`${apiBase}/api/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    assert.equal(localRequestResponse.status, 202)
    const localRequest = await localRequestResponse.json()
    assert.match(localRequest.message, /Local development/)
    const localToken = new URL(localRequest.recoveryUrl).searchParams.get('resetToken')
    assert.ok(localToken)
    assert.equal(passwordResetTokens.has(crypto.createHash('sha256').update(localToken).digest('hex')), true)

    process.env.NODE_ENV = 'production'
    const productionRequestResponse = await fetch(`${apiBase}/api/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    assert.equal(productionRequestResponse.status, 503)
    assert.equal((await productionRequestResponse.json()).recoveryUrl, undefined)
  } finally {
    delete process.env.ADMIN_SETUP_KEY
    await new Promise((resolve, reject) => {
      apiServer.close((error) => error ? reject(error) : resolve())
    })
    await new Promise((resolve, reject) => {
      smtpServer.close((error) => error ? reject(error) : resolve())
    })
  }
})
