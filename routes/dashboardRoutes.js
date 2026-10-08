const express = require('express');
const { getDashboard } = require('../controllers/dashboardController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Open to every logged-in role. The controller decides what each role sees.
router.get('/', protect, getDashboard);

module.exports = router;