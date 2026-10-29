'use strict';
const router=require('express').Router();
const crypto=require('crypto');
const {Op,QueryTypes}=require('sequelize');
const db=require('../config/database');
const {ManualGrade,ManualActivity,Group,GroupMember,User,Assignment,Worksheet,AuditEvent}=require('../models');
const {UUID,fail,dateValid,urlValid,decimal}=require('../services/validation.service');
const access=require('../services/access.service'),{record}=require('../services/audit.service');
router.use(require('../middleware/auth'),require('../middleware/roleCheck')('teacher','admin'));
const respondError=(res,e)=>res.status(e.name==='SequelizeUniqueConstraintError'?409:e.status||500).json({success:false,message:e.name==='SequelizeUniqueConstraintError'?'A grade already exists for this student and activity. Open that grade to correct it.':e.status?e.message:'Could not complete manual grading.'});
function values(data){
 const score=decimal(data.score,'Score'),maxScore=decimal(data.maxScore,'Maximum');
 if(maxScore<=0||maxScore>100000||score>maxScore)throw fail('Score must be between zero and the maximum (maximum 100000).');
 if(data.feedback!==undefined&&data.feedback!==null&&(typeof data.feedback!=='string'||data.feedback.length>2000))throw fail('Feedback must be at most 2000 characters.');
 return {score,maxScore,feedback:data.feedback||null};
}
const snapshot=g=>({score:g.score,maxScore:g.maxScore,feedback:g.feedback,isActive:g.isActive,version:g.version});
async function canWrite(req,groupId,studentId,transaction){
 const group=await access.groupAccess(req.user,groupId,transaction);if(!group)return false;
 const student=await access.studentAccess(req.user,studentId,transaction,true);
 return student&&(student.groupId===groupId||Boolean(await GroupMember.findOne({where:{groupId,studentId},transaction})));
}
function params(req){
 const p={admin:req.user.role==='admin',teacherId:req.user.id,groupId:null,studentId:null,worksheetId:null,from:null,to:null,includeArchived:req.query.includeArchived==='true'};
 for(const k of ['groupId','studentId','worksheetId'])if(req.query[k]){if(!UUID.test(req.query[k]))throw fail(`Invalid ${k}.`);p[k]=req.query[k];}
 for(const k of ['from','to'])if(req.query[k]){if(!dateValid(req.query[k]))throw fail('Use valid dates in YYYY-MM-DD format.');p[k]=req.query[k];}
 if(p.from&&p.to&&p.from>p.to)throw fail('Invalid date range.');return p;
}
const WHERE=`(:includeArchived OR mg.is_active=true) AND (:admin OR g.teacher_id=CAST(:teacherId AS uuid))
 AND (CAST(:groupId AS uuid) IS NULL OR mg.group_id=CAST(:groupId AS uuid))
 AND (CAST(:studentId AS uuid) IS NULL OR mg.student_id=CAST(:studentId AS uuid))
 AND (CAST(:worksheetId AS uuid) IS NULL OR a.worksheet_id=CAST(:worksheetId AS uuid))
 AND (CAST(:from AS date) IS NULL OR mg.activity_date>=CAST(:from AS date))
 AND (CAST(:to AS date) IS NULL OR mg.activity_date<=CAST(:to AS date))`;
