// controllers/managerController.js

const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const MetaLead = require("../models/MetaLead");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

const { getPktDateTime, buildPktRange } = require("../utils/pktDate");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function normalizeSource(source) {
  return String(source || "")
    .trim()
    .toUpperCase();
}

function getMoveSource(req) {
  return normalizeSource(
    (req.body && req.body.source) ||
      (req.query && req.query.source) ||
      "",
  );
}

function getDateValue(item) {
  return new Date(
    item.assignedAt || item.updatedAt || item.createdAt || 0,
  ).getTime();
}

function sortManagerItems(a, b) {
  const aPriority = a.superAdminReturnPriorityUntil ? 1 : 0;
  const bPriority = b.superAdminReturnPriorityUntil ? 1 : 0;

  if (aPriority !== bPriority) {
    return bPriority - aPriority;
  }

  return getDateValue(b) - getDateValue(a);
}

function mapNormalLeadForManager(lead) {
  return {
    ...lead,
    source: "LEAD",
    isMetaLead: false,
  };
}

function mapMetaLeadForManager(lead) {
  return {
    ...lead,
    source: "META_LEAD",
    isMetaLead: true,

    // Helpful aliases so frontend can render both models in same table/card
    name: lead.fullName,
    location: "",
    lqStatus: "",
    responseSource: undefined,
  };
}

// --------------------------------------------------
// GET /api/manager/leads?limit=20&skip=0
//
// Returns:
// 1. Old Lead model leads assigned to this Manager
// 2. Admin-created MetaLeads assigned to this Manager
//
// MetaLead visibility rule:
// Manager can see every MetaLead assigned to them,
// even after it becomes PAID, ADMIN_REVIEW, or WRITER.
// --------------------------------------------------
const getMyAssignedLeads = asyncHandler(async function (req, res, next) {
  const managerId = req.user.id;

  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  const fetchSize = skip + limit;

  const normalLeadFilter = {
    assignedTo: managerId,
    $or: [
      {
        stage: "MANAGER",
      },
      {
        status: "PAID",
        stage: { $in: ["MANAGER", "ADMIN_REVIEW", "WRITER"] },
      },
    ],
  };

  const metaLeadFilter = {
    assignedTo: managerId,
    stage: { $in: ["MANAGER", "ADMIN_REVIEW", "WRITER"] },
  };

  const normalLeadProjection = {
    emails: 0,
    phones: 0,
    phonesNormalized: 0,
  };

  const [
    normalLeads,
    metaLeads,
    normalLeadCount,
    metaLeadCount,
  ] = await Promise.all([
    Lead.find(normalLeadFilter, normalLeadProjection)
      .sort({
        superAdminReturnPriorityUntil: -1,
        assignedAt: -1,
        createdAt: -1,
      })
      .limit(fetchSize)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("comments.createdBy", "name email role")
      .populate("responseSource.emails.selectedBy", "name email role")
      .populate("responseSource.phones.selectedBy", "name email role")
      .lean(),

    MetaLead.find(metaLeadFilter)
      .sort({
        assignedAt: -1,
        createdAt: -1,
      })
      .limit(fetchSize)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("comments.createdBy", "name email role")
      .populate("adminProcessedBy", "name email role")
      .populate("writerDoneBy", "name email role")
      .lean(),

    Lead.countDocuments(normalLeadFilter),

    MetaLead.countDocuments(metaLeadFilter),
  ]);

  const combinedLeads = [
    ...normalLeads.map(mapNormalLeadForManager),
    ...metaLeads.map(mapMetaLeadForManager),
  ].sort(sortManagerItems);

  const paginatedLeads = combinedLeads.slice(skip, skip + limit);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads: normalLeadCount + metaLeadCount,
    count: paginatedLeads.length,
    counts: {
      normalLeads: normalLeadCount,
      metaLeads: metaLeadCount,
    },
    limit,
    skip,
    leads: paginatedLeads,
  });
});

