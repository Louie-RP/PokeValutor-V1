/* Search page behavior */
(function () {
  const form = document.getElementById('pv-search-form');
  const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
  const status = document.getElementById('pv-search-status');
  const list = document.getElementById('pv-search-list');

  // Tiny demo dataset
  const DATA = [
    { name: 'pikachu', type: ['electric'], value: 87 },
    { name: 'bulbasaur', type: ['grass', 'poison'], value: 72 },
    { name: 'charmander', type: ['fire'], value: 75 },
    { name: 'squirtle', type: ['water'], value: 74 },
    { name: 'mew', type: ['psychic'], value: 95 }
  ];

  function render(results) {
    if (!list) return;
    list.innerHTML = '';

    if (!results.length) {
      const li = document.createElement('li');
      li.textContent = 'No results found.';
      list.appendChild(li);
      return;
    }

    for (const item of results) {
      const li = document.createElement('li');
      li.className = 'pv-features__item';
      li.innerHTML = `<strong>${item.name}</strong> • Types: ${item.type.join(', ')} • Value: ${item.value}`;
      list.appendChild(li);
    }
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function doSearch(query) {
    const q = query.trim().toLowerCase();
    const results = DATA.filter(d => d.name.includes(q));
    render(results);
    setStatus(`${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`);
  }

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doSearch(input.value || '');
    });
  }
})();
