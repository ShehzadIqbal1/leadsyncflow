const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const verifierController = require("../controllers/verifierController");


router.get(
  "/leads",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.getDmLeads
);

router.post(
  "/leads/:leadId/update-emails",
  requireAuth,
  requireRole(["Verifier","Admin","Super Admin"]),
  verifierController.updateEmailStatuses
);

// Route updated to handle bulk distribution
router.post(
  "/leads/distribute-verifier-to-lq", 
  requireAuth, 
  requireRole(["Verifier", "Admin"]), 
  verifierController.moveAllVerifierLeadsToLQ
);

module.exports = router;