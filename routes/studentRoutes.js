const express = require('express');
const {
  getStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
} = require('../controllers/studentController');
const { protect } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');

const router = express.Router();

router.use(protect); // every student route requires a login

router.get('/', requireRole('admin', 'teacher'), getStudents);
router.post('/', requireRole('admin', 'teacher'), createStudent);

// Students may view only their own record (enforced in the controller)
router.get('/:id', getStudent);

router.put('/:id', requireRole('admin'), updateStudent);
router.delete('/:id', requireRole('admin'), deleteStudent);

module.exports = router;