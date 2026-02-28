const statusCodes = require("../utils/statusCodes");

module.exports = function errorHandler(err, req, res, next) {
  const code = err.statusCode || statusCodes.INTERNAL_SERVER_ERROR;

  res.status(code).json({
    success: false,
    message: err.message || "Server error"
  });
};
