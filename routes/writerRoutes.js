const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const writerController = require("../controllers/writerController");

// Combined writer leads endpoint
router.get(
  "/leads",
  requireAuth,
  requireRole(["Writer", "Admin", "Super Admin"]),
  writerController.getAllWriterLeads,
);

// Normal writer leads
router.get(
  "/leads/normal",
  requireAuth,
  requireRole(["Writer", "Admin", "Super Admin"]),
  writerController.getNormalLeads,
);

// Recurring writer leads
router.get(
  "/leads/recurring",
  requireAuth,
  requireRole(["Writer", "Admin", "Super Admin"]),
  writerController.getRecurringLeads,
);

// Optional status update: PENDING / IN_PROGRESS
router.patch(
  "/leads/:source/:leadId/status",
  requireAuth,
  requireRole(["Writer", "Admin", "Super Admin"]),
  writerController.updateWriterStatus,
);

// Mark lead done
router.patch(
  "/leads/:source/:leadId/done",
  requireAuth,
  requireRole(["Writer", "Admin", "Super Admin"]),
  writerController.markLeadDone,
);

module.exports = router;