let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let tokenService = require("../utils/tokenService");

function getToken(req) {
  // 1) cookie
  if (req.cookies && req.cookies.authToken) return req.cookies.authToken;

  // 2) bearer header
  let header = req.headers.authorization || "";
  if (header.indexOf("Bearer ") === 0) return header.slice(7).trim();

  return "";
}

module.exports = function requireAuth(req, res, next) {
  let token = getToken(req);
  if (!token)
    return next(httpError(statusCodes.UNAUTHORIZED, "Not authenticated"));

  try {
    let decoded = tokenService.verifyAuthToken(token);
    req.user = { id: decoded.id };
    next();
  } catch (e) {
    return next(
      httpError(statusCodes.UNAUTHORIZED, "Session expired, please login again")
    );
  }
};
