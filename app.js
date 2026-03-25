// HAL front (fixed API base + fixed site_id)
// - Login popup (prompt)
// - Audience dropdown triggers set-audience + menu reload
// - Iframe loads /{site}/{section}/{page}?t=TOKEN

const API_BASE = "https://maliwann.pythonanywhere.com";
const SITE_ID  = "HAL";

let token = localStorage.getItem("hal_token") || null;

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
  $("status").innerHTML = isError ? `<span class="danger">${msg}</span>` : msg;
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

  const d = await apiFetch("/api/login", {
    method: "POST",
    body: { email: email.trim(), password }
  });

  if (!d.ok || !d.token) throw new Error(d.error || "login_failed");

  token = d.token;
  localStorage.setItem("hal_token", token);
  setAuthButton();
  setStatus("✅ Logged in");

  // load memberships and menu
  await loadMemberships();
  await onAudienceChange(true); // force set-audience + menu
}

async function logout() {
  try {
    if (token) {
      await apiFetch("/api/logout", {
        method: "POST",
        headers: { ...authHeaders() }
      });
    }
  } catch (_) {
    // ignore
  }
  token = null;
  localStorage.removeItem("hal_token");
  setAuthButton();
  $("audience").innerHTML = "";
  $("menu").innerHTML = "";
  $("frame").src = "about:blank";
  $("currentUrl").textContent = "-";
  setStatus("👋 Logged out");
}

// ---------- Memberships ----------
async function loadMemberships() {
  if (!token) throw new Error("not_logged_in");

  const d = await apiFetch("/api/me?site_id=" + encodeURIComponent(SITE_ID), {
    headers: { ...authHeaders() }
  });

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

// ---------- Audience switch (auto triggers set-audience + menu) ----------
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
  const d = await apiFetch("/api/menu?site_id=" + encodeURIComponent(SITE_ID), {
    headers: { ...authHeaders() }
  });
  if (!d.ok) throw new Error(d.error || "menu_failed");
  renderMenu(d.menu || {});
  setStatus("✅ Menu loaded");
}

// if user changes dropdown => set audience + load menu + (optionally reload current page)
async function onAudienceChange(force=false) {
  if (!token) return;

  const audience = $("audience").value;
  if (!audience) return;

  try {
    setStatus("⏳ Switching view…");
    await setAudience(audience);
    await loadMenu();

    // If a page is already open (hash route), reload it to reflect audience-based variant
    const route = parseHash();
    if (route) openPage(route.section, route.pageId);
    else {
      // optional: open a default page if you want
      // openPage("docs", "home");
    }

    if (!force) setStatus(`✅ View active: ${audience}`);
    else setStatus(`✅ View active: ${audience}`);
  } catch (e) {
    setStatus("Audience/menu error: " + e.message, true);
  }
}

// ---------- Menu rendering ----------
function renderMenu(menu) {
  const menuDiv = $("menu");
  menuDiv.innerHTML = "";

  const sections = Object.keys(menu);
  if (!sections.length) {
    menuDiv.innerHTML = `<div class="muted">No pages for this view.</div>`;
    return;
  }

  sections.forEach(section => {
    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `<div class="section-title">${section}</div>`;
    menuDiv.appendChild(sec);

    (menu[section] || []).forEach(p => {
      const a = document.createElement("a");
      a.className = "menu-item";
      a.href = "#/" + [p.section, p.id].map(encodeURIComponent).join("/");
      a.textContent = p.title || p.id;
      a.onclick = (ev) => {
        ev.preventDefault();
        navigateTo(p.section, p.id);
      };
      sec.appendChild(a);
    });
  });
}

// ---------- Routing (#/section/page) ----------
function navigateTo(section, pageId) {
  const hash = "#/" + [section, pageId].map(encodeURIComponent).join("/");
  location.hash = hash;
  openPage(section, pageId);
}

function parseHash() {
  const h = location.hash || "";
  if (!h.startsWith("#/")) return null;
  const parts = h.slice(2).split("/").map(decodeURIComponent).filter(Boolean);
  if (parts.length < 2) return null;
  return { section: parts[0], pageId: parts[1] };
}

// ---------- Iframe open ----------
function openPage(section, pageId) {
  if (!token) { setStatus("Please login first.", true); return; }
  const urlPath = `/${encodeURIComponent(SITE_ID)}/${encodeURIComponent(section)}/${encodeURIComponent(pageId)}`;
  const src = API_BASE + urlPath + "?t=" + encodeURIComponent(token);

  $("currentUrl").textContent = urlPath;
  showSpinner("Loading page…");
  $("frame").src = src;
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

// ---------- UI bindings ----------
$("btnAuth").onclick = async () => {
  if (token) await logout();
  else {
    try { await loginPopup(); }
    catch (e) { setStatus("Login error: " + e.message, true); }
  }
};

$("audience").addEventListener("change", () => {
  // whenever dropdown changes => triggers Activer la vue + Charger menu
  onAudienceChange(false);
});

// Hash change opens pages
window.addEventListener("hashchange", () => {
  const r = parseHash();
  if (r) openPage(r.section, r.pageId);
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
    await onAudienceChange(true);   // set-audience + menu
    const r = parseHash();
    if (r) openPage(r.section, r.pageId);
  } catch (e) {
    // token may be expired/revoked
    setStatus("Session invalid. Please login again.", true);
    token = null;
    localStorage.removeItem("hal_token");
    setAuthButton();
  }
})();