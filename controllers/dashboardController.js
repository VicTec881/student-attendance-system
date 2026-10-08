const Student = require('../models/Student');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { AppError } = require('../middleware/errorMiddleware');
const { countByStatus, todayUTC } = require('../utils/attendanceStats');

// Daily present/absent/leave totals for the last n days (days with no records show 0)
const lastDays = async (n) => {
  const end = todayUTC();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));

  const grouped = await Attendance.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    { $group: { _id: { date: '$date', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const days = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push({ date: d.toISOString().slice(0, 10), present: 0, absent: 0, leave: 0 });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));

  for (const g of grouped) {
    const day = byDate.get(g._id.date.toISOString().slice(0, 10));
    if (day) day[g._id.status.toLowerCase()] = g.count;
  }
  return days;
};

const adminDashboard = async () => {
  const [students, activeStudents, teachers, today, overall, last7Days, recentRecords] =
    await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ status: 'Active' }),
      User.countDocuments({ role: 'teacher' }),
      countByStatus({ date: todayUTC() }),
      countByStatus(),
      lastDays(7),
      Attendance.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('student', 'studentId registrationNumber fullName')
        .populate('markedBy', 'fullName'),
    ]);

  return {
    totals: { students, activeStudents, teachers },
    today,
    overall,
    last7Days,
    recentRecords,
  };
};

const teacherDashboard = async () => {
  const [students, activeStudents, today, overall] = await Promise.all([
    Student.countDocuments(),
    Student.countDocuments({ status: 'Active' }),
    countByStatus({ date: todayUTC() }),
    countByStatus(),
  ]);

  return { totals: { students, activeStudents }, today, overall };
};

const studentDashboard = async (user) => {
  const student = user.student ? await Student.findById(user.student) : null;
  if (!student) {
    throw new AppError(
      'Your student record was not found. Please contact the administrator.',
      404
    );
  }

  const [stats, records] = await Promise.all([
    countByStatus({ student: student._id }),
    Attendance.find({ student: student._id })
      .sort({ date: -1, createdAt: -1 })
      .limit(10)
      .select('-markedBy'),
  ]);

  return {
    student: {
      fullName: student.fullName,
      studentId: student.studentId,
      registrationNumber: student.registrationNumber,
      className: student.className,
      course: student.course,
      yearOfStudy: student.yearOfStudy,
    },
    attendance: {
      totalDays: stats.total,
      present: stats.present,
      absent: stats.absent,
      leave: stats.leave,
      percentage: stats.percentage,
    },
    history: records.map((r) => ({
      id: r._id,
      date: r.date,
      className: r.className,
      course: r.course,
      session: r.session,
      status: r.status,
    })),
  };
};

// GET /api/dashboard   (any logged-in role: the data depends on the role)
exports.getDashboard = async (req, res) => {
  const { role } = req.user;

  let dashboard;
  if (role === 'admin') dashboard = await adminDashboard();
  else if (role === 'teacher') dashboard = await teacherDashboard();
  else dashboard = await studentDashboard(req.user);

  res.status(200).json({ success: true, role, dashboard });
};