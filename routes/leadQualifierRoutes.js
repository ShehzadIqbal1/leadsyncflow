const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const lqController = require("../controllers/leadQualifierController");

// LQ leads list
router.get(
  "/leads",
  requireAuth,
  requireRole(["Lead Qualifiers", "Admin", "Super Admin"]),
  lqController.getMyLeads
);

// Update LQ status
router.patch(
  "/leads/:leadId/status",
  requireAuth,
  requireRole(["Lead Qualifiers", "Admin", "Super Admin"]),
  lqController.updateLqStatus
);

// Add comment
router.post(
  "/leads/:leadId/comment",
  requireAuth,
  requireRole(["Lead Qualifiers", "Admin", "Super Admin"]),
  lqController.addComment
);

// Submit to manager
router.post(
  "/leads/:leadId/submit-to-manager",
  requireAuth,
  requireRole(["Lead Qualifiers", "Admin", "Super Admin"]),
  lqController.submitToMyManager
);

// Get LQ stats
router.get(
  "/leads/stats",
  requireAuth,
  requireRole(["Lead Qualifiers", "Admin", "Super Admin"]),
  lqController.getMyStats
)

module.exports = router;
