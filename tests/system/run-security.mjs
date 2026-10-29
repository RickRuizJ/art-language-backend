import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {spawn} from 'node:child_process';
const db=await PGlite.create({extensions:{pg_trgm,pgcrypto}});
const socket=new PGLiteSocketServer({db,port:55436,host:'127.0.0.1',maxConnections:30});await socket.start();
try{
 const child=spawn(process.execPath,['scripts/remediation-integration-test.js'],{cwd:new URL('../../',import.meta.url),env:{...process.env,AL_EPHEMERAL_TEST_DB:'1',TEST_DATABASE_URL:'postgresql://audit:audit@127.0.0.1:55436/remediation_test'},stdio:'inherit'});
 process.exitCode=await new Promise(resolve=>child.on('exit',resolve));
}finally{await socket.stop();await db.close();}
