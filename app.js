// HAL front (fixed API base + fixed site_id)

const API_BASE = "https://maliwann.pythonanywhere.com";
const SITE_ID = "HAL";

// token is a simple opaque token stored locally for convenience
let token = localStorage.getItem("hal_token") || null;

// Menu cache structure: { sectionName: [ {id, section, title, url}, ... ] }
let MENU_CACHE = {};
let CURRENT_SECTION = null;

const $ = (id) => document.getElementById(id);

let spinnerTimer = null;

function showSpinner(msg="Loading…") {
  const sp = $("spinner");
  if (!sp) return;
  const label = sp.querySelector(".label");
  if (label) label.textContent = msg;
  sp.style.display = "flex";
  clearTimeout(spinnerTimer);
  spinnerTimer = setTimeout(() => hideSpinner(), 15000);
}

function hideSpinner() {
  const sp = $("spinner");
  if (!sp) return;
  sp.style.display = "none";
  clearTimeout(spinnerTimer);
  spinnerTimer = null;
}

function setStatus(msg, isError=false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("danger", !!isError);
}

function setAuthButton() {
  $("btnAuth").textContent = token ? "Logout" : "Login";
}

function authHeaders() {
  return token ? { "Authorization": "Bearer " + token } : {};
}

async function apiFetch(path, { method="GET", headers={}, body=null } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, init);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : `HTTP ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- Auth ----------
async function loginPopup() {
  const email = window.prompt("Email:");
  if (!email) return;
  const password = window.prompt("Password:");
  if (password === null) return;

  const d = await apiFetch("/api/login", { method: "POST", body: { email: email.trim(), password } });
  if (!d.ok || !d.token) throw new Error(d.error || "login_failed");

  token = d.token;
  localStorage.setItem("hal_token", token);
  setAuthButton();
  setStatus("✅ Logged in");

  await loadMemberships();
  await onAudienceChange(true); // set-audience + menu
}

async function logout() {
  try {
    if (token) await apiFetch("/api/logout", { method: "POST", headers: { ...authHeaders() } });
  } catch (_) {}

  token = null;
  localStorage.removeItem("hal_token");

  setAuthButton();
  $("audience").innerHTML = "";
  $("menu").innerHTML = "";
  $("frame").src = "about:blank";
  $("currentUrl").textContent = "-";
  MENU_CACHE = {};
  CURRENT_SECTION = null;

  setStatus("👋 Logged out");
}

// ---------- Memberships ----------
async function loadMemberships() {
  if (!token) throw new Error("not_logged_in");

  const d = await apiFetch("/api/me?site_id=" + encodeURIComponent(SITE_ID), { headers: { ...authHeaders() } });
  const sel = $("audience");
  sel.innerHTML = "";

  (d.memberships || []).forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.audience;
    opt.textContent = m.label || m.audience;
    sel.appendChild(opt);
  });

  if (d.active_audience) sel.value = d.active_audience;

  if (!(d.memberships || []).length) {
    setStatus("⚠️ No memberships for this site_id (HAL).", true);
  } else {
    setStatus("✅ Memberships loaded");
  }
}

// ---------- Audience switch ----------
async function setAudience(audience) {
  if (!token) throw new Error("not_logged_in");

  const d = await apiFetch("/api/set-audience", {
    method: "POST",
    headers: { ...authHeaders() },
    body: { site_id: SITE_ID, audience }
  });

  if (!d.ok) throw new Error(d.error || "set_audience_failed");
}

async function loadMenu() {
  if (!token) throw new Error("not_logged_in");

  const d = await apiFetch("/api/menu?site_id=" + encodeURIComponent(SITE_ID), { headers: { ...authHeaders() } });
  if (!d.ok) throw new Error(d.error || "menu_failed");

  MENU_CACHE = d.menu || {};
  renderSectionsOnly(MENU_CACHE);
  setStatus("✅ Menu loaded");
}

// NEW: active highlight helper
function setActiveSection(section) {
  document.querySelectorAll("a.menu-item").forEach(a => {
    a.classList.toggle("active", a.dataset.section === section);
  });
}

// when dropdown changes => set-audience + reload menu + refresh current view
async function onAudienceChange(force=false) {
  if (!token) return;

  const sel = $("audience");
  const audience = sel.value;
  const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : audience;

  if (!audience) return;

  try {
    setStatus("⏳ Switching view…");
    await setAudience(audience);
    await loadMenu();

    // refresh current view
    const r = parseHash();
    if (r) {
      if (r.kind === "section") openSectionHub(r.section);
      if (r.kind === "page") openPage(r.section, r.pageId);
    } else {
      // default view: show first section hub
      const secs = Object.keys(MENU_CACHE || {});
      if (secs.length) navigateToSection(secs[0]);
    }

    setStatus(`🛠️ Designed for: ${label}`);
  } catch (e) {
    setStatus("Audience/menu error: " + e.message, true);
  }
}

// ---------- Left panel: sections only ----------
function renderSectionsOnly(menu) {
  const menuDiv = $("menu");
  menuDiv.innerHTML = "";

  const sections = Object.keys(menu || {});
  if (!sections.length) {
    menuDiv.innerHTML = `No pages for this view.`;
    return;
  }

  sections.forEach(section => {
    const count = (menu[section] || []).length;

    const a = document.createElement("a");
    a.className = "menu-item";
    a.dataset.section = section;

    a.href = "#/section/" + encodeURIComponent(section);

    const left = document.createElement("span");
    left.textContent = section;

    const right = document.createElement("span");
    right.className = "count";
    right.textContent = String(count);

    a.appendChild(left);
    a.appendChild(right);

    a.onclick = (ev) => {
      ev.preventDefault();
      navigateToSection(section);
    };

    menuDiv.appendChild(a);
  });

  // keep highlight after menu rebuild
  if (CURRENT_SECTION) setActiveSection(CURRENT_SECTION);
}

// ---------- Section hub (cards) ----------
function navigateToSection(section) {
  location.hash = "#/section/" + encodeURIComponent(section);
  openSectionHub(section);
}

function openSectionHub(section) {
  if (!token) { setStatus("Please login first.", true); return; }

  CURRENT_SECTION = section;
  setActiveSection(section);

  const pages = (MENU_CACHE && MENU_CACHE[section]) ? MENU_CACHE[section] : [];
  $("currentUrl").textContent = `/${SITE_ID}/${section}`;

  const cardsHtml = (pages || []).map(p => {
    const title = escapeHtml(p.title || p.id);
    const path = `/${SITE_ID}/${section}/${p.id}`;
    return `
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:10px 0;font-family:Arial;">
        <div style="font-weight:700;font-size:16px;margin-bottom:6px;">${title}</div>
        <div style="color:#6b7280;font-size:12px;">${escapeHtml(path)}</div>
        <div style="margin-top:10px;">
          <a href="#/${encodeURIComponent(section)}/${encodeURIComponent(p.id)}" style="color:#2563eb;text-decoration:none;font-weight:700;">Open</a>
        </div>
      </div>
    `;
  }).join("");

  const html = `
    <div style="padding:18px;font-family:Arial;">
      <div style="font-weight:800;font-size:28px;margin-bottom:8px;">${escapeHtml(section)}</div>
      <div style="color:#6b7280;margin-bottom:14px;">Select a card to open the page.</div>
      ${cardsHtml || `<div style="color:#6b7280;">No pages in this section.</div>`}
    </div>
  `;

  showSpinner("Loading section…");
  const frame = $("frame");
  frame.src = "about:blank";
  frame.srcdoc = html; // local render
}

// ---------- Real page open (iframe) ----------
function openPage(section, pageId) {
  if (!token) { setStatus("Please login first.", true); return; }

  CURRENT_SECTION = section;
  setActiveSection(section);

  const urlPath = `/${encodeURIComponent(SITE_ID)}/${encodeURIComponent(section)}/${encodeURIComponent(pageId)}`;
  const src = API_BASE + urlPath + "?t=" + encodeURIComponent(token);

  $("currentUrl").textContent = urlPath;
  showSpinner("Loading page…");

  const frame = $("frame");
  frame.removeAttribute("srcdoc");
  frame.src = "about:blank";
  setTimeout(() => { frame.src = src; }, 0);
}

// Bind spinner to iframe events
(function bindFrameSpinner(){
  const frame = $("frame");
  frame.addEventListener("load", () => hideSpinner());
  frame.addEventListener("error", () => {
    hideSpinner();
    setStatus("Iframe load error (blocked / 404 / 500).", true);
  });
})();

// ---------- Routing ----------
function parseHash() {
  const h = location.hash || "";
  if (!h.startsWith("#/")) return null;

  const parts = h.slice(2).split("/").map(decodeURIComponent).filter(Boolean);

  // #/section/{section}
  if (parts[0] === "section" && parts.length >= 2) {
    return { kind: "section", section: parts.slice(1).join("/") };
  }

  // #/{section}/{pageId...}
  if (parts.length >= 2) {
    return { kind: "page", section: parts[0], pageId: parts.slice(1).join("/") };
  }

  return null;
}

window.addEventListener("hashchange", () => {
  const r = parseHash();
  if (!r) return;
  if (r.kind === "section") openSectionHub(r.section);
  if (r.kind === "page") openPage(r.section, r.pageId);
});

// ---------- UI bindings ----------
$("btnAuth").onclick = async () => {
  if (token) await logout();
  else {
    try { await loginPopup(); }
    catch (e) { setStatus("Login error: " + e.message, true); }
  }
};

$("audience").addEventListener("change", () => {
  onAudienceChange(false);
});

// ---------- Boot ----------
(async function boot(){
  setAuthButton();

  if (!token) {
    setStatus("🔐 Please login.");
    return;
  }

  try {
    setStatus("🔁 Restoring session…");
    await loadMemberships();
    await onAudienceChange(true);

    const r = parseHash();
    if (r) {
      if (r.kind === "section") openSectionHub(r.section);
      if (r.kind === "page") openPage(r.section, r.pageId);
    }
  } catch (e) {
    setStatus("Session invalid. Please login again.", true);
    token = null;
    localStorage.removeItem("hal_token");
    setAuthButton();
  }
})();

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}