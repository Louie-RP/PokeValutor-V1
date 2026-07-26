/* Card detail page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const WATCHLIST_KEY = 'pv:scrydex:watchlist:v1';
    const CARD_TTL_MS = 24 * 60 * 60 * 1000;
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const CACHE_PREFIX = 'pv:scrydex:';
    const HISTORY_PREFIX = 'pv:cardHistory:v1:';
    const HISTORY_MAX_POINTS = 30;

    const titleEl = document.getElementById('pv-card-title');
    const statusEl = document.getElementById('pv-card-status');
    const detailEl = document.getElementById('pv-card-detail');
    const imageEl = /** @type {HTMLImageElement|null} */ (document.getElementById('pv-card-image'));
    const setEl = document.getElementById('pv-card-set');
    const numberEl = document.getElementById('pv-card-number');
    const rarityEl = document.getElementById('pv-card-rarity');
    const marketEl = document.getElementById('pv-card-market');
    const marketLabelEl = document.getElementById('pv-card-market-label');
    const marketLinkEl = /** @type {HTMLAnchorElement|null} */ (document.getElementById('pv-card-market-link'));
    const updatedEl = document.getElementById('pv-card-last-updated');
    const pricingBodyEl = document.getElementById('pv-card-pricing-body');
    let variantTooltipEl = null;
    let pinnedVariantTrigger = null;
    const relatedGridEl = document.getElementById('pv-card-related-grid');
    const watchToggleEl = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-card-watch-toggle'));
    const shareBtnEl = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-card-share'));
    const shareStatusEl = document.getElementById('pv-card-share-status');
    const imageOpenEl = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-card-image-open'));
    const imageModalEl = /** @type {HTMLDialogElement|null} */ (document.getElementById('pv-card-image-modal'));
    const imageCloseEl = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-card-image-close'));
    const fullImageEl = /** @type {HTMLImageElement|null} */ (document.getElementById('pv-card-image-full'));
    const historyVariantEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-history-variant'));
    const historyConditionEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-history-condition'));
    const historyBodyEl = document.getElementById('pv-card-history-body');

    const metaTitleEl = document.getElementById('pv-card-title-tag');
    const metaDescEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-meta-description'));
    const metaOgTitleEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-og-title'));
    const metaOgDescEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-og-description'));
    const metaOgImageEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-og-image'));
    const metaOgImageAltEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-og-image-alt'));
    const metaOgUrlEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-og-url'));
    const metaTwitterTitleEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-twitter-title'));
    const metaTwitterDescEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-twitter-description'));
    const metaTwitterImageEl = /** @type {HTMLMetaElement|null} */ (document.getElementById('pv-card-twitter-image'));
    const canonicalEl = /** @type {HTMLLinkElement|null} */ (document.getElementById('pv-card-canonical'));
    const cardSchemaEl = /** @type {HTMLScriptElement|null} */ (document.getElementById('pv-card-schema'));

    /** @type {any|null} */
    let currentCard = null;

    function setStatus(text) {
        if (statusEl) statusEl.textContent = String(text || '');
    }

    function setShareStatus(text) {
        if (shareStatusEl) shareStatusEl.textContent = String(text || '');
    }

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function safeParseJson(raw) {
        try { return JSON.parse(raw); } catch { return null; }
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function createElement(tagName, { className, text, attributes } = {}) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        Object.entries(attributes || {}).forEach(([name, value]) => {
            if (value !== undefined && value !== null) element.setAttribute(name, String(value));
        });
        return element;
    }

    function renderTableMessage(body, columnCount, message) {
        if (!body) return;
        const row = createElement('tr');
        row.append(createElement('td', {
            text: message,
            attributes: { colspan: columnCount },
        }));
        body.replaceChildren(row);
    }

    function slugify(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');
    }

    function buildCardSlug(card) {
        const id = safeString(card?.id, 'card');
        const name = safeString(card?.name, 'details');
        return slugify(`${id}-${name}`);
    }

    function buildCardDetailPath(card) {
        const id = safeString(card?.id, '');
        if (!id) return 'card.html';
        const slug = buildCardSlug(card);
        return `card.html?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`;
    }

    function buildAbsoluteUrl(path) {
        const normalized = String(path || '').replace(/^\/+/, '');
        const origin = String(window.location.origin || '').trim();
        if (origin && origin !== 'null' && /^https?:/i.test(origin)) {
            const base = origin.replace(/\/$/, '');
            return `${base}/${normalized}`;
        }
        try {
            return new URL(normalized, window.location.href).href;
        } catch {
            return normalized;
        }
    }

    function sanitizeUrl(raw) {
        const s = String(raw ?? '').trim();
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) return s;
        if (/^data:image\//i.test(s)) return s;
        return '';
    }

    function pickFrontMediumImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => String(img?.type || '').toLowerCase() === 'front');
        return front?.medium || front?.large || front?.small || images[0]?.medium || images[0]?.large || images[0]?.small || '';
    }

    function getCardSetName(cardLike) {
        const expansionName = safeString(cardLike?.expansion?.name, '');
        const setName = safeString(cardLike?.set?.name, '');
        const directExpansionName = safeString(cardLike?.expansionName, '');
        const directSetName = safeString(cardLike?.setName, '');
        return expansionName || setName || directExpansionName || directSetName || 'n/a';
    }

    function getCardDisplayNumber(cardLike) {
        const firstValue = (values) => {
            for (const value of values) {
                if (typeof value !== 'string' && typeof value !== 'number') continue;
                const normalized = String(value).trim();
                if (normalized) return normalized;
            }
            return '';
        };
        const cardId = firstValue([cardLike?.id]);
        const idNumber = cardId.includes('-') ? cardId.split('-').pop() : '';
        const printedNumber = firstValue([
            cardLike?.printedNumber,
            cardLike?.printed_number,
            cardLike?.collectorNumber,
            cardLike?.collector_number,
            cardLike?.cardNumber,
            cardLike?.card_number,
            cardLike?.card_no,
            cardLike?.number,
            cardLike?.localId,
            cardLike?.local_id,
            idNumber,
        ]);
        if (!printedNumber) return printedNumber;

        const rarityName = firstValue([
            cardLike?.rarity?.name,
            cardLike?.rarity,
            cardLike?.rarityName,
            cardLike?.rarity_name,
        ]);
        const setName = firstValue([
            cardLike?.expansion?.name,
            cardLike?.set?.name,
            cardLike?.expansionName,
            cardLike?.setName,
        ]);
        const isPromo = /\bpromo(?:tional)?s?\b/i.test(`${rarityName} ${setName}`);
        if (isPromo) return printedNumber.split('/')[0].trim();
        if (printedNumber.includes('/')) return printedNumber;

        const printedTotal = firstValue([
            cardLike?.expansion?.printedTotal,
            cardLike?.expansion?.printed_total,
            cardLike?.set?.printedTotal,
            cardLike?.set?.printed_total,
            cardLike?.printedTotal,
            cardLike?.printed_total,
        ]);
        const numberMatch = printedNumber.match(/^([a-z]{0,2})(\d+[a-z]?)$/i);
        const totalMatch = printedTotal.match(/^([a-z]{0,2})(\d+)$/i);
        if (numberMatch && totalMatch) {
            const numberPrefix = numberMatch[1].toUpperCase();
            const totalPrefix = (totalMatch[1] || numberPrefix).toUpperCase();
            return `${numberPrefix}${numberMatch[2]}/${totalPrefix}${totalMatch[2]}`;
        }
        return printedNumber;
    }

    function formatMoney(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 'n/a';
        return `$${n.toFixed(2)}`;
    }

    function formatVariantLabel(value) {
        const words = String(value || 'Standard')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
        return words
            .join(' ')
            .replace(/\bFirst Edition\b/g, '1st Ed.')
            .replace(/\bHolofoil\b/g, 'Holo');
    }

    function ensureVariantTooltip() {
        if (variantTooltipEl) return variantTooltipEl;
        variantTooltipEl = createElement('div', {
            className: 'pv-variantNameTooltip',
            attributes: {
                id: 'pv-variant-name-tooltip',
                role: 'tooltip',
                hidden: '',
            },
        });
        document.body.append(variantTooltipEl);

        const dismiss = () => hideVariantTooltip();
        document.addEventListener('click', (event) => {
            if (pinnedVariantTrigger && !pinnedVariantTrigger.contains(event.target)) dismiss();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') dismiss();
        });
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        return variantTooltipEl;
    }

    function showVariantTooltip(trigger, label, pin = false) {
        const tooltip = ensureVariantTooltip();
        tooltip.textContent = label;
        tooltip.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        if (pin) pinnedVariantTrigger = trigger;

        const triggerRect = trigger.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const gutter = 8;
        const left = Math.min(
            window.innerWidth - tooltipRect.width - gutter,
            Math.max(gutter, triggerRect.left)
        );
        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const top = spaceBelow >= tooltipRect.height + gutter
            ? triggerRect.bottom + gutter
            : triggerRect.top - tooltipRect.height - gutter;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(gutter, top)}px`;
    }

    function hideVariantTooltip(trigger) {
        if (!variantTooltipEl) return;
        if (trigger && pinnedVariantTrigger === trigger) return;
        document.querySelectorAll('.pv-variantName[aria-expanded="true"]').forEach((button) => {
            button.setAttribute('aria-expanded', 'false');
        });
        variantTooltipEl.hidden = true;
        pinnedVariantTrigger = null;
    }

    function createVariantNameControl(label) {
        ensureVariantTooltip();
        const button = createElement('button', {
            className: 'pv-variantName',
            text: label,
            attributes: {
                type: 'button',
                'aria-label': `Full variant name: ${label}`,
                'aria-describedby': 'pv-variant-name-tooltip',
                'aria-expanded': 'false',
            },
        });
        button.addEventListener('pointerenter', () => showVariantTooltip(button, label));
        button.addEventListener('pointerleave', () => hideVariantTooltip(button));
        button.addEventListener('focus', () => showVariantTooltip(button, label));
        button.addEventListener('blur', () => hideVariantTooltip(button));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (pinnedVariantTrigger === button) {
                hideVariantTooltip();
                return;
            }
            hideVariantTooltip();
            showVariantTooltip(button, label, true);
        });
        return button;
    }

    function getPrimaryPriceSummary(card) {
        const variants = Array.isArray(card?.variants) ? card.variants : [];
        const nmMarkets = variants
            .map((variant) => getMarketByCondition(variant?.prices, 'NM'))
            .filter(Number.isFinite);
        const values = nmMarkets.length
            ? nmMarkets
            : variants.map((variant) => getBestMarket(variant?.prices)).filter(Number.isFinite);
        const isMultiple = variants.length > 1;
        if (!values.length) {
            return { label: isMultiple ? 'Market price range' : 'NM market price', text: 'n/a', isMultiple };
        }
        if (!isMultiple) {
            return {
                label: nmMarkets.length ? 'NM market price' : 'Latest market price',
                text: formatMoney(values[0]),
                isMultiple: false,
            };
        }
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        return {
            label: nmMarkets.length ? 'NM market range' : 'Market price range',
            text: minimum === maximum ? formatMoney(minimum) : `${formatMoney(minimum)} – ${formatMoney(maximum)}`,
            isMultiple: true,
        };
    }

    function toUiDate(value) {
        const n = Number(value);
        const date = Number.isFinite(n) && n > 0 ? new Date(n) : new Date(String(value || ''));
        if (Number.isNaN(date.getTime())) return 'n/a';
        try {
            return new Intl.DateTimeFormat('en-US', {
                year: 'numeric', month: 'short', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            }).format(date);
        } catch {
            return date.toISOString();
        }
    }

    function getMarketByCondition(prices, conditionCode) {
        const wanted = String(conditionCode || '').trim().toUpperCase();
        if (!Array.isArray(prices) || !wanted) return null;
        let best = null;
        for (const price of prices) {
            const code = String(price?.condition || '').trim().toUpperCase();
            if (!code.startsWith(wanted)) continue;
            const n = Number(price?.market ?? price?.marketPrice ?? price?.market_price);
            if (!Number.isFinite(n)) continue;
            if (best == null || n > best) best = n;
        }
        return best;
    }

    function getBestMarket(prices) {
        if (!Array.isArray(prices)) return null;
        let best = null;
        for (const price of prices) {
            const n = Number(price?.market ?? price?.marketPrice ?? price?.market_price);
            if (!Number.isFinite(n)) continue;
            if (best == null || n > best) best = n;
        }
        return best;
    }

    function getBestMarketFromCard(cardLike) {
        if (!cardLike || !Array.isArray(cardLike?.variants)) return null;
        let best = null;
        for (const variant of cardLike.variants) {
            const market = getBestMarket(variant?.prices);
            if (!Number.isFinite(market)) continue;
            if (best == null || market > best) best = market;
        }
        return best;
    }

    function cacheGet(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (typeof parsed.expiresAt !== 'number' || !('value' in parsed)) return null;
            if (Date.now() > parsed.expiresAt) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.value;
        } catch {
            return null;
        }
    }

    function cacheSet(key, value, ttlMs) {
        try {
            localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() }));
        } catch {
            // ignore
        }
    }

    async function fetchJsonWithCache(url, ttlMs) {
        const key = `${CACHE_PREFIX}url:${url}`;
        const cached = cacheGet(key);
        if (cached) return cached;

        /** @type {Record<string, string>|undefined} */
        let headers;
        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = String(tokenRaw || '').trim();
            if (token && token.split('.').length === 3) {
                headers = { Authorization: `Bearer ${token}` };
            }
        } catch {
            // ignore
        }

        const res = await fetch(url, headers ? { headers } : undefined);
        const text = await res.text();
        const data = safeParseJson(text);
        if (!res.ok || !data) {
            const msg = (data && typeof data === 'object' && (data.error || data.message))
                ? (data.error || data.message)
                : `Request failed (${res.status})`;
            const err = new Error(String(msg));
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429;
            throw err;
        }

        if (data && typeof data === 'object' && data.ok === false) {
            const msg = String(data.error || data.message || 'API error');
            const err = new Error(msg);
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429;
            throw err;
        }

        cacheSet(key, data, ttlMs);
        return data;
    }

    function buildFieldQuery(fieldName, value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        const needsQuotes = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed);
        const term = needsQuotes ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
        return `${fieldName}:${term}`;
    }

    function derivePokemonFamilyName(cardName) {
        const raw = String(cardName || '').trim();
        if (!raw) return '';

        const stop = new Set([
            'mega', 'm', 'ex', 'gx', 'v', 'vmax', 'vstar', 'lv', 'lvl', 'break', 'prime',
            'radiant', 'shining', 'dark', 'delta', 'tag', 'team', 'rocket', 's',
            'galarian', 'hisuian', 'alolan', 'paldean', 'x', 'y', 'xy', 'trainer'
        ]);

        const cleaned = raw
            .toLowerCase()
            .replace(/[’']/g, ' ')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleaned) return '';

        const tokens = cleaned
            .split(' ')
            .map((t) => t.trim())
            .filter(Boolean)
            .filter((t) => !stop.has(t));

        if (!tokens.length) return '';

        // Prefer the last meaningful token (e.g., "Mega Charizard X EX" -> "charizard").
        for (let i = tokens.length - 1; i >= 0; i--) {
            const tok = tokens[i];
            if (/^[a-z]/.test(tok)) return tok;
        }

        return tokens[tokens.length - 1];
    }

    function mergeUniqueCardsById(target, next) {
        const out = Array.isArray(target) ? target.slice() : [];
        if (!Array.isArray(next) || !next.length) return out;

        const seen = new Set(out.map((x) => safeString(x?.id, '')));
        for (const card of next) {
            const id = safeString(card?.id, '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(card);
        }
        return out;
    }

    async function fetchCardsForQuery(query, pageSize) {
        const q = String(query || '').trim();
        if (!q) return [];
        const base = getWorkerBase();
        const size = Math.max(1, Math.min(30, Number(pageSize) || 24));
        const url = `${base}/cards/search?q=${encodeURIComponent(q)}&page=1&pageSize=${size}&lang=en`;
        const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
        return Array.isArray(data?.data) ? data.data : [];
    }

    function normalizeWatchlistItem(card) {
        return {
            id: safeString(card?.id, ''),
            name: safeString(card?.name, 'Unknown'),
            rarity: safeString(card?.rarity, ''),
            expansion: (card?.expansion && typeof card.expansion === 'object') ? card.expansion : null,
            set: (card?.set && typeof card.set === 'object') ? card.set : null,
            images: Array.isArray(card?.images) ? card.images : [],
            variants: Array.isArray(card?.variants) ? card.variants : [],
            selectedVariant: safeString(card?.selectedVariant, ''),
            pricesText: safeString(card?.pricesText, ''),
        };
    }

    function loadWatchlist() {
        try {
            const raw = localStorage.getItem(WATCHLIST_KEY);
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((x) => x && typeof x === 'object' && x.id)
                .map(normalizeWatchlistItem);
        } catch {
            return [];
        }
    }

    function saveWatchlist(list) {
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        } catch {
            // ignore
        }
    }

    function isWatchlisted(cardId) {
        const id = safeString(cardId, '');
        if (!id) return false;
        return loadWatchlist().some((x) => safeString(x?.id, '') === id);
    }

    function syncWatchButton(cardId) {
        if (!watchToggleEl) return;
        const onList = isWatchlisted(cardId);
        watchToggleEl.setAttribute('aria-pressed', onList ? 'true' : 'false');
        watchToggleEl.textContent = onList ? 'Remove from Watchlist' : 'Add to Watchlist';
    }

    async function toggleWatchlist(card) {
        const id = safeString(card?.id, '');
        if (!id) return;
        const normalized = normalizeWatchlistItem(card);
        const existing = loadWatchlist();
        const onList = existing.some((x) => safeString(x?.id, '') === id);

        let next;
        if (onList) {
            next = existing.filter((x) => safeString(x?.id, '') !== id);
            try {
                if (window?.PV_AUTH?.removeWatchlistItem) {
                    await Promise.resolve(window.PV_AUTH.removeWatchlistItem('card', id));
                }
            } catch {
                // ignore
            }
            setStatus('Removed from Watchlist.');
        } else {
            next = [...existing, normalized];
            try {
                if (window?.PV_AUTH?.saveWatchlistItem) {
                    await Promise.resolve(window.PV_AUTH.saveWatchlistItem('card', normalized));
                }
            } catch {
                // ignore
            }
            setStatus('Added to Watchlist.');
        }

        saveWatchlist(next);
        syncWatchButton(id);
    }

    async function hydrateWatchlistFromCloud() {
        const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
        if (!user || !window?.PV_AUTH?.loadWatchlist) return;

        try {
            const cloud = await Promise.resolve(window.PV_AUTH.loadWatchlist('card'));
            if (!Array.isArray(cloud)) return;

            const local = loadWatchlist();
            const byId = new Map();
            for (const item of cloud) {
                const normalized = normalizeWatchlistItem(item);
                const id = safeString(normalized?.id, '').trim();
                if (!id) continue;
                byId.set(id, normalized);
            }
            for (const item of local) {
                const normalized = normalizeWatchlistItem(item);
                const id = safeString(normalized?.id, '').trim();
                if (!id || byId.has(id)) continue;
                byId.set(id, normalized);
            }
            saveWatchlist(Array.from(byId.values()));
            if (currentCard) syncWatchButton(currentCard.id);
        } catch {
            // ignore
        }
    }

    function setSeo(card) {
        const name = safeString(card?.name, 'Card');
        const number = getCardDisplayNumber(card);
        const setName = getCardSetName(card);
        const detailPath = buildCardDetailPath(card);
        const detailUrl = buildAbsoluteUrl(detailPath);
        const shareImageUrl = buildAbsoluteUrl('PokeValuator.png');
        const imageUrl = sanitizeUrl(pickFrontMediumImage(card?.images));

        const title = number
            ? `${name} #${number} • ${setName} | PokeValutor`
            : `${name} • ${setName} | PokeValutor`;
        const desc = `${name}${number ? ` #${number}` : ''} from ${setName}. View variant pricing, related cards, and watchlist actions on PokeValutor.`;

        if (metaTitleEl) metaTitleEl.textContent = title;
        document.title = title;

        if (metaDescEl) metaDescEl.setAttribute('content', desc);
        if (metaOgTitleEl) metaOgTitleEl.setAttribute('content', title);
        if (metaOgDescEl) metaOgDescEl.setAttribute('content', desc);
        if (metaOgUrlEl) metaOgUrlEl.setAttribute('content', detailUrl);
        if (metaTwitterTitleEl) metaTwitterTitleEl.setAttribute('content', title);
        if (metaTwitterDescEl) metaTwitterDescEl.setAttribute('content', desc);
        if (canonicalEl) canonicalEl.setAttribute('href', detailUrl);

        if (metaOgImageEl) metaOgImageEl.setAttribute('content', shareImageUrl);
        if (metaOgImageAltEl) metaOgImageAltEl.setAttribute('content', 'PokeValutor logo');
        if (metaTwitterImageEl) metaTwitterImageEl.setAttribute('content', shareImageUrl);

        if (cardSchemaEl instanceof HTMLScriptElement) {
            const schema = {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name,
                description: desc,
                category: 'Pokemon Trading Card',
                brand: {
                    '@type': 'Brand',
                    name: 'Pokemon',
                },
                url: detailUrl,
            };

            const market = getBestMarketFromCard(card);
            if (imageUrl) schema.image = imageUrl;
            if (number) schema.sku = `${setName}-${number}`;
            if (Number.isFinite(market)) {
                schema.offers = {
                    '@type': 'Offer',
                    priceCurrency: 'USD',
                    price: Number(market).toFixed(2),
                    url: detailUrl,
                };
            }

            cardSchemaEl.textContent = JSON.stringify(schema);
        }
    }

    function historyKey(cardId, variantName, conditionCode) {
        return `${HISTORY_PREFIX}${cardId}:${variantName}:${conditionCode}`;
    }

    function recordHistoryPoint(cardId, variantName, conditionCode, market) {
        const id = safeString(cardId, '');
        const variant = safeString(variantName, '');
        const condition = safeString(conditionCode, '').toUpperCase();
        const price = Number(market);
        if (!id || !variant || !condition || !Number.isFinite(price)) return;

        const key = historyKey(id, variant, condition);
        let rows = [];
        try {
            const raw = localStorage.getItem(key);
            const parsed = safeParseJson(raw);
            rows = Array.isArray(parsed) ? parsed : [];
        } catch {
            rows = [];
        }

        const now = Date.now();
        const last = rows.length ? rows[rows.length - 1] : null;
        if (last && Number(last.market) === price && Number(now - Number(last.ts || 0)) < (30 * 60 * 1000)) {
            return;
        }

        rows.push({ ts: now, market: Number(price.toFixed(2)) });
        if (rows.length > HISTORY_MAX_POINTS) {
            rows = rows.slice(rows.length - HISTORY_MAX_POINTS);
        }

        try {
            localStorage.setItem(key, JSON.stringify(rows));
        } catch {
            // ignore
        }
    }

    function getHistoryRows(cardId, variantName, conditionCode) {
        const key = historyKey(cardId, variantName, conditionCode);
        try {
            const raw = localStorage.getItem(key);
            const parsed = safeParseJson(raw);
            const rows = Array.isArray(parsed) ? parsed : [];
            return rows
                .filter((x) => x && Number.isFinite(Number(x.ts)) && Number.isFinite(Number(x.market)))
                .sort((a, b) => Number(b.ts) - Number(a.ts));
        } catch {
            return [];
        }
    }

    function renderHistory(card) {
        if (!historyBodyEl || !historyVariantEl || !historyConditionEl) return;
        const variantName = safeString(historyVariantEl.value, '');
        const conditionCode = safeString(historyConditionEl.value, 'NM').toUpperCase();
        if (!variantName) {
            renderTableMessage(historyBodyEl, 2, 'No variant selected.');
            return;
        }

        const rows = getHistoryRows(card?.id, variantName, conditionCode).slice(0, 10);
        if (!rows.length) {
            renderTableMessage(historyBodyEl, 2, 'No observed history yet for this selection.');
            return;
        }

        historyBodyEl.replaceChildren(...rows.map((item) => {
            const row = createElement('tr');
            row.append(
                createElement('td', { text: toUiDate(item.ts) }),
                createElement('td', { text: formatMoney(item.market) })
            );
            return row;
        }));
    }

    function renderPricing(card) {
        if (!pricingBodyEl) return;

        const variants = Array.isArray(card?.variants) ? card.variants : [];
        if (!variants.length) {
            renderTableMessage(pricingBodyEl, 5, 'No variant pricing available.');
            return;
        }

        pricingBodyEl.replaceChildren(...variants.map((variant) => {
            const variantName = safeString(variant?.name, 'Standard');
            const variantLabel = formatVariantLabel(variantName);
            const prices = Array.isArray(variant?.prices) ? variant.prices : [];
            const nm = getMarketByCondition(prices, 'NM');
            const lp = getMarketByCondition(prices, 'LP');
            const mp = getMarketByCondition(prices, 'MP');
            const best = getBestMarket(prices);

            if (Number.isFinite(nm)) recordHistoryPoint(card?.id, variantName, 'NM', nm);
            if (Number.isFinite(lp)) recordHistoryPoint(card?.id, variantName, 'LP', lp);
            if (Number.isFinite(mp)) recordHistoryPoint(card?.id, variantName, 'MP', mp);

            const row = createElement('tr');
            [
                ['Variant', variantLabel],
                ['NM', formatMoney(nm)],
                ['LP', formatMoney(lp)],
                ['MP', formatMoney(mp)],
                ['Best', formatMoney(best)],
            ].forEach(([label, value], index) => {
                const cell = createElement('td', {
                    attributes: {
                    'data-label': label,
                    ...(index === 0 ? { 'data-variant': variantName } : {}),
                    },
                });
                if (index === 0) cell.append(createVariantNameControl(value));
                else cell.textContent = value;
                row.append(cell);
            });
            return row;
        }));

        if (historyVariantEl) {
            const current = safeString(historyVariantEl.value, '');
            const options = variants
                .map((variant) => safeString(variant?.name, ''))
                .filter(Boolean);
            const optionNodes = options.length
                ? options.map((name) => {
                    const option = createElement('option', { text: formatVariantLabel(name) });
                    option.value = name;
                    option.selected = name === current;
                    return option;
                })
                : [createElement('option', { text: 'No variants', attributes: { value: '' } })];
            historyVariantEl.replaceChildren(...optionNodes);

            if (!historyVariantEl.value && variants[0]?.name) {
                historyVariantEl.value = safeString(variants[0].name, '');
            }
        }

        renderHistory(card);
    }

    async function renderRelated(card) {
        if (!relatedGridEl) return;

        const resultLimit = 6;
        const cardId = safeString(card?.id, '');
        const cardName = safeString(card?.name, '');
        const pokemonFamily = derivePokemonFamilyName(cardName);

        relatedGridEl.replaceChildren(createElement('div', { className: 'col-12', text: 'Loading related cards...' }));

        /** @type {Array<any>} */
        let all = [];
        /** @type {any|null} */
        let lastError = null;

        const primaryQueries = [];
        if (pokemonFamily) {
            primaryQueries.push(buildFieldQuery('name', pokemonFamily));
        } else if (cardName) {
            primaryQueries.push(buildFieldQuery('name', cardName));
        }

        // Query only by Pokemon/name to avoid unrelated same-set cards.
        for (const query of primaryQueries) {
            try {
                const fetched = await fetchCardsForQuery(query, 8);
                all = mergeUniqueCardsById(all, fetched);
                if (all.length >= (resultLimit + 2)) break;
            } catch (e) {
                lastError = e;
            }
        }

        const familyLc = String(pokemonFamily || '').toLowerCase();
        const rows = all
            .filter((x) => safeString(x?.id, '') && safeString(x?.id, '') !== cardId)
            .filter((x) => {
                if (!familyLc) return true;
                const nameLc = safeString(x?.name, '').toLowerCase();
                return !!nameLc && nameLc.includes(familyLc);
            })
            .sort((a, b) => {
                const an = safeString(a?.name, '').toLowerCase();
                const bn = safeString(b?.name, '').toLowerCase();
                const aHas = familyLc && an.includes(familyLc) ? 1 : 0;
                const bHas = familyLc && bn.includes(familyLc) ? 1 : 0;
                if (aHas !== bHas) return bHas - aHas;
                return an.localeCompare(bn);
            })
            .slice(0, resultLimit);

        if (!rows.length) {
            if (lastError && (lastError.status === 429 || lastError.isQuotaExceeded)) {
                relatedGridEl.replaceChildren(createElement('div', {
                    className: 'col-12',
                    text: 'Related cards are temporarily unavailable because the daily allowance was reached.',
                }));
                return;
            }
            relatedGridEl.replaceChildren(createElement('div', {
                className: 'col-12',
                text: 'No related cards available for this Pokemon yet.',
            }));
            return;
        }

        relatedGridEl.replaceChildren(...rows.map((item) => {
            const name = safeString(item?.name, 'Card');
            const setName = getCardSetName(item);
            const img = sanitizeUrl(pickFrontMediumImage(item?.images));
            const href = buildCardDetailPath(item);

            const column = createElement('div', { className: 'pv-relatedCardItem' });
            const link = createElement('a', {
                className: 'pv-relatedCard',
                attributes: { href, 'aria-label': `View ${name} details` },
            });
            if (img) {
                link.append(createElement('img', {
                    className: 'pv-relatedCard__img',
                    attributes: { src: img, alt: `${name} card image`, loading: 'lazy' },
                }));
            }
            link.append(
                createElement('span', { className: 'pv-relatedCard__name', text: name }),
                createElement('span', { className: 'pv-relatedCard__set', text: setName })
            );
            column.append(link);
            return column;
        }));
    }

    async function copyToClipboard(text) {
        const value = String(text || '');
        if (!value) return false;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch {
            // ignore
        }

        try {
            const input = document.createElement('textarea');
            input.value = value;
            input.setAttribute('readonly', '');
            input.style.position = 'absolute';
            input.style.left = '-9999px';
            document.body.appendChild(input);
            input.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(input);
            return !!ok;
        } catch {
            return false;
        }
    }

    async function shareCurrentCard() {
        if (!currentCard) return;
        const detailPath = buildCardDetailPath(currentCard);
        const shareUrl = buildAbsoluteUrl(detailPath);
        const title = safeString(currentCard?.name, 'Pokemon card');
        const setName = getCardSetName(currentCard);
        const text = `${title} • ${setName}`;

        try {
            if (navigator.share) {
                await navigator.share({ title, text, url: shareUrl });
                setShareStatus('Share options opened.');
                return;
            }
        } catch (err) {
            const name = String(err?.name || '');
            if (name === 'AbortError') {
                setShareStatus('Share canceled.');
                return;
            }
        }

        const copied = await copyToClipboard(shareUrl);
        setShareStatus(copied ? 'Card link copied to clipboard.' : 'Unable to copy link on this browser.');
    }

    function renderCard(card) {
        currentCard = card;

        const name = safeString(card?.name, 'Unknown card');
        const number = getCardDisplayNumber(card) || 'n/a';
        const rarity = safeString(card?.rarity, 'n/a');
        const setName = getCardSetName(card);
        const image = sanitizeUrl(pickFrontMediumImage(card?.images));
        const updatedAt = card?.updatedAt || card?.updated_at || Date.now();

        if (titleEl) titleEl.textContent = name;
        if (setEl) setEl.textContent = setName;
        if (numberEl) numberEl.textContent = number || 'n/a';
        if (rarityEl) rarityEl.textContent = rarity || 'n/a';
        const primaryPrice = getPrimaryPriceSummary(card);
        if (marketLabelEl) marketLabelEl.textContent = primaryPrice.label;
        if (marketEl) marketEl.textContent = primaryPrice.text;
        if (marketLinkEl) marketLinkEl.hidden = !primaryPrice.isMultiple;
        if (updatedEl) updatedEl.textContent = toUiDate(updatedAt);

        if (imageEl) {
            if (image) {
                imageEl.src = image;
                imageEl.alt = `${name} card image`;
                imageEl.hidden = false;
            } else {
                imageEl.removeAttribute('src');
                imageEl.alt = '';
                imageEl.hidden = true;
            }
        }
        if (fullImageEl) {
            fullImageEl.src = image;
            fullImageEl.alt = image ? `${name} card image, full size` : '';
        }

        if (detailEl) detailEl.hidden = false;

        syncWatchButton(card.id);
        setSeo(card);
        renderPricing(card);
        void renderRelated(card);

        window.dispatchEvent(new CustomEvent('pv:card-loaded', {
            detail: {
                cardId: safeString(card?.id, ''),
                card,
            },
        }));
    }

    async function loadCardById(cardId) {
        const id = safeString(cardId, '').trim();
        if (!id) {
            setStatus('Missing card id in URL. Open a card from search results to view details.');
            return;
        }

        setStatus('Loading card details...');

        try {
            const base = getWorkerBase();
            const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
            const data = await fetchJsonWithCache(url, CARD_TTL_MS);
            const card = data?.data || data;
            if (!card || typeof card !== 'object') {
                setStatus('Card details not found.');
                return;
            }

            renderCard(card);
            setStatus('');
        } catch {
            setStatus('Unable to load this card right now. Please try again later.');
        }
    }

    function getCardIdFromLocation() {
        const params = new URLSearchParams(window.location.search || '');
        return safeString(params.get('id'), '').trim();
    }

    if (watchToggleEl) {
        watchToggleEl.addEventListener('click', () => {
            if (!currentCard) return;
            void toggleWatchlist(currentCard);
        });
    }

    if (shareBtnEl) {
        shareBtnEl.addEventListener('click', () => {
            void shareCurrentCard();
        });
    }

    if (imageOpenEl && imageModalEl) {
        imageOpenEl.addEventListener('click', () => {
            if (fullImageEl?.getAttribute('src')) imageModalEl.showModal();
        });
    }

    if (imageCloseEl && imageModalEl) {
        imageCloseEl.addEventListener('click', () => imageModalEl.close());
    }

    if (imageModalEl) {
        imageModalEl.addEventListener('click', (event) => {
            if (event.target === imageModalEl) imageModalEl.close();
        });
    }

    if (historyVariantEl) {
        historyVariantEl.addEventListener('change', () => {
            if (!currentCard) return;
            renderHistory(currentCard);
        });
    }

    if (historyConditionEl) {
        historyConditionEl.addEventListener('change', () => {
            if (!currentCard) return;
            renderHistory(currentCard);
        });
    }

    try {
        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged(() => {
                void hydrateWatchlistFromCloud();
            });
        }
    } catch {
        // ignore
    }

    const cardId = getCardIdFromLocation();
    void hydrateWatchlistFromCloud();
    void loadCardById(cardId);
});
