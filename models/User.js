const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required.'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
    },
    // Stores ONLY the bcrypt hash. Hidden from queries by default.
    password: {
      type: String,
      required: [true, 'Password is required.'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'teacher', 'student'],
        message: 'Role must be admin, teacher or student.',
      },
      required: [true, 'Role is required.'],
    },
    phone: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive'],
        message: 'Status must be active or inactive.',
      },
      default: 'active',
    },
    // Links a student login account to its Student record (students only)
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // automatically manages createdAt and updatedAt
  }
);

// Hash the password whenever it is set or changed
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  this.password = await bcrypt.hash(this.password, 12);

  // Record the change time only for existing accounts (not on registration)
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
  }
});

// Compare a plain-text password with the stored hash.
// The user must be loaded with .select('+password') first.
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Never include the password or __v in JSON responses
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);