const mongoose = require('mongoose');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Report = require('../models/Report');
const { AppError } = require('../middleware/errorMiddleware');
const { summarizeStudents, percentage } = require('../utils/attendanceStats');
const { buildExcel, buildPdf } = require('../utils/reportExporters');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const REPORT_TYPES = ['daily', 'weekly', 'monthly', 'student', 'class'];
const NO_RECORDS = 'No attendance records found for the selected report.';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, n) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

// Today's calendar date as midnight UTC
const todayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

// Accepts YYYY-MM-DD
const parseDay = (value, label = 'Date') => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new AppError(`${label} must be in YYYY-MM-DD format.`, 422);
  }
  const [y, m, d] = value.trim().split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new AppError(`${label} is not a valid date.`, 422);
  }
  return date;
};

// Accepts YYYY-MM and returns the first and last day of that month
const parseMonth = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value.trim())) {
    throw new AppError('Month must be in YYYY-MM format.', 422);
  }
  const [y, m] = value.trim().split('-').map(Number);
  if (m < 1 || m > 12) throw new AppError('Month must be between 01 and 12.', 422);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 0)),
    label: `${MONTH_NAMES[m - 1]} ${y}`,
  };
};

const noFuture = (start) => {
  if (start > todayUTC()) {
    throw new AppError('Reports cannot be generated for a future period.', 422);
  }
};

const textQuery = (q, names) => {
  for (const name of names) {
    if (q[name] !== undefined && typeof q[name] !== 'string') {
      throw new AppError(`Invalid value provided for ${name}.`, 400);
    }
  }
};

// Optional startDate/endDate used by the class and student reports (default: all time)
const parseRange = (q) => {
  if (q.startDate === undefined && q.endDate === undefined) {
    return { dateFilter: null, period: { start: null, end: null, label: 'All dates' } };
  }
  const start = q.startDate !== undefined ? parseDay(q.startDate, 'Start date') : null;
  const end = q.endDate !== undefined ? parseDay(q.endDate, 'End date') : null;
  if (start && end && start > end) {
    throw new AppError('Invalid date range: the start date cannot be after the end date.', 422);
  }
  const dateFilter = {};
  if (start) dateFilter.$gte = start;
  if (end) dateFilter.$lte = end;
  return {
    dateFilter,
    period: {
      start: start ? iso(start) : null,
      end: end ? iso(end) : null,
      label: `${start ? iso(start) : 'Beginning'} to ${end ? iso(end) : 'Today'}`,
    },
  };
};

// Builds the student filter shared by the daily, weekly, monthly and class reports
const buildStudentFilter = (q, { allowClass }) => {
  const filter = {};
  const filters = {};

  if (allowClass && q.className && q.className.trim()) {
    filter.className = new RegExp(`^${escapeRegex(q.className.trim())}$`, 'i');
    filters.className = q.className.trim();
  }
  if (q.course && q.course.trim()) {
    filter.course = new RegExp(`^${escapeRegex(q.course.trim())}$`, 'i');
    filters.course = q.course.trim();
  }

  const wanted = q.studentStatus === undefined ? 'Active' : q.studentStatus;
  if (!['Active', 'Inactive', 'All'].includes(wanted)) {
    throw new AppError('Student status must be Active, Inactive or All.', 422);
  }
  if (wanted !== 'All') filter.status = wanted;
  filters.studentStatus = wanted;

  return { filter, filters };
};

// Runs the calculation and builds the report rows.
// Only students with at least one record in the period are listed (unless includeEmpty=true).
const buildRows = async ({ studentFilter, dateFilter, includeEmpty }) => {
  let rows = await summarizeStudents({ studentFilter, dateFilter });
  if (!includeEmpty) rows = rows.filter((r) => r.totalDays > 0);

  const totals = rows.reduce(
    (acc, r) => {
      acc.totalDays += r.totalDays;
      acc.present += r.present;
      acc.absent += r.absent;
      acc.leave += r.leave;
      return acc;
    },
    { totalDays: 0, present: 0, absent: 0, leave: 0 }
  );

  return {
    rows: rows.map(({ status, student, ...rest }) => ({ student, ...rest })),
    overall: {
      students: rows.length,
      totalDays: totals.totalDays,
      present: totals.present,
      absent: totals.absent,
      leave: totals.leave,
      percentage: percentage(totals.present, totals.totalDays),
    },
  };
};

