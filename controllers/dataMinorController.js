let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize");
let leadValidator = require("../validators/leadValidator");

async function findDuplicates(emailsNorm, emailLocals, phonesNorm) {
  let tasks = [];

  tasks.push(
    emailsNorm.length
      ? Lead.distinct("emailsNormalized", {
          emailsNormalized: { $in: emailsNorm },
        })
      : Promise.resolve([])
  );

  tasks.push(
    emailLocals.length
      ? Lead.distinct("emailLocalParts", {
          emailLocalParts: { $in: emailLocals },
        })
      : Promise.resolve([])
  );

  tasks.push(
    phonesNorm.length
      ? Lead.distinct("phonesNormalized", {
          phonesNormalized: { $in: phonesNorm },
        })
      : Promise.resolve([])
  );

  let results = await Promise.all(tasks);

  return {
    duplicateEmails: results[0] || [],
    duplicateEmailLocalParts: results[1] || [],
    duplicatePhones: results[2] || [],
  };
}

// GET /api/dm/duplicates/check?email=... OR ?phone=...
let liveDuplicateCheck = asyncHandler(async function (req, res, next) {
  let email = String(req.query.email || "").trim();
  let phone = String(req.query.phone || "").trim();

  if (!email && !phone) {
    return next(httpError(statusCodes.BAD_REQUEST, "Provide email or phone"));
  }

  let out = {
    success: true,
    email: { exists: false, match: "" },
    emailLocalPart: { exists: false, match: "" },
    phone: { exists: false, match: "" },
  };

  if (email) {
    let eNorm = normalize.normalizeEmail(email);
    if (!normalize.isValidEmail(eNorm))
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid email"));

    let local = normalize.emailLocalPart(eNorm);

    let dupFull = await Lead.distinct("emailsNormalized", {
      emailsNormalized: { $in: [eNorm] },
    });
    if (dupFull && dupFull.length) {
      out.email.exists = true;
      out.email.match = eNorm;
    }

    if (local) {
      let dupLocal = await Lead.distinct("emailLocalParts", {
        emailLocalParts: { $in: [local] },
      });
      if (dupLocal && dupLocal.length) {
        out.emailLocalPart.exists = true;
        out.emailLocalPart.match = local;
      }
    }
  }

  if (phone) {
    let pNorm = normalize.normalizePhone(phone);
    if (!pNorm)
      return next(httpError(statusCodes.BAD_REQUEST, "Invalid phone"));

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

// GET /api/dm/stats
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

// POST /api/dm/leads
let submitLead = asyncHandler(async function (req, res, next) {
  let validation = leadValidator.validateDataMinorLead(req.body);
  if (!validation.ok) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: validation.message,
      fields: validation.fields || {}
    });
  }

  let data = validation.data;

  // duplicate check
  let dups = await findDuplicates(
    data.emailsNormalized,
    data.emailLocalParts,
    data.phonesNormalized
  );

  let hasDup =
    dups.duplicateEmails.length ||
    dups.duplicateEmailLocalParts.length ||
    dups.duplicatePhones.length;

  if (hasDup) {
    return res.status(statusCodes.CONFLICT).json({
      success: false,
      message: "Duplicate fields found",
      duplicates: dups
    });
  }

  // 🇵🇰 Pakistan Standard Time
  let now = new Date();
  let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  let pktTime = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour12: false
  });

  let lead = await Lead.create({
    name: data.name,
    location: data.location,
    emails: data.emails,
    phones: data.phones,
    emailsNormalized: data.emailsNormalized,
    emailLocalParts: data.emailLocalParts,
    phonesNormalized: data.phonesNormalized,
    sources: data.sources,
    stage: "DM",
    status: "UNPAID",
    submittedDate: pktDate,
    submittedTime: pktTime,
    createdBy: req.user.id
  });

  return res.status(statusCodes.CREATED).json({
    success: true,
    message: "Lead submitted successfully",
    leadId: lead._id,
    submittedDate: pktDate,
    submittedTime: pktTime
  });
});


module.exports = {
  liveDuplicateCheck: liveDuplicateCheck,
  getMyStats: getMyStats,
  submitLead: submitLead,
};
