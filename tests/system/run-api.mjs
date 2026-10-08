import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {spawn} from 'node:child_process';
const db=await PGlite.create({extensions:{pg_trgm,pgcrypto}});
const server=new PGLiteSocketServer({db,port:55433,host:'127.0.0.1',maxConnections:20});await server.start();
const child=spawn('node',['scripts/integration-test.js'],{cwd:new URL('../../',import.meta.url),env:{...process.env,TEST_DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55433/lms_test'},stdio:'inherit'});
let code=await new Promise(resolve=>child.on('exit',resolve));
if(!code){const next=spawn('node',['scripts/interactive-integration-test.js'],{cwd:new URL('../../',import.meta.url),env:{...process.env,TEST_DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55433/lms_test'},stdio:'inherit'});code=await new Promise(resolve=>next.on('exit',resolve));}
await server.stop();await db.close();process.exit(code);
