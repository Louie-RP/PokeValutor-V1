/* Shared header sign-in menu. */
(function () {
  'use strict';

  function getAuthErrorMessage(error, action) {
    const code = String(error?.code || '').toLowerCase();
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Sign-in was cancelled.';
    }
    if (action === 'signout') return 'Could not sign out. Please try again.';
    if (action === 'email' && (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password')) {
      return 'Email or password is incorrect.';
    }
    if (action === 'email' && code === 'auth/too-many-requests') {
      return 'Too many attempts. Please try again later.';
    }
    if (action === 'email') return 'Email sign-in could not be completed. Please try again.';
    return 'Google sign-in could not be completed. Please try again.';
  }

  function getDisplayName(user) {
    const name = String(user?.displayName || '').trim();
    if (name) return name;
    const email = String(user?.email || '').trim();
    return email || 'Signed-in user';
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function createAuthMenu(root, variant) {
    const isPreview = variant === 'preview';
    const menu = createElement('div', isPreview ? 'home-preview-auth-menu' : 'pv-auth-menu');
    menu.dataset.pvAuthMenu = '1';

    const trigger = createElement('button', isPreview
      ? 'home-preview-icon-button home-preview-auth-trigger'
      : 'pv-auth-menu__trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-label', 'Open sign-in menu');
    trigger.title = 'Sign in or sign out';
    trigger.appendChild(createElement('span', isPreview ? 'home-preview-account-icon' : 'pv-auth-menu__icon'));

    const panel = createElement('div', isPreview ? 'home-preview-auth-panel' : 'pv-auth-menu__panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Account options');

    const heading = createElement('p', isPreview ? 'home-preview-auth-heading' : 'pv-auth-menu__heading', 'Account');
    const signedOut = createElement('div', isPreview ? 'home-preview-auth-state' : 'pv-auth-menu__state');
    const signedIn = createElement('div', isPreview ? 'home-preview-auth-state' : 'pv-auth-menu__state');
    signedIn.hidden = true;

    const signedOutCopy = createElement('p', isPreview ? 'home-preview-auth-copy' : 'pv-auth-menu__copy', 'Sign in to sync your watchlist and Dex data.');
    const emailForm = createElement('form', isPreview ? 'home-preview-auth-form' : 'pv-auth-menu__form');
    const emailLabel = createElement('label', isPreview ? 'home-preview-auth-label' : 'pv-auth-menu__label', 'Email');
    const emailInput = createElement('input', isPreview ? 'home-preview-auth-input' : 'pv-auth-menu__input');
    emailInput.type = 'email';
    emailInput.name = 'email';
    emailInput.autocomplete = 'email';
    emailInput.required = true;
    emailLabel.htmlFor = isPreview ? 'home-preview-auth-email' : 'pv-auth-email';
    emailInput.id = emailLabel.htmlFor;
    const passwordLabel = createElement('label', isPreview ? 'home-preview-auth-label' : 'pv-auth-menu__label', 'Password');
    const passwordInput = createElement('input', isPreview ? 'home-preview-auth-input' : 'pv-auth-menu__input');
    passwordInput.type = 'password';
    passwordInput.name = 'password';
    passwordInput.autocomplete = 'current-password';
    passwordInput.required = true;
    passwordLabel.htmlFor = isPreview ? 'home-preview-auth-password' : 'pv-auth-password';
    passwordInput.id = passwordLabel.htmlFor;
    const emailButton = createElement('button', isPreview
      ? 'home-preview-auth-action home-preview-auth-action--email'
      : 'pv-auth-menu__action pv-auth-menu__action--email', 'Sign in');
    emailButton.type = 'submit';
    emailForm.appendChild(emailLabel);
    emailForm.appendChild(emailInput);
    emailForm.appendChild(passwordLabel);
    emailForm.appendChild(passwordInput);
    emailForm.appendChild(emailButton);
    const googleButton = createElement('button', isPreview
      ? 'home-preview-auth-action home-preview-auth-action--google'
      : 'pv-auth-menu__action pv-auth-menu__action--google', 'Continue with Google');
    googleButton.type = 'button';

    const signedInName = createElement('strong', isPreview ? 'home-preview-auth-name' : 'pv-auth-menu__name');
    const signedInEmail = createElement('span', isPreview ? 'home-preview-auth-email' : 'pv-auth-menu__email');
    const signedInCopy = createElement('div', isPreview ? 'home-preview-auth-profile' : 'pv-auth-menu__profile');
    signedInCopy.appendChild(signedInName);
    signedInCopy.appendChild(signedInEmail);

    const accountLink = createElement('a', isPreview
      ? 'home-preview-auth-link'
      : 'pv-auth-menu__link', 'Account settings');
    accountLink.href = 'account.html';
    const createAccountLink = accountLink.cloneNode(true);
    createAccountLink.textContent = 'Create an account';

    const signOutButton = createElement('button', isPreview
      ? 'home-preview-auth-action home-preview-auth-action--signout'
      : 'pv-auth-menu__action pv-auth-menu__action--signout', 'Sign out');
    signOutButton.type = 'button';

    const status = createElement('p', isPreview ? 'home-preview-auth-status' : 'pv-auth-menu__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;

    signedOut.appendChild(signedOutCopy);
    signedOut.appendChild(emailForm);
    signedOut.appendChild(googleButton);
    signedOut.appendChild(createAccountLink);
    signedIn.appendChild(signedInCopy);
    signedIn.appendChild(accountLink);
    signedIn.appendChild(signOutButton);
    panel.appendChild(heading);
    panel.appendChild(signedOut);
    panel.appendChild(signedIn);
    panel.appendChild(status);
    menu.appendChild(trigger);
    menu.appendChild(panel);

    root.appendChild(menu);

    let isBusy = false;
    let currentUser = null;

    function setOpen(open) {
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    }

    function setStatus(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function render(user) {
      currentUser = user || null;
      signedOut.hidden = Boolean(currentUser);
      signedIn.hidden = !currentUser;
      if (currentUser) {
        signedInName.textContent = getDisplayName(currentUser);
        signedInEmail.textContent = String(currentUser.email || '').trim();
      }
      trigger.setAttribute('aria-label', currentUser ? 'Open account menu' : 'Open sign-in menu');
      menu.classList.toggle(isPreview ? 'is-signed-in' : 'pv-auth-menu--signed-in', Boolean(currentUser));
      setStatus('');
    }

    async function runAuthAction(action, callback, button) {
      if (isBusy) return;
      isBusy = true;
      for (const actionButton of [emailButton, googleButton, signOutButton]) actionButton.disabled = true;
      setStatus(action === 'signout' ? 'Signing out...' : action === 'email' ? 'Signing in...' : 'Opening Google sign-in...');
      try {
        await callback();
        if (action === 'signout') setOpen(false);
      } catch (error) {
        setStatus(getAuthErrorMessage(error, action));
      } finally {
        isBusy = false;
        for (const actionButton of [emailButton, googleButton, signOutButton]) actionButton.disabled = false;
      }
    }

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(panel.hidden);
    });
    emailForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const authApi = window.PV_AUTH;
      if (!authApi?.signInWithEmail) {
        setStatus('Sign-in is unavailable right now.');
        return;
      }
      void runAuthAction('email', () => authApi.signInWithEmail(emailInput.value.trim(), passwordInput.value), emailButton);
    });
    googleButton.addEventListener('click', () => {
      const authApi = window.PV_AUTH;
      if (!authApi?.signInWithGoogle) {
        setStatus('Sign-in is unavailable right now.');
        return;
      }
      void runAuthAction('signin', () => authApi.signInWithGoogle(), googleButton);
    });
    signOutButton.addEventListener('click', () => {
      const authApi = window.PV_AUTH;
      if (!authApi?.signOut) {
        setStatus('Sign-out is unavailable right now.');
        return;
      }
      void runAuthAction('signout', () => authApi.signOut(), signOutButton);
    });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      setOpen(false);
      trigger.focus();
    });

    const authApi = window.PV_AUTH;
    if (authApi?.onAuthStateChanged) {
      try {
        authApi.onAuthStateChanged(render);
        window.setTimeout(() => render(authApi.getUser ? authApi.getUser() : currentUser), 5000);
      } catch {
        render(null);
      }
    } else {
      render(null);
    }
  }

  function initialize() {
    const productionHeaders = Array.from(document.querySelectorAll('.pv-header__inner'));
    for (const header of productionHeaders) {
      if (header.querySelector('[data-pv-auth-menu="1"]')) continue;
      createAuthMenu(header, 'production');
    }

    const previewActions = Array.from(document.querySelectorAll('.home-preview-header-actions'));
    for (const actions of previewActions) {
      if (actions.querySelector('[data-pv-auth-menu="1"]')) continue;
      const existingTrigger = actions.querySelector('.home-preview-icon-button[aria-label="Account"]');
      if (existingTrigger) existingTrigger.remove();
      createAuthMenu(actions, 'preview');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
}());
