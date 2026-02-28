const normalize = require("../utils/normalize");
const common = require("./commonValidator");

function cleanSources(sources) {
  const arr = Array.isArray(sources) ? sources : [];
  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const s = arr[i] || {};
    const name = common.safeString(s.name);
    const link = common.safeString(s.link);

    if (!name || !link) continue;

    out.push({ name: name, link: link });
  }

  return out;
}

/**
 * Validates Data Minors lead payload
 *
 * Rules:
 * - name required
 * - location optional
 * - at least 1 of (emails, phones) required
 * - emails max 10
 * - phones max 10
 * - sources min 1 (ONLY ONE REQUIRED)
 * - email format valid
 * - phone normalized non-empty
 * - source link valid URL
 */
function validateDataMinorLead(body) {
  const name = common.safeString(body && body.name);
  const location = common.safeString(body && body.location); // optional
  const emails = common.uniqueStrings(body && body.emails);
  const phones = common.uniqueStrings(body && body.phones);
  const sources = cleanSources(body && body.sources);

  if (!name) {
    return { ok: false, message: "Name is required", fields: { name: true } };
  }

  // ✅ at least one email OR phone
  if (emails.length === 0 && phones.length === 0) {
    return {
      ok: false,
      message: "At least one email or phone number is required",
      fields: { emails: true, phones: true }
    };
  }

  if (emails.length > 10) {
    return { ok: false, message: "Emails max 10", fields: { emails: true } };
  }

  if (phones.length > 10) {
    return { ok: false, message: "Phones max 10", fields: { phones: true } };
  }

  // ✅ ONLY ONE source required
  if (!Array.isArray(sources) || sources.length < 1) {
    return {
      ok: false,
      message: "At least one source link is required",
      fields: { sources: true }
    };
  }

  // validate source URLs
  for (let i = 0; i < sources.length; i++) {
    if (!sources[i].name) {
      return {
        ok: false,
        message: "Source name is required",
        fields: { sources: true }
      };
    }

    if (!common.isValidUrl(sources[i].link)) {
      return {
        ok: false,
        message: "Invalid source link URL",
        fields: { sources: true }
      };
    }
  }

  // normalize & validate emails
  const emailsNormalized = [];
  const emailLocalParts = [];

  for (let i = 0; i < emails.length; i++) {
    const eNorm = normalize.normalizeEmail(emails[i]);

    if (!normalize.isValidEmail(eNorm)) {
      return {
        ok: false,
        message: "Invalid email: " + emails[i],
        fields: { emails: true }
      };
    }

    emailsNormalized.push(eNorm);

    const local = normalize.emailLocalPart(eNorm);
    if (local) emailLocalParts.push(local);
  }

  // normalize & validate phones
  const phonesNormalized = [];

  for (let i = 0; i < phones.length; i++) {
    const pNorm = normalize.normalizePhone(phones[i]);

    if (!pNorm) {
      return {
        ok: false,
        message: "Invalid phone: " + phones[i],
        fields: { phones: true }
      };
    }

    phonesNormalized.push(pNorm);
  }

  return {
    ok: true,
    data: {
      name: name,
      location: location,
      emails: emails,
      phones: phones,
      sources: sources,
      emailsNormalized: emailsNormalized,
      emailLocalParts: emailLocalParts,
      phonesNormalized: phonesNormalized
    }
  };
}

module.exports = {
  validateDataMinorLead: validateDataMinorLead
};
