'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function passwordError(value) {
  return typeof value !== 'string' || value.length < 8 || !value.trim() || Buffer.byteLength(value, 'utf8') > 72
    ? 'Use at least 8 characters and at most 72 UTF-8 bytes for the password.' : null;
}
function dateValid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function urlValid(value) {
  if (value === '' || value == null) return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && Boolean(u.hostname) && !u.username && !u.password; } catch { return false; }
}
function decimal(value, name) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value))) throw fail(`${name} must be a number with at most two decimal places.`);
  return Number(value);
}
module.exports = { UUID, fail, passwordError, dateValid, urlValid, decimal };
