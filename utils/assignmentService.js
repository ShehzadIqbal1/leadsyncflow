let Counter = require("../models/Counter");
let User = require("../models/User");

async function getNextLeadQualifier() {
  // 1. Fetch Lead Qualifiers and SORT them by _id to ensure a consistent sequence
  let lqs = await User.find({ 
    role: "Lead Qualifiers", 
    status: "APPROVED" 
  })
  .select("_id")
  .sort({ _id: 1 }); // Added sorting here for a stable Round-Robin circle

  if (!lqs || lqs.length === 0) return null;

  // 2. Atomic increment of the counter
  // This ensures that even if 10 verifiers click at once, each gets a unique sequence number
  let counter = await Counter.findOneAndUpdate(
    { key: "LQ_ASSIGN" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  // 3. Use Modulo to pick the next user in the sorted list
  let index = counter.seq % lqs.length;
  
  return lqs[index]; // Returns the User object containing the _id
}

module.exports = {
  getNextLeadQualifier: getNextLeadQualifier
};