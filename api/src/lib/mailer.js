// Outbound email via Azure Communication Services — the one place the ACS
// SDK is touched (sign-in codes in functions/auth.js and the reports in
// functions/reports.js both send through here).
//
// The require is lazy so a local dev machine without ACS configured never
// loads the SDK. Message contents are deliberately never logged: sign-in
// codes are secrets, and even the PHI-free reports stay out of the logs.

function acsConfigured() {
  return Boolean(process.env.ACS_CONNECTION_STRING && process.env.ACS_SENDER)
}

// Send one email to one or more recipients. `text` is the plain-text
// alternative — always provided, so clients that refuse HTML still get the
// content.
async function sendEmail({ to, subject, text, html }) {
  const { EmailClient } = require('@azure/communication-email')
  const client = new EmailClient(process.env.ACS_CONNECTION_STRING)
  const poller = await client.beginSend({
    senderAddress: process.env.ACS_SENDER,
    recipients: { to: to.map((address) => ({ address })) },
    content: { subject, plainText: text, html },
  })
  await poller.pollUntilDone()
}

module.exports = { acsConfigured, sendEmail }