const FROM=`FROM manual_grades mg JOIN groups g ON g.id=mg.group_id JOIN users u ON u.id=mg.student_id JOIN manual_activities ma ON ma.id=mg.activity_id LEFT JOIN assignments a ON a.id=ma.assignment_id`;
const SELECT=`mg.id,mg.student_id AS "studentId",mg.group_id AS "groupId",mg.activity_id AS "activityId",mg.teacher_id AS "teacherId",mg.title,mg.external_url AS "externalUrl",mg.score,mg.max_score AS "maxScore",mg.feedback,mg.activity_date AS "activityDate",mg.version,mg.is_active AS "isActive",mg.history,ma.legacy_import AS "legacyImport",ma.assignment_id AS "assignmentId",u.first_name||' '||u.last_name AS "studentName",g.name AS "groupName",'manual' AS source,ROUND(mg.score*100.0/mg.max_score,1)::float AS percentage`;
router.get('/options',async(req,res)=>{
 try{
  const group=await access.groupAccess(req.user,req.query.groupId);if(!group)throw fail('Group not found.',404);
  const activities=await ManualActivity.findAll({where:{groupId:group.id},order:[['activityDate','DESC'],['title','ASC']]});
  const assignments=await Assignment.findAll({where:{groupId:group.id,isActive:true},include:[{model:Worksheet,as:'worksheet',attributes:['id','title','questions']}],order:[['created_at','DESC']]});
  res.json({success:true,data:{activities,assignments:assignments.map(a=>({id:a.id,title:a.worksheet?.title,externalUrl:(a.worksheet?.questions||[]).find(q=>['external_link','google_embed'].includes(q.type))?.originalUrl||''}))}});
 }catch(e){respondError(res,e);}
});
router.get('/export',async(req,res)=>{
 try{
  const p=params(req);
  const cell=value=>'"'+String(value??'').replace(/^[\s\u0000-\u001f]*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="art-language-manual-grades.csv"','Cache-Control':'no-store'});
  await db.transaction({isolationLevel:'REPEATABLE READ'},async transaction=>{
   res.write('\ufeffStudent,Group,Activity,Date,Score,Maximum,Percentage,Source,Feedback,Imported identity review\r\n');
   let last=null;
   for(;;){
    const rows=await db.query(`SELECT ${SELECT} ${FROM} WHERE ${WHERE} AND (CAST(:last AS uuid) IS NULL OR mg.id>CAST(:last AS uuid)) ORDER BY mg.id LIMIT 500`,{replacements:{...p,last},type:QueryTypes.SELECT,transaction});
    if(!rows.length)break;
    for(const g of rows){if(res.destroyed)return;const chunk=[g.studentName,g.groupName,g.title,g.activityDate,g.score,g.maxScore,g.percentage,'Manual',g.feedback,g.legacyImport?'Review imported activity':''].map(cell).join(',')+'\r\n';if(!res.write(chunk))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
    last=rows.at(-1).id;
   }
  });res.end();
 }catch(e){if(res.headersSent)res.destroy();else respondError(res,e);}
});
router.get('/',async(req,res)=>{
 try{
  const p=params(req),limit=Math.min(100,Math.max(1,parseInt(req.query.limit)||25)),page=Math.max(1,parseInt(req.query.page)||1);
  const grades=await db.query(`SELECT ${SELECT} ${FROM} WHERE ${WHERE} ORDER BY mg.activity_date DESC,mg.id LIMIT :limit OFFSET :offset`,{replacements:{...p,limit,offset:(page-1)*limit},type:QueryTypes.SELECT});
  const count=(await db.query(`SELECT COUNT(*)::int AS n ${FROM} WHERE ${WHERE}`,{replacements:p,type:QueryTypes.SELECT}))[0].n;
  res.json({success:true,data:{grades,total:count,page,pages:Math.max(1,Math.ceil(count/limit)),policy:'automatic_only'}});
 }catch(e){respondError(res,e);}
});
router.post('/',async(req,res)=>{
 try{
  const data=req.body,v=values(data);if(!UUID.test(data.groupId||'')||!UUID.test(data.studentId||''))throw fail('Select a valid group and student.');
  const grade=await db.transaction(async transaction=>{
   if(!await canWrite(req,data.groupId,data.studentId,transaction))throw fail('Student does not belong to your authorized group.',403);
   let activity;
   if(data.activityId){
    if(!UUID.test(data.activityId))throw fail('Invalid activity.');
    activity=await ManualActivity.findOne({where:{id:data.activityId,groupId:data.groupId},transaction});if(!activity)throw fail('Activity not found.',404);
   }else{
    if(typeof data.title!=='string'||!data.title.trim()||data.title.length>255||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.title))throw fail('Activity title is required (maximum 255 characters).');
    if(!dateValid(data.activityDate))throw fail('Use a valid activity date.');if(!urlValid(data.externalUrl))throw fail('Enter a valid HTTP(S) URL with a host.');
    const assignmentId=data.assignmentId||null;if(assignmentId&&(!UUID.test(assignmentId)||!await Assignment.findOne({where:{id:assignmentId,groupId:data.groupId,isActive:true},transaction})))throw fail('Assignment must belong to this group.');
    const title=data.title.trim(),externalUrl=data.externalUrl?new URL(data.externalUrl).href:null;
    const legacy=await db.query(`SELECT mg.id,mg.title,mg.external_url FROM manual_grades mg JOIN manual_activities ma ON ma.id=mg.activity_id
      WHERE ma.legacy_import=true AND mg.group_id=:groupId AND mg.student_id=:studentId AND mg.activity_date=:date
      `,{replacements:{groupId:data.groupId,studentId:data.studentId,date:data.activityDate},type:QueryTypes.SELECT,transaction});
    const normalizeTitle=value=>String(value).trim().normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
    const normalizeUrl=value=>{if(!value)return null;try{return new URL(value).href;}catch{return String(value).trim();}};
    if(legacy.some(row=>normalizeTitle(row.title)===normalizeTitle(title)&&normalizeUrl(row.external_url)===externalUrl))throw fail('An imported grade matches this activity. Review and edit that existing grade first.',409);
    const identityKey=crypto.createHash('sha256').update(JSON.stringify([data.groupId,assignmentId,title.normalize('NFKC').toLowerCase().replace(/\s+/g,' '),externalUrl,data.activityDate])).digest('hex');
    // Serialize the same activity identity across different students/replicas.
    await db.query('SELECT pg_advisory_xact_lock(hashtext(:key))',{replacements:{key:identityKey},transaction});
    [activity]=await ManualActivity.findOrCreate({where:{identityKey},defaults:{groupId:data.groupId,teacherId:req.user.id,assignmentId,title,externalUrl,activityDate:data.activityDate},transaction});
   }
   const existing=await ManualGrade.findOne({where:{activityId:activity.id,studentId:data.studentId},transaction});
   if(existing)throw fail('A grade already exists for this student and activity. Edit or reactivate that grade instead of creating a duplicate.',409);
   const created=await ManualGrade.create({...v,studentId:data.studentId,groupId:data.groupId,teacherId:req.user.id,activityId:activity.id,title:activity.title,externalUrl:activity.externalUrl,activityDate:activity.activityDate,version:1,history:[{action:'created',by:req.user.id,at:new Date().toISOString(),after:v}]},{transaction});
   await record(req.user.id,'manual_grade.created',created.id,{activityId:activity.id,studentId:created.studentId,after:snapshot(created)},transaction);return created;
  });res.status(201).json({success:true,data:{grade}});
 }catch(e){respondError(res,e);}
});
router.get('/:id/history',async(req,res)=>{
 try{if(!UUID.test(req.params.id))throw fail('Invalid grade ID.');const grade=await ManualGrade.findByPk(req.params.id);if(!grade||!await access.groupAccess(req.user,grade.groupId))throw fail('Grade not found.',404);const events=await AuditEvent.findAll({where:{subjectId:grade.id,action:{[Op.like]:'manual_grade.%'}},order:[['createdAt','ASC']]});res.json({success:true,data:{history:grade.history,events}});}catch(e){respondError(res,e);}
});
async function modify(req,res,archive=false){
 try{
  if(!UUID.test(req.params.id))throw fail('Invalid grade ID.');
  if(!Number.isInteger(req.body.version)||req.body.version<1)throw fail('The current grade version is required. Refresh the grade.');
  if(typeof req.body.reason!=='string'||!req.body.reason.trim()||req.body.reason.length>500)throw fail('Enter a correction reason (maximum 500 characters).');
  const grade=await db.transaction(async transaction=>{
   // Lock student before grade, consistent with membership/credential changes.
   const ref=await ManualGrade.findByPk(req.params.id,{transaction});if(!ref||!await canWrite(req,ref.groupId,ref.studentId,transaction))throw fail('Grade not found.',404);
   const current=await ManualGrade.findByPk(req.params.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(current.version!==req.body.version)throw fail('Grade changed in another session. Refresh before correcting it.',409);
   const before=snapshot(current);
   if(!archive){
    for(const k of ['title','externalUrl','activityDate','studentId','groupId','activityId'])if(req.body[k]!==undefined&&String(req.body[k]??'')!==String(current[k]??''))throw fail('Activity identity cannot be changed by editing a grade.');
    Object.assign(current,values({...current.get(),...req.body}));
    if(req.body.isActive!==undefined){if(typeof req.body.isActive!=='boolean')throw fail('Invalid grade state.');current.isActive=req.body.isActive;}
   }else current.isActive=false;
   current.version+=1;const action=archive?'archived':'updated',at=new Date().toISOString();current.history=[...(current.history||[]),{action,by:req.user.id,at,reason:req.body.reason.trim(),before,after:snapshot(current)}];
   await current.save({transaction});await record(req.user.id,`manual_grade.${action}`,current.id,{reason:req.body.reason.trim(),before,after:snapshot(current)},transaction);return current;
  });res.json({success:true,data:{grade},message:archive?'Grade archived; history preserved.':'Grade corrected.'});
 }catch(e){respondError(res,e);}
}
router.patch('/:id',(req,res)=>modify(req,res));router.delete('/:id',(req,res)=>modify(req,res,true));
module.exports=router;
