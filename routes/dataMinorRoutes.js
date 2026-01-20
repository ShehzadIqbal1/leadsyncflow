let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let dataMinorController = require("../controllers/dataMinorController");

router.get(
  "/stats",
  requireAuth,
  requireRole(["Data Minors", "Admin"]),
  dataMinorController.getMyStats
);
router.get(
  "/duplicates/check",
  requireAuth,
  requireRole(["Data Minors", "Admin"]),
  dataMinorController.liveDuplicateCheck
);
router.post(
  "/leads",
  requireAuth,
  requireRole(["Data Minors", "Admin"]),
  dataMinorController.submitLead
);

module.exports = router;
