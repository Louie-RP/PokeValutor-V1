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
})();
