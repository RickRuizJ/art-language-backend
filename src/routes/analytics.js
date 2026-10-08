const router=require('express').Router();
const controller=require('../controllers/analyticsController');
router.use(require('../middleware/auth'),require('../middleware/roleCheck')('teacher','admin'));
router.get('/options',controller.getOptions);
router.get('/',controller.getAnalytics);
module.exports=router;
