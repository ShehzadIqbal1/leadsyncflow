let mongoose = require("mongoose");
let User = require("../models/User");
let Lead = require("../models/Lead");
let constants = require("../utils/constants");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");

// --- Helpers ---
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}
// Helper: parse date range (YYYY-MM-DD)
function buildDateMatch(from, to) {
  let match = {};
  if (from) match.$gte = new Date(from + "T00:00:00.000Z");
  if (to) match.$lte = new Date(to + "T23:59:59.999Z");
  return Object.keys(match).length ? match : null;
}

function isInList(value, list) {
  if (!Array.isArray(list)) return false;
  return list.indexOf(value) !== -1;
}

// --------------------------------------------
// DASHBOARD & ANALYTICS
// --------------------------------------------

// GET /api/superadmin/overview
let getOverview = asyncHandler(async function (req, res, next) {
  let from = String(req.query.from || "").trim();
  let to = String(req.query.to || "").trim();

  let createdAtMatch = buildDateMatch(from, to);
  let baseMatch = {};
  if (createdAtMatch) baseMatch.createdAt = createdAtMatch;

  let totalsAgg = await Lead.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        dmCount: { $sum: { $cond: [{ $eq: ["$stage", "DM"] }, 1, 0] } },
        lqCount: { $sum: { $cond: [{ $eq: ["$stage", "LQ"] }, 1, 0] } },
        managerCount: {
          $sum: { $cond: [{ $eq: ["$stage", "MANAGER"] }, 1, 0] },
        },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, 1, 0] },
        },
        paidCount: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
        qualifiedCount: {
          $sum: { $cond: [{ $eq: ["$lqStatus", "QUALIFIED"] }, 1, 0] },
        },
      },
    },
    { $project: { _id: 0 } },
  ]);

  let totals = totalsAgg[0] || {
    totalLeads: 0,
    dmCount: 0,
    lqCount: 0,
    managerCount: 0,
    unpaidCount: 0,
    paidCount: 0,
    qualifiedCount: 0,
  };

  function pct(a, b) {
    if (!b) return 0;
    return Math.round((a / b) * 10000) / 100;
  }

  let conversions = {
    dm_to_lq: pct(totals.lqCount + totals.managerCount, totals.totalLeads),
    lq_to_manager: pct(
      totals.managerCount,
      totals.lqCount + totals.managerCount
    ),
    manager_paid: pct(totals.paidCount, totals.managerCount),
  };

  // Leaderboards
  let dmLeaderboard = await Lead.aggregate([
    { $match: baseMatch },
    { $group: { _id: "$createdBy", leadsCreated: { $sum: 1 } } },
    { $sort: { leadsCreated: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: "$u" },
    {
      $project: {
        _id: 0,
        userId: "$u._id",
        name: "$u.name",
        email: "$u.email",
        role: "$u.role",
        leadsCreated: 1,
      },
    },
  ]);

  let lqLeaderboard = await Lead.aggregate([
    {
      $match: Object.assign({}, baseMatch, {
        lqUpdatedBy: { $exists: true, $ne: null },
      }),
    },
    { $group: { _id: "$lqUpdatedBy", leadsUpdated: { $sum: 1 } } },
    { $sort: { leadsUpdated: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: "$u" },
    {
      $project: {
        _id: 0,
        userId: "$u._id",
        name: "$u.name",
        email: "$u.email",
        role: "$u.role",
        leadsUpdated: 1,
      },
    },
  ]);

  let managerLeaderboard = await Lead.aggregate([
    {
      $match: Object.assign({}, baseMatch, {
        stage: "MANAGER",
        assignedTo: { $exists: true, $ne: null },
      }),
    },
    {
      $group: {
        _id: "$assignedTo",
        leadsInManager: { $sum: 1 },
        paidCount: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, 1, 0] },
        },
      },
    },
    { $sort: { paidCount: -1, leadsInManager: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: "$u" },
    {
      $project: {
        _id: 0,
        userId: "$u._id",
        name: "$u.name",
        email: "$u.email",
        role: "$u.role",
        leadsInManager: 1,
        paidCount: 1,
        unpaidCount: 1,
      },
    },
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    range: { from: from || null, to: to || null },
    totals,
    conversions,
    leaderboards: {
      dataMinors: dmLeaderboard,
      leadQualifiers: lqLeaderboard,
      managers: managerLeaderboard,
    },
  });
});

