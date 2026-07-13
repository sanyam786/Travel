// Shared nav behavior: notification bell + live feed, included on every page.
// Creates its own Supabase client so it works regardless of page-specific script order.
(function () {
  const SUPABASE_URL = window.SUPABASE_URL || 'https://yaqzlytfwvvcygwxzdhr.supabase.co';
  const SUPABASE_ANON = window.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhcXpseXRmd3Z2Y3lnd3h6ZGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Nzc5NzUsImV4cCI6MjA5OTI1Mzk3NX0.lQyAFpD0NbEnDpUkDrIabJ7e1aaO3gA9Kzyxq0MQmCg';

  if (typeof supabase === 'undefined') return;
  const sbNav = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function renderPanel(list) {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    if (!list.length) {
      panel.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No notifications yet</div>';
      return;
    }
    panel.innerHTML = list.map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}" onclick="__navClickNotif('${n.id}','${n.trip_id}')">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>`).join('');
  }

  function setBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count > 9 ? '9+' : String(count); badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  }

  let notifications = [];

  async function loadNotifications(userId) {
    const { data } = await sbNav.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
    notifications = data || [];
    renderPanel(notifications);
    setBadge(notifications.filter(n => !n.read).length);
  }

  window.__navClickNotif = async function (id, tripId) {
    await sbNav.from('notifications').update({ read: true }).eq('id', id);
    window.location.href = '/trip.html?id=' + tripId;
  };

  function mountBell(userId) {
    const mount = document.getElementById('notifMount');
    if (!mount) return;
    mount.innerHTML = `
      <div style="position:relative">
        <button class="btn btn-ghost btn-sm" id="notifBtn" style="padding:8px 10px;position:relative" aria-label="Notifications">
          🔔<span id="notifBadge" class="notif-badge" style="display:none"></span>
        </button>
        <div id="notifPanel" class="notif-panel" style="display:none"></div>
      </div>`;
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { panel.style.display = 'none'; });
    panel.addEventListener('click', (e) => e.stopPropagation());
    loadNotifications(userId);

    sbNav.channel('notifications:' + userId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => loadNotifications(userId))
      .subscribe();
  }

  // ---- SIDEBAR (hideable app navigation, overlay drawer so it never reflows
  // page-specific layouts like trip.html's itinerary sidebar/map) ----
  const NAV_LINKS = [
    { href: '/dashboard.html', icon: '📊', label: 'My Trips' },
    { href: '/plan.html', icon: '➕', label: 'Plan a Trip' }
  ];

  function closeSidebar() {
    const panel = document.getElementById('sidenavPanel');
    const backdrop = document.getElementById('sidenavBackdrop');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function toggleSidebar() {
    const panel = document.getElementById('sidenavPanel');
    const backdrop = document.getElementById('sidenavBackdrop');
    if (!panel) return;
    const opening = !panel.classList.contains('open');
    panel.classList.toggle('open', opening);
    backdrop.classList.toggle('open', opening);
  }

  function mountSidebar(session) {
    const navEl = document.querySelector('.nav');
    const brand = document.querySelector('.nav-brand');
    if (!navEl || !brand || document.getElementById('sidenavPanel')) return;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.id = 'sidenavToggle';
    toggleBtn.setAttribute('aria-label', 'Open navigation menu');
    toggleBtn.style.marginRight = '4px';
    toggleBtn.textContent = '☰';
    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
    navEl.insertBefore(toggleBtn, brand);

    const path = window.location.pathname;
    const name = session.user.user_metadata?.full_name || session.user.email.split('@')[0];

    const backdrop = document.createElement('div');
    backdrop.id = 'sidenavBackdrop';
    backdrop.className = 'sidenav-backdrop';
    backdrop.addEventListener('click', closeSidebar);
    document.body.appendChild(backdrop);

    const panel = document.createElement('div');
    panel.id = 'sidenavPanel';
    panel.className = 'sidenav';
    panel.innerHTML = `
      <div class="sidenav-hdr">
        <a href="/dashboard.html" class="nav-brand">✈️ WanderAI</a>
        <button class="btn btn-ghost btn-sm" id="sidenavClose" aria-label="Close navigation menu">✕</button>
      </div>
      <div class="sidenav-user">👋 ${name}</div>
      <nav class="sidenav-links">
        ${NAV_LINKS.map(l => `<a href="${l.href}" class="sidenav-link${path === l.href ? ' on' : ''}">${l.icon} ${l.label}</a>`).join('')}
      </nav>
      <button class="sidenav-link sidenav-logout" id="sidenavLogout">🚪 Log out</button>`;
    document.body.appendChild(panel);

    document.getElementById('sidenavClose').addEventListener('click', closeSidebar);
    document.getElementById('sidenavLogout').addEventListener('click', async () => {
      await sbNav.auth.signOut();
      window.location.href = '/';
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  }

  (async () => {
    const { data: { session } } = await sbNav.auth.getSession();
    if (!session) return;
    await sbNav.rpc('claim_invites');
    mountBell(session.user.id);
    mountSidebar(session);
  })();
})();
