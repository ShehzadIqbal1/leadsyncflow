const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const MetaLead = require("../models/MetaLead");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function parsePagination(req) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  return { limit, skip };
}

function normalizeSource(source) {
  return String(source || "")
    .trim()
    .toUpperCase();
}

function getDateValue(item) {
  return new Date(
    item.adminAssignedDate ||
      item.writerVisibleAt ||
      item.updatedAt ||
      item.createdAt ||
      0,
  ).getTime();
}

function sortWriterItems(a, b) {
  return getDateValue(a) - getDateValue(b);
}

function mapNormalLeadForWriter(lead) {
  const firstEmail =
    Array.isArray(lead.emails) && lead.emails[0]
      ? lead.emails[0].value || lead.emails[0].normalized || ""
      : "";

  const firstPhone =
    Array.isArray(lead.phones) && lead.phones[0] ? lead.phones[0] : "";

  return {
    source: "LEAD",
    isMetaLead: false,
    _id: lead._id,

    name: lead.name,
    fullName: lead.name,

    email: firstEmail,
    number: firstPhone,
    emails: lead.emails || [],
    phones: lead.phones || [],

    location: lead.location || "",
    website: "",
    program: "",
    school: "",

    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType || null,

    assignedTo: lead.assignedTo || null,
    assignedToRole: lead.assignedToRole || "",
    assignedAt: lead.assignedAt || null,

    writerVisible: lead.writerVisible || false,
    writerVisibleAt: lead.writerVisibleAt || null,
    writerStatus: lead.writerStatus || "PENDING",
    writerDoneBy: lead.writerDoneBy || null,
    writerDoneAt: lead.writerDoneAt || null,

    adminAssignedDate: lead.adminAssignedDate || null,
    adminProcessedBy: lead.adminProcessedBy || null,
    adminProcessedAt: lead.adminProcessedAt || null,

    comments: lead.comments || [],
    upsales: lead.upsales || [],

    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,

    raw: lead,
  };
}

function mapMetaLeadForWriter(lead) {
  return {
    source: "META_LEAD",
    isMetaLead: true,
    _id: lead._id,

    name: lead.fullName,
    fullName: lead.fullName,

    email: lead.email || "",
    number: lead.number || "",
    emails: lead.email ? [{ value: lead.email, normalized: lead.email }] : [],
    phones: lead.number ? [lead.number] : [],

    location: "",
    website: lead.website || "",
    program: lead.program || "",
    school: lead.school || "",

    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType || null,

    assignedTo: lead.assignedTo || null,
    assignedToRole: lead.assignedToRole || "",
    assignedAt: lead.assignedAt || null,

    writerVisible: lead.writerVisible || false,
    writerVisibleAt: lead.writerVisibleAt || null,
    writerStatus: lead.writerStatus || "PENDING",
    writerDoneBy: lead.writerDoneBy || null,
    writerDoneAt: lead.writerDoneAt || null,

    adminAssignedDate: lead.adminAssignedDate || null,
    adminProcessedBy: lead.adminProcessedBy || null,
    adminProcessedAt: lead.adminProcessedAt || null,

    comments: lead.comments || [],
    upsales: lead.upsales || [],

    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,

    raw: lead,
  };
}

async function getWriterLeadsByType(leadType, req, res) {
  const { limit, skip } = parsePagination(req);
  const fetchSize = skip + limit;

  const filter = {
    stage: "WRITER",
    status: "PAID",
    leadType,
    writerVisible: true,
    writerStatus: { $ne: "DONE" },
  };

  const [normalLeads, metaLeads, normalLeadCount, metaLeadCount] =
    await Promise.all([
      Lead.find(filter)
        .sort({
          adminAssignedDate: 1,
          writerVisibleAt: -1,
          createdAt: -1,
        })
        .limit(fetchSize)
        .populate("createdBy", "name email role")
        .populate("assignedTo", "name email role")
        .populate("adminProcessedBy", "name email role")
        .populate("writerDoneBy", "name email role")
        .lean(),

      MetaLead.find(filter)
        .sort({
          adminAssignedDate: 1,
          writerVisibleAt: -1,
          createdAt: -1,
        })
        .limit(fetchSize)
        .populate("createdBy", "name email role")
        .populate("assignedTo", "name email role")
        .populate("adminProcessedBy", "name email role")
        .populate("writerDoneBy", "name email role")
        .lean(),

      Lead.countDocuments(filter),
      MetaLead.countDocuments(filter),
    ]);

  const combinedLeads = [
    ...normalLeads.map(mapNormalLeadForWriter),
    ...metaLeads.map(mapMetaLeadForWriter),
  ].sort(sortWriterItems);

  const paginatedLeads = combinedLeads.slice(skip, skip + limit);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads: normalLeadCount + metaLeadCount,
    count: paginatedLeads.length,
    counts: {
      normalLeadModel: normalLeadCount,
      metaLeadModel: metaLeadCount,
    },
    leadType,
    limit,
    skip,
    leads: paginatedLeads,
  });
}

// --------------------------------------------------
// GET /api/writer/leads/normal
//
// Shows all active NORMAL leads for Writer from:
// 1. Lead model
// 2. MetaLead model
// --------------------------------------------------
const getNormalLeads = asyncHandler(async function (req, res) {
  return getWriterLeadsByType("NORMAL", req, res);
});

// --------------------------------------------------
// GET /api/writer/leads/recurring
//
// Shows all active RECURRING leads for Writer from:
// 1. Lead model
// 2. MetaLead model
// --------------------------------------------------
const getRecurringLeads = asyncHandler(async function (req, res) {
  return getWriterLeadsByType("RECURRING", req, res);
});