// GET /api/superadmin/leads
let getAllLeads = asyncHandler(async function (req, res, next) {
  let limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  let skip = Math.max(parseInt(req.query.skip || "0", 10), 0);

  let filter = {};
  if (req.query.stage) filter.stage = req.query.stage.trim();
  if (req.query.status) filter.status = req.query.status.trim();
  if (req.query.lqStatus) filter.lqStatus = req.query.lqStatus.trim();
  if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo.trim();

  let leads = await Lead.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("createdBy", "name email role")
    .populate("assignedTo", "name email role")
    .populate("lqUpdatedBy", "name email role");

  let total = await Lead.countDocuments(filter);

  return res
    .status(statusCodes.OK)
    .json({ success: true, total, limit, skip, leads });
});

// GET /api/superadmin/performance
let getPerformance = asyncHandler(async function (req, res, next) {
  let role = String(req.query.role || "").trim();
  if (!role)
    return next(httpError(statusCodes.BAD_REQUEST, "role query is required"));

  let users = await User.find({ role: role }).select(
    "_id name email role status"
  );
  let userIds = users.map((u) => u._id);
  let perf = [];

  if (role === "Data Minors") {
    perf = await Lead.aggregate([
      { $match: { createdBy: { $in: userIds } } },
      { $group: { _id: "$createdBy", processed: { $sum: 1 } } },
    ]);
  } else if (role === "Lead Qualifiers") {
    perf = await Lead.aggregate([
      { $match: { lqUpdatedBy: { $in: userIds } } },
      {
        $group: {
          _id: "$lqUpdatedBy",
          processed: { $sum: 1 },
          qualified: {
            $sum: { $cond: [{ $eq: ["$lqStatus", "QUALIFIED"] }, 1, 0] },
          },
          dead: { $sum: { $cond: [{ $eq: ["$lqStatus", "DEAD"] }, 1, 0] } },
          inConversation: {
            $sum: { $cond: [{ $eq: ["$lqStatus", "IN_CONVERSATION"] }, 1, 0] },
          },
        },
      },
    ]);
  } else if (role === "Manager") {
    perf = await Lead.aggregate([
      { $match: { assignedTo: { $in: userIds }, stage: "MANAGER" } },
      {
        $group: {
          _id: "$assignedTo",
          processed: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
          unpaid: { $sum: { $cond: [{ $eq: ["$status", "UNPAID"] }, 1, 0] } },
        },
      },
    ]);
  } else {
    return next(httpError(statusCodes.BAD_REQUEST, "Unsupported role"));
  }

  let map = {};
  perf.forEach((p) => (map[String(p._id)] = p));

  let rows = users.map((u) => ({
    userId: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    metrics: map[String(u._id)] || { processed: 0 },
  }));

  rows.sort((a, b) => (b.metrics.processed || 0) - (a.metrics.processed || 0));
  return res.status(statusCodes.OK).json({ success: true, role, rows });
});

// --------------------------------------------
// USER MANAGEMENT (APPROVALS)
// --------------------------------------------

let getPendingRequests = asyncHandler(async function (req, res, next) {
  let items = await User.find({ status: constants.userStatus.PENDING })
    .select("name email department sex createdAt")
    .sort({ createdAt: -1 });
  res.status(statusCodes.OK).json({ success: true, requests: items });
});

let approveRequest = asyncHandler(async function (req, res, next) {
  let userId = req.params.id;
  let role = req.body && req.body.role ? String(req.body.role).trim() : "";

  if (!role || !isInList(role, constants.roles))
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid or missing role"));

  let user = await User.findOneAndUpdate(
    { _id: userId, status: constants.userStatus.PENDING },
    {
      status: constants.userStatus.APPROVED,
      role: role,
      approvedBy: req.user.id,
      approvedAt: new Date(),
    },
    { new: true }
  );

  if (!user)
    return next(httpError(statusCodes.NOT_FOUND, "Pending request not found"));

  res
    .status(statusCodes.OK)
    .json({ success: true, message: "User approved", userId, role });
});

let rejectRequest = asyncHandler(async function (req, res, next) {
  let user = await User.findOneAndDelete({
    _id: req.params.id,
    status: constants.userStatus.PENDING,
  });
  if (!user)
    return next(httpError(statusCodes.NOT_FOUND, "Pending request not found"));
  res
    .status(statusCodes.OK)
    .json({ success: true, message: "User rejected and deleted" });
});

