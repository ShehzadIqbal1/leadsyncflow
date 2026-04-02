const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const Counter = require("../models/Counter");
const statusCodes = require("../utils/statusCodes");
const User = require("../models/User");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

const MAX_VERIFIER_BATCH_SIZE = 120;
const MIN_MOVE_TO_LQ = 100;
const MAX_MOVE_TO_LQ = 1000;
const MAX_RETRIES = 3;

function isValidEmailStatus(s) {
  return ["ACTIVE", "BOUNCED", "DEAD"].indexOf(s) !== -1;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function buildBatchId(userId) {
  return `VB-${String(userId)}-${Date.now()}-${new mongoose.Types.ObjectId()}`;
}

function getUnclaimedDmEmailLeadsFilter() {
  return {
    stage: "DM",
    "emails.0": { $exists: true }, // only leads having at least 1 email
    $or: [{ v_claimedBy: { $exists: false } }, { v_claimedBy: null }],
  };
}

async function fetchClaimedDmLeadsForVerifier(userId, limit, skip) {
  const filter = {
    stage: "DM",
    v_claimedBy: userId,
    "emails.0": { $exists: true }, // only email leads for verifier UI
  };

  const [leads, totalLeads] = await Promise.all([
    Lead.find(filter)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit)
      .select("_id emails"),
    Lead.countDocuments(filter),
  ]);

  return { leads, totalLeads };
}

