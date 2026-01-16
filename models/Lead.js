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
    value: { type: String, required: true, trim: true }, // raw email
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
    createdDate: { type: String, default: "" }, // PKT date string for UI
    createdTime: { type: String, default: "" }, // PKT time string for UI
  },
  { _id: false }
);

let ResponseSourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["EMAIL", "PHONE"],
      default: undefined, //Set at the lead qualifier stage
    },
    value: { type: String, trim: true, default: "" }, // raw selected email/phone
    normalized: { type: String, trim: true, default: "" }, // normalized selected email/phone
    selectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    selectedAt: { type: Date },
    selectedDate: { type: String, default: "" }, // PKT date
    selectedTime: { type: String, default: "" }, // PKT time
  },
  { _id: false }
);

let LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // emails with per-email status
    emails: { type: [EmailSchema], default: [] },

    // phones
    phones: { type: [String], default: [] },
    phonesNormalized: { type: [String], default: [] },

    location: { type: String, trim: true, default: "" },

    // NOW only one source link required by your new rule:
    // You can keep it as array (easy UI), but you can enforce ">= 1" in validator.
    sources: { type: [SourceSchema], default: [] },

    // workflow
    stage: { type: String, default: "DM" }, // DM -> VERIFIER -> LQ -> MANAGER
    status: { type: String, default: "UNPAID" }, // manager can set PAID later

    // assignment routing
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedToRole: { type: String, default: "" },
    assignedAt: { type: Date },
    verifiedCompletedAt: { type: Date },

    // DM UI fields (PKT)
    submittedDate: { type: String, default: "" },
    submittedTime: { type: String, default: "" },

    // LQ workflow fields
    lqStatus: {
      type: String,
      enum: ["PENDING", "IN_CONVERSATION", "DEAD", "QUALIFIED"],
      default: "PENDING",
    },

    comments: { type: [CommentSchema], default: [] },

    lqUpdatedAt: { type: Date },
    lqUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    responseSource: { type: ResponseSourceSchema, default: {} },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

/**
 *  Indexes for fast duplicate checks (large dataset)
 * Multikey index on emails.normalized makes $in queries fast.
 * Multikey index on phonesNormalized makes $in queries fast.
 */
LeadSchema.index({ "emails.normalized": 1 });
LeadSchema.index({ phonesNormalized: 1 });

/**
 * Common dashboard indexes
 */
LeadSchema.index({ stage: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
LeadSchema.index({ lqStatus: 1, stage: 1 });

module.exports = mongoose.model("Lead", LeadSchema);
