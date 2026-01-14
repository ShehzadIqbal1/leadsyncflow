let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let managerController = require("../controllers/managerController");

router.get(
  "/leads",
  requireAuth,
  requireRole("Manager, Super Admin", "Admin"),
  managerController.getMyAssignedLeads
);

router.post(
  "/leads/:id/decision",
  requireAuth,
  requireRole("Manager", "Super Admin", "Admin"),
  managerController.decisionOnLead
);

router.post(
  "/leads/:id/comment",
  requireAuth,
  requireRole("Manager", "Super Admin", "Admin"),
  managerController.addManagerComment
);

router.post(
  "/leads/:id/payment-status",
  requireAuth,
  requireRole("Manager", "Super Admin", "Admin"),
  managerController.updatePaymentStatus
);

module.exports = router;