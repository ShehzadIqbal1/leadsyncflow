const express = require("express");
const cors = require("cors");

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


// New Meta Lead routes
const adminRoutes = require("./routes/adminRoutes");
const writerRoutes = require("./routes/writerRoutes");

// Bootstrap
const bootstrapSuperAdmin = require("./scripts/bootstrapSuperAdmin");

// Cron Scheduler
const {
  startMetaLeadWriterNotificationCron,
} = require("./utils/cronScheduler");

const app = express();

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

// New Meta Lead Routes
app.use("/api/admin", adminRoutes);
app.use("/api/writer", writerRoutes);

// Error Handler - always after routes
app.use(errorHandler);

const port = process.env.PORT || 5000;

async function startServer() {
  try {
    // Connect to DB
    await connectDb();
    console.log("MongoDB connected successfully");

    // Run bootstrap for super admin
    try {
      await bootstrapSuperAdmin();
    } catch (e) {
      console.log("Bootstrap error:", e.message);
    }

    // Start cron jobs after DB connection
    try {
      startMetaLeadWriterNotificationCron();
      console.log("MetaLead writer notification cron started");
    } catch (e) {
      console.log("Cron scheduler error:", e.message);
    }

    // Start Express server
    app.listen(port, function () {
      console.log("Server running on port " + port);
    });
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
}

startServer();