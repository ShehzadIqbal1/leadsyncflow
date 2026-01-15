let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

// 🇵🇰 PKT date/time helper
function getPKT() {
  let now = new Date();
  return {
    now: now,
    date: now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }),
    time: now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Karachi",
      hour12: false
    })
  };
}

// --------------------------------------------------
// GET /api/manager/leads
// Returns leads assigned to THIS manager in MANAGER stage
// --------------------------------------------------
let getMyAssignedLeads = asyncHandler(async function (req, res, next) {
  let managerId = req.user.id;

  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);
  if (!limit || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (!skip || skip < 0) skip = 0;

  let leads = await Lead.find({
    assignedTo: managerId,
    stage: "MANAGER"
  })
    .sort({ assignedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "name location emails phones sources stage status lqStatus comments responseSource assignedAt submittedDate submittedTime createdAt createdBy assignedTo"
    )
    .populate("createdBy", "name email role")
    .populate("assignedTo", "name email role");

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/decision
// body: { decision: "ACCEPT" | "REJECT", comment }
// Notes:
// - Keeps comment history
// - Sets stage to DONE or REJECTED (simple & consistent)
// --------------------------------------------------
let decisionOnLead = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;

  let decision = String((req.body && req.body.decision) || "")
    .trim()
    .toUpperCase();

  let comment = String((req.body && req.body.comment) || "").trim();

  if (["ACCEPT", "REJECT"].indexOf(decision) === -1) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid decision"));
  }

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  // Make sure lead is assigned to this manager and in correct stage
  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER"
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"));
  }

  let pkt = getPKT();

  // history comment
  lead.comments.push({
    text: comment,
    createdBy: req.user.id,
    createdByRole: "Manager",
    createdAt: pkt.now,
    createdDate: pkt.date,
    createdTime: pkt.time
  });

  // simple stage outcomes
  if (decision === "REJECT") {
    lead.stage = "REJECTED";
  } else {
    lead.stage = "DONE";
  }

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead " + (decision === "REJECT" ? "rejected" : "accepted") + " successfully",
    stage: lead.stage
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/comment
// body: { comment }
// --------------------------------------------------
let addManagerComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  let comment = String((req.body && req.body.comment) || "").trim();

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"));
  }

  let pkt = getPKT();

  lead.comments.push({
    text: comment,
    createdBy: req.user.id,
    createdByRole: "Manager",
    createdAt: pkt.now,
    createdDate: pkt.date,
    createdTime: pkt.time
  });

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Comment added",
    commentsCount: lead.comments.length
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/payment-status
// body: { status: "PAID" }
// --------------------------------------------------
let updatePaymentStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  let newStatus = String((req.body && req.body.status) || "")
    .trim()
    .toUpperCase();

  if (newStatus !== "PAID") {
    return next(httpError(statusCodes.BAD_REQUEST, "Only PAID is allowed"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"));
  }

  lead.status = "PAID";
  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead marked as PAID",
    status: lead.status
  });
});

module.exports = {
  getMyAssignedLeads: getMyAssignedLeads,
  decisionOnLead: decisionOnLead,
  addManagerComment: addManagerComment,
  updatePaymentStatus: updatePaymentStatus
};
