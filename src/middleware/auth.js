'use strict';
const jwt=require('jsonwebtoken');
const {User}=require('../models');
const auth=async(req,res,next)=>{
 try{
  const header=req.header('Authorization')||'';if(!/^Bearer [^ ]+$/.test(header))return res.status(401).json({success:false,message:'Authentication required.'});
  const decoded=jwt.verify(header.slice(7),process.env.JWT_SECRET,{algorithms:['HS256']});
  if(!require('../services/validation.service').UUID.test(decoded.id||''))return res.status(401).json({success:false,message:'Invalid session.'});
  const user=await User.findByPk(decoded.id);
  if(!user?.isActive||!['student','teacher','admin'].includes(user.role))return res.status(401).json({success:false,message:'Session expired. Please sign in.'});
  const version=Number(user.authVersion||0);
  const valid=decoded.ver!=null?(Number.isInteger(decoded.ver)&&decoded.ver===version):version===0&&(!user.passwordChangedAt||decoded.iat>Math.floor(new Date(user.passwordChangedAt).getTime()/1000));
  if(!valid||(user.temporaryPasswordExpiresAt&&new Date(user.temporaryPasswordExpiresAt)<=new Date()))return res.status(401).json({success:false,message:'Session expired. Use sign in or password recovery.'});
  req.user=user;
  const path=req.originalUrl.split('?')[0];
  if(user.mustChangePassword&&!['/api/auth/me','/api/auth/change-password'].includes(path))return res.status(403).json({success:false,code:'PASSWORD_CHANGE_REQUIRED',message:'Change your temporary password before continuing.'});
  next();
 }catch(e){res.status(['JsonWebTokenError','TokenExpiredError','NotBeforeError'].includes(e.name)?401:503).json({success:false,message:'Session could not be verified.'});}
};
module.exports=auth;module.exports.authenticate=auth;module.exports.protect=auth;
