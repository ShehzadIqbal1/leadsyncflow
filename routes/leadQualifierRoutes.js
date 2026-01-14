let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let lqController = require("../controllers/leadQualifierController");

// LQ dropdown data: managers list
router.get(
  "/managers",
  requireAuth,
  requireRole("Lead Qualifiers", "Super Admin", "Admin"),
  lqController.getManagersList
);

router.get(
  "/leads",
  requireAuth,
  requireRole(["Lead Qualifiers", "Super Admin", "Admin"]),
  lqController.getMyLeads
);

router.patch(
  "/leads/:leadId/status",
  requireAuth,
  requireRole(["Lead Qualifiers", "Super Admin", "Admin"]),
  lqController.updateLqStatus
);

router.post(
  "/leads/:leadId/comment",
  requireAuth,
  requireRole(["Lead Qualifiers", "Super Admin", "Admin"]),
  lqController.addComment
);

router.post(
  "/leads/:leadId/assign-manager",
  requireAuth,
  requireRole(["Lead Qualifiers", "Super Admin", "Admin"]),
  lqController.assignToManager
);

module.exports = router;
