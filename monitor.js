/* ═══════════════════════════════════════════
   NEXORA SECURITY MONITOR — App logic
   ═══════════════════════════════════════════ */

const API_BASE = 'https://nexora-api-sskg.onrender.com/api';
const REFRESH_MS = 10000; // auto-refresh every 10s

let currentUser = null;
let currentPage = 'dashboard';
let refreshTimer = null;

// ── helpers ──
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtRelative(d) {
  if (!d) return '—';
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function pillClass(s) {
  return String(s || '').toLowerCase();
}

function initials(name) {
  return String(name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── API wrapper ──
async function api(path, options = {}) {
  const opts = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);

  const res = await fetch(API_BASE + path, opts);
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── toast ──
function toast(msg, type = 'success') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

// ── modal ──
function openModal({ title, body, footer }) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-head">
          <div class="modal-title">${title}</div>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>
  `;
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── loader / empty ──
function loaderHTML(text = 'Loading…') {
  return `<div class="loader"><div class="spinner"></div><div>${esc(text)}</div></div>`;
}
function emptyHTML(icon, title, sub) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${esc(title)}</div>
      ${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}
    </div>
  `;
}

// ═══════════ AUTH ═══════════
async function bootSession() {
  try {
    const { user } = await api('/auth/me');
    if (!['admin', 'super_admin'].includes(user.role)) return false;
    currentUser = user;
    return true;
  } catch (e) {
    currentUser = null;
    return false;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const flash = document.getElementById('loginFlash');
  flash.innerHTML = '';
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Signing in…';

  try {
    await api('/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      },
    });
    const ok = await bootSession();
    if (!ok) {
      flash.innerHTML = '<div class="flash flash-danger">This account does not have monitor access.</div>';
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Sign In';
      return;
    }
    showApp();
    toast('Signed in', 'success');
  } catch (err) {
    flash.innerHTML = `<div class="flash flash-danger">${esc(err.data?.error || err.message)}</div>`;
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Sign In';
  }
}

async function handleLogout() {
  if (!confirm('Sign out of the security monitor?')) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  currentUser = null;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginForm').reset();
}

// ═══════════ APP SHELL ═══════════
function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  document.getElementById('userName').textContent = currentUser.full_name || currentUser.email;
  document.getElementById('userRole').textContent = currentUser.role.replace(/_/g, ' ');
  document.getElementById('userAvatar').textContent = initials(currentUser.full_name || currentUser.email);

  document.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => {
      const page = el.dataset.page;
      if (page) navigateTo(page);
      if (window.innerWidth <= 900) toggleSidebar();
    };
  });

  navigateTo('dashboard');

  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    // Auto-refresh the current page
    if (currentPage === 'dashboard') renderDashboard(true);
    else if (currentPage === 'events') renderEvents(true);
    else if (currentPage === 'blocked') renderBlocked(true);
  }, REFRESH_MS);
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('show');
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  events: 'Security Events',
  blocked: 'Blocked IPs',
  thresholds: 'Thresholds',
};

function navigateTo(page) {
  currentPage = page;
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  document.getElementById('content').innerHTML = loaderHTML();

  if (page === 'dashboard') renderDashboard();
  else if (page === 'events') renderEvents();
  else if (page === 'blocked') renderBlocked();
  else if (page === 'thresholds') renderThresholds();

  window.scrollTo({ top: 0 });
}

function setLiveStatus(ok, label) {
  const dot = document.getElementById('liveDot');
  const lbl = document.getElementById('liveLabel');
  dot.className = 'live-dot ' + (ok ? 'ok' : 'bad');
  lbl.textContent = label;
}

