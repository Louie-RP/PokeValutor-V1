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
  const cardsResultPanel = document.querySelector('[data-home-preview-result-panel="cards"]');
  const sealedResultPanel = document.querySelector('[data-home-preview-result-panel="sealed"]');
  const resultPanels = Array.from(document.querySelectorAll('[data-home-preview-result-panel]'));
  const stateButtons = Array.from(document.querySelectorAll('[data-home-preview-state]'));
  const statePanels = Array.from(document.querySelectorAll('[data-home-preview-state-panel]'));
  const retryButton = document.querySelector('[data-home-preview-retry]');
  const setTabs = Array.from(document.querySelectorAll('[data-home-preview-set]'));
  const topCards = Array.from(document.querySelectorAll('.home-preview-top-card'));
  const viewSetLink = document.querySelector('[data-home-preview-view-set]');
  const menuButton = document.getElementById('home-preview-menu-button');
  const navigation = document.getElementById('home-preview-nav');
  const imageDialog = document.querySelector('[data-home-preview-image-dialog]');
  const imageDialogImage = imageDialog?.querySelector('[data-home-preview-image-dialog-image]');
  const imageDialogClose = imageDialog?.querySelector('[data-home-preview-image-dialog-close]');
  const imageDialogTitle = imageDialog?.querySelector('[data-home-preview-image-dialog-title]');
  const liveSearchBase = (window.PV_SECRETS?.PV_API_URL || 'https://pokevalutor-v1.lreyperez18.workers.dev').replace(/\/$/, '');
  let activeMode = 'cards';
  const liveSearchCache = { cards: null, sealed: null };
  let imageDialogReturnFocus = null;
  const authReady = new Promise((resolve) => {
    const authApi = window?.PV_AUTH;
    if (!authApi?.onAuthStateChanged) {
      resolve(null);
      return;
    }

    let settled = false;
    const settle = (user) => {
      if (settled) return;
      settled = true;
      resolve(user || null);
    };

    try {
      authApi.onAuthStateChanged(settle);
      window.setTimeout(() => settle(authApi.getUser ? authApi.getUser() : null), 5000);
    } catch {
      settle(null);
    }
  });

  const setPreviewData = {
    celebration: {
      name: '30th Celebration',
      id: 'preview-celebration',
      cards: [
        { art: 'blue', mark: '30', name: 'Top Card #1', number: 'Card 001', price: '$198.40' },
        { art: 'violet', mark: '30', name: 'Top Card #2', number: 'Card 002', price: '$146.25' },
        { art: 'red', mark: '30', name: 'Top Card #3', number: 'Card 003', price: '$119.80' },
      ],
    },
    'pitch-black': {
      name: 'Pitch Black',
      id: 'preview-pitch-black',
      cards: [
        { art: 'violet', mark: 'PB', name: 'Umbreon ex', number: 'Card 098', price: '$174.20' },
        { art: 'blue', mark: 'PB', name: 'Darkrai VSTAR', number: 'Card 071', price: '$132.80' },
        { art: 'red', mark: 'PB', name: 'Houndoom ex', number: 'Card 044', price: '$109.45' },
      ],
    },
    'chaos-rising': {
      name: 'Chaos Rising',
      id: 'preview-chaos-rising',
      cards: [
        { art: 'red', mark: 'CR', name: 'Rayquaza ex', number: 'Card 121', price: '$188.90' },
        { art: 'blue', mark: 'CR', name: 'Mew ex', number: 'Card 089', price: '$128.35' },
        { art: 'violet', mark: 'CR', name: 'Gardevoir ex', number: 'Card 076', price: '$104.60' },
      ],
    },
  };

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

  function updateSearchPreview(mode) {
    const isSealed = mode === 'sealed';
    activeMode = isSealed ? 'sealed' : 'cards';
    const cachedSearch = liveSearchCache[activeMode];
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

  function getSafeImageUrl(images) {
    const imageList = normalizeImageList(images);
    const image = imageList.find((candidate) => String(candidate?.type || '').toLowerCase() === 'front') || imageList[0];
    const rawUrl = image?.medium || image?.large || image?.small || '';
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
    button.addEventListener('click', function () {
      openImageDialog(imageUrl, altText, button);
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
      const payload = await fetchLiveCardSearchPage(query, pageSize, true);
      return {
        cards: Array.isArray(payload?.data) ? payload.data : [],
        totalCount: Number(payload?.totalCount || 0),
      };
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
    cardsResultPanel.replaceChildren();
    if (activeMode === 'cards') updateSearchPreview('cards');

    try {
      const payload = await fetchLiveCards(query);
      if (liveSearchCache.cards !== cacheEntry) return;

      const cards = Array.isArray(payload.cards) ? payload.cards.filter((card) => card?.id).slice(0, 3) : [];
      const totalCount = Number(payload.totalCount || cards.length);
      if (!cards.length) {
        cacheEntry.state = 'empty';
        cacheEntry.resultCount = `No card results for “${query}”`;
        cacheEntry.status = `No cards found for ${query}.`;
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
      if (activeMode === 'cards') updateSearchPreview('cards');

      await Promise.all(priceTargets.map(async ({ card, priceElement, priceLabel }) => {
        try {
          const price = await fetchLiveCardPrice(String(card.id));
          if (liveSearchCache.cards !== cacheEntry) return;
          priceElement.textContent = price;
          priceLabel.textContent = price === 'No market price' ? 'Market value' : 'NM market';
        } catch {
          if (liveSearchCache.cards !== cacheEntry) return;
          priceElement.textContent = 'Unavailable';
          priceLabel.textContent = 'Market value';
        }
      }));
    } catch (error) {
      if (liveSearchCache.cards !== cacheEntry) return;
      console.warn('[PokeValutor] home preview search error', error);
      cacheEntry.state = 'error';
      cacheEntry.resultCount = 'Live search is unavailable right now.';
      cacheEntry.status = 'Unable to load live card results. Please try again.';
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
    sealedResultPanel.replaceChildren();
    if (activeMode === 'sealed') updateSearchPreview('sealed');

    try {
      const searchQuery = `name:"${query.replace(/"/g, '\\"')}"`;
      const params = new URLSearchParams({ q: searchQuery, page: '1', pageSize: '10', searchVersion: 'v3', consumeQuota: '1', cache: 'no-store' });
      const response = await fetchWithAuth(`${liveSearchBase}/sealed/search?${params.toString()}`);
      if (!response.ok) throw new Error(`Sealed search request failed with ${response.status}`);
      const payload = await response.json();
      if (liveSearchCache.sealed !== cacheEntry) return;

      const products = Array.isArray(payload?.data)
        ? payload.data.filter((product) => product?.id && isEnglishSealedProduct(product)).slice(0, 3)
        : [];
      const totalCount = Number(payload?.totalCount || products.length);
      if (!products.length) {
        cacheEntry.state = 'empty';
        cacheEntry.resultCount = `No sealed results for “${query}”`;
        cacheEntry.status = `No sealed products found for ${query}.`;
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
      if (activeMode === 'sealed') updateSearchPreview('sealed');

      await Promise.all(priceTargets.map(async ({ product, priceElement, priceLabel, productId }) => {
        try {
          const price = await fetchLiveSealedPrice(productId);
          if (liveSearchCache.sealed !== cacheEntry) return;
          priceElement.textContent = price;
          priceLabel.textContent = 'Market value';
        } catch {
          if (liveSearchCache.sealed !== cacheEntry) return;
          priceElement.textContent = 'Unavailable';
          priceLabel.textContent = 'Market value';
        }
      }));
    } catch (error) {
      if (liveSearchCache.sealed !== cacheEntry) return;
      console.warn('[PokeValutor] home preview sealed search error', error);
      cacheEntry.state = 'error';
      cacheEntry.resultCount = 'Live sealed search is unavailable right now.';
      cacheEntry.status = 'Unable to load live sealed results. Please try again.';
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

  function updateSetPreview(setKey) {
    const set = setPreviewData[setKey] || setPreviewData.celebration;
    for (const tab of setTabs) {
      const isActive = tab.dataset.homePreviewSet === setKey;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    }

    set.cards.forEach(function (card, index) {
      const cardElement = topCards[index];
      const art = cardElement.querySelector('.home-preview-large-art');
      art.className = `home-preview-large-art home-preview-large-art--${card.art}`;
      art.querySelector('span').textContent = card.mark;
      cardElement.querySelector('h3').textContent = card.name;
      cardElement.querySelector('p').textContent = card.number;
      cardElement.querySelector('strong').textContent = card.price;
    });

    if (viewSetLink) {
      viewSetLink.href = `search.html?expansionId=${encodeURIComponent(set.id)}&expansionName=${encodeURIComponent(set.name)}`;
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
    (mode === 'sealed' ? sealedResultPanel : cardsResultPanel).replaceChildren();
    input.value = '';
    updateSearchPreview(mode);
    status.textContent = '';
    input.focus();
  });

  for (const tab of setTabs) {
    tab.addEventListener('click', function () {
      updateSetPreview(tab.dataset.homePreviewSet || 'celebration');
    });
  }

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
  setPreviewState('empty');
  updateSetPreview('celebration');
})();