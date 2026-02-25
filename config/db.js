let mongoose = require("mongoose");

module.exports = async function connectDb() {
  let uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is missing");
  }

  // Returning this allows the main app to await the connection
  try {
    await mongoose.connect(uri);
    // Note: We move the console.log to app.js for better flow, 
    // or keep it here if you prefer.
  } catch (err) {
    console.log("MongoDB connection error:", err.message);
    process.exit(1);
  }
};