// --------------------------------------------------
// REQUEST REJECTION
//
// This keeps old Lead model behavior only.
// MetaLead rejection is not added here because MetaLead schema
// currently does not include rejectionRequested fields.
// --------------------------------------------------
const requestRejection = asyncHandler(async function (req, res, next) {
  const leadId = req.params.id;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  const comment = String((req.body && req.body.comment) || "").trim();

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  const lead = await Lead.findOne({
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

// --------------------------------------------------
// UPSALE + PAYMENT
//
// Works for both:
// 1. Lead model
// 2. MetaLead model
//
// Frontend should send source when possible:
//
// {
//   "source": "META_LEAD",
//   "amount": 500,
//   "comment": "Paid by client"
// }
//
// Or:
//
// {
//   "source": "LEAD",
//   "amount": 500,
//   "comment": "Paid by client"
// }
//
// If source is not sent, API tries old Lead model first,
// then MetaLead model.
// --------------------------------------------------
const updatePaymentStatus = asyncHandler(async function (req, res, next) {
  const leadId = req.params.id;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  const amount = Number(req.body.amount);
  const comment = String(req.body.comment || "").trim();
  const requestedSource = getMoveSource(req);

  if (!amount || amount <= 0) {
    return next(httpError(statusCodes.BAD_REQUEST, "Valid amount required"));
  }

  if (!comment) {
    return next(httpError(statusCodes.BAD_REQUEST, "Comment is required"));
  }

  if (
    requestedSource &&
    requestedSource !== "LEAD" &&
    requestedSource !== "META_LEAD"
  ) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Invalid source. Use LEAD or META_LEAD",
      ),
    );
  }

  let lead = null;
  let source = "";

  if (requestedSource === "LEAD") {
    lead = await Lead.findOne({
      _id: leadId,
      assignedTo: req.user.id,
      stage: "MANAGER",
    });

    source = "LEAD";
  }

  if (requestedSource === "META_LEAD") {
    lead = await MetaLead.findOne({
      _id: leadId,
      assignedTo: req.user.id,
      stage: "MANAGER",
    });

    source = "META_LEAD";
  }

  if (!requestedSource) {
    lead = await Lead.findOne({
      _id: leadId,
      assignedTo: req.user.id,
      stage: "MANAGER",
    });

    if (lead) {
      source = "LEAD";
    }

    if (!lead) {
      lead = await MetaLead.findOne({
        _id: leadId,
        assignedTo: req.user.id,
        stage: "MANAGER",
      });

      if (lead) {
        source = "META_LEAD";
      }
    }
  }

  if (!lead) {
    return next(
      httpError(
        statusCodes.NOT_FOUND,
        "Lead not found, not assigned to you, or not in MANAGER stage",
      ),
    );
  }

  const { now, pktDate, pktTime } = getPktDateTime();

  if (!Array.isArray(lead.upsales)) {
    lead.upsales = [];
  }

  lead.upsales.push({
    amount,
    comment,
    addedBy: req.user.id,
    addedAt: now,
    addedDate: pktDate,
    addedTime: pktTime,
  });

  lead.status = "PAID";

  // For MetaLeads:
  // After Manager marks paid, it goes back to Admin review.
  // assignedTo remains manager ID, so manager still sees it.
  if (source === "META_LEAD") {
    lead.stage = "ADMIN_REVIEW";
    lead.writerVisible = false;
  }

  const totalUpsellAmount = lead.upsales.reduce(
    (sum, u) => sum + (u.amount || 0),
    0,
  );

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message:
      source === "META_LEAD"
        ? "MetaLead payment recorded and returned to Admin review"
        : "Payment recorded successfully",
    source,
    leadId: String(lead._id),
    stage: lead.stage,
    status: lead.status,
    totalUpsellAmount,
    upsellEntries: lead.upsales.length,
  });
});

// --------------------------------------------------
// GET /api/manager/rejections-approved
//
// Existing old Lead model behavior preserved.
// --------------------------------------------------
const getApprovedRejections = asyncHandler(async function (req, res) {
  const leads = await Lead.find({
    assignedTo: req.user.id,
    stage: "REJECTED",
  })
    .sort({ updatedAt: -1 })
    .populate("createdBy", "name email role");

  return res.status(statusCodes.OK).json({
    success: true,
    count: leads.length,
    leads,
  });
});

