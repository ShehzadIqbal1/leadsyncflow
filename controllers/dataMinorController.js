// controllers/dataMinorController.js
let Lead = require("../models/Lead");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let normalize = require("../utils/normalize");
let leadValidator = require("../validators/leadValidator");

// ---------------------------------------------
// PKT helpers
// ---------------------------------------------
function getPktNow() {
  let now = new Date();
  let pktDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }); // YYYY-MM-DD
  let pktTime = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Karachi",
    hour12: false,
  }); // HH:mm:ss
  return { now: now, pktDate: pktDate, pktTime: pktTime };
}

// Build PKT day start/end in UTC-safe way using string date
function pktDayRangeUtc(pktDateStr) {
  // pktDateStr is like "2026-01-21"
  // Create PKT start/end strings and let JS parse as UTC by adding Z AFTER converting to PKT is messy.
  // Simpler: use Intl to get pkt components, then compute UTC by offset is non-trivial.
  // Minimal practical approach: use server Date but with PKT date string boundaries as "local" in PKT:
  let start = new Date(pktDateStr + "T00:00:00.000+05:00");
  let end = new Date(pktDateStr + "T23:59:59.999+05:00");
  return { start: start, end: end };
}

function pktMonthRangeUtc(pktDateStr) {
  // pktDateStr "YYYY-MM-DD"
  let y = parseInt(pktDateStr.slice(0, 4), 10);
  let m = parseInt(pktDateStr.slice(5, 7), 10); // 1-12

  let monthStartStr = y + "-" + String(m).padStart(2, "0") + "-01";
  let start = new Date(monthStartStr + "T00:00:00.000+05:00");

  // next month start
  let ny = y;
  let nm = m + 1;
  if (nm === 13) {
    nm = 1;
    ny = y + 1;
  }
  let nextMonthStartStr =
    ny + "-" + String(nm).padStart(2, "0") + "-01";
  let end = new Date(nextMonthStartStr + "T00:00:00.000+05:00"); // exclusive
  return { start: start, end: end };
}

// ---------------------------------------------
// Duplicate finder (FULL EMAIL + PHONE ONLY)
// ---------------------------------------------
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

// ---------------------------------------------
// Build Email subdocuments safely (NO localPart)
// ---------------------------------------------
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

// ---------------------------------------------
// GET /api/dm/duplicates/check?email=... OR ?phone=...
// ---------------------------------------------
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

// ---------------------------------------------
// GET /api/dm/stats  (PKT-correct)
// ---------------------------------------------
let getMyStats = asyncHandler(async function (req, res, next) {
  let userId = req.user.id;

  let pkt = getPktNow();

  let day = pktDayRangeUtc(pkt.pktDate);
  let month = pktMonthRangeUtc(pkt.pktDate);

  let todayCount = await Lead.countDocuments({
    createdBy: userId,
    createdAt: { $gte: day.start, $lte: day.end },
  });

  let monthCount = await Lead.countDocuments({
    createdBy: userId,
    createdAt: { $gte: month.start, $lt: month.end },
  });

  return res.status(statusCodes.OK).json({
    success: true,
    todayCount: todayCount,
    monthCount: monthCount,
  });
});

// ---------------------------------------------
// POST /api/dm/leads
// ---------------------------------------------
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

  // Build email subdocuments
  let emailObjects = buildEmailObjects(data.emails);

  // SAFETY: at least one email OR phone must survive normalization
  if (
    !emailObjects.length &&
    (!data.phonesNormalized || !data.phonesNormalized.length)
  ) {
    return next(
      httpError(
        statusCodes.BAD_REQUEST,
        "No valid email or phone number provided"
      )
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
  let pkt = getPktNow();

  // ONLY ONE SOURCE LINK (store first only)
  let sources = Array.isArray(data.sources) ? data.sources : [];
  let firstSource = sources.length ? [sources[0]] : [];

 let lead = await Lead.create({
  name: data.name,
  location: data.location || "",
  emails: emailObjects,
  phones: data.phones,
  phonesNormalized: data.phonesNormalized,
  sources: firstSource,

  //stage logic:
  stage: emailObjects.length > 0 ? "DM" : "Verifier",

  status: "UNPAID",
  submittedDate: pkt.pktDate,
  submittedTime: pkt.pktTime,
  createdBy: req.user.id,
});


  return res.status(statusCodes.CREATED).json({
    success: true,
    message: "Lead submitted successfully",
    leadId: lead._id,
    submittedDate: pkt.pktDate,
    submittedTime: pkt.pktTime,
  });
});

module.exports = {
  liveDuplicateCheck: liveDuplicateCheck,
  getMyStats: getMyStats,
  submitLead: submitLead,
};
