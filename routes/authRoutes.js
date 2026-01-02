let express = require("express");
let router = express.Router();

let upload = require("../middlewares/upload");
let checkEmailAvailable = require("../middlewares/checkEmailAvailable");
let authController = require("../controllers/authController");

router.post("/signup", checkEmailAvailable, authController.signup);

router.post("/login", authController.login);
router.post("/logout", authController.logout);

module.exports = router;
