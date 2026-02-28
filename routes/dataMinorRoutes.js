const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const dataMinorController = require("../controllers/dataMinorController");

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
