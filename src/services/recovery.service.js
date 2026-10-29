'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../config/database');
const { User, PasswordReset, EmailJob } = require('../models');
const { sendResetEmail, isConfigured } = require('./email.service');
const { record } = require('./audit.service');
const { consume } = require('../middleware/securityLimits');
exports.configured = () => {
 if(!isConfigured()||!process.env.FRONTEND_URL)return false;
 try{const url=new URL(process.env.FRONTEND_URL);return !url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&(url.protocol==='https:'||(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'));}catch{return false;}
};
exports.enqueue = async (email, actorId = null) => {
  const normalized = String(email).trim().toLowerCase();
  if (!await consume('recovery-email', normalized, Number(process.env.RECOVERY_EMAIL_HOURLY_MAX || 3), 3600000)) return;
  const user = await User.findOne({ where:{email:normalized,isActive:true} });
  // Unknown addresses also get a no-op job, never an email or an observable provider call.
  try {
    await db.transaction(async transaction => {
      await EmailJob.create({ userId:user?.id || null, authVersion:Number(user?.authVersion||0) }, { transaction });
      if (actorId && user) await record(actorId,'student.recovery_queued',user.id,{},transaction);
    });
  } catch (e) { if(e.name !== 'SequelizeUniqueConstraintError') throw e; }
};
let running = false;
exports.processJobs = async ({ send = sendResetEmail, max = 10 } = {}) => {
  if (running) return; running = true;
  try {
    await EmailJob.update({status:'pending',lockedAt:null},{where:{status:'sending',lockedAt:{[Op.lt]:new Date(Date.now()-300000)}}});
    for(let i=0;i<max;i++) {
      const job = await db.transaction(async transaction => {
        const item=await EmailJob.findOne({where:{status:'pending',availableAt:{[Op.lte]:new Date()}},order:[['created_at','ASC']],transaction,lock:transaction.LOCK.UPDATE,skipLocked:true});
        if(!item)return null;
        await item.update({status:'sending',lockedAt:new Date(),attempts:item.attempts+1},{transaction});return item;
      });
      if(!job)break;
      try {
        const delivery=await db.transaction(async transaction => {
          const user=job.userId ? await User.findByPk(job.userId,{transaction,lock:transaction.LOCK.UPDATE}) : null;
          if(!user?.isActive||Number(user.authVersion||0)!==Number(job.authVersion))return null;
          const token=crypto.randomBytes(32).toString('hex');
          await PasswordReset.destroy({where:{userId:user.id},transaction});
          await PasswordReset.create({userId:user.id,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+1800000)},{transaction});
          return {email:user.email,token};
        });
        if(delivery) {
          if(!exports.configured())throw new Error('email_configuration');
          await send(delivery.email,`${process.env.FRONTEND_URL.replace(/\/$/,'')}/reset-password?token=${delivery.token}`);
        }
        await job.update({status:'done',lockedAt:null,errorCode:null});
      } catch {
        await job.update({status:job.attempts>=3?'failed':'pending',lockedAt:null,errorCode:'delivery_unavailable',availableAt:new Date(Date.now()+60000*job.attempts)});
        console.error('Recovery email delivery unavailable; inspect email_jobs status and provider configuration.');
      }
    }
    await PasswordReset.destroy({where:{expiresAt:{[Op.lt]:new Date()}}});
    await EmailJob.destroy({where:{status:{[Op.in]:['done','failed']},updated_at:{[Op.lt]:new Date(Date.now()-7*86400000)}}});
    await db.query("DELETE FROM rate_limit_buckets WHERE window_start < now()-INTERVAL '2 days'");
  } finally { running=false; }
};
exports.startWorker = () => {
  void exports.processJobs().catch(()=>console.error('Recovery worker unavailable.'));
  const timer=setInterval(()=>void exports.processJobs().catch(()=>console.error('Recovery worker unavailable.')),10000);timer.unref();return ()=>clearInterval(timer);
};
