const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const leadSearchController = require("../controllers/leadSearchController");

router.get(
  "/",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  leadSearchController.searchLeads
);

module.exports = router;