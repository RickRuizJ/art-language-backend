const {Op}=require('sequelize');
const {Assignment,GroupMember,User}=require('../models');
const MODES=['score','incorrect','answers','full','after_review'];
const TYPES=['fill_blank','multiple_choice','true_false','matching','essay','short_answer'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function questionsOf(ws){return (ws.questions||[]).filter(q=>!['external_link','google_embed'].includes(q.type)).map((q,i)=>({...q,id:q.id||`legacy-${i+1}`,text:q.text||q.question||`Question ${i+1}`,points:Number.isFinite(Number(q.points))?Number(q.points):10}));}
// Explicit projection prevents new/unknown answer-key properties leaking to students.
function publicQuestion(q){
 const out={id:q.id,type:q.type,text:q.text||q.question||'',points:q.points};
 if(q.options)out.options=q.options;
 if(q.type==='multiple_choice')out.answerFormat=Number.isInteger(q.correctAnswer)?'index':'value';
 if(q.type==='matching'){out.pairs=(q.pairs||[]).map(p=>({left:p.left}));out.matchingOptions=[...new Set((q.pairs||[]).map(p=>p.right))].sort();}
 if(q.type==='ordering')out.items=[...(q.items||q.options||q.correctOrder||[])].sort();
 if(['external_link','google_embed'].includes(q.type)){for(const k of ['originalUrl','embedUrl','url','googleType','host'])if(q[k])out[k]=q[k];}
 return out;
}
function publicWorksheet(ws){const plain=ws.toJSON?ws.toJSON():{...ws};plain.questions=(plain.questions||[]).map((q,i)=>publicQuestion({...q,id:q.id||`legacy-${i+1}`}));return plain;}
async function assigned(studentId,worksheetId,transaction){
 const [members,student]=await Promise.all([GroupMember.findAll({where:{studentId},attributes:['groupId'],transaction}),User.findByPk(studentId,{attributes:['groupId'],transaction})]);
 const ids=[...new Set([...members.map(m=>m.groupId),student?.groupId].filter(Boolean))];
 return ids.length?Assignment.findOne({where:{worksheetId,groupId:{[Op.in]:ids},isActive:{[Op.not]:false}},transaction}):null;
}
function validateLayout(body,fileId){
 if(!Number.isInteger(body.revision)||body.revision<0)throw fail('Layout revision is required.');
 if(!MODES.includes(body.feedbackMode))throw fail('Choose a valid feedback policy.');
 if(!Number.isInteger(body.maxAttempts)||body.maxAttempts<0||body.maxAttempts>100)throw fail('Attempts must be 0 (unlimited) to 100.');
 if(!Array.isArray(body.fields)||!body.fields.length||body.fields.length>100)throw fail('Add 1 to 100 fields.');
 if(!Number.isInteger(body.pageCount)||body.pageCount<1||body.pageCount>200)throw fail('PDF must have 1 to 200 pages.');
 const seen=new Set(),questions=[],geometry=[];
 for(const [i,f] of body.fields.entries()){
  if(typeof f.id!=='string'||f.id.length>100||!f.id||seen.has(f.id))throw fail('Field IDs must be unique.');seen.add(f.id);
  if(!TYPES.includes(f.type))throw fail('Unsupported field type.');
  if(!Number.isInteger(f.page)||f.page<1||f.page>body.pageCount)throw fail('Invalid field page.');
  if(['x','y','width','height'].some(k=>typeof f[k]!=='number'||!Number.isFinite(f[k]))||f.x<0||f.y<0||f.width<0.025||f.height<0.02||f.x+f.width>1.000001||f.y+f.height>1.000001)throw fail('Fields must fit inside the PDF page.');
  if(!Number.isInteger(f.points)||f.points<1||f.points>100)throw fail('Use whole points from 1 to 100.');
  const q={id:f.id,type:f.type,text:String(f.text||`Field ${i+1}`).slice(0,1000),points:f.points,caseSensitive:f.caseSensitive===true,teacherReview:f.teacherReview===true||f.type==='essay'};
  if(['fill_blank','short_answer'].includes(f.type)){
   const acceptable=Array.isArray(f.acceptedAnswers)?f.acceptedAnswers:[];
   if(acceptable.length>30||acceptable.some(a=>typeof a!=='string'||a.length>1000))throw fail('Invalid accepted answers.');
   q.acceptedAnswers=acceptable.map(a=>a.trim()).filter(Boolean);
   if(!q.teacherReview&&!q.acceptedAnswers.length)throw fail('Enter accepted answers or enable Teacher Review.');
  }
  if(f.type==='multiple_choice'){
   if(!Array.isArray(f.options)||f.options.length<2||f.options.length>12||f.options.some(o=>typeof o!=='string'||!o.trim()||o.length>300)||new Set(f.options).size!==f.options.length)throw fail('Use 2 to 12 distinct options.');
   q.options=f.options;q.correctAnswer=f.correctAnswer;
   if(!q.options.includes(q.correctAnswer))throw fail('Select the correct option.');
  }
  if(f.type==='true_false'){if(!['true','false'].includes(String(f.correctAnswer)))throw fail('Select true or false.');q.correctAnswer=String(f.correctAnswer);}
  if(f.type==='matching'){
   if(!Array.isArray(f.pairs)||f.pairs.length<2||f.pairs.length>10||f.pairs.some(p=>typeof p.left!=='string'||typeof p.right!=='string'||!p.left.trim()||!p.right.trim()||p.left.length>200||p.right.length>200)||new Set(f.pairs.map(p=>p.left)).size!==f.pairs.length)throw fail('Add 2 to 10 pairs with distinct left items.');
   q.pairs=f.pairs.map(p=>({left:p.left,right:p.right}));
  }
  q.sampleAnswer=typeof f.sampleAnswer==='string'?f.sampleAnswer.slice(0,2000):'';
  questions.push(q);geometry.push({id:f.id,page:f.page,x:f.x,y:f.y,width:f.width,height:f.height});
 }
 return {questions,interactiveLayout:{version:1,fileId,pageCount:body.pageCount,fields:geometry},feedbackMode:body.feedbackMode,maxAttempts:body.maxAttempts,autoGrade:true};
}
function cleanAnswers(answers,questions){
 if(!Array.isArray(answers)||answers.length>100)throw fail('Invalid answers.');
 const ids=new Set(questions.map(q=>q.id)),seen=new Set();
 for(const a of answers){if(!a||!ids.has(a.questionId)||seen.has(a.questionId)||JSON.stringify(a.answer??null).length>12000)throw fail('Unknown, duplicate or oversized answer.');seen.add(a.questionId);}
 return answers.map(a=>({questionId:a.questionId,answer:a.answer??null}));
}
function studentSubmission(sub){
 const s=sub.toJSON?sub.toJSON():{...sub},snapshot=s.gradingSnapshot,mode=snapshot?.feedbackMode||'score';
 delete s.gradingSnapshot;delete s.attemptToken;
 if(s.worksheet)s.worksheet=publicWorksheet(s.worksheet);
 const final=['graded','reviewed'].includes(s.status),released=final&&(mode!=='after_review'||s.status==='reviewed');
 if(!released){s.score=null;s.autoScore=null;s.feedback=null;}
 if(snapshot&&!['full','after_review'].includes(mode))s.feedback=null;
 s.percentage=released&&Number(s.maxScore)>0?Math.round(Number(s.score)/Number(s.maxScore)*100):null;
 s.answers=(s.answers||[]).map(a=>{
  const result={questionId:a.questionId,answer:a.answer};
  if(released&&mode!=='score'){
   result.isCorrect=a.isCorrect;result.pointsEarned=a.pointsEarned;result.maxPoints=a.maxPoints;
   if(['full','after_review'].includes(mode))result.comment=a.comment||'';
   if(['answers','full','after_review'].includes(mode)){
    const q=snapshot?.questions?.find(q=>q.id===a.questionId);
    if(q)result.solution=q.acceptedAnswers?.length?q.acceptedAnswers:q.correctAnswer??q.pairs??q.correctAnswers??q.correctOrder??q.sampleAnswer;
   }
  }
  return result;
 });
 return {...s,feedbackReleased:released,feedbackMode:mode};
}
module.exports={MODES,fail,questionsOf,publicQuestion,publicWorksheet,assigned,validateLayout,cleanAnswers,studentSubmission};
