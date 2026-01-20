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
    .select("name location emails phones sources submittedDate submittedTime createdAt");

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads
  });
});

// 2) POST /api/verifier/leads/:leadId/update-emails
// body: { emails: [{ normalized, status }] }
let updateEmailStatuses = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let emails = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
  if (!emails.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "emails array is required"));
  }

  let lead = await Lead.findById(leadId);
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  if (lead.stage !== "DM") {
    return next(httpError(statusCodes.BAD_REQUEST, "Lead is not in DM stage"));
  }

  // If lead has no emails, verifier can't update anything (but lead can still move to LQ later)
  if (!Array.isArray(lead.emails) || lead.emails.length === 0) {
    return next(httpError(statusCodes.BAD_REQUEST, "This lead has no emails to update"));
  }

  // Build lookup map from existing lead emails (normalized => index)
  let idxMap = new Map();
  for (let i = 0; i < lead.emails.length; i++) {
    let n = String(lead.emails[i].normalized || "").trim().toLowerCase();
    if (n) idxMap.set(n, i);
  }

  let updatedCount = 0;
  let ignoredCount = 0;
  let now = new Date();

  for (let i = 0; i < emails.length; i++) {
    let incoming = emails[i] || {};
    let norm = String(incoming.normalized || "").trim().toLowerCase();
    let status = String(incoming.status || "").trim().toUpperCase();

    if (!norm || !isValidEmailStatus(status)) {
      ignoredCount++;
      continue;
    }

    let idx = idxMap.get(norm);
    if (idx === undefined) {
      ignoredCount++;
      continue;
    }

    // update
    lead.emails[idx].status = status;
    lead.emails[idx].verifiedBy = req.user.id;
    lead.emails[idx].verifiedAt = now;
    updatedCount++;
  }

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Email statuses updated",
    updatedCount: updatedCount,
    ignoredCount: ignoredCount
  });
});

// 3) POST /api/verifier/leads/:leadId/move-to-lq
let moveLeadToLeadQualifiers = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let lead = await Lead.findById(leadId);
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  if (lead.stage !== "DM") {
    return next(httpError(statusCodes.CONFLICT, "Lead already moved from DM"));
  }

  // ✅ DM can submit phone-only leads. For those, verifier shouldn't block move.
  let hasEmails = Array.isArray(lead.emails) && lead.emails.length > 0;

  let hasAnyReviewed = false;
  if (hasEmails) {
    hasAnyReviewed = lead.emails.some(function (e) {
      return e && e.status && e.status !== "PENDING";
    });

    if (!hasAnyReviewed) {
      return next(httpError(statusCodes.BAD_REQUEST, "No email status updated yet"));
    }
  }
  // If there are no emails, allow moving (phone-only flow)

  let nextLq = await assignmentService.getNextLeadQualifier();
  if (!nextLq) {
    return next(httpError(statusCodes.BAD_REQUEST, "No Lead Qualifiers available"));
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
    message: "Lead moved to Lead Qualifiers",
    leadId: lead._id,
    assignedTo: String(nextLq._id)
  });
});

module.exports = {
  getDmLeads,
  updateEmailStatuses,
  moveLeadToLeadQualifiers
};
