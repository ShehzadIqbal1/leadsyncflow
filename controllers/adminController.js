const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const MetaLead = require("../models/MetaLead");
const User = require("../models/User");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseRequiredDate(value, fieldName) {
  const date = new Date(value);

  if (!value || isNaN(date.getTime())) {
    throw httpError(
      statusCodes.BAD_REQUEST,
      `${fieldName} must be a valid date`,
    );
  }

  return date;
}

function readBodyValue(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
  }

  return "";
}

function mapNormalLead(lead) {
  const firstEmail =
    Array.isArray(lead.emails) && lead.emails[0]
      ? lead.emails[0].value || lead.emails[0].normalized || ""
      : "";

  const firstPhone =
    Array.isArray(lead.phones) && lead.phones[0] ? lead.phones[0] : "";

  return {
    source: "LEAD",
    _id: lead._id,

    name: lead.name,
    fullName: lead.name,

    email: firstEmail,
    number: firstPhone,
    website: "",
    program: "",
    school: "",
    location: lead.location || "",

    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType || null,

    assignedTo: lead.assignedTo || null,
    assignedToRole: lead.assignedToRole || "",
    assignedAt: lead.assignedAt || null,

    writerVisible: lead.writerVisible || false,
    writerStatus: lead.writerStatus || "PENDING",
    writerVisibleAt: lead.writerVisibleAt || null,
    writerDoneBy: lead.writerDoneBy || null,
    writerDoneAt: lead.writerDoneAt || null,

    adminAssignedDate: lead.adminAssignedDate || null,
    adminProcessedBy: lead.adminProcessedBy || null,
    adminProcessedAt: lead.adminProcessedAt || null,

    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,

    raw: lead,
  };
}

function mapMetaLead(lead) {
  return {
    source: "META_LEAD",
    _id: lead._id,

    name: lead.fullName,
    fullName: lead.fullName,

    email: lead.email || "",
    number: lead.number || "",
    website: lead.website || "",
    program: lead.program || "",
    school: lead.school || "",
    location: "",

    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType || null,

    assignedTo: lead.assignedTo || null,
    assignedToRole: lead.assignedToRole || "",
    assignedAt: lead.assignedAt || null,

    writerVisible: lead.writerVisible || false,
    writerStatus: lead.writerStatus || "PENDING",
    writerVisibleAt: lead.writerVisibleAt || null,
    writerDoneBy: lead.writerDoneBy || null,
    writerDoneAt: lead.writerDoneAt || null,

    adminAssignedDate: lead.adminAssignedDate || null,
    adminProcessedBy: lead.adminProcessedBy || null,
    adminProcessedAt: lead.adminProcessedAt || null,

    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,

    raw: lead,
  };
}

// --------------------------------------------------
// GET /api/admin/managers
// Manager dropdown for Admin assignment screen
// --------------------------------------------------
const getApprovedManagers = asyncHandler(async function (req, res) {
  const managers = await User.find({
    role: "Manager",
    status: "APPROVED",
  })
    .select("_id name email role department")
    .sort({ name: 1 });

  return res.status(statusCodes.OK).json({
    success: true,
    count: managers.length,
    managers,
  });
});

