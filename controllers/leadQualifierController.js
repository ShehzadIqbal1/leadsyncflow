const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const User = require("../models/User");
const normalize = require("../utils/normalize");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");
const { getPktDateTime, buildPktRange } = require("../utils/pktDate");

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function isValidLqStatus(s) {
  return ["PENDING", "REACHED", "DEAD", "QUALIFIED"].indexOf(s) !== -1;
}

// ---------------------------------------------
// GET /api/lq/leads
// ---------------------------------------------
const getMyLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  const lqStatus = String(req.query.lqStatus || "")
    .trim()
    .toUpperCase();
  const allowed = ["PENDING", "REACHED", "DEAD", "QUALIFIED", "ALL", ""];
  if (!allowed.includes(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus filter"));
  }

  const today = String(req.query.today || "")
    .trim()
    .toLowerCase();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  let dateFilter;
  try {
    dateFilter = buildPktRange({ today, from, to });
  } catch (err) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "Invalid date format (YYYY-MM-DD)"),
    );
  }

  const baseQuery = {
    stage: "LQ",
    assignedTo: req.user.id,
  };

  if (dateFilter) {
    baseQuery.assignedAt = dateFilter;
  }

  const listQuery = { ...baseQuery };
  if (lqStatus && lqStatus !== "ALL") {
    listQuery.lqStatus = lqStatus;
  }

  const projection =
    "name location emails phones sources stage status lqStatus comments submittedDate submittedTime assignedAt createdAt";

  const current_page = Math.floor(skip / limit) + 1;
  const [leads, total_records, countsAgg] = await Promise.all([
    Lead.find(listQuery)
      .sort({ assignedAt: 1})
      .skip(skip)
      .limit(limit)
      .select(projection)
      .lean(),

    Lead.countDocuments(listQuery),

    Lead.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: "$lqStatus",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const counts_by_status = {
    ALL: 0,
    PENDING: 0,
    REACHED: 0,
    DEAD: 0,
    QUALIFIED: 0,
  };

  countsAgg.forEach((row) => {
    const key = String(row._id || "").toUpperCase();
    if (counts_by_status[key] !== undefined) {
      counts_by_status[key] = row.count;
      counts_by_status.ALL += row.count;
    }
  });

  return res.status(statusCodes.OK).json({
    success: true,
    message:
      "Lead Qualifier leads including the metadata for pagination and status counts",
    metadata: {
      total_records,
      current_page,
      per_page: limit,
      skip,
      counts_by_status,
    },
    leads,
  });
});

// ---------------------------------------------
// PATCH /api/lq/leads/:leadId/status
// body: { lqStatus }
// ---------------------------------------------
const updateLqStatus = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const lqStatus = String((req.body && req.body.lqStatus) || "")
    .trim()
    .toUpperCase();

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!isValidLqStatus(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus"));
  }

  const lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"),
    );
  }

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

// ---------------------------------------------
// POST /api/lq/leads/:leadId/comment
// body: { text }
// ---------------------------------------------
const addComment = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const text = String((req.body && req.body.text) || "").trim();

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!text) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment text is required"));
  }

  if (text.length > 1000) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment too long"));
  }

  const lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  });

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"),
    );
  }

  const pkt = getPktDateTime();

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

