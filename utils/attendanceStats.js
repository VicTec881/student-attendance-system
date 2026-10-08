const Attendance = require('../models/Attendance');
const Student = require('../models/Student');

// (Present / Total) x 100, rounded to 1 decimal. 0 when there are no records.
const percentage = (present, total) =>
  total === 0 ? 0 : Math.round((present / total) * 1000) / 10;

// Counts attendance records by status for any filter
const countByStatus = async (match = {}) => {
  const grouped = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g._id, g.count]));

  const present = counts.Present || 0;
  const absent = counts.Absent || 0;
  const leave = counts.Leave || 0;
  const total = present + absent + leave;

  return { total, present, absent, leave, percentage: percentage(present, total) };
};

// Today's calendar date as midnight UTC (matches how attendance dates are stored)
const todayUTC = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

// One summary row per student matching studentFilter, counting only attendance
// inside dateFilter (a Date, a { $gte, $lte } range, or null for all dates).
// Students with no records are included with zeros.
const summarizeStudents = async ({ studentFilter = {}, dateFilter = null } = {}) => {
  const students = await Student.find(studentFilter).sort({ studentId: 1 }).lean();
  if (students.length === 0) return [];

  const match = { student: { $in: students.map((s) => s._id) } };
  if (dateFilter) match.date = dateFilter;

  const grouped = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: { student: '$student', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const countsByStudent = new Map();
  for (const g of grouped) {
    const key = String(g._id.student);
    if (!countsByStudent.has(key)) {
      countsByStudent.set(key, { Present: 0, Absent: 0, Leave: 0 });
    }
    countsByStudent.get(key)[g._id.status] = g.count;
  }

  return students.map((s) => {
    const c = countsByStudent.get(String(s._id)) || { Present: 0, Absent: 0, Leave: 0 };
    const totalDays = c.Present + c.Absent + c.Leave;
    return {
      student: s._id,
      studentId: s.studentId,
      registrationNumber: s.registrationNumber,
      fullName: s.fullName,
      className: s.className,
      course: s.course,
      yearOfStudy: s.yearOfStudy,
      status: s.status,
      totalDays,
      present: c.Present,
      absent: c.Absent,
      leave: c.Leave,
      percentage: percentage(c.Present, totalDays),
    };
  });
};

module.exports = { percentage, countByStatus, todayUTC, summarizeStudents };