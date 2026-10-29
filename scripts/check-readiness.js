'use strict';
require('dotenv').config();
const db=require('../src/config/database');
require('../src/config/readiness').check(true).then(async ready=>{console.log(ready?'READY: required schema and migration ledger verified.':'NOT READY: check migrations, constraints and database configuration.');await db.close();process.exitCode=ready?0:1;}).catch(async()=>{console.error('NOT READY: database check failed.');await db.close();process.exitCode=1;});
