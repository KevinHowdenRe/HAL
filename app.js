// HAL front (fixed API base + fixed site_id)
// - Login popup panel: sections only (from backend menu keys)// - Login popup (prompt)
// - Clicking a section shows a "Section hub" with cards (srcdoc)
// - Clicking a card opens the real page in iframe: /{site}/{section}/{page}?t=TOKEN

const API_BASE = "https://maliwann.pythonanywhere.com";
const SITE_ID  = "HAL";



const COMMON_CSS = `
:root{
  --accent:#218D80;
  --bg:#f8fafc;
  --text:#0f172a;
  --muted:#64748b;
  --border:rgba(15,23,42,.12);
  --card:#ffffff;
}
*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0;
  padding:18px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color:var(--text);
  background:var(--bg); /* uniforme */
}
h1,h2{ margin:0 0 10px 0; letter-spacing:-0.02em; line-height:1.15; }
h1{ font-size:28px; font-weight:500; }
h2{ font-size:24px; font-weight:500; }
.muted{ color:var(--muted); font-size:13px; margin:6px 0 14px 0; }
a{ color:var(--accent); text-decoration:none; font-weight:500; }
a:hover{ text-decoration:underline; }
.container{ max-width:1100px; margin:0 auto; }
.grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
.card{
  background:var(--card);
  border:1px solid var(--border);
  border-radius:14px;
  padding:14px;
  cursor:pointer;
  transition: transform .08s ease, box-shadow .08s ease, border-color .08s ease;
  box-shadow: 0 1px 0 rgba(15,23,42,.04);
}
.card:hover{
  transform: translateY(-1px);
  border-color: rgba(33,141,128,.35);
  box-shadow: 0 10px 24px rgba(15,23,42,.08);
}
.card-title{ font-weight:800; margin-bottom:6px; font-size:14px; letter-spacing:-0.01em; }
.card-sub{ color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.card-row{ display:flex; gap:12px; align-items:center; }
.thumb{
  width:58px; height:58px;
  border-radius:10px;
  border:1px solid #e5e7eb;
  object-fit:cover;
  background:#f9fafb;
  flex:0 0 auto;
}
.card-text{ min-width:0; }
.no-thumb .card-row{ gap:0; }

`;


function wrapDoc(bodyHtml, title=""){
  return `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>${COMMON_CSS}</style>
  </head><body>${bodyHtml}</body></html>`;
}



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
  $("status").innerHTML = isError ? `<span class="danger">${escapeHtml(msg)}</span>` : escapeHtml(msg);
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
  setStatus("✅ Connecté");

  await loadMemberships();
  await onAudienceChange(true); // set-audience + menu
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
  
  const f = $("frame");
  f.srcdoc = "";
  f.src = "about:blank";

  $("currentUrl").textContent = "-";
  MENU_CACHE = {};
  CURRENT_SECTION = null;
  setStatus("🔒 Déconnecté");
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
  updateAudienceVisibility();
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

  MENU_CACHE = d.menu || {};
  renderSectionsOnly(MENU_CACHE);
  setStatus("✅ Menu loaded");
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
      //const secs = Object.keys(MENU_CACHE || {});
      //if (secs.length) navigateToSection(secs[0]);
	  loadFixedPage("welcome");
	  
    }

    if (force) setStatus(`🛠️ Conçu pour: ${label}`);
    else setStatus(`🛠️ Conçu pour : ${label}`);
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
    menuDiv.innerHTML = `<div class="muted">No pages for this view.</div>`;
    return;
  }

  sections.forEach(section => {
    const count = (menu[section] || []).length;

    const a = document.createElement("a");
    a.className = "menu-item";
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
}

// ---------- Section hub (cards) ----------
function navigateToSection(section) {
  location.hash = "#/section/" + encodeURIComponent(section);
  openSectionHub(section);
}

function openSectionHub(section) {
  if (!token) { setStatus("Please login first.", true); return; }

  CURRENT_SECTION = section;

  const pages = (MENU_CACHE && MENU_CACHE[section]) ? MENU_CACHE[section] : [];
  $("currentUrl").textContent = `/${SITE_ID}/${section}`;

  const cardsHtml = (pages || []).map(p => {
  const title = escapeHtml(p.title || p.id);
  const pidEnc = encodeURIComponent(p.id);
  const secEnc = encodeURIComponent(section);
  const path = `/${SITE_ID}/${section}/${p.id}`;
  const img = thumbUrl(section, p.id);

  return `
    <div class="card" onclick="parent.location.hash='#/${secEnc}/${pidEnc}'" role="button" tabindex="0">
      <div class="card-row">
        <img class="thumb" src="${img}" alt="" loading="lazy"
             onerror="this.style.display='none'; this.closest('.card').classList.add('no-thumb');" />
        <div class="card-text">
          <div class="card-title">${title}</div>
          <div class="card-sub">${escapeHtml(path)}</div>
        </div>
      </div>
    </div>
  `;
}).join("");

  const html = wrapDoc(`
    
      <h1>${escapeHtml(section)}</h1>
      <div class="muted">Select a card to open the page.</div>
      <div class="grid">
        ${cardsHtml || `<div class="muted">No pages in this section.</div>`}
      </div>
  `);

  showSpinner("Chargement des sections…");
  const frame = $("frame");
  frame.src = "about:blank";   // reset
  frame.srcdoc = html;        // local render
}

// ---------- Real page open (iframe) ----------
function openPage(section, pageId) {
  if (!token) { setStatus("Connexion requise.", true); return; }

  const urlPath = `/${encodeURIComponent(SITE_ID)}/${encodeURIComponent(section)}/${encodeURIComponent(pageId)}`;
  const src = API_BASE + urlPath + "?t=" + encodeURIComponent(token);

  $("currentUrl").textContent = urlPath;

  showSpinner("Chargement…");

  const frame = $("frame");

  // ✅ IMPORTANT: srcdoc can be sticky -> remove it
  frame.removeAttribute("srcdoc");

  // Reset then navigate (helps browsers apply the navigation)
  frame.src = "about:blank";
  setTimeout(() => {
    frame.src = src;
  }, 0);
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

  // #/section/<sectionName>
  if (parts[0] === "section" && parts.length >= 2) {
    return { kind: "section", section: parts.slice(1).join("/") }; // allow section names with slashes if ever
  }

  // #/<section>/<pageId>
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
  // whenever dropdown changes => triggers set-audience + reload menu
  onAudienceChange(false);
});


