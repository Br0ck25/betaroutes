// Minimal boot script to avoid inline scripts / event handlers (CSP-friendly)
// Expose window functions and attach delegated listeners used by legacy HTML

(function () {
  // Stubs and helpers
  window.initMap = function () {
    // No-op stub for Google maps callback until app loads
    console.log('initMap stub - waiting for app.js');
  };

  window.toggleMenu = function () {
    document.body.classList.toggle('menu-open');
    const ev = new CustomEvent('app:toggle-menu');
    document.dispatchEvent(ev);
  };

  window.closeMenu = function () {
    document.body.classList.remove('menu-open');
    document.dispatchEvent(new CustomEvent('app:close-menu'));
  };

  window.scrollToTop = function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // These dispatch events so framework code (Svelte) can respond
  window.showSignup = function () {
    document.dispatchEvent(new CustomEvent('app:show-signup'));
  };

  window.showLogin = function () {
    document.dispatchEvent(new CustomEvent('app:show-login'));
  };

  // Utility to attach event handlers after DOM ready
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    // Attach hamburger listener
    const hb = document.getElementById('hamburger-button');
    if (hb) hb.addEventListener('click', toggleMenu);

    // Attach logo click
    const logo = document.getElementById('logo-image');
    if (logo) logo.addEventListener('click', scrollToTop);

    // Auth banner links
    const signupLink = document.getElementById('show-signup-link');
    if (signupLink) signupLink.addEventListener('click', function (e) { e.preventDefault(); showSignup(); });

    const loginLink = document.getElementById('show-login-link');
    if (loginLink) loginLink.addEventListener('click', function (e) { e.preventDefault(); showLogin(); });

    // Logout menu close button (if exists)
    const logoutClose = document.getElementById('logout-close-btn');
    if (logoutClose) {
      logoutClose.addEventListener('click', function (e) { e.preventDefault(); closeMenu(); });
      logoutClose.addEventListener('mouseover', function () { logoutClose.style.transform = 'scale(1.2)'; });
      logoutClose.addEventListener('mouseout', function () { logoutClose.style.transform = 'scale(1)'; });
    }

    // Global blur button handler (moved from inline script) - remove focus after interaction
    function blurButtonOnInteraction(e) {
      const btn = e.target.closest && e.target.closest('button');
      if (btn) btn.blur();
    }

    document.addEventListener('click', blurButtonOnInteraction);
    document.addEventListener('touchend', blurButtonOnInteraction);

    // Delegate clicks for upgrade links, data-action handlers and other dynamic content
    document.body.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;

      // Generic data-action handler (map kebab-case to camelCase function names)
      const actionEl = target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        if (action) {
          ev.preventDefault();
          const camel = action
            .split('-')
            .map((s, i) => (i ? s.charAt(0).toUpperCase() + s.slice(1) : s))
            .join('');
          if (typeof window[camel] === 'function') {
            try {
              window[camel](ev);
            } catch (err) {
              console.error('Action handler failed', action, err);
            }
            return;
          }
        }
      }

      // Backwards-compatible selectors
      if (target.matches('.upgrade-link')) {
        ev.preventDefault();
        if (typeof window.showUpgradeModal === 'function') window.showUpgradeModal();
        return;
      }

      if (target.matches('.close-upgrade-modal')) {
        ev.preventDefault();
        if (typeof window.closeUpgradeModal === 'function') window.closeUpgradeModal();
        return;
      }

      if (target.matches('.upgrade-plan-btn')) {
        ev.preventDefault();
        const plan = target.getAttribute('data-plan');
        if (typeof window.upgradeToPlan === 'function') window.upgradeToPlan(ev, plan);
        return;
      }
    });
  });
})();
