const express = require('express');
const {
  getReports,
  dailyReport,
  weeklyReport,
  monthlyReport,
  studentReport,
  classReport,
  exportExcel,
  exportPdf,
} = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect); // every report route requires a login

// Report history (admin and teacher only)
router.get('/', requireRole('admin', 'teacher'), getReports);

// Exports: students may export only their own student report (enforced in the controller)
router.get('/export/excel', exportExcel);
router.get('/export/pdf', exportPdf);

// School-wide reports (admin and teacher only)
router.get('/daily', requireRole('admin', 'teacher'), dailyReport);
router.get('/weekly', requireRole('admin', 'teacher'), weeklyReport);
router.get('/monthly', requireRole('admin', 'teacher'), monthlyReport);
router.get('/class/:className', requireRole('admin', 'teacher'), classReport);

// Students may generate only their own report (enforced in the controller)
router.get('/student/:id', studentReport);

module.exports = router;