const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const PAGES = [
  'login',
  'dashboard',
  'students',
  'attendance',
  'records',
  'reports',
  'profile',
  'teachers',
];

router.get('/', (req, res) => res.redirect('/login'));

PAGES.forEach((page) => {
  router.get(`/${page}`, (req, res, next) => {
    const file = path.join(VIEWS_DIR, `${page}.html`);
    if (!fs.existsSync(file)) return next(); // page not built yet
    res.sendFile(file);
  });
});

module.exports = router;