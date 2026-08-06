const Notification = require("../models/Notification");

/**
 * This creates in-app notifications in MongoDB.
 *
 * Later, if you add real push notification service like:
 * - Firebase Cloud Messaging
 * - OneSignal
 * - Socket.IO
 *
 * you can plug it inside this same function.
 */
async function sendPushNotificationToUsers(users, payload) {
  if (!Array.isArray(users) || users.length === 0) {
    return;
  }

  const notifications = users.map((user) => ({
    user: user._id,
    title: payload.title,
    body: payload.body,
    type: payload.type,
    metadata: payload.metadata || {},
    createdForRole: user.role || "",
  }));

  await Notification.insertMany(notifications);

  console.log("Notifications created:", {
    users: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    })),
    payload,
  });
}

module.exports = {
  sendPushNotificationToUsers,
};