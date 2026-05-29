/* Account page behavior (Firebase Auth) */
document.addEventListener('DOMContentLoaded', function () {
    const emailEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-email'));
    const passEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-password'));
    const statusEl = document.getElementById('pv-auth-status');
    const selfCheckEl = document.getElementById('pv-auth-selfcheck');
    const roleEl = document.getElementById('pv-auth-role');
    const uidEl = document.getElementById('pv-auth-uid');
    const formStatusEl = document.getElementById('pv-auth-form-status');
    const formSelfCheckEl = document.getElementById('pv-auth-form-selfcheck');
    const signInCardEl = document.getElementById('pv-auth-signin-card');
    const sessionCardEl = document.getElementById('pv-auth-session-card');
    const heroBadgeEl = document.getElementById('pv-auth-hero-badge');
    const profileEl = document.getElementById('pv-auth-profile');
    const profileAvatarEl = /** @type {HTMLImageElement} */ (document.getElementById('pv-auth-avatar'));
    const profileAvatarFallbackEl = document.getElementById('pv-auth-avatar-fallback');
    const profileNameEl = document.getElementById('pv-auth-displayname');
    const profileEmailEl = document.getElementById('pv-auth-email-display');
    const sensitiveRevealTimers = new WeakMap();

    const adminDivider = document.getElementById('pv-admin-panel');
    const adminTools = document.getElementById('pv-admin-tools');
    const adminUidEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-admin-uid'));
    const adminRoleEl = /** @type {HTMLSelectElement} */ (document.getElementById('pv-admin-role'));
    const adminSetRoleBtn = document.getElementById('pv-admin-set-role');
    const adminFillSelfBtn = document.getElementById('pv-admin-fill-self');
    const adminStatusEl = document.getElementById('pv-admin-status');

    const billingPanelEl = document.getElementById('pv-billing-panel');
    const billingStatusEl = document.getElementById('pv-billing-status');
    const billingSubscribeBtn = document.getElementById('pv-billing-subscribe');
    const billingManageBtn = document.getElementById('pv-billing-manage');

    const signInBtn = document.getElementById('pv-auth-signin');
    const signUpBtn = document.getElementById('pv-auth-signup');
    const googleBtn = document.getElementById('pv-auth-google');
    const signOutBtn = document.getElementById('pv-auth-signout');
    const deleteBtn = document.getElementById('pv-auth-delete');

    // Temporary diagnostics helper for startup/auth setup issues.
    const ENABLE_AUTH_SELF_CHECK = true;

    function setStatus(msg) {
        const text = String(msg || '');
        if (statusEl) statusEl.textContent = text;
        if (formStatusEl) formStatusEl.textContent = text;
    }

    function setSelfCheck(msg) {
        if (!ENABLE_AUTH_SELF_CHECK || !selfCheckEl) return;
        const text = String(msg || '').trim();
        selfCheckEl.hidden = text.length === 0;
        selfCheckEl.textContent = text;
        if (formSelfCheckEl) {
            formSelfCheckEl.hidden = text.length === 0;
            formSelfCheckEl.textContent = text;
        }
    }

    function clearSelfCheck() {
        if (!selfCheckEl) return;
        selfCheckEl.hidden = true;
        selfCheckEl.textContent = '';
        if (formSelfCheckEl) {
            formSelfCheckEl.hidden = true;
            formSelfCheckEl.textContent = '';
        }
    }

    function setAuthViewMode(isSignedIn) {
        const signedIn = !!isSignedIn;
        if (signInCardEl) signInCardEl.hidden = signedIn;
        if (sessionCardEl) sessionCardEl.hidden = !signedIn;
        if (heroBadgeEl) heroBadgeEl.hidden = !signedIn;
    }

    function setRoleText(msg) {
        if (roleEl) roleEl.textContent = String(msg || '');
    }

    function setUidText(msg) {
        if (uidEl) uidEl.textContent = String(msg || '');
    }

    function revealSensitiveValue(el) {
        if (!(el instanceof HTMLElement)) return;

        el.classList.add('is-revealed');
        const existingTimer = sensitiveRevealTimers.get(el);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }

        const timer = window.setTimeout(() => {
            el.classList.remove('is-revealed');
            sensitiveRevealTimers.delete(el);
        }, 4500);

        sensitiveRevealTimers.set(el, timer);
    }

    function setupSensitiveTapReveal() {
        const hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
        if (hasHover) return;

        const sensitiveNodes = document.querySelectorAll('.pv-sensitiveValue');
        sensitiveNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;

            node.addEventListener('click', () => revealSensitiveValue(node));
            node.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    revealSensitiveValue(node);
                }
            });
        });
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

    function setBillingVisible(isVisible) {
        if (!billingPanelEl) return;
        billingPanelEl.hidden = !isVisible;
        if (!isVisible && billingStatusEl) billingStatusEl.textContent = '';
    }

    function setBillingStatus(msg) {
        if (!billingStatusEl) return;
        billingStatusEl.textContent = String(msg || '');
    }

    function setBillingButtonsDisabled(disabled) {
        const isDisabled = !!disabled;
        if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.disabled = isDisabled;
        if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = isDisabled;
    }

    function buildAccountUrlWithQuery(name, value) {
        const next = new URL(window.location.href);
        next.searchParams.set(String(name || ''), String(value || ''));
        return next.href;
    }

    function getStripeStatusMessage(result) {
        const status = String(result?.subscriptionStatus || 'none').toLowerCase();
        const entitled = Boolean(result?.premiumEntitled);
        const role = String(result?.role || '').toLowerCase();

        if (role === 'admin') return 'Admin account: subscription changes do not overwrite admin access.';
        if (role === 'tester') return 'Tester account: subscription changes do not overwrite tester access.';

        if (!result?.hasSubscription) return 'No active subscription. Subscribe to enable premium.';

        if (entitled) {
            if (status === 'trialing') return 'Premium trial active.';
            if (status === 'past_due') return 'Premium active (payment update needed soon).';
            return 'Premium subscription active.';
        }

        if (status === 'canceled') return 'Subscription canceled. Premium access is not active.';
        if (status === 'unpaid' || status === 'incomplete') return 'Subscription requires payment action. Premium access is paused.';
        return `Subscription status: ${status}.`;
    }

    async function refreshBillingStatus() {
        if (!window?.PV_AUTH?.callFunction) {
            setBillingStatus('Billing tools unavailable: Firebase Functions not configured.');
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = true;
            return;
        }

        setBillingButtonsDisabled(true);
        setBillingStatus('Checking subscription status...');

        try {
            const result = await window.PV_AUTH.callFunction('getStripeSubscriptionStatus', {});
            setBillingStatus(getStripeStatusMessage(result));

            const entitled = Boolean(result?.premiumEntitled);
            if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.hidden = entitled;
            if (billingManageBtn instanceof HTMLButtonElement) {
                billingManageBtn.disabled = !result?.customerId;
            }
        } catch (error) {
            const message = String(error?.message || 'Could not load subscription status.');
            setBillingStatus(message);
            if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.hidden = false;
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = true;
        } finally {
            if (billingSubscribeBtn instanceof HTMLButtonElement && !billingSubscribeBtn.hidden) {
                billingSubscribeBtn.disabled = false;
            }
        }
    }

    async function runBilling(action) {
        try {
            setBillingButtonsDisabled(true);
            await action();
        } catch (error) {
            const message = String(error?.message || 'Billing action failed.');
            setBillingStatus(message);
            if (billingSubscribeBtn instanceof HTMLButtonElement && !billingSubscribeBtn.hidden) {
                billingSubscribeBtn.disabled = false;
            }
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = false;
        }
    }

    function applyCheckoutStatusFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const checkoutState = String(params.get('checkout') || '').toLowerCase();
        if (checkoutState === 'success') {
            setBillingStatus('Checkout completed. Confirming subscription status...');
        } else if (checkoutState === 'cancelled') {
            setBillingStatus('Checkout canceled. You can subscribe any time.');
        }
    }

    function getProfileInitials(displayName, email) {
        const sourceRaw = String(displayName || email || '').trim();
        const source = sourceRaw.includes('@') ? sourceRaw.split('@')[0] : sourceRaw;
        const cleaned = source.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim();
        if (!cleaned) return 'U';
        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
    }

    function setProfileSignedOut() {
        if (profileEl) profileEl.hidden = true;
        if (profileNameEl) profileNameEl.textContent = 'PokeValutor user';
        if (profileEmailEl) profileEmailEl.textContent = '';

        if (profileAvatarEl instanceof HTMLImageElement) {
            profileAvatarEl.hidden = true;
            profileAvatarEl.src = '';
            profileAvatarEl.alt = '';
        }

        if (profileAvatarFallbackEl) {
            profileAvatarFallbackEl.hidden = false;
            profileAvatarFallbackEl.textContent = 'U';
        }
    }

    function setProfileSignedIn(user) {
        if (!profileEl) return;

        const displayNameRaw = String(user?.displayName || '').trim();
        const email = String(user?.email || '').trim();
        const displayName = displayNameRaw || (email ? email.split('@')[0] : 'PokeValutor user');
        const photoURL = String(user?.photoURL || '').trim();

        if (profileNameEl) profileNameEl.textContent = displayName;
        if (profileEmailEl) profileEmailEl.textContent = email || 'No email on account';

        if (photoURL && profileAvatarEl instanceof HTMLImageElement) {
            profileAvatarEl.src = photoURL;
            profileAvatarEl.alt = `${displayName} profile photo`;
            profileAvatarEl.hidden = false;
            if (profileAvatarFallbackEl) profileAvatarFallbackEl.hidden = true;
        } else {
            if (profileAvatarEl instanceof HTMLImageElement) {
                profileAvatarEl.hidden = true;
                profileAvatarEl.src = '';
                profileAvatarEl.alt = '';
            }

            if (profileAvatarFallbackEl) {
                profileAvatarFallbackEl.hidden = false;
                profileAvatarFallbackEl.textContent = getProfileInitials(displayName, email);
            }
        }

        profileEl.hidden = false;
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

    function applyLocalDevTestCredentials() {
        const host = String(window.location.hostname || '').trim().toLowerCase();
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (!isLocalHost) return;

        const secretEmail = String(window?.PV_SECRETS?.PV_TEST_AUTH_EMAIL || '').trim();
        const secretPassword = String(window?.PV_SECRETS?.PV_TEST_AUTH_PASSWORD || '');

        if (secretEmail && emailEl && !String(emailEl.value || '').trim()) {
            emailEl.value = secretEmail;
        }

        if (secretPassword && passEl && !String(passEl.value || '')) {
            passEl.value = secretPassword;
        }
    }

    function getAuthTroubleshootMessage(error) {
        if (!ENABLE_AUTH_SELF_CHECK) return '';
        const code = String(error?.code || '').trim().toLowerCase();
        if (!code) return '';

        if (code === 'auth/operation-not-allowed') {
            return 'Setup check: Enable Email/Password in Firebase Console -> Authentication -> Sign-in method.';
        }

        if (code === 'auth/app-not-authorized' || code === 'auth/unauthorized-domain') {
            return 'Setup check: Add this host to Firebase Auth authorized domains, then retry sign-in.';
        }

        if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') {
            return 'Setup check: Firebase web config appears invalid. Verify apiKey/authDomain/projectId/appId values.';
        }

        if (code === 'auth/network-request-failed') {
            return 'Setup check: Network/CSP blocked Firebase. Confirm internet access and CSP allows gstatic/googleapis.';
        }

        if (code === 'auth/internal-error') {
            return 'Setup check: Google auth popup failed. Verify Firebase authorized domains, allow apis.google.com in CSP script-src, and retry.';
        }

        return '';
    }

    function getDeleteAccountErrorMessage(error) {
        const code = String(error?.code || '').trim().toLowerCase();
        if (!code) return '';

        if (code === 'auth/requires-recent-login' || code === 'auth/user-token-expired') {
            return 'For security, please sign in again and retry account deletion.';
        }

        if (code === 'auth/network-request-failed') {
            return 'Network request failed while deleting the account. Check your connection and retry.';
        }

        if (code === 'auth/popup-blocked' || code === 'auth/internal-error') {
            return 'Re-authentication was blocked by the browser. Sign out, sign in again, then retry deletion.';
        }

        return '';
    }

    function runStartupChecks() {
        if (!ENABLE_AUTH_SELF_CHECK) return;

        if (window.location.protocol === 'file:') {
            setSelfCheck('Setup check: Open this site via http://localhost (not file://) so Firebase Auth can run correctly.');
            return;
        }

        const config = window.PV_FIREBASE_CONFIG;
        const hasPlaceholderKey = String(config?.apiKey || '').trim() === 'YOUR_API_KEY';
        if (!config || !config.apiKey || hasPlaceholderKey) {
            setSelfCheck('Setup check: Firebase config is missing or placeholder. Use firebase-config.local.js (local) or GitHub Secrets (Pages).');
            return;
        }

        if (!window.firebase || !window.firebase.auth) {
            setSelfCheck('Setup check: Firebase SDK not loaded. Verify script tags and CSP script-src for www.gstatic.com.');
            return;
        }

        clearSelfCheck();
    }

    async function run(action) {
        try {
            setStatus('Working…');
            await action();
            clearSelfCheck();
        } catch (e) {
            const message = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : 'Something went wrong.';
            setStatus(message);
            const troubleshoot = getAuthTroubleshootMessage(e);
            if (troubleshoot) setSelfCheck(troubleshoot);
        }
    }

    runStartupChecks();
    applyLocalDevTestCredentials();
    setupSensitiveTapReveal();

    setAuthViewMode(false);

    if (!window.PV_AUTH || !window.PV_AUTH.onAuthStateChanged) {
        setStatus('Firebase not loaded. Check CSP + firebase-config.js');
        setSelfCheck('Setup check: firebase.js did not initialize. Confirm valid config and Firebase scripts are loading.');
        setProfileSignedOut();
        return;
    }

    window.PV_AUTH.onAuthStateChanged((user) => {
        if (!user) {
            setAuthViewMode(false);
            setStatus('Signed out');
            setRoleText('');
            setUidText('');
            setAdminVisible(false);
            setBillingVisible(false);
            setProfileSignedOut();
            if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = true;
            return;
        }
        const uid = String(user.uid || '');

        setAuthViewMode(true);
        setProfileSignedIn(user);
        setStatus('Signed in');
        clearSelfCheck();
        if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = false;
        setBillingVisible(true);
        applyCheckoutStatusFromUrl();
        refreshBillingStatus();

        // Fetch/refresh custom claims for role display + admin gating.
        Promise.resolve(window.PV_AUTH.getIdTokenResult ? window.PV_AUTH.getIdTokenResult(true) : null)
            .then((tokenResult) => {
                const claims = tokenResult?.claims || null;
                const role = normalizeRoleFromClaims(claims);
                setRoleText(`Role: ${role}`);
                setUidText(uid);
                setAdminVisible(role === 'admin');
            })
            .catch(() => {
                setRoleText('Role: unknown');
                setUidText(uid);
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
                setUidText('');
                setAdminVisible(false);
                setProfileSignedOut();
            });
        });
    }

    if (deleteBtn) {
        if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = true;

        deleteBtn.addEventListener('click', () => {
            run(async () => {
                if (!window?.PV_AUTH?.deleteAccount) {
                    throw new Error('Account deletion is not configured.');
                }

                const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
                if (!user) throw new Error('Sign in before deleting your account.');

                const confirmStep1 = window.confirm('Delete your account? This cannot be undone.');
                if (!confirmStep1) {
                    setStatus('Account deletion canceled.');
                    return;
                }

                const confirmText = window.prompt('Type DELETE to confirm account deletion.');
                if (String(confirmText || '').trim().toUpperCase() !== 'DELETE') {
                    setStatus('Account deletion canceled (confirmation text did not match).');
                    return;
                }

                try {
                    await window.PV_AUTH.deleteAccount({ deleteFirestoreData: true });
                    setStatus('Account deleted. Synced account data deletion was attempted.');
                    setRoleText('');
                    setUidText('');
                    setAdminVisible(false);
                    setProfileSignedOut();
                } catch (error) {
                    const msg = getDeleteAccountErrorMessage(error);
                    if (msg) {
                        throw new Error(msg);
                    }
                    throw error;
                }
            });
        });
    }

    if (billingSubscribeBtn) {
        billingSubscribeBtn.addEventListener('click', () => {
            runBilling(async () => {
                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Stripe checkout is unavailable (Firebase Functions missing).');
                }

                setBillingStatus('Opening Stripe checkout...');

                const successUrl = buildAccountUrlWithQuery('checkout', 'success');
                const cancelUrl = buildAccountUrlWithQuery('checkout', 'cancelled');
                const result = await window.PV_AUTH.callFunction('createStripeCheckoutSession', { successUrl, cancelUrl });
                const checkoutUrl = String(result?.url || '').trim();
                if (!checkoutUrl) throw new Error('Stripe checkout session did not return a URL.');

                window.location.assign(checkoutUrl);
            });
        });
    }

    if (billingManageBtn) {
        billingManageBtn.addEventListener('click', () => {
            runBilling(async () => {
                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Stripe billing portal is unavailable (Firebase Functions missing).');
                }

                setBillingStatus('Opening billing portal...');

                const returnUrl = buildAccountUrlWithQuery('checkout', 'portal-return');
                const result = await window.PV_AUTH.callFunction('createStripePortalSession', { returnUrl });
                const portalUrl = String(result?.url || '').trim();
                if (!portalUrl) throw new Error('Stripe billing portal session did not return a URL.');

                window.location.assign(portalUrl);
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
