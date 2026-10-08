const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Student = require('../models/Student');
const { AppError } = require('../middleware/errorMiddleware');

const PASSWORD_MESSAGE =
  'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, and one number.';

const isStrongPassword = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /\d/.test(password);

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });

const publicUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
});

// POST /api/auth/register  (admin only)
exports.register = async (req, res) => {
  const { fullName, email, password, role, phone, studentId } = req.body || {};

  if (!fullName || !email || !password || !role) {
    throw new AppError('Full name, email, password and role are required.', 400);
  }
  if ([fullName, email, password, role].some((v) => typeof v !== 'string')) {
    throw new AppError('Invalid information provided.', 400);
  }
  if (!['admin', 'teacher', 'student'].includes(role)) {
    throw new AppError('Role must be admin, teacher or student.', 422);
  }
  if (!isStrongPassword(password)) {
    throw new AppError(PASSWORD_MESSAGE, 422);
  }

  // A student login account must be linked to an existing Student record
  let studentRef = null;
  if (role === 'student') {
    if (!studentId) {
      throw new AppError('Student ID is required when registering a student account.', 400);
    }
    const student = await Student.findOne({
      studentId: String(studentId).trim().toUpperCase(),
    });
    if (!student) {
      throw new AppError('Student record not found. Please add the student first.', 404);
    }
    const alreadyLinked = await User.findOne({ student: student._id });
    if (alreadyLinked) {
      throw new AppError('This student already has a login account.', 409);
    }
    studentRef = student._id;
  }

  const user = await User.create({
    fullName,
    email,
    password, // hashed by the model before saving
    role,
    phone,
    student: studentRef,
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully.',
    user, // toJSON removes the password
  });
};

// POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    throw new AppError('Please provide your email and password.', 400);
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new AppError('Invalid email or password.', 401);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

  // Same message for "no account" and "wrong password" so accounts cannot be guessed
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid email or password.', 401);
  }

  if (user.status !== 'active') {
    throw new AppError('Your account is inactive. Please contact the administrator.', 403);
  }

  res.status(200).json({
    success: true,
    message: 'Login successful.',
    token: signToken(user._id),
    user: publicUser(user),
  });
};

// POST /api/auth/logout
// JWTs are stateless: the frontend deletes the token. This confirms the action.
exports.logout = async (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

// GET /api/auth/profile
exports.getProfile = async (req, res) => {
  const user = await User.findById(req.user._id).populate('student');
  res.status(200).json({ success: true, user });
};

// PUT /api/auth/profile  (name and phone only)
exports.updateProfile = async (req, res) => {
  const { fullName, phone } = req.body || {};

  if (fullName === undefined && phone === undefined) {
    throw new AppError('Provide a full name or phone number to update.', 400);
  }

  if (fullName !== undefined) {
    if (typeof fullName !== 'string' || !fullName.trim()) {
      throw new AppError('Full name cannot be empty.', 422);
    }
    req.user.fullName = fullName;
  }
  if (phone !== undefined) req.user.phone = phone;

  await req.user.save({ validateModifiedOnly: true });

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully.',
    user: req.user,
  });
};

// PUT /api/auth/change-password
// The account is ALWAYS identified by the JWT (req.user), never by the request body.
exports.changePassword = async (req, res) => {
  const body = req.body || {};
  const { currentPassword, newPassword, confirmPassword } = body;

  // If the client tries to name another account, refuse
  const targetId = body.userId || body.id || body._id;
  if (targetId !== undefined && String(targetId) !== String(req.user._id)) {
    throw new AppError('You are not authorized to change this password.', 403);
  }

  if (!currentPassword) throw new AppError('Current password is required.', 400);
  if (!newPassword) throw new AppError('New password is required.', 400);
  if (!confirmPassword) throw new AppError('Please confirm your new password.', 400);
  if ([currentPassword, newPassword, confirmPassword].some((v) => typeof v !== 'string')) {
    throw new AppError('Invalid password information provided.', 400);
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new AppError('The account no longer exists.', 401);

  if (!(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect.', 400);
  }
  if (!isStrongPassword(newPassword)) {
    throw new AppError(PASSWORD_MESSAGE, 422);
  }
  if (newPassword !== confirmPassword) {
    throw new AppError('New passwords do not match.', 400);
  }
  if (newPassword === currentPassword) {
    throw new AppError('New password must be different from the current password.', 400);
  }

  // The model hashes the password and sets passwordChangedAt;
  // timestamps update updatedAt.
  user.password = newPassword;
  await user.save();

  // Old tokens stop working after a password change, so issue a fresh one
  res.status(200).json({
    success: true,
    message: 'Password changed successfully.',
    token: signToken(user._id),
    passwordChangedAt: user.passwordChangedAt,
  });
};