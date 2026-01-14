let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let verifierController = require("../controllers/verifierController");


router.get(
  "/leads",
  requireAuth,
  requireRole(["Verifier", "Super Admin", "Admin"]),
  verifierController.getDmLeads
);

router.post(
  "/leads/:leadId/update-emails",
  requireAuth,
  requireRole(["Verifier", "Super Admin", "Admin"]),
  verifierController.updateEmailStatuses
);

router.post(
  "/leads/:leadId/move-to-lq",
  requireAuth,
  requireRole(["Verifier", "Super Admin", "Admin"]),
  verifierController.moveLeadToLeadQualifiers
);

module.exports = router;