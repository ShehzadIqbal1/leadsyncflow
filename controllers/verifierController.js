// controllers/verifierController.js
const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const Counter = require("../models/Counter");
const statusCodes = require("../utils/statusCodes");
const User = require("../models/User");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");
//const assignmentService = require("../utils/assignmentService");

function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// 1) GET /api/verifier/leads
// Logic: Strictly get only leads in "DM" stage
const getDmLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  // Validation
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  // Run both queries in parallel for better performance
  const [leads, totalLeads] = await Promise.all([
    Lead.find({ stage: "DM" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("emails submittedDate stage"),
    Lead.countDocuments({ stage: "DM" })
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads, // Now the frontend knows the "Grand Total"
    limit,
    skip,
    leads,
  });
});
// 2) POST /api/verifier/leads/:leadId/update-emails
// Logic: Processes emails AND handles phone-only leads to move stage to "Verifier"
const updateEmailStatuses = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  // We only fetch leads that ARE in DM stage and HAVE emails
  const lead = await Lead.findById(leadId).select("stage emails");
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  if (lead.stage !== "DM") {
    return next(httpError(statusCodes.BAD_REQUEST, "Lead is not in DM stage"));
  }

  // Since you fixed the submit logic, a DM lead should always have emails.
  // This is now a safety check.
  const hasEmails = Array.isArray(lead.emails) && lead.emails.length > 0;
  if (!hasEmails) {
    return next(httpError(statusCodes.BAD_REQUEST, "This lead has no emails to verify. It should already be in Verifier stage."));
  }

  const incomingArr = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
  if (!incomingArr.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "Email data is required"));
  }

  const incomingMap = new Map();
  for (const row of incomingArr) {
    const norm = String(row.normalized || "").trim().toLowerCase();
    const status = String(row.status || "").trim().toUpperCase();
    if (norm && isValidEmailStatus(status)) {
      incomingMap.set(norm, status);
    }
  }

  const now = new Date();
  let updatedCount = 0;
  let missingCount = 0;

  for (const e of lead.emails) {
    const norm = String(e.normalized || "").trim().toLowerCase();
    const nextStatus = incomingMap.get(norm);

    if (!nextStatus) {
      missingCount++;
      continue;
    }

    e.status = nextStatus;
    e.verifiedBy = req.user.id;
    e.verifiedAt = now;
    updatedCount++;
  }

  // Ensure ALL emails are processed before moving stage
  if (missingCount > 0) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: "All emails must be updated to move lead to Verifier",
      missingCount,
    });
  }

  lead.stage = "Verifier";
  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead successfully verified and moved to Verifier stage.",
    updatedCount,
    stage: lead.stage,
  });
});

// 3) POST /api/verifier/leads/move-all-to-lq
// Logic: Move ALL leads in Verifier stage to LQ stage using optimized bulk operations
const moveAllVerifierLeadsToLQ = asyncHandler(async function (req, res, next) {
  // 1. Get all leads in Verifier stage
  const leads = await Lead.find({ stage: "Verifier" }).select("_id");
  if (leads.length === 0)
    return next(httpError(statusCodes.NOT_FOUND, "No leads to move"));

  // 2. Fetch all LQs once (Don't call assignmentService inside the loop)
  const lqs = await User.find({ role: "Lead Qualifiers", status: "APPROVED" })
    .select("_id")
    .sort({ _id: 1 });
  if (lqs.length === 0)
    return next(httpError(statusCodes.BAD_REQUEST, "No LQs available"));

  // 3. Get the starting point for Round-Robin from your Counter
  const counter = await Counter.findOneAndUpdate(
    { key: "LQ_ASSIGN" },
    { $inc: { seq: leads.length } }, // Increment by the total number of leads at once
    { new: true, upsert: true },
  );

  const startSeq = counter.seq - leads.length;
  const now = new Date();

  // 4. Prepare Bulk Operations
  const bulkOps = leads.map((lead, index) => {
    const lqIndex = (startSeq + index) % lqs.length;
    const assignedLqId = lqs[lqIndex]._id;

    return {
      updateOne: {
        filter: { _id: lead._id },
        update: {
          $set: {
            stage: "LQ",
            assignedTo: assignedLqId,
            assignedToRole: "Lead Qualifiers",
            assignedAt: now,
            verifiedCompletedAt: now,
          },
        },
      },
    };
  });

  // 5. Execute everything in ONE database command
  await Lead.bulkWrite(bulkOps);

  return res.status(statusCodes.OK).json({
    success: true,
    message: `${leads.length} leads successfully distributed.`,
    count: leads.length,
  });
});

module.exports = {
  getDmLeads,
  updateEmailStatuses,
  moveAllVerifierLeadsToLQ,
};
