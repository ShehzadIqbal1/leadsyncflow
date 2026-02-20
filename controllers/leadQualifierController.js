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
let getMyLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  // ----------------------------
  // 1) Status filter
  // ----------------------------
  let lqStatus = String(req.query.lqStatus || "").trim().toUpperCase();
  let allowed = ["PENDING", "REACHED", "DEAD", "QUALIFIED", "ALL", ""];
  if (allowed.indexOf(lqStatus) === -1) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid lqStatus filter"));
  }

  // ----------------------------
  // 2) Date filters (PKT)
  // today=true OR from/to (YYYY-MM-DD)
  // ----------------------------
  let today = String(req.query.today || "").trim().toLowerCase();
  let from = String(req.query.from || "").trim();
  let to = String(req.query.to || "").trim();

  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function pktStart(dateStr) {
    return new Date(dateStr + "T00:00:00.000+05:00");
  }

  function pktEnd(dateStr) {
    return new Date(dateStr + "T23:59:59.999+05:00");
  }

  let createdAtFilter = null;

  if (today === "true" || today === "1") {
    let now = new Date();
    let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    createdAtFilter = { $gte: pktStart(pktDate), $lte: pktEnd(pktDate) };
  } else {
    if (from && !isYmd(from)) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid from date (use YYYY-MM-DD)")
      );
    }
    if (to && !isYmd(to)) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid to date (use YYYY-MM-DD)")
      );
    }

    if (from || to) {
      createdAtFilter = {};
      if (from) createdAtFilter.$gte = pktStart(from);
      if (to) createdAtFilter.$lte = pktEnd(to);
    }
  }

  // ----------------------------
  // 3) Build base query (for counts + list)
  // ----------------------------
  let baseQuery = {
    stage: "LQ",
    assignedTo: req.user.id,
  };

  if (createdAtFilter) {
    baseQuery.createdAt = createdAtFilter;
  }

  // Query for list (includes status filter)
  let listQuery = Object.assign({}, baseQuery);
  if (lqStatus && lqStatus !== "ALL") {
    listQuery.lqStatus = lqStatus;
  }

  // ----------------------------
  // 4) Fetch list + total + counts_by_status (optimized)
  // ----------------------------
  let projection =
    "name location emails phones sources stage status lqStatus comments submittedDate submittedTime assignedAt createdAt";

  let current_page = Math.floor(skip / limit) + 1;

  let [leads, total_records, countsAgg] = await Promise.all([
    Lead.find(listQuery)
      .sort({ assignedAt: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(projection)
      .lean(),
    Lead.countDocuments(listQuery),
    Lead.aggregate([
      { $match: baseQuery }, // IMPORTANT: counts respect date filter, but not the lqStatus tab filter
      {
        $group: {
          _id: "$lqStatus",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Build counts_by_status with all keys always present
  let counts_by_status = {
    ALL: 0,
    PENDING: 0,
    REACHED: 0,
    DEAD: 0,
    QUALIFIED: 0,
  };

  for (let i = 0; i < countsAgg.length; i++) {
    let k = String(countsAgg[i]._id || "").toUpperCase();
    let c = countsAgg[i].count || 0;
    if (counts_by_status[k] !== undefined) {
      counts_by_status[k] = c;
      counts_by_status.ALL += c;
    }
  }

  return res.status(statusCodes.OK).json({
    success: true,
    metadata: {
      total_records: total_records,
      current_page: current_page,
      per_page: limit,
      skip: skip,
      applied_filters: {
        lqStatus: lqStatus || "ALL",
        today: today === "true" || today === "1",
        from: from || null,
        to: to || null,
      },
      counts_by_status: counts_by_status,
    },
    leads: leads,
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

// ---------------------------------------------
// GET /api/lq/stats
// query:
//   today=true|1 OR from=YYYY-MM-DD&to=YYYY-MM-DD
// returns:
//   totalLeadsInLQ, qualifiedInLQ, reachedInLQ, deadInLQ,
//   qualifiedOverall (LQ + MANAGER processed by me),
//   submittedToManager (MANAGER stage processed by me)
// ---------------------------------------------
let getMyStats = asyncHandler(async function (req, res, next) {
  // ----------------------------
  // Date filters (PKT)
  // ----------------------------
  let today = String(req.query.today || "").trim().toLowerCase();
  let from = String(req.query.from || "").trim();
  let to = String(req.query.to || "").trim();

  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function pktStart(dateStr) {
    return new Date(dateStr + "T00:00:00.000+05:00");
  }

  function pktEnd(dateStr) {
    return new Date(dateStr + "T23:59:59.999+05:00");
  }

  let range = null;

  if (today === "true" || today === "1") {
    let now = new Date();
    let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    range = { $gte: pktStart(pktDate), $lte: pktEnd(pktDate) };
  } else {
    if (from && !isYmd(from)) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid from date (use YYYY-MM-DD)")
      );
    }
    if (to && !isYmd(to)) {
      return next(
        httpError(statusCodes.BAD_REQUEST, "Invalid to date (use YYYY-MM-DD)")
      );
    }

    if (from || to) {
      range = {};
      if (from) range.$gte = pktStart(from);
      if (to) range.$lte = pktEnd(to);
    }
  }

  // ----------------------------
  // Aggregation:
  // - LQ stage stats use createdAt filter (same behavior as leads listing)
  // - "overall qualified" + "submittedToManager" use lqUpdatedAt filter
  //   (because submit updates lqUpdatedAt in your submitToMyManager)
  // ----------------------------
  let pipeline = [
    {
      $facet: {
        // 1) "My current LQ bucket" (what's still with me)
        lqBucket: [
          {
            $match: Object.assign(
              {
                stage: "LQ",
                assignedTo: mongoose.Types.ObjectId(req.user.id),
              },
              range ? { createdAt: range } : {}
            ),
          },
          {
            $group: {
              _id: null,
              totalLeadsInLQ: { $sum: 1 },
              qualifiedInLQ: {
                $sum: { $cond: [{ $eq: ["$lqStatus", "QUALIFIED"] }, 1, 0] },
              },
              reachedInLQ: {
                $sum: { $cond: [{ $eq: ["$lqStatus", "REACHED"] }, 1, 0] },
              },
              deadInLQ: {
                $sum: { $cond: [{ $eq: ["$lqStatus", "DEAD"] }, 1, 0] },
              },
              pendingInLQ: {
                $sum: { $cond: [{ $eq: ["$lqStatus", "PENDING"] }, 1, 0] },
              },
            },
          },
          { $project: { _id: 0 } },
        ],

        // 2) "What I processed overall" (includes leads I already submitted)
        processedOverall: [
          {
            $match: Object.assign(
              {
                lqUpdatedBy: mongoose.Types.ObjectId(req.user.id),
              },
              range ? { lqUpdatedAt: range } : {}
            ),
          },
          {
            $group: {
              _id: null,
              // qualified overall across ANY stage (LQ + MANAGER etc.)
              qualifiedOverall: {
                $sum: { $cond: [{ $eq: ["$lqStatus", "QUALIFIED"] }, 1, 0] },
              },
              // how many have been submitted to manager by me
              submittedToManager: {
                $sum: { $cond: [{ $eq: ["$stage", "MANAGER"] }, 1, 0] },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
      },
    },
  ];

  let out = await Lead.aggregate(pipeline);

  let lq = (out[0] && out[0].lqBucket && out[0].lqBucket[0]) || {
    totalLeadsInLQ: 0,
    qualifiedInLQ: 0,
    reachedInLQ: 0,
    deadInLQ: 0,
    pendingInLQ: 0,
  };

  let overall =
    (out[0] && out[0].processedOverall && out[0].processedOverall[0]) || {
      qualifiedOverall: 0,
      submittedToManager: 0,
    };

  return res.status(statusCodes.OK).json({
    success: true,
    filters: {
      today: today === "true" || today === "1" ? true : false,
      from: from || null,
      to: to || null,
    },
    stats: Object.assign({}, lq, overall),
  });
});

module.exports = {
  getMyLeads: getMyLeads,
  updateLqStatus: updateLqStatus,
  addComment: addComment,
  submitToMyManager: submitToMyManager,
  getMyStats: getMyStats
};
