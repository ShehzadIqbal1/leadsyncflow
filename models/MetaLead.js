const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByRole: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    createdDate: { type: String, default: "" },
    createdTime: { type: String, default: "" },
  },
  { _id: false },
);

const UpsaleSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    comment: { type: String, default: "" },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    addedAt: { type: Date },
    addedDate: { type: String },
    addedTime: { type: String },
  },
  { _id: false },
);

const MetaLeadSchema = new mongoose.Schema(
  {
    // Admin form fields
    date: {
      type: Date,
      required: true,
    },

    program: {
      type: String,
      required: true,
      trim: true,
    },

    school: {
      type: String,
      required: true,
      trim: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    emailNormalized: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    number: {
      type: String,
      trim: true,
      default: "",
    },

    numberNormalized: {
      type: String,
      trim: true,
      default: "",
    },

    website: {
      type: String,
      trim: true,
      default: "",
    },

    // Workflow
    stage: {
      type: String,
      enum: ["ADMIN_REVIEW", "MANAGER", "WRITER", "REJECTED"],
      default: "ADMIN_REVIEW",
    },

    status: {
      type: String,
      enum: ["UNPAID", "PAID"],
      default: "UNPAID",
    },

    leadType: {
      type: String,
      enum: ["NORMAL", "RECURRING", null],
      default: null,
    },

    // Manager assignment happens AFTER creation
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    assignedToRole: {
      type: String,
      default: "",
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    comments: {
      type: [CommentSchema],
      default: [],
    },

    upsales: {
      type: [UpsaleSchema],
      default: [],
    },

    // Admin -> Writer processing fields
    adminAssignedDate: {
      type: Date,
      default: null,
    },

    adminProcessedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    adminProcessedAt: {
      type: Date,
      default: null,
    },

    writerVisible: {
      type: Boolean,
      default: false,
    },

    writerVisibleAt: {
      type: Date,
      default: null,
    },

    writerStatus: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "DONE"],
      default: "PENDING",
    },

    writerDoneBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    writerDoneAt: {
      type: Date,
      default: null,
    },

    lastNotificationSentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Duplicate protection inside MetaLead collection
MetaLeadSchema.index(
  { emailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      emailNormalized: { $type: "string", $gt: "" },
    },
  },
);

MetaLeadSchema.index(
  { numberNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      numberNormalized: { $type: "string", $gt: "" },
    },
  },
);

// Workflow indexes
MetaLeadSchema.index({ status: 1, stage: 1 });
MetaLeadSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
MetaLeadSchema.index({ createdBy: 1, createdAt: -1 });

MetaLeadSchema.index({
  stage: 1,
  status: 1,
  leadType: 1,
  writerVisible: 1,
  writerStatus: 1,
});

MetaLeadSchema.index({
  adminAssignedDate: 1,
  writerStatus: 1,
  leadType: 1,
});

module.exports = mongoose.model("MetaLead", MetaLeadSchema);