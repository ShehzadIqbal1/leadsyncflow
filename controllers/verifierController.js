let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize");

function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

// GET /api/verifier/leads
let getDmLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);
  if (limit > 100) limit = 100;
  if (skip < 0) skip = 0;

  let leads = await Lead.find({ stage: "DM" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select("name location emails sources submittedDate submittedTime createdAt");

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads
  });
});

// PATCH /api/verifier/leads/:leadId/emails/status
let updateEmailStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let status = String(req.body.status || "").trim().toUpperCase();

  if (!isValidEmailStatus(status)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid status"));
  }

  // Accept either email or normalized
  let rawEmail = String(req.body.email || "").trim();
  let normalized = String(req.body.normalized || "").trim().toLowerCase();

  if (!rawEmail && !normalized) {
    return next(httpError(statusCodes.BAD_REQUEST, "Provide email or normalized"));
  }

  if (!normalized && rawEmail) {
    normalized = normalize.normalizeEmail(rawEmail);
    if (!normalize.isValidEmail(normalized)) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid email"));
    }
  }

  // Update the matching email subdoc
  let update = await Lead.updateOne(
    { _id: leadId, "emails.normalized": normalized },
    {
      $set: {
        "emails.$.status": status,
        "emails.$.verifiedBy": req.user.id,
        "emails.$.verifiedAt": new Date()
      }
    }
  );

  if (!update || update.matchedCount === 0) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead/email not found"));
  }

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Email status updated",
    normalized: normalized,
    status: status
  });
});

module.exports = {
  getDmLeads: getDmLeads,
  updateEmailStatus: updateEmailStatus
};
