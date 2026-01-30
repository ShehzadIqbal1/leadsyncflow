// controllers/verifierController.js
let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
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

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  let leads = await Lead.find({ stage: "DM" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select("emails submittedDate stage");

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads,
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
    return next(httpError(statusCodes.BAD_REQUEST, "Status can only be updated once while in DM stage"));
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
  let incomingArr = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
  if (!incomingArr.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "Email data is required for this lead"));
  }

  let incomingMap = new Map();
  for (let row of incomingArr) {
    let norm = String(row.normalized || "").trim().toLowerCase();
    let status = String(row.status || "").trim().toUpperCase();
    if (norm && isValidEmailStatus(status)) {
      incomingMap.set(norm, status);
    }
  }

  let now = new Date();
  let updatedCount = 0;
  let missingCount = 0;

  for (let e of lead.emails) {
    let norm = String(e.normalized || "").trim().toLowerCase();
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
      missingCount
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

// 3) POST /api/verifier/leads/:leadId/move-to-lq
// Logic: Assigns the lead to an LQ user via Round-Robin and moves stage to "LQ"
let moveLeadToLeadQualifiers = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let lead = await Lead.findById(leadId);
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  // This API strictly requires the lead to have passed the "Verifier" step
  if (lead.stage !== "Verifier") {
    return next(httpError(statusCodes.CONFLICT, "Lead must be in Verifier stage to move to LQ"));
  }

  // Trigger Round-Robin Assignment Service
  let nextLq = await assignmentService.getNextLeadQualifier();
  if (!nextLq) {
    return next(httpError(statusCodes.BAD_REQUEST, "No Lead Qualifiers (APPROVED) available"));
  }

  let now = new Date();
  lead.stage = "LQ";
  lead.assignedTo = nextLq._id;
  lead.assignedToRole = "Lead Qualifiers";
  lead.assignedAt = now;
  lead.verifiedCompletedAt = now;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead successfully assigned to LQ via Round-Robin.",
    assignedTo: nextLq._id,
    stage: lead.stage
  });
});

module.exports = {
  getDmLeads,
  updateEmailStatuses,
  moveLeadToLeadQualifiers,
};