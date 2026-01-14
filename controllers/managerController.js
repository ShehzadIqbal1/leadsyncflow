let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

// 🇵🇰 PKT date/time helper
function getPKT() {
  let now = new Date();
  return {
    date: now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }),
    time: now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Karachi",
      hour12: false
    })
  };
}

// --------------------------------------------------
// GET /api/manager/leads
// --------------------------------------------------
let getMyAssignedLeads = asyncHandler(async function (req, res, next) {
  let managerId = req.user.id;

  let leads = await Lead.find({
    assignedTo: managerId,
    stage: "LQ"
  })
    .sort({ assignedAt: -1 })
    .populate("createdBy", "name email")
    .populate("assignedTo", "name email");

  return res.status(statusCodes.OK).json({
    success: true,
    leads
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/decision
// body: { decision: "ACCEPT" | "REJECT", comment }
// --------------------------------------------------
let decisionOnLead = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  let decision = String(req.body.decision || "").toUpperCase();
  let comment = String(req.body.comment || "").trim();

  if (!decision || ["ACCEPT", "REJECT"].indexOf(decision) === -1) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid decision"));
  }

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  let pkt = getPKT();

  // Add comment (history preserved)
  lead.comments.push({
    text: comment,
    createdBy: req.user.id,
    createdByRole: "Manager",
    createdDate: pkt.date,
    createdTime: pkt.time
  });

  // Update stage based on decision
  if (decision === "REJECT") {
    lead.stage = "REJECTED";
  }

  if (decision === "ACCEPT") {
    lead.stage = "MANAGER_APPROVED";
  }

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: `Lead ${decision.toLowerCase()}ed successfully`
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/comment
// body: { comment }
// --------------------------------------------------
let addManagerComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  let comment = String(req.body.comment || "").trim();

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  let pkt = getPKT();

  lead.comments.push({
    text: comment,
    createdBy: req.user.id,
    createdByRole: "Manager",
    createdDate: pkt.date,
    createdTime: pkt.time
  });

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Comment added"
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/payment-status
// body: { status: "PAID" }
// --------------------------------------------------
let updatePaymentStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  let status = String(req.body.status || "").toUpperCase();

  if (status !== "PAID") {
    return next(httpError(statusCodes.BAD_REQUEST, "Only PAID is allowed"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  lead.status = "PAID";
  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead marked as PAID"
  });
});

module.exports = {
  getMyAssignedLeads,
  decisionOnLead,
  addManagerComment,
  updatePaymentStatus
};
