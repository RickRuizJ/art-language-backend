const {QueryTypes}=require('sequelize');
const db=require('../config/database');
const {fail}=require('../services/interactive.service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function filters(req){
 const p={teacherId:req.user.id,admin:req.user.role==='admin',groupId:null,studentId:null,worksheetId:null,from:null,to:null};
 for(const k of ['groupId','studentId','worksheetId'])if(req.query[k]){if(!UUID.test(req.query[k]))throw fail(`Invalid ${k}.`);p[k]=req.query[k];}
 for(const k of ['from','to'])if(req.query[k]){if(!/^\d{4}-\d{2}-\d{2}$/.test(req.query[k])||(Number.isNaN(Date.parse(req.query[k]))||new Date(req.query[k]).toISOString().slice(0,10)!==req.query[k]))throw fail('Use dates in YYYY-MM-DD format.');p[k]=req.query[k];}
 if(p.from&&p.to&&p.from>p.to)throw fail('Start date must be before end date.');
 return p;
}
// Every report is calculated from scoped assignments, memberships and real submissions.
// Latest attempt in the selected date range; resources without scores affect completion only.
const CTE=`WITH membership AS (
 SELECT group_id,student_id FROM group_members
 UNION SELECT group_id,id FROM users WHERE role='student' AND group_id IS NOT NULL
), group_cohort AS (
 SELECT DISTINCT g.id AS group_id,g.name AS group_name,u.id AS student_id,
 u.first_name||' '||u.last_name AS student_name,w.id AS worksheet_id,w.title AS worksheet_title
 FROM groups g JOIN membership m ON m.group_id=g.id JOIN users u ON u.id=m.student_id
 JOIN assignments a ON a.group_id=g.id AND a.is_active IS DISTINCT FROM FALSE
 JOIN worksheets w ON w.id=a.worksheet_id
 WHERE (:admin OR (g.teacher_id=:teacherId AND w.created_by=:teacherId))
 AND (CAST(:groupId AS uuid) IS NULL OR g.id=CAST(:groupId AS uuid))
 AND (CAST(:studentId AS uuid) IS NULL OR u.id=CAST(:studentId AS uuid))
 AND (CAST(:worksheetId AS uuid) IS NULL OR w.id=CAST(:worksheetId AS uuid))
 AND (CAST(:to AS date) IS NULL OR a.created_at < ((CAST(:to AS date)+INTERVAL '1 day') AT TIME ZONE 'UTC'))
), cohort AS (
 SELECT DISTINCT student_id,student_name,worksheet_id,worksheet_title FROM group_cohort
), ranked AS (
 SELECT s.*,ROW_NUMBER() OVER(PARTITION BY s.student_id,s.worksheet_id ORDER BY s.attempt_number DESC,s.submitted_at DESC,s.id DESC) AS rank,
 COUNT(*) OVER(PARTITION BY s.student_id,s.worksheet_id) AS attempt_count
 FROM submissions s JOIN cohort c ON c.student_id=s.student_id AND c.worksheet_id=s.worksheet_id
 WHERE (CAST(:from AS date) IS NULL OR s.submitted_at>=(CAST(:from AS date)::timestamp AT TIME ZONE 'UTC'))
 AND (CAST(:to AS date) IS NULL OR s.submitted_at<((CAST(:to AS date)+INTERVAL '1 day') AT TIME ZONE 'UTC'))
), latest AS (SELECT * FROM ranked WHERE rank=1), data AS (
 SELECT c.*,s.id AS submission_id,s.status,s.score,s.max_score,s.time_spent_seconds,s.submitted_at,s.attempt_count,
 CASE WHEN s.status IN ('graded','reviewed') AND s.max_score>0 THEN s.score*100.0/s.max_score ELSE NULL END AS percentage,
 CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.answers,'[]')) v WHERE v->>'requiresManualReview'='true')
 OR (s.status IN ('pending','submitted') AND s.max_score>0) OR (s.grading_snapshot->>'feedbackMode'='after_review' AND s.status<>'reviewed') THEN 1 ELSE 0 END AS needs_review
 FROM cohort c LEFT JOIN latest s ON s.student_id=c.student_id AND s.worksheet_id=c.worksheet_id
)`;
const METRICS=`COUNT(*)::int AS assigned,COUNT(submission_id)::int AS completed,
 COALESCE(SUM(needs_review),0)::int AS "toReview",ROUND(AVG(percentage),1)::float AS "averageScore",
 ROUND(AVG(time_spent_seconds) FILTER(WHERE submission_id IS NOT NULL))::int AS "averageTimeSeconds",
 ROUND(AVG(attempt_count) FILTER(WHERE submission_id IS NOT NULL),2)::float AS "averageAttempts",
 COALESCE(SUM(attempt_count),0)::int AS attempts,MAX(submitted_at) AS "lastActivity"`;
