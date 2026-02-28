const mongoose = require("mongoose");
const constants = require("../utils/constants");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    sex: { type: String, required: true, enum: constants.sexOptions },

    department: { type: String, enum: constants.departments },

    // ROLE is assigned ONLY when approved
    // Includes "Super Admin"
    role: {
      type: String,
      enum: constants.roles,
      default: null,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

    passwordHash: { type: String, required: true },

    // Added later from dashboard
    profileImage: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedAt: { type: Date, default: null },

    reportsTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // will point to a Manager user
    },
  },
  { timestamps: true },
);

/**
 * Auto-delete pending requests after 24 hours
 */
userSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24,
    partialFilterExpression: { status: "PENDING" },
  },
);

userSchema.index({ role: 1, status: 1, reportsTo: 1 });

module.exports = mongoose.model("User", userSchema);
