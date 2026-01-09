let express = require("express");
let cors = require("cors");

require("dotenv").config();

let connectDb = require("./config/db");
let errorHandler = require("./middlewares/errorHandler");

let authRoutes = require("./routes/authRoutes");
let adminRoutes = require("./routes/adminRoutes");
let dataMinorRoutes = require("./routes/dataMinorRoutes");

let bootstrapSuperAdmin = require("./scripts/bootstrapSuperAdmin");

connectDb();

let app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", function (req, res) {
  res.send("LeadSyncFlow API running");
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dm", dataMinorRoutes);


app.use(errorHandler);

let port = process.env.PORT || 5000;

app.listen(port, async function () {
  try {
    await bootstrapSuperAdmin();
  } catch (e) {
    console.log("Bootstrap error:", e.message);
  }
  console.log("Server running on port " + port);
});
