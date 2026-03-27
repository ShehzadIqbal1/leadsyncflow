// controllers/verifierController.js
const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const Counter = require("../models/Counter");
const statusCodes = require("../utils/statusCodes");
const User = require("../models/User");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");
//const assignmentService = require("../utils/assignmentService");

function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

// 1) GET /api/verifier/leads
// Logic: Strictly get only leads in "DM" stage
const getDmLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  // Validation
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  // Run both queries in parallel for better performance
  const [leads, totalLeads] = await Promise.all([
    Lead.find({ stage: "DM" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("emails submittedDate stage"),
    Lead.countDocuments({ stage: "DM" })
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    totalLeads, // Now the frontend knows the "Grand Total"
    limit,
    skip,
    leads,
  });
});
// 2) POST /api/verifier/leads/:leadId/update-emails
// Logic: Processes emails AND handles phone-only leads to move stage to "Verifier"
const updateEmailStatuses = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  // We only fetch leads that ARE in DM stage and HAVE emails
  const lead = await Lead.findById(leadId).select("stage emails");
  if (!lead) return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));

  if (lead.stage !== "DM") {
    return next(httpError(statusCodes.BAD_REQUEST, "Lead is not in DM stage"));
  }

  // Since you fixed the submit logic, a DM lead should always have emails.
  // This is now a safety check.
  const hasEmails = Array.isArray(lead.emails) && lead.emails.length > 0;
  if (!hasEmails) {
    return next(httpError(statusCodes.BAD_REQUEST, "This lead has no emails to verify. It should already be in Verifier stage."));
  }

  const incomingArr = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
  if (!incomingArr.length) {
    return next(httpError(statusCodes.BAD_REQUEST, "Email data is required"));
  }

  const incomingMap = new Map();
  for (const row of incomingArr) {
    const norm = String(row.normalized || "").trim().toLowerCase();
    const status = String(row.status || "").trim().toUpperCase();
    if (norm && isValidEmailStatus(status)) {
      incomingMap.set(norm, status);
    }
  }

  const now = new Date();
  let updatedCount = 0;
  let missingCount = 0;

  for (const e of lead.emails) {
    const norm = String(e.normalized || "").trim().toLowerCase();
    const nextStatus = incomingMap.get(norm);

    if (!nextStatus) {
      missingCount++;
      continue;
    }

    e.status = nextStatus;
    e.verifiedBy = req.user.id;
    e.verifiedAt = now;
    updatedCount++;
  }

  // Ensure ALL emails are processed before moving stage
  if (missingCount > 0) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: "All emails must be updated to move lead to Verifier",
      missingCount,
    });
  }

  lead.stage = "Verifier";
  await lead.save();

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Lead successfully verified and moved to Verifier stage.",
    updatedCount,
    stage: lead.stage,
  });
});

// 3) POST /api/verifier/leads/move-all-to-lq
// Logic: Move ALL leads in Verifier stage to LQ stage using optimized bulk operations
const moveAllVerifierLeadsToLQ = asyncHandler(async function (req, res, next) {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      // 1. Get all approved Lead Qualifiers inside the transaction
      const lqs = await User.find({
        role: "Lead Qualifiers",
        status: "APPROVED",
      })
        .select("_id")
        .sort({ _id: 1 })
        .session(session);

      if (lqs.length === 0) {
        throw httpError(statusCodes.BAD_REQUEST, "No LQs available");
      }

      // 2. Get all leads currently in Verifier stage inside the transaction
      const leads = await Lead.find({ stage: "Verifier" })
        .select("_id")
        .sort({ _id: 1 })
        .session(session);

      if (leads.length === 0) {
        await session.abortTransaction();
        session.endSession();

        return res.status(statusCodes.OK).json({
          success: true,
          message: "No leads were moved. They may have already been moved by another user.",
          count: 0,
        });
      }

      // 3. Increment the round-robin counter ONLY inside the same transaction
      const counter = await Counter.findOneAndUpdate(
        { key: "LQ_ASSIGN" },
        { $inc: { seq: leads.length } },
        {
          new: true,
          upsert: true,
          session,
          setDefaultsOnInsert: true,
        },
      );

      const startSeq = counter.seq - leads.length;
      const now = new Date();

      // 4. Build assignments deterministically
      const bulkOps = leads.map((lead, index) => {
        const lqIndex = (startSeq + index) % lqs.length;
        const assignedLqId = lqs[lqIndex]._id;

        return {
          updateOne: {
            filter: {
              _id: lead._id,
              stage: "Verifier",
            },
            update: {
              $set: {
                stage: "LQ",
                assignedTo: assignedLqId,
                assignedToRole: "Lead Qualifiers",
                assignedAt: now,
                verifiedCompletedAt: now,
              },
            },
          },
        };
      });

      // 5. Execute bulk write inside the same transaction
      const result = await Lead.bulkWrite(bulkOps, { session });

      const movedCount =
        typeof result.modifiedCount === "number"
          ? result.modifiedCount
          : typeof result.nModified === "number"
            ? result.nModified
            : 0;

      // 6. If anything changed unexpectedly, abort so Counter does not drift
      if (movedCount !== leads.length) {
        throw httpError(
          statusCodes.CONFLICT,
          "Lead movement conflicted with another request. Please try again.",
        );
      }

      // 7. Commit only when everything matches
      await session.commitTransaction();
      session.endSession();

      return res.status(statusCodes.OK).json({
        success: true,
        message: `${movedCount} leads successfully distributed.`,
        count: movedCount,
      });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        // ignore abort error
      }
      session.endSession();

      const isRetryable =
        error &&
        (
          error.code === 112 || // WriteConflict
          error.codeName === "WriteConflict" ||
          (typeof error.hasErrorLabel === "function" &&
            (
              error.hasErrorLabel("TransientTransactionError") ||
              error.hasErrorLabel("UnknownTransactionCommitResult")
            ))
        );

      if (isRetryable && attempt < MAX_RETRIES) {
        continue;
      }

      return next(error);
    }
  }

  return next(
    httpError(
      statusCodes.CONFLICT,
      "Unable to move leads at this time. Please try again.",
    ),
  );
});
module.exports = {
  getDmLeads,
  updateEmailStatuses,
  moveAllVerifierLeadsToLQ,
};
