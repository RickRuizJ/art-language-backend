'use strict';
// Resend HTTP API; requires Node 18+ (native fetch). No mail credentials in repository.
exports.sendResetEmail = async (to, link) => {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error('Email is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: 'Reset your Art & Language Campus password',
      text: `Use the following link to reset your password (expires in 30 minutes):\n\n${link}\n\nIf you did not request this, ignore this email.` })
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
};
