let mongoose = require("mongoose");

function connectDB() {
  let uri = process.env.MONGO_URI;

  if (!uri) {
    console.log("MONGO_URI missing in .env");
    process.exit(1);
  }

  mongoose
    .connect(uri)
    .then(function () {
      console.log("MongoDB connected");
    })
    .catch(function (err) {
      console.log("MongoDB connection error:", err.message);
      process.exit(1);
    });
}

module.exports = connectDB;
