/* Pricing page behavior (auth-aware Stripe CTAs) */
document.addEventListener('DOMContentLoaded', function () {
    const primaryCtas = Array.from(document.querySelectorAll('[data-pricing-primary-cta]'))
        .filter((el) => el instanceof HTMLButtonElement);
    const statusEls = Array.from(document.querySelectorAll('[data-pricing-status]'));
    const freeBadgeEl = document.getElementById('pv-pricing-free-badge');
    const proBadgeEl = document.getElementById('pv-pricing-pro-badge');
    let previewPlan = '';

    function setStatus(msg) {
        const text = String(msg || '');
        for (const el of statusEls) {
            if (el) el.textContent = text;
        }
    }

    function setPrimaryCtas(label, action, disabled) {
        const text = String(label || 'Open account');
        const nextAction = String(action || 'account');
        const isDisabled = !!disabled;

        for (const btn of primaryCtas) {
            btn.textContent = text;
            btn.dataset.pricingAction = nextAction;
            btn.disabled = isDisabled;
        }
    }

    function setPlanBadges(isSignedIn, isPremium) {
        if (freeBadgeEl) {
            freeBadgeEl.textContent = (isSignedIn && !isPremium) ? 'Current plan' : 'Included';
        }

        if (proBadgeEl) {
            proBadgeEl.textContent = (isSignedIn && isPremium) ? 'Current plan' : 'Limited time';
        }
    }

    function normalizeRoleFromClaims(claims) {
        const role = String(claims?.role || claims?.tier || '').trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic') return role;
        if (claims?.admin === true) return 'admin';
        if (claims?.tester === true) return 'tester';
        if (claims?.premium === true) return 'premium';
        return 'basic';
    }

    function isPremiumRole(role) {
        const normalized = String(role || '').trim().toLowerCase();
        return normalized === 'admin' || normalized === 'tester' || normalized === 'premium';
    }

    async function readRoleFromClaims(forceRefresh) {
        const authApi = window?.PV_AUTH;
        if (!authApi || typeof authApi.getIdTokenResult !== 'function') return 'basic';

        try {
            const tokenResult = await authApi.getIdTokenResult(Boolean(forceRefresh));
            return normalizeRoleFromClaims(tokenResult?.claims || {});
        } catch {
            return 'basic';
        }
    }

    function buildPageUrl(pageName) {
        return new URL(String(pageName || ''), window.location.href);
    }

    function buildPricingUrlWithQuery(key, value) {
        const url = buildPageUrl('pricing.html');
        url.searchParams.set(String(key || ''), String(value || ''));
        return url.toString();
    }

    function buildAccountUrl() {
        return buildPageUrl('account.html').toString();
    }

    function getPreviewPlanFromUrl() {
        const isLocalPreview = window.location.protocol === 'file:'
            || window.location.hostname === 'localhost'
            || window.location.hostname === '127.0.0.1';
        if (!isLocalPreview) return '';

        const params = new URLSearchParams(window.location.search);
        const value = String(params.get('pv_preview_plan') || '').trim().toLowerCase();
        if (value === 'signedout' || value === 'basic' || value === 'premium') return value;
        return '';
    }

    function applyPreviewPlanState(value) {
        const mode = String(value || '').toLowerCase();

        if (mode === 'signedout') {
            setPlanBadges(false, false);
            setPrimaryCtas('Sign in to upgrade', 'signin', false);
            setStatus('Preview mode: signed-out visitor view.');
            return;
        }

        if (mode === 'basic') {
            setPlanBadges(true, false);
            setPrimaryCtas('Upgrade to Premium', 'subscribe', false);
            setStatus('Preview mode: signed-in Free plan view.');
            return;
        }

        if (mode === 'premium') {
            setPlanBadges(true, true);
            setPrimaryCtas('Manage billing', 'manage', false);
            setStatus('Preview mode: signed-in Premium plan view.');
        }
    }

    function getStripeStatusMessage(result) {
        const role = String(result?.role || 'basic').toLowerCase();
        const status = String(result?.subscriptionStatus || 'none').toLowerCase();

        if (role === 'admin') return 'Admin account detected. Billing does not change admin access.';
        if (role === 'tester') return 'Tester account detected. Billing does not change tester access.';
        if (!result?.hasSubscription) return 'No active premium subscription. Upgrade any time.';
        if (result?.premiumEntitled) return 'Premium subscription active.';

        if (status === 'canceled') return 'Subscription canceled. Premium access is not active.';
        if (status === 'unpaid' || status === 'incomplete') {
            return 'Subscription needs payment action. Open billing to resolve.';
        }

        return `Subscription status: ${status}.`;
    }

    function readCheckoutQueryStatus() {
        const params = new URLSearchParams(window.location.search);
        const checkout = String(params.get('checkout') || '').toLowerCase();

        if (checkout === 'success') {
            setStatus('Checkout completed. Confirming subscription status...');
        } else if (checkout === 'cancelled') {
            setStatus('Checkout canceled. You can upgrade any time.');
        } else if (checkout === 'portal-return') {
            setStatus('Returned from billing portal. Refreshing status...');
        }
    }

    function toBillingErrorMessage(error, fallbackMessage) {
        const code = String(error?.code || '').trim().toLowerCase();
        const details = typeof error?.details === 'string' ? error.details.trim() : '';
        const rawMessage = String(error?.message || '').trim();
        const message = details || rawMessage;

        if (code.includes('unauthenticated')) {
            return 'Sign in required. Please sign in again and retry.';
        }

        if (code.includes('failed-precondition')) {
            return message || 'Billing is not configured right now. Please try again shortly.';
        }

        const lowerMessage = message.toLowerCase();
        const looksInternal =
            code.includes('internal')
            || lowerMessage === 'internal'
            || lowerMessage === 'functions/internal'
            || lowerMessage.startsWith('functions/internal ');

        if (looksInternal) {
            return 'Billing is temporarily unavailable. Please try again in a minute.';
        }

        if (message) return message;
        return String(fallbackMessage || 'Billing action failed.');
    }

    async function runBillingAction(actionFn, pendingMessage) {
        setPrimaryCtas('Please wait...', 'none', true);
        setStatus(String(pendingMessage || 'Working...'));

        try {
            await actionFn();
        } catch (error) {
            const message = toBillingErrorMessage(error, 'Billing action failed.');
            setStatus(message);
            await refreshPricingState();
        }
    }

    async function startCheckout() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.callFunction) {
            throw new Error('Stripe checkout is unavailable right now.');
        }

        const successUrl = buildPricingUrlWithQuery('checkout', 'success');
        const cancelUrl = buildPricingUrlWithQuery('checkout', 'cancelled');

        const result = await authApi.callFunction('createStripeCheckoutSession', { successUrl, cancelUrl });
        const checkoutUrl = String(result?.url || '').trim();
        if (!checkoutUrl) throw new Error('Stripe checkout session did not return a URL.');

        window.location.assign(checkoutUrl);
    }

    async function openBillingPortal() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.callFunction) {
            throw new Error('Stripe billing portal is unavailable right now.');
        }

        const returnUrl = buildPricingUrlWithQuery('checkout', 'portal-return');
        const result = await authApi.callFunction('createStripePortalSession', { returnUrl });
        const portalUrl = String(result?.url || '').trim();
        if (!portalUrl) throw new Error('Stripe billing portal session did not return a URL.');

        window.location.assign(portalUrl);
    }

    async function handlePrimaryCtaClick(event) {
        const btn = event.currentTarget;
        if (!(btn instanceof HTMLButtonElement)) return;

        const action = String(btn.dataset.pricingAction || 'account').toLowerCase();

        if (previewPlan) {
            setStatus('Preview mode is active. Remove pv_preview_plan from the URL to run live billing actions.');
            return;
        }

        if (action === 'none') return;
        if (action === 'signin' || action === 'account') {
            window.location.assign(buildAccountUrl());
            return;
        }

        const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
        if (!user) {
            window.location.assign(buildAccountUrl());
            return;
        }

        if (action === 'subscribe') {
            await runBillingAction(startCheckout, 'Opening Stripe checkout...');
            return;
        }

        if (action === 'manage') {
            await runBillingAction(openBillingPortal, 'Opening billing portal...');
            return;
        }

        window.location.assign(buildAccountUrl());
    }

    async function refreshPricingState() {
        if (previewPlan) {
            applyPreviewPlanState(previewPlan);
            return;
        }

        const authApi = window?.PV_AUTH;
        const authReady = !!(authApi && typeof authApi.isReady === 'function' && authApi.isReady());

        if (!authReady) {
            setPlanBadges(false, false);
            setPrimaryCtas('Open account', 'account', false);
            setStatus('Sign in on the account page to manage Premium.');
            return;
        }

        const user = authApi.getUser ? authApi.getUser() : null;
        if (!user) {
            setPlanBadges(false, false);
            setPrimaryCtas('Sign in to upgrade', 'signin', false);
            setStatus('Sign in to check your plan and start Premium.');
            return;
        }

        if (typeof authApi.callFunction !== 'function') {
            const roleFromClaims = await readRoleFromClaims(false);
            setPlanBadges(true, isPremiumRole(roleFromClaims));
            setPrimaryCtas('Open account', 'account', false);
            setStatus('Billing tools unavailable: Firebase Functions not configured.');
            return;
        }

        setPrimaryCtas('Checking plan...', 'none', true);

        try {
            const result = await authApi.callFunction('getStripeSubscriptionStatus', {});
            const role = String(result?.role || 'basic').toLowerCase();
            const isPremium = Boolean(result?.premiumEntitled) || role === 'premium' || role === 'admin' || role === 'tester';
            const hasCustomer = Boolean(String(result?.customerId || '').trim());

            setPlanBadges(true, isPremium);
            setStatus(getStripeStatusMessage(result));

            if (isPremium && hasCustomer) {
                setPrimaryCtas('Manage billing', 'manage', false);
                return;
            }

            if (isPremium && !hasCustomer) {
                setPrimaryCtas('Open account', 'account', false);
                return;
            }

            setPrimaryCtas('Upgrade to Premium', 'subscribe', false);
        } catch (error) {
            const message = toBillingErrorMessage(error, 'Could not load subscription status.');
            const roleFromClaims = await readRoleFromClaims(false);
            const premiumByRole = isPremiumRole(roleFromClaims);

            setPlanBadges(true, premiumByRole);

            if (premiumByRole) {
                setPrimaryCtas('Open account', 'account', false);
                setStatus(message);
                return;
            }

            setPrimaryCtas('Upgrade to Premium', 'subscribe', false);
            setStatus(`${message} You can still try checkout.`);
        }
    }

    for (const btn of primaryCtas) {
        btn.addEventListener('click', handlePrimaryCtaClick);
    }

    readCheckoutQueryStatus();
    previewPlan = getPreviewPlanFromUrl();
    refreshPricingState();

    const authApi = window?.PV_AUTH;
    if (authApi && typeof authApi.onAuthStateChanged === 'function') {
        authApi.onAuthStateChanged(() => {
            refreshPricingState();
        });
    }
});
