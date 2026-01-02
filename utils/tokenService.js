let jwt = require("jsonwebtoken");

function signAuthToken(userId) {
  let secret = process.env.JWT_SECRET;
  let expiresIn = process.env.JWT_EXPIRES_IN || "12h";
  return jwt.sign({ id: userId }, secret, { expiresIn: expiresIn });
}

function verifyAuthToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = {
  signAuthToken: signAuthToken,
  verifyAuthToken: verifyAuthToken
};
