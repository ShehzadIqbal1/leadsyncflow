let normalize = require("../utils/normalize");
let common = require("./commonValidator");

function cleanSources(sources) {
  let arr = Array.isArray(sources) ? sources : [];
  let out = [];

  for (let i = 0; i < arr.length; i++) {
    let s = arr[i] || {};
    let name = common.safeString(s.name);
    let link = common.safeString(s.link);

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
  let name = common.safeString(body && body.name);
  let location = common.safeString(body && body.location); // optional
  let emails = common.uniqueStrings(body && body.emails);
  let phones = common.uniqueStrings(body && body.phones);
  let sources = cleanSources(body && body.sources);

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
  let emailsNormalized = [];
  let emailLocalParts = [];

  for (let i = 0; i < emails.length; i++) {
    let eNorm = normalize.normalizeEmail(emails[i]);

    if (!normalize.isValidEmail(eNorm)) {
      return {
        ok: false,
        message: "Invalid email: " + emails[i],
        fields: { emails: true }
      };
    }

    emailsNormalized.push(eNorm);

    let local = normalize.emailLocalPart(eNorm);
    if (local) emailLocalParts.push(local);
  }

  // normalize & validate phones
  let phonesNormalized = [];

  for (let i = 0; i < phones.length; i++) {
    let pNorm = normalize.normalizePhone(phones[i]);

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
