const mongoose = require("mongoose");

const SourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const EmailSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },
    normalized: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "BOUNCED", "DEAD"],
      default: "PENDING",
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
  },
  { _id: false },
);

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

const ResponsePickSchema = new mongoose.Schema(
  {
    value: { type: String, trim: true, default: "" },
    normalized: { type: String, trim: true, default: "" },
    selectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    selectedAt: { type: Date },
    selectedDate: { type: String, default: "" },
    selectedTime: { type: String, default: "" },
  },
  { _id: false },
);

const ResponseSourceSchema = new mongoose.Schema(
  {
    emails: { type: [ResponsePickSchema], default: [] },
    phones: { type: [ResponsePickSchema], default: [] },
  },
  { _id: false },
);

const LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    emails: { type: [EmailSchema], default: [] },
    phones: { type: [String], default: [] },
    phonesNormalized: { type: [String], default: [] },
    location: { type: String, trim: true, default: "" },
    sources: { type: [SourceSchema], default: [] },

    stage: { type: String, default: "DM" },
    status: { type: String, default: "UNPAID" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedToRole: { type: String, default: "" },
    assignedAt: { type: Date },
    verifiedCompletedAt: { type: Date },

    // verifier batch claim system
    v_claimedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    v_claimedAt: {
      type: Date,
      default: null,
    },
    v_batchId: {
      type: String,
      default: "",
      trim: true,
    },

    submittedDate: { type: String, default: "" },
    submittedTime: { type: String, default: "" },

    lqStatus: {
      type: String,
      enum: ["PENDING", "REACHED", "DEAD", "QUALIFIED"],
      default: "PENDING",
    },
    comments: { type: [CommentSchema], default: [] },
    lqUpdatedAt: { type: Date },
    lqUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    responseSource: { type: ResponseSourceSchema, default: undefined },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    rejectionRequested: { type: Boolean, default: false },
    rejectionRequestedAt: { type: Date },
    rejectionRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    upsales: [
      {
        amount: { type: Number, required: true },
        comment: { type: String, default: "" },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        addedAt: { type: Date },
        addedDate: { type: String },
        addedTime: { type: String },
      },
    ],

    superAdminReturnPriorityUntil: { type: Date },
  },
  { timestamps: true },
);

LeadSchema.index({ "emails.normalized": 1 });
LeadSchema.index({ phonesNormalized: 1 });

LeadSchema.index({ stage: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
LeadSchema.index({ lqStatus: 1, stage: 1 });
LeadSchema.index({ status: 1, stage: 1 });
LeadSchema.index({ assignedTo: 1, stage: 1, assignedAt: -1 });

// new verifier claim indexes
LeadSchema.index({ stage: 1, v_claimedBy: 1, _id: 1 });
LeadSchema.index({ stage: 1, v_batchId: 1 });

module.exports = mongoose.model("Lead", LeadSchema);