// controllers/dataMinorController.js
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize");
let leadValidator = require("../validators/leadValidator");

// --------------------------------------------------
// Duplicate finder (FULL EMAIL + PHONE ONLY)
// --------------------------------------------------
async function findDuplicates(emailNorms, phoneNorms) {
  let tasks = [];

  tasks.push(
    emailNorms && emailNorms.length
      ? Lead.distinct("emails.normalized", {
          "emails.normalized": { $in: emailNorms },
        })
      : Promise.resolve([])
  );

  tasks.push(
    phoneNorms && phoneNorms.length
      ? Lead.distinct("phonesNormalized", {
          phonesNormalized: { $in: phoneNorms },
        })
      : Promise.resolve([])
  );

  let results = await Promise.all(tasks);

  return {
    duplicateEmails: results[0] || [],
    duplicatePhones: results[1] || [],
  };
}

// --------------------------------------------------
// Build Email subdocuments safely (NO localPart)
// --------------------------------------------------
function buildEmailObjects(rawEmails) {
  let arr = Array.isArray(rawEmails) ? rawEmails : [];
  let out = [];

  for (let i = 0; i < arr.length; i++) {
    let raw = String(arr[i] || "").trim();
    if (!raw) continue;

    let eNorm = normalize.normalizeEmail(raw);
    if (!normalize.isValidEmail(eNorm)) continue;

    out.push({
      value: raw,
      normalized: eNorm,
      status: "PENDING",
    });
  }

  return out;
}

// --------------------------------------------------
// GET /api/dm/duplicates/check?email=... OR ?phone=...
// --------------------------------------------------
let liveDuplicateCheck = asyncHandler(async function (req, res, next) {
  let email = String(req.query.email || "").trim();
  let phone = String(req.query.phone || "").trim();

  if (!email && !phone) {
    return next(httpError(statusCodes.BAD_REQUEST, "Provide email or phone"));
  }

  let out = {
    success: true,
    email: { exists: false, match: "" },
    phone: { exists: false, match: "" },
  };

  if (email) {
    let eNorm = normalize.normalizeEmail(email);
    if (!normalize.isValidEmail(eNorm)) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid email"));
    }

    let dupFull = await Lead.distinct("emails.normalized", {
      "emails.normalized": { $in: [eNorm] },
    });

    if (dupFull && dupFull.length) {
      out.email.exists = true;
      out.email.match = eNorm;
    }
  }

  if (phone) {
    let pNorm = normalize.normalizePhone(phone);
    if (!pNorm) {
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid phone"));
    }

    let dupPhone = await Lead.distinct("phonesNormalized", {
      phonesNormalized: { $in: [pNorm] },
    });

    if (dupPhone && dupPhone.length) {
      out.phone.exists = true;
      out.phone.match = pNorm;
    }
  }

  return res.status(statusCodes.OK).json(out);
});

// --------------------------------------------------
// GET /api/dm/stats
// --------------------------------------------------
let getMyStats = asyncHandler(async function (req, res, next) {
  let userId = req.user.id;

  let now = new Date();
  let todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let todayCount = await Lead.countDocuments({
    createdBy: userId,
    createdAt: { $gte: todayStart },
  });

  let monthCount = await Lead.countDocuments({
    createdBy: userId,
    createdAt: { $gte: monthStart },
  });

  return res.status(statusCodes.OK).json({
    success: true,
    todayCount: todayCount,
    monthCount: monthCount,
  });
});

// --------------------------------------------------
// POST /api/dm/leads
// --------------------------------------------------
let submitLead = asyncHandler(async function (req, res, next) {
  let validation = leadValidator.validateDataMinorLead(req.body);
  if (!validation.ok) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: validation.message,
      fields: validation.fields || {},
    });
  }

  let data = validation.data;

  // Build email subdocuments (NO localPart)
  let emailObjects = buildEmailObjects(data.emails);

  // SAFETY: at least one email OR phone must survive normalization
  if (!emailObjects.length && (!data.phonesNormalized || !data.phonesNormalized.length)) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "No valid email or phone number provided")
    );
  }

  // Extract normalized emails for duplicate check
  let emailsNorm = [];
  for (let i = 0; i < emailObjects.length; i++) {
    emailsNorm.push(emailObjects[i].normalized);
  }

  // Duplicate check (FULL EMAIL + PHONE ONLY)
  let dups = await findDuplicates(emailsNorm, data.phonesNormalized);

  let hasDup =
    (dups.duplicateEmails && dups.duplicateEmails.length) ||
    (dups.duplicatePhones && dups.duplicatePhones.length);

  if (hasDup) {
    return res.status(statusCodes.CONFLICT).json({
      success: false,
      message: "Duplicate fields found",
      duplicates: dups,
    });
  }

  // 🇵🇰 Pakistan Standard Time
  let now = new Date();
  let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }); // YYYY-MM-DD
  let pktTime = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour12: false,
  }); // HH:mm:ss

  let lead = await Lead.create({
    name: data.name,
    location: data.location || "",
    emails: emailObjects,
    phones: data.phones,
    phonesNormalized: data.phonesNormalized,
    sources: data.sources,
    stage: "DM",
    status: "UNPAID",
    submittedDate: pktDate,
    submittedTime: pktTime,
    createdBy: req.user.id,
  });

  return res.status(statusCodes.CREATED).json({
    success: true,
    message: "Lead submitted successfully",
    leadId: lead._id,
    submittedDate: pktDate,
    submittedTime: pktTime,
  });
});

module.exports = {
  liveDuplicateCheck: liveDuplicateCheck,
  getMyStats: getMyStats,
  submitLead: submitLead,
};