/* ---------------------------------------------------------------------------
   Report generators. Each returns { reportName, reportType, parameters, report }
   and does NOT send a response, so JSON endpoints and exports share them.
--------------------------------------------------------------------------- */
const periodReport = async ({ reportType, period, titleBase, query }) => {
  const { filter, filters } = buildStudentFilter(query, { allowClass: true });
  const includeEmpty = query.includeEmpty === 'true';

  const dateFilter =
    period.start.getTime() === period.end.getTime()
      ? period.start
      : { $gte: period.start, $lte: period.end };

  const { rows, overall } = await buildRows({ studentFilter: filter, dateFilter, includeEmpty });
  if (rows.length === 0 || overall.totalDays === 0) {
    throw new AppError(NO_RECORDS, 404);
  }

  const reportName = `${titleBase}: ${period.label}`;
  const range = { start: iso(period.start), end: iso(period.end), label: period.label };

  return {
    reportName,
    reportType,
    parameters: { period: { start: range.start, end: range.end }, ...filters, includeEmpty },
    report: { title: reportName, period: range, filters, overall, students: rows },
  };
};

const generateDaily = async (q) => {
  textQuery(q, ['date', 'className', 'course', 'studentStatus', 'includeEmpty']);
  const day = q.date === undefined ? todayUTC() : parseDay(q.date);
  noFuture(day);

  return periodReport({
    reportType: 'daily',
    titleBase: 'Daily Attendance Report',
    period: { start: day, end: day, label: iso(day) },
    query: q,
  });
};

// The Monday-Sunday week containing the given date
const generateWeekly = async (q) => {
  textQuery(q, ['date', 'className', 'course', 'studentStatus', 'includeEmpty']);
  const anyDay = q.date === undefined ? todayUTC() : parseDay(q.date);

  const offset = (anyDay.getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(anyDay, -offset);
  const end = addDays(start, 6);
  noFuture(start);

  return periodReport({
    reportType: 'weekly',
    titleBase: 'Weekly Attendance Report',
    period: { start, end, label: `${iso(start)} to ${iso(end)}` },
    query: q,
  });
};

const generateMonthly = async (q) => {
  textQuery(q, ['month', 'className', 'course', 'studentStatus', 'includeEmpty']);
  const month = q.month === undefined ? iso(todayUTC()).slice(0, 7) : q.month;
  const { start, end, label } = parseMonth(month);
  noFuture(start);

  return periodReport({
    reportType: 'monthly',
    titleBase: 'Monthly Attendance Report',
    period: { start, end, label },
    query: q,
  });
};

const generateClass = async (className, q) => {
  textQuery(q, ['startDate', 'endDate', 'course', 'studentStatus', 'includeEmpty']);
  const name = String(className || '').trim();
  if (!name) throw new AppError('Class is required.', 400);

  const { dateFilter, period } = parseRange(q);
  const { filter, filters } = buildStudentFilter(q, { allowClass: false });
  filter.className = new RegExp(`^${escapeRegex(name)}$`, 'i');
  filters.className = name;
  const includeEmpty = q.includeEmpty === 'true';

  const { rows, overall } = await buildRows({ studentFilter: filter, dateFilter, includeEmpty });
  if (rows.length === 0 || overall.totalDays === 0) {
    throw new AppError(NO_RECORDS, 404);
  }

  const reportName = `Class Attendance Report: ${name}`;
  return {
    reportName,
    reportType: 'class',
    parameters: { period, ...filters, includeEmpty },
    report: { title: reportName, period, filters, overall, students: rows },
  };
};

const generateStudent = async (id, q, user) => {
  textQuery(q, ['startDate', 'endDate']);

  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
    throw new AppError('Invalid student ID.', 400);
  }

  // A student may only generate their OWN report
  if (user.role === 'student') {
    if (!user.student || String(user.student) !== String(id)) {
      throw new AppError('You are not authorized to perform this action.', 403);
    }
  }

  const student = await Student.findById(id);
  if (!student) throw new AppError('Student not found.', 404);

  const { dateFilter, period } = parseRange(q);

  const [summary] = await summarizeStudents({ studentFilter: { _id: student._id }, dateFilter });
  if (!summary || summary.totalDays === 0) {
    throw new AppError(NO_RECORDS, 404);
  }

  const match = { student: student._id };
  if (dateFilter) match.date = dateFilter;
  const records = await Attendance.find(match).sort({ date: 1, createdAt: 1 }).select('-markedBy');

  const reportName = `Student Attendance Report: ${student.fullName} (${student.studentId})`;
  return {
    reportName,
    reportType: 'student',
    parameters: { student: String(student._id), studentId: student.studentId, period },
    report: {
      title: reportName,
      period,
      student: {
        fullName: student.fullName,
        studentId: student.studentId,
        registrationNumber: student.registrationNumber,
        className: student.className,
        course: student.course,
        yearOfStudy: student.yearOfStudy,
      },
      overall: {
        totalDays: summary.totalDays,
        present: summary.present,
        absent: summary.absent,
        leave: summary.leave,
        percentage: summary.percentage,
      },
      records: records.map((r) => ({
        id: r._id,
        date: iso(r.date),
        className: r.className,
        course: r.course,
        session: r.session,
        status: r.status,
      })),
    },
  };
};

