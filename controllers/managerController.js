// controllers/managerController.js
let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

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
// GET /api/manager/leads?limit=20&skip=0
// Returns leads assigned to THIS manager in MANAGER stage
// --------------------------------------------------
let getMyAssignedLeads = asyncHandler(async function (req, res, next) {
  let managerId = req.user.id;

  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

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
    .populate("assignedTo", "name email role")
    .populate("comments.createdBy", "name email role");

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/decision
// body: { decision: "ACCEPT" | "REJECT", comment }
// Notes:
// - Manager only decides on MANAGER stage leads
// - Keeps comment history
// - Stage becomes DONE or REJECTED (simple & consistent)
// --------------------------------------------------
let decisionOnLead = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

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

  if (comment.length > 1000) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));
  }

  // Must be assigned to this manager + in MANAGER stage
  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER"
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
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

  // outcome stage
  lead.stage = decision === "REJECT" ? "REJECTED" : "MANAGER";

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message:
      "Lead " + (decision === "REJECT" ? "rejected" : "accepted") + " successfully",
    stage: lead.stage,
    status: lead.status
  });
});

// --------------------------------------------------
// POST /api/manager/leads/:id/comment
// body: { comment }
// Notes:
// - Only allow manager comments for MANAGER stage leads assigned to them
// --------------------------------------------------
let addManagerComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let comment = String((req.body && req.body.comment) || "").trim();

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  if (comment.length > 1000) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER"
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
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
// Notes:
// - Only manager assigned can mark PAID
// - Only while lead is in MANAGER stage
// --------------------------------------------------
let updatePaymentStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let newStatus = String((req.body && req.body.status) || "")
    .trim()
    .toUpperCase();

  if (newStatus !== "PAID") {
    return next(httpError(statusCodes.BAD_REQUEST, "Only PAID is allowed"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER"
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
  }

  // idempotent
  if (lead.status === "PAID") {
    return res.status(statusCodes.OK).json({
      success: true,
      message: "Lead already marked as PAID",
      status: lead.status
    });
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
