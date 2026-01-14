let Lead = require("../models/Lead");
let User = require("../models/User");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

function isValidLqStatus(s) {
  return ["IN_CONVERSATION", "DEAD", "QUALIFIED"].indexOf(s) !== -1;
}

function getPktDateTime() {
  let now = new Date();
  let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  let pktTime = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour12: false,
  });
  return { now: now, pktDate: pktDate, pktTime: pktTime };
}

// GET /api/lq/managers
let getManagersList = asyncHandler(async function (req, res, next) {

  let q = safeString(req.query.q).toLowerCase();

  let query = {
    role: "Manager",
    status: constants.userStatus.APPROVED
  };

  let managers = await User.find(query)
    .select("_id name email department role")
    .sort({ name: 1 });

  return res.status(statusCodes.OK).json({
    success: true,
    managers: managers.map(function (m) {
      return {
        id: m._id,
        name: m.name,
        email: m.email,
        department: m.department,
        role: m.role
      };
    })
  });
});



// GET /api/lq/leads?limit=20&skip=0
let getMyLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (!limit || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (!skip || skip < 0) skip = 0;

  let leads = await Lead.find({ stage: "LQ", assignedTo: req.user.id })
    .sort({ assignedAt: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return res.status(statusCodes.OK).json({ success: true, leads: leads });
});

// PATCH /api/lq/leads/:leadId/status
// body: { lqStatus: "QUALIFIED" }
let updateLqStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let lqStatus = String((req.body && req.body.lqStatus) || "")
    .trim()
    .toUpperCase();

  if (!isValidLqStatus(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  });
  if (!lead)
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );

  lead.lqStatus = lqStatus;
  lead.lqUpdatedAt = new Date();
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "LQ status updated",
    lqStatus: lead.lqStatus,
  });
});

// POST /api/lq/leads/:leadId/comment
// body: { text: "comment..." }
let addComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let text = String((req.body && req.body.text) || "").trim();

  if (!text)
    return next(httpError(statusCodes.BAD_REQUEST, "Comment text is required"));
  if (text.length > 1000)
    return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  });
  if (!lead)
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );

  let pkt = getPktDateTime();

  lead.comments.push({
    text: text,
    createdBy: req.user.id,
    createdByRole: "Lead Qualifiers",
    createdAt: pkt.now,
    createdDate: pkt.pktDate,
    createdTime: pkt.pktTime,
  });

  lead.lqUpdatedAt = pkt.now;
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.CREATED).json({
    success: true,
    message: "Comment added",
    commentsCount: lead.comments.length,
  });
});

// POST /api/lq/leads/:leadId/assign-manager
// body: { managerId: "..." , commentText?: "optional comment" }
let assignToManager = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  let managerId = String((req.body && req.body.managerId) || "").trim();
  let commentText = String((req.body && req.body.commentText) || "").trim();

  if (!managerId)
    return next(httpError(statusCodes.BAD_REQUEST, "managerId is required"));

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  });
  if (!lead)
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );

  // verify manager exists and approved
  let manager = await User.findOne({
    _id: managerId,
    role: "Manager",
    status: "APPROVED",
  }).select("_id role");
  if (!manager)
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));

  let pkt = getPktDateTime();

  // optional comment on assignment
  if (commentText) {
    if (commentText.length > 1000) {
      return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));
    }

    lead.comments.push({
      text: commentText,
      createdBy: req.user.id,
      createdByRole: "Lead Qualifiers",
      createdAt: pkt.now,
      createdDate: pkt.pktDate,
      createdTime: pkt.pktTime,
    });
  }

  // move to manager stage + assign
  lead.stage = "MANAGER";
  lead.assignedTo = manager._id;
  lead.assignedToRole = "Manager";
  lead.assignedAt = pkt.now;

  // keep LQ metadata
  lead.lqUpdatedAt = pkt.now;
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Assigned to manager",
    leadId: lead._id,
    assignedTo: String(manager._id),
  });
});

module.exports = {
  getManagersList: getManagersList,
  getMyLeads: getMyLeads,
  updateLqStatus: updateLqStatus,
  addComment: addComment,
  assignToManager: assignToManager,
};
