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
    normalized: { type: String, required: true, trim: true }, // normalized email
    localPart: { type: String, default: "", trim: true }, // before @
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

let LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    //  emails with status
    emails: { type: [EmailSchema], default: [] },

    // phones (keep as is for now)
    phones: { type: [String], default: [] },
    phonesNormalized: { type: [String], default: [] },

    location: { type: String, trim: true, default: "" },
    sources: { type: [SourceSchema], default: [] },

    stage: { type: String, default: "DM" },
    status: { type: String, default: "UNPAID" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedToRole: { type: String, default: "" }, // e.g. "Lead Qualifiers"
    assignedAt: { type: Date },
    verifiedCompletedAt: { type: Date },

    submittedDate: { type: String },
    submittedTime: { type: String },

    lqStatus: {
      type: String,
      enum: ["PENDING", "IN_CONVERSATION", "DEAD", "QUALIFIED"],
      default: "PENDING",
    },

    comments: {
      type: [
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
      ],
      default: [],
    },

    lqUpdatedAt: { type: Date },
    lqUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    responseSource: {
      type: {
        type: String,
        enum: ["EMAIL", "PHONE"],
      },
      value: { type: String, trim: true, default: "" },
      normalized: { type: String, trim: true, default: "" },
      selectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      selectedAt: { type: Date },
      selectedDate: { type: String, default: "" },
      selectedTime: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Indexes for duplicates/perf
LeadSchema.index({ "emails.normalized": 1 });
LeadSchema.index({ "emails.localPart": 1 });
LeadSchema.index({ phonesNormalized: 1 });
LeadSchema.index({ stage: 1, createdAt: -1 });
LeadSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
LeadSchema.index({ stage: 1, assignedTo: 1, createdAt: -1 });
LeadSchema.index({ lqStatus: 1, stage: 1 });

module.exports = mongoose.model("Lead", LeadSchema);
