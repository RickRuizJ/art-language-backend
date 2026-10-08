/**
 * Flujo completo contra PostgreSQL REAL de pruebas (registro → grupo → links/archivos →
 * asignar → alumno abre/entrega → profesor revisa). Cloudinary se simula localmente.
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/lms_test npm run test:integration
 * ⚠️ BORRA el esquema "public" de esa base; sólo corre si su nombre contiene "test".
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !/\/[^/?]*test[^/?]*(\?|$)/i.test(testUrl)) {
  console.error('Define TEST_DATABASE_URL apuntando a una base cuyo nombre contenga "test". No se ejecutó nada.');
  process.exit(2);
}
process.env.JWT_SECRET='s'; process.env.NODE_ENV='test'; process.env.DATABASE_URL=testUrl;
process.env.CLOUDINARY_CLOUD_NAME='x';process.env.CLOUDINARY_API_KEY='x';process.env.CLOUDINARY_API_SECRET='x';
const http=require('http'),request=require('supertest');
const sequelize=require('../src/config/database');const models=require('../src/models');const cloud=require('../src/config/cloudinary');
const app=require('../src/app');
let p=0,f=0;const ok=(n,c,x)=>{c?(p++,console.log('  ✓',n)):(f++,console.log('  ✗',n,x!==undefined?JSON.stringify(x).slice(0,300):''))};
const PDF=Buffer.from('%PDF-1.4 x');
(async()=>{
 const st=http.createServer((q,r)=>{r.writeHead(200);r.end(PDF)}).listen(0);const port=st.address().port;
 cloud.uploader.upload_stream=(o,cb)=>({end:()=>cb(null,{secure_url:`http://127.0.0.1:${port}/${o.public_id}`,public_id:o.public_id})});
 await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
 // esquema "viejo": SIN sync de columnas nuevas para probar la migración → usamos sync y luego migraciones
 await sequelize.sync();
 const {execSync}=require('child_process');
 const out=execSync('node src/config/migrate.js',{cwd:require('path').join(__dirname,'..')}).toString();//,
 console.log(out.split('\n').filter(l=>/applied|failed|Migration/.test(l)).join('\n'));
 const T=t=>({Authorization:'Bearer '+t});
 const mk=async(email,role,fn)=>{await models.User.create({email,password:'secret1',firstName:fn,lastName:'X',role});const r=await request(app).post('/api/auth/login').send({email,password:'secret1'});return {tok:r.body.data.token,id:r.body.data.user.id}};
 let r=await request(app).post('/api/auth/register').send({email:'x@x.com',password:'secret1',firstName:'A',lastName:'B',role:'teacher'});
 ok('registro público no crea profesores',r.status!==201||r.body.data.user.role==='student',r.body);
 const t=await mk('t@x.com','teacher','Pro'),t2=await mk('t2@x.com','teacher','Otro'),a=await mk('a@x.com','student','Ana'),b=await mk('b@x.com','student','Beto');
 r=await request(app).post('/api/groups').set(T(t.tok)).send({name:'G'});const gid=r.body.data.group.id,code=r.body.data.group.joinCode;
 await request(app).post('/api/groups/join').set(T(a.tok)).send({joinCode:code});
 console.log('LINKS');
 for(const [u,exp] of [['https://www.bbc.co.uk/learningenglish',null],['https://docs.google.com/spreadsheets/d/S1/edit#gid=0','https://docs.google.com/spreadsheets/d/S1/preview'],['https://docs.google.com/presentation/d/P1/edit','https://docs.google.com/presentation/d/P1/embed'],['https://docs.google.com/forms/d/e/F1/viewform?usp=sf','https://docs.google.com/forms/d/e/F1/viewform?embedded=true'],['https://youtu.be/abc123','https://www.youtube.com/embed/abc123']]){
  r=await request(app).post('/api/worksheets/external-link').set(T(t.tok)).send({title:'L',url:u});
  const e=r.body?.data?.worksheet?.questions?.[0]?.embedUrl??null;
  ok(`link ${u.slice(8,40)} → embed ${exp?'sí':'no'}`,r.status===201&&e===exp,{s:r.status,e,exp});}
 r=await request(app).post('/api/worksheets/external-link').set(T(t.tok)).send({title:'x',url:'javascript:alert(1)'});ok('javascript: rechazado',r.status===400,r.body);
 r=await request(app).post('/api/worksheets/external-link').set(T(t.tok)).send({title:'x',url:'www.sitio.com/pagina'});ok('URL sin https:// (muy común al pegar)',r.status===201,{s:r.status,m:r.body.message});
 r=await request(app).post('/api/worksheets/external-link').set(T(t.tok)).send({title:'Link',url:'https://example.com/x'});const linkId=r.body.data.worksheet.id;
 console.log('SUBIDA');
 r=await request(app).post('/api/worksheets/upload').set(T(t.tok)).field('title','PDF').attach('file',PDF,{filename:'g.pdf',contentType:'application/pdf'});ok('subir PDF',r.status===201,r.body);const fid=r.body.data?.worksheet?.id;
 r=await request(app).post('/api/worksheets/upload').set(T(t.tok)).field('title','Word').attach('file',Buffer.from('PK'),{filename:'t.docx',contentType:'application/octet-stream'});ok('.docx enviado como octet-stream (pasa en Windows/Safari)',r.status===201,r.body);
 r=await request(app).post('/api/worksheets/upload').set(T(t.tok)).field('title','csv').attach('file',Buffer.from('a,b'),{filename:'d.csv',contentType:'application/vnd.ms-excel'});ok('.csv enviado como vnd.ms-excel (Windows)',r.status===201,r.body);
 r=await request(app).post('/api/worksheets/upload').set(T(t.tok)).field('title','mp3').attach('file',Buffer.from('ID3'),{filename:'a.mp3',contentType:'audio/mpeg'});ok('audio mp3 (útil para listening)',r.status===201,r.body.message);
 console.log('ACCESO');
 r=await request(app).get(`/api/worksheets/${linkId}`).set(T(a.tok));ok('alumno no ve hoja no asignada',[403,404].includes(r.status),r.status);
 r=await request(app).get(`/api/worksheets/${linkId}`).set(T(t2.tok));ok('otro profesor no ve mi hoja',r.status===403,r.status);
 r=await request(app).get(`/api/worksheets/${fid}/file`).set(T(a.tok));ok('alumno no obtiene archivo no asignado',r.status===403||r.status===404,r.status);
 r=await request(app).post(`/api/groups/${gid}/assignments`).set(T(t2.tok)).send({worksheetId:linkId});ok('otro profesor no asigna en mi grupo',r.status===403,r.status);
 for(const w of [linkId,fid]){r=await request(app).post(`/api/groups/${gid}/assignments`).set(T(t.tok)).send({worksheetId:w});ok('asignar',r.status===201||r.status===200,r.body);}
 r=await request(app).get(`/api/worksheets/${linkId}`).set(T(a.tok));ok('alumno abre link asignado',r.status===200,r.body);
 r=await request(app).get(`/api/worksheets/${fid}`).set(T(a.tok));ok('alumno abre archivo asignado',r.status===200,r.body);
 r=await request(app).get(`/api/worksheets/${fid}/file`).set(T(a.tok));ok('alumno obtiene URL del archivo',r.status===200&&(r.body.data.fileUrl||r.body.data.dataUrl),r.body);
 r=await request(app).get(`/api/worksheets/${fid}/file`).set(T(b.tok));ok('alumno de otro grupo NO obtiene archivo',[403,404].includes(r.status),r.status);
 console.log('QUIZ');
 r=await request(app).post('/api/worksheets').set(T(t.tok)).send({title:'Quiz',maxAttempts:3,questions:[{type:'multiple_choice',question:'Q',options:['a','b'],correctAnswer:'b',points:5},{type:'fill_blank',question:'I __',correctAnswer:'am',points:5},{type:'short_answer',question:'Describe',sampleAnswer:'m',points:10}]});ok('crear quiz',r.status===201,r.body);const qid=r.body.data.worksheet.id;
 await request(app).post(`/api/groups/${gid}/assignments`).set(T(t.tok)).send({worksheetId:qid});
 r=await request(app).get(`/api/worksheets/${qid}`).set(T(a.tok));ok('alumno ve quiz sin respuestas',r.status===200&&!/correctAnswer|sampleAnswer/.test(JSON.stringify(r.body)),r.body);
 const qs=r.body.data.worksheet.questions;
 r=await request(app).post('/api/submissions').set(T(a.tok)).send({worksheetId:qid,answers:[{questionId:qs[0].id,answer:'b'},{questionId:qs[1].id,answer:'am'},{questionId:qs[2].id,answer:'Mi día'}]});
 ok('entrega con short_answer SIN respuesta modelo (builder solo guarda sampleAnswer)',r.status===201,r.body);
 console.log('   status:',r.body.data?.submission?.status);
 r=await request(app).post('/api/submissions').set(T(a.tok)).send({worksheetId:qid,answers:[{questionId:qs[0].id,answer:'b'}]});ok('segundo intento',r.status===201,r.body);
 r=await request(app).post('/api/submissions').set(T(b.tok)).send({worksheetId:qid,answers:[]});ok('alumno sin asignación no entrega',r.status===403,r.status);
 r=await request(app).post('/api/submissions').set(T(a.tok)).send({worksheetId:linkId});ok('marcar link como completado',r.status===201,r.body);
 r=await request(app).get('/api/students/dashboard').set(T(a.tok));const s=r.body.stats;
 ok('dashboard: total 3, completadas 2, pendientes 1',s&&s.total===3&&s.completed===2&&s.pending===1,s);
 console.log('PROFESOR');
 await request(app).post('/api/groups/join').set(T(b.tok)).send({joinCode:code});
 await request(app).post('/api/submissions').set(T(b.tok)).send({worksheetId:qid,answers:[{questionId:qs[2].id,answer:'abierta'}]});
 r=await request(app).get('/api/teachers/dashboard-stats').set(T(t.tok));ok('dashboard-stats cuenta entregas por revisar (>=1)',r.body.data&&r.body.data.pendingSubmissions>=1,r.body.data);
 r=await request(app).post(`/api/groups/${gid}/assignments`).set(T(t.tok)).send({worksheetId:linkId});
 r=await request(app).get(`/api/groups/${gid}/assignments`).set(T(a.tok));ok('lista de asignaciones del grupo no filtra respuestas al alumno',r.status===200&&!/correctAnswer|sampleAnswer/.test(JSON.stringify(r.body)),r.body.data?.assignments?.length);
 r=await request(app).get('/api/worksheets').set(T(a.tok));ok('lista general del alumno no filtra respuestas',!/correctAnswer|sampleAnswer/.test(JSON.stringify(r.body)),'');
 r=await request(app).get('/api/users').set(T(t2.tok));ok('otro profesor no ve alumnos ajenos',r.body.data.users.length===0,r.body.data.users.length);
 console.log('INFRA');
 r=await request(app).post('/api/auth/login').send({email:'zz@x.com',password:'x'});
 for(let i=0;i<5;i++)r=await request(app).get('/health');ok('health ok',r.status===200,r.body);
 console.log(`\nRESULTADO ${p} OK / ${f} fallos`);st.close();await sequelize.close();process.exit(f ? 1 : 0);
})().catch(e=>{console.error('FATAL',e);process.exit(2)});
