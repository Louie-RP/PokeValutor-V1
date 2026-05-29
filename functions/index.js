const admin = require('firebase-admin');
const functions = require('firebase-functions');
const Stripe = require('stripe');

admin.initializeApp();

const ALLOWED_ROLES = new Set(['admin', 'tester', 'premium', 'basic']);
const PREMIUM_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);
const DEFAULT_APP_BASE_URL = 'https://www.pokevaluator.com';

const runtimeConfig = (() => {
    try {
        return functions.config();
    } catch {
        return {};
    }
})();

let stripeClient = null;

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function configValue(envKey, nestedPath, fallback) {
    const envValue = String(process.env?.[envKey] || '').trim();
    if (envValue) return envValue;

    let node = runtimeConfig;
    for (const segment of nestedPath) {
        if (!node || typeof node !== 'object') {
            node = null;
            break;
        }
        node = node[segment];
    }

    const configRaw = node == null ? '' : String(node).trim();
    if (configRaw) return configRaw;
    return String(fallback || '').trim();
}

function getStripeSecretKey() {
    return configValue('STRIPE_SECRET_KEY', ['stripe', 'secret_key'], '');
}

function getStripeWebhookSecret() {
    return configValue('STRIPE_WEBHOOK_SECRET', ['stripe', 'webhook_secret'], '');
}

function getStripeMonthlyPriceId() {
    return configValue('STRIPE_PRICE_ID_MONTHLY_PREMIUM', ['stripe', 'price_id_monthly_premium'], '');
}

function getStripePortalConfigurationId() {
    return configValue('STRIPE_BILLING_PORTAL_CONFIGURATION_ID', ['stripe', 'billing_portal_configuration_id'], '');
}

function getAppBaseUrl() {
    const raw = configValue('STRIPE_APP_BASE_URL', ['stripe', 'app_base_url'], DEFAULT_APP_BASE_URL);
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return DEFAULT_APP_BASE_URL;
        }
        return parsed.origin;
    } catch {
        return DEFAULT_APP_BASE_URL;
    }
}

function isLocalOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const host = String(parsed.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1';
    } catch {
        return false;
    }
}

function isAllowedReturnOrigin(origin) {
    const allowedOrigins = new Set();

    const appBase = getAppBaseUrl();
    if (appBase) allowedOrigins.add(appBase);

    const csv = configValue('STRIPE_ALLOWED_RETURN_ORIGINS', ['stripe', 'allowed_return_origins'], '');
    if (csv) {
        for (const part of csv.split(',')) {
            const candidate = String(part || '').trim();
            if (!candidate) continue;
            try {
                const parsed = new URL(candidate);
                allowedOrigins.add(parsed.origin);
            } catch {
                // Ignore invalid origins.
            }
        }
    }

    if (allowedOrigins.has(origin)) return true;
    return isLocalOrigin(origin);
}

function sanitizeReturnUrl(raw, fallbackUrl) {
    const fallback = String(fallbackUrl || '').trim();

    try {
        const candidate = new URL(String(raw || '').trim());
        if ((candidate.protocol === 'https:' || candidate.protocol === 'http:') && isAllowedReturnOrigin(candidate.origin)) {
            return candidate.href;
        }
    } catch {
        // Use fallback.
    }

    return fallback;
}

function withQuery(url, key, value) {
    const next = new URL(url);
    next.searchParams.set(String(key || ''), String(value || ''));
    return next.href;
}

function toMillisFromUnixSeconds(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 1000);
}

function extractStripeId(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
    return '';
}

function isPremiumFromSubscriptionStatus(statusRaw) {
    const status = String(statusRaw || '').trim().toLowerCase();
    return PREMIUM_SUBSCRIPTION_STATUSES.has(status);
}

function statusPriority(statusRaw) {
    const status = String(statusRaw || '').trim().toLowerCase();
    if (status === 'active') return 50;
    if (status === 'trialing') return 40;
    if (status === 'past_due') return 30;
    if (status === 'unpaid') return 20;
    if (status === 'incomplete') return 10;
    if (status === 'canceled') return 0;
    return -1;
}

