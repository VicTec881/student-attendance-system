const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const { AppError } = require('../middleware/errorMiddleware');
const { summarizeStudents, percentage } = require('../utils/attendanceStats');

const STATUSES = ['Present', 'Absent', 'Leave'];
const DEFAULT_SESSION = 'Full Day';
const MAX_RECORDS = 500;
const STATUS_MESSAGE = 'Invalid attendance status. Status must be Present, Absent or Leave.';
const SORTABLE = ['date', 'studentId', 'className', 'course', 'status', 'createdAt'];
const SUMMARY_SORTABLE = [
  'studentId', 'fullName', 'className', 'course',
  'totalDays', 'present', 'absent', 'leave', 'percentage',
];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = (text) => text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Invalid attendance ID.', 400);
  }
};

// Accepts YYYY-MM-DD and returns midnight UTC for that day
const parseDate = (value) => {
  if (value === undefined || value === null || value === '') {
    throw new AppError('Attendance date is required.', 400);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new AppError('Date must be in YYYY-MM-DD format.', 422);
  }
  const [y, m, d] = value.trim().split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new AppError('Invalid date.', 422);
  }
  return date;
};

// Today's date (server local calendar day) as midnight UTC
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

const requireText = (value, label) => {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new AppError(`${label} is required.`, 400);
  }
  if (typeof value !== 'string') {
    throw new AppError(`Invalid ${label}.`, 422);
  }
  return value.trim();
};

const cleanSession = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_SESSION;
  if (typeof value !== 'string') throw new AppError('Invalid session.', 422);
  const session = value.trim();
  if (session.length > 50) throw new AppError('Session cannot exceed 50 characters.', 422);
  return session ? titleCase(session) : DEFAULT_SESSION;
};

// Returns null (all dates), a Date (single day) or a { $gte, $lte } range
const buildDateFilter = (q) => {
  const { date, startDate, endDate } = q;

  if (date !== undefined && (startDate !== undefined || endDate !== undefined)) {
    throw new AppError('Use either a single date or a date range, not both.', 400);
  }
  if (date !== undefined) return parseDate(date);

  if (startDate !== undefined || endDate !== undefined) {
    const range = {};
    if (startDate !== undefined) range.$gte = parseDate(startDate);
    if (endDate !== undefined) range.$lte = parseDate(endDate);
    if (range.$gte && range.$lte && range.$gte > range.$lte) {
      throw new AppError('Invalid date range: the start date cannot be after the end date.', 422);
    }
    return range;
  }
  return null;
};

// GET /api/attendance/sheet?date=&className=&course=&session=   (admin, teacher)
exports.getAttendanceSheet = async (req, res) => {
  const date = parseDate(req.query.date);
  const className = requireText(req.query.className, 'Class');
  const course = requireText(req.query.course, 'Course/Program');
  const session = cleanSession(req.query.session);

  const students = await Student.find({
    status: 'Active',
    className: new RegExp(`^${escapeRegex(className)}$`, 'i'),
    course: new RegExp(`^${escapeRegex(course)}$`, 'i'),
  }).sort({ studentId: 1 });

  const existing = await Attendance.find({
    student: { $in: students.map((s) => s._id) },
    date,
    session,
  });
  const existingByStudent = new Map(existing.map((a) => [String(a.student), a]));

  const rows = students.map((s) => {
    const record = existingByStudent.get(String(s._id));
    return {
      student: s._id,
      studentId: s.studentId,
      registrationNumber: s.registrationNumber,
      fullName: s.fullName,
      className: s.className,
      course: s.course,
      attendanceId: record ? record._id : null,
      status: record ? record.status : null,
    };
  });

  res.status(200).json({
    success: true,
    date: req.query.date,
    className,
    course,
    session,
    alreadyMarked: existing.length > 0,
    total: rows.length,
    students: rows,
  });
};

