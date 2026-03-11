const User = require("../models/User");
const constants = require("../utils/constants");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("./asyncHandler");

module.exports = asyncHandler(async function (req, res, next) {
  const user = await User.findById(req.user.id).select(" role status");
  if (!user) return next(httpError(statusCodes.UNAUTHORIZED, "Not authenticated"));
  
  if (user.status !== constants.userStatus.APPROVED) {
    return next(httpError(statusCodes.FORBIDDEN, "Account not approved"));
  }

  if (user.role !== constants.roles[0]) {
    return next(httpError(statusCodes.FORBIDDEN, "Super admin only"));
  }
  next();
});
