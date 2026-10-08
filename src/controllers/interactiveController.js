const {randomUUID}=require('crypto');
const sequelize=require('../config/database');
const {Worksheet,WorksheetDraft,FileUpload,Submission}=require('../models');
const {fail,assigned,validateLayout,questionsOf,cleanAnswers}=require('../services/interactive.service');
const answerError=(res,e)=>res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not save interactive work. Please retry.'});
exports.saveLayout=async(req,res)=>{
 try{
  const worksheet=await sequelize.transaction(async transaction=>{
   const ws=await Worksheet.findByPk(req.params.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(!ws)throw fail('Worksheet not found.',404);
   if(req.user.role!=='admin'&&ws.createdBy!==req.user.id)throw fail('Access denied.',403);
   const file=await FileUpload.findOne({where:{entityId:ws.id,entityType:'worksheet',mimeType:'application/pdf'},transaction});
   if(!file)throw fail('Make Interactive requires an uploaded PDF.');
   if(ws.layoutRevision!==req.body.revision)throw fail('Another edit was saved. Reload the editor before continuing.',409);
   const data=validateLayout(req.body,file.id);
   await ws.update({...data,layoutRevision:ws.layoutRevision+1},{transaction});
   return ws;
  });
  res.json({success:true,data:{worksheet}});
 }catch(e){answerError(res,e);}
};
// A draft is saved work, not an attempt. Only POST /submissions increments attempts.
exports.startAttempt=async(req,res)=>{
 try{
  const data=await sequelize.transaction(async transaction=>{
   const ws=await Worksheet.findByPk(req.params.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(!ws?.isPublished||!await assigned(req.user.id,req.params.id,transaction))throw fail('Worksheet is not assigned or published.',403);
   if(req.body.revision!==ws.layoutRevision)throw fail('The worksheet changed. Reload the worksheet.',409);
   if(!ws.interactiveLayout)throw fail('This worksheet is not an interactive PDF.');
   const count=await Submission.count({where:{worksheetId:ws.id,studentId:req.user.id},transaction});
   if(ws.maxAttempts&&count>=ws.maxAttempts)throw fail('Maximum attempts reached.',409);
   let draft=await WorksheetDraft.findOne({where:{worksheetId:ws.id,studentId:req.user.id},transaction});
   if(draft&&draft.layoutRevision!==ws.layoutRevision){
    // Preserve the old draft until the student explicitly resets it.
    if(req.body.reset!==true)throw fail('The teacher updated this activity. Reload the worksheet to start its new version.',409);
    await draft.destroy({transaction});draft=null;
   }
   if(!draft)draft=await WorksheetDraft.create({worksheetId:ws.id,studentId:req.user.id,attemptToken:randomUUID(),layoutRevision:ws.layoutRevision,startedAt:new Date(),updatedAt:new Date(),answers:[]},{transaction});
   return {draft,attemptNumber:count+1,maxAttempts:ws.maxAttempts};
  });res.json({success:true,data});
 }catch(e){answerError(res,e);}
};
exports.saveDraft=async(req,res)=>{
 try{
  await sequelize.transaction(async transaction=>{
   const ws=await Worksheet.findByPk(req.params.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(!ws?.isPublished||!await assigned(req.user.id,req.params.id,transaction))throw fail('Access denied.',403);
   const draft=await WorksheetDraft.findOne({where:{worksheetId:ws.id,studentId:req.user.id},transaction});
   if(!draft||draft.attemptToken!==req.body.attemptToken||draft.layoutRevision!==ws.layoutRevision)throw fail('This attempt changed or was already submitted. Reload before continuing.',409);
   await draft.update({answers:cleanAnswers(req.body.answers,questionsOf(ws)),updatedAt:new Date()},{transaction});
  });res.json({success:true});
 }catch(e){answerError(res,e);}
};
