const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in the .env file.');
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000, // fail after 10s instead of hanging
    });

    console.log(`MongoDB connected: ${conn.connection.host}`);
    console.log(`Database name: ${conn.connection.name}`);
  } catch (error) {
    // Log only the message: never print the connection string or password
    console.error('Unable to connect to the database.');
    console.error(`Reason: ${error.message}`);
    process.exit(1);
  }
};

// Helpful runtime events (e.g. if the connection drops later)
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected.');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected.');
});

module.exports = connectDB;