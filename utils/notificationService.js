const Notification = require("../models/Notification");
const { emitToUser } = require("./socket");

async function createAndPushNotification(user, payload) {
  const notification = await Notification.create({
    user: user._id,
    title: payload.title,
    body: payload.body,
    type: payload.type,
    metadata: payload.metadata || {},
  });

  const socketPayload = {
    _id: notification._id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    isRead: notification.isRead,
    metadata: notification.metadata,
    createdAt: notification.createdAt,
  };

  emitToUser(user._id, "notification:new", socketPayload);

  return notification;
}

async function createAndPushNotifications(users, payload) {
  if (!Array.isArray(users) || users.length === 0) {
    return [];
  }

  const created = [];

  for (const user of users) {
    const notification = await createAndPushNotification(user, payload);
    created.push(notification);
  }

  return created;
}

module.exports = {
  createAndPushNotification,
  createAndPushNotifications,
};