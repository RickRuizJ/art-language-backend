'use strict';
module.exports=(err,req,res,next)=>{
 if(res.headersSent)return next(err);
 const status=err.name==='MulterError'?400:err.name==='SequelizeValidationError'?400:err.name==='SequelizeUniqueConstraintError'?409:err.status>=400&&err.status<500?err.status:500;
 const message=err.name==='MulterError'?(err.code==='LIMIT_FILE_SIZE'?'File too large. Maximum size is 10 MB.':'Invalid upload.'):err.name==='SequelizeUniqueConstraintError'?'Duplicate record.':status===400?'Invalid request.':status===403?'Access denied.':status===500?'Internal server error. Please try again later.':'Request could not be completed.';
 console.error('Request failed:',err.name||'Error','status:',status);
 res.status(status).json({success:false,message});
};
