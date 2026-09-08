const Lead = require("../models/Lead");
const normalize = require("../utils/normalize");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

const searchLeads = asyncHandler(async function (req, res, next) {
  const q = String(req.query.q || "").trim();

  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (!q) {
    return next(httpError(statusCodes.BAD_REQUEST, "Search query is required"));
  }

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  const filters = [];

  // email search
  if (q.indexOf("@") !== -1) {
    const emailNorm = normalize.normalizeEmail(q);
    if (normalize.isValidEmail(emailNorm)) {
      filters.push({ "emails.normalized": emailNorm });
      filters.push({ "responseSource.emails.normalized": emailNorm });
    }
  }

  // phone search
  const phoneNorm = normalize.normalizePhone(q);
  if (phoneNorm) {
    filters.push({ phonesNormalized: phoneNorm });
    filters.push({ "responseSource.phones.normalized": phoneNorm });
  }

  // optional name/location fallback
  if (q.length >= 3) {
    filters.push({ name: { $regex: q, $options: "i" } });
    filters.push({ location: { $regex: q, $options: "i" } });
  }

  if (!filters.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid search query"));
  }

  const query = { $or: filters };

  const projection =
    "name location emails phones sources stage status lqStatus assignedTo assignedToRole assignedAt submittedDate submittedTime responseSource createdAt updatedAt";

  const [leads, total] = await Promise.all([
    Lead.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(projection)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("lqUpdatedBy", "name email role")
      .lean(),

    Lead.countDocuments(query),
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    metadata: {
      total_records: total,
      current_page: Math.floor(skip / limit) + 1,
      per_page: limit,
      skip: skip,
      query: q,
    },
    leads: leads,
  });
});

module.exports = {
  searchLeads,
};