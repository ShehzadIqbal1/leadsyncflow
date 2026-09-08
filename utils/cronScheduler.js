const cron = require("node-cron");
const Lead = require("../models/Lead");
const MetaLead = require("../models/MetaLead");
const User = require("../models/User");
const { createAndPushNotifications } = require("./notificationService");

function buildDueNormalWriterLeadFilter(now, next48Hours, twoHoursAgo) {
  return {
    stage: "WRITER",
    status: "PAID",
    leadType: "NORMAL",
    writerVisible: true,
    writerStatus: { $ne: "DONE" },
    adminAssignedDate: {
      $ne: null,
      $gte: now,
      $lte: next48Hours,
    },
    $or: [
      { lastNotificationSentAt: null },
      { lastNotificationSentAt: { $exists: false } },
      { lastNotificationSentAt: { $lte: twoHoursAgo } },
    ],
  };
}

/**
 * Runs every 2 hours.
 *
 * Notification target:
 * - Admin
 * - Super Admin
 * - Writer
 *
 * Notification condition:
 * - Lead is in WRITER stage
 * - Lead is PAID
 * - Lead type is NORMAL
 * - Writer can see it
 * - Writer has not marked it DONE
 * - Admin assigned date is within the next 48 hours
 */
function startMetaLeadWriterNotificationCron() {
  cron.schedule("0 */2 * * *", async function () {
    try {
      const now = new Date();
      const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const filter = buildDueNormalWriterLeadFilter(
        now,
        next48Hours,
        twoHoursAgo,
      );

      const [normalLeads, metaLeads] = await Promise.all([
        Lead.find(filter)
          .select("_id name adminAssignedDate leadType writerStatus")
          .sort({ adminAssignedDate: 1 }),

        MetaLead.find(filter)
          .select("_id fullName program school adminAssignedDate leadType writerStatus")
          .sort({ adminAssignedDate: 1 }),
      ]);

      const totalDueLeads = normalLeads.length + metaLeads.length;

      if (totalDueLeads === 0) {
        return;
      }

      const usersToNotify = await User.find({
        role: { $in: ["Admin", "Super Admin", "Writer"] },
        status: "APPROVED",
      }).select("_id name email role");

      if (!usersToNotify.length) {
        return;
      }

      const normalLeadIds = normalLeads.map((lead) => String(lead._id));
      const metaLeadIds = metaLeads.map((lead) => String(lead._id));

      await createAndPushNotifications(usersToNotify, {
        title: "Normal Lead Due Soon",
        body: `${totalDueLeads} normal writer lead(s) are due within the next 48 hours.`,
        type: "NORMAL_WRITER_LEAD_DUE_48H",
        metadata: {
          totalDueLeads,
          normalLeadCount: normalLeads.length,
          metaLeadCount: metaLeads.length,
          normalLeadIds,
          metaLeadIds,
          dueWindowStartsAt: now,
          dueWindowEndsAt: next48Hours,
        },
      });

      await Promise.all([
        Lead.updateMany(
          { _id: { $in: normalLeads.map((lead) => lead._id) } },
          {
            $set: {
              lastNotificationSentAt: now,
            },
          },
        ),

        MetaLead.updateMany(
          { _id: { $in: metaLeads.map((lead) => lead._id) } },
          {
            $set: {
              lastNotificationSentAt: now,
            },
          },
        ),
      ]);

      console.log("Normal writer lead due notification sent:", {
        totalDueLeads,
        normalLeadCount: normalLeads.length,
        metaLeadCount: metaLeads.length,
      });
    } catch (error) {
      console.error("Normal writer lead notification cron failed:", error);
    }
  });
}

module.exports = {
  startMetaLeadWriterNotificationCron,
};