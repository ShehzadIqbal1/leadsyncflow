const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");
const adminController = require("../controllers/adminController");

// Manager dropdown
router.get(
  "/managers",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.getApprovedManagers,
);

// Create MetaLead in ADMIN_REVIEW stage
router.post(
  "/meta-leads",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.createMetaLead,
);

// View MetaLeads for Admin assignment/review
router.get(
  "/meta-leads",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.getMetaLeads,
);

// Assign MetaLead to Manager
router.patch(
  "/meta-leads/:leadId/assign-manager",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.assignMetaLeadToManager,
);

// View all paid leads from both Lead and MetaLead models
router.get(
  "/paid-leads",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.getPaidLeads,
);

// Process paid lead from Lead or MetaLead model as NORMAL / RECURRING
router.patch(
  "/paid-leads/:source/:leadId/process",
  requireAuth,
  requireRole(["Admin", "Super Admin"]),
  adminController.processPaidLead,
);

module.exports = router;