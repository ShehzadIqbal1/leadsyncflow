// controllers/verifierController.js
let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let Counter = require("../models/Counter");
let statusCodes = require("../utils/statusCodes");
let User = require("../models/User");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let assignmentService = require("../utils/assignmentService");

function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// 1) GET /api/verifier/leads
// Logic: Strictly get only leads in "DM" stage
let getDmLeads = asyncHandler(async function (req, res, next) {
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
let updateEmailStatuses = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let lead = await Lead.findById(leadId).select("stage emails");
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  // Only allow updates if the lead is in DM stage
  if (lead.stage !== "DM") {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Status can only be updated once while in DM stage",
      ),
    );
  }

  let hasEmails = Array.isArray(lead.emails) && lead.emails.length > 0;

  // CASE A: Lead has NO emails (Phone-only)
  if (!hasEmails) {
    lead.stage = "Verifier";
    await lead.save();
    return res.status(statusCodes.OK).json({
      success: true,
      message: "Phone-only lead moved to Verifier stage.",
      stage: lead.stage,
    });
  }

  // CASE B: Lead HAS emails
  let incomingArr = Array.isArray(req.body && req.body.emails)
    ? req.body.emails
    : [];
  if (!incomingArr.length) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Email data is required for this lead",
      ),
    );
  }

  let incomingMap = new Map();
  for (let row of incomingArr) {
    let norm = String(row.normalized || "")
      .trim()
      .toLowerCase();
    let status = String(row.status || "")
      .trim()
      .toUpperCase();
    if (norm && isValidEmailStatus(status)) {
      incomingMap.set(norm, status);
    }
  }

  let now = new Date();
  let updatedCount = 0;
  let missingCount = 0;

  for (let e of lead.emails) {
    let norm = String(e.normalized || "")
      .trim()
      .toLowerCase();
    let nextStatus = incomingMap.get(norm);

    if (!nextStatus) {
      missingCount++;
      continue;
    }

    e.status = nextStatus;
    e.verifiedBy = req.user.id;
    e.verifiedAt = now;
    updatedCount++;
  }

  // Enforce that ALL emails must be updated before the lead can hit the "Verifier" stage
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
    message: "Lead moved to Verifier stage.",
    updatedCount,
    stage: lead.stage,
  });
});

// 3) POST /api/verifier/leads/move-all-to-lq
// Logic: Move ALL leads in Verifier stage to LQ stage using optimized bulk operations
let moveAllVerifierLeadsToLQ = asyncHandler(async function (req, res, next) {
  // 1. Get all leads in Verifier stage
  let leads = await Lead.find({ stage: "Verifier" }).select("_id");
  if (leads.length === 0)
    return next(httpError(statusCodes.NOT_FOUND, "No leads to move"));

  // 2. Fetch all LQs once (Don't call assignmentService inside the loop)
  let lqs = await User.find({ role: "Lead Qualifiers", status: "APPROVED" })
    .select("_id")
    .sort({ _id: 1 });
  if (lqs.length === 0)
    return next(httpError(statusCodes.BAD_REQUEST, "No LQs available"));

  // 3. Get the starting point for Round-Robin from your Counter
  let counter = await Counter.findOneAndUpdate(
    { key: "LQ_ASSIGN" },
    { $inc: { seq: leads.length } }, // Increment by the total number of leads at once
    { new: true, upsert: true },
  );

  let startSeq = counter.seq - leads.length;
  let now = new Date();

  // 4. Prepare Bulk Operations
  let bulkOps = leads.map((lead, index) => {
    let lqIndex = (startSeq + index) % lqs.length;
    let assignedLqId = lqs[lqIndex]._id;

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