//submit qualified lead to manager (multi-contact)
const submitToMyManager = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;

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
    .map((x) =>
      String(x || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  selectedPhones = selectedPhones
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  // Mandatory validation: at least one email OR one phone
  if (!selectedEmails.length && !selectedPhones.length) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Provide at least one selectedEmail or selectedPhone",
      ),
    );
  }

  // 1) Find this LQ user + their manager mapping
  const lqUser = await User.findById(req.user.id).select("reportsTo role status");
  if (!lqUser) {
    return next(httpError(statusCodes.NOT_FOUND, "User not found"));
  }

  if (!lqUser.reportsTo) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "No manager assigned to you yet. Ask Super Admin to assign a manager.",
      ),
    );
  }

  // 2) Verify manager exists + approved
  const manager = await User.findOne({
    _id: lqUser.reportsTo,
    role: "Manager",
    status: "APPROVED",
  }).select("_id");

  if (!manager) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Your assigned manager is invalid or not approved",
      ),
    );
  }

  // 3) Fetch lead (need emails/phones to filter)
  const lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  }).select(
    "stage lqStatus emails phones phonesNormalized responseSource assignedTo assignedToRole assignedAt",
  );

  if (!lead) {
    return next(
      httpError(statusCodes.NOT_FOUND, "Lead not found / not assigned to you"),
    );
  }

  // 4) Must be qualified before moving
  if (String(lead.lqStatus || "").toUpperCase() !== "QUALIFIED") {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Lead must be QUALIFIED before submitting to manager",
      ),
    );
  }

  // ---------------------------------------------
  // 5) Filter Emails (keep only selected normalized)
  // ---------------------------------------------
  const existingEmails = Array.isArray(lead.emails) ? lead.emails : [];
  const selectedEmailSet = new Set(selectedEmails);

  const filteredEmails = existingEmails.filter(function (e) {
    const n = String((e && e.normalized) || "")
      .trim()
      .toLowerCase();
    return n && selectedEmailSet.has(n);
  });

  // ---------------------------------------------
  // 6) Filter Phones (keep only those that exist on lead)
  // - selectedPhones is raw input; validate existence via raw or normalized
  // - overwrite BOTH phones and phonesNormalized with only selected ones
  // ---------------------------------------------
  const existingPhones = Array.isArray(lead.phones) ? lead.phones : [];
  const existingPhonesNorm = Array.isArray(lead.phonesNormalized)
    ? lead.phonesNormalized
    : [];

  // build fast lookup sets
  const existingRawSet = new Set(
    existingPhones.map((p) => String(p || "").trim()),
  );
  const existingNormSet = new Set(
    existingPhonesNorm.map((p) => String(p || "").trim()),
  );

  const filteredPhones = [];
  const filteredPhonesNormalized = [];

  for (let i = 0; i < selectedPhones.length; i++) {
    const raw = String(selectedPhones[i] || "").trim();
    if (!raw) continue;

    const pNorm = normalize.normalizePhone(raw);
    if (!pNorm) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid phone in selectedPhones"),
      );
    }

    // must belong to THIS lead
    const belongs =
      existingRawSet.has(raw) ||
      existingNormSet.has(String(pNorm || "").trim());

    if (!belongs) {
      return next(
        httpError(
          statusCodes.BAD_REQUEST,
          "Selected phone not found in this lead",
        ),
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
        "Selected contacts do not match any existing emails/phones on this lead",
      ),
    );
  }

  // ---------------------------------------------
  // 8) Update responseSource primary driver:
  // - email/phone primary = first item of selected arrays (if exists)
  // - responseSource uses first valid filtered item
  // ---------------------------------------------
  const pkt = getPktDateTime();

  const responseSource = {};

  // Primary email (first filtered email)
  if (filteredEmails.length) {
    const primaryEmail = filteredEmails[0];
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
    const primaryPhone = filteredPhones[0];
    const primaryPhoneNorm = filteredPhonesNormalized[0];

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

// ---------------------------------------------
// GET /api/lq/stats
// PERFORMANCE-BASED STATS
// ---------------------------------------------
const getMyStats = asyncHandler(async function (req, res, next) {
  const today = String(req.query.today || "").trim().toLowerCase();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  let range;
  try {
    range = buildPktRange({ today, from, to });
  } catch (err) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid date format"));
  }

  const userId = new mongoose.Types.ObjectId(req.user.id);

  const pipeline = [
    {
      $match: {
        assignedTo: userId, // Match leads assigned to this user
        stage: "LQ",        // Ensure they are still in the LQ stage
        ...(range ? { assignedAt: range } : {}), // Filter by assignment date
      },
    },
    {
      $group: {
        _id: null,
        // 1. Total leads received in this time range
        totalReceived: { $sum: 1 },

        // 2. Leads that are currently PENDING
        pending: {
          $sum: { $cond: [{ $eq: ["$lqStatus", "PENDING"] }, 1, 0] },
        },

        // 3. Leads that have reached the MANAGER stage (Qualified)
        qualified: {
          $sum: { $cond: [{ $eq: ["$stage", "MANAGER"] }, 1, 0] },
        },

        // 4. Other Statuses
        reached: {
          $sum: { $cond: [{ $eq: ["$lqStatus", "REACHED"] }, 1, 0] },
        },
        dead: {
          $sum: { $cond: [{ $eq: ["$lqStatus", "DEAD"] }, 1, 0] },
        },
      },
    },
    { $project: { _id: 0 } },
  ];

  const result = await Lead.aggregate(pipeline);

  const stats = result[0] || {
    totalReceived: 0,
    pending: 0,
    qualified: 0,
    reached: 0,
    dead: 0,
  };

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead Qualifier performance stats",
    stats,
  });
});

module.exports = {
  getMyLeads: getMyLeads,
  updateLqStatus: updateLqStatus,
  addComment: addComment,
  submitToMyManager: submitToMyManager,
  getMyStats: getMyStats,
};
