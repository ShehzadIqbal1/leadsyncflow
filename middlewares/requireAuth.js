const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const tokenService = require("../utils/tokenService");

function getToken(req) {
  let header = req.headers.authorization || "";
  header = String(header).trim();

  // allow "bearer" in any case
  if (header.toLowerCase().indexOf("bearer ") === 0) {
    return header.slice(7).trim();
  }

  return "";
}

module.exports = function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token)
    return next(httpError(statusCodes.UNAUTHORIZED, "Not authenticated"));

  try {
    const decoded = tokenService.verifyAuthToken(token);
    req.user = { id: decoded.id };
    return next();
  } catch (e) {
    console.log("AUTH VERIFY ERROR:", e && e.message ? e.message : e);

    if (e && e.name === "TokenExpiredError") {
      return next(
        httpError(
          statusCodes.UNAUTHORIZED,
          "Session expired, please login again",
        ),
      );
    }

    return next(httpError(statusCodes.UNAUTHORIZED, "Invalid token"));
  }
};
