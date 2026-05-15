/**
 * Drops the entire MongoDB database pointed to by MONGO_URI (or MONGODB_URI).
 * All collections and data are removed. Indexes are recreated on next app write.
 *
 * Usage (from backend/):
 *   node scripts/clearDatabase.js --confirm
 *
 *   On Windows, `npm run db:clear -- --confirm` may not forward args; use either:
 *     node scripts/clearDatabase.js --confirm
 *     set WIPE_CONFIRM=YES&& npm run db:clear   (cmd)
 *     $env:WIPE_CONFIRM='YES'; npm run db:clear (PowerShell)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

async function main() {
  const confirmed =
    process.argv.includes("--confirm") || String(process.env.WIPE_CONFIRM || "").toUpperCase() === "YES";
  if (!confirmed) {
    console.error(
      "Refusing to wipe: pass --confirm or set WIPE_CONFIRM=YES (deletes every document in the target database).",
    );
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGO_URI or MONGODB_URI in backend/.env");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  const dbName = mongoose.connection.db?.databaseName;
  if (!dbName) {
    console.error("Could not resolve database name after connect.");
    process.exit(1);
  }

  console.log(`Dropping database "${dbName}" …`);
  await mongoose.connection.dropDatabase();
  console.log("Done. Database is empty.");
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
