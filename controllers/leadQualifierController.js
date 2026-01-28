// controllers/leadQualifierController.js
let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let User = require("../models/User");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let constants = require("../utils/constants");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function isValidLqStatus(s) {
  return ["IN_CONVERSATION", "DEAD", "QUALIFIED"].indexOf(s) !== -1;
}

function getPktDateTime() {
  let now = new Date();
  let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  let pktTime = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour12: false
  });
  return { now: now, pktDate: pktDate, pktTime: pktTime };
}

// --------------------------------------------------
// GET /api/lq/managers
// --------------------------------------------------
let getManagersList = asyncHandler(async function (req, res, next) {
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

// --------------------------------------------------
// GET /api/lq/leads?limit=20&skip=0
// --------------------------------------------------
let getMyLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  let leads = await Lead.find({ stage: "LQ", assignedTo: req.user.id })
    .sort({ assignedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return res.status(statusCodes.OK).json({
    success: true,
    leads: leads
  });
});

// --------------------------------------------------
// PATCH /api/lq/leads/:leadId/status
// body: { lqStatus: "QUALIFIED" }
// --------------------------------------------------
let updateLqStatus = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let lqStatus = String((req.body && req.body.lqStatus) || "")
    .trim()
    .toUpperCase();

  if (!isValidLqStatus(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
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

// --------------------------------------------------
// POST /api/lq/leads/:leadId/comment
// body: { text: "comment..." }
// --------------------------------------------------
let addComment = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let text = String((req.body && req.body.text) || "").trim();

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
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
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

// --------------------------------------------------
// POST /api/lq/leads/:leadId/assign-manager
// body: { managerId, responseType: "EMAIL|PHONE", responseValue: "...", commentText? }
// --------------------------------------------------
let assignToManager = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  let managerId = String((req.body && req.body.managerId) || "").trim();
  let responseType = String((req.body && req.body.responseType) || "")
    .trim()
    .toUpperCase();
  let responseValue = String((req.body && req.body.responseValue) || "").trim();
  let commentText = String((req.body && req.body.commentText) || "").trim();

  if (!isValidObjectId(managerId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));
  }

  if (["EMAIL", "PHONE"].indexOf(responseType) === -1) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "responseType must be EMAIL or PHONE")
    );
  }

  if (!responseValue) {
    return next(httpError(statusCodes.BAD_REQUEST, "responseValue is required"));
  }

  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
  }

  // (Recommended) Only allow assigning to manager if QUALIFIED
  // If you want to allow IN_CONVERSATION too, remove this block.
  if (lead.lqStatus !== "QUALIFIED") {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Lead must be QUALIFIED before assigning to manager"
      )
    );
  }

  // verify manager exists and approved
  let manager = await User.findOne({
    _id: managerId,
    role: "Manager",
    status: constants.userStatus.APPROVED
  }).select("_id role");

  if (!manager) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));
  }

  // validate response source belongs to THIS lead + build normalized
  let normalized = "";
  let selectedRaw = responseValue;

  if (responseType === "EMAIL") {
    // Normalize the incoming email (same as your normalize util)
    let eNorm = normalize.normalizeEmail(responseValue);
    if (!normalize.isValidEmail(eNorm)) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid email selected"));
    }

    // Check email exists in lead (compare against stored normalized)
    let found = false;
    for (let i = 0; i < lead.emails.length; i++) {
      let storedNorm = String(lead.emails[i].normalized || "").toLowerCase();
      if (storedNorm && storedNorm === String(eNorm || "").toLowerCase()) {
        found = true;
        normalized = storedNorm;
        selectedRaw = String(lead.emails[i].value || responseValue);
        break;
      }
    }

    if (!found) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Selected email not found in this lead")
      );
    }
  }

  if (responseType === "PHONE") {
    let pNorm = normalize.normalizePhone(responseValue);
    if (!pNorm) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid phone selected"));
    }

    // Check phone exists in lead (either raw match OR normalized match)
    let foundPhone = false;

    // raw check
    for (let j = 0; j < lead.phones.length; j++) {
      if (String(lead.phones[j] || "").trim() === responseValue) {
        foundPhone = true;
        selectedRaw = String(lead.phones[j] || responseValue);
        break;
      }
    }

    // normalized check (fallback)
    if (!foundPhone && Array.isArray(lead.phonesNormalized)) {
      for (let k = 0; k < lead.phonesNormalized.length; k++) {
        if (String(lead.phonesNormalized[k] || "") === String(pNorm || "")) {
          foundPhone = true;
          break;
        }
      }
    }

    if (!foundPhone) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Selected phone not found in this lead")
      );
    }

    normalized = pNorm;
  }

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
      createdTime: pkt.pktTime
    });
  }

  // store response source (fits your schema)
  lead.responseSource = {
    type: responseType,
    value: selectedRaw,
    normalized: normalized,
    selectedBy: req.user.id,
    selectedAt: pkt.now,
    selectedDate: pkt.pktDate,
    selectedTime: pkt.pktTime
  };

  // move to manager stage + assign
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
    responseSource: lead.responseSource
  });
});

module.exports = {
  getManagersList,
  getMyLeads,
  updateLqStatus,
  addComment,
  assignToManager
};
