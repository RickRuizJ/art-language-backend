'use strict';
const router=require('express').Router();
const {Op}=require('sequelize');
const {body,validationResult}=require('express-validator');
const {User,Group,GroupMember,PasswordReset}=require('../models');
const db=require('../config/database'),auth=require('../middleware/auth'),roleCheck=require('../middleware/roleCheck');
const access=require('../services/access.service'),recovery=require('../services/recovery.service');
const {record}=require('../services/audit.service');
const {fail,passwordError}=require('../services/validation.service');
const {limit}=require('../middleware/securityLimits');
router.use(auth,roleCheck('teacher','admin'));
const error=(res,e)=>res.status(e.name==='SequelizeUniqueConstraintError'?409:e.name==='SequelizeValidationError'?400:e.status||500).json({success:false,message:e.name==='SequelizeUniqueConstraintError'?'Email is already registered.':e.status?e.message:e.name==='SequelizeValidationError'?'Invalid student data.':'Could not complete request.'});
const checkInput=req=>{if(!validationResult(req).isEmpty())throw fail('Invalid email address.');};
router.get('/',async(req,res)=>{
 try{
  const groups=await Group.findAll({where:access.groupScope(req.user),attributes:['id','name','joinCode','isActive']});
  const students=await User.findAll({where:await access.rosterWhere(req.user),attributes:{exclude:['password','authVersion']},order:[['firstName','ASC'],['lastName','ASC']]});
  const memberships=await GroupMember.findAll({where:{groupId:{[Op.in]:groups.map(g=>g.id)}},attributes:['studentId','groupId']});
  res.json({success:true,data:{students,groups,memberships}});
 }catch(e){error(res,e);}
});
router.post('/',body('email').isString().bail().isEmail().normalizeEmail(),async(req,res)=>{
 try{
  checkInput(req);const {firstName,lastName,email,password,groupId}=req.body;
  if([firstName,lastName].some(n=>typeof n!=='string'||!n.trim()||n.length>100))throw fail('First and last name are required (maximum 100 characters).');
  if(passwordError(password))throw fail(passwordError(password));
  const student=await db.transaction(async transaction=>{
   const group=await access.groupAccess(req.user,groupId,transaction);if(!group?.isActive)throw fail('Active group not found.',403);
   const created=await User.create({firstName:firstName.trim(),lastName:lastName.trim(),email,password,groupId:group.id,teacherId:group.teacherId,role:'student',mustChangePassword:true,temporaryPasswordExpiresAt:new Date(Date.now()+86400000)},{transaction});
   await GroupMember.create({groupId:group.id,studentId:created.id},{transaction});await record(req.user.id,'student.created',created.id,{groupId:group.id,temporaryPassword:true},transaction);return created;
  });res.status(201).json({success:true,data:{student:student.toJSON()}});
 }catch(e){error(res,e);}
});
router.patch('/:id',body('email').optional().isString().bail().isEmail().normalizeEmail(),async(req,res)=>{
 try{
  checkInput(req);
  const student=await db.transaction(async transaction=>{
   const student=await access.studentAccess(req.user,req.params.id,transaction,true);if(!student)throw fail('Student not found.',404);
   const before={firstName:student.firstName,lastName:student.lastName,email:student.email,isActive:student.isActive};
   for(const key of ['firstName','lastName'])if(req.body[key]!==undefined){const v=req.body[key];if(typeof v!=='string'||!v.trim()||v.length>100)throw fail('Invalid student name.');student[key]=v.trim();}
   if(req.body.email!==undefined)student.email=req.body.email;
   if(req.body.isActive!==undefined){if(typeof req.body.isActive!=='boolean')throw fail('Invalid account status.');if(student.isActive!==req.body.isActive)student.authVersion=Number(student.authVersion||0)+1;student.isActive=req.body.isActive;}
   // Email changes can route recovery to a different inbox; revoke sessions and reset links.
   if(student.changed('email')){student.authVersion=Number(student.authVersion||0)+1;await PasswordReset.destroy({where:{userId:student.id},transaction});}
   await student.save({transaction});await record(req.user.id,'student.updated',student.id,{before,after:{firstName:student.firstName,lastName:student.lastName,email:student.email,isActive:student.isActive}},transaction);return student;
  });res.json({success:true,data:{student:student.toJSON()}});
 }catch(e){error(res,e);}
});
router.post('/:id/set-password',limit('teacher-password',{max:20,windowMs:3600000,key:req=>req.user.id}),async(req,res)=>{
 try{
  if(passwordError(req.body.password))throw fail(passwordError(req.body.password));
  await db.transaction(async transaction=>{
   const student=await access.studentAccess(req.user,req.params.id,transaction,true);if(!student)throw fail('Student not found.',404);
   student.password=req.body.password;student.mustChangePassword=true;student.temporaryPasswordExpiresAt=new Date(Date.now()+86400000);await student.save({transaction});
   await PasswordReset.destroy({where:{userId:student.id},transaction});await record(req.user.id,'student.temporary_password_set',student.id,{expiresInHours:24},transaction);
  });res.json({success:true,message:'Temporary password set for 24 hours. Student must change it at next sign in.'});
 }catch(e){error(res,e);}
});
router.post('/:id/password-reset',limit('teacher-recovery',{max:20,windowMs:3600000,key:req=>req.user.id}),async(req,res)=>{
 try{
  const student=await access.studentAccess(req.user,req.params.id);if(!student)throw fail('Student not found.',404);
  if(!recovery.configured())throw fail('Email recovery is not configured. Ask the administrator to check email settings.',503);
  await recovery.enqueue(student.email,req.user.id);res.json({success:true,message:'Recovery request queued. Delivery depends on the verified email service.'});
 }catch(e){error(res,e);}
});
router.post('/:id/groups/:groupId',async(req,res)=>{try{await access.addMembers(req.user,req.params.groupId,[req.params.id]);res.json({success:true});}catch(e){error(res,e);}});
router.delete('/:id/groups/:groupId',async(req,res)=>{try{await access.removeMember(req.user,req.params.groupId,req.params.id);res.json({success:true,message:'Removed from group; account and academic history preserved.'});}catch(e){error(res,e);}});
module.exports=router;
