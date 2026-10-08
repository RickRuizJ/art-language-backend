import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {browserFlow} from './browser-flow.mjs';
const backend=fileURLToPath(new URL('../../',import.meta.url));
const frontend=path.resolve(process.env.FRONTEND_DIR||path.join(backend,'../art-language-frontend'));
if(!existsSync(path.join(frontend,'.next/BUILD_ID')))throw Error('Build frontend with NEXT_PUBLIC_API_URL=http://localhost:5000/api and set FRONTEND_DIR to its absolute path.');
mkdirSync(new URL('./results/',import.meta.url),{recursive:true});
const db=await PGlite.create({extensions:{pg_trgm,pgcrypto}});
const socket=new PGLiteSocketServer({db,port:55435,host:'127.0.0.1',maxConnections:20});
await socket.start();
let api,web,code=0;
function ready(child,pattern){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('Test service did not start in 45 seconds.')),45000);
 child.stderr.pipe(process.stderr);
 child.stdout.on('data',b=>{process.stdout.write(b);const match=b.toString().match(pattern);if(match){clearTimeout(timer);resolve(match[1]);}});
 child.on('error',e=>{clearTimeout(timer);reject(e);});
 child.on('exit',n=>{clearTimeout(timer);reject(Error(`Test service exited ${n}`));});
});}
try{
 api=spawn(process.execPath,['scripts/e2e-server.js'],{cwd:backend,env:{...process.env,TEST_DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55435/browser_test'},stdio:['ignore','pipe','pipe']});
 const fixture=JSON.parse(await ready(api,/E2E_READY (.+)/));
 web=spawn(process.execPath,[path.join(frontend,'node_modules/next/dist/bin/next'),'start','-p','3000'],{cwd:frontend,stdio:['ignore','pipe','pipe']});
 await ready(web,/Ready in/);
 await browserFlow(fixture);
}catch(e){console.error(e);code=1;}
finally{api?.kill('SIGTERM');web?.kill('SIGTERM');await socket.stop();await db.close();process.exit(code);}
