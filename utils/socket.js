const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

let io = null;

function getTokenFromSocket(socket) {
  const authToken = socket.handshake.auth && socket.handshake.auth.token;
  const headerToken = socket.handshake.headers.authorization;

  if (authToken) {
    return String(authToken).replace(/^Bearer\s+/i, "").trim();
  }

  if (headerToken) {
    return String(headerToken).replace(/^Bearer\s+/i, "").trim();
  }

  return "";
}

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST", "PATCH"],
      credentials: true,
    },
  });

  io.use(async function (socket, next) {
    try {
      const token = getTokenFromSocket(socket);

      if (!token) {
        return next(new Error("Authentication token missing"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const userId = decoded.id || decoded.userId || decoded._id;

      if (!userId) {
        return next(new Error("Invalid token payload"));
      }

      const user = await User.findById(userId).select("_id name email role status");

      if (!user || user.status !== "APPROVED") {
        return next(new Error("User not approved or not found"));
      }

      socket.user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      };

      return next();
    } catch (error) {
      return next(new Error("Socket authentication failed"));
    }
  });

  io.on("connection", function (socket) {
    const user = socket.user;

    socket.join(`user:${user.id}`);

    if (user.role) {
      socket.join(`role:${user.role}`);
    }

    console.log("Socket connected:", {
      socketId: socket.id,
      userId: user.id,
      role: user.role,
    });

    socket.emit("socket:connected", {
      success: true,
      userId: user.id,
      role: user.role,
    });

    socket.on("disconnect", function () {
      console.log("Socket disconnected:", {
        socketId: socket.id,
        userId: user.id,
      });
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, eventName, payload) {
  if (!io || !userId) return;

  io.to(`user:${String(userId)}`).emit(eventName, payload);
}

function emitToRole(role, eventName, payload) {
  if (!io || !role) return;

  io.to(`role:${role}`).emit(eventName, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToRole,
};