/*
  One-time script to seed initial admin claim.

  Usage (PowerShell):
    cd functions
    npm install

    # Option A: Use a service account key JSON
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"
    node scripts/set-initial-admin.js --uid 8t1nm4T321WrDDdQ0R7S8xKYhpv1

  Notes:
  - Generate the service account key in Google Cloud Console (Project Settings > Service Accounts).
  - Keep the JSON private (do NOT commit it).
*/

const admin = require('firebase-admin');

function getArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return null;
    return process.argv[idx + 1] || null;
}

async function main() {
    const uid = String(getArg('--uid') || '').trim();
    if (!uid) {
        console.error('Missing --uid');
        process.exit(1);
    }

    admin.initializeApp({ credential: admin.credential.applicationDefault() });

    const claims = {
        role: 'admin',
        tier: 'admin',
        premium: false,
        admin: true,
        tester: false
    };

    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`Seeded admin claims for uid=${uid}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
