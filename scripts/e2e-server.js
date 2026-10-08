// Dedicated local test server. Never mounted by the production entry point.
const url=process.env.TEST_DATABASE_URL;
if(!url||!/^postgres(?:ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):\d+\/[^?]*test/i.test(url))throw Error('Use a loopback TEST_DATABASE_URL with a test database name.');
process.env.DATABASE_URL=url;process.env.NODE_ENV='test';process.env.JWT_SECRET='browser-tests-only';process.env.CLOUDINARY_CLOUD_NAME='test';process.env.CLOUDINARY_API_KEY='test';process.env.CLOUDINARY_API_SECRET='test';
const http=require('http'),fs=require('fs'),path=require('path'),db=require('../src/config/database'),m=require('../src/models'),cloud=require('../src/config/cloudinary');
(async()=>{
 await db.sync();await require('../src/config/migrate').runMigrations();
 const teacher=await m.User.create({email:'teacher@e2e.test',password:'testPassword1',firstName:'Teacher',lastName:'Test',role:'teacher'});
 const student=await m.User.create({email:'student@e2e.test',password:'testPassword1',firstName:'Student',lastName:'Test',role:'student'});
 const group=await m.Group.create({name:'E2E class',teacherId:teacher.id});await m.GroupMember.create({groupId:group.id,studentId:student.id});
 const fixture=fs.readFileSync(path.join(__dirname,'../tests/fixtures/worksheet.pdf'));
 cloud.uploader.upload_stream=(o,cb)=>({end:()=>cb(null,{secure_url:'http://localhost:5000/fixture.pdf',public_id:o.public_id})});
 const app=require('../src/app');
 const server=http.createServer((req,res)=>{if(req.url==='/fixture.pdf'){res.writeHead(200,{'Content-Type':'application/pdf','Access-Control-Allow-Origin':'*'});res.end(fixture);}else app(req,res);});
 server.listen(5000,'127.0.0.1',()=>console.log('E2E_READY '+JSON.stringify({groupId:group.id,studentId:student.id})));
 process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
})().catch(e=>{console.error(e);process.exit(1);});
