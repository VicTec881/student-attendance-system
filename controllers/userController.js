const mongoose = require('mongoose');
const User = require('../models/User');
const { AppError } = require('../middleware/errorMiddleware');

const ROLES = ['admin', 'teacher', 'student'];
const STATUSES = ['active', 'inactive'];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError('Invalid user ID.', 400);
  }
};

// GET /api/users?role=&status=&search=&page=&limit=   (admin only)
exports.getUsers = async (req, res) => {
  const { role, status, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const filter = {};

  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new AppError('Role must be admin, teacher or student.', 422);
    filter.role = role;
  }
  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw new AppError('Status must be active or inactive.', 422);
    filter.status = status;
  }
  if (search !== undefined) {
    if (typeof search !== 'string') throw new AppError('Invalid search value.', 400);
    if (search.trim()) {
      const pattern = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ fullName: pattern }, { email: pattern }];
    }
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    // password is excluded by the model (select: false)
    User.find(filter)
      .populate('student', 'studentId registrationNumber fullName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    count: users.length,
    users,
  });
};

// GET /api/users/:id   (admin only)
exports.getUser = async (req, res) => {
  checkId(req.params.id);

  const user = await User.findById(req.params.id).populate(
    'student',
    'studentId registrationNumber fullName'
  );
  if (!user) throw new AppError('User not found.', 404);

  res.status(200).json({ success: true, user });
};

// PUT /api/users/:id   (admin only)
// Editable: fullName, email, phone, status.
exports.updateUser = async (req, res) => {
  checkId(req.params.id);
  const body = req.body || {};

  if (body.password !== undefined) {
    throw new AppError(
      'Passwords cannot be changed here. Users change their own password from their Profile page.',
      400
    );
  }
  if (body.role !== undefined) {
    throw new AppError("A user's role cannot be changed. Please create a new account instead.", 400);
  }

  const { fullName, email, phone, status } = body;
  if ([fullName, email, phone, status].every((v) => v === undefined)) {
    throw new AppError('Provide at least one field to update (fullName, email, phone, status).', 400);
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found.', 404);

  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw new AppError('Status must be active or inactive.', 422);
    if (String(user._id) === String(req.user._id) && status !== 'active') {
      throw new AppError('You cannot deactivate your own account.', 400);
    }
    user.status = status;
  }
  if (fullName !== undefined) {
    if (typeof fullName !== 'string' || !fullName.trim()) {
      throw new AppError('Full name cannot be empty.', 422);
    }
    user.fullName = fullName;
  }
  if (email !== undefined) {
    if (typeof email !== 'string') throw new AppError('Invalid email address.', 422);
    user.email = email;
  }
  if (phone !== undefined) user.phone = phone;

  // Duplicate emails are caught by the unique index and errorMiddleware (409)
  await user.save({ validateModifiedOnly: true });

  res.status(200).json({ success: true, message: 'User updated successfully.', user });
};

// DELETE /api/users/:id   (admin only)
exports.deleteUser = async (req, res) => {
  checkId(req.params.id);

  if (String(req.params.id) === String(req.user._id)) {
    throw new AppError('You cannot delete your own account.', 400);
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new AppError('User not found.', 404);

  // Only the login account is removed. A linked Student record is kept.
  res.status(200).json({ success: true, message: 'User deleted successfully.' });
};