function updateAudienceVisibility() {
  const sel = document.getElementById("audience");
  const wrap = document.getElementById("audienceWrap");
  wrap.style.display = (sel && sel.options.length >= 2) ? "" : "none";
}

// ---- Pages fixes ----------
function renderFixedTopBottom(){
  const top = document.getElementById("fixedTop");
  const bottom = document.getElementById("fixedBottom");
  if(!top || !bottom) return;

  const mk = (label, onClick) => {
    const a = document.createElement("a");
    a.className = "menu-item";
    a.href = "#";
    a.innerHTML = `<span>${label}</span><span class="count"></span>`;
    a.onclick = (e) => { e.preventDefault(); onClick(); };
    return a;
  };

  top.innerHTML = "";
  bottom.innerHTML = "";

  top.appendChild(mk("Introduction", () => loadFixedPage("welcome")));
  bottom.appendChild(mk("Contact", () => loadFixedPage("contact")));
}

function loadFixedPage(which){
  const frame = document.getElementById("frame"); // <-- change id if needed
  if(which === "welcome"){
    frame.srcdoc = wrapDoc(`
      <h2>Bienvenue</h2>
	<p>
	Cet espace vous donne accès à vos analyses, rapports et outils personnalisés. 
	Utilisez le menu à gauche pour naviguer entre les différentes sections.
	</p>
	<p>
	La rubrique <strong>Articles</strong> regroupe les études réalisées ou partagées avec vous.  
	La section <strong>Documentation</strong> explique en détail comment utiliser nos outils, ce que signifie notre approche "Client Side" notamment en terme de sécurité et confidentialité de la donnée.  
	Dans <strong>Solutions</strong>, vous trouverez les outils développés pour vos besoins.  
	Enfin, la page <strong>Contact</strong> vous permet d’échanger avec nous autour de vos projets.
	</p>`);
  } else {
    frame.srcdoc = wrapDoc(`
      <h2>Contact</h2>

<p>
Pour toute question, demande d’information ou échange autour de vos projets, vous pouvez nous joindre directement via les coordonnées ci‑dessous.
</p>

<p>
Email : <a href="mailto:demo@local">demo@local</a><br>
Téléphone : <a href="tel:+33606998874">06 06 99 88 74</a>
</p>

<p>Nous sommes situés au 14 rue Lafayette, Paris :</p>

<iframe
  width="100%"
  height="300"
  style="border:0; border-radius:8px;"
  loading="lazy"
  allowfullscreen
  referrerpolicy="no-referrer-when-downgrade"
  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.548812977981!2d2.341953!3d48.874051!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47e66e15c3e2d4d1%3A0x8e3e6b0e0ef5c975!2s14%20Rue%20La%20Fayette%2C%2075009%20Paris!5e0!3m2!1sfr!2sfr!4v0000000000000">
</iframe>`);
  }
}

// ---------- Boot ----------
(async function boot(){
  setAuthButton();
  renderFixedTopBottom();
  loadFixedPage("welcome");
  if (!token) {
    setStatus("🔐 Connexion requise.");
    return;
  }

  try {
    setStatus("🔁 Restoration de session…");
	
    await loadMemberships();
    await onAudienceChange(true);

    // If URL hash already points somewhere, open it
    const r = parseHash();
    if (r) {
      if (r.kind === "section") openSectionHub(r.section);
      if (r.kind === "page") openPage(r.section, r.pageId);
    }
  } catch (e) {
    // token may be expired/revoked
    setStatus("Session invalid. Please login again.", true);
    token = null;
    localStorage.removeItem("hal_token");
    setAuthButton();
  }
})();

// ---------- Helpers ----------

function thumbUrl(section, pageId) {
  // Keep it purely convention-based (no backend changes)
  // Example: /static/sites/HAL/thumbs/solutions/risk-map.png
  return `${API_BASE}/sites/${encodeURIComponent(SITE_ID)}/thumbs/${encodeURIComponent(section)}/${encodeURIComponent(pageId)}.png`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
// - Audience dropdown triggers set-audience + menu reload
