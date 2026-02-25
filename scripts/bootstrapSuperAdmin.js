let bcrypt = require("bcryptjs");
let User = require("../models/User");

function getSaltRounds() {
  let rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10);
  if (!rounds || isNaN(rounds)) return 10;
  if (rounds < 8) return 10;
  if (rounds > 14) return 12;
  return rounds;
}

module.exports = async function bootstrapSuperAdmin() {
  let email = process.env.SUPER_ADMIN_EMAIL;
  let password = process.env.SUPER_ADMIN_PASSWORD;
  let name = process.env.SUPER_ADMIN_NAME || "Initial Super Admin";

  if (!email || !password) {
    console.log("SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD missing. Skipping bootstrap.");
    return;
  }

  // if any Super Admin already exists, do nothing
  let existingSuper = await User.findOne({ role: "Super Admin", status: "APPROVED" }).select("_id");
  if (existingSuper) {
    console.log("Super admin already exists. Skipping bootstrap.");
    return;
  }

  // if user exists with same email, promote it
  let existingEmail = await User.findOne({ email: String(email).toLowerCase() });
  if (existingEmail) {
    existingEmail.role = "Super Admin";
    existingEmail.status = "APPROVED";
    existingEmail.approvedAt = new Date();
    await existingEmail.save();
    console.log("Existing user promoted to Super Admin:", email);
    return;
  }

  let passwordHash = await bcrypt.hash(String(password), getSaltRounds());

  await User.create({
    name: name,
    email: String(email).toLowerCase(),
    sex: "male",
    role: "Super Admin",
    status: "APPROVED",
    passwordHash: passwordHash,
    profileImage: { url: "", publicId: "" }
  });

  console.log("Bootstrap Super Admin created:", email);
};
