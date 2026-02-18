let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let lqController = require("../controllers/leadQualifierController");

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

module.exports = router;
