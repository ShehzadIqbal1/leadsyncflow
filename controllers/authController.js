const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Resend } = require("resend");

const User = require("../models/User");

const statusCodes = require("../utils/statusCodes");
const httpError = require("../utils/httpError");
const asyncHandler = require("../middlewares/asyncHandler");
const constants = require("../utils/constants");
const tokenService = require("../utils/tokenService");
const { buildForgotPasswordEmailHtml } = require("../utils/emailTemplates");

const resend = new Resend(process.env.RESEND_API_KEY);

function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function safeEmail(value) {
  return safeString(value).toLowerCase();
}

function safeLower(value) {
  return safeString(value).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

function isAllowedCompanyEmail(email) {
  const domain = "@globaldigitsolutions.com";
  if (!email) return false;
  return String(email).toLowerCase().endsWith(domain);
}

function isInList(value, list) {
  if (!Array.isArray(list)) return false;
  return list.indexOf(value) !== -1;
}

function getSaltRounds() {
  const rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10);
  if (!rounds || isNaN(rounds)) return 10;
  if (rounds < 8) return 10;
  if (rounds > 14) return 12;
  return rounds;
}

function validateSignupInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  const data = {
    name: safeString(body.name),
    email: safeEmail(body.email),
    sex: safeLower(body.sex),
    department: safeString(body.department),
    password: body.password ? String(body.password) : "",
    confirmPassword: body.confirmPassword ? String(body.confirmPassword) : "",
  };

  if (
    !data.name ||
    !data.email ||
    !data.sex ||
    !data.department ||
    !data.password ||
    !data.confirmPassword
  ) {
    return { ok: false, message: "All fields are required" };
  }

  if (!isValidEmail(data.email)) {
    return { ok: false, message: "Invalid email" };
  }

  if (!isAllowedCompanyEmail(data.email)) {
    return {
      ok: false,
      message: "Only @globaldigitsolutions.com emails are allowed",
    };
  }

  if (!isInList(data.sex, constants.sexOptions)) {
    return { ok: false, message: "Invalid sex value" };
  }

  if (!isInList(data.department, constants.departments)) {
    return { ok: false, message: "Invalid department value" };
  }

  if (data.password.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters" };
  }

  if (data.password !== data.confirmPassword) {
    return { ok: false, message: "Passwords do not match" };
  }

  return { ok: true, data };
}

function validateLoginInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  const data = {
    email: safeEmail(body.email),
    password: body.password ? String(body.password) : "",
  };

  if (!data.email || !data.password) {
    return { ok: false, message: "Email and password are required" };
  }

  if (!isValidEmail(data.email)) {
    return { ok: false, message: "Invalid email" };
  }

  if (!isAllowedCompanyEmail(data.email)) {
    return {
      ok: false,
      message: "Only @globaldigitsolutions.com emails are allowed",
    };
  }

  return { ok: true, data };
}

function validateForgotPasswordInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  const data = {
    email: safeEmail(body.email),
  };

  if (!data.email) {
    return { ok: false, message: "Email is required" };
  }

  if (!isValidEmail(data.email)) {
    return { ok: false, message: "Invalid email" };
  }

  if (!isAllowedCompanyEmail(data.email)) {
    return {
      ok: false,
      message: "Only @globaldigitsolutions.com emails are allowed",
    };
  }

  return { ok: true, data };
}

function validateResetPasswordInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  const data = {
    password: body.password ? String(body.password) : "",
    confirmPassword: body.confirmPassword
      ? String(body.confirmPassword)
      : "",
  };

  if (!data.password || !data.confirmPassword) {
    return { ok: false, message: "Password and confirm password are required" };
  }

  if (data.password.length < 6) {
    return { ok: false, message: "Password must be at least 6 characters" };
  }

  if (data.password !== data.confirmPassword) {
    return { ok: false, message: "Passwords do not match" };
  }

  return { ok: true, data };
}

function createPasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return {
    rawToken,
    hashedToken,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

const signup = asyncHandler(async function (req, res, next) {
  const validation = validateSignupInput(req.body);
  if (!validation.ok) {
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));
  }

  const data = validation.data;

  const existing = await User.findOne({ email: data.email }).select("_id");
  if (existing) {
    return next(httpError(statusCodes.CONFLICT, "Email already registered"));
  }

  const passwordHash = await bcrypt.hash(data.password, getSaltRounds());

  const user = await User.create({
    name: data.name,
    email: data.email,
    sex: data.sex,
    department: data.department,
    status: constants.userStatus.PENDING,
    passwordHash,
    profileImage: { url: "", publicId: "" },
  });

  res.status(statusCodes.CREATED).json({
    success: true,
    message: "Signup request submitted. Waiting for approval.",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      status: user.status,
    },
  });
});

const login = asyncHandler(async function (req, res, next) {
  const validation = validateLoginInput(req.body);
  if (!validation.ok) {
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));
  }

  const data = validation.data;

  const user = await User.findOne({ email: data.email }).select(
    "name email passwordHash status role department sex profileImage",
  );

  if (!user) {
    return next(httpError(statusCodes.UNAUTHORIZED, "Invalid credentials"));
  }

  if (user.status !== constants.userStatus.APPROVED) {
    return next(
      httpError(statusCodes.FORBIDDEN, "Your account is not approved yet"),
    );
  }

  const ok = await bcrypt.compare(data.password, user.passwordHash);
  if (!ok) {
    return next(httpError(statusCodes.UNAUTHORIZED, "Invalid credentials"));
  }

  const token = tokenService.signAuthToken(user._id);

  res.status(statusCodes.OK).json({
    success: true,
    message: "Login successful",
    token,
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      sex: user.sex,
      department: user.department,
      role: user.role,
      profileImage:
        user.profileImage && user.profileImage.url ? user.profileImage.url : "",
    },
  });
});

const forgotPassword = asyncHandler(async function (req, res, next) {
  const validation = validateForgotPasswordInput(req.body);
  if (!validation.ok) {
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));
  }

  const data = validation.data;

  const genericResponse = {
    success: true,
    message: "If an account exists, an email has been sent",
  };

  const user = await User.findOne({ email: data.email }).select(
    "_id name email status passwordResetToken passwordResetExpiresAt",
  );

  if (!user) {
    return res.status(statusCodes.OK).json(genericResponse);
  }

  if (!process.env.APP_BASE_URL) {
    return next(
      httpError(statusCodes.INTERNAL_SERVER_ERROR, "APP_BASE_URL is not set"),
    );
  }

  if (!process.env.EMAIL_FROM) {
    return next(
      httpError(statusCodes.INTERNAL_SERVER_ERROR, "EMAIL_FROM is not set"),
    );
  }

  const tokenData = createPasswordResetToken();

  user.passwordResetToken = tokenData.hashedToken;
  user.passwordResetExpiresAt = tokenData.expiresAt;

  await user.save({ validateBeforeSave: false });

  const baseUrl = safeString(process.env.APP_BASE_URL).replace(/\/+$/, "");
  const resetUrl = `${baseUrl}/reset-password/${tokenData.rawToken}`;

  const html = buildForgotPasswordEmailHtml({
    name: user.name,
    resetUrl,
  });

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: "Reset your LeadSyncFlow password",
      html,
    });
  } catch (error) {
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await user.save({ validateBeforeSave: false });

    return next(
      httpError(
        statusCodes.INTERNAL_SERVER_ERROR,
        "Failed to send reset email",
      ),
    );
  }

  res.status(statusCodes.OK).json(genericResponse);
});

const resetPassword = asyncHandler(async function (req, res, next) {
  const rawToken = safeString(req.params.token);

  if (!rawToken) {
    return next(httpError(statusCodes.BAD_REQUEST, "Reset token is required"));
  }

  const validation = validateResetPasswordInput(req.body);
  if (!validation.ok) {
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));
  }

  const data = validation.data;

  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpiresAt passwordHash");

  if (!user) {
    return next(
      httpError(statusCodes.BAD_REQUEST, "Invalid or expired reset token"),
    );
  }

  const newPasswordHash = await bcrypt.hash(data.password, getSaltRounds());

  user.passwordHash = newPasswordHash;
  user.passwordResetToken = null;
  user.passwordResetExpiresAt = null;

  await user.save({ validateBeforeSave: false });

  res.status(statusCodes.OK).json({
    success: true,
    message: "Password reset successful",
  });
});

const logout = function (req, res) {
  res.status(statusCodes.OK).json({
    success: true,
    message: "Logged out",
  });
};

module.exports = {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
};