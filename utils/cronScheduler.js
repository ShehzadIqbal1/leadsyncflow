const cron = require("node-cron");
const Lead = require("../models/Lead");
const MetaLead = require("../models/MetaLead");
const User = require("../models/User");
const { sendPushNotificationToUsers } = require("./notificationService");

/**
 * Cron runs every 2 hours.
 *
 * It checks NORMAL paid leads from BOTH:
 * 1. Lead model
 * 2. MetaLead model
 *
 * Notification condition:
 * - stage: WRITER
 * - status: PAID
 * - leadType: NORMAL
 * - writerVisible: true
 * - writerStatus is not DONE
 * - adminAssignedDate is within next 48 hours OR already overdue
 *
 * It keeps notifying every 2 hours until writerStatus becomes DONE.
 */
function startMetaLeadWriterNotificationCron() {
  cron.schedule("0 */2 * * *", async function () {
    try {
      const now = new Date();
      const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const dueNormalLeadFilter = {
        stage: "WRITER",
        status: "PAID",
        leadType: "NORMAL",
        writerVisible: true,
        writerStatus: { $ne: "DONE" },
        adminAssignedDate: {
          $ne: null,
          $lte: next48Hours,
        },
        $or: [
          { lastNotificationSentAt: null },
          { lastNotificationSentAt: { $exists: false } },
          { lastNotificationSentAt: { $lte: twoHoursAgo } },
        ],
      };

      const [normalLeads, metaLeads] = await Promise.all([
        Lead.find(dueNormalLeadFilter)
          .select(
            "_id name adminAssignedDate leadType writerStatus lastNotificationSentAt",
          )
          .sort({ adminAssignedDate: 1 }),

        MetaLead.find(dueNormalLeadFilter)
          .select(
            "_id fullName program school adminAssignedDate leadType writerStatus lastNotificationSentAt",
          )
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

      const leadIds = normalLeads.map((lead) => String(lead._id));
      const metaLeadIds = metaLeads.map((lead) => String(lead._id));

      await sendPushNotificationToUsers(usersToNotify, {
        title: "Normal Lead Due Reminder",
        body: `${totalDueLeads} normal lead(s) are due within 48 hours or overdue.`,
        type: "NORMAL_LEAD_DUE_REMINDER",
        metadata: {
          totalDueLeads,
          normalLeadCount: normalLeads.length,
          metaLeadCount: metaLeads.length,
          leadIds,
          metaLeadIds,
          dueWindowEndsAt: next48Hours,
        },
      });

      await Promise.all([
        Lead.updateMany(
          {
            _id: { $in: normalLeads.map((lead) => lead._id) },
          },
          {
            $set: {
              lastNotificationSentAt: now,
            },
          },
        ),

        MetaLead.updateMany(
          {
            _id: { $in: metaLeads.map((lead) => lead._id) },
          },
          {
            $set: {
              lastNotificationSentAt: now,
            },
          },
        ),
      ]);

      console.log("Normal lead due reminder sent:", {
        totalDueLeads,
        normalLeadCount: normalLeads.length,
        metaLeadCount: metaLeads.length,
      });
    } catch (error) {
      console.error("Normal lead due reminder cron failed:", error);
    }
  });
}

module.exports = {
  startMetaLeadWriterNotificationCron,
};