// --------------------------------------------------
// POST /api/admin/meta-leads
//
// Admin creates MetaLead.
// Default state:
// stage: ADMIN_REVIEW
// status: UNPAID
// assignedTo: null
//
// Manager assignment happens separately.
// --------------------------------------------------
const createMetaLead = asyncHandler(async function (req, res, next) {
  const rawDate = readBodyValue(req.body, "date", "Date");
  const program = String(readBodyValue(req.body, "program", "Program")).trim();
  const school = String(readBodyValue(req.body, "school", "School")).trim();

  const fullName = String(
    readBodyValue(req.body, "fullName", "FullName", "full_name"),
  ).trim();

  const email = normalizeEmail(readBodyValue(req.body, "email", "Email"));

  const number = String(readBodyValue(req.body, "number", "Number")).trim();
  const numberNormalized = normalizePhone(number);

  const website = String(readBodyValue(req.body, "website", "Website")).trim();

  if (!program) {
    return next(httpError(statusCodes.BAD_REQUEST, "Program is required"));
  }

  if (!school) {
    return next(httpError(statusCodes.BAD_REQUEST, "School is required"));
  }

  if (!fullName) {
    return next(httpError(statusCodes.BAD_REQUEST, "Full Name is required"));
  }

  if (!email && !numberNormalized) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "At least one email or number is required",
      ),
    );
  }

  let parsedDate;

  try {
    parsedDate = parseRequiredDate(rawDate, "Date");
  } catch (err) {
    return next(err);
  }

  const duplicateChecks = [];

  if (email) {
    duplicateChecks.push(
      MetaLead.findOne({ emailNormalized: email }).select("_id fullName email"),
    );

    duplicateChecks.push(
      Lead.findOne({ "emails.normalized": email }).select("_id name emails"),
    );
  }

  if (numberNormalized) {
    duplicateChecks.push(
      MetaLead.findOne({ numberNormalized }).select("_id fullName number"),
    );

    duplicateChecks.push(
      Lead.findOne({ phonesNormalized: numberNormalized }).select(
        "_id name phones",
      ),
    );
  }

  const duplicateResults = await Promise.all(duplicateChecks);
  const duplicate = duplicateResults.find(Boolean);

  if (duplicate) {
    return next(
      httpError(
        statusCodes.CONFLICT,
        "A lead with the same email or number already exists",
      ),
    );
  }

  try {
    const lead = await MetaLead.create({
      date: parsedDate,
      program,
      school,
      fullName,
      email,
      emailNormalized: email,
      number,
      numberNormalized,
      website,

      stage: "ADMIN_REVIEW",
      status: "UNPAID",

      assignedTo: null,
      assignedToRole: "",
      assignedAt: null,

      createdBy: req.user.id,

      leadType: null,
      writerVisible: false,
      writerStatus: "PENDING",
    });

    return res.status(statusCodes.CREATED).json({
      success: true,
      message: "Meta lead created in Admin review stage",
      lead,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return next(
        httpError(
          statusCodes.CONFLICT,
          "A meta lead with the same email or number already exists",
        ),
      );
    }

    return next(error);
  }
});

// --------------------------------------------------
// GET /api/admin/meta-leads
// Admin can see MetaLeads for assignment/review
// Optional filters:
// ?stage=ADMIN_REVIEW&status=UNPAID
// --------------------------------------------------
const getMetaLeads = asyncHandler(async function (req, res) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  const filter = {};

  if (req.query.stage) {
    filter.stage = String(req.query.stage).trim().toUpperCase();
  }

  if (req.query.status) {
    filter.status = String(req.query.status).trim().toUpperCase();
  }

  if (req.query.assignedTo && isValidObjectId(req.query.assignedTo)) {
    filter.assignedTo = req.query.assignedTo;
  }

  const [leads, totalLeads] = await Promise.all([
    MetaLead.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("adminProcessedBy", "name email role")
      .populate("writerDoneBy", "name email role"),

    MetaLead.countDocuments(filter),
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads,
    count: leads.length,
    limit,
    skip,
    leads,
  });
});

// --------------------------------------------------
// PATCH /api/admin/meta-leads/:leadId/assign-manager
//
// Body:
// {
//   "managerId": "managerUserId"
// }
//
// Only UNPAID MetaLeads are assigned to managers.
// --------------------------------------------------
const assignMetaLeadToManager = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const managerId = String(req.body && req.body.managerId).trim();

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  if (!managerId || !isValidObjectId(managerId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Valid managerId is required"));
  }

  const manager = await User.findOne({
    _id: managerId,
    role: "Manager",
    status: "APPROVED",
  }).select("_id name email role");

  if (!manager) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "Manager not found or not approved",
      ),
    );
  }

  const lead = await MetaLead.findOne({
    _id: leadId,
    status: "UNPAID",
  });

  if (!lead) {
    return next(
      httpError(
        statusCodes.NOT_FOUND,
        "Unpaid MetaLead not found or already paid",
      ),
    );
  }

  lead.assignedTo = manager._id;
  lead.assignedToRole = "Manager";
  lead.assignedAt = new Date();
  lead.stage = "MANAGER";

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "MetaLead assigned to manager successfully",
    leadId: String(lead._id),
    assignedTo: String(manager._id),
    stage: lead.stage,
  });
});

