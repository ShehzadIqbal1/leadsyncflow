const express = require("express");
const router = express.Router();

// Middlewares
const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");

// Controller
const superAdminController = require("../controllers/superAdminController");

// ---------------------------------------------------------
// DASHBOARD & ANALYTICS
// Allowed for: Super Admin, Admin
// ---------------------------------------------------------

router.get(
  "/overview",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getOverview
);

router.get(
  "/leads",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getAllLeads
);

router.get(
  "/performance",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getPerformance
);

// ---------------------------------------------------------
// USER MANAGEMENT (PENDING REQUESTS)
// Allowed for: Super Admin only
// ---------------------------------------------------------

router.get(
  "/requests/pending",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getPendingRequests
);

router.patch(
  "/requests/:id/approve",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.approveRequest
);

router.delete(
  "/requests/:id/reject",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.rejectRequest
);

// Managers WITH assigned LQs (for unassign screen)
router.get(
  "/managers/with-lqs",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getManagersWithLQs
);

// Managers WITHOUT assigned LQs (for assign screen)
router.get(
  "/managers/without-lqs",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getManagersWithoutLQs
);

// Unassigned Lead Qualifiers (assignment pool)
router.get(
  "/lead-qualifiers/unassigned",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.getUnassignedLeadQualifiers
);

// Assign LQs → Manager
router.patch(
  "/managers/:managerId/assign-lqs",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.assignLqsToManager
);

// Unassign LQs
router.patch(
  "/lead-qualifiers/unassign",
  requireAuth,
  requireRole(["Super Admin", "Admin"]),
  superAdminController.unassignLqs
);

module.exports = router;