let express = require("express");
let router = express.Router();

let requireAuth = require("../middlewares/requireAuth");
let requireRole = require("../middlewares/requireRole");
let managerController = require("../controllers/managerController");

// Apply middleware to all routes in this router to keep it DRY
router.use(requireAuth);
router.use(requireRole("Manager", "Admin"));

// GET all leads assigned to the manager
router.get("/leads", managerController.getMyAssignedLeads);

// POST request for lead rejection
router.post("/leads/:id/reqRejection", managerController.requestRejection);

// POST record payment/upsell
router.post("/leads/:id/payment-status", managerController.updatePaymentStatus);

module.exports = router;