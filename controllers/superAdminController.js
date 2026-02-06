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

// --------------------------------------------------
// Super Admin specific endpoints for managing Lead Qualifiers and their manager assignments
// GET /api/superadmin/managers
// --------------------------------------------------
let getManagers = asyncHandler(async function (req, res, next) {
  let managers = await User.find({
    role: "Manager",
    status: constants.userStatus.APPROVED
  })
    .select("_id name email department role")
    .sort({ name: 1 });

  return res.status(statusCodes.OK).json({
    success: true,
    managers: managers.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.email,
      department: m.department,
      role: m.role
    }))
  });
});

// --------------------------------------------------
// GET /api/superadmin/lead-qualifiers?managerId=...
// --------------------------------------------------
let getLeadQualifiers = asyncHandler(async function (req, res, next) {
  let managerId = String(req.query.managerId || "").trim();

  let query = {
    role: "Lead Qualifiers",
    status: constants.userStatus.APPROVED
  };

  if (managerId) {
    if (!isValidObjectId(managerId)) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));
    }
    query.reportsTo = managerId;
  }

  let lqs = await User.find(query)
    .select("_id name email department role reportsTo")
    .populate("reportsTo", "name email role")
    .sort({ name: 1 });

  return res.status(statusCodes.OK).json({
    success: true,
    leadQualifiers: lqs.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      department: u.department,
      role: u.role,
      reportsTo: u.reportsTo
        ? { id: u.reportsTo._id, name: u.reportsTo.name, email: u.reportsTo.email }
        : null
    }))
  });
});

// --------------------------------------------------
// PATCH /api/superadmin/managers/:managerId/assign-lqs
// body: { lqIds: [] }
// Assign MANY LQs to ONE manager (bulk)
// --------------------------------------------------
let assignLqsToManager = asyncHandler(async function (req, res, next) {
  let managerId = req.params.managerId;

  if (!isValidObjectId(managerId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid managerId"));
  }

  let lqIds = Array.isArray(req.body && req.body.lqIds) ? req.body.lqIds : [];
  lqIds = lqIds.map((x) => String(x || "").trim()).filter(Boolean);

  if (!lqIds.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "lqIds array is required"));
  }

  // verify manager
  let manager = await User.findOne({
    _id: managerId,
    role: "Manager",
    status: constants.userStatus.APPROVED
  }).select("_id");

  if (!manager) {
    return next(httpError(statusCodes.BAD_REQUEST, "Manager not found / not approved"));
  }

  // verify LQs exist
  let validLqs = await User.find({
    _id: { $in: lqIds },
    role: "Lead Qualifiers",
    status: constants.userStatus.APPROVED
  }).select("_id");

  if (!validLqs.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "No valid Lead Qualifiers found"));
  }

  let validIds = validLqs.map((u) => u._id);

  let result = await User.updateMany(
    { _id: { $in: validIds } },
    { $set: { reportsTo: manager._id } }
  );

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead Qualifiers assigned to manager",
    managerId: String(manager._id),
    assignedCount: result.modifiedCount || result.nModified || 0
  });
});

// --------------------------------------------------
// PATCH /api/superadmin/lead-qualifiers/unassign
// body: { lqIds: [] }
// Remove manager mapping from LQs
// --------------------------------------------------
let unassignLqs = asyncHandler(async function (req, res, next) {
  let lqIds = Array.isArray(req.body && req.body.lqIds) ? req.body.lqIds : [];
  lqIds = lqIds.map((x) => String(x || "").trim()).filter(Boolean);

  if (!lqIds.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "lqIds array is required"));
  }

  let result = await User.updateMany(
    {
      _id: { $in: lqIds },
      role: "Lead Qualifiers",
      status: constants.userStatus.APPROVED
    },
    { $set: { reportsTo: null } }
  );

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead Qualifiers unassigned from manager",
    unassignedCount: result.modifiedCount || result.nModified || 0
  });
});

// --- Final Export ---
module.exports = {
  getOverview,
  getAllLeads,
  getPerformance,
  getPendingRequests,
  approveRequest,
  rejectRequest,
  getManagers,
  getLeadQualifiers,
  assignLqsToManager,
  unassignLqs
};
