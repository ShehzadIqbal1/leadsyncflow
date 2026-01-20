// models/Lead.js
let mongoose = require("mongoose");

let SourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true },
  },
  { _id: false }
);

let EmailSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true }, // raw
    normalized: { type: String, required: true, trim: true }, // full normalized email
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "BOUNCED", "DEAD"],
      default: "PENDING",
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
  },
  { _id: false }
);

let CommentSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByRole: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    createdDate: { type: String, default: "" }, // PKT date string
    createdTime: { type: String, default: "" }, // PKT time string
  },
  { _id: false }
);

let ResponseSourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["EMAIL", "PHONE"],
      default: undefined, // set by LQ only (do not auto-set at DM stage)
    },
    value: { type: String, trim: true, default: "" }, // raw selected email/phone
    normalized: { type: String, trim: true, default: "" }, // normalized selected email/phone
    selectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    selectedAt: { type: Date },
    selectedDate: { type: String, default: "" },
    selectedTime: { type: String, default: "" },
  },
  { _id: false }
);

let LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    emails: { type: [EmailSchema], default: [] },

    phones: { type: [String], default: [] },
    phonesNormalized: { type: [String], default: [] },

    location: { type: String, trim: true, default: "" },

    // keep as array; enforce "at least 1" in validator
    sources: { type: [SourceSchema], default: [] },

    // workflow
    stage: { type: String, default: "DM" }, // DM -> LQ -> MANAGER (Verifier works while stage is DM)
    status: { type: String, default: "UNPAID" }, // manager can set PAID

    // assignment
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedToRole: { type: String, default: "" },
    assignedAt: { type: Date },
    verifiedCompletedAt: { type: Date },

    // DM UI fields (PKT)
    submittedDate: { type: String, default: "" },
    submittedTime: { type: String, default: "" },

    // LQ stage fields
    lqStatus: {
      type: String,
      enum: ["PENDING", "IN_CONVERSATION", "DEAD", "QUALIFIED"],
      default: "PENDING",
    },
    comments: { type: [CommentSchema], default: [] },
    lqUpdatedAt: { type: Date },
    lqUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // LQ chooses which email/phone drove the response
    responseSource: { type: ResponseSourceSchema, default: undefined },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// --------------------
// Duplicate-check indexes (full email + full phone normalized)
// --------------------
LeadSchema.index({ "emails.normalized": 1 });
LeadSchema.index({ phonesNormalized: 1 });

// --------------------
// Dashboard / filtering indexes
// --------------------
LeadSchema.index({ stage: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
LeadSchema.index({ lqStatus: 1, stage: 1 });
LeadSchema.index({ status: 1, stage: 1 });

module.exports = mongoose.model("Lead", LeadSchema);
