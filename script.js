/* PokeValutor site JS */
(function () {
  const year = document.getElementById('pv-year');
  const form = document.getElementById('pv-contactForm');

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

  // Basic form handler (no network)
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = /** @type {HTMLInputElement} */(document.getElementById('pv-name'))?.value?.trim();
      const email = /** @type {HTMLInputElement} */(document.getElementById('pv-email'))?.value?.trim();
      const message = /** @type {HTMLTextAreaElement} */(document.getElementById('pv-message'))?.value?.trim();

      if (!name || !email || !message) {
        alert('Please fill in all fields.');
        return;
      }

      alert('Thanks for reaching out! This demo does not send emails.');
      form.reset();
    });
  }
})();
