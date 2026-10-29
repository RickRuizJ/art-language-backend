'use strict';
const {Sequelize}=require('sequelize');
const fs=require('fs');
const raw=process.env.DATABASE_URL||'postgresql://localhost:5432/artlanguage';
let url;try{url=new URL(raw);if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();}catch{throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');}
const production=process.env.NODE_ENV==='production';
const sslRequested=production||process.env.DATABASE_SSL_MODE==='verify-full'||/require|verify/.test(url.searchParams.get('sslmode')||'')||/neon\.tech|render\.com/i.test(url.hostname);
if(production&&process.env.DATABASE_SSL_MODE==='disable')throw new Error('Production database TLS certificate validation is required.');
// pg connection-string ssl flags must not silently override certificate validation.
for(const key of ['sslmode','ssl','sslcert','sslkey','sslrootcert','sslpassword'])url.searchParams.delete(key);
const ca=process.env.DATABASE_SSL_CA|| (process.env.DATABASE_SSL_CA_FILE?fs.readFileSync(process.env.DATABASE_SSL_CA_FILE,'utf8'):undefined);
module.exports=new Sequelize(url.toString(),{
 dialect:'postgres',logging:false,
 dialectOptions:sslRequested?{ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:10000}:{connectionTimeoutMillis:10000},
 pool:{max:8,min:0,acquire:15000,idle:10000},
 define:{timestamps:true,underscored:true,createdAt:'created_at',updatedAt:'updated_at'}
});
