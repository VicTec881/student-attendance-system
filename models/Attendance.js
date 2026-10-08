const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    // Reference to the Student document (ObjectId)
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student is required.'],
    },
    // Copy of the readable Student ID (e.g. S001) for fast searching/reports
    studentId: {
      type: String,
      required: [true, 'Student ID is required.'],
      uppercase: true,
      trim: true,
    },
    date: {
      type: Date,
      required: [true, 'Attendance date is required.'],
    },
    className: {
      type: String,
      required: [true, 'Class is required.'],
      trim: true,
    },
    course: {
      type: String,
      required: [true, 'Course/Program is required.'],
      trim: true,
    },
    // Used for duplicate prevention (e.g. a class held in the morning and afternoon)
    session: {
      type: String,
      trim: true,
      default: 'Full Day',
    },
    status: {
      type: String,
      enum: {
        values: ['Present', 'Absent', 'Leave'],
        message: 'Status must be Present, Absent or Leave.',
      },
      required: [true, 'Attendance status is required.'],
    },
    // The teacher/admin who marked the attendance
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Marked by is required.'],
    },
  },
  {
    timestamps: true, // createdAt and updatedAt
  }
);

// Normalize the date to midnight UTC so the same day always matches,
// regardless of the time of day it was submitted.
attendanceSchema.pre('validate', function () {
  if (this.date) {
    const normalized = new Date(this.date);
    normalized.setUTCHours(0, 0, 0, 0);
    this.date = normalized;
  }
});

// Prevent duplicate attendance: one record per student, date, class and session
attendanceSchema.index(
  { student: 1, date: 1, className: 1, session: 1 },
  { unique: true }
);

// Speed up common searches (records page, dashboards, reports)
attendanceSchema.index({ date: 1, className: 1 });
attendanceSchema.index({ studentId: 1 });

attendanceSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Attendance', attendanceSchema);