// ═══════════ DASHBOARD ═══════════
async function renderDashboard(silent = false) {
  const c = document.getElementById('content');
  if (!silent) c.innerHTML = loaderHTML();

  try {
    const s = await api('/security/summary');
    setLiveStatus(true, 'Live · updated ' + new Date().toLocaleTimeString());

    const badge = document.getElementById('blockedBadge');
    if (badge) badge.textContent = s.blocked_active;

    const sv = s.by_severity || { low: 0, medium: 0, high: 0, critical: 0 };

    c.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-label">Events (24h)</div>
          <div class="kpi-value">${s.events_24h}</div>
          <div class="kpi-sub">Total security events logged</div>
        </div>
        <div class="kpi critical">
          <div class="kpi-label">Critical</div>
          <div class="kpi-value">${sv.critical}</div>
          <div class="kpi-sub">SQL injection, XSS attempts</div>
        </div>
        <div class="kpi high">
          <div class="kpi-label">High</div>
          <div class="kpi-value">${sv.high}</div>
          <div class="kpi-sub">Scanners, bad user agents</div>
        </div>
        <div class="kpi medium">
          <div class="kpi-label">Medium</div>
          <div class="kpi-value">${sv.medium}</div>
          <div class="kpi-sub">Probes, missing UA, rate-limit</div>
        </div>
        <div class="kpi low">
          <div class="kpi-label">Low</div>
          <div class="kpi-value">${sv.low}</div>
          <div class="kpi-sub">Failed logins, admin actions</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Blocked IPs (active)</div>
          <div class="kpi-value">${s.blocked_active}</div>
          <div class="kpi-sub">${s.blocked_total} total ever blocked</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="dot"></span>Top Source IPs (24h)</div>
        </div>
        <div class="panel-body tight">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>IP Address</th><th class="right">Events</th><th></th></tr>
              </thead>
              <tbody>
                ${s.top_ips.length === 0
                  ? `<tr><td colspan="3">${emptyHTML('✅', 'No suspicious IPs', 'Nothing to worry about right now')}</td></tr>`
                  : s.top_ips.map(x => `
                    <tr>
                      <td class="mono">${esc(x.ip_address)}</td>
                      <td class="right">${x.c}</td>
                      <td class="right">
                        <button class="btn btn-outline btn-sm" onclick="openBlockModal('${esc(x.ip_address)}')">Block</button>
                      </td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (!silent) c.innerHTML = emptyHTML('⚠️', 'Failed to load dashboard', err.message);
    setLiveStatus(false, 'API offline');
  }
}

// ═══════════ EVENTS ═══════════
async function renderEvents(silent = false) {
  const c = document.getElementById('content');
  if (!silent) c.innerHTML = loaderHTML();

  try {
    const [events, types] = await Promise.all([
      api('/security/events?limit=200'),
      api('/security/event-types'),
    ]);
    setLiveStatus(true, 'Live · ' + events.events.length + ' events');

    const typeOptions = types.types.map(t =>
      `<option value="${esc(t.event_type)}">${esc(t.event_type)} (${t.c})</option>`
    ).join('');

    c.innerHTML = `
      <div class="filters">
        <select id="filterSeverity" onchange="renderEvents()">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select id="filterType" onchange="renderEvents()">
          <option value="">All types</option>
          ${typeOptions}
        </select>
        <button class="btn btn-outline btn-sm" onclick="renderEvents()">🔄 Refresh</button>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="dot"></span>Recent Events (${events.events.length})</div>
        </div>
        <div class="panel-body tight">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>IP</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>User Agent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${events.events.length === 0
                  ? `<tr><td colspan="8">${emptyHTML('✅', 'No events', 'All quiet')}</td></tr>`
                  : events.events.map(e => `
                    <tr>
                      <td title="${fmtDateTime(e.created_at)}">${fmtRelative(e.created_at)}</td>
                      <td><span class="pill ${pillClass(e.severity)}">${esc(e.severity)}</span></td>
                      <td class="mono">${esc(e.event_type)}</td>
                      <td class="mono">${esc(e.ip_address || '—')}</td>
                      <td class="mono">${esc(e.method || '—')}</td>
                      <td class="mono" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.path || '')}">${esc(e.path || '—')}</td>
                      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.user_agent || '')}">${esc(e.user_agent || '—')}</td>
                      <td>
                        ${e.ip_address ? `<button class="btn btn-outline btn-sm" onclick="openBlockModal('${esc(e.ip_address)}')">Block</button>` : ''}
                      </td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (!silent) c.innerHTML = emptyHTML('⚠️', 'Failed to load events', err.message);
    setLiveStatus(false, 'API offline');
  }
}

// ═══════════ BLOCKED IPs ═══════════
async function renderBlocked(silent = false) {
  const c = document.getElementById('content');
  if (!silent) c.innerHTML = loaderHTML();

  try {
    const { blocked } = await api('/security/blocked');
    setLiveStatus(true, 'Live · ' + blocked.length + ' blocked');

    const badge = document.getElementById('blockedBadge');
    if (badge) badge.textContent = blocked.filter(b => !b.expires_at || new Date(b.expires_at) > new Date()).length;

    c.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="dot"></span>Blocked IPs (${blocked.length})</div>
          <button class="btn btn-primary btn-sm" onclick="openBlockModal('')">+ Block IP</button>
        </div>
        <div class="panel-body tight">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Severity</th>
                  <th>Reason</th>
                  <th>Source</th>
                  <th>Blocked</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${blocked.length === 0
                  ? `<tr><td colspan="7">${emptyHTML('✅', 'No blocked IPs', 'Everything clean')}</td></tr>`
                  : blocked.map(b => {
                    const expires = b.expires_at ? fmtDateTime(b.expires_at) : 'Never';
                    const isAuto = b.blocked_by === 'auto';
                    return `
                      <tr>
                        <td class="mono"><strong>${esc(b.ip_address)}</strong></td>
                        <td><span class="pill ${pillClass(b.severity)}">${esc(b.severity)}</span></td>
                        <td>${esc(b.reason || '—')}</td>
                        <td><span class="pill ${isAuto ? 'auto' : 'admin'}">${isAuto ? 'AUTO' : 'ADMIN'}</span></td>
                        <td>${fmtRelative(b.blocked_at)}</td>
                        <td>${expires}</td>
                        <td>
                          <button class="btn btn-outline btn-sm" onclick="unblockIp('${esc(b.ip_address)}')">Unblock</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    if (!silent) c.innerHTML = emptyHTML('⚠️', 'Failed to load blocked IPs', err.message);
    setLiveStatus(false, 'API offline');
  }
}

// ═══════════ THRESHOLDS ═══════════
async function renderThresholds() {
  const c = document.getElementById('content');
  c.innerHTML = loaderHTML();

  try {
    const { thresholds } = await api('/security/thresholds');
    setLiveStatus(true, 'Live');

    c.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="dot"></span>Auto-block Thresholds</div>
        </div>
        <div class="panel-body tight">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Key</th><th>Description</th><th class="right">Value</th><th></th></tr>
              </thead>
              <tbody>
                ${thresholds.map(t => `
                  <tr>
                    <td class="mono"><strong>${esc(t.key)}</strong></td>
                    <td>${esc(t.description || '—')}</td>
                    <td class="right mono" id="thval-${esc(t.key)}">${t.value}</td>
                    <td class="right">
                      <button class="btn btn-outline btn-sm" onclick="openEditThreshold('${esc(t.key)}', ${t.value}, '${esc(t.description || '')}')">Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><span class="dot"></span>Maintenance</div>
        </div>
        <div class="panel-body">
          <p style="color:var(--text-soft);font-size:0.9rem;margin-bottom:1rem">
            Purge security events older than 90 days. This keeps the database lean and only removes log entries — no users, courses, or transactions are touched.
          </p>
          <button class="btn btn-danger" onclick="purgeOldEvents()">Purge events older than 90 days</button>
        </div>
      </div>
    `;
  } catch (err) {
    c.innerHTML = emptyHTML('⚠️', 'Failed to load thresholds', err.message);
    setLiveStatus(false, 'API offline');
  }
}

// ═══════════ ACTIONS ═══════════
function openBlockModal(ip) {
  openModal({
    title: 'Block IP Address',
    body: `
      <div class="form-group">
        <label>IP Address *</label>
        <input type="text" id="blockIp" value="${esc(ip)}" placeholder="e.g. 41.90.64.1">
      </div>
      <div class="form-group">
        <label>Reason</label>
        <input type="text" id="blockReason" placeholder="e.g. Repeated SQL injection attempts">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Severity</label>
          <select id="blockSeverity">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div class="form-group">
          <label>Duration (hours)</label>
          <input type="number" id="blockHours" value="24" min="1">
        </div>
      </div>
      <div style="font-size:0.8rem;color:var(--text-mute);margin-top:0.5rem">
        Leave duration blank to block permanently.
      </div>
    `,
    footer: `
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmBlock()">Block IP</button>
    `,
  });
}

async function confirmBlock() {
  const ip_address = document.getElementById('blockIp').value.trim();
  const reason = document.getElementById('blockReason').value.trim();
  const severity = document.getElementById('blockSeverity').value;
  const duration_hours = parseInt(document.getElementById('blockHours').value, 10) || null;

  if (!ip_address) { toast('IP address is required', 'error'); return; }

  try {
    await api('/security/blocked', {
      method: 'POST',
      body: { ip_address, reason, severity, duration_hours },
    });
    toast('IP blocked', 'success');
    closeModal();
    if (currentPage === 'blocked') renderBlocked();
    if (currentPage === 'dashboard') renderDashboard();
    if (currentPage === 'events') renderEvents();
  } catch (err) {
    toast(err.data?.error || err.message, 'error');
  }
}

async function unblockIp(ip) {
  if (!confirm(`Unblock ${ip}?`)) return;
  try {
    await api('/security/blocked/' + encodeURIComponent(ip), { method: 'DELETE' });
    toast('IP unblocked', 'success');
    renderBlocked();
  } catch (err) {
    toast(err.data?.error || err.message, 'error');
  }
}

function openEditThreshold(key, value, description) {
  openModal({
    title: 'Edit Threshold',
    body: `
      <div class="form-group">
        <label>Key</label>
        <input type="text" value="${esc(key)}" disabled>
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" value="${esc(description)}" disabled>
      </div>
      <div class="form-group">
        <label>Value *</label>
        <input type="number" id="thValue" value="${value}" min="1" step="1">
      </div>
    `,
    footer: `
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmEditThreshold('${esc(key)}')">Save</button>
    `,
  });
}

async function confirmEditThreshold(key) {
  const value = parseInt(document.getElementById('thValue').value, 10);
  if (!Number.isFinite(value) || value < 1) { toast('Enter a positive number', 'error'); return; }
  try {
    await api('/security/thresholds/' + encodeURIComponent(key), {
      method: 'PUT',
      body: { value },
    });
    toast('Threshold updated', 'success');
    closeModal();
    renderThresholds();
  } catch (err) {
    toast(err.data?.error || err.message, 'error');
  }
}

async function purgeOldEvents() {
  if (!confirm('Delete security events older than 90 days? This cannot be undone.')) return;
  try {
    await api('/security/purge', { method: 'POST' });
    toast('Old events purged', 'success');
    renderThresholds();
  } catch (err) {
    toast(err.data?.error || err.message, 'error');
  }
}

// ═══════════ BOOT ═══════════
(async function boot() {
  const ok = await bootSession();
  if (ok) showApp();
})();
