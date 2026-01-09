function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailLocalPart(email) {
  let e = normalizeEmail(email);
  let at = e.indexOf("@");
  if (at === -1) return "";
  return e.slice(0, at);
}

function normalizePhone(phone) {
  let p = String(phone || "").trim();
  return p.replace(/[^\d]/g, "");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

module.exports = {
  normalizeEmail: normalizeEmail,
  emailLocalPart: emailLocalPart,
  normalizePhone: normalizePhone,
  isValidEmail: isValidEmail
};
