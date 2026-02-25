// utils/pktDate.js

const PKT_TIMEZONE = "Asia/Karachi";

// ---------------------------------------------
// Returns current PKT date/time breakdown
// ---------------------------------------------
function getPktDateTime() {
  const now = new Date();

  return {
    now,
    pktDate: now.toLocaleDateString("en-CA", {
      timeZone: PKT_TIMEZONE,
    }),
    pktTime: now.toLocaleTimeString("en-GB", {
      timeZone: PKT_TIMEZONE,
      hour12: false,
    }),
  };
}

// ---------------------------------------------
// Build PKT range from today / from / to
// Returns: { $gte, $lte } OR null
// ---------------------------------------------
function buildPktRange({ today, from, to }) {
  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function pktStart(dateStr) {
    return new Date(dateStr + "T00:00:00.000+05:00");
  }

  function pktEnd(dateStr) {
    return new Date(dateStr + "T23:59:59.999+05:00");
  }

  let range = null;

  if (today === "true" || today === "1") {
    const now = new Date();
    const pktDate = now.toLocaleDateString("en-CA", {
      timeZone: PKT_TIMEZONE,
    });

    range = {
      $gte: pktStart(pktDate),
      $lte: pktEnd(pktDate),
    };
  } else {
    if (from && !isYmd(from)) {
      throw new Error("INVALID_FROM_DATE");
    }

    if (to && !isYmd(to)) {
      throw new Error("INVALID_TO_DATE");
    }

    if (from || to) {
      range = {};
      if (from) range.$gte = pktStart(from);
      if (to) range.$lte = pktEnd(to);
    }
  }

  return range;
}

module.exports = {
  getPktDateTime,
  buildPktRange,
};

