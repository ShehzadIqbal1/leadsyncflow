let express = require("express");
let router = express.Router();

// Middlewares
let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let requireSuperAdmin = require("../middlewares/requireSuperAdmin");

// Controller
let superAdminController = require("../controllers/superAdminController");

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

// Single export for the entire router
module.exports = router;