// GET /api/attendance/summary   (admin, teacher: everyone; student: own summary only)
// Query: search, studentId, className, course, studentStatus (Active|Inactive|All),
//        date | startDate/endDate, below, sortBy, order, page, limit
exports.getAttendanceSummary = async (req, res) => {
  const q = req.query;

  for (const name of [
    'search', 'studentId', 'date', 'startDate', 'endDate', 'className',
    'course', 'studentStatus', 'below', 'sortBy', 'order',
  ]) {
    if (q[name] !== undefined && typeof q[name] !== 'string') {
      throw new AppError(`Invalid value provided for ${name}.`, 400);
    }
  }
  const { search, studentId, className, course, studentStatus, below, sortBy, order } = q;

  const dateFilter = buildDateFilter(q);

  // Which students to include
  const studentFilter = {};
  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    studentFilter.$or = [
      { studentId: pattern },
      { registrationNumber: pattern },
      { fullName: pattern },
    ];
  }
  if (studentId && studentId.trim()) {
    studentFilter.studentId = studentId.trim().toUpperCase();
  }
  if (className && className.trim()) {
    studentFilter.className = new RegExp(`^${escapeRegex(className.trim())}$`, 'i');
  }
  if (course && course.trim()) {
    studentFilter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
  }

  if (req.user.role === 'student') {
    // A student can only ever see their OWN summary
    const own = req.user.student ? await Student.findById(req.user.student) : null;
    if (!own) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
    if (studentId !== undefined && studentId.trim().toUpperCase() !== own.studentId) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
    studentFilter._id = own._id;
  } else {
    const wanted = studentStatus === undefined ? 'Active' : studentStatus;
    if (!['Active', 'Inactive', 'All'].includes(wanted)) {
      throw new AppError('Student status must be Active, Inactive or All.', 422);
    }
    if (wanted !== 'All') studentFilter.status = wanted;
  }

  let belowValue = null;
  if (below !== undefined) {
    const n = Number(below);
    if (below.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      throw new AppError('The "below" value must be a number between 0 and 100.', 422);
    }
    belowValue = n;
  }

  const sortField = sortBy === undefined ? 'studentId' : sortBy;
  if (!SUMMARY_SORTABLE.includes(sortField)) {
    throw new AppError(`Cannot sort by ${sortField}.`, 422);
  }
  if (order !== undefined && !['asc', 'desc'].includes(order)) {
    throw new AppError('Order must be asc or desc.', 422);
  }
  const direction = order === 'desc' ? -1 : 1;

  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 10, 1), 100);

  // Calculate
  let rows = await summarizeStudents({ studentFilter, dateFilter });

  // "below" only considers students who have at least one record
  if (belowValue !== null) {
    rows = rows.filter((r) => r.totalDays > 0 && r.percentage < belowValue);
  }

  // Totals across EVERY student in the result (not just this page)
  const totals = rows.reduce(
    (acc, r) => {
      acc.totalDays += r.totalDays;
      acc.present += r.present;
      acc.absent += r.absent;
      acc.leave += r.leave;
      if (r.totalDays === 0) acc.studentsWithNoRecords += 1;
      return acc;
    },
    { totalDays: 0, present: 0, absent: 0, leave: 0, studentsWithNoRecords: 0 }
  );

  // Sort (ties are always broken by Student ID, ascending)
  const byId = (a, b) =>
    a.studentId.localeCompare(b.studentId, undefined, { numeric: true, sensitivity: 'base' });
  rows.sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const primary =
      typeof av === 'string'
        ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
        : av - bv;
    return primary !== 0 ? primary * direction : byId(a, b);
  });

  const pageRows = rows.slice((page - 1) * limit, page * limit);

  res.status(200).json({
    success: true,
    total: rows.length,
    page,
    pages: Math.ceil(rows.length / limit),
    count: pageRows.length,
    overall: {
      students: rows.length,
      studentsWithNoRecords: totals.studentsWithNoRecords,
      totalDays: totals.totalDays,
      present: totals.present,
      absent: totals.absent,
      leave: totals.leave,
      percentage: percentage(totals.present, totals.totalDays),
    },
    students: pageRows,
  });
};

