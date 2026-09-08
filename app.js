const express = require("express");
const cors = require("cors");
const http = require("http");

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const connectDb = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");

const authRoutes = require("./routes/authRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const dataMinorRoutes = require("./routes/dataMinorRoutes");
const verifierRoutes = require("./routes/verifierRoutes");
const leadQualifierRoutes = require("./routes/leadQualifierRoutes");
const managerRoutes = require("./routes/managerRoutes");
const leadSearchRoutes = require("./routes/leadSearchRoutes");

const adminRoutes = require("./routes/adminRoutes");
const writerRoutes = require("./routes/writerRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const bootstrapSuperAdmin = require("./scripts/bootstrapSuperAdmin");

const {
  startMetaLeadWriterNotificationCron,
} = require("./utils/cronScheduler");

const { initSocket } = require("./utils/socket");

const app = express();
const server = http.createServer(app);

// Socket.IO
initSocket(server);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health route
app.get("/", function (req, res) {
  res.send("LeadSyncFlow API running");
});

// Existing Routes
app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/dm", dataMinorRoutes);
app.use("/api/verifier", verifierRoutes);
app.use("/api/lq", leadQualifierRoutes);
app.use("/api/manager", managerRoutes);
app.use("/api/leads/search", leadSearchRoutes);

// New Routes
app.use("/api/admin", adminRoutes);
app.use("/api/writer", writerRoutes);
app.use("/api/notifications", notificationRoutes);

// Error Handler
app.use(errorHandler);

const port = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDb();
    console.log("MongoDB connected successfully");

    try {
      await bootstrapSuperAdmin();
    } catch (e) {
      console.log("Bootstrap error:", e.message);
    }

    try {
      startMetaLeadWriterNotificationCron();
      console.log("Normal writer lead notification cron started");
    } catch (e) {
      console.log("Cron scheduler error:", e.message);
    }

    server.listen(port, function () {
      console.log("Server running on port " + port);
    });
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
}

startServer();