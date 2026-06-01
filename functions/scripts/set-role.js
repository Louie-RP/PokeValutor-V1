/*
  Utility script to set any role by UID.

  Usage:
    cd functions
    npm install
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
    node scripts/set-role.js --uid <UID> --role <admin|tester|premium|basic>
*/

const admin = require('firebase-admin');

const ALLOWED = new Set(['admin', 'tester', 'premium', 'basic']);

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const uid = String(getArg('--uid') || '').trim();
  const role = String(getArg('--role') || '').trim().toLowerCase();

  if (!uid) {
    console.error('Missing --uid');
    process.exit(1);
  }
  if (!ALLOWED.has(role)) {
    console.error(`Invalid --role. Expected one of: ${Array.from(ALLOWED).join(', ')}`);
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.applicationDefault() });

  const claims = {
    role,
    tier: role,
    premium: role === 'premium',
    admin: role === 'admin',
    tester: role === 'tester'
  };

  await admin.auth().setCustomUserClaims(uid, claims);
  console.log(`Set role=${role} for uid=${uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
