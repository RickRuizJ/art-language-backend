'use strict';
const db=require('./database');
let failure=false,cache=null,checkedAt=0;
const expected={users:['id','auth_version','must_change_password','password_changed_at','temporary_password_expires_at'],groups:['id','teacher_id','join_code'],group_members:['group_id','student_id'],worksheets:['id','questions','interactive_layout'],submissions:['id','score','grading_snapshot'],assignments:['id','group_id','worksheet_id'],manual_grades:['id','activity_id','version','score','max_score'],manual_activities:['id','identity_key','assignment_id'],password_resets:['token_hash','expires_at'],audit_events:['actor_id','action','metadata'],email_jobs:['status','available_at'],rate_limit_buckets:['key','hits'],grading_policy:['official_mode']};
exports.failed=()=>{failure=true;cache=null;};exports.reset=()=>{failure=false;cache=null;};
exports.check=async(force=false)=>{
 if(failure)return false;if(!force&&cache!==null&&Date.now()-checkedAt<5000)return cache;
 try{
  for(const model of Object.values(require('../models')))if(model?.rawAttributes){const table=model.getTableName();if(typeof table==='string')expected[table]=[...new Set([...(expected[table]||[]),...Object.values(model.rawAttributes).map(attribute=>attribute.field)])];}
  const [rows]=await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()");
  if(Object.entries(expected).some(([table,cols])=>cols.some(c=>!rows.some(r=>r.table_name===table&&r.column_name===c))))throw new Error('schema');
  const [applied]=await db.query('SELECT filename FROM schema_migrations');if(require('./migrate').files().some(f=>!applied.some(r=>r.filename===f)))throw new Error('migrations');
  const [keys]=await db.query("SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('uq_group_member_student','uq_manual_grade_activity_student')");if(keys.length!==2)throw new Error('constraints');
  const [fks]=await db.query("SELECT conrelid::regclass::text AS tbl,count(*)::int AS n FROM pg_constraint WHERE contype='f' AND conrelid IN ('manual_grades'::regclass,'password_resets'::regclass) GROUP BY conrelid");if(!fks.some(r=>r.tbl==='manual_grades'&&r.n>=4)||!fks.some(r=>r.tbl==='password_resets'&&r.n>=1))throw new Error('foreign keys');
  cache=true;
 }catch{cache=false;}
 checkedAt=Date.now();return cache;
};
