const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

const getMyNotifications = asyncHandler(async function (req, res) {
  let limit = parseInt(req.query.limit || "20", 10);
  let skip = parseInt(req.query.skip || "0", 10);

  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  if (isNaN(skip) || skip < 0) skip = 0;

  const [notifications, totalNotifications, unreadCount] = await Promise.all([
    Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Notification.countDocuments({ user: req.user.id }),

    Notification.countDocuments({
      user: req.user.id,
      isRead: false,
    }),
  ]);

  return res.status(statusCodes.OK).json({
    success: true,
    totalNotifications,
    unreadCount,
    count: notifications.length,
    limit,
    skip,
    notifications,
  });
});

const getUnreadCount = asyncHandler(async function (req, res) {
  const unreadCount = await Notification.countDocuments({
    user: req.user.id,
    isRead: false,
  });

  return res.status(statusCodes.OK).json({
    success: true,
    unreadCount,
  });
});

const markNotificationRead = asyncHandler(async function (req, res, next) {
  const notificationId = req.params.notificationId;

  if (!isValidObjectId(notificationId)) {
    return next(httpError(statusCodes.BAD_REQUEST, "Invalid notificationId"));
  }

  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      user: req.user.id,
    },
    {
      $set: {
        isRead: true,
      },
    },
    {
      new: true,
    },
  );

  if (!notification) {
    return next(httpError(statusCodes.NOT_FOUND, "Notification not found"));
  }

  return res.status(statusCodes.OK).json({
    success: true,
    message: "Notification marked as read",
    notification,
  });
});

const markAllNotificationsRead = asyncHandler(async function (req, res) {
  const result = await Notification.updateMany(
    {
      user: req.user.id,
      isRead: false,
    },
    {
      $set: {
        isRead: true,
      },
    },
  );

  return res.status(statusCodes.OK).json({
    success: true,
    message: "All notifications marked as read",
    updatedCount: result.modifiedCount || 0,
  });
});

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};