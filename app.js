let express = require("express");
let cors = require("cors");
require("dotenv").config();

let connectDb = require("./config/db");
let errorHandler = require("./middlewares/errorHandler");

let authRoutes = require("./routes/authRoutes");
let superAdminRoutes = require("./routes/superAdminRoutes");
let dataMinorRoutes = require("./routes/dataMinorRoutes");
let verifierRoutes = require("./routes/verifierRoutes");
let leadQualifierRoutes = require("./routes/leadQualifierRoutes");
let managerRoutes = require("./routes/managerRoutes");
let bootstrapSuperAdmin = require("./scripts/bootstrapSuperAdmin");

let app = express();

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


let port = process.env.PORT || 5000;


async function startServer() {
  try{
    //Connect to DB
      await connectDb();
      console.log("MongoDB connected successfully");

      //Start Express server
      app.listen(port, async function () {
        console.log("Server running on port " + port);
      });

      //Run bootstrap for super admin
      try{
      await bootstrapSuperAdmin();
      }catch(e){
        console.log("Bootstrap error:", e.message);
      }
  } catch (error) {
    console.error("Error starting server:", error.message);
    process.exit(1);
  }
}

startServer();







app.listen(port, async function () {
  try {
    await bootstrapSuperAdmin();
  } catch (e) {
    console.log("Bootstrap error:", e.message);
  }
  console.log("Server running on port " + port);
});
