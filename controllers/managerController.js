// controllers/managerController.js

let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

// Import the PKT utility
const { getPktDateTime } = require("../utils/pktDate");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// --------------------------------------------------
// GET /api/manager/leads?limit=20&skip=0
// Returns leads assigned to THIS manager in MANAGER stage with priority for super-admin returned leads
// --------------------------------------------------
let getMyAssignedLeads = asyncHandler(async function (req, res, next) {
  let managerId = req.user.id;

  // 1. Parse and validate pagination inputs
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100; // Cap limit at 100
  if (isNaN(skip) || skip < 0) skip = 0;

  const filter = {
    assignedTo: managerId,
    stage: "MANAGER",
  };

  let [leads, totalLeads] = await Promise.all([
    Lead.find(filter)
      .sort({
        superAdminReturnPriorityUntil: -1, // Priority for 24hr returned leads
        assignedAt: -1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("comments.createdBy", "name email role"),
    Lead.countDocuments(filter),
  ]);

  // 4. Return results
  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads: totalLeads,
    count: leads.length,
    leads: leads,
  });
});

// REQUEST REJECTION (NO DIRECT REJECTION ANYMORE)
let requestRejection = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let comment = String((req.body && req.body.comment) || "").trim();
  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER",
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  const { now, pktDate, pktTime } = getPktDateTime();

  lead.comments.push({
    text: comment,
    createdBy: req.user.id,
    createdByRole: "Manager",
    createdAt: now,
    createdDate: pktDate,
    createdTime: pktTime,
  });

  lead.rejectionRequested = true;
  lead.rejectionRequestedAt = now;
  lead.rejectionRequestedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Rejection request sent to Super Admin",
  });
});

// UPSALE + PAYMENT
let updatePaymentStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.id;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let amount = Number(req.body.amount);
  let comment = String(req.body.comment || "").trim();

  if (!amount || amount <= 0) {
    return next(httpError(statusCodes.BAD_REQUEST, "Valid amount required"));
  }

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    assignedTo: req.user.id,
    stage: "MANAGER",
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  const { now, pktDate, pktTime } = getPktDateTime();

  if (!Array.isArray(lead.upsales)) {
    lead.upsales = [];
  }

  lead.upsales.push({
    amount: amount,
    comment: comment,
    addedBy: req.user.id,
    addedAt: now,
    addedDate: pktDate,
    addedTime: pktTime,
  });

  lead.status = "PAID";

  // calculate total
  let totalUpsellAmount = lead.upsales.reduce(
    (sum, u) => sum + (u.amount || 0),
    0,
  );

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Payment recorded successfully",
    totalUpsellAmount,
    upsellEntries: lead.upsales.length,
  });
});

module.exports = {
  getMyAssignedLeads: getMyAssignedLeads,
  requestRejection: requestRejection,
  updatePaymentStatus: updatePaymentStatus,
};
