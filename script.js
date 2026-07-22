/* PokeValutor site JS */
(function () {
  const DISCORD_INVITE_URL = 'https://discord.gg/MnNy5K7zp';
  const year = document.getElementById('pv-year');
  const form = document.getElementById('pv-contactForm');
  const scrollTopBtn = document.getElementById('pv-scroll-top');

  // Update year in footer
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  function ensureFooterDiscordLink() {
    const footerLinkLists = Array.from(document.querySelectorAll('.pv-footer__links'));

    for (const linkList of footerLinkLists) {
      if (!(linkList instanceof HTMLElement)) continue;
      if (linkList.querySelector('a[data-pv-discord-link="1"]')) continue;

      const item = document.createElement('li');
      const link = document.createElement('a');
      const icon = document.createElement('span');
      const text = document.createElement('span');

      link.href = DISCORD_INVITE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.pvDiscordLink = '1';
      link.setAttribute('aria-label', 'Join our Discord community (opens in a new tab)');
      link.style.display = 'inline-flex';
      link.style.alignItems = 'center';
      link.style.gap = '0.32rem';

      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" focusable="false"><path fill="currentColor" d="M20.317 4.369A19.791 19.791 0 0 0 15.885 3c-.191.329-.403.775-.552 1.123a18.27 18.27 0 0 0-5.669 0A12.26 12.26 0 0 0 9.112 3a19.736 19.736 0 0 0-4.435 1.371C1.884 8.58 1.129 12.685 1.5 16.734a19.9 19.9 0 0 0 5.993 3.031c.483-.66.913-1.357 1.284-2.083-.704-.266-1.376-.594-2.007-.979.169-.124.334-.253.495-.385 3.87 1.808 8.07 1.808 11.894 0 .162.132.327.261.495.385-.631.385-1.305.713-2.01.979.372.726.803 1.423 1.286 2.083a19.854 19.854 0 0 0 5.996-3.034c.435-4.693-.743-8.76-3.609-12.362ZM8.017 14.238c-1.188 0-2.163-1.091-2.163-2.43 0-1.338.955-2.431 2.163-2.431 1.216 0 2.181 1.102 2.163 2.431 0 1.339-.955 2.43-2.163 2.43Zm7.975 0c-1.188 0-2.163-1.091-2.163-2.43 0-1.338.955-2.431 2.163-2.431 1.215 0 2.18 1.102 2.163 2.431 0 1.339-.948 2.43-2.163 2.43Z"/></svg>';

      text.textContent = 'Discord';

      link.appendChild(icon);
      link.appendChild(text);
      item.appendChild(link);
      linkList.appendChild(item);
    }
  }

  function ensureHeaderDiscordNavLink() {
    const navLists = Array.from(document.querySelectorAll('.pv-nav__list'));

    for (const navList of navLists) {
      if (!(navList instanceof HTMLElement)) continue;
      if (navList.querySelector('a[data-pv-discord-nav="1"]')) continue;

      const item = document.createElement('li');
      const link = document.createElement('a');

      item.className = 'pv-nav__item';
      link.className = 'pv-nav__link';
      link.href = DISCORD_INVITE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.pvDiscordNav = '1';
      link.setAttribute('aria-label', 'Join our Discord community (opens in a new tab)');
      link.textContent = 'Discord';

      item.appendChild(link);
      navList.appendChild(item);
    }
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

  function normalizePageName(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'index.html';

    const clean = raw.split('?')[0].split('#')[0];
    const noTrailingSlash = clean.replace(/\/+$/, '');
    if (!noTrailingSlash || noTrailingSlash === '/') return 'index.html';

    const segment = noTrailingSlash.split('/').filter(Boolean).pop() || '';
    return segment || 'index.html';
  }

  function isNavLinkForPage(linkEl, pageName) {
    if (!(linkEl instanceof HTMLAnchorElement)) return false;
    const rawHref = String(linkEl.getAttribute('href') || '').trim();
    const targetPage = normalizePageName(pageName);
    if (!rawHref || !targetPage) return false;

    try {
      const url = new URL(rawHref, window.location.href);
      const hrefPage = normalizePageName(url.pathname || '');
      return hrefPage === targetPage;
    } catch {
      const hrefPage = normalizePageName(rawHref.toLowerCase().replace(/^\.{0,2}\//, ''));
      return hrefPage === targetPage;
    }
  }

  function markCurrentNavLinks() {
    const currentPage = normalizePageName(window.location.pathname || '');
    const links = Array.from(document.querySelectorAll('.pv-nav .pv-nav__link'));

    for (const link of links) {
      if (!(link instanceof HTMLAnchorElement)) continue;

      const isCurrent = isNavLinkForPage(link, currentPage);
      if (isCurrent) {
        link.setAttribute('aria-current', 'page');
      } else if (link.getAttribute('aria-current') === 'page') {
        link.removeAttribute('aria-current');
      }
    }
  }

  function markPricingNavLinks() {
    const links = Array.from(document.querySelectorAll('.pv-nav .pv-nav__link'));
    for (const link of links) {
      if (isNavLinkForPage(link, 'pricing.html')) {
        link.classList.add('pv-nav__link--pricing');
      }
    }
  }

  function createDesktopOverflowMenu(navList) {
    if (!(navList instanceof HTMLElement)) return;
    if (navList.dataset.pvDesktopCondensed === '1') return;

    const topLevelLinks = Array.from(navList.querySelectorAll(':scope > .pv-nav__item > .pv-nav__link'));
    const overflowPaths = ['sealed.html', 'account.html'];
    const overflowItems = [];

    for (const path of overflowPaths) {
      const link = topLevelLinks.find((candidate) => isNavLinkForPage(candidate, path));
      const item = link?.closest('.pv-nav__item');
      if (item && !overflowItems.includes(item)) {
        overflowItems.push(item);
      }
    }

    // Keep Discord in the desktop overflow menu and place it last.
    const discordLink = topLevelLinks.find((candidate) => candidate.dataset.pvDiscordNav === '1');
    const discordItem = discordLink?.closest('.pv-nav__item');
    if (discordItem && !overflowItems.includes(discordItem)) {
      overflowItems.push(discordItem);
    }

    if (!overflowItems.length) return;

    const moreItem = document.createElement('li');
    moreItem.className = 'pv-nav__item pv-nav__item--more';

    const moreDetails = document.createElement('details');
    moreDetails.className = 'pv-navMore';

    const moreSummary = document.createElement('summary');
    moreSummary.className = 'pv-navMore__summary';
    moreSummary.textContent = 'More';
    moreDetails.appendChild(moreSummary);

    const moreMenu = document.createElement('ul');
    moreMenu.className = 'pv-navMore__menu';

    let hasCurrentChild = false;
    for (const sourceItem of overflowItems) {
      const sourceLink = sourceItem.querySelector('.pv-nav__link');
      if (!(sourceLink instanceof HTMLAnchorElement)) continue;

      const row = document.createElement('li');
      row.className = 'pv-navMore__item';

      const menuLink = document.createElement('a');
      menuLink.className = 'pv-navMore__link';
      menuLink.href = String(sourceLink.getAttribute('href') || '#');
      menuLink.textContent = String(sourceLink.textContent || '').trim() || 'Link';

      if (sourceLink.hasAttribute('target')) {
        menuLink.setAttribute('target', String(sourceLink.getAttribute('target') || ''));
      }
      if (sourceLink.hasAttribute('rel')) {
        menuLink.setAttribute('rel', String(sourceLink.getAttribute('rel') || ''));
      }
      if (sourceLink.hasAttribute('aria-label')) {
        menuLink.setAttribute('aria-label', String(sourceLink.getAttribute('aria-label') || ''));
      }

      if (sourceLink.hasAttribute('aria-current')) {
        menuLink.setAttribute('aria-current', String(sourceLink.getAttribute('aria-current') || 'page'));
        hasCurrentChild = true;
      }

      row.appendChild(menuLink);
      moreMenu.appendChild(row);
      sourceItem.classList.add('pv-nav__item--desktopOverflow');
    }

    if (!moreMenu.childElementCount) return;

    if (hasCurrentChild) {
      moreDetails.classList.add('pv-navMore--hasCurrent');
    }

    moreDetails.appendChild(moreMenu);
    moreItem.appendChild(moreDetails);
    navList.appendChild(moreItem);
    navList.dataset.pvDesktopCondensed = '1';

    document.addEventListener('click', (event) => {
      if (!moreDetails.open) return;
      const target = event.target;
      if (target instanceof Node && moreDetails.contains(target)) return;
      moreDetails.open = false;
    });
  }

  function setupDesktopNavOverflow() {
    const navLists = Array.from(document.querySelectorAll('.pv-nav__list'));
    for (const list of navLists) {
      createDesktopOverflowMenu(list);
    }
  }

  function roleFromClaims(claims) {
    const roleRaw = String(claims?.role || claims?.tier || '').trim().toLowerCase();
    if (roleRaw === 'premium' || roleRaw === 'admin' || roleRaw === 'tester' || roleRaw === 'basic') {
      return roleRaw;
    }
    return '';
  }

  function setPricingNavHidden(hidden) {
    const shouldHide = Boolean(hidden);
    const isOnPricingPage = normalizePageName(window.location.pathname || '') === 'pricing.html';
    const links = Array.from(document.querySelectorAll('.pv-nav .pv-nav__link'));

    for (const link of links) {
      if (!isNavLinkForPage(link, 'pricing.html')) continue;
      const keepVisible = isOnPricingPage || link.getAttribute('aria-current') === 'page';
      const hideThisLink = shouldHide && !keepVisible;
      const item = link.closest('.pv-nav__item');
      if (item) {
        item.classList.toggle('pv-nav__item--pricingVisible', !hideThisLink);
        item.classList.toggle('pv-nav__item--hiddenByRole', hideThisLink);
      } else {
        link.hidden = hideThisLink;
      }
    }
  }

  async function refreshPricingNavVisibility(authApi) {
    try {
      const user = authApi?.getUser ? authApi.getUser() : null;
      if (!user) {
        setPricingNavHidden(false);
        return;
      }

      if (typeof authApi?.getIdTokenResult !== 'function') {
        setPricingNavHidden(false);
        return;
      }

      let role = '';
      try {
        const token = await authApi.getIdTokenResult(false);
        role = roleFromClaims(token?.claims || null);
      } catch {
        role = '';
      }

      if (!role) {
        try {
          const refreshed = await authApi.getIdTokenResult(true);
          role = roleFromClaims(refreshed?.claims || null);
        } catch {
          role = '';
        }
      }

      const hidePricing = role === 'premium' || role === 'admin' || role === 'tester';
      setPricingNavHidden(hidePricing);
    } catch {
      setPricingNavHidden(false);
    }
  }

  function pageHasAuthBootstrapScripts() {
    const scriptEls = Array.from(document.querySelectorAll('script[src]'));
    for (const el of scriptEls) {
      const src = String(el.getAttribute('src') || '').toLowerCase();
      if (!src) continue;
      if (src.includes('firebase.js')) return true;
      if (src.includes('firebase-config.js')) return true;
      if (src.includes('firebase-config.local.js')) return true;
      if (src.includes('firebase-auth-compat.js')) return true;
    }
    return false;
  }

  function setupAuthAwarePricingNavVisibility() {
    if (!pageHasAuthBootstrapScripts()) {
      // Pages without auth bootstrap (like Home) should not wait on auth polling.
      setPricingNavHidden(false);
      return;
    }

    const deadline = Date.now() + 8000;

    const tryAttach = () => {
      const authApi = window?.PV_AUTH;
      if (authApi && typeof authApi.getUser === 'function') {
        const runRefresh = () => {
          void refreshPricingNavVisibility(authApi);
        };

        if (typeof authApi.onAuthStateChanged === 'function') {
          let firstAuthCallbackReceived = false;
          authApi.onAuthStateChanged(() => {
            firstAuthCallbackReceived = true;
            runRefresh();
          });

          // Safety fallback in case the provider does not emit quickly.
          window.setTimeout(() => {
            if (!firstAuthCallbackReceived) {
              runRefresh();
            }
          }, 1500);
        } else {
          runRefresh();
        }
        return;
      }

      if (Date.now() < deadline) {
        window.setTimeout(tryAttach, 250);
      } else {
        // If auth never becomes available on this page, fall back to visible.
        setPricingNavHidden(false);
      }
    };

    tryAttach();
  }

  function parseJsonSafe(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function isStorageQuotaExceededErrorShared(error) {
    const code = Number(error?.code);
    const name = String(error?.name || '').trim().toLowerCase();
    const message = String(error?.message || '').trim().toLowerCase();

    if (code === 22 || code === 1014) return true;
    if (name === 'quotaexceedederror' || name === 'ns_error_dom_quota_reached') return true;
    if (message.includes('quota') || message.includes('storage')) return true;
    return false;
  }

  function getUrlCacheKeysByOldestSaveShared(cachePrefix, parseJsonFn) {
    const keys = [];
    const prefix = String(cachePrefix || '');
    const parse = typeof parseJsonFn === 'function' ? parseJsonFn : parseJsonSafe;

    if (!prefix) return keys;

    try {
      const urlPrefix = `${prefix}url:`;
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(urlPrefix)) continue;

        const parsed = parse(localStorage.getItem(key));
        const savedAt = Number(parsed?.savedAt || 0);
        keys.push({ key, savedAt: Number.isFinite(savedAt) ? savedAt : 0 });
      }
    } catch {
      // ignore
    }

    keys.sort((a, b) => a.savedAt - b.savedAt);
    return keys;
  }

  function writeCriticalStorageItemShared(options) {
    const key = String(options?.key || '').trim();
    if (!key) return false;

    const serialized = String(options?.serialized ?? '');
    const cachePrefix = String(options?.cachePrefix || '');
    const parseJsonFn = options?.parseJson;
    const lastResultsKey = String(options?.lastResultsKey || '').trim();
    const preCleanup = options?.preCleanup;

    function tryWrite() {
      try {
        localStorage.setItem(key, serialized);
        return true;
      } catch (error) {
        return isStorageQuotaExceededErrorShared(error) ? null : false;
      }
    }

    let writeResult = tryWrite();
    if (writeResult !== null) return writeResult;

    if (typeof preCleanup === 'function') {
      try {
        preCleanup();
      } catch {
        // ignore
      }

      writeResult = tryWrite();
      if (writeResult !== null) return writeResult;
    }

    const cacheKeys = getUrlCacheKeysByOldestSaveShared(cachePrefix, parseJsonFn);
    for (const entry of cacheKeys) {
      try {
        localStorage.removeItem(entry.key);
      } catch {
        // ignore
      }

      writeResult = tryWrite();
      if (writeResult !== null) return writeResult;
    }

    if (lastResultsKey) {
      try {
        localStorage.removeItem(lastResultsKey);
      } catch {
        // ignore
      }
    }

    writeResult = tryWrite();
    return writeResult === true;
  }

  function getCollectionStorageWriteFailureMessageShared() {
    return 'Could not save this collection change. Local storage is full; please try again.';
  }

  window.PV_STORAGE_UTIL = Object.freeze({
    isStorageQuotaExceededError: isStorageQuotaExceededErrorShared,
    getUrlCacheKeysByOldestSave: getUrlCacheKeysByOldestSaveShared,
    writeCriticalStorageItem: writeCriticalStorageItemShared,
    getCollectionStorageWriteFailureMessage: getCollectionStorageWriteFailureMessageShared,
  });

  markCurrentNavLinks();
  markPricingNavLinks();
  ensureHeaderDiscordNavLink();
  setupDesktopNavOverflow();
  setupAuthAwarePricingNavVisibility();
  ensureFooterDiscordLink();

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
  const HOME_MARKET_SNAPSHOT_KEY = 'pv:home:cardMarketSnapshots:v1';
  const HOME_URL_CACHE_PREFIX = 'pv:home:url:';
  const HOME_SPOTLIGHTS_TTL_MS = 60 * 60 * 1000;
  const HOME_LATEST_EXPANSIONS_CACHE_KEY = 'pv:expansions:latestEnglish:v6';
  const HOME_LATEST_EXPANSIONS_VERSION_KEY = 'pv:expansions:latestEnglish:version:v1';
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

  function getHomeLatestSetsVersion() {
    try {
      return String(localStorage.getItem(HOME_LATEST_EXPANSIONS_VERSION_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function setHomeLatestSetsVersion(version) {
    try {
      const value = String(version || '').trim();
      if (!value) {
        localStorage.removeItem(HOME_LATEST_EXPANSIONS_VERSION_KEY);
        return;
      }
      localStorage.setItem(HOME_LATEST_EXPANSIONS_VERSION_KEY, value);
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

  function getCardNameAndRarity(cardLike) {
    const name = String(cardLike?.name || 'Card').trim() || 'Card';
    const rarity = String(cardLike?.rarity || '').trim();
    return { name, rarity };
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


  async function fetchJsonWithOptionalAuth(url, initOverrides) {
    /** @type {Record<string, string>|undefined} */
    let headers;
    try {
      const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
      const token = String(tokenRaw || '').trim();
      if (token) headers = { Authorization: `Bearer ${token}` };
    } catch {
      // ignore
    }

    const init = {
      method: 'GET',
      headers,
      ...(initOverrides && typeof initOverrides === 'object' ? initOverrides : {}),
    };

    const res = await fetch(url, init);
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

  async function fetchHomeLatestSetsVersion() {
    const base = getWorkerBase();
    const data = await fetchJsonWithOptionalAuth(`${base}/expansions/latest-version`, { cache: 'no-store' });
    return String(data?.version || '').trim();
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
            const cardText = getCardNameAndRarity(card);
            const rarityLabel = cardText.rarity
              ? `<span class="pv-miniCard__rarity"> • ${escapeText(cardText.rarity)}</span>`
              : '';
            return `<li class="pv-miniCard__subItem"><strong>${escapeText(cardText.name)}${rarityLabel}</strong><span>${escapeText(formatUsd(market))}</span></li>`;
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

    /** @type {Map<string, any>} */
    const byId = new Map();
    for (const item of watchlist) {
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
        const data = await fetchJsonWithOptionalAuth(url, { cache: 'no-store' });
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

    let latestVersion = '';
    try {
      latestVersion = await fetchHomeLatestSetsVersion();
    } catch {
      latestVersion = '';
    }

    const cachedVersion = getHomeLatestSetsVersion();
    let renderedFromCache = false;
    const cached = cacheGet(CACHE_KEY);
    if ((!Array.isArray(cached) || !cached.length) && cachedVersion) {
      setHomeLatestSetsVersion('');
    }
    const shouldUseCachedExpansions = Array.isArray(cached)
      && cached.length
      && (!latestVersion || (cachedVersion && cachedVersion === latestVersion));

    if (shouldUseCachedExpansions) {
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
      const urlObj = new URL(`${base}/expansions/search`);
      urlObj.searchParams.set('q', q);
      urlObj.searchParams.set('orderBy', '-release_date');
      urlObj.searchParams.set('page', '1');
      urlObj.searchParams.set('pageSize', String(pageSize));
      urlObj.searchParams.set('select', 'id,name,logo,release_date,is_online_only,series,language,language_code');
      urlObj.searchParams.set('casing', 'camel');
      if (latestVersion) {
        // Include refresh version in the URL so browser caches are naturally invalidated.
        urlObj.searchParams.set('latestVersion', latestVersion);
      }
      const url = urlObj.toString();

      /** @type {Record<string, string>|undefined} */
      let headers;
      try {
        const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
        const token = String(tokenRaw || '').trim();
        if (token) headers = { Authorization: `Bearer ${token}` };
      } catch {
        // ignore
      }

      // Avoid browser HTTP-cache reuse for this endpoint because freshness is
      // controlled by localStorage versioning plus the latest-version check.
      const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
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
        if (latestVersion) setHomeLatestSetsVersion(latestVersion);
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