// --------------------------------------------------
// GET /api/manager/stats
//
// Includes revenue and unpaid count from:
// 1. Lead model
// 2. MetaLead model
//
// Rejection stats remain from old Lead model only.
// --------------------------------------------------
const getManagerStats = asyncHandler(async function (req, res, next) {
  const managerId = new mongoose.Types.ObjectId(req.user.id);

  const today = String(req.query.today || "")
    .trim()
    .toLowerCase();

  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  let range;

  try {
    range = buildPktRange({ today, from, to });
  } catch (err) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Invalid date format (use YYYY-MM-DD)",
      ),
    );
  }

  const revenueMatch = Object.assign(
    {
      assignedTo: managerId,
      "upsales.addedBy": managerId,
    },
    range ? { "upsales.addedAt": range } : {},
  );

  const normalRevenuePipeline = [
    {
      $match: {
        assignedTo: managerId,
        upsales: { $exists: true, $ne: [] },
      },
    },
    { $unwind: "$upsales" },
    { $match: revenueMatch },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $ifNull: ["$upsales.amount", 0] } },
      },
    },
  ];

  const metaRevenuePipeline = [
    {
      $match: {
        assignedTo: managerId,
        upsales: { $exists: true, $ne: [] },
      },
    },
    { $unwind: "$upsales" },
    { $match: revenueMatch },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $ifNull: ["$upsales.amount", 0] } },
      },
    },
  ];

  const normalUnpaidQuery = Object.assign(
    {
      assignedTo: managerId,
      stage: "MANAGER",
      status: "UNPAID",
    },
    range ? { assignedAt: range } : {},
  );

  const metaUnpaidQuery = Object.assign(
    {
      assignedTo: managerId,
      stage: "MANAGER",
      status: "UNPAID",
    },
    range ? { assignedAt: range } : {},
  );

  const rejectionPendingQuery = Object.assign(
    {
      assignedTo: managerId,
      stage: "MANAGER",
      rejectionRequested: true,
    },
    range ? { rejectionRequestedAt: range } : {},
  );

  const approvedRejectedQuery = Object.assign(
    {
      assignedTo: managerId,
      stage: "REJECTED",
    },
    range ? { updatedAt: range } : {},
  );

  const [
    normalRevenueRows,
    metaRevenueRows,
    normalUnpaidLeads,
    metaUnpaidLeads,
    rejectionRequestsPending,
    approvedRejections,
  ] = await Promise.all([
    Lead.aggregate(normalRevenuePipeline),
    MetaLead.aggregate(metaRevenuePipeline),
    Lead.countDocuments(normalUnpaidQuery),
    MetaLead.countDocuments(metaUnpaidQuery),
    Lead.countDocuments(rejectionPendingQuery),
    Lead.countDocuments(approvedRejectedQuery),
  ]);

  const normalRevenue = normalRevenueRows[0]?.totalRevenue || 0;
  const metaRevenue = metaRevenueRows[0]?.totalRevenue || 0;

  const totalRevenue = normalRevenue + metaRevenue;
  const unpaidLeads = normalUnpaidLeads + metaUnpaidLeads;

  return res.status(statusCodes.OK).json({
    success: true,
    filters: {
      today: today === "true" || today === "1",
      from: from || null,
      to: to || null,
    },
    stats: {
      totalRevenue,
      unpaidLeads,
      rejectionRequestsPending,
      approvedRejections,
      breakdown: {
        normalLeadRevenue: normalRevenue,
        metaLeadRevenue: metaRevenue,
        normalUnpaidLeads,
        metaUnpaidLeads,
      },
    },
  });
});

module.exports = {
  getMyAssignedLeads,
  requestRejection,
  updatePaymentStatus,
  getApprovedRejections,
  getManagerStats,
};