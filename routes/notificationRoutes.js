const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const notificationController = require("../controllers/notificationController");

router.get(
  "/",
  requireAuth,
  notificationController.getMyNotifications,
);

router.get(
  "/unread-count",
  requireAuth,
  notificationController.getUnreadCount,
);

router.patch(
  "/:notificationId/read",
  requireAuth,
  notificationController.markNotificationRead,
);

router.patch(
  "/read-all",
  requireAuth,
  notificationController.markAllNotificationsRead,
);

module.exports = router;