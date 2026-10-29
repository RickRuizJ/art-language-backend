import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../package.json',import.meta.url));
const url='postgresql://audit:audit@127.0.0.1:55439/startup_test';
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url,JWT_SECRET:randomBytes(32).toString('hex')});
const pg=await PGlite.create({extensions:{pg_trgm,pgcrypto}}),socket=new PGLiteSocketServer({db:pg,port:55439,host:'127.0.0.1',maxConnections:30});await socket.start();
const db=require('./src/config/database');const results=[];let child,log='';
const check=(name,ok)=>{results.push({name,status:ok?'PASS':'FAIL'});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
async function start(extra={}){log='';child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../../',import.meta.url),env:{...process.env,PORT:'5012',AUTO_MIGRATE:'false',AUTH_RATE_LIMIT_MAX:'2',...extra},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);await new Promise(resolve=>setTimeout(resolve,250));for(let i=0;i<150;i++){if(child.exitCode!==null)break;try{if((await fetch('http://127.0.0.1:5012/health',{signal:AbortSignal.timeout(1000)})).status===200)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}await new Promise(resolve=>setTimeout(resolve,150));}
async function stop(){if(!child||child.exitCode!==null)return;const ending=new Promise(resolve=>child.on('exit',resolve));child.kill('SIGTERM');await ending;}
try{
 await start();check('server entrypoint responds to liveness',(await fetch('http://127.0.0.1:5012/health')).status===200);check('empty schema is not ready',(await fetch('http://127.0.0.1:5012/health/ready')).status===503);check('API blocked until schema ready',(await fetch('http://127.0.0.1:5012/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status===503);await stop();
 await require('./src/config/migrate').runMigrations();await start();check('complete migrations allow readiness',(await fetch('http://127.0.0.1:5012/health/ready')).status===200);
 const statuses=[];for(let i=0;i<3;i++)statuses.push((await fetch('http://127.0.0.1:5012/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);check('configured auth IP limit works',statuses.join(',')==='400,400,429');
 const denied=await fetch('http://127.0.0.1:5012/health',{headers:{Origin:'https://not-authorized.example'}});check('CORS rejects unrelated origin without internal details',denied.status===403&&!denied.headers.has('Access-Control-Allow-Origin'));
 await db.query('ALTER TABLE manual_grades RENAME COLUMN version TO temporarily_unavailable');check('readiness validates columns, not only connectivity',(await fetch('http://127.0.0.1:5012/health/ready')).status===503);await db.query('ALTER TABLE manual_grades RENAME COLUMN temporarily_unavailable TO version');check('restored verified schema becomes ready',(await fetch('http://127.0.0.1:5012/health/ready')).status===200);await stop();
 // Prove an actual migration FK failure prevents readiness. Only this ephemeral DB is modified.
 const m=require('./src/models'),teacher=await m.User.create({email:'startup-teacher@example.test',password:randomBytes(18).toString('hex'),firstName:'Startup',lastName:'Test',role:'teacher'}),group=await m.Group.create({name:'Startup test',teacherId:teacher.id});
 const activity=await m.ManualActivity.create({groupId:group.id,teacherId:teacher.id,title:'Orphan fixture',activityDate:'2026-10-28',identityKey:randomBytes(32).toString('hex')});
 const [constraints]=await db.query("SELECT c.conname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='manual_grades'::regclass AND c.contype='f' AND a.attname='student_id'");
 for(const c of constraints)await db.query(`ALTER TABLE manual_grades DROP CONSTRAINT ${db.getQueryInterface().queryGenerator.quoteIdentifier(c.conname)}`);
 await m.ManualGrade.create({activityId:activity.id,groupId:group.id,teacherId:teacher.id,studentId:randomUUID(),title:'Orphan fixture',score:1,maxScore:2,activityDate:'2026-10-28'});
 await db.query("DELETE FROM schema_migrations WHERE filename='20261028b_security_remediation.sql'");await start({AUTO_MIGRATE:'true'});
 for(let i=0;i<100&&!log.includes('Database migration failed');i++)await new Promise(resolve=>setTimeout(resolve,100));
 check('failed migration is observed by server',log.includes('Database migration failed'));check('actual failed migration keeps readiness disabled',(await fetch('http://127.0.0.1:5012/health/ready')).status===503);await stop();
 await start({NODE_ENV:'production',DATABASE_SSL_MODE:'disable'});check('production refuses disabled TLS validation',child.exitCode!==null&&log.includes('TLS certificate validation is required'));await stop();
}catch(e){check('startup suite completed',false);console.error('Startup test error:',e.message);}finally{await stop();await db.close();await socket.stop();await pg.close();mkdirSync(new URL('./results/',import.meta.url),{recursive:true});writeFileSync(new URL('./results/startup-results.json',import.meta.url),JSON.stringify(results,null,2));console.log('STARTUP RESULT',JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}));if(results.some(r=>r.status!=='PASS'))process.exitCode=1;}
