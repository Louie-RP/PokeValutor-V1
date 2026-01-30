const admin = require('firebase-admin');
const functions = require('firebase-functions');

admin.initializeApp();

const ALLOWED_ROLES = new Set(['admin', 'tester', 'premium', 'basic']);

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function isCallerAdmin(context) {
    const token = context?.auth?.token;
    if (!token) return false;
    const role = String(token.role || '').toLowerCase();
    if (role === 'admin') return true;
    const adminFlag = token.admin;
    if (adminFlag === true) return true;
    if (typeof adminFlag === 'string' && adminFlag.toLowerCase() === 'true') return true;
    return false;
}

exports.setUserRole = functions.https.onCall(async (data, context) => {
    if (!context?.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    const uid = String(data?.uid || '').trim();
    const role = normalizeRole(data?.role);

    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing uid');
    }
    if (!ALLOWED_ROLES.has(role)) {
        throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const claims = {
        role,
        tier: role, // backward-compatible with existing Worker logic
        premium: role === 'premium',
        admin: role === 'admin',
        tester: role === 'tester'
    };

    await admin.auth().setCustomUserClaims(uid, claims);

    return { ok: true, uid, role };
});
