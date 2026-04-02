const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const verifierController = require("../controllers/verifierController");

// GET claimed DM batch for current verifier
// - returns existing claimed batch if present
// - otherwise claims a new batch automatically
router.get(
  "/leads",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.getDmLeads,
);

// Update email statuses for a single claimed DM lead
// - only the verifier who owns the claimed batch can verify it
router.post(
  "/leads/:leadId/update-emails",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.updateEmailStatuses,
);

// Move current verifier's verified leads to LQ
// - only moves leads claimed by current verifier
// - enforces min 100 / max 1000
router.post(
  "/leads/move-all-to-lq",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.moveAllVerifierLeadsToLQ,
);

module.exports = router;