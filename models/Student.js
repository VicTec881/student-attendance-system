const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: [true, 'Student ID is required.'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    registrationNumber: {
      type: String,
      required: [true, 'Registration number is required.'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required.'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters.'],
    },
    gender: {
      type: String,
      enum: {
        values: ['Male', 'Female', 'Other'],
        message: 'Gender must be Male, Female or Other.',
      },
      required: [true, 'Gender is required.'],
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address.'],
    },
    phone: {
      type: String,
      trim: true,
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
    yearOfStudy: {
      type: Number,
      required: [true, 'Year of study is required.'],
      min: [1, 'Year of study must be at least 1.'],
      max: [10, 'Year of study cannot exceed 10.'],
    },
    admissionDate: {
      type: Date,
      required: [true, 'Admission date is required.'],
    },
    status: {
      type: String,
      enum: {
        values: ['Active', 'Inactive'],
        message: 'Status must be Active or Inactive.',
      },
      default: 'Active',
    },
  },
  {
    timestamps: true, // createdAt and updatedAt
  }
);

studentSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Student', studentSchema);