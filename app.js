let express = require("express");
let dotenv = require("dotenv");
let cors = require("cors");
let path = require("path");
let cookieParser = require("cookie-parser");

require("dotenv").config();


// 3️⃣ Now load rest of app
let connectDb = require("./config/db");
let errorHandler = require("./middlewares/errorHandler");
let authRoutes = require("./routes/authRoutes");

connectDb();

let app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());



app.use(express.static(path.join(__dirname, "public")));

app.get("/", function (req, res) {
  res.send("LeadSyncFlow API running");
});

app.use("/api/auth", authRoutes);

app.use(errorHandler);

let port = process.env.PORT || 5000;
app.listen(port, function () {
  console.log("🚀 Server running on port " + port);
});
