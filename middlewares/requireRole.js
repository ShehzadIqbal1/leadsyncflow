// middlewares/requireRole.js
const User = require("../models/User");
const constants = require("../utils/constants");
const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");

/**
 * Middleware factory to allow access based on user roles.
 *
 * Usage:
 *   requireRole("Data minors")
 *   requireRole(["Data minors", "Manager"])
 *   requireRole(["Manager"], { allowSuperAdmin: false })
 *
 * @param {string|string[]} allowedRoles
 * @param {{allowSuperAdmin?: boolean}} [options]
 */
function requireRole(allowedRoles, options = {}) {
  const allowSuperAdmin = options.allowSuperAdmin !== false; // default true

  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  const systemRoles = Array.isArray(constants && constants.roles) ? constants.roles : null;
  if (!systemRoles || systemRoles.length === 0) {
    throw new Error("requireRole(): constants.roles is missing or invalid");
  }

  // Clean & validate allowed roles
  const cleanedAllowed = allowed
    .map((r) => String(r || "").trim())
    .filter((r) => r.length > 0);

  if (cleanedAllowed.length === 0) {
    throw new Error("requireRole(): allowedRoles is empty");
  }

  for (const r of cleanedAllowed) {
    if (systemRoles.indexOf(r) === -1) {
      throw new Error("requireRole(): invalid allowed role: " + r);
    }
  }

  // Pick a sensible Super Admin role if present in systemRoles
  const SUPER_ADMIN_ROLE = systemRoles.indexOf("Super Admin") !== -1 ? "Super Admin" : null;

  return async function (req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return next(httpError(statusCodes.UNAUTHORIZED, "Authentication required"));
      }

      // Try to use attached role first
      let userRole = req.user.role ? String(req.user.role).trim() : "";

      // If role missing on req.user, fetch from DB
      if (!userRole) {
        const user = await User.findById(req.user.id).select("role status");
        if (!user) {
          return next(httpError(statusCodes.UNAUTHORIZED, "User not found"));
        }

        if (user.status && user.status !== "APPROVED") {
          return next(httpError(statusCodes.FORBIDDEN, "Account not approved"));
        }

        userRole = user.role ? String(user.role).trim() : "";
      }

      if (!userRole) {
        return next(httpError(statusCodes.FORBIDDEN, "User role is missing"));
      }

      if (systemRoles.indexOf(userRole) === -1) {
        return next(httpError(statusCodes.FORBIDDEN, "Invalid user role"));
      }

      // Super Admin override (optional)
      if (allowSuperAdmin && SUPER_ADMIN_ROLE && userRole === SUPER_ADMIN_ROLE) {
        return next();
      }

      // Final authorization check
      if (cleanedAllowed.indexOf(userRole) === -1) {
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          message: "Access denied - insufficient permissions",
          requiredRoles: cleanedAllowed,
          yourRole: userRole,
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requireRole;