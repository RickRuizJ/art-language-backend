'use strict';
require('dotenv').config();
const fs=require('fs'),path=require('path'),db=require('./database');
const directory=path.join(__dirname,'..','migrations');
const files=()=>fs.readdirSync(directory).filter(n=>/\.(sql|js)$/.test(n)).sort();
async function runMigrations(){
 await db.authenticate();
 const connection=await db.connectionManager.getConnection();
 try{
  await connection.query('SELECT pg_advisory_lock(1945012026)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename varchar(255) PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const filename of files()){
   const [applied]=await db.query('SELECT filename FROM schema_migrations WHERE filename=:filename',{replacements:{filename}});
   if(applied.length){console.log(`Already applied: ${filename}`);continue;}
   const file=path.join(directory,filename);
   console.log(`Applying: ${filename}`);
   if(filename.endsWith('.sql')){
    const sql=fs.readFileSync(file,'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'');
    await db.transaction(async transaction=>{
     await db.query(sql,{transaction});
     await db.query('INSERT INTO schema_migrations(filename) VALUES(:filename)',{replacements:{filename},transaction});
    });
   }else{
    // The legacy JS migration is additive and re-entrant; its own queries predate transaction options.
    await require(file).up(db.getQueryInterface(),require('sequelize'));
    await db.query('INSERT INTO schema_migrations(filename) VALUES(:filename)',{replacements:{filename}});
   }
   console.log(`Applied: ${filename}`);
  }
 }finally{try{await connection.query('SELECT pg_advisory_unlock(1945012026)');}finally{await db.connectionManager.releaseConnection(connection);}}
}
if(require.main===module)runMigrations().then(()=>db.close()).catch(async error=>{console.error('Migration failed. Database category:',error.original?.code || error.name,'No destructive synchronization was attempted. Review the schema in staging.');await db.close();process.exitCode=1;});
module.exports={runMigrations,files};
