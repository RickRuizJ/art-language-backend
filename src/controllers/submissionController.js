const sequelize=require('../config/database');
const {fail,assigned,questionsOf,cleanAnswers,studentSubmission}=require('../services/interactive.service');
const { Op } = require('sequelize');
const { Submission, Worksheet, User, Assignment, Group, GroupMember, WorksheetDraft } = require('../models');
const gradingService = require('../services/grading.service');
const logger = require('../config/logger');

/**
 * SPRINT 0 FIX — unified grading engine
 * The local `autoGrade()` function that used to live here has been removed.
 * Grading now always goes through services/grading.service.js — the single
 * autograde engine used by the whole LMS (see that file's header comment).
 *
 * Adapter: the client submits `answers` as an array of
 * { questionId, answer }, but gradingService.gradeSubmission expects a plain
 * { [questionId]: answer } map. This function only reshapes data — no
 * grading logic lives here anymore.
 */
function answersArrayToMap(answers) {
  const map = {};
  (answers || []).forEach(a => { map[a.questionId] = a.answer; });
  return map;
}

// SPRINT 0 FIX — multiple configurable attempts.
// `Worksheet.maxAttempts` (added in this sprint's migration; null/0 = unlimited)
// replaces the previous hard block on any second submission.

// @route   POST /api/submissions
// @desc    Submit worksheet answers
// @access  Private (Student)
exports.submitWorksheet = async(req,res)=>{
 try {
  const data=await sequelize.transaction(async transaction=>{
   const {worksheetId,attemptToken}=req.body;
   const ws=await Worksheet.findByPk(worksheetId,{transaction,lock:transaction.LOCK.UPDATE});
   if(!ws)throw fail('Worksheet not found.',404);
   if(ws.isPublished===false||!await assigned(req.user.id,worksheetId,transaction))throw fail('This worksheet is not assigned or published.',403);
   if(attemptToken){
    if(!/^[0-9a-f-]{36}$/i.test(attemptToken))throw fail('Invalid attempt token.');
    const existing=await Submission.findOne({where:{attemptToken,worksheetId,studentId:req.user.id},transaction});
    if(existing)return {submission:studentSubmission(existing),attemptNumber:existing.attemptNumber,replayed:true};
   }
   const previous=await Submission.count({where:{worksheetId,studentId:req.user.id},transaction});
   if(ws.maxAttempts&&previous>=ws.maxAttempts)throw fail(`Maximum attempts reached (${ws.maxAttempts}).`);
   let draft;
   if(ws.interactiveLayout){
    draft=await WorksheetDraft.findOne({where:{worksheetId,studentId:req.user.id},transaction});
    if(!draft||draft.attemptToken!==attemptToken||draft.layoutRevision!==ws.layoutRevision)throw fail('Attempt changed. Reload the worksheet before submitting.',409);
   }
   const questions=questionsOf(ws),answers=cleanAnswers(req.body.answers||[],questions),map=Object.fromEntries(answers.map(a=>[a.questionId,a.answer]));
   const grading=questions.length&&ws.autoGrade ? await gradingService.gradeSubmission({...ws.toJSON(),questions},map) : null;
   const gradedAnswers=questions.map(q=>{
    const f=grading?.feedback.find(f=>f.questionId===q.id);
    return {questionId:q.id,answer:map[q.id]??null,isCorrect:f?.correct??null,pointsEarned:f?.pointsEarned??0,maxPoints:q.points,requiresManualReview:!f||f.requiresManualReview===true};
   });
   const pending=gradedAnswers.some(a=>a.requiresManualReview),score=questions.length?gradedAnswers.reduce((sum,a)=>sum+Number(a.pointsEarned||0),0):null;
   const startedAt=draft?.startedAt||null,elapsed=startedAt?Math.max(0,Math.round((Date.now()-new Date(startedAt).getTime())/1000)):Math.min(86400,Math.max(0,Number(req.body.timeSpentSeconds)||0));
   const submission=await Submission.create({worksheetId,studentId:req.user.id,answers:gradedAnswers,score,maxScore:questions.length?questions.reduce((sum,q)=>sum+q.points,0):null,status:pending?'submitted':questions.length?'graded':'submitted',attemptNumber:previous+1,timeSpentSeconds:Math.min(elapsed,2147483647),attemptToken:attemptToken||null,startedAt,autoScore:score,gradingSnapshot:questions.length?{questions,layoutRevision:ws.layoutRevision||0,feedbackMode:ws.feedbackMode||'score'}:null},{transaction});
   if(draft)await draft.destroy({transaction});
   const safe=studentSubmission(submission);
   return {submission:safe,attemptNumber:previous+1,attemptsRemaining:ws.maxAttempts?Math.max(0,ws.maxAttempts-previous-1):null,percentage:safe.percentage,score:safe.score,maxScore:safe.maxScore};
  });
  res.status(data.replayed?200:201).json({success:true,data});
 }catch(error){if(error.name==='SequelizeUniqueConstraintError')return res.status(409).json({success:false,message:'Submission already received. Refresh your history.'});logger.error('Submit worksheet:',error.message);res.status(error.status||500).json({success:false,message:error.status?error.message:'Could not submit. Your saved answers remain available.'});}
};

