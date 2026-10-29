'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { Op } = require('sequelize');
const db = require('../config/database');
const { User, Group, GroupMember, PasswordReset } = require('../models');
const { passwordError, fail } = require('../services/validation.service');
const { record } = require('../services/audit.service');
const recovery = require('../services/recovery.service');
const dummyHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
const generateToken = user => jwt.sign({ id:user.id, email:user.email, role:user.role, ver:Number(user.authVersion || 0) },process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRE || '7d'});
const validationFailed = (req,res) => {
  const errors=validationResult(req);if(errors.isEmpty())return false;
  res.status(400).json({success:false,message:errors.array()[0].msg,errors:errors.array().map(e=>({field:e.path,message:e.msg}))});return true;
};
const passwordRule=()=>body('password').custom(value=>{const error=passwordError(value);if(error)throw new Error(error);return true;});
const identity=[body('email').isString().bail().isEmail().normalizeEmail()];
function sameSecret(supplied,expected){return typeof supplied==='string'&&typeof expected==='string'&&expected.length>0&&crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(),crypto.createHash('sha256').update(expected).digest());}
exports.register=[...identity,passwordRule(),body('firstName').isString().bail().trim().isLength({min:1,max:100}),body('lastName').isString().bail().trim().isLength({min:1,max:100}),body('role').optional().isIn(['student','teacher']),async(req,res)=>{
 if(validationFailed(req,res))return;
 const {email,password,firstName,lastName}=req.body,role=req.body.role==='teacher'?'teacher':'student';
 try{
  if(role==='teacher'){
   if(!process.env.TEACHER_REGISTRATION_PASSWORD)throw fail('Teacher registration is not configured.',503);
   if(!sameSecret(req.body.teacherAuthorization,process.env.TEACHER_REGISTRATION_PASSWORD))throw fail('Invalid teacher authorization password.',403);
  }
  const user=await db.transaction(async transaction=>{
   let group;
   if(role==='student'){
    const code=typeof req.body.registrationCode==='string'?req.body.registrationCode.trim().toUpperCase():'';
    if(!/^[A-Z0-9]{6,8}$/.test(code))throw fail('A valid teacher-provided group code is required.');
    group=await Group.findOne({where:{joinCode:code,isActive:true},transaction,lock:transaction.LOCK.UPDATE});
    if(!group)throw fail('Invalid or inactive registration code.');
   }
   const created=await User.create({email,password,firstName,lastName,role,...(group?{groupId:group.id,teacherId:group.teacherId}:{})},{transaction});
   if(group)await GroupMember.create({groupId:group.id,studentId:created.id},{transaction});
   await record(created.id,'account.registered',created.id,{role,groupId:group?.id||null},transaction);return created;
  });
  res.status(201).json({success:true,data:{user:user.toJSON(),token:generateToken(user)}});
 }catch(e){res.status(e.name==='SequelizeUniqueConstraintError'?409:e.status||500).json({success:false,message:e.name==='SequelizeUniqueConstraintError'?'Email is already registered.':e.status?e.message:'Unable to register.'});}
}];
exports.login=[...identity,body('password').isString().bail().custom(v=>v.length>0&&Buffer.byteLength(v,'utf8')<=72).withMessage('Password must not exceed 72 UTF-8 bytes. For an older longer password, use password recovery.'),async(req,res)=>{
 if(validationFailed(req,res))return;
 try{
  const user=await User.findOne({where:{email:req.body.email}});
  const matches=await bcrypt.compare(req.body.password,user?.password||dummyHash);
  if(!user?.isActive||!matches||(user.temporaryPasswordExpiresAt&&new Date(user.temporaryPasswordExpiresAt)<=new Date()))return res.status(401).json({success:false,message:'Invalid credentials or disabled/expired account access. Use password recovery if needed.'});
  res.json({success:true,data:{user:user.toJSON(),token:generateToken(user)}});
 }catch{res.status(503).json({success:false,message:'Unable to log in. Please try again later.'});}
}];
exports.getMe=(req,res)=>res.json({success:true,data:{user:req.user.toJSON()}});
exports.refreshToken=(req,res)=>res.json({success:true,data:{token:generateToken(req.user)}});
exports.requestPasswordResetForEmail=recovery.enqueue;
exports.forgotPassword=[...identity,async(req,res)=>{
 if(validationFailed(req,res))return;
 const started=Date.now(),delay=250+crypto.randomInt(60);
 try{await recovery.enqueue(req.body.email);}catch{console.error('Recovery request could not be queued.');}
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,delay-(Date.now()-started))));
 res.json({success:true,message:'If an eligible account exists, your recovery request will be processed. Check your email or contact your teacher.'});
}];
exports.resetPassword=[body('token').isString().bail().matches(/^[0-9a-f]{64}$/i),passwordRule(),async(req,res)=>{
 if(validationFailed(req,res))return;
 try{
  const hash=crypto.createHash('sha256').update(req.body.token).digest('hex');
  await db.transaction(async transaction=>{
   const candidate=await PasswordReset.findOne({where:{tokenHash:hash},transaction});
   if(!candidate)throw fail('This reset link is invalid or expired.');
   // All password mutations lock the user first, including the mail worker.
   const user=await User.findByPk(candidate.userId,{transaction,lock:transaction.LOCK.UPDATE});
   const token=await PasswordReset.findOne({where:{id:candidate.id,tokenHash:hash,expiresAt:{[Op.gt]:new Date()}},transaction,lock:transaction.LOCK.UPDATE});
   if(!user?.isActive||!token)throw fail('This reset link is invalid or expired.');
   const consumed=await PasswordReset.destroy({where:{id:token.id,expiresAt:{[Op.gt]:new Date()}},transaction});
   if(consumed!==1)throw fail('This reset link is invalid or expired.');
   user.password=req.body.password;user.mustChangePassword=false;user.temporaryPasswordExpiresAt=null;await user.save({transaction});
   await PasswordReset.destroy({where:{userId:user.id},transaction});
   await record(user.id,'account.password_recovered',user.id,{},transaction);
  });
  res.json({success:true,message:'Password updated. You can now sign in.'});
 }catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not reset password. Please request another link.'});}
}];
exports.changePassword=[body('currentPassword').isString().bail().custom(value=>value.length>0&&Buffer.byteLength(value,'utf8')<=72),passwordRule(),async(req,res)=>{
 if(validationFailed(req,res))return;
 try{
  const user=await db.transaction(async transaction=>{
   const current=await User.findByPk(req.user.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(!current?.isActive||Number(current.authVersion)!==Number(req.user.authVersion)||!await current.comparePassword(req.body.currentPassword))throw fail('Current password is incorrect or session expired.',401);
   if(req.body.password===req.body.currentPassword)throw fail('Choose a personal password different from the temporary/current password.');
   current.password=req.body.password;current.mustChangePassword=false;current.temporaryPasswordExpiresAt=null;await current.save({transaction});
   await PasswordReset.destroy({where:{userId:current.id},transaction});await record(current.id,'account.password_changed',current.id,{},transaction);return current;
  });res.json({success:true,data:{user:user.toJSON(),token:generateToken(user)}});
 }catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not change password.'});}
}];
exports.generateToken=generateToken;
