const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDb = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");

const authRoutes = require("./routes/authRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const dataMinorRoutes = require("./routes/dataMinorRoutes");
const verifierRoutes = require("./routes/verifierRoutes");
const leadQualifierRoutes = require("./routes/leadQualifierRoutes");
const managerRoutes = require("./routes/managerRoutes");
const bootstrapSuperAdmin = require("./scripts/bootstrapSuperAdmin");

const app = express();

//Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Routes
app.get("/", function (req, res) {
  res.send("LeadSyncFlow API running");
});

app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/dm", dataMinorRoutes);
app.use("/api/verifier", verifierRoutes);
app.use("/api/lq", leadQualifierRoutes);
app.use("/api/manager", managerRoutes);

app.use(errorHandler);

const port = process.env.PORT || 5000;

async function startServer() {
  try {
    //Connect to DB
    await connectDb();
    console.log("MongoDB connected successfully");

    //Start Express server
    app.listen(port, async function () {
      console.log("Server running on port " + port);
    });

    //Run bootstrap for super admin
    try {
      await bootstrapSuperAdmin();
    } catch (e) {
      console.log("Bootstrap error:", e.message);
    }
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
}

startServer();
