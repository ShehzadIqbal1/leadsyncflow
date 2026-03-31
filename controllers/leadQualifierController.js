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
      .sort({ assignedAt: -1 })
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

// PATCH /api/lq/leads/status
// body: { leadIds: "id1" } OR { leadIds: ["id1", "id2"] }
// ---------------------------------------------
const updateLqStatus = asyncHandler(async function (req, res, next) {
  const { leadIds: rawIds, lqStatus: rawStatus } = req.body;

  // 1. Normalize leadIds to always be an array
  // If it's a string, wrap it: ["id1"]. If it's already an array, keep it.
  const leadIds = Array.isArray(rawIds) ? rawIds : [rawIds].filter(Boolean);

  const lqStatus = String(rawStatus || "")
    .trim()
    .toUpperCase();

  // 2. Validation
  if (leadIds.length === 0) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "No valid leadId(s) provided"),
    );
  }

  if (!isValidLqStatus(lqStatus)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus"));
  }

  // 3. Database Operation (Works for 1 or 100 IDs)
  const result = await Lead.updateMany(
    {
      _id: { $in: leadIds },
      stage: "LQ",
      assignedTo: req.user.id,
    },
    {
      $set: {
        lqStatus: lqStatus,
        lqUpdatedAt: new Date(),
        lqUpdatedBy: req.user.id,
      },
    },
  );

  // 4. Smart Response
  if (result.matchedCount === 0) {
    return next(
      httpError(
        statusCodes.NOT_FOUND,
        "No matching leads found/assigned to you",
      ),
    );
  }

  return res.status(statusCodes.OK).json({
    success: true,
    message: `Successfully updated ${result.modifiedCount} lead(s)`,
    updatedCount: result.modifiedCount,
    lqStatus: lqStatus,
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

// submit qualified lead to manager (multi-contact, keep original lead contacts)
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

  // normalize/clean inputs + dedupe
  selectedEmails = [
    ...new Set(
      selectedEmails
        .map((x) =>
          String(x || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];

  selectedPhones = [
    ...new Set(
      selectedPhones.map((x) => String(x || "").trim()).filter(Boolean),
    ),
  ];

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
  const lqUser = await User.findById(req.user.id).select(
    "reportsTo role status",
  );

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

  // 3) Fetch lead
  const lead = await Lead.findOne({
    _id: leadId,
    stage: "LQ",
    assignedTo: req.user.id,
  }).select(
    "stage lqStatus emails phones phonesNormalized responseSource assignedTo assignedToRole assignedAt lqUpdatedAt lqUpdatedBy",
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
  // 5) Validate / collect selected Emails
  // ---------------------------------------------
  const existingEmails = Array.isArray(lead.emails) ? lead.emails : [];
  const existingEmailMap = new Map();

  for (const e of existingEmails) {
    const normalized = String((e && e.normalized) || "")
      .trim()
      .toLowerCase();

    if (normalized) {
      existingEmailMap.set(normalized, e);
    }
  }

  const selectedEmailPicks = [];

  for (const email of selectedEmails) {
    const matchedEmail = existingEmailMap.get(email);

    if (!matchedEmail) {
      return next(
        httpError(
          statusCodes.BAD_REQUEST,
          "Selected email not found in this lead",
        ),
      );
    }

    selectedEmailPicks.push(matchedEmail);
  }

  // ---------------------------------------------
  // 6) Validate / collect selected Phones
  // ---------------------------------------------
  const existingPhones = Array.isArray(lead.phones) ? lead.phones : [];
  const existingPhonesNorm = Array.isArray(lead.phonesNormalized)
    ? lead.phonesNormalized
    : [];

  const phonePairs = [];

  for (let i = 0; i < existingPhones.length; i++) {
    phonePairs.push({
      value: String(existingPhones[i] || "").trim(),
      normalized: String(existingPhonesNorm[i] || "").trim(),
    });
  }

  const selectedPhonePicks = [];

  for (const raw of selectedPhones) {
    const pNorm = normalize.normalizePhone(raw);

    if (!pNorm) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid phone in selectedPhones"),
      );
    }

    const matchedPhone = phonePairs.find(
      (p) => p.value === raw || p.normalized === String(pNorm).trim(),
    );

    if (!matchedPhone) {
      return next(
        httpError(
          statusCodes.BAD_REQUEST,
          "Selected phone not found in this lead",
        ),
      );
    }

    selectedPhonePicks.push(matchedPhone);
  }

  // ---------------------------------------------
  // 7) Final validation
  // ---------------------------------------------
  if (!selectedEmailPicks.length && !selectedPhonePicks.length) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Selected contacts do not match any existing emails/phones on this lead",
      ),
    );
  }

  // ---------------------------------------------
  // 8) Build responseSource with ALL selected picks
  // ---------------------------------------------
  const pkt = getPktDateTime();

  const responseSource = {
    emails: selectedEmailPicks.map((emailObj) => ({
      value: String(emailObj.value || ""),
      normalized: String(emailObj.normalized || "")
        .trim()
        .toLowerCase(),
      selectedBy: req.user.id,
      selectedAt: pkt.now,
      selectedDate: pkt.pktDate,
      selectedTime: pkt.pktTime,
    })),
    phones: selectedPhonePicks.map((phoneObj) => ({
      value: String(phoneObj.value || "").trim(),
      normalized: String(phoneObj.normalized || "").trim(),
      selectedBy: req.user.id,
      selectedAt: pkt.now,
      selectedDate: pkt.pktDate,
      selectedTime: pkt.pktTime,
    })),
  };

  // ---------------------------------------------
  // 9) DO NOT overwrite original lead contacts
  // Only store selected picks in responseSource
  // ---------------------------------------------
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
    message:
      "Lead submitted to your assigned manager with selected response contacts",
    leadId: String(lead._id),
    assignedTo: String(manager._id),
    assignedToRole: "Manager",
    selectedEmailsCount: responseSource.emails.length,
    selectedPhonesCount: responseSource.phones.length,
    responseSource: lead.responseSource,
  });
});

// ---------------------------------------------
// GET /api/lq/stats
// PERFORMANCE-BASED STATS
// ---------------------------------------------
const getMyStats = asyncHandler(async function (req, res, next) {
  const today = String(req.query.today || "")
    .trim()
    .toLowerCase();
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
        stage: "LQ", // Ensure they are still in the LQ stage
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
  getMyLeads,
  updateLqStatus,
  addComment,
  submitToMyManager,
  getMyStats,
};
