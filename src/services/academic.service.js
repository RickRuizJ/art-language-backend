'use strict';
const {Op}=require('sequelize');
const {ManualGrade,Submission,Worksheet}=require('../models');
const {studentSubmission}=require('./interactive.service');
exports.automaticStats=(assignments,submissions)=>{
 const ids=new Set(assignments.map(a=>a.worksheetId));const latest={};
 for(const value of submissions){const s=value.toJSON?value.toJSON():value;if(!ids.has(s.worksheetId))continue;const old=latest[s.worksheetId];if(!old||Number(s.attemptNumber||0)>Number(old.attemptNumber||0)||(Number(s.attemptNumber||0)===Number(old.attemptNumber||0)&&new Date(s.submittedAt)>new Date(old.submittedAt)))latest[s.worksheetId]=s;}
 const rows=Object.values(latest),completed=rows.filter(s=>['submitted','graded','reviewed'].includes(s.status)),graded=rows.filter(s=>['graded','reviewed'].includes(s.status)&&s.score!=null&&Number(s.maxScore)>0&&((s.gradingSnapshot?.feedbackMode||s.feedbackMode)!=='after_review'||s.status==='reviewed'));
 return {total:ids.size,completed:completed.length,pending:Math.max(0,ids.size-completed.length),avgScore:graded.length?Math.round(graded.reduce((n,s)=>n+Number(s.score)*100/Number(s.maxScore),0)/graded.length*10)/10:null,source:'automatic',policy:'automatic_only'};
};
exports.history=async(studentId,{teacherId,groupIds}={})=>{
 const submissions=await Submission.findAll({where:{studentId},include:[{model:Worksheet,as:'worksheet',attributes:['id','title'],...(teacherId?{where:{createdBy:teacherId},required:true}:{})}],order:[['submittedAt','DESC'],['attemptNumber','DESC']]});
 const manual=await ManualGrade.findAll({where:{studentId,isActive:true,...(groupIds?{groupId:{[Op.in]:groupIds}}:{})},order:[['activityDate','DESC']]});
 const automatic=submissions.map(sub=>{const s=teacherId?sub.toJSON():studentSubmission(sub);return {id:s.id,title:s.worksheet?.title,worksheetId:s.worksheetId,source:'automatic',score:s.score,maxScore:s.maxScore,percentage:s.score!=null&&Number(s.maxScore)>0&&((s.gradingSnapshot?.feedbackMode||s.feedbackMode)!=='after_review'||s.status==='reviewed')?Math.round(Number(s.score)*100/Number(s.maxScore)*10)/10:null,status:s.status,date:s.submittedAt,attemptNumber:s.attemptNumber,feedback:s.feedback};});
 return {policy:'automatic_only',automatic,manual:manual.map(g=>({id:g.id,title:g.title,source:'manual',score:g.score,maxScore:g.maxScore,percentage:Math.round(Number(g.score)*100/Number(g.maxScore)*10)/10,date:g.activityDate,feedback:g.feedback,externalUrl:g.externalUrl,history:g.history})),message:'Manual grades are recorded separately and do not change the official automatic average.'};
};
