'use strict';
// Email provider adapter for Art & Language Campus password recovery.
// No credentials or reset links are logged. Set EMAIL_PROVIDER=sender to use Sender.
const TIMEOUT_MS = 10000;
function provider() { return String(process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase(); }
function senderFromAddress() {
  const value = String(process.env.EMAIL_FROM || '').trim();
  const match = value.match(/<([^<>]+)>$/);
  return match ? match[1].trim() : value;
}
function senderFromName() {
  const envName = String(process.env.EMAIL_FROM_NAME || '').trim();
  if (envName) return envName;
  const match = String(process.env.EMAIL_FROM || '').match(/^(.+?)\s*<[^<>]+>$/);
  return match ? match[1].replace(/^['"]|['"]$/g, '').trim() : 'Art & Language';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);
}
exports.isConfigured = () => {
  if (!process.env.EMAIL_FROM) return false;
  switch (provider()) {
    case 'sender': return Boolean(process.env.SENDER_API_TOKEN);
    case 'resend': return Boolean(process.env.RESEND_API_KEY);
    default: return false;
  }
};
exports.sendResetEmail = async (to, link) => {
  if (!exports.isConfigured()) throw new Error('Email is not configured');
  const subject = 'Restablece tu contraseña de Art & Language Campus';
  const text = `Hola,\n\nPara crear una nueva contraseña de Art & Language Campus, abre este enlace (caduca en 30 minutos):\n\n${link}\n\nSi no solicitaste este cambio, ignora este correo.`;
  let url, token, body;
  if (provider() === 'sender') {
    url = 'https://api.sender.net/v2/message/send';
    token = process.env.SENDER_API_TOKEN;
    body = {
      from: { email: senderFromAddress(), name: senderFromName() },
      to: { email: to },
      subject,
      text,
      html: `<p>Hola,</p><p>Para crear una nueva contraseña de Art &amp; Language Campus, abre el siguiente enlace. Caduca en 30 minutos.</p><p><a href="${escapeHtml(link)}">Crear nueva contraseña</a></p><p>Si no solicitaste este cambio, ignora este correo.</p>`
    };
  } else {
    url = 'https://api.resend.com/emails';
    token = process.env.RESEND_API_KEY;
    body = { from: process.env.EMAIL_FROM, to: [to], subject, text };
  }
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  // A successful API response means accepted for processing, not inbox delivery.
};
