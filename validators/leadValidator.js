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

function validateDataMinorLead(body) {
  let name = common.safeString(body && body.name);
  let location = common.safeString(body && body.location); // ✅ optional
  let emails = common.uniqueStrings(body && body.emails);
  let phones = common.uniqueStrings(body && body.phones);
  let sources = cleanSources(body && body.sources);

  if (!name) {
    return { ok: false, message: "Name is required", fields: { name: true } };
  }

  // at least one email OR phone
  if (emails.length === 0 && phones.length === 0) {
    return {
      ok: false,
      message: "At least one email or phone number is required",
      fields: { emails: true, phones: true }
    };
  }

  if (emails.length > 100) {
    return { ok: false, message: "Emails max 100", fields: { emails: true } };
  }

  if (phones.length > 10) {
    return { ok: false, message: "Phones max 10", fields: { phones: true } };
  }

  if (!sources.length) {
    return {
      ok: false,
      message: "At least 1 source link is required",
      fields: { sources: true }
    };
  }

  // validate sources
  for (let i = 0; i < sources.length; i++) {
    if (!common.isValidUrl(sources[i].link)) {
      return {
        ok: false,
        message: "Invalid source link URL",
        fields: { sources: true }
      };
    }
  }

  // emails
  let emailsNorm = [];
  let emailLocals = [];

  for (let i = 0; i < emails.length; i++) {
    let eNorm = normalize.normalizeEmail(emails[i]);
    if (!normalize.isValidEmail(eNorm)) {
      return {
        ok: false,
        message: "Invalid email: " + emails[i],
        fields: { emails: true }
      };
    }
    emailsNorm.push(eNorm);
    let local = normalize.emailLocalPart(eNorm);
    if (local) emailLocals.push(local);
  }

  // phones
  let phonesNorm = [];
  for (let i = 0; i < phones.length; i++) {
    let pNorm = normalize.normalizePhone(phones[i]);
    if (!pNorm) {
      return {
        ok: false,
        message: "Invalid phone: " + phones[i],
        fields: { phones: true }
      };
    }
    phonesNorm.push(pNorm);
  }

  return {
    ok: true,
    data: {
      name: name,
      location: location,
      emails: emails,
      phones: phones,
      sources: sources,
      emailsNormalized: emailsNorm,
      emailLocalParts: emailLocals,
      phonesNormalized: phonesNorm
    }
  };
}

module.exports = {
  validateDataMinorLead: validateDataMinorLead
};