const queries={
 students:`SELECT student_id AS id,student_name AS name,${METRICS} FROM data GROUP BY student_id,student_name`,
 worksheets:`SELECT worksheet_id AS id,worksheet_title AS name,${METRICS} FROM data GROUP BY worksheet_id,worksheet_title`,
 groups:`SELECT g.group_id AS id,g.group_name AS name,${METRICS} FROM group_cohort g JOIN data d ON d.student_id=g.student_id AND d.worksheet_id=g.worksheet_id GROUP BY g.group_id,g.group_name`,
 questions:`SELECT s.worksheet_id AS "worksheetId",w.title AS "worksheetTitle",answer->>'questionId' AS id,
 COALESCE(MAX(q->>'text'),MAX(q->>'question'),'Question') AS name,
 COUNT(*)::int AS evaluated,COUNT(*) FILTER(WHERE answer->>'isCorrect'='false')::int AS incorrect,
 ROUND(100.0*COUNT(*) FILTER(WHERE answer->>'isCorrect'='false')/NULLIF(COUNT(*),0),1)::float AS "incorrectPercent"
 FROM latest s JOIN worksheets w ON w.id=s.worksheet_id
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.answers,'[]')) answer
 LEFT JOIN LATERAL jsonb_array_elements(COALESCE(s.grading_snapshot->'questions',w.questions,'[]')) q ON q->>'id'=answer->>'questionId'
 WHERE answer->>'isCorrect' IN ('true','false') AND COALESCE(answer->>'requiresManualReview','false')='false'
 GROUP BY s.worksheet_id,w.title,answer->>'questionId'`
};
exports.getAnalytics=async(req,res)=>{
 try{
  const p=filters(req),view=req.query.view||'students';if(!queries[view])throw fail('Invalid report.');
  const limit=Math.min(100,Math.max(1,parseInt(req.query.limit)||20)),page=Math.max(1,parseInt(req.query.page)||1);
  const summary=(await db.query(`${CTE} SELECT ${METRICS} FROM data`,{replacements:p,type:QueryTypes.SELECT}))[0];
  const query=queries[view],order=view==='questions'?'"incorrectPercent" DESC,evaluated DESC,id':'name,id';
  const rows=await db.query(`${CTE}, report AS (${query}) SELECT *,COUNT(*) OVER()::int AS "totalRows" FROM report ORDER BY ${order} LIMIT :limit OFFSET :offset`,{replacements:{...p,limit,offset:(page-1)*limit},type:QueryTypes.SELECT});
  // Empty page after a filter has no window row; report count separately only in that case.
  let total=rows[0]?.totalRows||0;
  if(!rows.length&&page>1)total=Number((await db.query(`${CTE} SELECT COUNT(*)::int AS n FROM (${query}) report`,{replacements:p,type:QueryTypes.SELECT}))[0].n);
  res.json({success:true,data:{summary,rows:rows.map(({totalRows,...r})=>({...r,...(view==='students'?{needsAttention:(r.averageScore!=null&&r.averageScore<70)||(r.assigned-r.completed>=3)}:{})})),total,page,pages:Math.max(1,Math.ceil(total/limit)),rule:'latest_attempt_in_date_range',attentionRule:'Average below 70% or at least 3 incomplete assignments in this view.'}});
 }catch(e){console.error('Analytics:',e.message);res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not load analytics.'});}
};
exports.getOptions=async(req,res)=>{
 try{
  const type=req.query.type||'groups',search=String(req.query.search||'').slice(0,100),p={teacherId:req.user.id,admin:req.user.role==='admin',search:`%${search}%`};
  const sql={groups:`SELECT id,name FROM groups WHERE (:admin OR teacher_id=:teacherId) AND name ILIKE :search ORDER BY name LIMIT 50`,worksheets:`SELECT id,title AS name FROM worksheets WHERE (:admin OR created_by=:teacherId) AND title ILIKE :search ORDER BY title LIMIT 50`,students:`SELECT DISTINCT u.id,u.first_name||' '||u.last_name AS name FROM users u WHERE u.role='student' AND (:admin OR EXISTS(SELECT 1 FROM groups g WHERE g.teacher_id=:teacherId AND (g.id=u.group_id OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.student_id=u.id)))) AND (u.first_name||' '||u.last_name) ILIKE :search ORDER BY name LIMIT 50`}[type];
  if(!sql)throw fail('Invalid filter type.');res.json({success:true,data:{options:await db.query(sql,{replacements:p,type:QueryTypes.SELECT}),limit:50}});
 }catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not load filters.'});}
};
