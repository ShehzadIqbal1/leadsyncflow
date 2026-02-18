let mongoose = require("mongoose");
let Lead = require("../models/Lead");
let User = require("../models/User");
let normalize = require("../utils/normalize");
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

//submit qualified lead to manager (multi-contact)
let submitToMyManager = asyncHandler(async function (req, res, next) {
  let leadId = req.params.leadId;
  console.log("submitToMyManager called with leadId:", leadId, "and body:", req.body);

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  // 0) Read inputs
  let selectedEmails = Array.isArray(req.body && req.body.selectedEmails)
    ? req.body.selectedEmails
    : [];
  let selectedPhones = Array.isArray(req.body && req.body.selectedPhones)
    ? req.body.selectedPhones
    : [];

  // normalize/clean inputs
  selectedEmails = selectedEmails
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  selectedPhones = selectedPhones
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  // Mandatory validation: at least one email OR one phone
  if (!selectedEmails.length && !selectedPhones.length) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Provide at least one selectedEmail or selectedPhone"
      )
    );
  }

  // 1) Find this LQ user + their manager mapping
  let lqUser = await User.findById(req.user.id).select("reportsTo role status");
  if (!lqUser) {
    return next(httpError(statusCodes.NOT_FOUND, "User not found"));
  }

  if (!lqUser.reportsTo) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "No manager assigned to you yet. Ask Super Admin to assign a manager."
      )
    );
  }

  // 2) Verify manager exists + approved
  let manager = await User.findOne({
    _id: lqUser.reportsTo,
    role: "Manager",
    status: "APPROVED",
  }).select("_id");

  if (!manager) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Your assigned manager is invalid or not approved"
      )
    );
  }

  // 3) Fetch lead (need emails/phones to filter)
  let lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  }).select(
    "stage lqStatus emails phones phonesNormalized responseSource assignedTo assignedToRole assignedAt"
  );

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you")
    );
  }

  // 4) Must be qualified before moving
  if (String(lead.lqStatus || "").toUpperCase() !== "QUALIFIED") {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Lead must be QUALIFIED before submitting to manager"
      )
    );
  }

  // ---------------------------------------------
  // 5) Filter Emails (keep only selected normalized)
  // ---------------------------------------------
  let existingEmails = Array.isArray(lead.emails) ? lead.emails : [];
  let selectedEmailSet = new Set(selectedEmails);

  let filteredEmails = existingEmails.filter(function (e) {
    let n = String((e && e.normalized) || "").trim().toLowerCase();
    return n && selectedEmailSet.has(n);
  });

  // ---------------------------------------------
  // 6) Filter Phones (keep only those that exist on lead)
  // - selectedPhones is raw input; validate existence via raw or normalized
  // - overwrite BOTH phones and phonesNormalized with only selected ones
  // ---------------------------------------------
  let existingPhones = Array.isArray(lead.phones) ? lead.phones : [];
  let existingPhonesNorm = Array.isArray(lead.phonesNormalized)
    ? lead.phonesNormalized
    : [];

  // build fast lookup sets
  let existingRawSet = new Set(existingPhones.map((p) => String(p || "").trim()));
  let existingNormSet = new Set(existingPhonesNorm.map((p) => String(p || "").trim()));

  let filteredPhones = [];
  let filteredPhonesNormalized = [];

  for (let i = 0; i < selectedPhones.length; i++) {
    let raw = String(selectedPhones[i] || "").trim();
    if (!raw) continue;

    let pNorm = normalize.normalizePhone(raw);
    if (!pNorm) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid phone in selectedPhones"));
    }

    // must belong to THIS lead
    let belongs =
      existingRawSet.has(raw) || existingNormSet.has(String(pNorm || "").trim());

    if (!belongs) {
      return next(
        httpError(
          statusCodes.BAD_REQUEST,
          "Selected phone not found in this lead"
        )
      );
    }

    filteredPhones.push(raw);
    filteredPhonesNormalized.push(pNorm);
  }

  // ---------------------------------------------
  // 7) Post-filter validation:
  // Ensure at least 1 email OR 1 phone remains AFTER filtering
  // ---------------------------------------------
  if (!filteredEmails.length && !filteredPhones.length) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Selected contacts do not match any existing emails/phones on this lead"
      )
    );
  }

  // ---------------------------------------------
  // 8) Update responseSource primary driver:
  // - email/phone primary = first item of selected arrays (if exists)
  // - responseSource uses first valid filtered item
  // ---------------------------------------------
  let pkt = getPktDateTime();

  let responseSource = {};

  // Primary email (first filtered email)
  if (filteredEmails.length) {
    let primaryEmail = filteredEmails[0];
    responseSource.email = {
      value: String(primaryEmail.value || ""),
      normalized: String(primaryEmail.normalized || ""),
      selectedBy: req.user.id,
      selectedAt: pkt.now,
      selectedDate: pkt.pktDate,
      selectedTime: pkt.pktTime,
    };
  }

  // Primary phone (first filtered phone)
  if (filteredPhones.length) {
    let primaryPhone = filteredPhones[0];
    let primaryPhoneNorm = filteredPhonesNormalized[0];

    responseSource.phone = {
      value: String(primaryPhone || ""),
      normalized: String(primaryPhoneNorm || ""),
      selectedBy: req.user.id,
      selectedAt: pkt.now,
      selectedDate: pkt.pktDate,
      selectedTime: pkt.pktTime,
    };
  }

  // ---------------------------------------------
  // 9) Overwrite lead contacts with qualified-only data
  // ---------------------------------------------
  lead.emails = filteredEmails;
  lead.phones = filteredPhones;
  lead.phonesNormalized = filteredPhonesNormalized;
  lead.responseSource = responseSource;

  // ---------------------------------------------
  // 10) Move lead to manager
  // ---------------------------------------------
  lead.stage = "MANAGER";
  lead.assignedTo = manager._id;
  lead.assignedToRole = "Manager";
  lead.assignedAt = pkt.now;

  // keep LQ update metadata
  lead.lqUpdatedAt = pkt.now;
  lead.lqUpdatedBy = req.user.id;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead submitted to your assigned manager with qualified contacts",
    leadId: String(lead._id),
    assignedTo: String(manager._id),
    assignedToRole: "Manager",
    qualifiedEmailsCount: lead.emails.length,
    qualifiedPhonesCount: lead.phones.length,
    responseSource: lead.responseSource,
  });
});


module.exports = {
  getMyLeads: getMyLeads,
  updateLqStatus: updateLqStatus,
  addComment: addComment,
  submitToMyManager: submitToMyManager
};
