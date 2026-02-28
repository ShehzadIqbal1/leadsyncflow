const jwt = require("jsonwebtoken");

function signAuthToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing");

  const expiresIn = process.env.JWT_EXPIRES_IN || "12h";

  // Ensure id is always string
  return jwt.sign({ id: String(userId) }, secret, { expiresIn: expiresIn });
}

function verifyAuthToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing");

  return jwt.verify(token, secret);
}

module.exports = {
  signAuthToken: signAuthToken,
  verifyAuthToken: verifyAuthToken
};