// 1) GET /api/verifier/leads
// Returns only claimed DM leads having emails.
// Does not return phone-only leads.
const getDmLeads = asyncHandler(async function (req, res, next) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > MAX_VERIFIER_BATCH_SIZE) limit = MAX_VERIFIER_BATCH_SIZE;
  if (isNaN(skip) || skip < 0) skip = 0;

  const verifierId = req.user.id;

  // existing claimed DM email leads only
  const existingClaimCount = await Lead.countDocuments({
    stage: "DM",
    v_claimedBy: verifierId,
    "emails.0": { $exists: true },
  });

  if (existingClaimCount > 0) {
    const { leads, totalLeads } = await fetchClaimedDmLeadsForVerifier(
      verifierId,
      limit,
      skip,
    );

    return res.status(statusCodes.OK).json({
      success: true,
      message: "Existing claimed batch returned.",
      batchClaimed: false,
      totalLeads,
      limit,
      skip,
      leads,
    });
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const stillHasClaimedDm = await Lead.countDocuments({
        stage: "DM",
        v_claimedBy: verifierId,
        "emails.0": { $exists: true },
      }).session(session);

      if (stillHasClaimedDm > 0) {
        await session.commitTransaction();
        session.endSession();

        const { leads, totalLeads } = await fetchClaimedDmLeadsForVerifier(
          verifierId,
          limit,
          skip,
        );

        return res.status(statusCodes.OK).json({
          success: true,
          message: "Existing claimed batch returned.",
          batchClaimed: false,
          totalLeads,
          limit,
          skip,
          leads,
        });
      }

      const approvedVerifierCount = await User.countDocuments({
        role: "Verifier",
        status: "APPROVED",
      }).session(session);

      const verifierCount = Math.max(1, approvedVerifierCount);

      // only unclaimed DM leads with emails are claimable for verifier UI
      const totalUnclaimedDmLeads = await Lead.countDocuments(
        getUnclaimedDmEmailLeadsFilter(),
      ).session(session);

      if (totalUnclaimedDmLeads === 0) {
        await session.commitTransaction();
        session.endSession();

        return res.status(statusCodes.OK).json({
          success: true,
          message: "No DM email leads available to claim.",
          batchClaimed: false,
          totalLeads: 0,
          limit,
          skip,
          leads: [],
        });
      }

      const currentBatchSize = Math.min(
        MAX_VERIFIER_BATCH_SIZE,
        Math.max(1, Math.ceil(totalUnclaimedDmLeads / verifierCount)),
      );

      const counter = await Counter.findOneAndUpdate(
        { key: "VERIFIER_BATCH_SEQ" },
        { $inc: { seq: currentBatchSize } },
        {
          new: true,
          upsert: true,
          session,
          setDefaultsOnInsert: true,
        },
      );

      const startSeq = counter.seq - currentBatchSize;

      let leadsToClaim = await Lead.find(getUnclaimedDmEmailLeadsFilter())
        .sort({ _id: 1 })
        .skip(startSeq)
        .limit(currentBatchSize)
        .select("_id")
        .session(session);

      if (leadsToClaim.length === 0 && totalUnclaimedDmLeads > 0) {
        await Counter.findOneAndUpdate(
          { key: "VERIFIER_BATCH_SEQ" },
          { $set: { seq: 0 } },
          {
            new: true,
            upsert: true,
            session,
            setDefaultsOnInsert: true,
          },
        );

        leadsToClaim = await Lead.find(getUnclaimedDmEmailLeadsFilter())
          .sort({ _id: 1 })
          .skip(0)
          .limit(currentBatchSize)
          .select("_id")
          .session(session);
      }

      if (leadsToClaim.length === 0) {
        await session.commitTransaction();
        session.endSession();

        return res.status(statusCodes.OK).json({
          success: true,
          message: "No DM email leads available to claim.",
          batchClaimed: false,
          totalLeads: 0,
          limit,
          skip,
          leads: [],
        });
      }

      const now = new Date();
      const batchId = buildBatchId(verifierId);

      const bulkOps = leadsToClaim.map((lead) => ({
        updateOne: {
          filter: {
            _id: lead._id,
            stage: "DM",
            "emails.0": { $exists: true },
            $or: [{ v_claimedBy: { $exists: false } }, { v_claimedBy: null }],
          },
          update: {
            $set: {
              v_claimedBy: verifierId,
              v_claimedAt: now,
              v_batchId: batchId,
            },
          },
        },
      }));

      const result = await Lead.bulkWrite(bulkOps, { session });

      const claimedCount =
        typeof result.modifiedCount === "number"
          ? result.modifiedCount
          : typeof result.nModified === "number"
            ? result.nModified
            : 0;

      if (claimedCount !== leadsToClaim.length) {
        throw httpError(
          statusCodes.CONFLICT,
          "Lead claim conflicted with another request. Please try again.",
        );
      }

      await session.commitTransaction();
      session.endSession();

      const { leads, totalLeads } = await fetchClaimedDmLeadsForVerifier(
        verifierId,
        limit,
        skip,
      );

      return res.status(statusCodes.OK).json({
        success: true,
        message: "New DM batch claimed successfully.",
        batchClaimed: true,
        batchId,
        totalLeads,
        limit,
        skip,
        leads,
      });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        // ignore
      }
      session.endSession();

      const isRetryable =
        error &&
        (error.code === 112 ||
          error.codeName === "WriteConflict" ||
          (typeof error.hasErrorLabel === "function" &&
            (error.hasErrorLabel("TransientTransactionError") ||
              error.hasErrorLabel("UnknownTransactionCommitResult"))));

      if (isRetryable && attempt < MAX_RETRIES) {
        continue;
      }

      return next(error);
    }
  }

  return next(
    httpError(
      statusCodes.CONFLICT,
      "Unable to claim DM leads at this time. Please try again.",
    ),
  );
});

// 2) POST /api/verifier/leads/:leadId/update-emails
const updateEmailStatuses = asyncHandler(async function (req, res, next) {
  const leadId = req.params.leadId;

  if (!isValidObjectId(leadId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid leadId"));
  }

  const lead = await Lead.findById(leadId).select(
    "stage emails v_claimedBy v_batchId",
  );

  if (!lead) {
    return next(httpError(statusCodes.NOT_FOUND, "Lead not found"));
  }

  if (lead.stage !== "DM") {
    return next(httpError(statusCodes.BAD_REQUEST, "Lead is not in DM stage"));
  }

  if (!lead.v_claimedBy || String(lead.v_claimedBy) !== String(req.user.id)) {
    return next(
      httpError(
        statusCodes.FORBIDDEN,
        "You can only verify leads claimed in your own batch.",
      ),
    );
  }

  const hasEmails = Array.isArray(lead.emails) && lead.emails.length > 0;
  if (!hasEmails) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "This lead has no emails to verify."),
    );
  }

  const incomingArr = Array.isArray(req.body && req.body.emails)
    ? req.body.emails
    : [];

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

  if (missingCount > 0) {
    return res.status(statusCodes.BAD_REQUEST).json({
      success: false,
      message: "All emails must be updated to move lead to Verifier stage.",
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
    batchId: lead.v_batchId || "",
  });
});

