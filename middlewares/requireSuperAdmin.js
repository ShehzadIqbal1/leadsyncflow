let User = require("../models/User");
let constants = require("../utils/constants");
let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("./asyncHandler");

module.exports = asyncHandler(async function (req, res, next) {
  let user = await User.findById(req.user.id).select(" role status");
  if (!user) return next(httpError(statusCodes.UNAUTHORIZED, "Not authenticated"));
  
  if (user.status !== constants.userStatus.APPROVED) {
    return next(httpError(statusCodes.FORBIDDEN, "Account not approved"));
  }

  if (user.role !== constants.roles[0]) {
    return next(httpError(statusCodes.FORBIDDEN, "Super admin only"));
  }
  next();
});
