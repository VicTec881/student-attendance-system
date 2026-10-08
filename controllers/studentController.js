const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { AppError } = require('../middleware/errorMiddleware');

const FIELDS = [
  'studentId',
  'registrationNumber',
  'fullName',
  'gender',
  'dateOfBirth',
  'email',
  'phone',
  'className',
  'course',
  'yearOfStudy',
  'admissionDate',
  'status',
];
const UPDATABLE = FIELDS.filter((f) => f !== 'studentId');

const SORTABLE = [
  'studentId',
  'registrationNumber',
  'fullName',
  'className',
  'course',
  'yearOfStudy',
  'createdAt',
];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Invalid student ID.', 400);
  }
};

// Copies only allowed fields from the request body (prevents unwanted fields)
const pick = (body, allowed) => {
  const data = {};
  for (const field of allowed) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object') {
      throw new AppError(`Invalid value provided for ${field}.`, 422);
    }
    data[field] = value;
  }
  return data;
};

const validateDates = (data) => {
  if (data.dateOfBirth !== undefined) {
    const dob = new Date(data.dateOfBirth);
    if (isNaN(dob.getTime())) throw new AppError('Invalid date of birth.', 422);
    if (dob > new Date()) throw new AppError('Date of birth cannot be in the future.', 422);
  }
  if (data.admissionDate !== undefined) {
    const adm = new Date(data.admissionDate);
    if (isNaN(adm.getTime())) throw new AppError('Invalid admission date.', 422);
  }
};

// GET /api/students   (admin, teacher)
// Query: search, className, course, status, yearOfStudy, sortBy, order, page, limit
exports.getStudents = async (req, res) => {
  const { search, className, course, status, yearOfStudy, sortBy, order } = req.query;

  for (const [name, value] of Object.entries({ search, className, course, status, yearOfStudy, sortBy, order })) {
    if (value !== undefined && typeof value !== 'string') {
      throw new AppError(`Invalid value provided for ${name}.`, 400);
    }
  }

  const filter = {};

  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$or = [{ studentId: pattern }, { registrationNumber: pattern }, { fullName: pattern }];
  }
  if (className && className.trim()) {
    filter.className = new RegExp(`^${escapeRegex(className.trim())}$`, 'i');
  }
  if (course && course.trim()) {
    filter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
  }
  if (status !== undefined) {
    if (!['Active', 'Inactive'].includes(status)) {
      throw new AppError('Status must be Active or Inactive.', 422);
    }
    filter.status = status;
  }
  if (yearOfStudy !== undefined) {
    const year = Number(yearOfStudy);
    if (!Number.isInteger(year) || year < 1 || year > 10) {
      throw new AppError('Year of study must be a number between 1 and 10.', 422);
    }
    filter.yearOfStudy = year;
  }

  const sortField = sortBy === undefined ? 'studentId' : sortBy;
  if (!SORTABLE.includes(sortField)) {
    throw new AppError(`Cannot sort by ${sortField}.`, 422);
  }
  if (order !== undefined && !['asc', 'desc'].includes(order)) {
    throw new AppError('Order must be asc or desc.', 422);
  }
  const sortDirection = order === 'desc' ? -1 : 1;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const [total, students] = await Promise.all([
    Student.countDocuments(filter),
    Student.find(filter)
      .sort({ [sortField]: sortDirection })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    count: students.length,
    students,
  });
};

// GET /api/students/:id   (admin, teacher, or the student themselves)
exports.getStudent = async (req, res) => {
  checkId(req.params.id);

  // A student may only view their OWN record
  if (req.user.role === 'student') {
    if (!req.user.student || String(req.user.student) !== String(req.params.id)) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
  }

  const student = await Student.findById(req.params.id);
  if (!student) throw new AppError('Student not found.', 404);

  res.status(200).json({ success: true, student });
};

// POST /api/students   (admin, teacher)
exports.createStudent = async (req, res) => {
  const data = pick(req.body || {}, FIELDS);

  if (Object.keys(data).length === 0) {
    throw new AppError('Student information is required.', 400);
  }
  validateDates(data);

  // Missing fields are reported by the model (422); duplicates by the unique
  // indexes (409), both through errorMiddleware.
  const student = await Student.create(data);

  res.status(201).json({
    success: true,
    message: 'Student added successfully.',
    student,
  });
};

// PUT /api/students/:id   (admin)
exports.updateStudent = async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};

  const student = await Student.findById(req.params.id);
  if (!student) throw new AppError('Student not found.', 404);

  if (body.studentId !== undefined && String(body.studentId).trim().toUpperCase() !== student.studentId) {
    throw new AppError('Student ID cannot be changed.', 400);
  }

  const data = pick(body, UPDATABLE);
  if (Object.keys(data).length === 0) {
    throw new AppError('Provide at least one field to update.', 400);
  }
  validateDates(data);

  Object.assign(student, data);
  await student.save();

  res.status(200).json({
    success: true,
    message: 'Student updated successfully.',
    student,
  });
};

// DELETE /api/students/:id   (admin)
exports.deleteStudent = async (req, res) => {
  checkId(req.params.id);

  const student = await Student.findById(req.params.id);
  if (!student) throw new AppError('Student not found.', 404);

  // Remove the student's attendance records and login account too
  await Attendance.deleteMany({ student: student._id });
  await User.deleteOne({ student: student._id });
  await student.deleteOne();

  res.status(200).json({ success: true, message: 'Student deleted successfully.' });
};