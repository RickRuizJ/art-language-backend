'use strict';
const crypto = require('crypto');
const db = require('../config/database');
// PostgreSQL atomic buckets coordinate replicas and survive application restarts.
async function consume(scope, value, max, windowMs = 900000) {
  const key = crypto.createHmac('sha256', process.env.JWT_SECRET || 'local-test').update(`${scope}:${value}`).digest('hex');
  const start = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const [rows] = await db.query(`INSERT INTO rate_limit_buckets(key,window_start,hits) VALUES(:key,:start,1)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limit_buckets.window_start=EXCLUDED.window_start THEN rate_limit_buckets.hits+1 ELSE 1 END,
    window_start=EXCLUDED.window_start RETURNING hits`, { replacements: { key, start } });
  return Number(rows[0].hits) <= max;
}
function limit(scope, options = {}) {
  return async (req, res, next) => {
    try {
      const value = options.key ? options.key(req) : req.ip;
      if (!await consume(scope, String(value || 'unknown').slice(0,300), Number(options.max || 40), options.windowMs)) {
        res.set('Retry-After', String(Math.ceil((options.windowMs || 900000) / 1000)));
        return res.status(429).json({ success:false, message:'Too many requests. Please try again later.' });
      }
      next();
    } catch { res.status(503).json({ success:false, message:'Service is not ready. Please try again later.' }); }
  };
}
exports.consume = consume;
exports.limit = limit;
exports.account = (operation, max = 10, windowMs) => limit(`account:${operation}`, { max, windowMs, key:req => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : req.ip });