// ==================================================
// 1️⃣ GET managers WITH assigned Lead Qualifiers
// ==================================================
// GET /api/superadmin/managers/with-lqs
let getManagersWithLQs = asyncHandler(async function (req, res) {
  let managers = await User.aggregate([
    {
      $match: {
        role: "Manager",
        status: constants.userStatus.APPROVED
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "reportsTo",
        as: "assignedLQs"
      }
    },
    {
      $match: {
        "assignedLQs.0": { $exists: true }
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        department: 1,
        assignedLQs: {
          _id: 1,
          name: 1,
          email: 1,
          department: 1
        }
      }
    },
    { $sort: { name: 1 } }
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    managers
  });
});

// ==================================================
// 2️⃣ GET managers WITHOUT assigned Lead Qualifiers
// ==================================================
// GET /api/superadmin/managers/without-lqs
let getManagersWithoutLQs = asyncHandler(async function (req, res) {
  let managers = await User.aggregate([
    {
      $match: {
        role: "Manager",
        status: constants.userStatus.APPROVED
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "reportsTo",
        as: "assignedLQs"
      }
    },
    {
      $match: {
        $or: [
          { assignedLQs: { $size: 0 } },
          { assignedLQs: { $exists: false } }
        ]
      }
    },
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        department: 1
      }
    },
    { $sort: { name: 1 } }
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    managers
  });
});

// ==================================================
// 3️⃣ GET Lead Qualifiers NOT assigned to any manager
// ==================================================
// GET /api/superadmin/lead-qualifiers/unassigned
let getUnassignedLeadQualifiers = asyncHandler(async function (req, res) {
  let lqs = await User.find({
    role: "Lead Qualifiers",
    status: constants.userStatus.APPROVED,
    $or: [
      { reportsTo: null },
      { reportsTo: { $exists: false } }
    ]
  })
    .select("_id name email department role")
    .sort({ name: 1 });

  return res.status(statusCodes.OK).json({
    success: true,
    leadQualifiers: lqs.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      department: u.department,
      role: u.role
    }))
  });
});

// ==================================================
// 4️⃣ ASSIGN Lead Qualifiers → Manager (bulk)
// ==================================================
// PATCH /api/superadmin/managers/:managerId/assign-lqs
// body: { lqIds: [] }
let assignLqsToManager = asyncHandler(async function (req, res, next) {
  let managerId = req.params.managerId;

  if (!isValidObjectId(managerId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));
  }

  let lqIds = Array.isArray(req.body?.lqIds) ? req.body.lqIds : [];
  lqIds = lqIds.map(String).filter(Boolean);

  if (!lqIds.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "lqIds array is required"));
  }

  let manager = await User.findOne({
    _id: managerId,
    role: "Manager",
    status: constants.userStatus.APPROVED
  }).select("_id");

  if (!manager) {
    return next(httpError(statusCodes.BAD_REQUEST, "Manager not found"));
  }

  let result = await User.updateMany(
    {
      _id: { $in: lqIds },
      role: "Lead Qualifiers",
      status: constants.userStatus.APPROVED
    },
    { $set: { reportsTo: manager._id } }
  );

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead Qualifiers assigned to manager",
    managerId,
    assignedCount: result.modifiedCount || 0
  });
});

// ==================================================
// UNASSIGN Lead Qualifiers from managers
// ==================================================
// PATCH /api/superadmin/lead-qualifiers/unassign
// body: { lqIds: [] }
let unassignLqs = asyncHandler(async function (req, res, next) {
  let lqIds = Array.isArray(req.body?.lqIds) ? req.body.lqIds : [];
  lqIds = lqIds.map(String).filter(Boolean);

  if (!lqIds.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "lqIds array is required"));
  }

  let result = await User.updateMany(
    {
      _id: { $in: lqIds },
      role: "Lead Qualifiers",
      status: constants.userStatus.APPROVED
    },
    { $unset: { reportsTo: "" } }
  );

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead Qualifiers unassigned",
    unassignedCount: result.modifiedCount || 0
  });
});

// ----------------------------------
module.exports = {
  getManagersWithLQs,
  getManagersWithoutLQs,
  getUnassignedLeadQualifiers,
  assignLqsToManager,
  unassignLqs
};


// --- Final Export ---
module.exports = {
  getOverview,
  getAllLeads,
  getPerformance,
  getPendingRequests,
  approveRequest,
  rejectRequest,
 getManagersWithLQs,
 getManagersWithoutLQs,
 getUnassignedLeadQualifiers,
 assignLqsToManager,
 unassignLqs
};
