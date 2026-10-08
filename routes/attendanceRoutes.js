const express = require('express');
const {
  getAttendanceSheet,
  getAttendanceSummary,
  getAttendance,
  getAttendanceById,
  markAttendance,
  updateAttendance,
  deleteAttendance,
} = require('../controllers/attendanceController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect); // every attendance route requires a login

// "/sheet" and "/summary" must come before "/:id" so they are not treated as IDs
router.get('/sheet', requireRole('admin', 'teacher'), getAttendanceSheet);
router.get('/summary', getAttendanceSummary); // students are limited to themselves in the controller

router.get('/', getAttendance);
router.get('/:id', getAttendanceById);

router.post('/', requireRole('admin', 'teacher'), markAttendance);
router.put('/:id', requireRole('admin', 'teacher'), updateAttendance);
router.delete('/:id', requireRole('admin'), deleteAttendance);

module.exports = router;