// Used by the export endpoints: picks the generator from ?type=
const generateByType = async (q, user) => {
  textQuery(q, ['type', 'student', 'className']);

  if (q.type === undefined || q.type.trim() === '') {
    throw new AppError('Report type is required.', 400);
  }
  if (!REPORT_TYPES.includes(q.type)) {
    throw new AppError('Report type must be daily, weekly, monthly, student or class.', 422);
  }
  // Students may export only their own student report
  if (user.role === 'student' && q.type !== 'student') {
    throw new AppError('You are not authorized to perform this action.', 403);
  }

  switch (q.type) {
    case 'daily':
      return generateDaily(q);
    case 'weekly':
      return generateWeekly(q);
    case 'monthly':
      return generateMonthly(q);
    case 'class':
      return generateClass(q.className, q);
    default:
      if (q.student === undefined || q.student.trim() === '') {
        throw new AppError('Student is required.', 400);
      }
      return generateStudent(q.student.trim(), q, user);
  }
};

/* ---------------------------------------------------------------------------
   Saving history and sending responses
--------------------------------------------------------------------------- */
const saveHistory = (user, result, extra = {}) =>
  Report.create({
    reportName: result.reportName,
    reportType: result.reportType,
    generatedBy: user._id,
    parameters: { ...result.parameters, ...extra },
  });

const respond = async (req, res, result) => {
  const saved = await saveHistory(req.user, result);

  res.status(200).json({
    success: true,
    report: {
      id: saved._id,
      reportName: result.reportName,
      reportType: result.reportType,
      generatedAt: saved.generatedAt,
      generatedBy: { id: req.user._id, fullName: req.user.fullName, role: req.user.role },
      ...result.report,
    },
  });
};

// GET /api/reports/daily?date=YYYY-MM-DD
exports.dailyReport = async (req, res) => {
  await respond(req, res, await generateDaily(req.query));
};

// GET /api/reports/weekly?date=YYYY-MM-DD   (the Monday-Sunday week containing that date)
exports.weeklyReport = async (req, res) => {
  await respond(req, res, await generateWeekly(req.query));
};

// GET /api/reports/monthly?month=YYYY-MM
exports.monthlyReport = async (req, res) => {
  await respond(req, res, await generateMonthly(req.query));
};

// GET /api/reports/class/:className?startDate=&endDate=&course=
exports.classReport = async (req, res) => {
  await respond(req, res, await generateClass(req.params.className, req.query));
};

// GET /api/reports/student/:id?startDate=&endDate=   (:id is the Student _id)
exports.studentReport = async (req, res) => {
  await respond(req, res, await generateStudent(req.params.id, req.query, req.user));
};

// GET /api/reports?reportType=&page=&limit=   (admin: everyone's history; teacher: own)
exports.getReports = async (req, res) => {
  const { reportType } = req.query;
  if (reportType !== undefined && !REPORT_TYPES.includes(reportType)) {
    throw new AppError('Report type must be daily, weekly, monthly, student or class.', 422);
  }

  const filter = {};
  if (reportType) filter.reportType = reportType;
  if (req.user.role !== 'admin') filter.generatedBy = req.user._id;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const [total, reports] = await Promise.all([
    Report.countDocuments(filter),
    Report.find(filter)
      .populate('generatedBy', 'fullName role')
      .sort({ generatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    count: reports.length,
    reports,
  });
};

/* ---------------------------------------------------------------------------
   Step 13: exports
--------------------------------------------------------------------------- */
const slug = (text) => text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const runExport = async (req, res, { format, label, extension, contentType, build }) => {
  const result = await generateByType(req.query, req.user);
  const meta = { generatedBy: req.user.fullName, generatedAt: new Date() };

  // Build the whole file first: a failure returns a clean error, never a half-sent file
  let buffer;
  try {
    buffer = await build(result, meta);
  } catch (err) {
    console.error(`${label} export failed: ${err.message}`);
    throw new AppError(`Unable to generate the ${label} file. Please try again.`, 500);
  }

  await saveHistory(req.user, result, { exportedAs: format });

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${slug(result.reportName)}.${extension}"`
  );
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
};

// GET /api/reports/export/excel?type=...
exports.exportExcel = (req, res) =>
  runExport(req, res, {
    format: 'excel',
    label: 'Excel',
    extension: 'xlsx',
    contentType: XLSX_TYPE,
    build: buildExcel,
  });

// GET /api/reports/export/pdf?type=...
exports.exportPdf = (req, res) =>
  runExport(req, res, {
    format: 'pdf',
    label: 'PDF',
    extension: 'pdf',
    contentType: 'application/pdf',
    build: buildPdf,
  });