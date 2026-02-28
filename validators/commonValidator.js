function safeString(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function uniqueStrings(list) {
  const arr = Array.isArray(list) ? list : [];
  const set = new Set();
  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const v = safeString(arr[i]);
    if (!v) continue;
    if (set.has(v)) continue;
    set.add(v);
    out.push(v);
  }
  return out;
}

function isValidUrl(url) {
  try {
    const u = new URL(safeString(url));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (e) {
    return false;
  }
}

module.exports = {
  safeString: safeString,
  uniqueStrings: uniqueStrings,
  isValidUrl: isValidUrl
};
