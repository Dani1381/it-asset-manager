// session.js - Keeps the browser in sync with the server-side login session.
// Loaded on every protected page (dashboard, add, detail).
(function () {
  const LOGIN_URL = '/login.html';

  function goToLogin() {
    try { localStorage.removeItem('arka_user'); } catch (e) {}
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `${LOGIN_URL}?next=${next}`;
  }

  // Redirect to login whenever the server says the session is gone,
  // and explain clearly when a viewer tries an admin-only action.
  const nativeFetch = window.fetch.bind(window);
  let adminWarned = false;
  window.fetch = async function (input, init) {
    const res = await nativeFetch(input, init);
    if (res.status === 401) {
      goToLogin();
    } else if (res.status === 403 && !adminWarned) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/')) {
        adminWarned = true;
        setTimeout(() => { adminWarned = false; }, 3000);
        try {
          const data = await res.clone().json();
          if (data && data.code === 'ADMIN_ONLY') alert(data.error);
        } catch (e) {}
      }
    }
    return res;
  };

  // Server-side logout (clears the HttpOnly cookie) + local cleanup
  window.serverLogout = async function () {
    try { await nativeFetch('/api/logout', { method: 'POST' }); } catch (e) {}
    try { localStorage.removeItem('arka_user'); } catch (e) {}
    location.href = LOGIN_URL;
  };

  function showDefaultPasswordBanner() {
    if (document.getElementById('default-pass-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'default-pass-banner';
    bar.className = 'security-banner';
    const canOpenUsers = typeof window.openUsersModal === 'function';
    bar.innerHTML = `⚠️ رمز عبور پیش‌فرض ادمین (admin) هنوز تغییر نکرده است. چون سایت از اینترنت هم در دسترس است، همین حالا آن را عوض کنید.` +
      (canOpenUsers ? ` <button type="button" class="btn btn-sm btn-primary">تغییر رمز</button>` : '');
    const btn = bar.querySelector('button');
    if (btn) btn.onclick = () => window.openUsersModal();
    document.body.insertBefore(bar, document.body.firstChild);
  }

  async function verify() {
    try {
      const res = await nativeFetch('/api/auth-status', { cache: 'no-store' });
      const data = await res.json();
      if (!data.authenticated || !data.user) return goToLogin();

      // Keep the cached user (used for UI role checks) identical to the server
      const cached = (() => { try { return JSON.parse(localStorage.getItem('arka_user') || 'null'); } catch (e) { return null; } })();
      const fresh = { id: data.user.id, username: data.user.username, full_name: data.user.full_name, role: data.user.role, is_admin: !!data.user.is_admin };
      localStorage.setItem('arka_user', JSON.stringify(fresh));
      if (!cached || cached.id !== fresh.id || cached.role !== fresh.role) {
        location.reload();
        return;
      }

      if (data.default_password) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showDefaultPasswordBanner);
        else showDefaultPasswordBanner();
      }
    } catch (e) {
      // Network hiccup: leave the page as is
    }
  }

  verify();
})();
