let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let verifierController = require("../controllers/verifierController");

router.get(
  "/leads",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.getDmLeads
);

router.patch(
  "/leads/:leadId/emails/status",
  requireAuth,
  requireRole(["Verifier", "Admin", "Super Admin"]),
  verifierController.updateEmailStatus
);

module.exports = router;