// --------------------------------------------------
// GET /api/writer/leads
//
// Optional combined endpoint.
// Query:
// ?leadType=NORMAL
// ?leadType=RECURRING
//
// If no leadType is sent, it returns both NORMAL and RECURRING.
// --------------------------------------------------
const getAllWriterLeads = asyncHandler(async function (req, res, next) {
  const { limit, skip } = parsePagination(req);
  const fetchSize = skip + limit;

  const requestedLeadType = String(req.query.leadType || "")
    .trim()
    .toUpperCase();

  if (
    requestedLeadType &&
    requestedLeadType !== "NORMAL" &&
    requestedLeadType !== "RECURRING"
  ) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Invalid leadType. Use NORMAL or RECURRING",
      ),
    );
  }

  const filter = {
    stage: "WRITER",
    status: "PAID",
    writerVisible: true,
    writerStatus: { $ne: "DONE" },
  };

  if (requestedLeadType) {
    filter.leadType = requestedLeadType;
  } else {
    filter.leadType = { $in: ["NORMAL", "RECURRING"] };
  }

  const [normalLeads, metaLeads, normalLeadCount, metaLeadCount] =
    await Promise.all([
      Lead.find(filter)
        .sort({
          adminAssignedDate: 1,
          writerVisibleAt: -1,
          createdAt: -1,
        })
        .limit(fetchSize)
        .populate("createdBy", "name email role")
        .populate("assignedTo", "name email role")
        .populate("adminProcessedBy", "name email role")
        .populate("writerDoneBy", "name email role")
        .lean(),

      MetaLead.find(filter)
        .sort({
          adminAssignedDate: 1,
          writerVisibleAt: -1,
          createdAt: -1,
        })
        .limit(fetchSize)
        .populate("createdBy", "name email role")
        .populate("assignedTo", "name email role")
        .populate("adminProcessedBy", "name email role")
        .populate("writerDoneBy", "name email role")
        .lean(),

      Lead.countDocuments(filter),
      MetaLead.countDocuments(filter),
    ]);

  const combinedLeads = [
    ...normalLeads.map(mapNormalLeadForWriter),
    ...metaLeads.map(mapMetaLeadForWriter),
  ].sort(sortWriterItems);

  const paginatedLeads = combinedLeads.slice(skip, skip + limit);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads: normalLeadCount + metaLeadCount,
    count: paginatedLeads.length,
    counts: {
      normalLeadModel: normalLeadCount,
      metaLeadModel: metaLeadCount,
    },
    leadType: requestedLeadType || "ALL",
    limit,
    skip,
    leads: paginatedLeads,
  });
});

// --------------------------------------------------
// PATCH /api/writer/leads/:source/:leadId/status
//
// Body:
// {
//   "writerStatus": "IN_PROGRESS"
// }
//
// This is optional, but useful if frontend wants Writer
// to start work before marking DONE.
// --------------------------------------------------
const updateWriterStatus = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const source = normalizeSource(req.params.source);

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!["LEAD", "META_LEAD"].includes(source)) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Invalid source. Use LEAD or META_LEAD",
      ),
    );
  }

  const writerStatus = String(req.body && req.body.writerStatus)
    .trim()
    .toUpperCase();

  if (!["PENDING", "IN_PROGRESS"].includes(writerStatus)) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "writerStatus must be PENDING or IN_PROGRESS",
      ),
    );
  }

  const Model = source === "META_LEAD" ? MetaLead : Lead;

  const lead = await Model.findOne({
    _id: leadId,
    stage: "WRITER",
    status: "PAID",
    writerVisible: true,
    writerStatus: { $ne: "DONE" },
  });

  if (!lead) {
    return next(
      httpError(
        statusCodes.NOT_FOUND,
        "Writer lead not found or not active",
      ),
    );
  }

  lead.writerStatus = writerStatus;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Writer status updated successfully",
    source,
    leadId: String(lead._id),
    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType,
    writerVisible: lead.writerVisible,
    writerStatus: lead.writerStatus,
  });
});

// --------------------------------------------------
// PATCH /api/writer/leads/:source/:leadId/done
//
// Writer completes lead.
// Works for both Lead and MetaLead.
//
// State transition:
// WRITER + PAID
//      ↓
// ADMIN_REVIEW + PAID
//
// This makes it disappear from Writer dashboard,
// but it remains visible to Admin and Manager.
// --------------------------------------------------
const markLeadDone = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const source = normalizeSource(req.params.source);

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!["LEAD", "META_LEAD"].includes(source)) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Invalid source. Use LEAD or META_LEAD",
      ),
    );
  }

  const Model = source === "META_LEAD" ? MetaLead : Lead;

  const lead = await Model.findOne({
    _id: leadId,
    stage: "WRITER",
    status: "PAID",
    writerVisible: true,
    writerStatus: { $ne: "DONE" },
  });

  if (!lead) {
    return next(
      httpError(
        statusCodes.NOT_FOUND,
        "Writer lead not found or already marked done",
      ),
    );
  }

  const now = new Date();

  lead.writerStatus = "DONE";
  lead.writerDoneBy = req.user.id;
  lead.writerDoneAt = now;

  // Lifecycle loop:
  // Done leads return to Admin review instead of becoming terminal.
  lead.stage = "ADMIN_REVIEW";
  lead.status = "PAID";
  lead.writerVisible = false;

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message:
      "Lead marked as DONE and returned to Admin review queue for re-processing",
    source,
    leadId: String(lead._id),
    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType,
    writerVisible: lead.writerVisible,
    writerStatus: lead.writerStatus,
    writerDoneAt: lead.writerDoneAt,
  });
});

module.exports = {
  getNormalLeads,
  getRecurringLeads,
  getAllWriterLeads,
  updateWriterStatus,
  markLeadDone,
};