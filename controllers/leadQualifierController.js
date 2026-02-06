let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function isValidLqStatus(s) {
  return ["IN_CONVERSATION", "DEAD", "QUALIFIED"].indexOf(s) !== -1;
}

function getPktDateTime() {
  let now = new Date();
  return {
    now: now,
    pktDate: now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }),
    pktTime: now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Karachi",
      hour12: false
    })
  };
}

// ---------------------------------------------
// GET /api/lq/leads
// ---------------------------------------------
let getMyLeads = asyncHandler(async function (req, res) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  let query = {
    stage: "LQ",
    assignedTo: req.user.id
  };

  let leads = await Lead.find(query)
    .sort({ assignedAt: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "name location emails phones sources stage status lqStatus comments submittedDate submittedTime assignedAt createdAt"
    );

  return res.status(statusCodes.OK).json({
    success: true,
    limit: limit,
    skip: skip,
    leads: leads
  });
});

// ---------------------------------------------
// PATCH /api/lq/leads/:leadId/status
// body: { lqStatus }
// ---------------------------------------------
let updateLqStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let lqStatus = String((req.body && req.body.lqStatus) || "")
    .trim()
    .toUpperCase();

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!isValidLqStatus(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"));
  }

  lead.lqStatus = lqStatus;
  lead.lqUpdatedAt = new Date();
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "LQ status updated",
    lqStatus: lead.lqStatus
  });
});

// ---------------------------------------------
// POST /api/lq/leads/:leadId/comment
// body: { text }
// ---------------------------------------------
let addComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let text = String((req.body && req.body.text) || "").trim();

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!text) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment text is required"));
  }

  if (text.length > 1000) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"));
  }

  let pkt = getPktDateTime();

  lead.comments.push({
    text: text,
    createdBy: req.user.id,
    createdByRole: "Lead Qualifiers",
    createdAt: pkt.now,
    createdDate: pkt.pktDate,
    createdTime: pkt.pktTime
  });

  lead.lqUpdatedAt = pkt.now;
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.CREATED).json({
    success: true,
    message: "Comment added",
    commentsCount: lead.comments.length
  });
});

module.exports = {
  getMyLeads: getMyLeads,
  updateLqStatus: updateLqStatus,
  addComment: addComment
};
