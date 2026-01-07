let bcrypt = require("bcryptjs");
let User = require("../models/User");

let statusCodes = require("../utils/statusCodes");
let httpError = require("../utils/httpError");
let asyncHandler = require("../middlewares/asyncHandler");
let constants = require("../utils/constants");
let tokenService = require("../utils/tokenService");

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
  let domain = "@globaldigitsolutions.com";
  if (!email) return false;
  return String(email).toLowerCase().endsWith(domain);
}

function isInList(value, list) {
  if (!Array.isArray(list)) return false;
  return list.indexOf(value) !== -1;
}

function getSaltRounds() {
  let rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10);
  if (!rounds || isNaN(rounds)) return 10;
  if (rounds < 8) return 10;
  if (rounds > 14) return 12;
  return rounds;
}

function validateSignupInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  let data = {
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

  if (!isValidEmail(data.email)) return { ok: false, message: "Invalid email" };
  if (!isAllowedCompanyEmail(data.email))
    return {
      ok: false,
      message: "Only @globaldigitsolutions.com emails are allowed",
    };

  if (!isInList(data.sex, constants.sexOptions))
    return { ok: false, message: "Invalid sex value" };
  if (!isInList(data.department, constants.departments))
    return { ok: false, message: "Invalid department value" };

  if (data.password.length < 6)
    return { ok: false, message: "Password must be at least 6 characters" };
  if (data.password !== data.confirmPassword)
    return { ok: false, message: "Passwords do not match" };

  return { ok: true, data: data };
}

function validateLoginInput(body) {
  if (!body) return { ok: false, message: "Invalid request body" };

  let data = {
    email: safeEmail(body.email),
    password: body.password ? String(body.password) : "",
  };

  if (!data.email || !data.password)
    return { ok: false, message: "Email and password are required" };
  if (!isValidEmail(data.email)) return { ok: false, message: "Invalid email" };
  if (!isAllowedCompanyEmail(data.email))
    return {
      ok: false,
      message: "Only @globaldigitsolutions.com emails are allowed",
    };

  return { ok: true, data: data };
}

let signup = asyncHandler(async function (req, res, next) {
  let validation = validateSignupInput(req.body);
  if (!validation.ok)
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));

  let data = validation.data;

  let existing = await User.findOne({ email: data.email }).select("_id");
  if (existing)
    return next(httpError(statusCodes.CONFLICT, "Email already registered"));

  let passwordHash = await bcrypt.hash(data.password, getSaltRounds());

  let user = await User.create({
    name: data.name,
    email: data.email,
    sex: data.sex,
    department: data.department,
    // role is assigned on approval
    
    // systemRole default USER
    status: constants.userStatus.PENDING,
    passwordHash: passwordHash,
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

let login = asyncHandler(async function (req, res, next) {
  let validation = validateLoginInput(req.body);
  if (!validation.ok)
    return next(httpError(statusCodes.BAD_REQUEST, validation.message));

  let data = validation.data;

  let user = await User.findOne({ email: data.email }).select(
    "name email passwordHash status role department sex profileImage"
  );
  if (!user)
    return next(httpError(statusCodes.UNAUTHORIZED, "Invalid credentials"));

  // block login if not approved
  if (user.status !== constants.userStatus.APPROVED) {
    return next(
      httpError(statusCodes.FORBIDDEN, "Your account is not approved yet")
    );
  }

  let ok = await bcrypt.compare(data.password, user.passwordHash);
  if (!ok)
    return next(httpError(statusCodes.UNAUTHORIZED, "Invalid credentials"));

  let token = tokenService.signAuthToken(user._id);

  res.status(statusCodes.OK).json({
    success: true,
    message: "Login successful",
    token: token,
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

// Stateless logout: frontend removes token
let logout = function (req, res) {
  res.status(statusCodes.OK).json({ success: true, message: "Logged out" });
};

module.exports = {
  signup: signup,
  login: login,
  logout: logout,
};
