(function () {
  const form = document.getElementById('home-preview-search-form');
  const input = document.getElementById('home-preview-query');
  const status = document.getElementById('home-preview-search-status');
  const modeButtons = Array.from(document.querySelectorAll('[data-home-preview-mode]'));
  const resultTitle = document.getElementById('home-preview-results-title');
  const resultCount = document.querySelector('[data-home-preview-result-count]');
  const resultLink = document.querySelector('[data-home-preview-result-link]');
  const resultKicker = document.querySelector('[data-home-preview-result-kicker]');
  const clearButton = document.querySelector('[data-home-preview-clear]');
  const resultsSection = document.querySelector('[data-home-preview-results]');
  const cardsResultPanel = document.querySelector('[data-home-preview-result-panel="cards"]');
  const sealedResultPanel = document.querySelector('[data-home-preview-result-panel="sealed"]');
  const resultPanels = Array.from(document.querySelectorAll('[data-home-preview-result-panel]'));
  const stateButtons = Array.from(document.querySelectorAll('[data-home-preview-state]'));
  const statePanels = Array.from(document.querySelectorAll('[data-home-preview-state-panel]'));
  const retryButton = document.querySelector('[data-home-preview-retry]');
  const setTabsContainer = document.querySelector('[data-home-preview-set-tabs]');
  const setPanelsContainer = document.querySelector('[data-home-preview-set-panels]');
  const setStatus = document.querySelector('[data-home-preview-set-status]');
  const setTabsWrapper = document.querySelector('.home-preview-set-tabs-wrap');
  const recentSetsContainer = document.querySelector('[data-home-preview-recent-sets]');
  const recentSetsStatus = document.querySelector('[data-home-preview-recent-status]');
  const trendingSection = document.querySelector('[data-home-preview-trending]');
  const trendingList = document.querySelector('[data-home-preview-trending-list]');
  const trendingNote = document.querySelector('[data-home-preview-trending-note]');
  const accountCta = document.querySelector('#home-preview-main > section.home-preview-account-cta');
  const menuButton = document.getElementById('home-preview-menu-button');
  const navigation = document.getElementById('home-preview-nav');
  const imageDialog = document.querySelector('[data-home-preview-image-dialog]');
  const imageDialogImage = imageDialog?.querySelector('[data-home-preview-image-dialog-image]');
  const imageDialogClose = imageDialog?.querySelector('[data-home-preview-image-dialog-close]');
  const imageDialogTitle = imageDialog?.querySelector('[data-home-preview-image-dialog-title]');
  const liveSearchBase = (window.PV_SECRETS?.PV_API_URL || 'https://pokevalutor-v1.lreyperez18.workers.dev').replace(/\/$/, '');
  let activeMode = 'cards';
  const liveSearchCache = { cards: null, sealed: null };
  const liveSearchStorageKey = 'pv:home-preview:search-cache:v1';
  const homeCardWatchlistKey = 'pv:scrydex:watchlist:v1';
  const homeCardCacheKey = 'pv:home:cardRecords:v1';
  const homeMarketSnapshotKey = 'pv:home:cardMarketSnapshots:v1';
  const homeCardCacheTtlMs = 8 * 60 * 60 * 1000;
  let imageDialogReturnFocus = null;
  let authUserKey = null;
  let trendingRenderToken = 0;
  const authReady = new Promise((resolve) => {
    const authApi = window?.PV_AUTH;
    if (!authApi?.onAuthStateChanged) {
      if (accountCta) accountCta.hidden = false;
      resolve(null);
      return;
    }

    let settled = false;
    const settle = (user) => {
      const normalizedUser = user || null;
      const nextUserKey = String(normalizedUser?.uid || '');
      const authChanged = authUserKey !== nextUserKey;
      authUserKey = nextUserKey;
      if (accountCta) accountCta.hidden = Boolean(user);
      if (settled) {
        if (authChanged) void renderHomeTrendingCards();
        return;
      }
      settled = true;
      resolve(normalizedUser);
    };

    try {
      authApi.onAuthStateChanged(settle);
      window.setTimeout(() => settle(authApi.getUser ? authApi.getUser() : null), 5000);
    } catch {
      settle(null);
    }
  });

  let latestSetSpotlights = [];
  let activeSetId = '';
  function readLiveSearchCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(liveSearchStorageKey) || 'null');
      if (!parsed || typeof parsed !== 'object') return {};
      return ['cards', 'sealed'].reduce((cache, mode) => {
        const entry = parsed[mode];
        if (entry && typeof entry.query === 'string' && ['results', 'empty', 'error'].includes(entry.state)) {
          const items = mode === 'sealed' ? entry.products : entry.cards;
          if (entry.state === 'results' && (!Array.isArray(items) || !items.length)) {
            entry.state = 'empty';
            entry.resultCount = mode === 'sealed'
              ? `No sealed results for “${entry.query}”`
              : `No card results for “${entry.query}”`;
            entry.status = mode === 'sealed'
              ? `No sealed products found for ${entry.query}.`
              : `No cards found for ${entry.query}.`;
          }
          if (entry.state === 'empty') {
            entry.resultCount = mode === 'sealed'
              ? `No sealed results for “${entry.query}”`
              : `No card results for “${entry.query}”`;
            entry.status = mode === 'sealed'
              ? `No sealed products found for ${entry.query}.`
              : `No cards found for ${entry.query}.`;
          }
          cache[mode] = entry;
        }
        return cache;
      }, {});
    } catch {
      return {};
    }
  }

  function persistLiveSearchCache() {
    try {
      localStorage.setItem(liveSearchStorageKey, JSON.stringify(liveSearchCache));
    } catch {
      // Ignore unavailable or full browser storage.
    }
  }

  Object.assign(liveSearchCache, readLiveSearchCache());

  function setNavigationOpen(isOpen) {
    navigation.hidden = !isOpen;
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    menuButton.title = isOpen ? 'Close navigation' : 'Open navigation';
  }

  function closeImageDialog() {
    if (!imageDialog) return;
    imageDialog.hidden = true;
    imageDialogImage?.removeAttribute('src');
    imageDialogReturnFocus?.focus();
    imageDialogReturnFocus = null;
  }

  function openImageDialog(imageUrl, altText, sourceButton) {
    if (!imageDialog || !imageDialogImage || !imageUrl) return;
    imageDialogReturnFocus = sourceButton;
    imageDialogImage.src = imageUrl;
    imageDialogImage.alt = altText;
    if (imageDialogTitle) imageDialogTitle.textContent = altText;
    imageDialog.hidden = false;
    imageDialogClose?.focus();
  }

  imageDialogClose?.addEventListener('click', closeImageDialog);
  imageDialog?.addEventListener('click', function (event) {
    if (event.target === imageDialog) closeImageDialog();
  });

  menuButton.addEventListener('click', function () {
    setNavigationOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  for (const link of navigation.querySelectorAll('a')) {
    link.addEventListener('click', function () {
      setNavigationOpen(false);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && imageDialog && !imageDialog.hidden) {
      closeImageDialog();
      return;
    }
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setNavigationOpen(false);
      menuButton.focus();
    }
  });

  document.addEventListener('click', function (event) {
    if (menuButton.getAttribute('aria-expanded') === 'true' && !event.target.closest('.home-preview-header')) {
      setNavigationOpen(false);
    }
  });

  function setResultsSectionVisibility(isVisible) {
    if (resultsSection) resultsSection.hidden = !isVisible;
  }

  function updateSearchPreview(mode, options = {}) {
    const isSealed = mode === 'sealed';
    activeMode = isSealed ? 'sealed' : 'cards';
    const cachedSearch = liveSearchCache[activeMode];
    setResultsSectionVisibility(cachedSearch?.state === 'loading' || cachedSearch?.state === 'results');
    for (const panel of resultPanels) {
      panel.hidden = panel.dataset.homePreviewResultPanel !== mode;
    }

    if (cachedSearch) {
      resultTitle.textContent = cachedSearch.title;
      resultCount.textContent = cachedSearch.resultCount;
      resultKicker.textContent = 'Live search';
      resultLink.textContent = cachedSearch.linkText;
      resultLink.href = cachedSearch.linkHref;
      clearButton.hidden = false;
      input.value = cachedSearch.query;
      status.textContent = cachedSearch.status;
      if (!options.preserveResults) renderCachedSearchResults(activeMode, cachedSearch);
      setPreviewState(cachedSearch.state);
      return;
    }

    resultTitle.textContent = isSealed ? 'Sealed Search Results' : 'Card Search Results';
    resultCount.textContent = isSealed ? 'Search for a sealed product above.' : 'Search for a card or number above.';
    resultKicker.textContent = 'Live search';
    resultLink.textContent = isSealed ? 'Open sealed search →' : 'Open card search →';
    resultLink.href = isSealed ? 'sealed.html' : 'search.html';
    clearButton.hidden = true;
    input.value = '';
    setPreviewState('empty');
  }

  function formatLivePrice(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 'No market price';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numericValue);
  }

  function normalizeImageList(rawImages) {
    if (Array.isArray(rawImages)) return rawImages;
    if (typeof rawImages === 'string') {
      const url = rawImages.trim();
      return url ? [{ type: 'front', small: url, medium: url, large: url }] : [];
    }
    if (rawImages && typeof rawImages === 'object') {
      const small = String(rawImages.small || rawImages.thumbnail || rawImages.thumb || rawImages.url || rawImages.src || rawImages.image || '').trim();
      const medium = String(rawImages.medium || small).trim();
      const large = String(rawImages.large || medium || small).trim();
      if (small || medium || large) return [{ type: 'front', small, medium, large }];
    }
    return [];
  }

  function getSafeImageUrl(images, preferredSize = 'medium') {
    const imageList = normalizeImageList(images);
    const image = imageList.find((candidate) => String(candidate?.type || '').toLowerCase() === 'front') || imageList[0];
    const rawUrl = image?.[preferredSize] || image?.medium || image?.large || image?.small || '';
    try {
      const url = new URL(String(rawUrl), window.location.href);
      return url.protocol === 'https:' && url.hostname === 'images.scrydex.com' ? url.href : '';
    } catch {
      return '';
    }
  }

  async function fetchWithAuth(url, options) {
    const requestOptions = options && typeof options === 'object' ? { ...options } : {};
    const headers = new Headers(requestOptions.headers || {});
    try {
      await authReady;
      const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
      const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
      if (token && token.split('.').length === 3) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      // Continue as an anonymous request if Firebase auth is unavailable.
    }
    requestOptions.headers = headers;
    return fetch(url, requestOptions);
  }

  function createLiveImageButton(images, altText) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-preview-card-art';
    button.setAttribute('aria-label', `Expand image: ${altText}`);
    button.title = 'Click to expand image';
    const imageUrl = getSafeImageUrl(images);
    if (!imageUrl) {
      button.disabled = true;
      button.title = 'Image unavailable';
      button.setAttribute('aria-label', `${altText} image unavailable`);
      return button;
    }

    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = altText;
    image.src = imageUrl;
    image.addEventListener('error', function () {
      image.remove();
      button.disabled = true;
      button.title = 'Image unavailable';
      button.setAttribute('aria-label', `${altText} image unavailable`);
    }, { once: true });
    button.append(image);
    const expandedImageUrl = getSafeImageUrl(images, 'large') || imageUrl;
    button.addEventListener('click', function () {
      openImageDialog(expandedImageUrl, altText, button);
    });
    return button;
  }

  function getEntityImages(entity) {
    if (getSafeImageUrl(entity?.images)) return entity.images;
    const variant = Array.isArray(entity?.variants)
      ? entity.variants.find((candidate) => getSafeImageUrl(candidate?.images))
      : null;
    return variant?.images || entity?.image || entity?.imageUrl || '';
  }

  const latestSetCacheKey = 'pv:home-preview:latest-set-spotlights:v1';
  const latestSetCacheTtlMs = 60 * 60 * 1000;

  function readLatestSetCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(latestSetCacheKey) || 'null');
      if (!parsed || Number(parsed.expiresAt) <= Date.now() || !Array.isArray(parsed.value)) return null;
      return parsed.value;
    } catch {
      return null;
    }
  }

  function writeLatestSetCache(value) {
    try {
      localStorage.setItem(latestSetCacheKey, JSON.stringify({
        value,
        expiresAt: Date.now() + latestSetCacheTtlMs,
      }));
    } catch {
      // Ignore unavailable or full browser storage.
    }
  }

  function formatReleaseDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'New release';
    const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    const date = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      : new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
  }

  function isExcludedLatestSet(expansion) {
    const id = String(expansion?.id || '').trim().toLowerCase();
    const name = String(expansion?.name || '').trim().toLowerCase();
    const series = String(expansion?.series || '').trim().toLowerCase();
    const language = String(expansion?.language || '').trim().toLowerCase();
    const languageCode = String(expansion?.languageCode || expansion?.language_code || '').trim().toLowerCase();
    const onlineOnly = Boolean(expansion?.isOnlineOnly ?? expansion?.is_online_only);
    return (language && language !== 'english')
      || (languageCode && languageCode !== 'en')
      || onlineOnly
      || id.startsWith('tcgp')
      || series.includes('pocket')
      || name.includes('pocket')
      || series.includes('promo')
      || name.includes('promo')
      || id.startsWith('mcd')
      || name.includes('mcdonald')
      || series.includes('mcdonald')
      || ['clv', 'clc', 'clb', 'sve'].includes(id)
      || name.includes('tcg classic')
      || series.includes('tcg classic')
      || name.includes('energies')
      || series.includes('energies');
  }

  function normalizeLatestSet(expansion) {
    if (!expansion || typeof expansion !== 'object' || isExcludedLatestSet(expansion)) return null;
    const id = String(expansion.id || '').trim();
    const name = String(expansion.name || '').trim();
    if (!id || !name) return null;
    return {
      id,
      name,
      logo: String(expansion.logo || '').trim(),
      releaseDate: String(expansion.releaseDate || expansion.release_date || '').trim(),
      cards: [],
    };
  }

  function getStrictNmMarket(card) {
    const variants = Array.isArray(card?.variants) ? card.variants : [];
    const getMarket = (variant) => {
      const prices = Array.isArray(variant?.prices) ? variant.prices : [];
      const values = prices
        .filter((price) => /^(NM|NEAR MINT)$/i.test(String(price?.condition || '').trim()))
        .map((price) => Number(price?.market ?? price?.marketPrice ?? price?.market_price))
        .filter((market) => Number.isFinite(market) && market > 0);
      return values.length ? Math.max(...values) : null;
    };

    for (const preferredName of ['holofoil', 'normal']) {
      const preferred = variants.find((variant) => String(variant?.name || '').trim().toLowerCase() === preferredName);
      if (preferred) return getMarket(preferred);
    }

    return variants.reduce((best, variant) => {
      const market = getMarket(variant);
      return market != null && (best == null || market > best) ? market : best;
    }, null);
  }

  function readHomeWatchlist() {
    try {
      const parsed = JSON.parse(localStorage.getItem(homeCardWatchlistKey) || 'null');
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && item.id) : [];
    } catch {
      return [];
    }
  }

  function readHomeCacheMap(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeHomeCacheMap(key, value) {
    try {
      const entries = Object.entries(value)
        .sort((left, right) => Number(right?.[1]?.cachedAt || right?.[1]?.seenAt || 0) - Number(left?.[1]?.cachedAt || left?.[1]?.seenAt || 0))
        .slice(0, 200);
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Ignore unavailable or full browser storage.
    }
  }

  async function loadHomeWatchlist() {
    const byId = new Map();
    const merge = (items) => {
      for (const item of Array.isArray(items) ? items : []) {
        const id = String(item?.id || '').trim();
        if (id && !byId.has(id)) byId.set(id, item);
      }
    };

    merge(readHomeWatchlist());
    try {
      await authReady;
      const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
      if (user && window?.PV_AUTH?.loadWatchlist) {
        merge(await Promise.resolve(window.PV_AUTH.loadWatchlist('card')));
      }
    } catch {
      // Local watchlist data remains usable when cloud loading is unavailable.
    }

    return Array.from(byId.values()).slice(0, 6);
  }

  async function fetchHomeCardRecord(cardId) {
    const response = await fetchWithAuth(`${liveSearchBase}/cards/${encodeURIComponent(cardId)}?includePrices=1&lang=en&cache=no-store`);
    if (!response.ok) throw new Error(`Trending card request failed with ${response.status}`);
    const payload = await response.json();
    return payload?.data || payload?.card || payload;
  }

  function getHomeTrendingSetName(card) {
    return String(card?.expansion?.name || card?.set?.name || card?.expansionName || card?.setName || 'Unknown set').trim();
  }

  function getHomeTrendingHref(card) {
    return `search.html?${new URLSearchParams({ cardId: String(card?.id || ''), cardName: String(card?.name || 'Unknown card') }).toString()}`;
  }

  function setHomeTrendingMessage(message) {
    if (!trendingList) return;
    trendingList.replaceChildren();
    const messageElement = document.createElement('p');
    messageElement.className = 'home-preview-market-movers-empty';
    messageElement.textContent = message;
    trendingList.append(messageElement);
    if (trendingNote) {
      trendingNote.textContent = '';
      trendingNote.hidden = true;
    }
  }

  function createHomeTrendingRow(row) {
    const link = document.createElement('a');
    link.className = 'home-preview-market-mover';
    link.href = row.href;
    link.setAttribute('aria-label', `Open ${row.name}`);

    const art = document.createElement('span');
    art.className = 'home-preview-market-mover-art';
    const imageUrl = getSafeImageUrl(getEntityImages(row.card));
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove(), { once: true });
      art.append(image);
    } else {
      art.textContent = String(row.name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CARD';
    }

    const copy = document.createElement('span');
    copy.className = 'home-preview-market-mover-copy';
    const name = document.createElement('strong');
    name.textContent = row.name;
    const setName = document.createElement('small');
    setName.textContent = row.setName;
    copy.append(name, setName);

    const value = document.createElement('span');
    value.className = 'home-preview-market-mover-value';
    const market = document.createElement('strong');
    market.textContent = Number.isFinite(row.market) ? formatLivePrice(row.market) : 'N/A';
    const marketLine = document.createElement('small');
    marketLine.className = 'home-preview-market-mover-market-line';
    marketLine.textContent = Number.isFinite(row.market)
      ? `Now${Number.isFinite(row.prevMarket) ? ` · Prev ${formatLivePrice(row.prevMarket)}` : ''}`
      : 'Market unavailable';
    const change = document.createElement('span');
    const hasDelta = Number.isFinite(row.delta);
    const changeClass = hasDelta && row.delta > 0.009
      ? 'home-preview-market-mover-change--up'
      : hasDelta && row.delta < -0.009
        ? 'home-preview-market-mover-change--down'
        : 'home-preview-market-mover-change--flat';
    change.className = `home-preview-market-mover-change ${changeClass}`;
    change.textContent = hasDelta
      ? (row.delta > 0.009 ? `+${formatLivePrice(row.delta)}` : row.delta < -0.009 ? formatLivePrice(row.delta) : 'Flat')
      : 'New';
    value.append(market, marketLine, change);
    link.append(art, copy, value);
    return link;
  }

  async function renderHomeTrendingCards() {
    if (!trendingList) return;
    const renderToken = ++trendingRenderToken;
    if (trendingSection) trendingSection.hidden = true;
    setHomeTrendingMessage('Loading watchlist movement...');
    const candidates = await loadHomeWatchlist();
    if (renderToken !== trendingRenderToken) return;
    if (!candidates.length) {
      setHomeTrendingMessage('Add cards to your watchlist to unlock movement tracking.');
      return;
    }
    if (trendingSection) trendingSection.hidden = false;

    const previousMap = readHomeCacheMap(homeMarketSnapshotKey);
    const cardCache = readHomeCacheMap(homeCardCacheKey);
    const nextCardCache = { ...cardCache };

    const nextMap = { ...previousMap };
    const settled = await Promise.all(candidates.map(async (item) => {
      const id = String(item?.id || '').trim();
      const snapshot = previousMap[id] && typeof previousMap[id] === 'object' ? previousMap[id] : {};
      const cachedCard = cardCache[id];
      const hasFreshCard = cachedCard?.card
        && Date.now() - Number(cachedCard.cachedAt || 0) < homeCardCacheTtlMs;
      let card = hasFreshCard ? cachedCard.card : item;
      let refreshed = !hasFreshCard;

      if (!hasFreshCard && getStrictNmMarket(card) == null) {
        try {
          card = await fetchHomeCardRecord(id);
        } catch {
          card = item;
        }
      }

      const market = getStrictNmMarket(card);
      const hasMarket = Number.isFinite(market);
      const storedMarket = Number(snapshot.market);
      const hasStoredMarket = Number.isFinite(storedMarket);

      if (!hasFreshCard && card && typeof card === 'object') {
        nextCardCache[id] = { card, cachedAt: Date.now() };
      }

      if (hasMarket && (refreshed || !hasStoredMarket)) {
        nextMap[id] = {
          market: Number(market),
          previousMarket: hasStoredMarket ? storedMarket : null,
          seenAt: Date.now(),
          name: String(card?.name || item?.name || ''),
        };
      } else if (hasStoredMarket) {
        refreshed = false;
      }

      const currentSnapshot = nextMap[id] || snapshot;
      const currentMarket = Number(currentSnapshot.market);
      const previousMarket = Number(currentSnapshot.previousMarket);
      const hasCurrentMarket = Number.isFinite(currentMarket);
      const hasPreviousMarket = Number.isFinite(previousMarket);

      return {
        card,
        href: getHomeTrendingHref(card || item),
        name: String(card?.name || item?.name || 'Unknown card'),
        setName: getHomeTrendingSetName(card || item),
        market: hasCurrentMarket ? currentMarket : null,
        prevMarket: hasPreviousMarket ? previousMarket : null,
        delta: hasPreviousMarket && hasCurrentMarket ? currentMarket - previousMarket : null,
      };
    }));

    if (renderToken !== trendingRenderToken) return;

    writeHomeCacheMap(homeCardCacheKey, nextCardCache);
    writeHomeCacheMap(homeMarketSnapshotKey, nextMap);

    settled.sort((left, right) => Math.abs(Number(right.delta || 0)) - Math.abs(Number(left.delta || 0)));
    trendingList.replaceChildren(...settled.map(createHomeTrendingRow));
    if (trendingNote) {
      trendingNote.textContent = 'Movement is calculated from your saved market snapshots.';
      trendingNote.hidden = false;
    }
  }

  function createSetImage(set) {
    const imageUrl = getSafeImageUrl(set.logo);
    if (!imageUrl) return null;
    const image = document.createElement('img');
    image.className = 'home-preview-set-panel-logo';
    image.src = imageUrl;
    image.alt = `${set.name} logo`;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.remove(), { once: true });
    return image;
  }

  function getSetInitials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'SET';
  }

  function createRecentSetTile(set, index) {
    const link = document.createElement('a');
    link.className = `home-preview-set-tile home-preview-set-tile--${['gold', 'violet', 'blue'][index % 3]}`;
    link.href = `search.html?${new URLSearchParams({ expansionId: set.id, expansionName: set.name }).toString()}`;

    const logo = document.createElement('span');
    logo.className = 'home-preview-set-logo';
    const logoImage = createSetImage(set);
    if (logoImage) {
      logoImage.className = 'home-preview-set-logo-image';
      logo.append(logoImage);
    } else {
      logo.textContent = getSetInitials(set.name);
    }

    const name = document.createElement('strong');
    name.textContent = set.name;
    const action = document.createElement('small');
    action.textContent = 'View top 10 →';
    link.append(logo, name, action);
    return link;
  }

  function renderRecentSets(sets) {
    if (!recentSetsContainer) return;
    recentSetsContainer.replaceChildren();
    const normalized = Array.isArray(sets) ? sets.slice(0, 10) : [];
    if (!normalized.length) {
      if (recentSetsStatus) {
        recentSetsStatus.hidden = false;
        recentSetsStatus.textContent = 'Latest sets are unavailable right now.';
      }
      return;
    }
    if (recentSetsStatus) recentSetsStatus.hidden = true;
    normalized.forEach((set, index) => recentSetsContainer.append(createRecentSetTile(set, index)));
  }

  function createTopSetCard(card, setName) {
    const article = document.createElement('article');
    article.className = 'home-preview-top-card';

    const cardLink = document.createElement('a');
    cardLink.className = 'home-preview-top-card-link';
    const cardName = String(card?.name || 'Unknown card').trim() || 'Unknown card';
    cardLink.href = `search.html?${new URLSearchParams({ cardId: String(card?.id || ''), cardName }).toString()}`;

    const art = createLiveImageButton(getEntityImages(card), `${cardName} card artwork`);
    art.classList.add('home-preview-top-card-art');

    const name = document.createElement('h4');
    name.textContent = cardName;
    const number = String(card?.printedNumber || card?.number || '').trim();
    const rarity = String(card?.rarity || '').trim();
    const metadata = document.createElement('p');
    metadata.textContent = [setName, number || 'Number unavailable', rarity].filter(Boolean).join(' · ');
    const price = document.createElement('strong');
    price.textContent = formatLivePrice(getStrictNmMarket(card));
    const priceLabel = document.createElement('small');
    priceLabel.textContent = 'NM market';

    cardLink.append(name, metadata, price, priceLabel);
    article.append(art, cardLink);
    return article;
  }

  function updateSetTabsOverflowCue() {
    if (!setTabsWrapper || !setTabsContainer) return;
    setTabsWrapper.classList.toggle('is-overflowing', setTabsContainer.scrollWidth > setTabsContainer.clientWidth + 1);
  }

  function renderLatestSetSpotlights(sets) {
    const normalized = Array.isArray(sets) ? sets.slice(0, 10) : [];
    const spotlightSets = normalized.slice(0, 3);
    latestSetSpotlights = spotlightSets;
    renderRecentSets(normalized);
    if (!setTabsContainer || !setPanelsContainer) return;

    setTabsContainer.replaceChildren();
    setPanelsContainer.replaceChildren();
    if (!spotlightSets.length) {
      activeSetId = '';
      if (setStatus) {
        setStatus.hidden = false;
        setStatus.textContent = 'Latest set cards are unavailable right now.';
      }
      return;
    }

    activeSetId = spotlightSets.some((set) => set.id === activeSetId) ? activeSetId : spotlightSets[0].id;
    if (setStatus) setStatus.hidden = true;

    spotlightSets.forEach((set, index) => {
      const panelId = `home-preview-set-panel-${index + 1}`;
      const tab = document.createElement('button');
      tab.className = 'home-preview-set-tab';
      tab.type = 'button';
      tab.role = 'tab';
      tab.setAttribute('aria-controls', panelId);
      tab.dataset.homePreviewSetId = set.id;
      tab.textContent = set.name;
      tab.addEventListener('click', () => {
        activeSetId = set.id;
        updateLatestSetVisibility();
      });
      setTabsContainer.append(tab);

      const panel = document.createElement('section');
      panel.className = 'home-preview-set-panel';
      panel.id = panelId;
      panel.dataset.homePreviewSetId = set.id;
      panel.setAttribute('aria-labelledby', `${panelId}-title`);

      const heading = document.createElement('div');
      heading.className = 'home-preview-set-panel-heading';
      const title = document.createElement('h3');
      title.id = `${panelId}-title`;
      title.textContent = set.name;
      const date = document.createElement('small');
      date.textContent = formatReleaseDate(set.releaseDate);
      heading.append(title, date);
      const setLogo = createSetImage(set);
      if (setLogo) heading.prepend(setLogo);

      const viewSet = document.createElement('a');
      viewSet.className = 'home-preview-inline-link';
      viewSet.href = `search.html?${new URLSearchParams({ expansionId: set.id, expansionName: set.name }).toString()}`;
      viewSet.textContent = 'View set →';
      heading.append(viewSet);

      const cardGrid = document.createElement('div');
      cardGrid.className = 'home-preview-top-card-grid';
      for (const card of Array.isArray(set.cards) ? set.cards.slice(0, 3) : []) {
        cardGrid.append(createTopSetCard(card, set.name));
      }
      if (!cardGrid.childElementCount) {
        const unavailable = document.createElement('p');
        unavailable.className = 'home-preview-set-panel-empty';
        unavailable.textContent = 'Top cards are unavailable right now.';
        cardGrid.append(unavailable);
      }

      panel.append(heading, cardGrid);
      setPanelsContainer.append(panel);
    });

    updateLatestSetVisibility();
    updateSetTabsOverflowCue();
  }

  function updateLatestSetVisibility() {
    for (const tab of setTabsContainer?.querySelectorAll('[data-home-preview-set-id]') || []) {
      const isActive = tab.dataset.homePreviewSetId === activeSetId;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    }
    for (const panel of setPanelsContainer?.querySelectorAll('[data-home-preview-set-id]') || []) {
      panel.classList.toggle('is-active', panel.dataset.homePreviewSetId === activeSetId);
    }
  }

  window.addEventListener('resize', updateSetTabsOverflowCue);

  async function loadLatestSetSpotlights() {
    const cached = readLatestSetCache();
    if (cached?.length) renderLatestSetSpotlights(cached);
    if (setStatus && cached?.length) setStatus.textContent = 'Refreshing latest sets...';

    try {
      const base = liveSearchBase;
      let latestVersion = '';
      try {
        const versionResponse = await fetchWithAuth(`${base}/expansions/latest-version`, { cache: 'no-store' });
        if (versionResponse.ok) latestVersion = String((await versionResponse.json())?.version || '').trim();
      } catch {
        // The expansion search remains usable if the refresh marker is unavailable.
      }

      const params = new URLSearchParams({
        q: 'language:english -is_online_only:true -id:tcgp* -series:promo -name:promo -series:pocket -name:pocket',
        orderBy: '-release_date',
        page: '1',
        pageSize: '30',
        select: 'id,name,logo,release_date,is_online_only,series,language,language_code',
        casing: 'camel',
      });
      if (latestVersion) params.set('latestVersion', latestVersion);
      const expansionResponse = await fetchWithAuth(`${base}/expansions/search?${params.toString()}`, { cache: 'no-store' });
      if (!expansionResponse.ok) throw new Error(`Latest set request failed with ${expansionResponse.status}`);
      const expansionPayload = await expansionResponse.json();
      const sets = (Array.isArray(expansionPayload?.data) ? expansionPayload.data : [])
        .map(normalizeLatestSet)
        .filter(Boolean)
        .slice(0, 10);

      const spotlightSets = sets.slice(0, 3);
      const settled = await Promise.allSettled(spotlightSets.map(async (set) => {
        const topParams = new URLSearchParams({
          expansionId: set.id,
          limit: '10',
          lang: 'en',
          variantPreference: 'v2',
          cache: 'no-store',
        });
        const response = await fetchWithAuth(`${base}/cards/top-by-expansion?${topParams.toString()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Top cards request failed with ${response.status}`);
        const payload = await response.json();
        const cards = (Array.isArray(payload?.data) ? payload.data : [])
          .filter((card) => card?.id && getStrictNmMarket(card) != null)
          .slice(0, 3);
        return { ...set, cards };
      }));

      const resolvedSpotlights = settled.map((result, index) => result.status === 'fulfilled'
        ? result.value
        : { ...spotlightSets[index], cards: [] });
      const resolved = sets.map((set) => resolvedSpotlights.find((spotlight) => spotlight.id === set.id) || set);
      writeLatestSetCache(resolved);
      renderLatestSetSpotlights(resolved);
    } catch (error) {
      console.warn('[PokeValutor] latest set spotlight error', error);
      if (!cached?.length) renderLatestSetSpotlights([]);
      if (setStatus && cached?.length) setStatus.hidden = true;
    }
  }

  function isEnglishSealedProduct(product) {
    const expansion = product?.expansion && typeof product.expansion === 'object' ? product.expansion : {};
    const language = String(expansion.language || product?.language || '').trim().toLowerCase();
    const languageCode = String(expansion.languageCode || product?.languageCode || '').trim().toLowerCase();
    if (!language && !languageCode) return true;
    return language === 'english' || languageCode === 'en';
  }

  function createLiveCardRow(card, index) {
    const id = String(card?.id || '').trim();
    const name = String(card?.name || 'Unknown card').trim();
    const setName = String(card?.expansion?.name || 'Unknown set').trim();
    const number = String(card?.printedNumber || card?.number || 'Number unavailable').trim();
    const params = new URLSearchParams({ cardId: id, cardName: name });
    const row = document.createElement('div');
    row.className = 'home-preview-result-row';
    const detailsLink = document.createElement('a');
    detailsLink.className = 'home-preview-result-copy';
    detailsLink.href = `search.html?${params.toString()}`;

    const art = createLiveImageButton(getEntityImages(card), name);
    art.classList.add(`home-preview-card-art--${['blue', 'violet', 'red'][index % 3]}`);

    const nameElement = document.createElement('strong');
    nameElement.textContent = name;
    const detailElement = document.createElement('small');
    detailElement.textContent = `${setName} · ${number}`;
    detailsLink.append(nameElement, detailElement);

    const price = document.createElement('span');
    price.className = 'home-preview-price';
    const priceElement = document.createElement('strong');
    priceElement.textContent = 'Loading...';
    const priceLabel = document.createElement('small');
    priceLabel.textContent = 'NM market';
    price.append(priceElement, priceLabel);

    row.append(art, detailsLink, price);
    return { row, priceElement, priceLabel };
  }

  function createLiveSealedRow(product, index) {
    const id = String(product?.id || '').trim();
    const name = String(product?.name || 'Unknown sealed product').trim();
    const setName = String(product?.expansion?.name || 'Unknown set').trim();
    const row = document.createElement('div');
    row.className = 'home-preview-result-row';
    const detailsLink = document.createElement('a');
    detailsLink.className = 'home-preview-result-copy';
    detailsLink.href = 'sealed.html';

    const art = createLiveImageButton(getEntityImages(product), name);
    art.classList.add('home-preview-card-art--sealed', `home-preview-card-art--${['gold', 'green', 'orange'][index % 3]}`);

    const nameElement = document.createElement('strong');
    nameElement.textContent = name;
    const detailElement = document.createElement('small');
    detailElement.textContent = `${setName} · sealed product`;
    detailsLink.append(nameElement, detailElement);

    const price = document.createElement('span');
    price.className = 'home-preview-price';
    const priceElement = document.createElement('strong');
    priceElement.textContent = 'Loading...';
    const priceLabel = document.createElement('small');
    priceLabel.textContent = 'Market value';
    price.append(priceElement, priceLabel);

    row.append(art, detailsLink, price);
    return { row, priceElement, priceLabel, productId: id };
  }

  function renderCachedSearchResults(mode, cacheEntry) {
    const panel = mode === 'sealed' ? sealedResultPanel : cardsResultPanel;
    panel.replaceChildren();
    if (cacheEntry.state !== 'results') return;

    const items = mode === 'sealed' ? cacheEntry.products : cacheEntry.cards;
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      const rendered = mode === 'sealed'
        ? createLiveSealedRow(item, index)
        : createLiveCardRow(item, index);
      const savedPrice = cacheEntry.prices?.[String(mode === 'sealed' ? item?.id : item?.id)];
      if (savedPrice && typeof savedPrice.value === 'string') {
        rendered.priceElement.textContent = savedPrice.value;
        rendered.priceLabel.textContent = typeof savedPrice.label === 'string' ? savedPrice.label : rendered.priceLabel.textContent;
      }
      panel.append(rendered.row);
    });
  }

  async function fetchLiveCardPrice(cardId) {
    const response = await fetchWithAuth(`${liveSearchBase}/cards/${encodeURIComponent(cardId)}?includePrices=1&lang=en&cache=no-store`);
    if (!response.ok) throw new Error(`Price request failed with ${response.status}`);
    const payload = await response.json();
    const card = payload?.data || payload?.card || payload;
    const prices = (Array.isArray(card?.variants) ? card.variants : [])
      .flatMap((variant) => Array.isArray(variant?.prices) ? variant.prices : []);
    const marketPrice = prices.find((price) => String(price?.condition || '').toUpperCase() === 'NM' && Number.isFinite(Number(price?.market)))
      || prices.find((price) => Number.isFinite(Number(price?.market)));
    return marketPrice ? formatLivePrice(marketPrice.market) : 'No market price';
  }

  async function fetchLiveSealedPrice(productId) {
    const response = await fetchWithAuth(`${liveSearchBase}/sealed/${encodeURIComponent(productId)}?includePrices=1&cache=no-store`);
    if (!response.ok) throw new Error(`Sealed price request failed with ${response.status}`);
    const payload = await response.json();
    const product = payload?.data || payload?.product || payload;
    const prices = (Array.isArray(product?.variants) ? product.variants : [])
      .flatMap((variant) => Array.isArray(variant?.prices) ? variant.prices : []);
    const marketPrice = prices.find((price) => Number.isFinite(Number(price?.market)));
    return marketPrice ? formatLivePrice(marketPrice.market) : 'No market price';
  }

  function buildLiveFieldQuery(fieldName, value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const term = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed)
      ? `"${trimmed.replace(/"/g, '\\"')}"`
      : trimmed;
    return `${fieldName}:${term}`;
  }

  function toLiveWildcardToken(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function buildLiveCardNameCandidates(rawName) {
    const raw = String(rawName || '').trim();
    if (!raw) return [];
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
      const query = String(value || '').trim();
      if (query && !seen.has(query)) {
        seen.add(query);
        candidates.push(query);
      }
    };

    push(buildLiveFieldQuery('name', raw));
    const canonicalName = raw.replace(/\bpoke\b/gi, (match) => match[0] === match[0].toUpperCase() ? 'Poké' : 'poké');
    if (canonicalName !== raw) push(buildLiveFieldQuery('name', canonicalName));

    const tokens = raw.split(/\s+/).map(toLiveWildcardToken).filter(Boolean);
    if (tokens.length) {
      push(tokens.map((token) => `name:${token}*`).join(' '));
      if (tokens.length === 1 && tokens[0].length >= 4) push(`name:${tokens[0].slice(0, 3)}*`);
    }
    return candidates;
  }

  function singularizeLiveToken(value) {
    const token = String(value || '').trim().toLowerCase();
    if (token.length >= 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
    if (token.length >= 4 && token.endsWith('es')) return token.slice(0, -2);
    if (token.length >= 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
    return token;
  }

  function buildLiveSealedNameCandidates(rawName) {
    const raw = String(rawName || '').trim();
    if (!raw) return [];
    const candidates = [];
    const seen = new Set();
    const push = (value) => {
      const query = String(value || '').trim();
      if (query && !seen.has(query)) {
        seen.add(query);
        candidates.push(query);
      }
    };
    const escaped = raw.replace(/"/g, '\\"');
    push(`name:"${escaped}"`);

    const tokens = raw.split(/\s+/).map(toLiveWildcardToken).filter(Boolean);
    if (!tokens.length) return candidates;
    const singularPhrase = tokens.map((token) => singularizeLiveToken(token) || token).join(' ');
    if (singularPhrase.toLowerCase() !== raw.toLowerCase()) push(`name:"${singularPhrase}"`);
    const wildcardTokens = tokens.map((token) => {
      const singular = singularizeLiveToken(token) || token;
      return singular === token ? `name:${token}*` : `(name:${token}* OR name:${singular}*)`;
    });
    push(wildcardTokens.join(' AND '));
    return candidates;
  }

  function isLiveCardNumberQuery(value) {
    const query = String(value || '').trim().toUpperCase();
    return /^\d{1,4}$/.test(query)
      || /^\d{1,4}\/\d{1,4}$/.test(query)
      || /^\d{1,4}[A-Z]$/.test(query)
      || /^[A-Z]{1,5}\d{1,4}$/.test(query)
      || /^(?=.*\d)[A-Z0-9]{2,6}-[A-Z0-9]{1,6}$/.test(query)
      || /^\d{1,4}[A-Z]\/\d{1,4}$/.test(query)
      || /^[A-Z]{1,5}\d{1,4}\/\d{1,5}$/.test(query);
  }

  function normalizeLiveDigits(value) {
    return String(value || '').replace(/^0+(?=\d)/, '');
  }

  function buildLiveNumberCandidates(value) {
    const query = String(value || '').trim();
    const candidates = [query];
    const fraction = query.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
      const left = normalizeLiveDigits(fraction[1]);
      const right = normalizeLiveDigits(fraction[2]);
      candidates.push(`${left.padStart(3, '0')}/${right.padStart(3, '0')}`);
      candidates.push(`${left}/${right.padStart(3, '0')}`);
      candidates.push(`${left}/${right}`);
    } else if (/^\d+$/.test(query)) {
      const normalized = normalizeLiveDigits(query);
      candidates.push(normalized, normalized.padStart(3, '0'));
    }
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  async function fetchLiveCardSearchPage(query, pageSize, consumeQuota) {
    const params = new URLSearchParams({
      q: query,
      page: '1',
      pageSize: String(pageSize),
      lang: 'en',
      consumeQuota: consumeQuota ? '1' : '0',
      cache: 'no-store',
    });
    const response = await fetchWithAuth(`${liveSearchBase}/cards/search?${params.toString()}`);
    if (!response.ok) throw new Error(`Card search request failed with ${response.status}`);
    return response.json();
  }

  async function fetchLiveCards(query) {
    const pageSize = 15;
    if (!isLiveCardNumberQuery(query)) {
      const candidates = buildLiveCardNameCandidates(query);
      let lastPayload = null;
      for (const candidate of candidates) {
        const payload = await fetchLiveCardSearchPage(candidate, pageSize, true);
        lastPayload = payload;
        const cards = Array.isArray(payload?.data) ? payload.data : [];
        if (cards.length) return { cards, totalCount: Number(payload?.totalCount || cards.length) };
      }
      return { cards: [], totalCount: Number(lastPayload?.totalCount || 0) };
    }

    const cards = [];
    const seen = new Set();
    const merge = (next) => {
      for (const card of Array.isArray(next) ? next : []) {
        const id = String(card?.id || '').trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          cards.push(card);
        }
      }
    };

    const numberCandidate = /^\d+$/.test(query) ? normalizeLiveDigits(query) : query;
    const requests = [];
    const queueSearch = (searchQuery) => {
      requests.push(fetchLiveCardSearchPage(searchQuery, pageSize, requests.length === 0));
    };
    if (numberCandidate && !numberCandidate.includes('/')) {
      queueSearch(`rarity:Promo ${buildLiveFieldQuery('number', numberCandidate)}`);
    }
    for (const candidate of buildLiveNumberCandidates(query)) {
      queueSearch(buildLiveFieldQuery('printed_number', candidate));
    }
    if (numberCandidate && !numberCandidate.includes('/')) {
      queueSearch(buildLiveFieldQuery('number', numberCandidate));
    }

    const responses = await Promise.allSettled(requests);
    const successfulResponses = responses.filter((response) => response.status === 'fulfilled');
    if (!successfulResponses.length && responses[0]?.status === 'rejected') {
      throw responses[0].reason;
    }
    for (const response of successfulResponses) {
      merge(response.value?.data);
    }

    const wanted = String(query).toUpperCase().replace(/^0+(?=\d)/, '');
    cards.sort((left, right) => {
      const leftNumber = String(left?.printedNumber || left?.printed_number || left?.number || '').toUpperCase().replace(/^0+(?=\d)/, '');
      const rightNumber = String(right?.printedNumber || right?.printed_number || right?.number || '').toUpperCase().replace(/^0+(?=\d)/, '');
      return Number(rightNumber === wanted) - Number(leftNumber === wanted);
    });

    return { cards, totalCount: cards.length };
  }

  async function runLiveCardSearch(query) {
    const cacheEntry = {
      query,
      state: 'loading',
      title: 'Top Card Matches',
      resultCount: `Searching for “${query}”...`,
      linkText: 'View all card results →',
      linkHref: `search.html?${new URLSearchParams({ query, source: 'home-preview' }).toString()}`,
      status: `Searching cards for ${query}...`,
    };
    liveSearchCache.cards = cacheEntry;
    persistLiveSearchCache();
    cardsResultPanel.replaceChildren();
    if (activeMode === 'cards') updateSearchPreview('cards');

    try {
      const payload = await fetchLiveCards(query);
      if (liveSearchCache.cards !== cacheEntry) return;

      const cards = Array.isArray(payload.cards) ? payload.cards.filter((card) => card?.id).slice(0, 3) : [];
      const totalCount = Number(payload.totalCount || cards.length);
      cacheEntry.cards = cards;
      cacheEntry.totalCount = totalCount;
      cacheEntry.prices = {};
      if (!cards.length) {
        cacheEntry.state = 'empty';
        cacheEntry.resultCount = `No card results for “${query}”`;
        cacheEntry.status = `No cards found for ${query}.`;
        persistLiveSearchCache();
        if (activeMode === 'cards') updateSearchPreview('cards');
        return;
      }

      const priceTargets = cards.map((card, index) => {
        const rendered = createLiveCardRow(card, index);
        cardsResultPanel.append(rendered.row);
        return { card, ...rendered };
      });
      cacheEntry.state = 'results';
      cacheEntry.resultCount = `${cards.length} of ${totalCount} results for “${query}”`;
      cacheEntry.status = `Live card results ready for ${query}.`;
      persistLiveSearchCache();
      if (activeMode === 'cards') updateSearchPreview('cards', { preserveResults: true });

      await Promise.all(priceTargets.map(async ({ card, priceElement, priceLabel }) => {
        try {
          const price = await fetchLiveCardPrice(String(card.id));
          if (liveSearchCache.cards !== cacheEntry) return;
          priceElement.textContent = price;
          priceLabel.textContent = price === 'No market price' ? 'Market value' : 'NM market';
          cacheEntry.prices[String(card.id)] = { value: price, label: priceLabel.textContent };
          persistLiveSearchCache();
        } catch {
          if (liveSearchCache.cards !== cacheEntry) return;
          priceElement.textContent = 'Unavailable';
          priceLabel.textContent = 'Market value';
          cacheEntry.prices[String(card.id)] = { value: 'Unavailable', label: 'Market value' };
          persistLiveSearchCache();
        }
      }));
    } catch (error) {
      if (liveSearchCache.cards !== cacheEntry) return;
      console.warn('[PokeValutor] home preview search error', error);
      cacheEntry.state = 'error';
      cacheEntry.resultCount = 'Live search is unavailable right now.';
      cacheEntry.status = 'Unable to load live card results. Please try again.';
      persistLiveSearchCache();
      if (activeMode === 'cards') updateSearchPreview('cards');
    }
  }

  async function runLiveSealedSearch(query) {
    const cacheEntry = {
      query,
      state: 'loading',
      title: 'Sealed Search Results',
      resultCount: `Searching for “${query}”...`,
      linkText: 'Open sealed search →',
      linkHref: 'sealed.html',
      status: `Searching sealed products for ${query}...`,
    };
    liveSearchCache.sealed = cacheEntry;
    persistLiveSearchCache();
    sealedResultPanel.replaceChildren();
    if (activeMode === 'sealed') updateSearchPreview('sealed');

    try {
      const candidates = buildLiveSealedNameCandidates(query);
      let payload = null;
      for (const searchQuery of candidates) {
        const params = new URLSearchParams({ q: searchQuery, page: '1', pageSize: '10', searchVersion: 'v3', consumeQuota: '1', cache: 'no-store' });
        const response = await fetchWithAuth(`${liveSearchBase}/sealed/search?${params.toString()}`);
        if (!response.ok) throw new Error(`Sealed search request failed with ${response.status}`);
        payload = await response.json();
        if (Array.isArray(payload?.data) && payload.data.some((product) => product?.id && isEnglishSealedProduct(product))) break;
      }
      if (liveSearchCache.sealed !== cacheEntry) return;

      const products = Array.isArray(payload?.data)
        ? payload.data.filter((product) => product?.id && isEnglishSealedProduct(product)).slice(0, 3)
        : [];
      const totalCount = Number(payload?.totalCount || products.length);
      cacheEntry.products = products;
      cacheEntry.totalCount = totalCount;
      cacheEntry.prices = {};
      if (!products.length) {
        cacheEntry.state = 'empty';
        cacheEntry.resultCount = `No sealed results for “${query}”`;
        cacheEntry.status = `No sealed products found for ${query}.`;
        persistLiveSearchCache();
        if (activeMode === 'sealed') updateSearchPreview('sealed');
        return;
      }

      const priceTargets = products.map((product, index) => {
        const rendered = createLiveSealedRow(product, index);
        sealedResultPanel.append(rendered.row);
        return { product, ...rendered };
      });
      cacheEntry.state = 'results';
      cacheEntry.resultCount = `${products.length} of ${totalCount} sealed results for “${query}”`;
      cacheEntry.status = `Live sealed results ready for ${query}.`;
      persistLiveSearchCache();
      if (activeMode === 'sealed') updateSearchPreview('sealed', { preserveResults: true });

      await Promise.all(priceTargets.map(async ({ product, priceElement, priceLabel, productId }) => {
        try {
          const price = await fetchLiveSealedPrice(productId);
          if (liveSearchCache.sealed !== cacheEntry) return;
          priceElement.textContent = price;
          priceLabel.textContent = 'Market value';
          cacheEntry.prices[String(productId)] = { value: price, label: 'Market value' };
          persistLiveSearchCache();
        } catch {
          if (liveSearchCache.sealed !== cacheEntry) return;
          priceElement.textContent = 'Unavailable';
          priceLabel.textContent = 'Market value';
          cacheEntry.prices[String(productId)] = { value: 'Unavailable', label: 'Market value' };
          persistLiveSearchCache();
        }
      }));
    } catch (error) {
      if (liveSearchCache.sealed !== cacheEntry) return;
      console.warn('[PokeValutor] home preview sealed search error', error);
      cacheEntry.state = 'error';
      cacheEntry.resultCount = 'Live sealed search is unavailable right now.';
      cacheEntry.status = 'Unable to load live sealed results. Please try again.';
      persistLiveSearchCache();
      if (activeMode === 'sealed') updateSearchPreview('sealed');
    }
  }

  function setPreviewState(state) {
    for (const panel of statePanels) {
      panel.hidden = panel.dataset.homePreviewStatePanel !== state;
    }

    for (const button of stateButtons) {
      const isActive = button.dataset.homePreviewState === state;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  for (const button of modeButtons) {
    button.addEventListener('click', function () {
      const mode = button.dataset.homePreviewMode === 'sealed' ? 'sealed' : 'cards';
      for (const candidate of modeButtons) {
        const isActive = candidate === button;
        candidate.classList.toggle('is-active', isActive);
        candidate.setAttribute('aria-pressed', String(isActive));
      }

      input.placeholder = mode === 'sealed' ? 'Search sealed products' : 'Search card name or number';
      input.setAttribute('aria-label', mode === 'sealed' ? 'Search sealed products' : 'Search cards or sealed products');
      updateSearchPreview(mode);
    });
  }

  for (const button of stateButtons) {
    button.addEventListener('click', function () {
      setPreviewState(button.dataset.homePreviewState || 'results');
    });
  }

  retryButton?.addEventListener('click', function () {
    const cachedSearch = liveSearchCache[activeMode];
    if (cachedSearch?.query) {
      void (activeMode === 'sealed' ? runLiveSealedSearch(cachedSearch.query) : runLiveCardSearch(cachedSearch.query));
      return;
    }
    setPreviewState('empty');
    status.textContent = 'Enter a search to try again.';
  });

  clearButton?.addEventListener('click', function () {
    const mode = activeMode;
    liveSearchCache[mode] = null;
    persistLiveSearchCache();
    (mode === 'sealed' ? sealedResultPanel : cardsResultPanel).replaceChildren();
    input.value = '';
    updateSearchPreview(mode);
    status.textContent = '';
    input.focus();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const mode = document.querySelector('[data-home-preview-mode].is-active')?.dataset.homePreviewMode || 'cards';
    const label = mode === 'sealed' ? 'sealed products' : 'cards';
    const query = input.value.trim();

    if (query) {
      void (mode === 'sealed' ? runLiveSealedSearch(query) : runLiveCardSearch(query));
      return;
    }

    setPreviewState('empty');
    status.textContent = `Enter a name or number to search ${label}.`;
  });

  updateSearchPreview('cards');
  void loadLatestSetSpotlights();
  void renderHomeTrendingCards();
})();