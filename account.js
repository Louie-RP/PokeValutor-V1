/* Account page behavior (Firebase Auth) */
document.addEventListener('DOMContentLoaded', function () {
    const emailEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-email'));
    const passEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-password'));
    const statusEl = document.getElementById('pv-auth-status');
    const roleEl = document.getElementById('pv-auth-role');

    const adminDivider = document.getElementById('pv-admin-panel');
    const adminTools = document.getElementById('pv-admin-tools');
    const adminUidEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-admin-uid'));
    const adminRoleEl = /** @type {HTMLSelectElement} */ (document.getElementById('pv-admin-role'));
    const adminSetRoleBtn = document.getElementById('pv-admin-set-role');
    const adminFillSelfBtn = document.getElementById('pv-admin-fill-self');
    const adminStatusEl = document.getElementById('pv-admin-status');

    const signInBtn = document.getElementById('pv-auth-signin');
    const signUpBtn = document.getElementById('pv-auth-signup');
    const googleBtn = document.getElementById('pv-auth-google');
    const signOutBtn = document.getElementById('pv-auth-signout');

    function setStatus(msg) {
        if (statusEl) statusEl.textContent = String(msg || '');
    }

    function setRoleText(msg) {
        if (roleEl) roleEl.textContent = String(msg || '');
    }

    function setAdminStatus(msg) {
        if (adminStatusEl) adminStatusEl.textContent = String(msg || '');
    }

    function setAdminVisible(isVisible) {
        const show = !!isVisible;
        if (adminDivider) adminDivider.hidden = !show;
        if (adminTools) adminTools.hidden = !show;
        if (!show) setAdminStatus('');
    }

    function normalizeRoleFromClaims(claims) {
        const role = String(claims?.role || claims?.tier || '').trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic') return role;
        if (claims?.admin === true) return 'admin';
        if (claims?.tester === true) return 'tester';
        if (claims?.premium === true) return 'premium';
        return 'basic';
    }

    function getCreds() {
        const email = String(emailEl?.value || '').trim();
        const password = String(passEl?.value || '');
        return { email, password };
    }

    async function run(action) {
        try {
            setStatus('Working…');
            await action();
        } catch (e) {
            const message = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : 'Something went wrong.';
            setStatus(message);
        }
    }

    if (!window.PV_AUTH || !window.PV_AUTH.onAuthStateChanged) {
        setStatus('Firebase not loaded. Check CSP + firebase-config.js');
        return;
    }

    window.PV_AUTH.onAuthStateChanged((user) => {
        if (!user) {
            setStatus('Signed out');
            setRoleText('');
            setAdminVisible(false);
            return;
        }
        const email = String(user.email || '');
        const uid = String(user.uid || '');

        setStatus(`Signed in as ${email || 'user'} (${uid.slice(0, 8)}…)`);

        // Fetch/refresh custom claims for role display + admin gating.
        Promise.resolve(window.PV_AUTH.getIdTokenResult ? window.PV_AUTH.getIdTokenResult(true) : null)
            .then((tokenResult) => {
                const claims = tokenResult?.claims || null;
                const role = normalizeRoleFromClaims(claims);
                setRoleText(`Role: ${role} • UID: ${uid}`);
                setAdminVisible(role === 'admin');
            })
            .catch(() => {
                setRoleText(`Role: unknown • UID: ${uid}`);
                setAdminVisible(false);
            });
    });

    if (signInBtn) {
        signInBtn.addEventListener('click', () => {
            run(async () => {
                const { email, password } = getCreds();
                if (!email || !password) throw new Error('Enter email + password.');
                await window.PV_AUTH.signInWithEmail(email, password);
                setStatus('Signed in.');
            });
        });
    }

    if (signUpBtn) {
        signUpBtn.addEventListener('click', () => {
            run(async () => {
                const { email, password } = getCreds();
                if (!email || !password) throw new Error('Enter email + password.');
                if (password.length < 6) throw new Error('Password must be at least 6 characters.');
                await window.PV_AUTH.signUpWithEmail(email, password);
                setStatus('Account created and signed in.');
            });
        });
    }

    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            run(async () => {
                await window.PV_AUTH.signInWithGoogle();
                setStatus('Signed in with Google.');
            });
        });
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            run(async () => {
                await window.PV_AUTH.signOut();
                setStatus('Signed out');
                setRoleText('');
                setAdminVisible(false);
            });
        });
    }

    if (adminFillSelfBtn) {
        adminFillSelfBtn.addEventListener('click', () => {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) return;
            if (adminUidEl) adminUidEl.value = String(user.uid || '');
        });
    }

    if (adminSetRoleBtn) {
        adminSetRoleBtn.addEventListener('click', () => {
            run(async () => {
                setAdminStatus('Working…');
                const targetUid = String(adminUidEl?.value || '').trim();
                const role = String(adminRoleEl?.value || '').trim().toLowerCase();
                if (!targetUid) throw new Error('Enter a target UID.');
                if (!role) throw new Error('Choose a role.');

                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Role assignment not configured (Firebase Functions missing).');
                }

                const result = await window.PV_AUTH.callFunction('setUserRole', { uid: targetUid, role });
                setAdminStatus(`Role updated: ${String(result?.uid || targetUid).slice(0, 8)}… → ${role}`);
            });
        });
    }
});
