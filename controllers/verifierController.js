let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize"); // Kept from your code
let assignmentService = require("../utils/assignmentService"); // Essential for Round-Robin

// Helper for status validation
function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

// 1. GET /api/verifier/leads (KEEPING YOUR ORIGINAL LOGIC)
let getDmLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);
  if (limit > 100) limit = 100;
  if (skip < 0) skip = 0;

  let leads = await Lead.find({ stage: "DM" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "name location emails sources submittedDate submittedTime createdAt"
    );

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads,
  });
});

// 2. POST /api/verifier/leads/:leadId/update-emails (UPDATED TO BULK LOGIC)
let updateEmailStatuses = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let emails =
    req.body && Array.isArray(req.body.emails) ? req.body.emails : [];

  if (!emails.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "emails array is required"));
  }

  let lead = await Lead.findById(leadId);
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  let updatedCount = 0;

  // We loop through the incoming array and update the lead document
  for (let i = 0; i < emails.length; i++) {
    let incoming = emails[i] || {};
    let norm = String(incoming.normalized || "")
      .trim()
      .toLowerCase();
    let status = String(incoming.status || "")
      .trim()
      .toUpperCase();

    if (!norm || !isValidEmailStatus(status)) continue;

    for (let j = 0; j < lead.emails.length; j++) {
      if (String(lead.emails[j].normalized || "").toLowerCase() === norm) {
        lead.emails[j].status = status;
        lead.emails[j].verifiedBy = req.user.id;
        lead.emails[j].verifiedAt = new Date();
        updatedCount++;
        break;
      }
    }
  }

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Email statuses updated",
    updatedCount: updatedCount,
  });
});

// 3. POST /api/verifier/leads/:leadId/move-to-lq (NEW ROUND-ROBIN LOGIC)
let moveLeadToLeadQualifiers = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;

  let lead = await Lead.findById(leadId);
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  // Check if at least one email was reviewed (not PENDING)
  let hasAnyReviewed = lead.emails.some(
    (e) => e.status && e.status !== "PENDING"
  );

  if (!hasAnyReviewed) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "No email status updated yet")
    );
  }

  // Get the next user in the Round-Robin sequence
  let nextLq = await assignmentService.getNextLeadQualifier();
  if (!nextLq) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "No Lead Qualifiers available")
    );
  }

  // Move stage and assign
  lead.stage = "LQ";
  lead.assignedTo = nextLq._id;
  lead.assignedToRole = "Lead Qualifiers";
  lead.assignedAt = new Date();
  lead.verifiedCompletedAt = new Date();

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead moved to Lead Qualifiers",
    leadId: lead._id,
    assignedTo: String(nextLq._id),
  });
});

module.exports = {
  getDmLeads,
  updateEmailStatuses,
  moveLeadToLeadQualifiers,
};
