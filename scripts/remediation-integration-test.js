if(process.env.AL_EPHEMERAL_TEST_DB!=='1')throw new Error('Run this test only through the isolated tests/system runner.');
'use strict';
const url=process.env.TEST_DATABASE_URL;
if(!url||!/^postgres(?:ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/[^?]*test/i.test(url))throw Error('Use an isolated loopback TEST_DATABASE_URL.');
const crypto=require('crypto'),fs=require('fs'),path=require('path');
const password=crypto.randomBytes(18).toString('hex');
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url,JWT_SECRET:crypto.randomBytes(32).toString('hex'),TEACHER_REGISTRATION_PASSWORD:crypto.randomBytes(24).toString('hex'),RESEND_API_KEY:'stub-only',EMAIL_FROM:'audit@example.test',FRONTEND_URL:'http://localhost:3000',RATE_LIMIT_MAX:'10000',AUTH_RATE_LIMIT_MAX:'1000',LOGIN_ACCOUNT_MAX:'100',RECOVERY_EMAIL_HOURLY_MAX:'100'});
const db=require('../src/config/database'),models=require('../src/models'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),request=require('supertest');
const {User,Group,GroupMember,Worksheet,Assignment,Submission,ManualGrade,ManualActivity,PasswordReset,AuditEvent,EmailJob}=models;
const results=[];const check=(name,ok,detail={})=>{results.push({name,status:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);};
const id=()=>crypto.randomUUID();
(async()=>{
 // Build a representative pre-remediation schema using the shipped legacy migrations, not ORM sync.
 const migrations=path.join(__dirname,'../src/migrations');
 await db.query('CREATE TABLE schema_migrations(filename varchar(255) PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 for(const filename of require('../src/config/migrate').files().filter(f=>f!=='20261028b_security_remediation.sql')){
  if(filename.endsWith('.sql'))await db.query(fs.readFileSync(path.join(migrations,filename),'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm,''));
  else await require(path.join(migrations,filename)).up(db.getQueryInterface(),require('sequelize'));
  await db.query('INSERT INTO schema_migrations(filename)VALUES(:filename)',{replacements:{filename}});
 }
 const hash=(await bcrypt.hash(password,10)).replace('$2b$','$2a$');
 const makeOld=async(email,role,extra={})=>{const uid=id();await db.query('INSERT INTO users(id,email,password,first_name,last_name,role,teacher_id,group_id)VALUES(:id,:email,:password,:first,:last,:role,:teacher,:group)',{replacements:{id:uid,email,password:hash,first:extra.firstName||'Audit',last:'Test',role,teacher:extra.teacherId||null,group:extra.groupId||null}});return {id:uid,email,role};};
 const t1=await makeOld('teacher1@example.test','teacher'),t2=await makeOld('teacher2@example.test','teacher'),admin=await makeOld('admin@example.test','admin');
 const g1=await Group.create({name:'Group A',teacherId:t1.id,joinCode:'TEST23'}),g2=await Group.create({name:'Group B',teacherId:t2.id,joinCode:'TEST56'});
 const v=await makeOld('veronica-test@example.test','student',{firstName:'Veronica TEST',teacherId:t1.id,groupId:g1.id});
 const outsider=await makeOld('outsider@example.test','student',{teacherId:t2.id,groupId:g2.id});
 const shared=await makeOld('shared@example.test','student',{teacherId:t1.id,groupId:g1.id});
 const legacy=await makeOld('legacy@example.test','student',{groupId:g1.id});
 // GroupMember model now declares a unique index, but no sync has run: test actual duplicate migration.
 await GroupMember.bulkCreate([{groupId:g1.id,studentId:v.id},{groupId:g1.id,studentId:v.id},{groupId:g2.id,studentId:outsider.id},{groupId:g1.id,studentId:shared.id},{groupId:g2.id,studentId:shared.id}]);
 const ws=await Worksheet.create({title:'Automatic audit task',createdBy:t1.id,questions:[{id:'q1',type:'multiple_choice',question:'Test',options:['A','B'],correctAnswer:'A',points:10}]});
 const ws2=await Worksheet.create({title:'Private teacher B task',createdBy:t2.id});
 const a=await Assignment.create({worksheetId:ws.id,groupId:g1.id,assignedBy:t1.id});
 const sub=await Submission.create({worksheetId:ws.id,studentId:v.id,score:10,maxScore:10,status:'graded',answers:[],attemptNumber:1});
 const foreign=await Submission.create({worksheetId:ws2.id,studentId:shared.id,score:3,maxScore:10,status:'graded',answers:[],attemptNumber:1});
 const oldGrades=[];for(const score of [4,5]){const gid=id();await db.query('INSERT INTO manual_grades(id,student_id,group_id,teacher_id,title,score,max_score,activity_date,history)VALUES(:id,:student,:group,:teacher,\'Imported activity\',:score,10,\'2026-10-28\',\'[{"action":"created"}]\'::jsonb)',{replacements:{id:gid,student:legacy.id,group:g1.id,teacher:t1.id,score}});oldGrades.push(gid);}
 const before={};for(const table of ['users','groups','worksheets','assignments','submissions','manual_grades'])before[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
 await require('../src/config/migrate').runMigrations();await require('../src/config/migrate').runMigrations();
 for(const table of Object.keys(before)){const after=(await db.query(`SELECT * FROM ${table} ORDER BY id`))[0];check(`migration preserves ${table}`,before[table].every(row=>{const found=after.find(x=>x.id===row.id);return found&&Object.entries(row).every(([k,value])=>JSON.stringify(found[k])===JSON.stringify(value));}));}
 check('duplicate memberships retained as archived evidence',(await db.query('SELECT count(*)::int AS n FROM membership_duplicate_archive'))[0][0].n===1&&await GroupMember.count({where:{groupId:g1.id,studentId:v.id}})===1);
 check('legacy direct membership normalized',Boolean(await GroupMember.findOne({where:{groupId:g1.id,studentId:legacy.id}})));
 check('both existing manual grades retained',await ManualGrade.count({where:{id:oldGrades}})===2&&(await ManualActivity.count({where:{legacyImport:true}}))===2);
 check('required schema becomes ready',await require('../src/config/readiness').check(true));
 const app=require('../src/app');
 const token=async u=>require('../src/controllers/authController').generateToken(await User.findByPk(u.id));
 const call=(method,path,t,body)=>{let r=request(app)[method](path);if(t)r=r.set('Authorization',`Bearer ${t}`);return body===undefined?r:r.send(body);};
 const login=(email,p=password)=>call('post','/api/auth/login',null,{email,password:p});
 const T1=await token(t1),T2=await token(t2),AD=await token(admin);let V=await token(v);
 let r=await login(v.email);check('existing bcrypt account logs in after migration',r.status===200);check('no password/hash exposed',r.body.data?.user?.password===undefined&&!JSON.stringify(r.body).includes(hash));
 r=await login(t1.email);check('existing teacher logs in',r.status===200);
 r=await call('get','/api/auth/me',jwt.sign({id:v.id},process.env.JWT_SECRET,{expiresIn:-1}));check('expired token rejected',r.status===401);
 r=await call('get','/api/manage-students',V);check('student cannot manage accounts',r.status===403);
 const registration={email:'new@example.test',firstName:'New',lastName:'Student',password,role:'student'};
 for(const [label,body,status] of [['missing code',registration,400],['invalid code',{...registration,registrationCode:'WRONG2'},400],['admin escalation',{...registration,role:'admin'},400],['wrong teacher secret',{...registration,role:'teacher',teacherAuthorization:'incorrect-test-value'},403],['non-string password',{...registration,password:123456789},400],['over-72-byte password',{...registration,password:'á'.repeat(40)},400]]){r=await call('post','/api/auth/register',null,body);check(`register rejects ${label}`,r.status===status,{status:r.status});}
 r=await call('post','/api/auth/register',null,{...registration,password:'short',registrationCode:g1.joinCode});check('validation redacts password',r.status===400&&!JSON.stringify(r.body).includes('short'));
 r=await call('post','/api/auth/register',null,{...registration,registrationCode:g1.joinCode,teacherId:t2.id,role:'student',isActive:false});check('registration uses group and role from server',r.status===201&&r.body.data.user.teacherId===t1.id&&r.body.data.user.isActive===true);const newStudent=r.body.data?.user;
 r=await call('post','/api/auth/register',null,{...registration,registrationCode:g1.joinCode});check('duplicate account rejected',r.status===409);
 r=await call('post','/api/auth/register',null,{...registration,email:'newteacher@example.test',role:'teacher',teacherAuthorization:process.env.TEACHER_REGISTRATION_PASSWORD});check('shared registration secret creates only teacher',r.status===201&&r.body.data.user.role==='teacher'&&!JSON.stringify(r.body).includes(process.env.TEACHER_REGISTRATION_PASSWORD));
 r=await login('newteacher@example.test');check('teacher personal login does not require general secret',r.status===200);
 const oldGeneral=process.env.TEACHER_REGISTRATION_PASSWORD;process.env.TEACHER_REGISTRATION_PASSWORD='rotated-test-secret';r=await call('post','/api/auth/register',null,{...registration,email:'rotated@example.test',role:'teacher',teacherAuthorization:oldGeneral});check('rotation invalidates old general secret',r.status===403);
 for(const method of ['patch','password']){r=method==='patch'?await call('patch',`/api/manage-students/${outsider.id}`,T1,{firstName:'Intrusion'}):await call('post',`/api/manage-students/${outsider.id}/set-password`,T1,{password});check(`unrelated teacher cannot ${method}`,r.status===404);}
 r=await call('post','/api/manage-students',T1,{email:'temporary@example.test',firstName:'Temporary',lastName:'Test',groupId:g1.id,password});const temp=r.body.data?.student;check('teacher creates temporary student',r.status===201&&temp.mustChangePassword&&Date.parse(temp.temporaryPasswordExpiresAt)>Date.now());
 r=await login(temp.email);const tempToken=r.body.data?.token;check('temporary student logs in for password change',r.status===200&&r.body.data.user.mustChangePassword);
 r=await call('get','/api/students/dashboard',tempToken);check('temporary session cannot bypass password change',r.status===403&&r.body.code==='PASSWORD_CHANGE_REQUIRED');
 r=await call('get','/api/auth/me',tempToken);check('temporary session may retrieve own identity',r.status===200);
 const personal=crypto.randomBytes(18).toString('hex');r=await call('post','/api/auth/change-password',tempToken,{currentPassword:password,password:personal});check('temporary student sets personal password',r.status===200&&!r.body.data.user.mustChangePassword);const personalToken=r.body.data?.token;
 r=await call('get','/api/auth/me',tempToken);check('same-second prior token revoked by version',r.status===401);
 r=await call('get','/api/students/dashboard',personalToken);check('new session immediately works after password change',r.status===200);
 await User.update({temporaryPasswordExpiresAt:new Date(Date.now()-1000),mustChangePassword:true},{where:{id:temp.id}});r=await login(temp.email,personal);check('expired temporary credentials rejected',r.status===401);
 const original=JSON.stringify((await Submission.findByPk(sub.id)).toJSON());
 r=await call('post',`/api/manage-students/${v.id}/set-password`,T1,{password:personal});check('teacher reset preserves Veronica account and work',r.status===200&&Boolean(await User.findByPk(v.id))&&Boolean(await Assignment.findByPk(a.id))&&original===JSON.stringify((await Submission.findByPk(sub.id)).toJSON()));
 r=await call('get','/api/auth/me',V);check('teacher password reset revokes old session',r.status===401);
 r=await login(v.email,personal);V=r.body.data?.token;check('Veronica personal-password-change requirement is enforced',r.status===200&&r.body.data.user.mustChangePassword);
 r=await call('post','/api/auth/change-password',V,{currentPassword:personal,password});V=r.body.data?.token;check('Veronica completes password change without losing history',r.status===200&&original===JSON.stringify((await Submission.findByPk(sub.id)).toJSON()));
 await call('patch',`/api/manage-students/${v.id}`,T1,{isActive:false});r=await call('get','/api/auth/me',V);check('disabled account token rejected',r.status===401);await call('patch',`/api/manage-students/${v.id}`,T1,{isActive:true});r=await call('get','/api/auth/me',V);check('reactivation does not revive revoked session',r.status===401);V=await token(v);
 // Provider failures have no synchronous influence on public reset responses.
 let delivered=[];const send=async(email,link)=>delivered.push({email,link});
 const known=await call('post','/api/auth/forgot-password',null,{email:v.email}),unknown=await call('post','/api/auth/forgot-password',null,{email:'unknown@example.test'});check('public recovery response is uniform',known.status===200&&unknown.status===200&&JSON.stringify(known.body)===JSON.stringify(unknown.body));
 await require('../src/services/recovery.service').processJobs({send});check('outbox sends only to active known account',delivered.length===1&&delivered[0].email===v.email);
 const rawToken=new URL(delivered[0].link).searchParams.get('token'),reset=await PasswordReset.findOne({where:{userId:v.id}});check('reset stores only token hash with 30-minute expiry',reset.tokenHash!==rawToken&&reset.tokenHash===crypto.createHash('sha256').update(rawToken).digest('hex')&&Math.abs(Date.parse(reset.expiresAt)-Date.now()-1800000)<10000);
 const raced=await Promise.all([call('post','/api/auth/reset-password',null,{token:rawToken,password:personal}),call('post','/api/auth/reset-password',null,{token:rawToken,password})]);check('parallel reset requests yield only one success',raced.filter(x=>x.status===200).length===1&&raced.filter(x=>x.status===400).length===1,{statuses:raced.map(x=>x.status)});
 r=await call('post','/api/auth/reset-password',null,{token:rawToken,password});check('consumed token cannot be replayed',r.status===400);V=await token(v);
 const expired=crypto.randomBytes(32).toString('hex');await PasswordReset.create({userId:v.id,tokenHash:crypto.createHash('sha256').update(expired).digest('hex'),expiresAt:new Date(Date.now()-1000)});r=await call('post','/api/auth/reset-password',null,{token:expired,password});check('expired reset token rejected',r.status===400);
 await call('post','/api/auth/forgot-password',null,{email:v.email});await require('../src/services/recovery.service').processJobs({send:async()=>{throw Error('stub delivery failure');}});const knownFail=await call('post','/api/auth/forgot-password',null,{email:v.email}),unknownFail=await call('post','/api/auth/forgot-password',null,{email:'unknown@example.test'});check('provider failure does not enumerate accounts',knownFail.status===unknownFail.status&&JSON.stringify(knownFail.body)===JSON.stringify(unknownFail.body));
 const {consume}=require('../src/middleware/securityLimits');check('database rate budget is enforced',await consume('test-budget','one',2)&&await consume('test-budget','one',2)&&!await consume('test-budget','one',2));
 r=await call('post',`/api/manage-students/${outsider.id}/password-reset`,T1,{});check('teacher cannot queue recovery for unrelated student',r.status===404);
 const body={studentId:v.id,groupId:g1.id,assignmentId:a.id,title:'External activity',externalUrl:'https://example.test/activity',activityDate:'2026-10-28',score:5,maxScore:10,feedback:'Reviewed'};
 r=await call('post','/api/manual-grades',T1,body);let grade=r.body.data?.grade;check('manual grade links an activity and assignment',r.status===201&&UUID(grade.activityId)&&(await ManualActivity.findByPk(grade.activityId)).assignmentId===a.id);
 r=await call('post','/api/manual-grades',T1,body);check('repeated manual grade returns conflict',r.status===409);
 r=await call('post','/api/manual-grades',T1,{...body,activityId:grade.activityId});check('selecting same activity prevents duplicate student result',r.status===409);
 r=await call('post','/api/manual-grades',T1,{...body,studentId:shared.id,activityId:grade.activityId});check('shared activity records different student result',r.status===201&&r.body.data.grade.activityId===grade.activityId);
 r=await call('post','/api/manual-grades',T1,{...body,studentId:legacy.id,title:'Imported activity',externalUrl:'',assignmentId:'',score:3});check('matching imported grade is flagged instead of duplicated',r.status===409);
 for(const [name,patch] of [['null',{score:null}],['boolean',{score:false}],['array',{score:[5]}],['whitespace',{score:' '}],['negative',{score:-1}],['over maximum',{score:11}],['zero maximum',{maxScore:0}],['excess precision',{score:'1.234'}],['impossible date',{activityDate:'2026-02-31'}],['invalid URL',{externalUrl:'https://'}],['invalid scheme',{externalUrl:'javascript:alert(1)'}]]){r=await call('post','/api/manual-grades',T1,{...body,...patch,title:'Invalid '+name});check(`manual grade rejects ${name}`,r.status===400,{status:r.status});}
 r=await call('post','/api/manual-grades',T1,{...body,studentId:outsider.id,groupId:g2.id});check('teacher cannot create grade in unrelated group',r.status===403);
 r=await call('post','/api/manual-grades',V,body);check('student cannot create manual grade',r.status===403);
 r=await call('get',`/api/analytics?studentId=${v.id}`,T1);check('official average ignores manual results',r.status===200&&r.body.data.summary.averageScore===100&&r.body.data.manualSummary.averageScore===50,{automatic:r.body.data?.summary?.averageScore,manual:r.body.data?.manualSummary?.averageScore});
 r=await call('get','/api/students/dashboard',V);check('student official average matches teacher automatic average',r.status===200&&r.body.stats.avgScore===100);
 r=await call('get','/api/students/grades',V);check('student academic history identifies manual and automatic',r.status===200&&r.body.data.manual.some(x=>x.id===grade.id&&x.source==='manual')&&r.body.data.automatic.some(x=>x.id===sub.id&&x.source==='automatic'));
 const held=await Worksheet.create({title:'Awaiting publication',createdBy:t1.id,feedbackMode:'after_review'});await Assignment.create({worksheetId:held.id,groupId:g1.id,assignedBy:t1.id});await Submission.create({worksheetId:held.id,studentId:v.id,score:9,maxScore:10,status:'graded',answers:[],gradingSnapshot:{feedbackMode:'after_review',questions:[]}});
 r=await call('get',`/api/analytics?studentId=${v.id}`,T1);check('official Analytics excludes unreleased feedback',r.status===200&&r.body.data.summary.averageScore===100);
 r=await call('get','/api/students/dashboard',V);check('student and teacher apply the same release gate',r.status===200&&r.body.stats.avgScore===100);
 r=await call('get',`/api/teachers/students/${shared.id}/profile`,T1);check('shared profile excludes other teacher records',r.status===200&&!r.body.recentSubmissions.some(x=>x.id===foreign.id)&&!r.body.academicHistory.automatic.some(x=>x.id===foreign.id));
 r=await call('patch',`/api/manual-grades/${grade.id}`,T2,{score:9,version:1,reason:'Unauthorized'});check('unrelated teacher cannot correct grade',r.status===404);
 const corrected=await Promise.all([call('patch',`/api/manual-grades/${grade.id}`,T1,{score:8,version:1,reason:'First correction'}),call('patch',`/api/manual-grades/${grade.id}`,T1,{score:9,version:1,reason:'Concurrent correction'})]);check('parallel grade corrections reject stale version',corrected.filter(x=>x.status===200).length===1&&corrected.filter(x=>x.status===409).length===1,{statuses:corrected.map(x=>x.status)});grade=corrected.find(x=>x.status===200)?.body.data.grade;
 check('correction history and audit are retained',grade.version===2&&grade.history.length===2&&await AuditEvent.count({where:{subjectId:grade.id}})===2);
 r=await call('delete',`/api/manual-grades/${grade.id}`,T1,{version:grade.version,reason:'Archive test'});check('archive preserves grade and history',r.status===200&&!(await ManualGrade.findByPk(grade.id)).isActive);grade=r.body.data.grade;
 r=await call('patch',`/api/manual-grades/${grade.id}`,T1,{version:grade.version,reason:'Restore reviewed result',isActive:true});check('archived grade can be explicitly restored',r.status===200&&r.body.data.grade.isActive);grade=r.body.data.grade;
 check('manual actions never alter automatic submission',JSON.stringify((await Submission.findByPk(sub.id)).toJSON())===original);
 let immutable=false;try{await db.query("UPDATE audit_events SET action='forged' WHERE subject_id=:id",{replacements:{id:grade.id}});}catch{immutable=true;}check('audit events are append-only in database',immutable);
 await require('../src/services/recovery.service').enqueue(newStudent.email);const refreshedStudent=await User.findByPk(newStudent.id);refreshedStudent.password=personal;await refreshedStudent.save();const staleDeliveries=[];await require('../src/services/recovery.service').processJobs({send:async(email)=>staleDeliveries.push(email)});check('password changes invalidate pending recovery jobs',!staleDeliveries.includes(newStudent.email));
 // Export exceeds historical 200-row UI limit and neutralizes formula-leading data.
 const activities=[],grades=[];for(let i=0;i<205;i++){const activityId=id();activities.push({id:activityId,groupId:g1.id,teacherId:t1.id,identityKey:crypto.createHash('sha256').update('csv'+i).digest('hex'),title:i===0?'=1+1':'CSV '+i,activityDate:'2026-10-28'});grades.push({activityId,groupId:g1.id,teacherId:t1.id,studentId:v.id,title:i===0?'=1+1':'CSV '+i,score:1,maxScore:2,activityDate:'2026-10-28'});}
 await ManualActivity.bulkCreate(activities);await ManualGrade.bulkCreate(grades);
 r=await call('get',`/api/manual-grades?studentId=${v.id}`,T1);check('manual listing is paginated with accurate total',r.status===200&&r.body.data.grades.length===25&&r.body.data.total===206);
 r=await call('get',`/api/manual-grades/export?studentId=${v.id}`,T1);check('CSV export includes all filtered rows and safe formula text',r.status===200&&r.text.split('\r\n').filter(Boolean).length===207&&r.text.includes('"\'=1+1"'));
 r=await call('get','/api/manual-grades',T2);check('manual listing excludes other teacher grades',r.status===200&&r.body.data.total===0);
 for(const route of [`/api/manage-students/${v.id}/groups/${g1.id}`,`/api/groups/${g1.id}/students/${v.id}`]){
  if(!await GroupMember.findOne({where:{groupId:g1.id,studentId:v.id}}))await GroupMember.create({groupId:g1.id,studentId:v.id});await User.update({groupId:g1.id,teacherId:t1.id},{where:{id:v.id}});
  r=await call('delete',route,T1);check(`group removal clears both representations: ${route.startsWith('/api/manage')?'new':'legacy'}`,r.status===200&&!await GroupMember.findOne({where:{groupId:g1.id,studentId:v.id}})&&!(await User.findByPk(v.id)).groupId);
  r=await call('get','/api/students/assignments',V);check('removed student cannot access group assignments',r.status===200&&!r.body.assignments.some(x=>x.worksheetId===ws.id));
  r=await call('patch',`/api/manage-students/${v.id}`,T1,{firstName:'Residual permission'});check('former teacher loses management after last removal',r.status===404);
  check('removal preserves student and all grades',Boolean(await User.findByPk(v.id))&&Boolean(await Submission.findByPk(sub.id))&&await ManualGrade.count({where:{studentId:v.id}})===206);
 }
 // A stale teacher_id never grants rights when the student belongs exclusively elsewhere.
 await User.update({teacherId:t1.id,groupId:g2.id},{where:{id:v.id}});await GroupMember.findOrCreate({where:{groupId:g2.id,studentId:v.id}});r=await call('post',`/api/manage-students/${v.id}/set-password`,T1,{password});check('stale teacher_id cannot authorize account takeover',r.status===404);
 const gradeCountBeforeArchive=await ManualGrade.count();r=await call('delete',`/api/groups/${g1.id}`,T1);check('group archive preserves history and closes assignments',r.status===200&&!(await Group.findByPk(g1.id)).isActive&&Boolean(await Assignment.findByPk(a.id))&&!(await Assignment.findByPk(a.id)).isActive&&await ManualGrade.count()===gradeCountBeforeArchive);r=await call('get','/api/manage-students',T1);check('archived group grants no residual student management',r.status===200&&r.body.data.students.length===0);r=await call('post','/api/groups/join',await token(outsider),{joinCode:g1.joinCode});check('existing student cannot join inactive group',r.status===404);
 r=await call('post','/api/auth/register',null,{...registration,email:'inactive@example.test',registrationCode:g1.joinCode});check('new student cannot register with inactive code',r.status===400);
 r=await call('get','/api/manage-students',AD);check('administrator retains authorized management',r.status===200);
 const audited=await AuditEvent.findAll();check('audit never contains passwords, tokens or shared registration secret',![password,personal,rawToken,process.env.TEACHER_REGISTRATION_PASSWORD,hash].some(value=>JSON.stringify(audited).includes(value)));
 // Readiness must detect real schema failures and an explicit migration failure state.
 await db.query('ALTER TABLE manual_grades RENAME COLUMN version TO version_unavailable');check('readiness rejects missing required column',!await require('../src/config/readiness').check(true));await db.query('ALTER TABLE manual_grades RENAME COLUMN version_unavailable TO version');require('../src/config/readiness').failed();check('readiness rejects migration failure',!await require('../src/config/readiness').check(true));require('../src/config/readiness').reset();check('readiness recovers only after verified schema',await require('../src/config/readiness').check(true));
 const outcome={checks:results,passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length};fs.mkdirSync(path.join(__dirname,'../tests/system/results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../tests/system/results/security-results.json'),JSON.stringify(outcome,null,2));console.log('REMEDIATION RESULT',JSON.stringify({passed:outcome.passed,failed:outcome.failed}));await db.close();process.exitCode=outcome.failed?1:0;
})().catch(async error=>{console.error('Security test failed:',error.message,error.stack);try{await db.close();}catch{}process.exitCode=1;});
function UUID(value){return /^[0-9a-f-]{36}$/i.test(value||'');}