function chooseSubscription(subscriptions) {
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;
    const sorted = subscriptions.slice().sort((a, b) => {
        const byStatus = statusPriority(b?.status) - statusPriority(a?.status);
        if (byStatus !== 0) return byStatus;
        return Number(b?.created || 0) - Number(a?.created || 0);
    });
    return sorted[0] || null;
}

function getStripeClient() {
    const secretKey = getStripeSecretKey();
    if (!secretKey) {
        throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY).');
    }
    if (!stripeClient) {
        stripeClient = new Stripe(secretKey);
    }
    return stripeClient;
}

function requireAuthUid(context) {
    const uid = String(context?.auth?.uid || '').trim();
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    return uid;
}

async function ensureStripeCustomer(uid, opts) {
    const stripe = getStripeClient();
    const db = admin.firestore();
    const ref = db.collection('stripeCustomers').doc(uid);
    const snap = await ref.get();

    const existingCustomerId = String(snap.data()?.customerId || '').trim();
    if (existingCustomerId) {
        await ref.set({
            uid,
            customerId: existingCustomerId,
            email: String(opts?.email || ''),
            displayName: String(opts?.displayName || ''),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return existingCustomerId;
    }

    const customer = await stripe.customers.create({
        email: String(opts?.email || ''),
        name: String(opts?.displayName || ''),
        metadata: {
            firebaseUID: uid,
        },
    });

    await ref.set({
        uid,
        customerId: customer.id,
        email: String(opts?.email || ''),
        displayName: String(opts?.displayName || ''),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return customer.id;
}

function roleFromClaims(claims) {
    const roleRaw = String(claims?.role || '').trim().toLowerCase();
    if (roleRaw === 'admin' || roleRaw === 'tester' || roleRaw === 'premium' || roleRaw === 'basic') return roleRaw;

    const adminFlag = claims?.admin;
    if (adminFlag === true || String(adminFlag || '').toLowerCase() === 'true') return 'admin';

    const testerFlag = claims?.tester;
    if (testerFlag === true || String(testerFlag || '').toLowerCase() === 'true') return 'tester';

    const premiumFlag = claims?.premium;
    if (premiumFlag === true || String(premiumFlag || '').toLowerCase() === 'true') return 'premium';

    const tierRaw = String(claims?.tier || '').trim().toLowerCase();
    if (tierRaw === 'premium' || tierRaw === 'pro') return 'premium';

    return 'basic';
}

async function syncUserRoleFromPremium(uid, premiumEntitled, source) {
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};
    const currentRole = roleFromClaims(existingClaims);

    if (currentRole === 'admin' || currentRole === 'tester') {
        return { role: currentRole, skipped: true, changed: false };
    }

    const nextRole = premiumEntitled ? 'premium' : 'basic';
    const nextClaims = {
        ...existingClaims,
        role: nextRole,
        tier: nextRole,
        premium: nextRole === 'premium',
        admin: false,
        tester: false,
    };

    const unchanged = roleFromClaims(existingClaims) === nextRole
        && String(existingClaims?.tier || '').toLowerCase() === nextRole
        && Boolean(existingClaims?.premium) === (nextRole === 'premium')
        && (existingClaims?.admin === false || String(existingClaims?.admin || '').toLowerCase() === 'false' || existingClaims?.admin == null)
        && (existingClaims?.tester === false || String(existingClaims?.tester || '').toLowerCase() === 'false' || existingClaims?.tester == null);

    if (!unchanged) {
        await admin.auth().setCustomUserClaims(uid, nextClaims);
    }

    await admin.firestore().collection('stripeBilling').doc(uid).set({
        uid,
        role: nextRole,
        premiumEntitled: Boolean(premiumEntitled),
        roleUpdatedFrom: String(source || 'stripe'),
        roleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { role: nextRole, skipped: false, changed: !unchanged };
}

async function findUidForCustomer(customerId) {
    const normalized = String(customerId || '').trim();
    if (!normalized) return '';

    const stripe = getStripeClient();
    try {
        const customer = await stripe.customers.retrieve(normalized);
        if (customer && !customer.deleted) {
            const metadataUid = String(customer.metadata?.firebaseUID || '').trim();
            if (metadataUid) return metadataUid;
        }
    } catch {
        // Fallback to Firestore mapping.
    }

    const snap = await admin.firestore()
        .collection('stripeCustomers')
        .where('customerId', '==', normalized)
        .limit(1)
        .get();

    if (snap.empty) return '';
    return String(snap.docs[0]?.id || '').trim();
}

async function writeBillingSnapshot(uid, snapshot) {
    await admin.firestore().collection('stripeBilling').doc(uid).set({
        uid,
        ...snapshot,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

async function processSubscriptionSnapshot(uid, customerId, subscription, source) {
    const status = String(subscription?.status || '').toLowerCase();
    const premiumEntitled = isPremiumFromSubscriptionStatus(status);
    const subscriptionId = String(subscription?.id || '').trim();
    const currentPeriodEndMs = toMillisFromUnixSeconds(subscription?.current_period_end);
    const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);

    if (customerId) {
        await admin.firestore().collection('stripeCustomers').doc(uid).set({
            uid,
            customerId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    const roleSync = await syncUserRoleFromPremium(uid, premiumEntitled, source);

    await writeBillingSnapshot(uid, {
        customerId: customerId || '',
        subscriptionId,
        subscriptionStatus: status,
        cancelAtPeriodEnd,
        currentPeriodEndMs,
        premiumEntitled,
        lastEvent: source,
        roleAfterSync: roleSync.role,
    });

    return roleSync;
}

function asHttpsError(error, fallbackCode, fallbackMessage) {
    if (error instanceof functions.https.HttpsError) return error;
    const message = String(error?.message || fallbackMessage || 'Unexpected error');
    return new functions.https.HttpsError(fallbackCode, message);
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

exports.createStripeCheckoutSession = functions.https.onCall(async (data, context) => {
    try {
        const uid = requireAuthUid(context);
        const stripe = getStripeClient();

        const monthlyPriceId = getStripeMonthlyPriceId();
        if (!monthlyPriceId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Stripe price id is missing. Set STRIPE_PRICE_ID_MONTHLY_PREMIUM.'
            );
        }

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const appBase = getAppBaseUrl();
        const defaultSuccess = withQuery(`${appBase}/account.html`, 'checkout', 'success');
        const defaultCancel = withQuery(`${appBase}/account.html`, 'checkout', 'cancelled');

        const successUrlInput = String(data?.successUrl || '').trim();
        const cancelUrlInput = String(data?.cancelUrl || '').trim();

        let successUrl = sanitizeReturnUrl(successUrlInput, defaultSuccess);
        successUrl = withQuery(successUrl, 'session_id', '{CHECKOUT_SESSION_ID}');

        const cancelUrl = sanitizeReturnUrl(cancelUrlInput, defaultCancel);

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: monthlyPriceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            client_reference_id: uid,
            metadata: {
                firebaseUID: uid,
            },
        });

        return {
            ok: true,
            sessionId: session.id,
            url: session.url,
        };
    } catch (error) {
        functions.logger.error('createStripeCheckoutSession failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not create Stripe checkout session.');
    }
});

exports.createStripePortalSession = functions.https.onCall(async (data, context) => {
    try {
        const uid = requireAuthUid(context);
        const stripe = getStripeClient();

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const appBase = getAppBaseUrl();
        const defaultReturnUrl = `${appBase}/account.html`;
        const returnUrlInput = String(data?.returnUrl || '').trim();
        const returnUrl = sanitizeReturnUrl(returnUrlInput, defaultReturnUrl);

        const portalConfigId = getStripePortalConfigurationId();
        const payload = {
            customer: customerId,
            return_url: returnUrl,
        };
        if (portalConfigId) payload.configuration = portalConfigId;

        const session = await stripe.billingPortal.sessions.create(payload);

        return {
            ok: true,
            url: session.url,
        };
    } catch (error) {
        functions.logger.error('createStripePortalSession failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not create Stripe billing portal session.');
    }
});

exports.getStripeSubscriptionStatus = functions.https.onCall(async (_data, context) => {
    try {
        const uid = requireAuthUid(context);
        const stripe = getStripeClient();

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 10,
        });

        const subscription = chooseSubscription(subscriptions.data);
        let roleSync;
        if (subscription) {
            roleSync = await processSubscriptionSnapshot(uid, customerId, subscription, 'status-check');
        } else {
            roleSync = await syncUserRoleFromPremium(uid, false, 'status-check-none');
            await writeBillingSnapshot(uid, {
                customerId,
                subscriptionId: '',
                subscriptionStatus: 'none',
                cancelAtPeriodEnd: false,
                currentPeriodEndMs: null,
                premiumEntitled: false,
                lastEvent: 'status-check-none',
                roleAfterSync: roleSync.role,
            });
        }

        const status = String(subscription?.status || 'none').toLowerCase();
        const premiumEntitled = isPremiumFromSubscriptionStatus(status);
        const role = String(roleSync?.role || (premiumEntitled ? 'premium' : 'basic'));

        return {
            ok: true,
            customerId,
            hasSubscription: Boolean(subscription),
            subscriptionId: String(subscription?.id || ''),
            subscriptionStatus: status,
            cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
            currentPeriodEndMs: toMillisFromUnixSeconds(subscription?.current_period_end),
            premiumEntitled,
            role,
        };
    } catch (error) {
        functions.logger.error('getStripeSubscriptionStatus failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not read Stripe subscription status.');
    }
});

async function processStripeEvent(event) {
    const stripe = getStripeClient();
    const eventType = String(event?.type || '').trim();

    if (eventType === 'checkout.session.completed') {
        const session = event.data.object;
        if (String(session?.mode || '') !== 'subscription') return;

        let uid = String(session?.client_reference_id || session?.metadata?.firebaseUID || '').trim();
        const customerId = extractStripeId(session?.customer);
        if (!uid && customerId) {
            uid = await findUidForCustomer(customerId);
        }
        if (!uid) {
            functions.logger.warn('checkout.session.completed missing firebase UID', { customerId, eventId: event.id });
            return;
        }

        const subscriptionId = extractStripeId(session?.subscription);
        if (!subscriptionId) return;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await processSubscriptionSnapshot(uid, customerId, subscription, eventType);
        return;
    }

    if (
        eventType === 'customer.subscription.created'
        || eventType === 'customer.subscription.updated'
        || eventType === 'customer.subscription.deleted'
    ) {
        const subscription = event.data.object;
        const customerId = extractStripeId(subscription?.customer);

        let uid = String(subscription?.metadata?.firebaseUID || '').trim();
        if (!uid && customerId) {
            uid = await findUidForCustomer(customerId);
        }
        if (!uid) {
            functions.logger.warn('subscription event missing firebase UID', {
                eventType,
                customerId,
                eventId: event.id,
            });
            return;
        }

        await processSubscriptionSnapshot(uid, customerId, subscription, eventType);
    }
}

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret) {
        res.status(500).json({ ok: false, error: 'Stripe webhook secret is not configured.' });
        return;
    }

    const signature = req.get('stripe-signature');
    if (!signature) {
        res.status(400).json({ ok: false, error: 'Missing stripe-signature header.' });
        return;
    }

    let event;
    try {
        event = getStripeClient().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (error) {
        functions.logger.error('Invalid Stripe webhook signature', {
            message: String(error?.message || error),
        });
        res.status(400).json({ ok: false, error: 'Invalid webhook signature.' });
        return;
    }

    try {
        await processStripeEvent(event);
        res.json({ received: true });
    } catch (error) {
        functions.logger.error('Stripe webhook processing failed', {
            eventId: String(event?.id || ''),
            eventType: String(event?.type || ''),
            message: String(error?.message || error),
        });
        res.status(500).json({ ok: false, error: 'Webhook processing failed.' });
    }
});