// GET /api/attendance   (admin, teacher: all records; student: own records only)
// Query: search, studentId, date, startDate, endDate, className, course,
//        session, status, sortBy, order, page, limit
exports.getAttendance = async (req, res) => {
  const q = req.query;

  for (const name of [
    'search', 'studentId', 'date', 'startDate', 'endDate',
    'className', 'course', 'session', 'status', 'sortBy', 'order',
  ]) {
    if (q[name] !== undefined && typeof q[name] !== 'string') {
      throw new AppError(`Invalid value provided for ${name}.`, 400);
    }
  }
  const {
    search, studentId, className, course, session, status, sortBy, order,
  } = q;

  const filter = {};

  // Date or date range
  const dateFilter = buildDateFilter(q);
  if (dateFilter) filter.date = dateFilter;

  if (className && className.trim()) {
    filter.className = new RegExp(`^${escapeRegex(className.trim())}$`, 'i');
  }
  if (course && course.trim()) {
    filter.course = new RegExp(`^${escapeRegex(course.trim())}$`, 'i');
  }
  if (session && session.trim()) {
    filter.session = titleCase(session.trim());
  }
  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      throw new AppError('Status must be Present, Absent or Leave.', 422);
    }
    filter.status = status;
  }

  // Students may only ever see their own records
  let ownStudent = null;
  if (req.user.role === 'student') {
    if (req.user.student) ownStudent = await Student.findById(req.user.student);
    if (!ownStudent) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
    if (
      studentId !== undefined &&
      studentId.trim().toUpperCase() !== ownStudent.studentId
    ) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
  }

  // Search and student filters work through the Student collection
  const studentQuery = {};
  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    studentQuery.$or = [
      { studentId: pattern },
      { registrationNumber: pattern },
      { fullName: pattern },
    ];
  }
  if (studentId && studentId.trim()) {
    studentQuery.studentId = studentId.trim().toUpperCase();
  }
  if (ownStudent) studentQuery._id = ownStudent._id;

  if (Object.keys(studentQuery).length > 0) {
    const ids = await Student.distinct('_id', studentQuery);
    filter.student = { $in: ids };
  }

  // Sorting
  const sortField = sortBy === undefined ? 'date' : sortBy;
  if (!SORTABLE.includes(sortField)) {
    throw new AppError(`Cannot sort by ${sortField}.`, 422);
  }
  if (order !== undefined && !['asc', 'desc'].includes(order)) {
    throw new AppError('Order must be asc or desc.', 422);
  }
  const direction =
    order === 'asc' ? 1
    : order === 'desc' ? -1
    : sortField === 'date' || sortField === 'createdAt' ? -1
    : 1;
  const sort = { [sortField]: direction };
  if (sortField !== 'studentId') sort.studentId = 1;

  // Pagination
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 10, 1), 100);

  let listQuery = Attendance.find(filter).populate(
    'student',
    'studentId registrationNumber fullName'
  );
  if (req.user.role !== 'student') {
    listQuery = listQuery.populate('markedBy', 'fullName role');
  } else {
    listQuery = listQuery.select('-markedBy'); // students never see who marked it
  }

  const [total, records, grouped] = await Promise.all([
    Attendance.countDocuments(filter),
    listQuery.sort(sort).skip((page - 1) * limit).limit(limit),
    Attendance.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = Object.fromEntries(grouped.map((g) => [g._id, g.count]));

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    count: records.length,
    summary: {
      total,
      present: counts.Present || 0,
      absent: counts.Absent || 0,
      leave: counts.Leave || 0,
    },
    records,
  });
};

// GET /api/attendance/:id   (admin, teacher; student only for their own record)
exports.getAttendanceById = async (req, res) => {
  checkId(req.params.id);

  const query = Attendance.findById(req.params.id);
  if (req.user.role === 'student') query.select('-markedBy');
  const record = await query;
  if (!record) throw new AppError('Attendance record not found.', 404);

  if (req.user.role === 'student') {
    if (!req.user.student || String(record.student) !== String(req.user.student)) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
  }

  await record.populate('student', 'studentId registrationNumber fullName');
  if (req.user.role !== 'student') {
    await record.populate('markedBy', 'fullName role');
  }

  res.status(200).json({ success: true, attendance: record });
};