// 3) POST /api/verifier/leads/move-all-to-lq
// Move only THIS verifier's verified leads to LQ
// Enforce 100..1000 movement limit
const moveAllVerifierLeadsToLQ = asyncHandler(async function (req, res, next) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const verifierId = req.user.id;

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

      // 1) Existing logic: only this verifier's verified email leads
      const verifiedEmailLeads = await Lead.find({
        stage: "Verifier",
        v_claimedBy: verifierId,
      })
        .select("_id")
        .sort({ _id: 1 })
        .session(session);

      // 2) New logic: ALL phone-only DM leads, no ownership check
      const phoneOnlyDmLeads = await Lead.find({
        stage: "DM",
        $or: [
          { emails: { $exists: false } },
          { "emails.0": { $exists: false } },
        ],
      })
        .select("_id")
        .sort({ _id: 1 })
        .session(session);

      const leads = [...verifiedEmailLeads, ...phoneOnlyDmLeads];

      if (leads.length === 0) {
        await session.commitTransaction();
        session.endSession();

        return res.status(statusCodes.OK).json({
          success: true,
          message: "No leads found to move to LQ.",
          count: 0,
        });
      }

      if (leads.length < MIN_MOVE_TO_LQ || leads.length > MAX_MOVE_TO_LQ) {
        throw httpError(
          statusCodes.BAD_REQUEST,
          `Verifier can move only between ${MIN_MOVE_TO_LQ} and ${MAX_MOVE_TO_LQ} leads to LQ at a time. Current count: ${leads.length}.`,
        );
      }

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

      const bulkOps = leads.map((lead, index) => {
        const lqIndex = (startSeq + index) % lqs.length;
        const assignedLqId = lqs[lqIndex]._id;

        return {
          updateOne: {
            filter: {
              _id: lead._id,
              $or: [
                // keep existing ownership check for verified email leads
                {
                  stage: "Verifier",
                  v_claimedBy: verifierId,
                },
                // new phone-only rule: move any phone-only DM lead
                {
                  stage: "DM",
                  $or: [
                    { emails: { $exists: false } },
                    { "emails.0": { $exists: false } },
                  ],
                },
              ],
            },
            update: {
              $set: {
                stage: "LQ",
                assignedTo: assignedLqId,
                assignedToRole: "Lead Qualifiers",
                assignedAt: now,
                verifiedCompletedAt: now,
              },
              $unset: {
                v_claimedBy: "",
                v_claimedAt: "",
                v_batchId: "",
              },
            },
          },
        };
      });

      const result = await Lead.bulkWrite(bulkOps, { session });

      const movedCount =
        typeof result.modifiedCount === "number"
          ? result.modifiedCount
          : typeof result.nModified === "number"
            ? result.nModified
            : 0;

      // Silent skip behavior:
      // if some phone-only leads were already moved by another verifier,
      // they simply won't match the filter anymore. No error.
      // Only fail if nothing moved at all while we expected everything.
      if (movedCount === 0 && leads.length > 0) {
        await session.commitTransaction();
        session.endSession();

        return res.status(statusCodes.OK).json({
          success: true,
          message: "No leads were moved. They may have already been moved by another request.",
          count: 0,
        });
      }

      await session.commitTransaction();
      session.endSession();

      return res.status(statusCodes.OK).json({
        success: true,
        message: `${movedCount} leads successfully distributed to LQ.`,
        count: movedCount,
      });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        // ignore
      }
      session.endSession();

      const isRetryable =
        error &&
        (
          error.code === 112 ||
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