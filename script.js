/* PokeValutor site JS */
(function () {
  const year = document.getElementById('pv-year');
  const form = document.getElementById('pv-contactForm');
  const scrollTopBtn = document.getElementById('pv-scroll-top');

  // Update year in footer
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  // Mobile nav toggles with ARIA sync (works across pages)
  const navToggles = Array.from(document.querySelectorAll('.pv-navToggle'));
  for (const btn of navToggles) {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));

      const targetId = btn.getAttribute('aria-controls');
      if (!targetId) return;
      const nav = document.getElementById(targetId);
      if (!nav) return;
      nav.setAttribute('aria-expanded', String(!expanded));
    });
  }

  // Shared scroll-to-top behavior for pages that include the floating button.
  if (scrollTopBtn && scrollTopBtn.getAttribute('data-bound') !== '1') {
    scrollTopBtn.setAttribute('data-bound', '1');
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Contact form handler (Formspree)
  if (form) {
    const statusEl = document.getElementById('pv-contactStatus');
    const submitBtn = document.getElementById('pv-submit');

    function setStatus(message) {
      if (statusEl) statusEl.textContent = String(message || '');
    }

    form.addEventListener('submit', async (e) => {
      const action = String(form.getAttribute('action') || '');
      const isFormspree = /(^|\/\/)formspree\.io\//i.test(action);

      // If this ever becomes a non-Formspree form, don't interfere.
      if (!isFormspree) return;

      e.preventDefault();
      setStatus('Sending…');

      if (submitBtn && 'disabled' in submitBtn) submitBtn.disabled = true;

      try {
        const formData = new FormData(form);
        const res = await fetch(action, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (res.ok) {
          setStatus('Thanks! Your message has been sent. Redirecting…');
          form.reset();

          // Redirect to a static success page (GitHub Pages friendly).
          window.setTimeout(() => {
            window.location.href = 'thanks.html';
          }, 600);
          return;
        }

        // Formspree returns JSON with error details when possible.
        let errorMsg = 'Sorry, there was a problem sending your message. Please try again.';
        try {
          const data = await res.json();
          if (data && typeof data === 'object' && Array.isArray(data.errors) && data.errors.length) {
            const first = data.errors[0];
            if (first && typeof first.message === 'string' && first.message.trim()) {
              errorMsg = first.message.trim();
            }
          }
        } catch {
          // ignore
        }
        setStatus(errorMsg);
      } catch {
        setStatus('Network error. Please check your connection and try again.');
      } finally {
        if (submitBtn && 'disabled' in submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Home page: latest expansions marquee
  const expansionsTrack = document.getElementById('pv-expansions-track');
  const expansionsViewport = document.getElementById('pv-expansions-marquee');
  const latestSpotlightsGrid = document.getElementById('pv-latest-spotlights');
  const trendingGrid = document.getElementById('pv-trending-grid');

  const HOME_CARD_WATCHLIST_KEY = 'pv:scrydex:watchlist:v1';
  const HOME_CARD_LAST_RESULTS_KEY = 'pv:scrydex:lastResults:v1';
  const HOME_MARKET_SNAPSHOT_KEY = 'pv:home:cardMarketSnapshots:v1';
  const HOME_URL_CACHE_PREFIX = 'pv:home:url:';
  const HOME_TRENDING_CARD_TTL_MS = 15 * 60 * 1000;
  const HOME_SPOTLIGHTS_TTL_MS = 60 * 60 * 1000;
  const HOME_LATEST_EXPANSIONS_CACHE_KEY = 'pv:expansions:latestEnglish:v6';
  const HOME_LATEST_EXPANSIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const HOME_LATEST_EXPANSIONS_REVALIDATE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

  function getWorkerBase() {
    // Keep consistent with search/sealed pages.
    const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
    return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toDateLabel(isoDate) {
    const raw = String(isoDate || '').trim();
    if (!raw) return '';

    // Scrydex uses YYYY/MM/DD for release_date.
    const m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    const d = m
      ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      : new Date(raw);

    if (Number.isNaN(d.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
    } catch {
      return raw;
    }
  }

  function safeParseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function cacheGetStale(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!('value' in parsed)) return null;
      return parsed.value;
    } catch {
      return null;
    }
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.expiresAt !== 'number' || !('value' in parsed)) return null;
      if (Date.now() > parsed.expiresAt) {
        try { localStorage.removeItem(key); } catch {}
        return null;
      }
      return parsed.value;
    } catch {
      return null;
    }
  }

  function cacheSet(key, value, ttlMs) {
    try {
      const payload = { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function formatUsd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'N/A';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  }

  function readJsonStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return safeParseJson(raw);
    } catch {
      return null;
    }
  }

  function readArrayStorage(key) {
    const parsed = readJsonStorage(key);
    return Array.isArray(parsed) ? parsed : [];
  }

  function readObjectStorage(key) {
    const parsed = readJsonStorage(key);
    return parsed && typeof parsed === 'object' ? parsed : null;
  }

  function getCardSetName(cardLike) {
    const expansionName = String(cardLike?.expansion?.name || '').trim();
    const setName = String(cardLike?.set?.name || '').trim();
    const direct = String(cardLike?.expansionName || cardLike?.setName || '').trim();
    return expansionName || setName || direct || 'Unknown set';
  }

  function getCardThumb(cardLike) {
    const imageObj = cardLike?.images;
    if (imageObj && typeof imageObj === 'object' && !Array.isArray(imageObj)) {
      const direct = String(imageObj.small || imageObj.medium || imageObj.large || '').trim();
      if (direct) return direct;
    }

    const images = Array.isArray(cardLike?.images) ? cardLike.images : [];
    const front = images.find((img) => String(img?.type || '').toLowerCase() === 'front');
    const src = String(front?.small || front?.medium || front?.large || images[0]?.small || images[0]?.medium || images[0]?.large || '').trim();
    return src;
  }

  function getBestMarketFromCard(cardLike) {
    const variants = Array.isArray(cardLike?.variants) ? cardLike.variants : [];
    let best = null;

    for (const variant of variants) {
      const prices = Array.isArray(variant?.prices) ? variant.prices : [];
      for (const price of prices) {
        const raw = price?.market ?? price?.marketPrice ?? price?.market_price;
        const market = Number(raw);
        if (!Number.isFinite(market) || market <= 0) continue;
        if (best == null || market > best) best = market;
      }
    }

    return best;
  }


  async function fetchJsonWithOptionalAuth(url) {
    /** @type {Record<string, string>|undefined} */
    let headers;
    try {
      const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
      const token = String(tokenRaw || '').trim();
      if (token) headers = { Authorization: `Bearer ${token}` };
    } catch {
      // ignore
    }

    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    const data = safeParseJson(text);
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && (data.error || data.message))
        ? (data.error || data.message)
        : `Request failed (${res.status})`;
      throw new Error(String(msg));
    }
    return data;
  }

  async function fetchJsonWithOptionalAuthAndCache(url, ttlMs) {
    const cacheKey = `${HOME_URL_CACHE_PREFIX}${url}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const data = await fetchJsonWithOptionalAuth(url);
    cacheSet(cacheKey, data, ttlMs);
    return data;
  }

  function buildSearchLinkForCard(cardLike) {
    const expansionId = String(cardLike?.expansion?.id || '').trim();
    const expansionName = getCardSetName(cardLike);
    if (expansionId) {
      return `search.html?expansionId=${encodeURIComponent(expansionId)}&expansionName=${encodeURIComponent(expansionName)}`;
    }
    return 'search.html';
  }

  async function renderLatestSetSpotlights(expansions) {
    if (!latestSpotlightsGrid) return;

    const picks = (Array.isArray(expansions) ? expansions : [])
      .filter((x) => x && typeof x === 'object' && String(x.id || '').trim())
      .slice(0, 3);

    if (!picks.length) {
      latestSpotlightsGrid.innerHTML = '<article class="pv-miniCard"><p class="pv-miniCard__meta">Latest set spotlights will appear here after data loads.</p></article>';
      return;
    }

    const base = getWorkerBase();
    const settled = await Promise.allSettled(
      picks.map(async (setInfo) => {
        const url = `${base}/cards/top-by-expansion?expansionId=${encodeURIComponent(String(setInfo.id || ''))}&limit=3&lang=en`;
        const data = await fetchJsonWithOptionalAuthAndCache(url, HOME_SPOTLIGHTS_TTL_MS);
        const cards = Array.isArray(data?.data) ? data.data.slice(0, 3) : [];
        return { setInfo, cards };
      })
    );

    const html = settled.map((result, idx) => {
      const fallbackSet = picks[idx] || {};
      const payload = result.status === 'fulfilled' ? result.value : { setInfo: fallbackSet, cards: [] };
      const setInfo = payload.setInfo || fallbackSet;
      const setName = String(setInfo?.name || 'Latest set');
      const setDate = toDateLabel(setInfo?.releaseDate || setInfo?.release_date);
      const setLogo = String(setInfo?.logo || '').trim() || svgLogoDataUri(setName);
      const href = `search.html?expansionId=${encodeURIComponent(String(setInfo?.id || ''))}&expansionName=${encodeURIComponent(setName)}`;

      const topRows = payload.cards.length
        ? payload.cards.map((card) => {
            const market = getBestMarketFromCard(card);
            return `<li class="pv-miniCard__subItem"><strong>${escapeText(String(card?.name || 'Card'))}</strong><span>${escapeText(formatUsd(market))}</span></li>`;
          }).join('')
        : '<li class="pv-miniCard__subItem"><span>Top cards loading unavailable right now.</span></li>';

      return `
        <article class="pv-miniCard">
          <a href="${escapeText(href)}" aria-label="Open ${escapeText(setName)} top cards">
            <div class="pv-miniCard__head">
              <img class="pv-miniCard__thumb pv-miniCard__thumb--set" src="${escapeText(setLogo)}" alt="${escapeText(setName)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              <div>
                <p class="pv-miniCard__title">${escapeText(setName)}</p>
                <p class="pv-miniCard__meta">${escapeText(setDate || 'New release')}</p>
              </div>
              <span class="pv-miniCard__badge">Set</span>
            </div>
          </a>
          <ul class="pv-miniCard__subList">${topRows}</ul>
        </article>
      `;
    }).join('');

    latestSpotlightsGrid.innerHTML = html;
  }

  async function renderTrendingCards() {
    if (!trendingGrid) return;

    const watchlist = readArrayStorage(HOME_CARD_WATCHLIST_KEY);
    const cardState = readObjectStorage(HOME_CARD_LAST_RESULTS_KEY);
    const stateCards = Array.isArray(cardState?.cards) ? cardState.cards : [];

    /** @type {Map<string, any>} */
    const byId = new Map();
    const seed = watchlist.length ? watchlist : stateCards;
    for (const item of seed) {
      const id = String(item?.id || '').trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, item);
      if (byId.size >= 6) break;
    }

    const candidates = Array.from(byId.values());
    if (!candidates.length) {
      trendingGrid.innerHTML = '<article class="pv-miniCard"><p class="pv-miniCard__meta">Add cards to your watchlist to unlock movement tracking.</p></article>';
      return;
    }

    const previousMap = readObjectStorage(HOME_MARKET_SNAPSHOT_KEY) || {};
    const nextMap = { ...previousMap };
    const base = getWorkerBase();

    const settled = await Promise.allSettled(
      candidates.map(async (item) => {
        const id = String(item?.id || '').trim();
        const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
        const data = await fetchJsonWithOptionalAuthAndCache(url, HOME_TRENDING_CARD_TTL_MS);
        const card = data?.data || data || item;
        const market = getBestMarketFromCard(card);

        const prevMarket = Number(previousMap?.[id]?.market);
        const hasPrev = Number.isFinite(prevMarket);
        const hasNow = Number.isFinite(market);
        const delta = hasPrev && hasNow ? Number(market) - prevMarket : null;

        if (hasNow) {
          nextMap[id] = {
            market: Number(market),
            seenAt: Date.now(),
            name: String(card?.name || item?.name || ''),
          };
        }

        return {
          id,
          name: String(card?.name || item?.name || 'Unknown card'),
          setName: getCardSetName(card || item),
          image: getCardThumb(card || item) || svgLogoDataUri(String(card?.name || item?.name || 'Card')),
          market: hasNow ? Number(market) : null,
          prevMarket: hasPrev ? prevMarket : null,
          delta,
          href: buildSearchLinkForCard(card || item),
        };
      })
    );

    try {
      const entries = Object.entries(nextMap)
        .sort((a, b) => Number(b?.[1]?.seenAt || 0) - Number(a?.[1]?.seenAt || 0))
        .slice(0, 200);
      localStorage.setItem(HOME_MARKET_SNAPSHOT_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // ignore
    }

    const rows = settled
      .filter((x) => x.status === 'fulfilled')
      .map((x) => x.value)
      .sort((a, b) => Math.abs(Number(b?.delta || 0)) - Math.abs(Number(a?.delta || 0)));

    if (!rows.length) {
      trendingGrid.innerHTML = '<article class="pv-miniCard"><p class="pv-miniCard__meta">Trending cards are temporarily unavailable.</p></article>';
      return;
    }

    trendingGrid.innerHTML = rows.map((row) => {
      const delta = Number(row.delta);
      const hasDelta = Number.isFinite(delta);

      let deltaClass = 'pv-miniCard__delta pv-miniCard__delta--flat';
      let deltaText = 'New';
      if (hasDelta) {
        if (delta > 0.009) {
          deltaClass = 'pv-miniCard__delta pv-miniCard__delta--up';
          deltaText = `+${formatUsd(delta)}`;
        } else if (delta < -0.009) {
          deltaClass = 'pv-miniCard__delta pv-miniCard__delta--down';
          deltaText = `${formatUsd(delta)}`;
        } else {
          deltaClass = 'pv-miniCard__delta pv-miniCard__delta--flat';
          deltaText = 'Flat';
        }
      }

      const marketLine = Number.isFinite(row.market)
        ? `Now ${formatUsd(row.market)}${Number.isFinite(row.prevMarket) ? ` • Prev ${formatUsd(row.prevMarket)}` : ''}`
        : 'Market currently unavailable';

      return `
        <article class="pv-miniCard">
          <a href="${escapeText(row.href)}" aria-label="Open ${escapeText(row.name)}">
            <div class="pv-miniCard__head">
              <img class="pv-miniCard__thumb" src="${escapeText(row.image)}" alt="${escapeText(row.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              <div>
                <p class="pv-miniCard__title">${escapeText(row.name)}</p>
                <p class="pv-miniCard__meta">${escapeText(row.setName)}</p>
              </div>
              <span class="${deltaClass}">${escapeText(deltaText)}</span>
            </div>
          </a>
          <p class="pv-miniCard__meta">${escapeText(marketLine)}</p>
        </article>
      `;
    }).join('');
  }

  function svgLogoDataUri(label) {
    const safe = String(label || '').slice(0, 40);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160" viewBox="0 0 420 160">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#FFCB05" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#A78BFA" stop-opacity="0.14"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="420" height="160" rx="20" fill="#0b0b0b"/>
  <rect x="0" y="0" width="420" height="160" rx="20" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" font-weight="800">${escapeText(safe)}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function renderExpansionsList(expansions) {
    if (!expansionsTrack) return;
    const list = Array.isArray(expansions) ? expansions : [];

    const html = list.map((x) => {
      const id = String(x?.id || '').trim();
      const name = String(x?.name || '');
      const dateLabel = toDateLabel(x?.releaseDate || x?.release_date);
      const logoSrc = String(x?.logo || x?.logoSrc || '').trim();
      const src = logoSrc ? logoSrc : svgLogoDataUri(name || 'Expansion');
      const href = id
        ? `search.html?expansionId=${encodeURIComponent(id)}&expansionName=${encodeURIComponent(name)}`
        : 'search.html';

      return `
        <li class="pv-marquee__item" role="listitem">
          <a class="pv-expansionCardLink" href="${escapeText(href)}" aria-label="View top cards for ${escapeText(name)}">
            <article class="pv-expansionCard" aria-label="${escapeText(name)}">
              <div class="pv-expansionCard__logo">
                <img src="${escapeText(src)}" alt="${escapeText(name)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              </div>
              <p class="pv-expansionCard__name">${escapeText(name)}</p>
              <p class="pv-expansionCard__date">${escapeText(dateLabel)}</p>
            </article>
          </a>
        </li>`;
    }).join('');

    expansionsTrack.innerHTML = html;
  }

  async function loadLatestEnglishExpansions() {
    // Only run on pages that have the marquee.
    if (!expansionsTrack) return;

    const LATEST_EXPANSIONS_COUNT = 20;

    // Bump this key when filtering/shape changes so old cached results don't linger.
    const CACHE_KEY = HOME_LATEST_EXPANSIONS_CACHE_KEY;
    const TTL_MS = HOME_LATEST_EXPANSIONS_TTL_MS;
    const REVALIDATE_AFTER_MS = HOME_LATEST_EXPANSIONS_REVALIDATE_AFTER_MS;

    function getCacheAgeMs(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return Number.POSITIVE_INFINITY;
        const parsed = safeParseJson(raw);
        const savedAt = Number(parsed?.savedAt);
        if (!Number.isFinite(savedAt)) return Number.POSITIVE_INFINITY;
        return Math.max(0, Date.now() - savedAt);
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    }

    function isExcludedExpansion(x) {
      const id = String(x?.id || '').toLowerCase();
      const name = String(x?.name || '').toLowerCase();
      const series = String(x?.series || '').toLowerCase();
      const lang = String(x?.language || '').toLowerCase();
      const langCode = String(x?.languageCode || x?.language_code || '').toLowerCase();
      const isOnlineOnly = Boolean(x?.isOnlineOnly ?? x?.is_online_only);

      if (lang && lang !== 'english') return true;
      if (langCode && langCode !== 'en') return true;

      // Pokémon Pocket / TCGP expansions.
      if (isOnlineOnly) return true;
      if (id.startsWith('tcgp') || id.includes('tcgp-')) return true;
      if (series.includes('pocket') || name.includes('pocket')) return true;

      // Promo expansions.
      if (series.includes('promo') || name.includes('promo')) return true;

      // McDonald's collections (e.g., mcd23, mcd24).
      if (id.startsWith('mcd') || name.includes('mcdonald') || series.includes('mcdonald')) return true;

      // Pokémon TCG Classic sets (e.g., clv, clc, clb).
      if (id === 'clv' || id === 'clc' || id === 'clb') return true;
      if (name.includes('tcg classic') || series.includes('tcg classic')) return true;

      // Energy-only expansions (e.g., sve).
      if (id === 'sve') return true;
      if (name.includes('energies') || series.includes('energies')) return true;

      return false;
    }

    function normalizeExpansions(list) {
      return (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x === 'object')
        .filter((x) => !isExcludedExpansion(x))
        .map((x) => ({
          id: String(x.id || ''),
          name: String(x.name || ''),
          logo: String(x.logo || ''),
          releaseDate: String(x.releaseDate || x.release_date || ''),
          // Keep these fields if present so future filtering stays accurate.
          series: x.series,
          language: x.language,
          languageCode: x.languageCode || x.language_code,
          isOnlineOnly: x.isOnlineOnly ?? x.is_online_only,
        }))
        .filter((x) => x.name)
        .slice(0, LATEST_EXPANSIONS_COUNT);
    }

    let renderedFromCache = false;
    const cached = cacheGet(CACHE_KEY);
    if (Array.isArray(cached) && cached.length) {
      const cleaned = normalizeExpansions(cached);
      if (cleaned.length) {
        // If older cache entries included excluded sets, overwrite cache with the cleaned list.
        if (cleaned.length !== cached.length) {
          cacheSet(CACHE_KEY, cleaned, TTL_MS);
        }
        renderExpansionsList(cleaned);
        void renderLatestSetSpotlights(cleaned);
        renderedFromCache = true;

        // Keep home fast by serving cache first, then refresh periodically.
        if (getCacheAgeMs(CACHE_KEY) < REVALIDATE_AFTER_MS) {
          return;
        }
      }
      // If cached list becomes empty after filtering, fall through to refetch.
    }

    // Fallback placeholder (renders immediately if the network is slow).
    if (!renderedFromCache) {
      renderExpansionsList([
        { name: 'Loading expansions…', releaseDate: '', logo: '' },
        { name: 'Please wait', releaseDate: '', logo: '' },
        { name: '', releaseDate: '', logo: '' },
        { name: '', releaseDate: '', logo: '' },
        { name: '', releaseDate: '', logo: '' },
        { name: '', releaseDate: '', logo: '' },
      ]);
    }

    try {
      const base = getWorkerBase();

      // Scrydex docs: expansions have `logo` and `release_date` (YYYY/MM/DD).
      // We call the Worker so API keys are never exposed in the browser.
      // Exclusions:
      // - Remove Pokémon Pocket / TCGP expansions (typically online-only)
      // - Remove promo expansions
      // - Keep English only
      const q = 'language:english -is_online_only:true -id:tcgp* -series:promo -name:promo -series:pocket -name:pocket';
      // Fetch more than we need so we can filter client-side and still show the latest N.
      const pageSize = Math.max(30, LATEST_EXPANSIONS_COUNT * 4);
      const url = `${base}/expansions/search?q=${encodeURIComponent(q)}&orderBy=-release_date&page=1&pageSize=${pageSize}&select=id,name,logo,release_date,is_online_only,series,language,language_code&casing=camel`;

      /** @type {Record<string, string>|undefined} */
      let headers;
      try {
        const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
        const token = String(tokenRaw || '').trim();
        if (token) headers = { Authorization: `Bearer ${token}` };
      } catch {
        // ignore
      }

      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text();
      const data = safeParseJson(text);

      if (!res.ok) {
        // If quota ever blocks this endpoint, fall back to last known cache so home never goes blank.
        if (res.status === 429) {
          const stale = cacheGetStale(CACHE_KEY);
          if (Array.isArray(stale) && stale.length) {
            const cleaned = normalizeExpansions(stale);
            if (cleaned.length) {
              renderExpansionsList(cleaned);
              void renderLatestSetSpotlights(cleaned);
              return;
            }
          }
        }
        const msg = (data && typeof data === 'object' && (data.error || data.message)) ? (data.error || data.message) : `Request failed (${res.status})`;
        throw new Error(String(msg));
      }

      const items = (data && typeof data === 'object' && Array.isArray(data.data)) ? data.data : [];

      const normalized = normalizeExpansions(items);

      if (normalized.length) {
        cacheSet(CACHE_KEY, normalized, TTL_MS);
        renderExpansionsList(normalized);
        void renderLatestSetSpotlights(normalized);
      }
    } catch {
      if (renderedFromCache) return;

      // Keep the placeholder if the API fails, but prefer any stale cache.
      const stale = cacheGetStale(CACHE_KEY);
      if (Array.isArray(stale) && stale.length) {
        const cleaned = normalizeExpansions(stale);
        if (cleaned.length) {
          renderExpansionsList(cleaned);
          void renderLatestSetSpotlights(cleaned);
        }
      }
    }
  }

  function setupExpansionsMarqueeScrolling() {
    if (!expansionsViewport || !expansionsTrack) return;

    // Prevent ending up in a blank area (especially on touch momentum scroll).
    function clampScrollLeft() {
      const max = Math.max(0, expansionsViewport.scrollWidth - expansionsViewport.clientWidth);
      const next = Math.max(0, Math.min(expansionsViewport.scrollLeft, max));
      if (expansionsViewport.scrollLeft !== next) expansionsViewport.scrollLeft = next;
    }

    let clampRaf = 0;
    expansionsViewport.addEventListener('scroll', () => {
      if (clampRaf) return;
      clampRaf = window.requestAnimationFrame(() => {
        clampRaf = 0;
        clampScrollLeft();
      });
    }, { passive: true });

    // Make mouse wheel feel natural: when hovering the marquee, wheel scrolls horizontally.
    // (Trackpads already send deltaX; this mainly helps mouse users.)
    // Make mouse wheel feel natural: when hovering the marquee, wheel scrolls horizontally.
    // (Trackpads already send deltaX; this mainly helps mouse users.)
    expansionsViewport.addEventListener('wheel', (e) => {
      if (!e) return;
      const dx = Math.abs(Number(e.deltaX || 0));
      const dy = Math.abs(Number(e.deltaY || 0));
      if (dy > dx && dy > 0) {
        e.preventDefault();
        expansionsViewport.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  void loadLatestEnglishExpansions();
  setupExpansionsMarqueeScrolling();
  void renderTrendingCards();
})();