// POST /api/attendance   (admin, teacher)
// Body: { date, className, course, session?, records: [{ student, status }] }
exports.markAttendance = async (req, res) => {
  const body = req.body || {};

  const date = parseDate(body.date);
  if (date > today()) {
    throw new AppError('Attendance cannot be marked for a future date.', 422);
  }
  const className = requireText(body.className, 'Class');
  const course = requireText(body.course, 'Course/Program');
  const session = cleanSession(body.session);

  const { records } = body;
  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError('At least one student attendance record is required.', 400);
  }
  if (records.length > MAX_RECORDS) {
    throw new AppError(`You can save at most ${MAX_RECORDS} records at a time.`, 422);
  }

  // Validate every record before touching the database
  const seen = new Set();
  const entries = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      throw new AppError('Invalid attendance record.', 422);
    }
    if (!record.student) {
      throw new AppError('Student is required for every attendance record.', 400);
    }
    if (typeof record.student !== 'string' || !mongoose.isValidObjectId(record.student)) {
      throw new AppError('Invalid student ID in the attendance records.', 400);
    }
    if (!STATUSES.includes(record.status)) {
      throw new AppError(STATUS_MESSAGE, 422);
    }
    if (seen.has(record.student)) {
      throw new AppError('The same student appears more than once in this attendance list.', 422);
    }
    seen.add(record.student);
    entries.push({ student: record.student, status: record.status });
  }

  // Every student must exist, be active, and belong to the selected class/course
  const students = await Student.find({ _id: { $in: entries.map((e) => e.student) } });
  if (students.length !== entries.length) {
    throw new AppError('One or more students do not exist.', 404);
  }
  for (const s of students) {
    if (s.status !== 'Active') {
      throw new AppError(`${s.fullName} (${s.studentId}) is inactive and cannot be marked.`, 422);
    }
    if (
      s.className.toLowerCase() !== className.toLowerCase() ||
      s.course.toLowerCase() !== course.toLowerCase()
    ) {
      throw new AppError(
        `${s.fullName} (${s.studentId}) does not belong to ${className} - ${course}.`,
        422
      );
    }
  }
  const studentById = new Map(students.map((s) => [String(s._id), s]));

  // Refuse duplicates up front so a class is never saved half-way
  const duplicates = await Attendance.countDocuments({
    student: { $in: students.map((s) => s._id) },
    date,
    session,
  });
  if (duplicates > 0) {
    throw new AppError(
      `Attendance has already been recorded for ${duplicates} of these students on this date and session. Nothing was saved. Edit the existing records instead.`,
      409
    );
  }

  const docs = entries.map((entry) => {
    const s = studentById.get(entry.student);
    return {
      student: s._id,
      studentId: s.studentId,
      date,
      className: s.className,
      course: s.course,
      session,
      status: entry.status,
      markedBy: req.user._id,
    };
  });

  // Unique index is the final safety net (errorMiddleware turns it into a 409)
  await Attendance.insertMany(docs);

  const count = (status) => entries.filter((e) => e.status === status).length;

  res.status(201).json({
    success: true,
    message: 'Attendance saved successfully.',
    summary: {
      date: body.date,
      className,
      course,
      session,
      total: entries.length,
      present: count('Present'),
      absent: count('Absent'),
      leave: count('Leave'),
    },
  });
};

// PUT /api/attendance/:id   (admin; teacher only for records they marked)
// Only the status can be changed.
exports.updateAttendance = async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};

  const extra = Object.keys(body).filter((key) => key !== 'status');
  if (extra.length > 0) {
    throw new AppError('Only the attendance status can be edited.', 400);
  }
  if (body.status === undefined) {
    throw new AppError('Attendance status is required.', 400);
  }
  if (!STATUSES.includes(body.status)) {
    throw new AppError(STATUS_MESSAGE, 422);
  }

  const record = await Attendance.findById(req.params.id);
  if (!record) throw new AppError('Attendance record not found.', 404);

  if (req.user.role === 'teacher' && String(record.markedBy) !== String(req.user._id)) {
    throw new AppError('You are not authorized to modify this attendance record.', 403);
  }

  record.status = body.status;
  await record.save();
  await record.populate('student', 'studentId registrationNumber fullName');

  res.status(200).json({
    success: true,
    message: 'Attendance updated successfully.',
    attendance: record,
  });
};

// DELETE /api/attendance/:id   (admin)
exports.deleteAttendance = async (req, res) => {
  checkId(req.params.id);

  const record = await Attendance.findByIdAndDelete(req.params.id);
  if (!record) throw new AppError('Attendance record not found.', 404);

  res.status(200).json({ success: true, message: 'Attendance record deleted successfully.' });
};