// Baseline contracts for existing working routes; external storage and DB are isolated.
jest.mock('../src/models',()=>({User:{findByPk:jest.fn(),findOne:jest.fn()},Worksheet:{findByPk:jest.fn()},Workbook:{findAll:jest.fn(),findByPk:jest.fn()},WorkbookWorksheet:{},Group:{findAll:jest.fn(),findByPk:jest.fn()},GroupMember:{findAll:jest.fn()},Assignment:{findOne:jest.fn(),findByPk:jest.fn(),create:jest.fn()},FileUpload:{findOne:jest.fn()},Submission:{},Message:{}}));
const express=require('express'),request=require('supertest'),m=require('../src/models');
const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'teacher',role:'teacher'};next();});
const wc=require('../src/controllers/worksheetController'),ac=require('../src/controllers/assignmentController'),bc=require('../src/controllers/workbookController');
app.put('/worksheets/:id',wc.updateWorksheet);app.post('/worksheets/:id/publish',wc.togglePublish);app.delete('/worksheets/:id',wc.deleteWorksheet);app.post('/groups/:groupId/assignments',ac.assignWorksheet);app.get('/workbooks',bc.getAllWorkbooks);
let ws;
beforeEach(()=>{jest.clearAllMocks();ws={id:'w',createdBy:'teacher',isPublished:true,questions:[],save:jest.fn(),destroy:jest.fn(),toJSON(){return {id:this.id,title:this.title,isPublished:this.isPublished,questions:[]};}};m.Worksheet.findByPk.mockResolvedValue(ws);});
test('publish and unpublish preserve file resource with zero questions',async()=>{let r=await request(app).post('/worksheets/w/publish');expect(r.status).toBe(200);expect(ws.isPublished).toBe(false);r=await request(app).post('/worksheets/w/publish');expect(r.status).toBe(200);expect(ws.isPublished).toBe(true);});
test('edit metadata of resource',async()=>{const r=await request(app).put('/worksheets/w').send({title:'Edited PDF'});expect(r.status).toBe(200);expect(ws.title).toBe('Edited PDF');});
test('delete owned resource',async()=>{expect((await request(app).delete('/worksheets/w')).status).toBe(200);expect(ws.destroy).toHaveBeenCalled();});
test('another teacher cannot edit resource',async()=>{ws.createdBy='other';expect((await request(app).put('/worksheets/w').send({title:'Bad'})).status).toBe(403);});
test('workbook list uses existing fixed aliases',async()=>{m.Workbook.findAll.mockResolvedValue([{toJSON:()=>({id:'b',worksheets:[{id:'w',worksheetOrder:{displayOrder:0}}]})}]);const r=await request(app).get('/workbooks');expect(r.status).toBe(200);expect(r.body.data.workbooks[0].worksheets[0].id).toBe('w');});
afterAll(async()=>require('../src/config/database').close());
