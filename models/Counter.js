let mongoose = require("mongoose");

let CounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Counter", CounterSchema);
