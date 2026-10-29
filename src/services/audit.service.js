'use strict';
// Callers supply explicit whitelists. Never pass req.body, tokens or User instances.
exports.record = (actorId, action, subjectId, metadata = {}, transaction) => require('../models').AuditEvent.create({ actorId, action, subjectId, metadata }, { transaction });
