let mongoose = require("mongoose");

let SourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    link: { type: String, required: true, trim: true }
  },
  { _id: false }
);

let LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    // raw values
    emails: { type: [String], default: [] },
    phones: { type: [String], default: [] },

    // optional
    location: { type: String, trim: true, default: "" },

    // normalized values
    emailsNormalized: { type: [String], default: [] },
    emailLocalParts: { type: [String], default: [] },
    phonesNormalized: { type: [String], default: [] },

    sources: { type: [SourceSchema], default: [] },

    // workflow
    stage: { type: String, default: "dataMinors" },
    status: { type: String, default: "UNPAID" },

    // Pakistan Standard Time (generated on submit)
    submittedDate: { type: String }, // YYYY-MM-DD
    submittedTime: { type: String }, // HH:mm:ss PKT

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

// Indexes
LeadSchema.index({ emailsNormalized: 1 });
LeadSchema.index({ emailLocalParts: 1 });
LeadSchema.index({ phonesNormalized: 1 });
LeadSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", LeadSchema);
