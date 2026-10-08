// Runs only against an isolated test database. Does not create or replace production data.
const assert=require('node:assert/strict');
const url=process.env.TEST_DATABASE_URL;
if(!url||!/\/[^/?]*test[^/?]*(\?|$)/i.test(url))throw Error('TEST_DATABASE_URL must name an isolated test database.');
process.env.DATABASE_URL=url;process.env.NODE_ENV='test';process.env.JWT_SECRET='local-test-only';
process.env.CLOUDINARY_CLOUD_NAME='test';process.env.CLOUDINARY_API_KEY='test';process.env.CLOUDINARY_API_SECRET='test';
const request=require('supertest'),m=require('../src/models'),db=require('../src/config/database'),app=require('../src/app');
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS',name);};
const auth=t=>({Authorization:`Bearer ${t}`});
(async()=>{
 // When run standalone, initialize an empty test DB. The harness runs the baseline first.
 const tables=await db.getQueryInterface().showAllTables();if(!tables.includes('users'))await db.sync();
 const before=await m.User.count();await require('../src/config/migrate').runMigrations();await require('../src/config/migrate').runMigrations();
 const preserved=await m.User.count();check('migration preserves users and is idempotent',()=>assert.equal(preserved,before));
 const suffix=Date.now();async function user(role,name){const u=await m.User.create({email:`${name.toLowerCase()}${suffix}@example.test`,password:'testPassword1',firstName:name,lastName:'Fixture',role});const r=await request(app).post('/api/auth/login').send({email:u.email,password:'testPassword1'});assert.equal(r.status,200);return {id:u.id,token:r.body.data.token};}
 const teacher=await user('teacher','Teacher'),other=await user('teacher','Other'),student=await user('student','Student'),outsider=await user('student','Outsider');
 let r=await request(app).post('/api/groups').set(auth(teacher.token)).send({name:'Interactive test group'});assert.equal(r.status,201);const group=r.body.data.group;
 await request(app).post('/api/groups/join').set(auth(student.token)).send({joinCode:group.joinCode});
 // Cloudinary bytes are mocked; its credentials and working upload flow are not altered.
 require('../src/config/cloudinary').uploader.upload_stream=(opts,cb)=>({end:()=>cb(null,{secure_url:'https://res.cloudinary.com/test/raw/upload/test.pdf',public_id:opts.public_id})});
 r=await request(app).post('/api/worksheets/upload').set(auth(teacher.token)).field('title','Interactive PDF fixture').attach('file',Buffer.from('%PDF-1.4 fixture'),'fixture.pdf');assert.equal(r.status,201);const id=r.body.data.worksheet.id;
 r=await request(app).get(`/api/worksheets/${id}/file`).set(auth(teacher.token));check('existing uploaded PDF metadata still opens',()=>assert.equal(r.status,200));
 const fields=[{id:'text',type:'fill_blank',text:'Verb',page:1,x:.1,y:.2,width:.3,height:.08,points:2,acceptedAnswers:['I am',"I'm"]},{id:'choice',type:'multiple_choice',text:'Choice',page:1,x:.1,y:.35,width:.3,height:.08,points:2,options:['A','B'],correctAnswer:'B'},{id:'manual',type:'essay',text:'Explain',page:1,x:.1,y:.5,width:.6,height:.2,points:6,sampleAnswer:'Private model'}];
 const layout={revision:0,pageCount:1,fields,feedbackMode:'full',maxAttempts:2};
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(other.token)).send(layout);check('other teacher cannot create layout',()=>assert.equal(r.status,403));
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send({...layout,fields:[{...fields[0],x:1}]});check('rejects fields beyond PDF bounds',()=>assert.equal(r.status,400));
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send(layout);check('creates normalized interactive layout',()=>assert.equal(r.status,200));
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send({...layout,revision:1,fields:fields.slice(0,2)});check('removes field',()=>assert.equal(r.body.data.worksheet.questions.length,2));
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send({...layout,revision:2,fields:fields.map(f=>({...f,width:f.width+.01}))});check('modifies and restores fields',()=>assert.equal(r.body.data.worksheet.layoutRevision,3));
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send(layout);check('rejects stale editor revision',()=>assert.equal(r.status,409));
 await request(app).post(`/api/worksheets/${id}/publish`).set(auth(teacher.token));
 r=await request(app).post(`/api/groups/${group.id}/assignments`).set(auth(teacher.token)).send({worksheetId:id});assert.ok([200,201].includes(r.status));
 r=await request(app).get(`/api/worksheets/${id}`).set(auth(student.token));check('student receives geometry without grading keys',()=>{assert.equal(r.status,200);assert.ok(!/acceptedAnswers|correctAnswer|answerKey|solution|Private model/.test(JSON.stringify(r.body)));assert.equal(r.body.data.worksheet.interactiveLayout.fields.length,3);});
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(outsider.token)).send({revision:3});check('unassigned student cannot start attempt',()=>assert.equal(r.status,403));
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:3});assert.equal(r.status,200);let draft=r.body.data.draft;
 const answers=[{questionId:'text',answer:'  I   AM  '},{questionId:'choice',answer:'A'},{questionId:'manual',answer:'Student explanation'}];
 r=await request(app).put(`/api/worksheets/${id}/draft`).set(auth(student.token)).send({attemptToken:draft.attemptToken,answers});check('saves draft answers without consuming attempt',()=>assert.equal(r.status,200));
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:3});check('resumes same saved draft and start time',()=>{assert.equal(r.body.data.draft.attemptToken,draft.attemptToken);assert.equal(r.body.data.draft.answers.length,3);assert.equal(r.body.data.attemptNumber,1);});
 const submitBody={worksheetId:id,attemptToken:draft.attemptToken,answers};
 r=await request(app).post('/api/submissions').set(auth(student.token)).send(submitBody);check('grades objective answers, keeps manual pending',()=>{assert.equal(r.status,201);assert.equal(r.body.data.submission.status,'submitted');assert.equal(r.body.data.submission.score,null);});const sid=r.body.data.submission.id;
 r=await request(app).post('/api/submissions').set(auth(student.token)).send(submitBody);check('replayed submit does not consume another attempt',()=>{assert.equal(r.status,200);assert.equal(r.body.data.submission.id,sid);});
 r=await request(app).get(`/api/submissions/${sid}`).set(auth(outsider.token));check('student cannot view another submission',()=>assert.equal(r.status,403));
 for(const route of ['/api/students/dashboard','/api/students/assignments',`/api/groups/${group.id}/assignments`,`/api/submissions/student/${student.id}`,`/api/submissions/${sid}`]){r=await request(app).get(route).set(auth(student.token));check(`pending student response protects keys: ${route.split('?')[0]}`,()=>{assert.equal(r.status,200);assert.ok(!/gradingSnapshot|acceptedAnswers|correctAnswer|answerKey|solution|Private model/.test(JSON.stringify(r.body)));});}
 r=await request(app).get(`/api/submissions/${sid}`).set(auth(teacher.token));check('teacher sees auto score and snapshot',()=>{assert.equal(Number(r.body.data.submission.autoScore),2);assert.equal(r.body.data.submission.gradingSnapshot.questions.length,3);});
 r=await request(app).put(`/api/submissions/${sid}/grade`).set(auth(other.token)).send({reviews:[{questionId:'manual',points:6}]});check('review requires worksheet owner',()=>assert.equal(r.status,403));
 r=await request(app).put(`/api/submissions/${sid}/grade`).set(auth(teacher.token)).send({reviews:[{questionId:'manual',points:7}]});check('review rejects points over maximum',()=>assert.equal(r.status,400));
 r=await request(app).put(`/api/submissions/${sid}/grade`).set(auth(teacher.token)).send({reviews:[{questionId:'manual',points:6,comment:'Clear explanation'}],feedback:'Well done'});check('manual points recalculate final total',()=>{assert.equal(r.status,200);assert.equal(Number(r.body.data.submission.score),8);assert.equal(r.body.data.submission.status,'reviewed');});
 r=await request(app).get(`/api/submissions/${sid}`).set(auth(student.token));check('student receives released feedback only after review',()=>{assert.equal(r.body.data.submission.percentage,80);assert.ok(!r.body.data.submission.gradingSnapshot);assert.equal(r.body.data.submission.answers[2].comment,'Clear explanation');});
 for(const view of ['students','groups','worksheets','questions']){r=await request(app).get(`/api/analytics?view=${view}&worksheetId=${id}`).set(auth(teacher.token));check(`analytics ${view} query`,()=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.summary.completed,1);assert.equal(r.body.data.summary.averageScore,80);if(view==='questions')assert.equal(r.body.data.rows[0].incorrectPercent,100);});}
 r=await request(app).get(`/api/analytics?worksheetId=${id}`).set(auth(other.token));check('analytics cannot inspect another teacher',()=>assert.equal(r.body.data.summary.assigned,0));
 r=await request(app).get('/api/analytics').set(auth(student.token));check('student cannot access teacher analytics',()=>assert.equal(r.status,403));
 r=await request(app).get(`/api/analytics?worksheetId=${id}&from=2099-01-01`).set(auth(teacher.token));check('date range uses real submission dates',()=>assert.equal(r.body.data.summary.completed,0));
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:3});draft=r.body.data.draft;
 r=await request(app).post('/api/submissions').set(auth(student.token)).send({worksheetId:id,attemptToken:draft.attemptToken,answers:[]});assert.equal(r.status,201);
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:3});check('attempt limit enforced',()=>assert.equal(r.status,409));
 r=await request(app).get(`/api/analytics?worksheetId=${id}`).set(auth(teacher.token));check('analytics latest attempt does not double count completion',()=>{assert.equal(r.body.data.summary.completed,1);assert.equal(r.body.data.summary.toReview,1);assert.equal(r.body.data.summary.averageScore,null);assert.equal(r.body.data.summary.attempts,2);});
 r=await request(app).get('/api/students/assignments').set(auth(student.token));check('student assignments use latest attempt',()=>{assert.equal(r.status,200);const own=r.body.assignments.find(a=>a.worksheetId===id);assert.equal(own.submission.status,'submitted');assert.equal(own.submission.score,null);});
 r=await request(app).get('/api/analytics?from=2026-02-31').set(auth(teacher.token));check('invalid calendar dates are rejected',()=>assert.equal(r.status,400));
 // Raise limit and change the layout while a third draft is open.
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send({...layout,revision:3,maxAttempts:3});assert.equal(r.status,200);
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:4});assert.equal(r.status,200);const stale=r.body.data.draft;
 r=await request(app).put(`/api/worksheets/${id}/interactive`).set(auth(teacher.token)).send({...layout,revision:4,maxAttempts:3});assert.equal(r.status,200);
 r=await request(app).put(`/api/worksheets/${id}/draft`).set(auth(student.token)).send({attemptToken:stale.attemptToken,answers});check('layout change rejects stale saved answers',()=>assert.equal(r.status,409));
 r=await request(app).post('/api/submissions').set(auth(student.token)).send({worksheetId:id,attemptToken:stale.attemptToken,answers});check('layout change rejects stale submission',()=>assert.equal(r.status,409));
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:5});check('old draft needs explicit reset',()=>assert.equal(r.status,409));
 r=await request(app).post(`/api/worksheets/${id}/attempt`).set(auth(student.token)).send({revision:5,reset:true});check('explicit reset starts current layout without consuming an attempt',()=>{assert.equal(r.status,200);assert.notEqual(r.body.data.draft.attemptToken,stale.attemptToken);assert.equal(r.body.data.attemptNumber,3);});
 console.log(`INTERACTIVE: ${passed} checks passed`);await db.close();process.exit(0);
})().catch(async e=>{console.error(e);await db.close();process.exit(1);});