// --------------------------------------------------
// GET /api/admin/paid-leads
//
// Shows paid leads from BOTH:
// 1) Lead model
// 2) MetaLead model
//
// Admin can see paid leads in every stage:
// MANAGER, ADMIN_REVIEW, WRITER, etc.
// --------------------------------------------------
const getPaidLeads = asyncHandler(async function (req, res) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  const source = String(req.query.source || "ALL").trim().toUpperCase();

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  if (!["ALL", "LEAD", "META_LEAD"].includes(source)) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: "Invalid source. Use ALL, LEAD, or META_LEAD",
    });
  }

  const normalLeadPromise =
    source === "ALL" || source === "LEAD"
      ? Lead.find({ status: "PAID" })
          .sort({ updatedAt: -1 })
          .populate("createdBy", "name email role")
          .populate("assignedTo", "name email role")
          .populate("adminProcessedBy", "name email role")
          .populate("writerDoneBy", "name email role")
          .lean()
      : Promise.resolve([]);

  const metaLeadPromise =
    source === "ALL" || source === "META_LEAD"
      ? MetaLead.find({ status: "PAID" })
          .sort({ updatedAt: -1 })
          .populate("createdBy", "name email role")
          .populate("assignedTo", "name email role")
          .populate("adminProcessedBy", "name email role")
          .populate("writerDoneBy", "name email role")
          .lean()
      : Promise.resolve([]);

  const normalLeadCountPromise =
    source === "ALL" || source === "LEAD"
      ? Lead.countDocuments({ status: "PAID" })
      : Promise.resolve(0);

  const metaLeadCountPromise =
    source === "ALL" || source === "META_LEAD"
      ? MetaLead.countDocuments({ status: "PAID" })
      : Promise.resolve(0);

  const [normalLeads, metaLeads, normalLeadCount, metaLeadCount] =
    await Promise.all([
      normalLeadPromise,
      metaLeadPromise,
      normalLeadCountPromise,
      metaLeadCountPromise,
    ]);

  const combined = [
    ...normalLeads.map(mapNormalLead),
    ...metaLeads.map(mapMetaLead),
  ].sort(function (a, b) {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const paginated = combined.slice(skip, skip + limit);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads: normalLeadCount + metaLeadCount,
    count: paginated.length,
    source,
    counts: {
      leadModelPaid: normalLeadCount,
      metaLeadPaid: metaLeadCount,
    },
    limit,
    skip,
    leads: paginated,
  });
});

// --------------------------------------------------
// PATCH /api/admin/paid-leads/:source/:leadId/process
//
// source:
// LEAD
// META_LEAD
//
// Body for recurring:
// {
//   "leadType": "RECURRING"
// }
//
// Body for normal:
// {
//   "leadType": "NORMAL",
//   "adminAssignedDate": "2026-08-10"
// }
//
// This works for BOTH normal Lead model paid leads
// and MetaLead paid leads.
// --------------------------------------------------
const processPaidLead = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;
  const source = String(req.params.source || "").trim().toUpperCase();

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

  const leadType = String(req.body && req.body.leadType)
    .trim()
    .toUpperCase();

  if (!["NORMAL", "RECURRING"].includes(leadType)) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "leadType must be NORMAL or RECURRING"),
    );
  }

  const Model = source === "META_LEAD" ? MetaLead : Lead;

  const lead = await Model.findOne({
    _id: leadId,
    status: "PAID",
  });

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Paid lead not found"));
  }

  const now = new Date();

  lead.leadType = leadType;
  lead.stage = "WRITER";

  lead.writerVisible = true;
  lead.writerVisibleAt = now;

  lead.adminProcessedBy = req.user.id;
  lead.adminProcessedAt = now;

  // Re-processing reset
  lead.writerStatus = "PENDING";
  lead.writerDoneBy = null;
  lead.writerDoneAt = null;

  if (leadType === "NORMAL") {
    let parsedAdminAssignedDate;

    try {
      parsedAdminAssignedDate = parseRequiredDate(
        req.body && req.body.adminAssignedDate,
        "adminAssignedDate",
      );
    } catch (err) {
      return next(err);
    }

    lead.adminAssignedDate = parsedAdminAssignedDate;
  }

  if (leadType === "RECURRING") {
    lead.adminAssignedDate = null;
  }

  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message:
      leadType === "RECURRING"
        ? "Paid lead processed as recurring and moved to writer stage"
        : "Paid lead processed as normal with assigned date and moved to writer stage",
    source,
    leadId: String(lead._id),
    stage: lead.stage,
    status: lead.status,
    leadType: lead.leadType,
    writerVisible: lead.writerVisible,
    writerStatus: lead.writerStatus,
    adminAssignedDate: lead.adminAssignedDate,
  });
});

module.exports = {
  getApprovedManagers,
  createMetaLead,
  getMetaLeads,
  assignMetaLeadToManager,
  getPaidLeads,
  processPaidLead,
};