// @route   GET /api/submissions/student/:studentId
// @desc    Get student's submissions
// @access  Private
exports.getStudentSubmissions = async (req, res) => {
  try {
    const studentId = req.params.studentId;

    // Check permissions
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'teacher') {
      const membership = await GroupMember.findOne({
        where: { studentId },
        include: [{ model: Group, as: 'group', where: { teacherId: req.user.id }, attributes: ['id'] }]
      });
      const direct = await User.findOne({ where: { id: studentId, teacherId: req.user.id }, attributes: ['id'] });
      if (!membership && !direct) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const submissions = await Submission.findAll({
      where: { studentId, ...(req.query.worksheetId?{worksheetId:req.query.worksheetId}:{}) },
      limit: 200,
      include: [{
        model: Worksheet,
        as: 'worksheet',
        attributes: ['id', 'title', 'subject', 'gradeLevel'], ...(req.user.role==='teacher'?{where:{createdBy:req.user.id},required:true}:{})
      }],
      order: [['submittedAt', 'DESC'],['attemptNumber','DESC']]
    });

    res.json({
      success: true,
      data: { submissions: req.user.role==='student'?submissions.map(studentSubmission):submissions }
    });
  } catch (error) {
    logger.error('Get student submissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   GET /api/submissions/worksheet/:worksheetId
// @desc    Get all submissions for a worksheet
// @access  Private (Teacher, Admin)
exports.getWorksheetSubmissions = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.worksheetId);

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const submissions = await Submission.findAll({
      where: { worksheetId: req.params.worksheetId },
      include: [{
        model: User,
        as: 'student',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }],
      order: [['submittedAt', 'DESC'],['attemptNumber','DESC']]
    });

    res.json({
      success: true,
      data: { submissions: req.user.role==='student'?submissions.map(studentSubmission):submissions }
    });
  } catch (error) {
    logger.error('Get worksheet submissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   PUT /api/submissions/:id/grade
// @desc    Manually grade submission
// @access  Private (Teacher, Admin)
exports.gradeSubmission=async(req,res)=>{
 try{
  const submission=await sequelize.transaction(async transaction=>{
   const sub=await Submission.findByPk(req.params.id,{transaction,lock:transaction.LOCK.UPDATE});
   if(!sub)throw fail('Submission not found.',404);
   const ws=await Worksheet.findByPk(sub.worksheetId,{transaction});
   if(req.user.role!=='admin'&&ws?.createdBy!==req.user.id)throw fail('Access denied.',403);
   const feedback=String(req.body.feedback||'').slice(0,5000);
   if(sub.gradingSnapshot){
    const reviews=req.body.reviews;
    if(!Array.isArray(reviews)||reviews.length>100)throw fail('Send per-question reviews.');
    const questions=sub.gradingSnapshot.questions,seen=new Set(),answers=(sub.answers||[]).map(a=>({...a}));
    for(const review of reviews){
     const q=questions.find(q=>q.id===review.questionId),a=answers.find(a=>a.questionId===review.questionId);
     if(!q||!a||seen.has(q.id)||typeof review.points!=='number'||!Number.isFinite(review.points)||review.points<0||review.points>q.points)throw fail('Invalid review points or question.');
     seen.add(q.id);a.pointsEarned=review.points;a.comment=String(review.comment||'').slice(0,5000);a.requiresManualReview=false;a.isCorrect=review.points===q.points;
    }
    await sub.update({answers,score:answers.reduce((sum,a)=>sum+Number(a.pointsEarned||0),0),maxScore:questions.reduce((sum,q)=>sum+q.points,0),feedback,status:answers.some(a=>a.requiresManualReview)?'submitted':'reviewed',gradedBy:req.user.id,gradedAt:new Date()},{transaction});
   }else{
    const max=sub.maxScore??100,score=req.body.score;
    if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>max)throw fail(`Score must be between 0 and ${max}.`);
    await sub.update({score,maxScore:max,feedback,status:'reviewed',gradedBy:req.user.id,gradedAt:new Date()},{transaction});
   }
   return sub;
  });res.json({success:true,data:{submission}});
 }catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not save review.'});}
};

// @route   GET /api/submissions/:id
// @desc    Get single submission
// @access  Private
exports.getSubmission = async (req, res) => {
  try {
    const submission = await Submission.findByPk(req.params.id, {
      include: [
        {
          model: Worksheet,
          as: 'worksheet'
        },
        {
          model: User,
          as: 'student',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });

    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'student' && submission.studentId !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    if (req.user.role === 'teacher' && 
        submission.worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const responseSubmission = req.user.role==='student'?studentSubmission(submission):submission.toJSON();

    res.json({
      success: true,
      data: { submission: responseSubmission }
    });
  } catch (error) {
    logger.error('Get submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};
