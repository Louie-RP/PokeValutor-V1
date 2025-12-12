/* PokeValutor site JS */
(function () {
  const navToggle = document.getElementById('pv-navToggle');
  const nav = document.getElementById('pv-nav');
  const year = document.getElementById('pv-year');
  const form = document.getElementById('pv-contactForm');

  // Update year in footer
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  // Mobile nav toggle with ARIA sync
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
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
