function safeString(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function uniqueStrings(list) {
  let arr = Array.isArray(list) ? list : [];
  let set = new Set();
  let out = [];

  for (let i = 0; i < arr.length; i++) {
    let v = safeString(arr[i]);
    if (!v) continue;
    if (set.has(v)) continue;
    set.add(v);
    out.push(v);
  }
  return out;
}

function isValidUrl(url) {
  try {
    let u = new URL(safeString(url));
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
