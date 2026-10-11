const root = document.getElementById("app");

let me = null;
let elderlyMode = localStorage.getItem("elderly_mode") === "true";
let liveSyncTimer = null;
let dynamicPatientsList = [];
let dynamicDoctorsList = [];
let systemSetupStatus = { isInitialized: true, userCount: 0, adminCount: 0 };

if (elderlyMode) {
  document.body.classList.add("elderly-mode");
}

const esc = val => {
  if (val === null || val === undefined) return "";
  return String(val).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};

async function api(url, options = {}) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "An error occurred");
  return data;
}

function toggleElderlyMode() {
  elderlyMode = !elderlyMode;
  localStorage.setItem("elderly_mode", elderlyMode);
  document.body.classList.toggle("elderly-mode", elderlyMode);
  boot();
}

function speakText(text) {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  } else {
    alert(text);
  }
}

/* ------------------------------------------------------------------ */
/* Navigation & Header Component                                      */
/* ------------------------------------------------------------------ */

function renderNavbar() {
  return `
    <div class="demo-banner">
      <div style="display:flex;align-items:center;gap:8px">
        <strong style="color:#38bdf8">🏥 MEDI CORE CONNECTED HOSPITAL:</strong>
        <span style="font-size:11px;color:#cbd5e1">ONE PATIENT • ONE LONGITUDINAL MEDICAL RECORD • COMPLETE PATINOTE</span>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="loadDemoDataset()">⚡ Load Demo Data</button>
        <button class="btn btn-outline" style="font-size:11px;padding:3px 8px;color:white;border-color:rgba(255,255,255,0.3)" onclick="resetSystemToClean()">🗑 Reset to Clean DB</button>
      </div>
    </div>

    <nav class="navbar">
      <div class="brand" onclick="me ? route() : renderLanding()" style="cursor:pointer">
        <div class="brand-mark">✚</div>
        <div>
          <strong style="font-size:18px;color:var(--blue-dark);letter-spacing:-0.5px">MEDI CORE</strong>
          <span style="font-size:10px;display:block;color:var(--muted);font-weight:600">Connected Operating Platform & PATINOTE</span>
        </div>
      </div>

      ${me ? `
        <div class="search-container">
          <span class="search-icon">🔍</span>
          <input id="globalSearch" class="search-input" placeholder="Universal Search (Patient Name, MRN, Doctor, Prescription, Bed)..." oninput="handleGlobalSearch(event)" />
          <div id="searchDropdown" class="search-dropdown"></div>
        </div>
      ` : ''}

      <div class="nav-actions">
        ${me ? `
          <select class="role-switcher-select" onchange="quickSwitchRole(this.value)" title="Quick Role Switcher">
            <option value="" disabled selected>Role: ${me.role}</option>
            <option value="PATIENT">👤 Patient Portal</option>
            <option value="RECEPTIONIST">📋 Receptionist Desk</option>
            <option value="DOCTOR">🩺 Doctor PATINOTE Workspace</option>
            <option value="NURSE">💉 Nurse Ward</option>
            <option value="PHARMACIST">💊 Pharmacy Dispensing</option>
            <option value="LAB_STAFF">🧪 Pathology Lab</option>
            <option value="SCAN_TECH">📻 Radiology Scanning</option>
            <option value="HOSPITAL_ADMIN">🏛 Hospital Command Center</option>
            <option value="ADMIN">⚙ System Governance</option>
          </select>
        ` : ''}

        <button class="btn btn-outline" style="font-size:12px;padding:4px 10px" onclick="toggleElderlyMode()">👓 ${elderlyMode ? 'Standard Mode' : 'EASY MODE'}</button>
        
        ${me ? `
          <button class="btn btn-ghost" style="font-size:14px;position:relative" onclick="openNotificationsModal()" title="Notifications">
            🔔 <span id="notifBadge" class="pill pill-red" style="font-size:9px;padding:1px 5px;position:absolute;top:-2px;right:-2px;display:none">0</span>
          </button>
          <div style="font-size:12px;text-align:right">
            <strong style="display:block">${esc(me.name)}</strong>
            <span class="pill pill-blue" style="font-size:9px;padding:1px 6px">${esc(me.role)}</span>
          </div>
          <button class="btn btn-outline" style="font-size:12px" onclick="logout()">Sign Out</button>
        ` : `
          <button class="btn btn-secondary" onclick="openRegisterPatientModal()">Register Patient</button>
          <button class="btn btn-primary" onclick="renderLogin()">Sign In</button>
        `}
      </div>
    </nav>
  `;
}

/* ------------------------------------------------------------------ */
/* CENTRAL MODULE CONFIGURATION & ROLE AUTHORIZATION MAP              */
/* ------------------------------------------------------------------ */

const MODULES = [
  {
    id: "admin",
    name: "Admin",
    icon: "🏥",
    route: "admin",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN"],
    render: () => renderCommandCenter()
  },
  {
    id: "reception",
    name: "Reception",
    icon: "🧑‍💼",
    route: "reception",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"],
    render: () => renderReceptionPortal()
  },
  {
    id: "doctor",
    name: "Doctor",
    icon: "👨‍⚕️",
    route: "doctor",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "DOCTOR"],
    render: () => renderDoctorPortal()
  },
  {
    id: "nurse",
    name: "Nurse",
    icon: "👩‍⚕️",
    route: "nurse",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "NURSE", "DOCTOR"],
    render: () => renderNursePortal()
  },
  {
    id: "pharmacy",
    name: "Pharmacy",
    icon: "💊",
    route: "pharmacy",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "PHARMACIST"],
    render: () => renderPharmacyPortal()
  },
  {
    id: "laboratory",
    name: "Laboratory",
    icon: "🧪",
    route: "laboratory",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "LAB_STAFF"],
    render: () => renderLabPortal()
  },
  {
    id: "radiology",
    name: "Scanning / Radiology",
    icon: "🩻",
    route: "radiology",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "SCAN_TECH"],
    render: () => renderScanPortal()
  },
  {
    id: "beds",
    name: "Beds / Admission",
    icon: "🛏️",
    route: "beds",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "NURSE", "RECEPTIONIST"],
    render: () => renderBedPortal()
  },
  {
    id: "emergency",
    name: "Emergency",
    icon: "🚨",
    route: "emergency",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "DOCTOR", "NURSE"],
    render: () => renderEmergencyPortal()
  },
  {
    id: "billing",
    name: "Billing",
    icon: "💳",
    route: "billing",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST", "PHARMACIST"],
    render: () => renderBillingPortal()
  },
  {
    id: "patient",
    name: "Patient Portal",
    icon: "👤",
    route: "patient",
    allowedRoles: ["ADMIN", "HOSPITAL_ADMIN", "PATIENT", "DOCTOR", "RECEPTIONIST"],
    render: () => renderPatientPortal()
  }
];

function getAllowedModulesForUser(user) {
  if (!user) return [];
  if (user.role === "ADMIN" || user.role === "HOSPITAL_ADMIN") {
    return MODULES;
  }
  return MODULES.filter(m => m.allowedRoles.includes(user.role));
}

function isModuleAllowed(moduleId, user) {
  if (!user) return false;
  if (user.role === "ADMIN" || user.role === "HOSPITAL_ADMIN") return true;
  const mod = MODULES.find(m => m.id === moduleId || m.route === moduleId);
  if (!mod) return false;
  return mod.allowedRoles.includes(user.role);
}

function getDefaultModuleForRole(role) {
  switch (role) {
    case "DOCTOR": return "doctor";
    case "RECEPTIONIST": return "reception";
    case "NURSE": return "nurse";
    case "PHARMACIST": return "pharmacy";
    case "LAB_STAFF": return "laboratory";
    case "SCAN_TECH": return "radiology";
    case "PATIENT": return "patient";
    case "ADMIN":
    case "HOSPITAL_ADMIN":
    default:
      return "admin";
  }
}

function renderModuleBar() {
  if (!me) return "";
  const allowed = getAllowedModulesForUser(me);
  const currentHash = (window.location.hash.replace("#", "") || "").split("/")[0];
  const activeModuleId = currentHash || getDefaultModuleForRole(me.role);

  return `
    <div class="module-bar">
      <div class="module-bar-title">
        <span>⚡ MODULE SWITCHER:</span>
      </div>
      <div class="module-nav-list">
        ${allowed.map(m => `
          <button class="module-nav-btn ${activeModuleId === m.id ? 'active' : ''}" onclick="switchModule('${m.id}')" title="Switch to ${esc(m.name)} Module">
            <span>${m.icon}</span>
            <span>${esc(m.name)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function switchModule(moduleId) {
  if (!me) return;
  if (!isModuleAllowed(moduleId, me)) {
    alert(`Access Restricted: Your account role (${me.role}) does not have permission to access the ${moduleId.toUpperCase()} module.`);
    return;
  }
  window.location.hash = `#${moduleId}`;
  route();
}

function layout(content) {
  root.innerHTML = `<div class="shell">${renderNavbar()}${me ? renderModuleBar() : ''}${content}</div>`;
}

function showError(err) {
  const el = document.querySelector("[data-error]");
  if (el) el.innerHTML = `<div class="error" style="color:red;padding:10px;background:#fee2e2;border-radius:8px;margin:10px 0;font-weight:600">⚠️ ${esc(err.message || err)}</div>`;
  else alert(err.message || err);
}

/* ------------------------------------------------------------------ */
/* Global Search Handler                                              */
/* ------------------------------------------------------------------ */

async function handleGlobalSearch(e) {
  const q = e.target.value.trim();
  const dropdown = document.getElementById("searchDropdown");
  if (!q) {
    dropdown.classList.remove("active");
    return;
  }

  try {
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (res.results.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--muted)">No records matching "${esc(q)}" in database</div>`;
    } else {
      dropdown.innerHTML = res.results.map(r => `
        <div class="search-item" onclick="openSearchResult('${r.type}', '${r.id}')">
          <strong style="font-size:13px;color:var(--blue-dark)">${esc(r.title)}</strong>
          <small style="display:block;color:var(--muted);font-size:11px">${esc(r.subtitle)}</small>
        </div>
      `).join("");
    }
    dropdown.classList.add("active");
  } catch (err) {
    console.error(err);
  }
}

function openSearchResult(type, id) {
  document.getElementById("searchDropdown").classList.remove("active");
  if (type === "PATIENT") {
    switchModule("patient");
    renderPatient360View(id);
  } else if (type === "DOCTOR") {
    switchModule("admin");
  } else if (type === "PRESCRIPTION") {
    switchModule("pharmacy");
  } else if (type === "LAB_ORDER") {
    switchModule("laboratory");
  } else if (type === "SCAN_ORDER") {
    switchModule("radiology");
  } else if (type === "BED") {
    switchModule("beds");
  } else {
    alert(`Fetched record ${id} (${type}) from MEDI CORE database.`);
  }
}

/* ------------------------------------------------------------------ */
/* Role Switcher & System Helpers                                     */
/* ------------------------------------------------------------------ */

async function quickSwitchRole(targetRole) {
  if (!targetRole) return;
  if (me && me.role === targetRole) {
    route();
    return;
  }

  try {
    let userToLogin = null;
    if (targetRole === "PATIENT" && dynamicPatientsList.length > 0) userToLogin = dynamicPatientsList[0];
    else if (targetRole === "DOCTOR" && dynamicDoctorsList.length > 0) userToLogin = dynamicDoctorsList[0];

    const email = userToLogin ? userToLogin.email : (me ? me.email : "admin@medicore.demo");
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "Demo@123", role: targetRole })
    });
    localStorage.setItem("token", res.token);
    me = res.user;
    window.location.hash = `#${getDefaultModuleForRole(targetRole)}`;
    route();
  } catch (err) {
    if (me && me.role === "ADMIN") {
      me.role = targetRole;
      window.location.hash = `#${getDefaultModuleForRole(targetRole)}`;
      route();
    } else {
      showError(err);
    }
  }
}

async function loadDemoDataset() {
  try {
    const res = await api("/api/demo/load", { method: "POST" });
    alert(res.message);
    boot();
  } catch (err) { showError(err); }
}

async function resetSystemToClean() {
  if (!confirm("Are you sure you want to reset MEDI CORE database to 0 users? This will launch the Initial Setup Wizard.")) return;
  try {
    const res = await api("/api/demo/reset", { method: "POST" });
    alert(res.message);
    localStorage.removeItem("token");
    me = null;
    boot();
  } catch (err) { showError(err); }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  localStorage.removeItem("token");
  me = null;
  boot();
}

async function boot() {
  try {
    const sRes = await api("/api/setup/status");
    systemSetupStatus = sRes;

    if (!systemSetupStatus.isInitialized || systemSetupStatus.adminCount === 0) {
      me = null;
      renderInitialSetupWizard();
      return;
    }

    const res = await api("/api/me");
    me = res.user;
    await loadGlobalLists();
    startLiveSync();
    await route();
  } catch {
    if (!systemSetupStatus.isInitialized || systemSetupStatus.adminCount === 0) {
      renderInitialSetupWizard();
    } else {
      renderLanding();
    }
  }
}

async function loadGlobalLists() {
  try {
    const [pRes, dRes] = await Promise.all([api("/api/patients"), api("/api/doctors")]);
    dynamicPatientsList = pRes.patients || [];
    dynamicDoctorsList = dRes.doctors || [];
  } catch {}
}

function startLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer = setInterval(async () => {
    if (!me) return;
    try {
      const updates = await api("/api/events/updates");
      const badge = document.getElementById("notifBadge");
      if (badge && updates.notifications && updates.notifications.length > 0) {
        badge.textContent = updates.notifications.length;
        badge.style.display = "inline-flex";
      }
    } catch {}
  }, 6000);
}

async function route() {
  if (!me) {
    if (!systemSetupStatus.isInitialized || systemSetupStatus.adminCount === 0) {
      return renderInitialSetupWizard();
    }
    return renderLanding();
  }

  if (elderlyMode && me.role === "PATIENT") {
    return renderElderlyEasyModeView();
  }

  const hashRaw = window.location.hash.replace("#", "").trim();
  let requestedModule = hashRaw.split("/")[0];

  if (!requestedModule || !MODULES.some(m => m.id === requestedModule)) {
    requestedModule = getDefaultModuleForRole(me.role);
    window.location.hash = `#${requestedModule}`;
  }

  if (!isModuleAllowed(requestedModule, me)) {
    const defaultMod = getDefaultModuleForRole(me.role);
    window.location.hash = `#${defaultMod}`;
    renderAccessRestrictedNotice(requestedModule, defaultMod);
    return;
  }

  const targetMod = MODULES.find(m => m.id === requestedModule);
  if (targetMod && typeof targetMod.render === "function") {
    await targetMod.render();
  } else {
    renderCommandCenter();
  }
}

window.onhashchange = () => {
  if (me) route();
};


/* ------------------------------------------------------------------ */
/* INITIAL SETUP / BOOTSTRAP WIZARD (Fixes Authentication Dead-End)   */
/* ------------------------------------------------------------------ */

function renderInitialSetupWizard() {
  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);color:white;padding:20px">
      <div class="card" style="width:min(580px, 95%);padding:36px;background:#ffffff;color:#0f172a;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5)">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:54px;height:54px;background:linear-gradient(135deg, #0284c7, #0d9488);color:white;border-radius:14px;display:grid;place-items:center;font-size:28px;font-weight:bold;margin:0 auto 12px">✚</div>
          <h1 style="color:var(--blue-dark);margin:0;font-size:28px">Welcome to MEDI CORE</h1>
          <p style="font-size:14px;color:var(--muted);margin-top:6px">Initial System Installation & Hospital Setup Wizard</p>
        </div>

        <div style="background:#f0f9ff;padding:12px 16px;border-radius:10px;font-size:13px;color:#0369a1;border:1px solid #bae6fd;margin-bottom:20px">
          <strong>⚡ Fresh Installation Detected:</strong> No hospital administrators configured yet. Create your first Administrator account below to start building your hospital platform.
        </div>

        <div data-error></div>

        <form id="setupBootstrapForm" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
            <label>Hospital Name *
              <input id="bsHospitalName" required value="MEDI CORE Multi-Specialty Hospital" />
            </label>
            <label>City
              <input id="bsCity" value="Hyderabad" />
            </label>
          </div>

          <div style="border-top:1px solid var(--border);padding-top:14px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">First Administrator Account Details</h4>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <label>Administrator Full Name *
                <input id="bsAdminName" required placeholder="e.g. Dr. System Administrator" />
              </label>
              <label>Phone Number
                <input id="bsAdminPhone" value="+91 9876543210" />
              </label>
            </div>

            <label style="margin-bottom:12px">Administrator Email (For Sign In) *
              <input id="bsAdminEmail" type="email" required placeholder="admin@medicore.demo" />
            </label>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <label>Password *
                <input id="bsAdminPass" type="password" required value="Demo@123" />
              </label>
              <label>Confirm Password *
                <input id="bsAdminPassConfirm" type="password" required value="Demo@123" />
              </label>
            </div>
          </div>

          <button class="btn btn-primary" style="padding:14px;font-size:16px;margin-top:12px;width:100%">
            🚀 Initialize MEDI CORE & Launch Command Center
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById("setupBootstrapForm").onsubmit = async e => {
    e.preventDefault();
    const p1 = document.getElementById("bsAdminPass").value;
    const p2 = document.getElementById("bsAdminPassConfirm").value;

    if (p1 !== p2) {
      showError("Passwords do not match.");
      return;
    }

    try {
      const res = await api("/api/setup/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          hospitalName: document.getElementById("bsHospitalName").value,
          city: document.getElementById("bsCity").value,
          adminName: document.getElementById("bsAdminName").value,
          adminEmail: document.getElementById("bsAdminEmail").value,
          adminPhone: document.getElementById("bsAdminPhone").value,
          adminPassword: p1
        })
      });

      localStorage.setItem("token", res.token);
      me = res.user;
      alert(res.message);
      boot();
    } catch (err) { showError(err); }
  };
}

/* ------------------------------------------------------------------ */
/* Landing Page & Auth Screens                                         */
/* ------------------------------------------------------------------ */

function renderLanding() {
  layout(`
    <main class="page" style="max-width:1100px;margin:30px auto">
      <section class="card" style="text-align:center;padding:48px 28px;background:linear-gradient(135deg, #f0f9ff 0%, #ffffff 100%);border:1px solid #bae6fd">
        <span class="pill pill-blue" style="font-size:12px;margin-bottom:14px;padding:4px 12px">ONE PATIENT • ONE CONNECTED JOURNEY • COMPLETE PATINOTE</span>
        <h1 style="font-size:42px;color:var(--blue-dark);margin:14px 0;letter-spacing:-1px">MEDI CORE Hospital Platform & PATINOTE</h1>
        <p style="font-size:16px;color:var(--muted);max-width:780px;margin:0 auto 32px;line-height:1.6">
          A production-grade, database-driven hospital operating system featuring complete PATINOTE clinical case-taking (Sections A-N), dynamic doctor management, patient registration, closed-loop pharmacy, pathology, radiology, and transactional bed management.
        </p>

        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:14px 28px;font-size:16px" onclick="openRegisterPatientModal()">+ Register New Patient</button>
          <button class="btn btn-secondary" style="padding:14px 28px;font-size:16px" onclick="renderLogin('DOCTOR')">Doctor PATINOTE Workspace</button>
          <button class="btn btn-outline" style="padding:14px 28px;font-size:16px" onclick="renderLogin('ADMIN')">Hospital Command Center</button>
        </div>
      </section>
    </main>
  `);
}

const DEFAULT_DEMO_EMAILS = {
  ADMIN: "admin@medicore.demo",
  DOCTOR: "doctor@medicore.demo",
  RECEPTIONIST: "reception@medicore.demo",
  NURSE: "nurse@medicore.demo",
  PHARMACIST: "pharmacy@medicore.demo",
  LAB_STAFF: "lab@medicore.demo",
  SCAN_TECH: "scan@medicore.demo",
  PATIENT: "patient@medicore.demo"
};

async function quickLoginRole(role) {
  const email = DEFAULT_DEMO_EMAILS[role] || `${role.toLowerCase()}@medicore.demo`;
  try {
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "Demo@123", role })
    });
    localStorage.setItem("token", res.token);
    me = res.user;
    window.location.hash = `#${getDefaultModuleForRole(role)}`;
    boot();
  } catch (err) {
    showError(err);
  }
}

function renderLogin(roleValue = "ADMIN") {
  let currentRole = roleValue;
  const defaultEmail = DEFAULT_DEMO_EMAILS[currentRole] || "admin@medicore.demo";

  layout(`
    <main class="page" style="max-width:520px;margin:30px auto">
      <section class="card" style="padding:32px">
        <div style="text-align:center;margin-bottom:20px">
          <div class="brand-mark" style="width:48px;height:48px;font-size:24px;margin:0 auto 10px;background:linear-gradient(135deg, #0284c7, #0d9488);color:white;border-radius:12px;display:grid;place-items:center;font-weight:bold">✚</div>
          <h2 style="color:var(--blue-dark);margin:0;font-size:24px">Sign In to MEDI CORE</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:4px">Connected Hospital Operating & Patient Care Platform</p>
        </div>

        <!-- ⚡ 1-Click Quick Demo Sign In Panel -->
        <div style="background:#f0f9ff;border:1px solid #bae6fd;padding:14px;border-radius:12px;margin-bottom:20px">
          <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
            <span>⚡ 1-Click Default Demo Sign In</span>
            <span style="font-size:10px;color:#0284c7">Click any role for instant login</span>
          </div>
          <div class="quick-login-grid">
            <div class="quick-login-card" onclick="quickLoginRole('ADMIN')">
              <div style="font-size:20px">🏥</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Admin</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('DOCTOR')">
              <div style="font-size:20px">👨‍⚕️</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Doctor</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('RECEPTIONIST')">
              <div style="font-size:20px">🧑‍💼</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Reception</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('NURSE')">
              <div style="font-size:20px">👩‍⚕️</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Nurse</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('PHARMACIST')">
              <div style="font-size:20px">💊</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Pharmacy</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('LAB_STAFF')">
              <div style="font-size:20px">🧪</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Lab Tech</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('SCAN_TECH')">
              <div style="font-size:20px">🩻</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Radiology</strong>
            </div>
            <div class="quick-login-card" onclick="quickLoginRole('PATIENT')">
              <div style="font-size:20px">👤</div>
              <strong style="font-size:11px;color:var(--blue-dark);display:block">Patient</strong>
            </div>
          </div>
        </div>

        <div style="text-align:center;margin:16px 0 12px;position:relative">
          <hr style="border:0;border-top:1px solid var(--border);margin:0" />
          <span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#fff;padding:0 10px;font-size:11px;color:var(--muted);font-weight:600">OR SIGN IN MANUALLY</span>
        </div>

        <div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap;justify-content:center">
          ${["ADMIN", "RECEPTIONIST", "DOCTOR", "PHARMACIST", "LAB_STAFF", "SCAN_TECH", "PATIENT"].map(r => `
            <button class="btn ${currentRole===r?'btn-primary':'btn-outline'}" style="font-size:11px;padding:4px 8px" onclick="renderLogin('${r}')">${r}</button>
          `).join("")}
        </div>

        <div data-error></div>
        <form id="loginForm" style="display:flex;flex-direction:column;gap:14px">
          <label>Email Address
            <input id="email" type="email" required value="${esc(defaultEmail)}" placeholder="name@medicore.demo" />
          </label>
          <label>Password
            <input id="password" type="password" required value="Demo@123" />
          </label>
          <input type="hidden" id="role" value="${currentRole}" />
          <button class="btn btn-primary" style="width:100%;margin-top:8px;padding:12px;font-weight:700">Sign In as ${currentRole}</button>
        </form>
      </section>
    </main>
  `);

  document.getElementById("loginForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("email").value,
          password: document.getElementById("password").value,
          role: document.getElementById("role").value
        })
      });
      localStorage.setItem("token", res.token);
      me = res.user;
      boot();
    } catch (err) { showError(err); }
  };
}

/* ------------------------------------------------------------------ */
/* DYNAMIC PATIENT REGISTRATION MODAL                                 */
/* ------------------------------------------------------------------ */

function openRegisterPatientModal() {
  const modalHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.7);display:grid;place-items:center;z-index:300;padding:20px;overflow-y:auto">
      <div class="card" style="width:min(780px, 95%);padding:28px;max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <h2 style="color:var(--blue-dark);margin:0">📋 Dynamic Patient Account Registration</h2>
            <small style="color:var(--muted)">Creates a permanent database record & unique Medical Record Number (MRN)</small>
          </div>
          <button class="btn btn-outline" onclick="closeModal('registerPatientModal')">✕ Close</button>
        </div>

        <div data-error></div>

        <form id="patientRegistrationForm" style="display:flex;flex-direction:column;gap:14px">
          <h4 style="margin:0 0 4px;color:var(--blue-dark);border-bottom:1px solid var(--border);padding-bottom:4px">1. Basic Demographics</h4>
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
            <label>Full Patient Name *
              <input id="pName" required placeholder="e.g. Ramesh Verma" />
            </label>
            <label>Patient Email
              <input id="pEmail" type="email" placeholder="ramesh@medicore.demo" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <label>Date of Birth
              <input id="pDob" type="date" value="1988-05-14" onchange="calculateAgeFromDob(this.value)" />
            </label>
            <label>Age (Years)
              <input id="pAge" type="number" value="38" />
            </label>
            <label>Gender
              <select id="pGender">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <label>Phone Number *
              <input id="pPhone" required value="+91 9876543210" />
            </label>
            <label>Blood Group
              <select id="pBlood">
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </label>
            <label>Government ID / Aadhaar #
              <input id="pIdNo" placeholder="1234 5678 9012" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <label>Emergency Contact Name
              <input id="pEmgName" placeholder="Sunita Verma" />
            </label>
            <label>Emergency Contact Phone
              <input id="pEmgPhone" placeholder="+91 9876543211" />
            </label>
            <label>Relationship
              <input id="pEmgRel" placeholder="Spouse / Parent" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px">
            <label>Address
              <input id="pAddress" placeholder="Flat 301, Jubilee Hills" />
            </label>
            <label>City
              <input id="pCity" value="Hyderabad" />
            </label>
            <label>State
              <input id="pState" value="Telangana" />
            </label>
          </div>

          <h4 style="margin:10px 0 4px;color:var(--blue-dark);border-bottom:1px solid var(--border);padding-bottom:4px">2. Baseline Clinical & Allergy Alerts</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Known Allergies (Drug / Food)
              <input id="pAllergies" placeholder="e.g. Penicillin, NSAIDs" />
            </label>
            <label>Existing Medical Conditions
              <input id="pConditions" placeholder="e.g. Type-2 Diabetes, HTN" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Previous Surgeries
              <input id="pSurgeries" placeholder="e.g. Appendectomy 2019" />
            </label>
            <label>Current Regular Medications
              <input id="pMeds" placeholder="e.g. Metformin 500mg" />
            </label>
          </div>

          <h4 style="margin:10px 0 4px;color:var(--blue-dark);border-bottom:1px solid var(--border);padding-bottom:4px">3. Insurance & Portal Account Option</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Insurance Provider
              <input id="pInsProvider" placeholder="Star Health" />
            </label>
            <label>Policy Number
              <input id="pInsPolicy" placeholder="POL-882910" />
            </label>
          </div>

          <div style="background:#f0f9ff;padding:12px;border-radius:8px;border:1px solid #bae6fd">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="pCreateAccount" checked />
              <strong>Enable Patient Portal Sign-In Account (Default Password: Demo@123)</strong>
            </label>
          </div>

          <button class="btn btn-primary" style="padding:14px;font-size:16px;margin-top:10px">
            ✓ Save Patient to Database & Generate MRN
          </button>
        </form>
      </div>
    </div>
  `;

  const modalDiv = document.createElement("div");
  modalDiv.id = "registerPatientModal";
  modalDiv.innerHTML = modalHtml;
  document.body.appendChild(modalDiv);

  document.getElementById("patientRegistrationForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const res = await api("/api/patients", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("pName").value,
          email: document.getElementById("pEmail").value,
          dob: document.getElementById("pDob").value,
          age: document.getElementById("pAge").value,
          gender: document.getElementById("pGender").value,
          phone: document.getElementById("pPhone").value,
          bloodGroup: document.getElementById("pBlood").value,
          emergencyContactName: document.getElementById("pEmgName").value,
          emergencyContactPhone: document.getElementById("pEmgPhone").value,
          emergencyContactRelationship: document.getElementById("pEmgRel").value,
          address: document.getElementById("pAddress").value,
          city: document.getElementById("pCity").value,
          state: document.getElementById("pState").value,
          allergies: document.getElementById("pAllergies").value,
          existingConditions: document.getElementById("pConditions").value,
          previousSurgeries: document.getElementById("pSurgeries").value,
          currentMedications: document.getElementById("pMeds").value,
          insuranceProvider: document.getElementById("pInsProvider").value,
          insurancePolicyNumber: document.getElementById("pInsPolicy").value,
          identityNumber: document.getElementById("pIdNo").value,
          createPortalAccount: document.getElementById("pCreateAccount").checked
        })
      });

      alert(`✓ PATIENT RECORD SAVED TO DATABASE!\n\nPatient Name: ${res.patient.name}\nPatient ID: ${res.patient.id}\nMRN Number: ${res.patient.mrn}\nLogin Email: ${res.patient.email}`);
      closeModal("registerPatientModal");
      await loadGlobalLists();
      route();
    } catch (err) { showError(err); }
  };
}

function calculateAgeFromDob(dobVal) {
  if (!dobVal) return;
  const birthYear = new Date(dobVal).getFullYear();
  if (!isNaN(birthYear)) {
    document.getElementById("pAge").value = new Date().getFullYear() - birthYear;
  }
}

function closeModal(idStr) {
  const el = document.getElementById(idStr);
  if (el) el.remove();
}

/* ------------------------------------------------------------------ */
/* DYNAMIC DOCTOR CREATION & MANAGEMENT MODAL                         */
/* ------------------------------------------------------------------ */

function openAddDoctorModal() {
  const modalHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.7);display:grid;place-items:center;z-index:300;padding:20px;overflow-y:auto">
      <div class="card" style="width:min(680px, 95%);padding:28px;max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <h2 style="color:var(--blue-dark);margin:0">🩺 Add New Doctor Account</h2>
            <small style="color:var(--muted)">Configures medical staff with OPD schedule and login credentials</small>
          </div>
          <button class="btn btn-outline" onclick="closeModal('addDoctorModal')">✕ Close</button>
        </div>

        <div data-error></div>

        <form id="addDoctorForm" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
            <label>Full Doctor Name *
              <input id="dName" required placeholder="Dr. Ananya Sharma" />
            </label>
            <label>Gender
              <select id="dGender">
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </label>
          </div>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Email Address (For Sign In) *
              <input id="dEmail" type="email" required placeholder="doctor@medicore.demo" />
            </label>
            <label>Password *
              <input id="dPass" type="password" required value="Demo@123" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <label>Department *
              <select id="dDept">
                <option value="General Medicine">General Medicine</option>
                <option value="Cardiology">Cardiology</option>
                <option value="Orthopedics">Orthopedics</option>
                <option value="Pediatrics">Pediatrics</option>
                <option value="Emergency">Emergency</option>
                <option value="Radiology">Radiology</option>
                <option value="Pathology">Pathology</option>
                <option value="Neurology">Neurology</option>
                <option value="Surgery">Surgery</option>
                <option value="ENT">ENT</option>
              </select>
            </label>
            <label>Qualification
              <input id="dQual" value="MBBS, MD" />
            </label>
            <label>Experience
              <input id="dExp" value="8 Years" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label>Medical License Registration #
              <input id="dLicense" placeholder="MCI-2026-98120" />
            </label>
            <label>Phone Number
              <input id="dPhone" value="+91 9876543210" />
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <label>OPD Consultation Fee (₹)
              <input id="dFee" type="number" value="500" />
            </label>
            <label>OPD Cabin / Room #
              <input id="dRoom" value="Cabin 102" />
            </label>
            <label>Appt Duration (Mins)
              <input id="dDuration" type="number" value="15" />
            </label>
          </div>

          <label>Available Days & Schedule
            <input id="dSchedule" value="Mon-Fri (09:00 AM - 04:00 PM)" />
          </label>

          <button class="btn btn-primary" style="padding:14px;font-size:15px;margin-top:8px">
            ✓ Create Doctor Account & Enable Clinic
          </button>
        </form>
      </div>
    </div>
  `;

  const modalDiv = document.createElement("div");
  modalDiv.id = "addDoctorModal";
  modalDiv.innerHTML = modalHtml;
  document.body.appendChild(modalDiv);

  document.getElementById("addDoctorForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const res = await api("/api/doctors", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("dName").value,
          email: document.getElementById("dEmail").value,
          password: document.getElementById("dPass").value,
          gender: document.getElementById("dGender").value,
          department: document.getElementById("dDept").value,
          qualification: document.getElementById("dQual").value,
          experience: document.getElementById("dExp").value,
          licenseNumber: document.getElementById("dLicense").value,
          phone: document.getElementById("dPhone").value,
          opdFee: document.getElementById("dFee").value,
          roomNumber: document.getElementById("dRoom").value,
          appointmentDuration: document.getElementById("dDuration").value,
          schedule: document.getElementById("dSchedule").value
        })
      });

      alert(`✓ DOCTOR ACCOUNT CREATED!\nDoctor: ${res.doctor.name}\nDepartment: ${res.doctor.department}\nSign-in Email: ${res.doctor.email}`);
      closeModal("addDoctorModal");
      await loadGlobalLists();
      route();
    } catch (err) { showError(err); }
  };
}

/* ------------------------------------------------------------------ */
/* COMMAND CENTER & ADMINISTRATION                                    */
/* ------------------------------------------------------------------ */

async function renderCommandCenter() {
  let stats = null, beds = [], auditLogs = [], doctors = [];
  try {
    const [sRes, bRes, aRes, dRes] = await Promise.all([
      api("/api/command-center"),
      api("/api/beds"),
      api("/api/admin/audit-logs"),
      api("/api/doctors")
    ]);
    stats = sRes;
    beds = bRes.beds || [];
    auditLogs = aRes.auditLogs || [];
    doctors = dRes.doctors || [];
  } catch (err) { console.error(err); }

  const m = stats?.metrics || {};

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">🏛 HOSPITAL COMMAND CENTER</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Database Operational Analytics, Bed Management & Medical Staff Control</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="openRegisterPatientModal()">+ Register Patient</button>
          <button class="btn btn-primary" onclick="openAddDoctorModal()">+ Add Doctor</button>
          <button class="btn btn-outline" onclick="loadDemoDataset()">⚡ Load Demo</button>
        </div>
      </div>

      <!-- Live Calculated Metric Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:24px">
        <div class="card" style="border-left:5px solid var(--blue);background:#f0f9ff">
          <small style="color:var(--blue-dark);font-weight:800">👥 REGISTERED PATIENTS</small>
          <h2 style="font-size:26px;color:var(--blue-dark);margin:4px 0">${m.totalPatients || 0} Records</h2>
          <small style="color:var(--muted)">Database Active Patients</small>
        </div>

        <div class="card" style="border-left:5px solid var(--indigo);background:#e0e7ff">
          <small style="color:#3730a3;font-weight:800">🩺 ACTIVE DOCTORS</small>
          <h2 style="font-size:26px;color:#312e81;margin:4px 0">${m.totalDoctors || 0} Doctors</h2>
          <small style="color:var(--muted)">Configured Clinical Staff</small>
        </div>

        <div class="card" style="border-left:5px solid var(--teal);background:#f0fdf4">
          <small style="color:#0f766e;font-weight:800">🛏 BEDS AVAILABLE</small>
          <h2 style="font-size:26px;color:#115e59;margin:4px 0">${m.availableBeds || 0} / ${stats?.beds?.total || 0} Free</h2>
          <small style="color:var(--muted)">ICU: ${stats?.beds?.icuAvailable} | Gen: ${stats?.beds?.genAvailable}</small>
        </div>

        <div class="card" style="border-left:5px solid var(--amber);background:#fffbeb">
          <small style="color:#b45309;font-weight:800">💊 PHARMACY QUEUE</small>
          <h2 style="font-size:26px;color:#92400e;margin:4px 0">${m.pendingPrescriptions || 0} Orders</h2>
          <small style="color:var(--muted)">${m.lowStockMedicines || 0} Low-Stock Alert(s)</small>
        </div>

        <div class="card" style="border-left:5px solid var(--emerald);background:#f0fdf4">
          <small style="color:#15803d;font-weight:800">💰 TODAY'S REVENUE</small>
          <h2 style="font-size:26px;color:#166534;margin:4px 0">₹${m.todayRevenue || 0}</h2>
          <small style="color:var(--muted)">Calculated from Paid Invoices</small>
        </div>
      </div>

      <!-- Medical Staff Directory -->
      <div class="card" style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3>Medical Staff Directory (${doctors.length})</h3>
          <button class="btn btn-outline" style="font-size:11px" onclick="openAddDoctorModal()">+ Add Doctor Account</button>
        </div>
        ${doctors.length === 0 ? `
          <div style="text-align:center;padding:28px;background:#f8fafc;border-radius:8px;border:1px dashed var(--border)">
            <strong style="color:var(--muted)">No doctor accounts created yet.</strong>
            <p style="font-size:13px;color:var(--muted);margin:4px 0 14px">Create doctor accounts to open OPD clinics and enable case taking.</p>
            <button class="btn btn-primary" onclick="openAddDoctorModal()">+ Create First Doctor Account</button>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>Doctor Name</th>
                <th>Department</th>
                <th>License #</th>
                <th>OPD Fee</th>
                <th>Room</th>
                <th>Schedule</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${doctors.map(d => `
                <tr>
                  <td><strong style="color:var(--blue-dark)">${esc(d.name)}</strong></td>
                  <td><span class="pill pill-blue">${esc(d.department)}</span></td>
                  <td>${esc(d.licenseNumber)}</td>
                  <td>₹${d.opdFee || 500}</td>
                  <td>${esc(d.roomNumber || 'OPD')}</td>
                  <td>${esc(d.schedule || 'Mon-Fri')}</td>
                  <td><span class="pill pill-green">${esc(d.status || 'ACTIVE')}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <!-- Visual Bed Map Grid -->
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3>Visual Hospital Bed Map</h3>
            <div style="display:flex;gap:6px;font-size:11px">
              <span class="pill pill-green">AVAILABLE</span>
              <span class="pill pill-blue">OCCUPIED</span>
              <span class="pill pill-yellow">CLEANING</span>
            </div>
          </div>
          <div class="bed-grid">
            ${beds.map(b => `
              <div class="bed-card ${b.status}" onclick="allocateBedModal('${b.bedId}')">
                <strong style="font-size:14px">${esc(b.bedId)}</strong>
                <small style="display:block;font-size:10px;color:var(--muted)">${esc(b.ward)}</small>
                <span class="pill" style="font-size:9px;margin-top:4px">${esc(b.status)}</span>
                ${b.currentPatientName ? `<small style="display:block;font-size:10px;margin-top:2px;font-weight:600">${esc(b.currentPatientName)}</small>` : ''}
              </div>
            `).join("")}
          </div>
        </div>

        <!-- Live Audit Trail Stream -->
        <div class="card">
          <h3>Immutable Audit Trail (${auditLogs.length})</h3>
          <div style="max-height:400px;overflow-y:auto;margin-top:10px">
            ${auditLogs.length === 0 ? `<p style="font-size:12px;color:var(--muted)">No audit logs recorded yet.</p>` : auditLogs.map(l => `
              <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
                <div style="display:flex;justify-content:space-between">
                  <strong>${esc(l.action)}</strong>
                  <small style="color:var(--muted)">${new Date(l.timestamp).toLocaleTimeString()}</small>
                </div>
                <small style="color:var(--muted)">Actor: ${esc(l.actorName)} (${esc(l.actorRole)}) ${l.patientId ? `| Patient: ${esc(l.patientId)}` : ''}</small>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </main>
  `);
}

/* ------------------------------------------------------------------ */
/* RECEPTION PORTAL ("Front Desk")                                    */
/* ------------------------------------------------------------------ */

async function renderReceptionPortal() {
  let queue = [], patients = [], doctors = [];
  try {
    const [qRes, pRes, dRes] = await Promise.all([api("/api/queue"), api("/api/patients"), api("/api/doctors")]);
    queue = qRes.queue || [];
    patients = pRes.patients || [];
    doctors = dRes.doctors || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">FRONT DESK RECEPTION PORTAL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Patient Registration, Search, OPD Check-In & Queue Management</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="openRegisterPatientModal()">+ Register New Patient</button>
          <button class="btn btn-secondary" onclick="openCheckInModal()">Check-In Patient to Queue</button>
        </div>
      </div>

      <!-- Registered Patients Directory -->
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3>Registered Patients (${patients.length})</h3>
          <button class="btn btn-outline" style="font-size:11px" onclick="openRegisterPatientModal()">+ Register Patient</button>
        </div>

        ${patients.length === 0 ? `
          <div style="text-align:center;padding:32px;background:#f8fafc;border-radius:8px;border:1px dashed var(--border)">
            <strong style="color:var(--muted);font-size:16px">No patients registered in database.</strong>
            <p style="font-size:13px;color:var(--muted);margin:6px 0 16px">Register a patient to generate an MRN and issue OPD tokens.</p>
            <button class="btn btn-primary" onclick="openRegisterPatientModal()">+ Register First Patient</button>
          </div>
        ` : `
          <table>
            <thead>
              <tr>
                <th>MRN Number</th>
                <th>Patient Name</th>
                <th>Age / Gender</th>
                <th>Blood Group</th>
                <th>Phone</th>
                <th>Emergency Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${patients.map(p => `
                <tr>
                  <td><strong style="color:var(--blue-dark)">${esc(p.mrn)}</strong></td>
                  <td><strong>${esc(p.name)}</strong></td>
                  <td>${esc(p.age)} yrs / ${esc(p.gender)}</td>
                  <td><span class="pill pill-red">${esc(p.bloodGroup)}</span></td>
                  <td>${esc(p.phone)}</td>
                  <td>${esc(p.emergencyContact)}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="quickCheckInPatient('${p.id}')">Check-In</button>
                      <button class="btn btn-outline" style="font-size:10px;padding:3px 8px" onclick="renderPatient360View('${p.id}')">Patient 360°</button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>

      <!-- OPD Queue Table -->
      <div class="card">
        <h3>Today's OPD Queue Tokens (${queue.length})</h3>
        ${queue.length === 0 ? `
          <p style="color:var(--muted);font-size:13px;margin-top:10px">OPD Queue is currently empty.</p>
        ` : `
          <div style="margin-top:12px">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Patient Name</th>
                  <th>Patient ID</th>
                  <th>Assigned Doctor</th>
                  <th>Check-In Time</th>
                  <th>Wait Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${queue.map(q => `
                  <tr>
                    <td><strong style="font-size:16px;color:var(--blue-dark)">${esc(q.token)}</strong></td>
                    <td><strong>${esc(q.patientName)}</strong></td>
                    <td>${esc(q.patientId)}</td>
                    <td>${esc(q.doctorName)}</td>
                    <td>${esc(q.checkInTime)}</td>
                    <td>${q.waitTimeMinutes} mins</td>
                    <td><span class="pill ${q.status==='COMPLETED'?'pill-green':q.status==='IN_CONSULTATION'?'pill-blue':'pill-yellow'}">${esc(q.status)}</span></td>
                    <td>
                      <button class="btn btn-outline" style="font-size:11px;padding:2px 8px" onclick="renderPatient360View('${q.patientId}')">Patient 360°</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </main>
  `);
}

async function quickCheckInPatient(patientId) {
  try {
    const docId = dynamicDoctorsList.length > 0 ? dynamicDoctorsList[0].id : "DOC-101";
    const res = await api("/api/queue/check-in", {
      method: "POST",
      body: JSON.stringify({ patientId, doctorId: docId })
    });
    alert(`✓ Patient Checked-In!\nToken Issued: ${res.queueEntry.token}\nDoctor: ${res.queueEntry.doctorName}`);
    renderReceptionPortal();
  } catch (err) { showError(err); }
}

function openCheckInModal() {
  if (dynamicPatientsList.length === 0) {
    alert("No registered patients found. Please register a patient first.");
    openRegisterPatientModal();
    return;
  }

  const patientSelect = dynamicPatientsList.map(p => `<option value="${p.id}">${p.name} (${p.mrn})</option>`).join("");
  const doctorSelect = dynamicDoctorsList.map(d => `<option value="${d.id}">${d.name} (${d.department})</option>`).join("");

  const modalHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.7);display:grid;place-items:center;z-index:300;padding:20px">
      <div class="card" style="width:min(480px, 95%);padding:24px">
        <h3 style="color:var(--blue-dark);margin-top:0">📋 OPD Patient Check-In</h3>
        <form id="checkInForm" style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
          <label>Select Registered Patient
            <select id="ciPatientId">${patientSelect}</select>
          </label>
          <label>Select Consulting Doctor
            <select id="ciDoctorId">${doctorSelect || '<option value="DOC-101">Dr. On Duty</option>'}</select>
          </label>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-outline" type="button" style="flex:1" onclick="closeModal('checkInModal')">Cancel</button>
            <button class="btn btn-primary" style="flex:1">Issue Token & Check-In</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modalDiv = document.createElement("div");
  modalDiv.id = "checkInModal";
  modalDiv.innerHTML = modalHtml;
  document.body.appendChild(modalDiv);

  document.getElementById("checkInForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const res = await api("/api/queue/check-in", {
        method: "POST",
        body: JSON.stringify({
          patientId: document.getElementById("ciPatientId").value,
          doctorId: document.getElementById("ciDoctorId").value
        })
      });
      alert(`✓ Check-In Confirmed!\nToken: ${res.queueEntry.token}\nDoctor: ${res.queueEntry.doctorName}`);
      closeModal("checkInModal");
      renderReceptionPortal();
    } catch (err) { showError(err); }
  };
}

/* ------------------------------------------------------------------ */
/* DOCTOR CLINICAL WORKSPACE & FULL PATINOTE CASE SHEET               */
/* ------------------------------------------------------------------ */

async function renderDoctorPortal() {
  let queue = [], inventory = [];
  try {
    const [qRes, iRes] = await Promise.all([api("/api/queue"), api("/api/inventory")]);
    queue = qRes.queue || [];
    inventory = iRes.inventory || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">DOCTOR PATINOTE WORKSPACE</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">${me ? me.name : 'Dr. Practitioner'} | ${me?.department || 'General Medicine'}</p>
        </div>
        <button class="btn btn-danger" onclick="triggerBreakGlass()">🚨 Emergency Break-Glass Access</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 2.5fr;gap:20px">
        <div class="card">
          <h3>OPD Clinic Queue (${queue.length})</h3>
          ${queue.length === 0 ? `
            <div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">
              OPD Queue empty. Check in patients from Receptionist Desk.
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
              ${queue.map(q => `
                <div class="card" style="padding:12px;cursor:pointer;border-left:4px solid ${q.status==='CHECKED_IN'?'#0284c7':q.status==='IN_CONSULTATION'?'#7c3aed':'#10b981'}" onclick="loadDoctorConsultationWorkspace('${q.patientId}')">
                  <div style="display:flex;justify-content:space-between">
                    <strong style="color:var(--blue-dark)">Token ${esc(q.token)}</strong>
                    <span class="pill" style="font-size:10px">${esc(q.status)}</span>
                  </div>
                  <strong style="display:block;margin-top:4px">👤 ${esc(q.patientName)}</strong>
                  <small style="display:block;color:var(--muted)">ID: ${esc(q.patientId)} | Check-in: ${esc(q.checkInTime)}</small>
                </div>
              `).join("")}
            </div>
          `}
        </div>

        <div class="card" id="doctorConsultationArea">
          <div style="text-align:center;padding:60px 20px;color:var(--muted)">
            <div style="font-size:48px;margin-bottom:12px">🩺</div>
            <h3 style="color:var(--ink)">Select a patient from the OPD Queue</h3>
            <p style="max-width:440px;margin:8px auto;font-size:13px">Launches PATINOTE for clinical case-taking (Sections 8 through 29), including structured history, expandable physical exam, vitals, e-prescribing, lab/scan orders, and referrals.</p>
          </div>
        </div>
      </div>
    </main>
  `);
}

async function loadDoctorConsultationWorkspace(patientId) {
  const area = document.getElementById("doctorConsultationArea");
  area.innerHTML = `<div>Loading Patient record and PATINOTE case sheet from database...</div>`;

  try {
    const [p360, invRes] = await Promise.all([
      api(`/api/patient/360/${patientId}`),
      api("/api/inventory")
    ]);
    const p = p360.patient;
    const medicines = invRes.inventory || [];
    const allergies = p360.allergies || [];
    const isFemale = p.gender === "Female";
    const isChild = p.age <= 14;

    area.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:18px">
        
        <!-- SECTION 8: PATIENT IDENTIFICATION HEADER -->
        <div style="background:linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);padding:18px;border-radius:12px;border:1.5px solid #bae6fd">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
            <div>
              <div style="display:flex;align-items:center;gap:10px">
                <h2 style="margin:0;color:var(--blue-dark);font-size:24px">${esc(p.name)}</h2>
                <span class="pill pill-blue">${esc(p.id)}</span>
                <span class="pill pill-green">${esc(p.mrn)}</span>
              </div>
              <p style="margin:6px 0 0;font-size:13px;color:var(--muted)">
                Age: <strong>${esc(p.age)} yrs</strong> | Gender: <strong>${esc(p.gender)}</strong> | Blood Group: <strong style="color:red">${esc(p.bloodGroup)}</strong> | Phone: ${esc(p.phone)}
              </p>
            </div>
            <button class="btn btn-outline" style="font-size:11px" onclick="renderPatient360View('${p.id}')">View Patient 360°</button>
          </div>

          <!-- HIGHLY VISIBLE ALLERGIES & MEDICAL ALERTS BADGE -->
          <div style="margin-top:12px;padding:10px 14px;background:${allergies.length > 0 ? '#fee2e2' : '#f0fdf4'};border-radius:8px;border:1px solid ${allergies.length > 0 ? '#fca5a5' : '#86efac'};color:${allergies.length > 0 ? '#991b1b' : '#166534'};font-size:12px">
            <strong>⚠️ CRITICAL ALLERGIES & ALERTS:</strong> ${allergies.length > 0 ? allergies.map(a => `${a.allergen} (${a.reaction || 'Allergy'}) [${a.severity || 'Severe'}]`).join(", ") : 'No Known Drug Allergies Documented'}
          </div>
        </div>

        <div style="border-bottom:2px solid var(--blue);padding-bottom:6px">
          <h3 style="margin:0;color:var(--blue-dark)">📋 PATINOTE — CLINICAL CASE TAKING MODULE</h3>
        </div>

        <form id="patinoteForm" onsubmit="submitPatinoteCaseSheet(event, '${p.id}', 'FINALIZED')" style="display:flex;flex-direction:column;gap:16px">
          
          <!-- SECTION 9: CHIEF COMPLAINT (Multiple Complaints Support) -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#fafafa">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">9. Chief Complaints</h4>
            <div id="chiefComplaintsContainer" style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px">
              <div class="cc-row" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px">
                <input class="cc-name" required placeholder="Complaint (e.g. Acute Chest Pain)" />
                <input class="cc-duration" value="2 days" placeholder="Duration" />
                <select class="cc-onset">
                  <option value="Sudden">Sudden</option>
                  <option value="Acute">Acute</option>
                  <option value="Gradual">Gradual</option>
                </select>
                <input class="cc-severity" type="number" min="1" max="10" value="7" placeholder="Severity (1-10)" />
              </div>
            </div>
            <button type="button" class="btn btn-outline" style="font-size:11px;padding:4px 10px" onclick="addChiefComplaintRow()">+ Add Additional Complaint</button>
            <textarea id="csComplaintNotes" style="margin-top:10px" placeholder="Additional complaint narrative, aggravating/relieving factors..."></textarea>
          </div>

          <!-- SECTION 10: HISTORY OF PRESENT ILLNESS (HPI) -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">10. History of Present Illness (HPI)</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
              <label>Symptom Progression
                <select id="hpiProgression">
                  <option value="Worsening">Worsening</option>
                  <option value="Stable">Stable</option>
                  <option value="Fluctuating">Fluctuating</option>
                  <option value="Improving">Improving</option>
                </select>
              </label>
              <label>Frequency
                <input id="hpiFrequency" value="Continuous" placeholder="e.g. Intermittent / Continuous" />
              </label>
              <label>Previous Episodes
                <input id="hpiPrevious" value="None" placeholder="e.g. Similar episode 6 months ago" />
              </label>
            </div>
            <label>Clinical HPI Narrative
              <textarea id="hpiNotes" placeholder="Detailed clinical documentation of symptom onset, duration, radiation, aggravating/relieving factors, exposures, and previous treatment response..."></textarea>
            </label>
          </div>

          <!-- SECTION 11: PAST MEDICAL HISTORY -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">11. Past Medical History</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;margin-bottom:10px">
              <label><input type="checkbox" class="med-history-check" value="Diabetes Mellitus" /> Diabetes Mellitus</label>
              <label><input type="checkbox" class="med-history-check" value="Hypertension" checked /> Hypertension</label>
              <label><input type="checkbox" class="med-history-check" value="Bronchial Asthma" /> Asthma / COPD</label>
              <label><input type="checkbox" class="med-history-check" value="Coronary Artery Disease" /> Heart Disease</label>
              <label><input type="checkbox" class="med-history-check" value="Chronic Kidney Disease" /> Kidney Disease</label>
              <label><input type="checkbox" class="med-history-check" value="Hypothyroidism" /> Thyroid Disease</label>
            </div>
            <input id="pastMedicalNotes" value="${esc(p.existingConditions || '')}" placeholder="Other documented medical conditions & treatment details..." />
          </div>

          <!-- SECTION 12: PAST SURGICAL HISTORY -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">12. Past Surgical History</h4>
            <input id="pastSurgicalNotes" value="${esc(p.previousSurgeries || 'None')}" placeholder="Previous surgical procedures, dates, hospital, and complications..." />
          </div>

          <!-- SECTION 13: MEDICATION HISTORY -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">13. Current Medication History</h4>
            <input id="medicationHistoryNotes" value="${esc(p.currentMedications || 'None')}" placeholder="Regular medications, dose, frequency, compliance..." />
          </div>

          <!-- SECTION 14: ALLERGY HISTORY -->
          <div style="border:1.5px solid #fca5a5;padding:16px;border-radius:10px;background:#fff5f5">
            <h4 style="margin:0 0 10px;color:#991b1b">14. Allergy History</h4>
            <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:8px">
              <select id="algCategory">
                <option value="Drug">Drug Allergy</option>
                <option value="Food">Food Allergy</option>
                <option value="Environmental">Environmental</option>
              </select>
              <input id="algAllergen" value="${esc(p.allergies || '')}" placeholder="Allergen Name (e.g. Penicillin, NSAIDs)" />
              <select id="algSeverity">
                <option value="Severe">Severe</option>
                <option value="Moderate">Moderate</option>
                <option value="Mild">Mild</option>
              </select>
            </div>
          </div>

          <!-- SECTION 15 & 16: FAMILY & PERSONAL/SOCIAL HISTORY -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">15 & 16. Family, Personal & Social History</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <label>Family Medical History
                <input id="familyHistoryNotes" value="${esc(p.familyHistory || 'Diabetes in mother')}" />
              </label>
              <label>Occupation
                <input id="socialOccupation" value="Software Engineer" />
              </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">
              <label>Smoking
                <select id="socialSmoking">
                  <option value="Non-Smoker">Non-Smoker</option>
                  <option value="Current Smoker">Current Smoker</option>
                </select>
              </label>
              <label>Alcohol
                <select id="socialAlcohol">
                  <option value="Non-Alcoholic">Non-Alcoholic</option>
                  <option value="Social">Social</option>
                </select>
              </label>
              <label>Diet
                <select id="socialDiet">
                  <option value="Mixed">Mixed</option>
                  <option value="Vegetarian">Vegetarian</option>
                </select>
              </label>
              <label>Exercise
                <select id="socialExercise">
                  <option value="Moderate">Moderate</option>
                  <option value="Sedentary">Sedentary</option>
                </select>
              </label>
            </div>
          </div>

          <!-- SECTION 17: MENSTRUAL / OBSTETRIC HISTORY (Female Patients Only) -->
          ${isFemale ? `
            <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#fdf2f8">
              <h4 style="margin:0 0 10px;color:#be185d">17. Menstrual & Obstetric History (Female Patient)</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px">
                <label>LMP Date<input id="gynLmp" type="date" /></label>
                <label>Cycle Length<input id="gynCycle" value="28 days" /></label>
                <label>Gravida<input id="gynGravida" type="number" value="1" /></label>
                <label>Para<input id="gynPara" type="number" value="1" /></label>
                <label>Living Children<input id="gynLiving" type="number" value="1" /></label>
              </div>
            </div>
          ` : ''}

          <!-- SECTION 18: PEDIATRIC HISTORY (Children Age <= 14 Only) -->
          ${isChild ? `
            <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#f0fdf4">
              <h4 style="margin:0 0 10px;color:#15803d">18. Pediatric History (Child Patient)</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                <label>Birth Weight (kg)<input id="pedBirthWeight" value="3.2" /></label>
                <label>Delivery Type<input id="pedDelivery" value="Normal Vaginal" /></label>
                <label>Immunization<input id="pedImmunization" value="Up to date" /></label>
              </div>
            </div>
          ` : ''}

          <!-- SECTION 19: VITAL SIGNS RECORDING -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#f0fdf4">
            <h4 style="margin:0 0 10px;color:#15803d">19. Vital Signs Recording</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr;gap:8px">
              <label>Systolic BP<input id="vSys" type="number" value="120" /></label>
              <label>Diastolic BP<input id="vDia" type="number" value="80" /></label>
              <label>Pulse (bpm)<input id="vHr" type="number" value="76" /></label>
              <label>SpO2 (%)<input id="vSpo2" type="number" value="98" /></label>
              <label>Resp Rate<input id="vRr" type="number" value="16" placeholder="breaths/min" /></label>
              <label>Temp (°F)<input id="vTemp" type="number" step="0.1" value="98.6" /></label>
              <label>Height (cm)<input id="vHeight" type="number" value="172" onchange="computeBmiDisplay()" /></label>
              <label>Weight (kg)<input id="vWeight" type="number" value="70" onchange="computeBmiDisplay()" /></label>
            </div>
            <div style="margin-top:8px;font-size:12px;color:#166534">
              Auto-Calculated BMI: <strong id="bmiVal">23.7 kg/m² (Normal)</strong>
            </div>
          </div>

          <!-- SECTION 20: PHYSICAL EXAMINATION -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">20. Physical Examination (General & Systemic)</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <label>General Examination
                <input id="peGeneral" value="Conscious, oriented, hemodynamically stable. No pallor/icterus." />
              </label>
              <label>Cardiovascular System (CVS)
                <input id="peCvs" value="S1 S2 heard, normal rate and rhythm. No murmur." />
              </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label>Respiratory System
                <input id="peResp" value="Bilateral breath sounds clear. No wheeze or rales." />
              </label>
              <label>Abdomen & CNS
                <input id="peAbdomen" value="Soft, non-tender, no organomegaly. CNS grossly intact." />
              </label>
            </div>
          </div>

          <!-- SECTION 21: INVESTIGATION HISTORY & PREVIOUS REPORTS -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#f8fafc">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">21. Previous Investigation Review & Diagnostic Reports</h4>
            ${(p360.labOrders.length === 0 && p360.scanOrders.length === 0) ? `
              <p style="font-size:12px;color:var(--muted)">No previous lab/scan reports found for this patient.</p>
            ` : `
              <div style="display:flex;flex-direction:column;gap:6px">
                ${p360.labOrders.map(l => `<div style="font-size:12px">🧪 <strong>${esc(l.testName)}</strong>: ${esc(l.result || 'Pending')} (${esc(l.status)})</div>`).join("")}
                ${p360.scanOrders.map(s => `<div style="font-size:12px">📻 <strong>${esc(s.scanType)}</strong>: ${esc(s.reportText || 'Pending')} (${esc(s.status)})</div>`).join("")}
              </div>
            `}
          </div>

          <!-- SECTION 22: CLINICAL ASSESSMENT & DIAGNOSIS -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#fffbeb">
            <h4 style="margin:0 0 10px;color:#b45309">22. Clinical Assessment & Diagnosis</h4>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">
              <label>Final / Provisional Diagnosis *
                <input id="dxFinal" required value="Acute Viral Respiratory Infection" />
              </label>
              <label>ICD-10 Code
                <input id="dxIcd" value="J06.9" placeholder="e.g. J06.9" />
              </label>
            </div>
            <label>Differential Diagnoses
              <input id="dxDiff" value="Acute Bronchitis, Influenza" />
            </label>
          </div>

          <!-- SECTION 23: TREATMENT & MANAGEMENT PLAN -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">23. Treatment & Management Plan</h4>
            <textarea id="planInstructions" placeholder="Non-pharmacological advice, dietary precautions, activity restrictions..."></textarea>
          </div>

          <!-- SECTION 24: E-PRESCRIBING & CONNECTED ORDERS -->
          <div style="border:1.5px solid var(--blue);padding:18px;border-radius:10px;background:#f0f9ff">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">24. E-Prescription & Connected Diagnostic Orders</h4>
            
            <div style="margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong style="color:var(--blue-dark)">💊 Prescribe Medications (Pushes to Pharmacy Queue)</strong>
                <button type="button" class="btn btn-outline" style="font-size:11px;padding:3px 8px" onclick="addPrescriptionRow()">+ Add Medication</button>
              </div>
              <div id="prescriptionsContainer" style="display:flex;flex-direction:column;gap:8px">
                <div class="rx-row" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px">
                  <select class="rx-med">
                    ${medicines.map(m => `<option value="${esc(m.name)}">${esc(m.name)} (Stock: ${m.stockQuantity}, ₹${m.unitPrice})</option>`).join("")}
                  </select>
                  <input class="rx-dose" value="1 tablet" placeholder="Dose" />
                  <input class="rx-freq" value="TDS (Thrice daily)" placeholder="Frequency" />
                  <input class="rx-qty" type="number" value="10" placeholder="Qty" />
                </div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
              <div style="border:1px solid var(--border);padding:10px;border-radius:8px;background:white">
                <strong style="display:block;margin-bottom:4px">🧪 Order Laboratory Tests</strong>
                <label><input type="checkbox" id="labCbc" checked /> Complete Blood Count (CBC) [₹350]</label><br/>
                <label><input type="checkbox" id="labCrp" /> C-Reactive Protein (CRP) [₹450]</label><br/>
                <label><input type="checkbox" id="labLft" /> Liver Function Test (LFT) [₹750]</label><br/>
                <label><input type="checkbox" id="labKft" /> Kidney Function Test (KFT) [₹650]</label><br/>
                <label><input type="checkbox" id="labHba1c" /> HbA1c Glycated Hemoglobin [₹550]</label>
              </div>

              <div style="border:1px solid var(--border);padding:10px;border-radius:8px;background:white">
                <strong style="display:block;margin-bottom:4px">📻 Order Radiology Scans</strong>
                <label><input type="checkbox" id="scanXray" checked /> Chest X-Ray (PA View) [₹600]</label><br/>
                <label><input type="checkbox" id="scanCt" /> HRCT Thorax [₹2800]</label><br/>
                <label><input type="checkbox" id="scanMri" /> MRI Brain / Spine [₹4500]</label><br/>
                <label><input type="checkbox" id="scanUsg" /> USG Abdomen & Pelvis [₹900]</label><br/>
                <label><input type="checkbox" id="scanEcg" /> ECG 12-Lead [₹350]</label>
              </div>
            </div>
          </div>

          <!-- SECTION 25 & 26: REFERRAL & FOLLOW-UP -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px">
            <h4 style="margin:0 0 10px;color:var(--blue-dark)">25 & 26. Referral & Follow-Up Scheduling</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <label>Specialist Referral Department
                <select id="refDept">
                  <option value="">No Referral Needed</option>
                  <option value="Cardiology">Cardiology</option>
                  <option value="Pulmonology">Pulmonology</option>
                  <option value="Orthopedics">Orthopedics</option>
                  <option value="Neurology">Neurology</option>
                  <option value="Surgery">Surgery</option>
                </select>
              </label>
              <label>Follow-Up Date
                <input id="fuDate" type="date" value="${new Date(Date.now() + 7*86400000).toISOString().split('T')[0]}" />
              </label>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="fuAutoAppt" checked />
              <strong>Automatically book follow-up appointment in Reception queue for this date</strong>
            </label>
          </div>

          <!-- SECTION 27: INPATIENT ADMISSION RECOMMENDATION -->
          <div style="border:1px solid var(--border);padding:16px;border-radius:10px;background:#fef2f2">
            <h4 style="margin:0 0 10px;color:#991b1b">27. Inpatient Admission Recommendation (IPD)</h4>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:10px">
              <input type="checkbox" id="admRequire" />
              <strong style="color:#991b1b">Recommend Inpatient Hospital Admission for Monitoring / Treatment</strong>
            </label>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
              <label>Ward Category Preference
                <select id="admWard">
                  <option value="General">General Ward</option>
                  <option value="ICU">Intensive Care Unit (ICU)</option>
                  <option value="Emergency">Emergency Ward</option>
                  <option value="Private">Private Room</option>
                </select>
              </label>
              <label>Admission Justification / Notes
                <input id="admNotes" placeholder="e.g. Severe respiratory distress requiring oxygen monitoring..." />
              </label>
            </div>
          </div>

          <!-- SECTION 28 & 29: DIGITAL SIGNATURE & ACTION BUTTONS -->
          <div style="background:#f8fafc;padding:14px;border-radius:10px;border:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:var(--muted)">
              <span>✍️ DIGITAL SIGN-OFF: <strong>${esc(me ? me.name : 'Attending Physician')}</strong></span>
              <span>DATE & TIME: <strong>${new Date().toLocaleString()}</strong></span>
            </div>

            <div style="display:flex;gap:12px">
              <button type="button" class="btn btn-secondary" style="flex:1" onclick="submitPatinoteCaseSheet(event, '${p.id}', 'DRAFT')">💾 Save Draft Case Sheet</button>
              <button type="submit" class="btn btn-primary" style="flex:2;padding:14px;font-size:16px">✓ Sign & Finalize PATINOTE Case Sheet</button>
            </div>
          </div>
        </form>
      </div>
    `;
  } catch (err) { showError(err); }
}

function addChiefComplaintRow() {
  const container = document.getElementById("chiefComplaintsContainer");
  const div = document.createElement("div");
  div.className = "cc-row";
  div.style.cssText = "display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px";
  div.innerHTML = `
    <input class="cc-name" placeholder="Additional Complaint" />
    <input class="cc-duration" value="1 week" placeholder="Duration" />
    <select class="cc-onset"><option value="Gradual">Gradual</option><option value="Acute">Acute</option></select>
    <input class="cc-severity" type="number" min="1" max="10" value="5" placeholder="Severity" />
  `;
  container.appendChild(div);
}

function addPrescriptionRow() {
  const container = document.getElementById("prescriptionsContainer");
  if (!container) return;
  const firstRow = container.querySelector(".rx-row");
  if (!firstRow) return;
  const clone = firstRow.cloneNode(true);
  container.appendChild(clone);
}

function computeBmiDisplay() {
  const h = parseFloat(document.getElementById("vHeight").value || "0") / 100;
  const w = parseFloat(document.getElementById("vWeight").value || "0");
  if (h > 0 && w > 0) {
    const bmi = (w / (h * h)).toFixed(1);
    document.getElementById("bmiVal").textContent = `${bmi} kg/m²`;
  }
}

async function submitPatinoteCaseSheet(e, patientId, status = "FINALIZED") {
  if (e) e.preventDefault();

  const ccRows = document.querySelectorAll(".cc-row");
  const chiefComplaints = [];
  ccRows.forEach(row => {
    const name = row.querySelector(".cc-name").value;
    if (name) {
      chiefComplaints.push({
        complaint: name,
        duration: row.querySelector(".cc-duration").value,
        onset: row.querySelector(".cc-onset").value,
        severity: row.querySelector(".cc-severity").value
      });
    }
  });

  const prescriptions = [];
  const rxRows = document.querySelectorAll(".rx-row");
  rxRows.forEach(row => {
    const med = row.querySelector(".rx-med")?.value;
    if (med) {
      prescriptions.push({
        medicine: med,
        dose: row.querySelector(".rx-dose")?.value || "1 tab",
        frequency: row.querySelector(".rx-freq")?.value || "TDS",
        quantity: row.querySelector(".rx-qty")?.value || "10"
      });
    }
  });

  const labOrders = [];
  if (document.getElementById("labCbc")?.checked) labOrders.push("Complete Blood Count (CBC)");
  if (document.getElementById("labCrp")?.checked) labOrders.push("C-Reactive Protein (CRP)");
  if (document.getElementById("labLft")?.checked) labOrders.push("Liver Function Test (LFT)");
  if (document.getElementById("labKft")?.checked) labOrders.push("Kidney Function Test (KFT)");
  if (document.getElementById("labHba1c")?.checked) labOrders.push("HbA1c Glycated Hemoglobin");

  const scanOrders = [];
  if (document.getElementById("scanXray")?.checked) scanOrders.push("Chest X-Ray (PA View)");
  if (document.getElementById("scanCt")?.checked) scanOrders.push("HRCT Thorax");
  if (document.getElementById("scanMri")?.checked) scanOrders.push("MRI Brain / Spine");
  if (document.getElementById("scanUsg")?.checked) scanOrders.push("USG Abdomen & Pelvis");
  if (document.getElementById("scanEcg")?.checked) scanOrders.push("ECG 12-Lead");

  try {
    const res = await api("/api/patinote/save", {
      method: "POST",
      body: JSON.stringify({
        patientId,
        status,
        chiefComplaints,
        chiefComplaintNotes: document.getElementById("csComplaintNotes")?.value,
        hpi: {
          progression: document.getElementById("hpiProgression")?.value,
          frequency: document.getElementById("hpiFrequency")?.value,
          notes: document.getElementById("hpiNotes")?.value
        },
        pastMedicalHistory: document.getElementById("pastMedicalNotes")?.value,
        pastSurgicalHistory: document.getElementById("pastSurgicalNotes")?.value,
        medicationHistory: document.getElementById("medicationHistoryNotes")?.value,
        allergyHistory: [{ allergen: document.getElementById("algAllergen")?.value, category: document.getElementById("algCategory")?.value, severity: document.getElementById("algSeverity")?.value }],
        familyHistory: document.getElementById("familyHistoryNotes")?.value,
        personalSocialHistory: {
          occupation: document.getElementById("socialOccupation")?.value,
          smoking: document.getElementById("socialSmoking")?.value,
          alcohol: document.getElementById("socialAlcohol")?.value,
          diet: document.getElementById("socialDiet")?.value
        },
        vitals: {
          sysBp: document.getElementById("vSys")?.value,
          diaBp: document.getElementById("vDia")?.value,
          pulse: document.getElementById("vHr")?.value,
          spO2: document.getElementById("vSpo2")?.value,
          respRate: document.getElementById("vRr")?.value,
          temp: document.getElementById("vTemp")?.value,
          height: document.getElementById("vHeight")?.value,
          weight: document.getElementById("vWeight")?.value
        },
        physicalExamination: {
          general: document.getElementById("peGeneral")?.value,
          cvs: document.getElementById("peCvs")?.value,
          resp: document.getElementById("peResp")?.value,
          abdomen: document.getElementById("peAbdomen")?.value
        },
        clinicalAssessment: {
          finalDiagnosis: document.getElementById("dxFinal")?.value,
          icdCode: document.getElementById("dxIcd")?.value,
          differentialDiagnoses: document.getElementById("dxDiff")?.value
        },
        treatmentPlan: {
          instructions: document.getElementById("planInstructions")?.value
        },
        prescriptions,
        labOrders,
        scanOrders,
        referrals: {
          referralDepartment: document.getElementById("refDept")?.value
        },
        followUp: {
          followUpDate: document.getElementById("fuDate")?.value,
          createAppointment: document.getElementById("fuAutoAppt")?.checked
        },
        requireAdmission: document.getElementById("admRequire")?.checked,
        admissionWard: document.getElementById("admWard")?.value,
        admissionReason: document.getElementById("admNotes")?.value
      })
    });

    alert(res.message);
    renderDoctorPortal();
  } catch (err) { showError(err); }
}

async function triggerBreakGlass() {
  if (dynamicPatientsList.length === 0) {
    alert("No patients found in database for emergency break-glass.");
    return;
  }
  const pId = prompt("Enter Patient ID for Emergency Break-Glass access:", dynamicPatientsList[0].id);
  const reason = prompt("Enter Emergency Justification Reason:");
  if (!pId || !reason) return;

  try {
    const res = await api("/api/emergency/break-glass", {
      method: "POST",
      body: JSON.stringify({ patientId: pId, reason })
    });
    alert(`🚨 BREAK-GLASS ACCESS GRANTED!\n${res.message}`);
  } catch (err) { showError(err); }
}

/* ------------------------------------------------------------------ */
/* PHARMACY PORTAL & MEDICINE PACKING SCREEN                          */
/* ------------------------------------------------------------------ */

async function renderPharmacyPortal() {
  let orders = [], inventory = [];
  try {
    const [oRes, iRes] = await Promise.all([api("/api/pharmacy/orders"), api("/api/inventory")]);
    orders = oRes.orders || [];
    inventory = iRes.inventory || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">PHARMACY DISPENSING & MEDICINE PACKING PORTAL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Database Inventory Deduction & Barcode Verification Counter</p>
        </div>
        <button class="btn btn-primary" onclick="openAddMedicineModal()">+ Add New Medicine to Inventory</button>
      </div>

      <div style="display:grid;grid-template-columns:2.5fr 1fr;gap:20px">
        <div class="card">
          <h3>Pending Prescription Orders (${orders.length})</h3>
          ${orders.length === 0 ? `
            <div style="text-align:center;padding:32px;color:var(--muted);font-size:13px">
              No pending prescription orders in pharmacy queue.
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
              ${orders.map(o => `
                <div class="card" style="padding:16px;border-left:4px solid ${o.dispensedStatus==='DISPENSED'?'#10b981':o.dispensedStatus==='READY_FOR_COLLECTION'?'#0284c7':'#f59e0b'}">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <strong style="font-size:16px;color:var(--blue-dark)">💊 ${esc(o.medicationName)} (${esc(o.dosage)})</strong>
                      <small style="display:block;color:var(--muted);margin-top:2px">
                        Patient: <strong>${esc(o.patientName)}</strong> (${esc(o.patientId)}) | Stock Availability: <strong style="color:${o.inventoryAvailability==='AVAILABLE'?'green':'red'}">${esc(o.inventoryAvailability)}</strong>
                      </small>
                    </div>
                    <span class="pill ${o.dispensedStatus==='DISPENSED'?'pill-green':o.dispensedStatus==='READY_FOR_COLLECTION'?'pill-blue':'pill-yellow'}">${esc(o.dispensedStatus)}</span>
                  </div>

                  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                    ${(o.dispensedStatus==='PENDING' || o.status==='RECEIVED') ? `<button class="btn btn-secondary" style="font-size:12px" onclick="verifyPharmacyOrder('${o.id}')">1. Review & Verify</button>` : ''}
                    ${(o.dispensedStatus==='VERIFIED' || o.status==='UNDER_REVIEW') ? `<button class="btn btn-primary" style="font-size:12px" onclick="preparePharmacyOrder('${o.id}')">2. Prepare & Reserve Stock</button>` : ''}
                    ${(o.dispensedStatus==='PREPARING' || o.status==='PREPARING') ? `<button class="btn btn-primary" style="font-size:12px" onclick="generatePharmacyBill('${o.id}')">3. Generate Bill (₹${o.totalPrice || o.totalAmount})</button>` : ''}
                    ${(o.dispensedStatus==='BILL_GENERATED' || o.status==='BILLED' || o.dispensedStatus==='VERIFIED') ? `
                      ${o.paymentStatus !== 'PAID' ? `<button class="btn btn-secondary" style="font-size:12px;background:#0284c7;color:white" onclick="recordPharmacyPayment('${o.id}')">Record Payment (₹${o.totalPrice || o.totalAmount})</button>` : `<span class="pill pill-green" style="font-size:11px">✓ Paid</span>`}
                      <button class="btn btn-primary" style="font-size:12px;background:#7c3aed" onclick="openPackingScreen('${o.id}', '${esc(o.medicationName)}', '${o.barcode}')">4. Pack & Barcode Verify</button>
                    ` : ''}
                    ${(o.dispensedStatus==='READY_FOR_COLLECTION' || o.status==='READY_FOR_COLLECTION') ? `<button class="btn btn-primary" style="font-size:12px;background:#10b981" onclick="dispensePharmacyOrder('${o.id}')">5. Dispense & Deduct Inventory</button>` : ''}
                    ${(o.dispensedStatus !== 'DISPENSED' && o.status !== 'CANCELLED') ? `
                      <button class="btn btn-outline" style="font-size:11px;color:#dc2626;border-color:#fca5a5" onclick="cancelPharmacyOrder('${o.id}')">Cancel</button>
                      <button class="btn btn-outline" style="font-size:11px" onclick="substitutePharmacyOrder('${o.id}')">Substitute</button>
                    ` : ''}
                  </div>
                </div>
              `).join("")}
            </div>
          `}
        </div>

        <div class="card">
          <h3>Stock Health Intelligence</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
            ${inventory.map(i => `
              <div style="padding:10px;border:1px solid var(--border);border-radius:8px">
                <div style="display:flex;justify-content:space-between">
                  <strong>${esc(i.name)}</strong>
                  <span class="pill ${i.status==='HEALTHY'?'pill-green':'pill-red'}">${esc(i.status)}</span>
                </div>
                <small style="color:var(--muted);display:block;margin-top:2px">Stock: <strong>${i.stockQuantity}</strong> (Reserved: ${i.reservedQuantity || 0}) | Price: ₹${i.unitPrice} | Expiry: ${esc(i.expiryDate || 'N/A')}</small>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </main>
  `);
}

function openAddMedicineModal() {
  const name = prompt("Enter Medicine Name (e.g. Ciprofloxacin 500mg):");
  const stockQuantity = prompt("Enter Initial Stock Quantity:", "100");
  const unitPrice = prompt("Enter Unit Price (₹):", "65");
  if (!name) return;

  api("/api/inventory", {
    method: "POST",
    body: JSON.stringify({ name, stockQuantity, unitPrice, thresholdLow: 20 })
  }).then(res => {
    alert(`Medicine ${res.inventoryItem.name} added to pharmacy inventory!`);
    renderPharmacyPortal();
  }).catch(showError);
}

async function verifyPharmacyOrder(prescriptionId) {
  try {
    await api(`/api/pharmacy/orders/${prescriptionId}/verify`, { method: "POST" });
    alert("✓ Prescription verified by pharmacist.");
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function preparePharmacyOrder(orderId) {
  try {
    const res = await api(`/api/pharmacy/orders/${orderId}/prepare`, { method: "POST" });
    alert("✓ " + (res.message || "Medication batch validated & stock reserved."));
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function generatePharmacyBill(prescriptionId) {
  try {
    const res = await api(`/api/pharmacy/orders/${prescriptionId}/generate-bill`, { method: "POST", body: JSON.stringify({ prescriptionId }) });
    alert(`✓ Bill Generated! Invoice ID: ${res.invoice.id} - Total Amount: ₹${res.invoice.totalAmount}`);
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function recordPharmacyPayment(orderId) {
  const paymentMethod = prompt("Select Payment Method (UPI / Cash / Card / Insurance):", "UPI");
  if (!paymentMethod) return;
  try {
    const res = await api(`/api/pharmacy/orders/${orderId}/record-payment`, { method: "POST", body: JSON.stringify({ paymentMethod }) });
    alert(`✓ Payment of ₹${res.receipt.amount} recorded! Receipt #${res.receipt.receiptNumber} generated.`);
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function cancelPharmacyOrder(orderId) {
  const reason = prompt("Enter Cancellation Reason:", "Prescription cancelled by clinician");
  if (!reason) return;
  try {
    await api(`/api/pharmacy/orders/${orderId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    alert("✓ Order cancelled and reserved inventory released.");
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function substitutePharmacyOrder(orderId) {
  const substituteMedicineName = prompt("Enter Generic Substitute Name (e.g. Paracetamol 650mg):");
  if (!substituteMedicineName) return;
  try {
    const res = await api(`/api/pharmacy/orders/${orderId}/substitute`, { method: "POST", body: JSON.stringify({ substituteMedicineName }) });
    alert("✓ " + res.message);
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

function openPackingScreen(prescriptionId, medName, expectedBarcode) {
  const modalHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:300">
      <div class="card" style="width:min(500px, 90%);padding:28px">
        <h3>📦 MEDICINE PACKING INTERFACE</h3>
        <p style="font-size:13px;color:var(--muted)">Order #${prescriptionId} - ${medName}</p>

        <div class="scanner-box">
          <div style="font-size:14px;margin-bottom:6px">BARCODE SCANNED ITEM VERIFICATION</div>
          <div id="scanResultText" style="font-size:18px;font-weight:bold;color:white">READY TO SCAN...</div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input id="barcodeInput" value="${expectedBarcode}" placeholder="Enter or scan barcode..." />
          <button class="btn btn-secondary" onclick="simulateBarcodeScan('${prescriptionId}', '${expectedBarcode}')">Scan Barcode</button>
        </div>

        <div style="display:flex;gap:8px">
          <button class="btn btn-outline" style="flex:1" onclick="closeModal('packingModal')">Cancel</button>
          <button id="packCompleteBtn" class="btn btn-primary" style="flex:1" disabled onclick="completePackingOrder('${prescriptionId}')">Pack Order & Print Label</button>
        </div>
      </div>
    </div>
  `;

  const modalDiv = document.createElement("div");
  modalDiv.id = "packingModal";
  modalDiv.innerHTML = modalHtml;
  document.body.appendChild(modalDiv);
}

async function simulateBarcodeScan(prescriptionId, expectedBarcode) {
  const scanned = document.getElementById("barcodeInput").value.trim();
  const textEl = document.getElementById("scanResultText");
  const packBtn = document.getElementById("packCompleteBtn");

  try {
    const res = await api("/api/pharmacy/scan-verify", {
      method: "POST",
      body: JSON.stringify({ prescriptionId, scannedBarcode: scanned })
    });
    textEl.style.color = "#4ade80";
    textEl.textContent = res.message;
    packBtn.disabled = false;
  } catch (err) {
    textEl.style.color = "#f87171";
    textEl.textContent = err.message;
    packBtn.disabled = true;
  }
}

async function completePackingOrder(prescriptionId) {
  try {
    await api(`/api/pharmacy/orders/${prescriptionId}/pack`, { method: "POST" });
    alert("✓ ORDER PACKED SUCCESSFULLY! Packing label printed.");
    closeModal("packingModal");
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

async function dispensePharmacyOrder(prescriptionId) {
  try {
    const res = await api(`/api/pharmacy/orders/${prescriptionId}/dispense`, { method: "POST" });
    alert(`✓ MEDICATION DISPENSED! Database Inventory Updated. Remaining Stock: ${res.updatedInventory ? res.updatedInventory.stockQuantity : 'N/A'}`);
    renderPharmacyPortal();
  } catch (err) { showError(err); }
}

/* ------------------------------------------------------------------ */
/* DIAGNOSTICS: RADIOLOGY SCANNING & LABORATORY WORKFLOWS              */
/* ------------------------------------------------------------------ */

async function renderScanPortal() {
  let scans = [];
  try {
    const sRes = await api("/api/scan/orders");
    scans = sRes.scanOrders || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">RADIOLOGY & SCANNING CENTRE PORTAL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">CT, MRI, X-Ray & Ultrasound Diagnostic Workflow</p>
        </div>
      </div>

      <div class="card">
        <h3>Diagnostic Imaging Scans (${scans.length})</h3>
        ${scans.length === 0 ? `
          <p style="color:var(--muted);font-size:13px;margin-top:10px">No scan requests in queue.</p>
        ` : `
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
            ${scans.map(s => `
              <div class="card" style="padding:16px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <strong>📻 ${esc(s.scanType)} (${esc(s.id)})</strong>
                    <small style="display:block;color:var(--muted)">Patient: <strong>${esc(s.patientName)}</strong> (${esc(s.patientId)}) | Price: ₹${s.price || 600} ${s.roomNumber ? `| Room: ${esc(s.roomNumber)}` : ''}</small>
                  </div>
                  <span class="pill ${s.status==='PUBLISHED'?'pill-green':s.status==='COMPLETED'?'pill-blue':'pill-yellow'}">${esc(s.status)}</span>
                </div>

                <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
                  ${s.status === 'REQUESTED' ? `<button class="btn btn-secondary" style="font-size:11px" onclick="scheduleScanModal('${s.id}')">1. Schedule Slot & Machine</button>` : ''}
                  ${s.status === 'SCHEDULED' ? `<button class="btn btn-primary" style="font-size:11px" onclick="arriveScan('${s.id}')">2. Confirm Patient Arrived</button>` : ''}
                  ${s.status === 'PATIENT_ARRIVED' ? `<button class="btn btn-primary" style="font-size:11px" onclick="startScan('${s.id}')">3. Start Scan Acquisition</button>` : ''}
                  ${s.status === 'IN_PROGRESS' ? `<button class="btn btn-primary" style="font-size:11px;background:#7c3aed" onclick="completeScan('${s.id}')">4. Complete Scan Acquisition</button>` : ''}
                  ${(s.status === 'COMPLETED' || s.status === 'REPORT_PENDING') ? `
                    <button class="btn btn-secondary" style="font-size:11px" onclick="findingsScan('${s.id}')">5. Enter Radiologist Findings</button>
                    <button class="btn btn-primary" style="font-size:11px;background:#10b981" onclick="publishScanReport('${s.id}')">6. Verify & Publish Report</button>
                  ` : ''}
                  ${s.status === 'UNDER_REVIEW' ? `<button class="btn btn-primary" style="font-size:11px;background:#10b981" onclick="publishScanReport('${s.id}')">Verify & Publish Final Report</button>` : ''}
                  ${s.status === 'PUBLISHED' ? `<button class="btn btn-outline" style="font-size:11px" onclick="viewScanReportModal('${s.id}')">📄 View Verified Report</button>` : ''}
                </div>
              </div>
            `).join("")}
          </div>
        `}
      </div>
    </main>
  `);
}

async function scheduleScanModal(scanId) {
  const date = prompt("Enter Scheduled Date (YYYY-MM-DD):", new Date().toISOString().split("T")[0]);
  const time = prompt("Enter Scheduled Slot Time:", "11:30 AM");
  if (!date) return;
  try {
    await api(`/api/scan/orders/${scanId}/schedule`, { method: "POST", body: JSON.stringify({ scheduledDate: date, scheduledTime: time }) });
    alert(`✓ Scan scheduled for ${date} at ${time}.`);
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function arriveScan(scanId) {
  try {
    await api(`/api/scan/orders/${scanId}/arrive`, { method: "POST" });
    alert("✓ Patient arrival marked at radiology reception.");
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function startScan(scanId) {
  try {
    await api(`/api/scan/orders/${scanId}/start`, { method: "POST" });
    alert("✓ Scan acquisition started in imaging suite.");
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function completeScan(scanId) {
  try {
    await api(`/api/scan/orders/${scanId}/complete`, { method: "POST" });
    alert("✓ Imaging procedure completed. Sent to radiologist for review.");
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function findingsScan(scanId) {
  const findings = prompt("Enter Radiologist Preliminary Findings:", "Visualized organs clear without acute pathological abnormalities.");
  if (!findings) return;
  const impression = prompt("Enter Clinical Impression:", "Normal study.");
  try {
    await api(`/api/scan/orders/${scanId}/findings`, { method: "POST", body: JSON.stringify({ findings, impression }) });
    alert("✓ Preliminary findings recorded. Order status set to UNDER_REVIEW.");
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function publishScanReport(scanId) {
  const findings = prompt("Enter Final Radiology Report Findings:", "Clear lung fields, normal cardiac silhouette, no acute cardiopulmonary process.");
  if (!findings) return;
  const impression = prompt("Enter Final Impression:", "Normal examination.");
  try {
    await api(`/api/scan/orders/${scanId}/verify-publish`, { method: "POST", body: JSON.stringify({ findings, impression }) });
    alert("✓ Radiology Scan Report Verified & Published to Patient Portal!");
    renderScanPortal();
  } catch (err) { showError(err); }
}

async function viewScanReportModal(scanId) {
  try {
    const res = await api(`/api/scan/reports/${scanId}`);
    const r = res.report;
    alert(`📄 RADIOLOGY REPORT\n\nScan: ${r.scanType}\nPatient: ${r.patientName}\nStatus: ${r.status}\n\nFINDINGS:\n${r.findings}\n\nIMPRESSION:\n${r.impression}\n\nVerified by: ${r.radiologist} on ${new Date(r.publishedAt).toLocaleDateString()}`);
  } catch (err) { showError(err); }
}

async function renderLabPortal() {
  let labs = [];
  try {
    const lRes = await api("/api/lab/orders");
    labs = lRes.labOrders || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">PATHOLOGY LABORATORY PORTAL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Specimen Processing, Abnormal Flags & Verified Result Entry</p>
        </div>
      </div>

      <div class="card">
        <h3>Laboratory Test Orders (${labs.length})</h3>
        ${labs.length === 0 ? `
          <p style="color:var(--muted);font-size:13px;margin-top:10px">No laboratory orders in queue.</p>
        ` : `
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
            ${labs.map(l => `
              <div class="card" style="padding:16px;border-left:4px solid ${l.status==='PUBLISHED'?'#10b981':l.status==='IN_PROGRESS'?'#0284c7':'#f59e0b'}">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <strong>🧪 ${esc(l.testName)} (${esc(l.id)})</strong>
                    <small style="display:block;color:var(--muted)">Patient: <strong>${esc(l.patientName)}</strong> (${esc(l.patientId)}) | Price: ₹${l.price || 350} ${l.sampleBarcode ? `| Sample: ${esc(l.sampleBarcode)}` : ''}</small>
                  </div>
                  <span class="pill ${l.status==='PUBLISHED'?'pill-green':l.status==='IN_PROGRESS'?'pill-blue':'pill-yellow'}">${esc(l.status)}</span>
                </div>

                <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                  ${l.status === 'REQUESTED' ? `<button class="btn btn-secondary" style="font-size:11px" onclick="collectLabSample('${l.id}')">1. Collect Blood/Specimen Sample</button>` : ''}
                  ${l.status === 'SAMPLE_COLLECTED' ? `<button class="btn btn-primary" style="font-size:11px" onclick="processLabSample('${l.id}')">2. Process in Analyzer</button>` : ''}
                  ${l.status === 'IN_PROGRESS' ? `<button class="btn btn-primary" style="font-size:11px;background:#7c3aed" onclick="enterLabResult('${l.id}', '${esc(l.testName)}')">3. Enter Values & Evaluate Ranges</button>` : ''}
                  ${l.status === 'RESULT_ENTERED' ? `<button class="btn btn-primary" style="font-size:11px;background:#10b981" onclick="publishLabResult('${l.id}')">4. Pathologist Sign-Off & Publish</button>` : ''}
                </div>

                ${l.status==='PUBLISHED' ? `
                  <div style="margin-top:10px;padding:8px 12px;background:#f0fdf4;border-radius:6px;font-size:13px;color:#15803d">
                    <strong>Verified Result:</strong> ${esc(l.result)}
                    ${l.isAbnormal ? '<span class="pill pill-red" style="margin-left:8px">⚠️ CRITICAL / ABNORMAL</span>' : '<span class="pill pill-green" style="margin-left:8px">✓ NORMAL</span>'}
                  </div>
                ` : ''}
              </div>
            `).join("")}
          </div>
        `}
      </div>
    </main>
  `);
}

async function collectLabSample(labId) {
  try {
    const res = await api(`/api/lab/orders/${labId}/collect-sample`, { method: "POST" });
    alert(`✓ Sample Collected! Sample ID Barcode: ${res.labOrder.sampleBarcode}`);
    renderLabPortal();
  } catch (err) { showError(err); }
}

async function processLabSample(labId) {
  try {
    await api(`/api/lab/orders/${labId}/process`, { method: "POST" });
    alert("✓ Specimen loaded into laboratory analyzer for automated testing.");
    renderLabPortal();
  } catch (err) { showError(err); }
}

async function enterLabResult(labId, testName) {
  const result = prompt(`Enter ${testName} Measured Value:`, "WBC: 14,800 /mcL (Elevated)");
  if (!result) return;
  const isAbnormal = confirm("Is this measured value ABNORMAL / OUTSIDE REFERENCE RANGE?");
  try {
    await api(`/api/lab/orders/${labId}/result`, { method: "POST", body: JSON.stringify({ result, isAbnormal }) });
    alert("✓ Test result entered and evaluated. Order set to RESULT_ENTERED.");
    renderLabPortal();
  } catch (err) { showError(err); }
}

async function publishLabResult(labId) {
  try {
    await api(`/api/lab/orders/${labId}/verify-publish`, { method: "POST" });
    alert("✓ Lab Report Signed Off by Pathologist & Published to Patient Portal!");
    renderLabPortal();
  } catch (err) { showError(err); }
}

/* ------------------------------------------------------------------ */
/* DEDICATED MODULE PORTALS (NURSE, BEDS, EMERGENCY, BILLING, PATIENT)*/
/* ------------------------------------------------------------------ */

async function renderNursePortal() {
  let admissions = [], beds = [], vitals = [];
  try {
    const [bRes, aRes, vRes] = await Promise.all([
      api("/api/beds"),
      api("/api/admissions").catch(() => ({ admissions: [] })),
      api("/api/vitals/logs").catch(() => ({ vitals: [] }))
    ]);
    beds = bRes.beds || [];
    admissions = aRes.admissions || [];
    vitals = vRes.vitals || [];
  } catch (err) { console.error(err); }

  const occupiedBeds = beds.filter(b => b.status === "OCCUPIED");

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">👩‍⚕️ NURSE CARE STATION & WARD MANAGEMENT</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Inpatient Care, Ward Vitals Logging, Nursing Tasks & Bed Monitoring</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="openLogWardVitalsModal()">+ Log Patient Vitals</button>
          <button class="btn btn-secondary" onclick="switchModule('beds')">🛏 View All Wards</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <!-- Inpatient Ward Patients List -->
        <div class="card">
          <h3>Occupied Ward Beds & Inpatients (${occupiedBeds.length})</h3>
          ${occupiedBeds.length === 0 ? `
            <div style="text-align:center;padding:36px;color:var(--muted);background:#f8fafc;border-radius:8px;border:1px dashed var(--border)">
              <p style="font-size:14px;margin:0">No patients currently admitted to ward beds.</p>
              <small>Allocate beds from the Beds / Admission module or Reception portal.</small>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
              ${occupiedBeds.map(b => `
                <div class="card" style="padding:16px;border-left:4px solid var(--blue)">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <strong style="font-size:16px;color:var(--blue-dark)">🛏 Bed ${esc(b.bedId)} (${esc(b.ward)})</strong>
                      <h4 style="margin:4px 0 2px;color:var(--ink)">👤 ${esc(b.currentPatientName || 'Admitted Patient')}</h4>
                      <small style="color:var(--muted)">Patient ID: ${esc(b.currentPatientId)} | Room: ${esc(b.roomNumber || 'General')}</small>
                    </div>
                    <span class="pill pill-blue">OCCUPIED</span>
                  </div>

                  <div style="display:flex;gap:8px;margin-top:12px">
                    <button class="btn btn-secondary" style="font-size:11px" onclick="openLogWardVitalsModal('${b.currentPatientId}', '${esc(b.currentPatientName)}')">1. Record Vitals</button>
                    <button class="btn btn-outline" style="font-size:11px" onclick="renderPatient360View('${b.currentPatientId}')">2. Patient 360° Record</button>
                    <button class="btn btn-outline" style="font-size:11px" onclick="handleBedClick('${b.bedId}', '${b.status}')">Manage Bed</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Nursing Care Quick Actions & Recent Vitals -->
        <div class="card">
          <h3>Recent Vitals Logged</h3>
          <div style="max-height:450px;overflow-y:auto;margin-top:10px">
            ${vitals.length === 0 ? `
              <p style="font-size:12px;color:var(--muted)">No recent vitals logged in current shift.</p>
            ` : vitals.slice(0, 10).map(v => `
              <div style="padding:10px;border-bottom:1px solid var(--border);font-size:12px">
                <div style="display:flex;justify-content:space-between">
                  <strong>👤 ${esc(v.patientName || v.patientId)}</strong>
                  <small style="color:var(--muted)">${new Date(v.timestamp || Date.now()).toLocaleTimeString()}</small>
                </div>
                <div style="color:var(--blue-dark);margin-top:4px">
                  BP: <strong>${v.sysBp}/${v.diaBp}</strong> | Pulse: <strong>${v.pulse || v.heartRate} bpm</strong> | Temp: <strong>${v.temp}°F</strong> | SpO2: <strong>${v.spO2}%</strong>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </main>
  `);
}

function openLogWardVitalsModal(defaultPatientId = '', defaultPatientName = '') {
  if (dynamicPatientsList.length === 0) {
    alert("No registered patients in database.");
    openRegisterPatientModal();
    return;
  }

  const patientSelect = dynamicPatientsList.map(p => `<option value="${p.id}" ${p.id===defaultPatientId?'selected':''}>${p.name} (${p.mrn})</option>`).join('');

  const modalHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.7);display:grid;place-items:center;z-index:300;padding:20px">
      <div class="card" style="width:min(520px, 95%);padding:24px">
        <h3 style="color:var(--blue-dark);margin-top:0">💉 Ward Vitals Recording</h3>
        <form id="wardVitalsForm" style="display:flex;flex-direction:column;gap:12px;margin-top:14px">
          <label>Select Patient
            <select id="wvPatientId">${patientSelect}</select>
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label>Systolic BP (mmHg)<input id="wvSys" type="number" value="120" required /></label>
            <label>Diastolic BP (mmHg)<input id="wvDia" type="number" value="80" required /></label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
            <label>Pulse Rate (bpm)<input id="wvPulse" type="number" value="76" required /></label>
            <label>SpO2 (%)<input id="wvSpo2" type="number" value="98" required /></label>
            <label>Temp (°F)<input id="wvTemp" type="number" step="0.1" value="98.6" required /></label>
          </div>

          <label>Nursing Observations & Notes
            <input id="wvNotes" placeholder="e.g. Patient resting comfortably. No acute distress." />
          </label>

          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-outline" type="button" style="flex:1" onclick="closeModal('wardVitalsModal')">Cancel</button>
            <button class="btn btn-primary" style="flex:1">✓ Save Vitals Record</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modalDiv = document.createElement("div");
  modalDiv.id = "wardVitalsModal";
  modalDiv.innerHTML = modalHtml;
  document.body.appendChild(modalDiv);

  document.getElementById("wardVitalsForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const patientId = document.getElementById("wvPatientId").value;
      await api("/api/vitals/log", {
        method: "POST",
        body: JSON.stringify({
          patientId,
          sysBp: document.getElementById("wvSys").value,
          diaBp: document.getElementById("wvDia").value,
          pulse: document.getElementById("wvPulse").value,
          spO2: document.getElementById("wvSpo2").value,
          temp: document.getElementById("wvTemp").value,
          notes: document.getElementById("wvNotes").value
        })
      });
      alert("✓ Ward Vitals Recorded & Saved to Database!");
      closeModal("wardVitalsModal");
      renderNursePortal();
    } catch (err) { showError(err); }
  };
}

async function renderBedPortal() {
  let beds = [];
  try {
    const res = await api("/api/beds");
    beds = res.beds || [];
  } catch (err) { console.error(err); }

  const total = beds.length;
  const available = beds.filter(b => b.status === "AVAILABLE").length;
  const occupied = beds.filter(b => b.status === "OCCUPIED").length;
  const cleaning = beds.filter(b => b.status === "CLEANING").length;

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">🛏️ HOSPITAL BED MANAGEMENT & ADMISSION CONTROL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Real-Time Ward Occupancy, Concurrency-Safe Bed Allocation & Discharge</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" onclick="openAllocateBedSelectModal()">+ Allocate Bed</button>
        </div>
      </div>

      <!-- Bed Metrics Bar -->
      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:14px;margin-bottom:20px">
        <div class="card" style="border-left:4px solid var(--blue)">
          <small style="color:var(--muted)">TOTAL BEDS</small>
          <h2 style="margin:4px 0;color:var(--blue-dark)">${total} Beds</h2>
        </div>
        <div class="card" style="border-left:4px solid var(--emerald)">
          <small style="color:var(--muted)">AVAILABLE</small>
          <h2 style="margin:4px 0;color:#15803d">${available} Free</h2>
        </div>
        <div class="card" style="border-left:4px solid var(--indigo)">
          <small style="color:var(--muted)">OCCUPIED</small>
          <h2 style="margin:4px 0;color:#3730a3">${occupied} Patients</h2>
        </div>
        <div class="card" style="border-left:4px solid var(--amber)">
          <small style="color:var(--muted)">CLEANING / MAINTENANCE</small>
          <h2 style="margin:4px 0;color:#b45309">${cleaning} Beds</h2>
        </div>
      </div>

      <div class="card">
        <h3>Visual Bed Matrix</h3>
        <div class="bed-grid" style="margin-top:14px">
          ${beds.map(b => `
            <div class="bed-card ${b.status}" onclick="handleBedClick('${b.bedId}', '${b.status}')">
              <strong style="font-size:14px">${esc(b.bedId)}</strong>
              <small style="display:block;font-size:10px;color:var(--muted)">${esc(b.ward)}</small>
              <span class="pill" style="font-size:9px;margin-top:4px">${esc(b.status)}</span>
              ${b.currentPatientName ? `<small style="display:block;font-size:10px;margin-top:2px;font-weight:600">${esc(b.currentPatientName)}</small>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </main>
  `);
}

function handleBedClick(bedId, currentStatus) {
  if (currentStatus === "AVAILABLE") {
    allocateBedModal(bedId);
  } else if (currentStatus === "OCCUPIED") {
    if (confirm(`Bed ${bedId} is currently OCCUPIED. Do you want to process discharge / release this bed?`)) {
      api(`/api/beds/discharge`, {
        method: "POST",
        body: JSON.stringify({ bedId })
      }).then(res => {
        alert(`✓ Bed ${bedId} released and set to CLEANING.`);
        route();
      }).catch(showError);
    }
  } else if (currentStatus === "CLEANING") {
    if (confirm(`Mark Bed ${bedId} as CLEANED & AVAILABLE?`)) {
      api(`/api/beds/status`, {
        method: "POST",
        body: JSON.stringify({ bedId, status: "AVAILABLE" })
      }).then(res => {
        alert(`✓ Bed ${bedId} is now AVAILABLE for new patients.`);
        route();
      }).catch(showError);
    }
  }
}

function openAllocateBedSelectModal() {
  const freeBed = (dynamicPatientsList.length > 0) ? "ICU-01" : "EMG-01";
  allocateBedModal(freeBed);
}

async function renderEmergencyPortal() {
  let emergencyCases = [], beds = [], breakGlassLogs = [];
  try {
    const [eRes, bRes, bgRes] = await Promise.all([
      api("/api/emergency/cases").catch(() => ({ emergencyCases: [] })),
      api("/api/beds"),
      api("/api/emergency/break-glass-logs").catch(() => ({ logs: [] }))
    ]);
    emergencyCases = eRes.emergencyCases || [];
    beds = (bRes.beds || []).filter(b => b.ward === "Emergency");
    breakGlassLogs = bgRes.logs || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:#dc2626;margin:0">🚨 EMERGENCY & URGENT CARE WORKFLOW</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Immediate Triage Classification, ER Bed Allocation & Audit-Logged Break-Glass Access</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-danger" onclick="openRapidEmergencyModal()">⚡ Rapid Trauma Intake (Auto Temp MRN)</button>
          <button class="btn btn-outline" style="border-color:#dc2626;color:#dc2626" onclick="triggerBreakGlass()">🚨 Trigger Break-Glass Access</button>
          <button class="btn btn-primary" onclick="openRegisterPatientModal()">+ Register Patient</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <!-- Emergency Triage Cases -->
        <div class="card">
          <h3>Active Emergency Triage Queue (${emergencyCases.length})</h3>
          ${emergencyCases.length === 0 ? `
            <div style="text-align:center;padding:36px;background:#fef2f2;border-radius:8px;border:1px dashed #fca5a5;color:#991b1b">
              <strong style="font-size:16px">No active emergency cases in triage.</strong>
              <p style="font-size:13px;margin:6px 0 0">All ER beds and emergency resources are operating at nominal capacity.</p>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
              ${emergencyCases.map(c => `
                <div class="card" style="padding:16px;border-left:5px solid ${(c.triageStatus||c.triageLevel)==='RED'?'#dc2626':(c.triageStatus||c.triageLevel)==='YELLOW'?'#f59e0b':'#10b981'}">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                      <strong style="font-size:16px;color:var(--blue-dark)">🚨 ${esc(c.patientName)}</strong>
                      <small style="display:block;color:var(--muted)">MRN: <strong>${esc(c.mrn || c.patientId)}</strong> | Complaint: ${esc(c.chiefComplaint || 'Acute Distress')} | Assigned Bed: ${esc(c.assignedBedId || 'None')}</small>
                    </div>
                    <span class="pill ${(c.triageStatus||c.triageLevel)==='RED'?'pill-red':(c.triageStatus||c.triageLevel)==='YELLOW'?'pill-yellow':'pill-green'}">TRIAGE: ${esc(c.triageStatus || c.triageLevel || 'RED')}</span>
                  </div>

                  <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                    <button class="btn btn-secondary" style="font-size:11px" onclick="renderPatient360View('${c.patientId}')">Patient 360°</button>
                    <button class="btn btn-outline" style="font-size:11px" onclick="updateEmergencyTriageModal('${c.id}')">Update Triage</button>
                    <button class="btn btn-outline" style="font-size:11px" onclick="linkEmergencyPatientModal('${c.id}')">Link Permanent Patient</button>
                    <button class="btn btn-outline" style="font-size:11px" onclick="allocateBedModal('EMG-01')">Assign ER Bed</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Emergency Beds & Audit Stream -->
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <h3>ER Bed Status</h3>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
              ${beds.length === 0 ? `<p style="font-size:12px;color:var(--muted)">Loading ER beds...</p>` : beds.map(b => `
                <div style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <strong>Bed ${esc(b.bedId)}</strong>
                    <small style="display:block;color:var(--muted)">${b.currentPatientName ? esc(b.currentPatientName) : 'Unassigned'}</small>
                  </div>
                  <span class="pill ${b.status==='AVAILABLE'?'pill-green':'pill-blue'}">${esc(b.status)}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card">
            <h3>Break-Glass Security Audit Logs</h3>
            <div style="max-height:260px;overflow-y:auto;margin-top:10px">
              ${breakGlassLogs.length === 0 ? `<p style="font-size:12px;color:var(--muted)">No break-glass logs recorded.</p>` : breakGlassLogs.map(l => `
                <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">
                  <strong style="color:#dc2626">🚨 BREAK-GLASS EXCEPTION</strong>
                  <div>User: ${esc(l.userName || l.userId)} | Patient: ${esc(l.patientId)}</div>
                  <small style="color:var(--muted)">Reason: ${esc(l.reason)} (${new Date(l.timestamp).toLocaleTimeString()})</small>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </main>
  `);
}

function openRapidEmergencyModal() {
  const name = prompt("Enter Patient Name (or leave default for UNKNOWN TRAUMA):", "UNKNOWN TRAUMA MALE (Appx 35y)");
  if (name === null) return;
  const triage = prompt("Select Triage Category (RED - Immediate / YELLOW - Urgent / GREEN - Delayed):", "RED");
  const complaint = prompt("Enter Chief Complaint:", "Severe Head & Thoracic Trauma - RTA");
  api("/api/emergency/rapid-register", {
    method: "POST",
    body: JSON.stringify({
      patientName: name || "UNKNOWN TRAUMA MALE (Appx 35y)",
      triageCategory: (triage || "RED").toUpperCase(),
      chiefComplaint: complaint || "Acute trauma / Unresponsive",
      bedId: "EMG-01"
    })
  }).then(res => {
    alert(`✓ Rapid Emergency Registration Complete!\nTemporary MRN: ${res.emergencyCase.mrn}\nTriage Status: ${res.emergencyCase.triageStatus}\nAssigned Bed: EMG-01`);
    renderEmergencyPortal();
  }).catch(showError);
}

function updateEmergencyTriageModal(caseId) {
  const triage = prompt("Update Triage Category (RED / YELLOW / GREEN):", "YELLOW");
  if (!triage) return;
  api("/api/emergency/triage-update", {
    method: "POST",
    body: JSON.stringify({ emergencyCaseId: caseId, triageCategory: triage.toUpperCase() })
  }).then(res => {
    alert("✓ Triage updated to " + triage.toUpperCase());
    renderEmergencyPortal();
  }).catch(showError);
}

function linkEmergencyPatientModal(caseId) {
  const patId = prompt("Enter Registered Patient ID to link (e.g. P-1001):", "P-1001");
  if (!patId) return;
  api("/api/emergency/link-patient", {
    method: "POST",
    body: JSON.stringify({ emergencyCaseId: caseId, permanentPatientId: patId })
  }).then(res => {
    alert("✓ " + res.message);
    renderEmergencyPortal();
  }).catch(showError);
}

async function renderBillingPortal() {
  let invoices = [];
  try {
    const res = await api("/api/invoices");
    invoices = res.invoices || [];
  } catch (err) { console.error(err); }

  const totalInvoiced = invoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0);
  const paidInvoices = invoices.filter(i => i.status === "PAID");
  const paidTotal = paidInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0);
  const unpaidInvoices = invoices.filter(i => i.status === "UNPAID");
  const unpaidTotal = unpaidInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0);

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">💳 BILLING & FINANCIAL MANAGEMENT PORTAL</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Connected Invoicing, Itemized Charges & Transaction Processing</p>
        </div>
      </div>

      <!-- Financial Metric Cards -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:16px;margin-bottom:20px">
        <div class="card" style="border-left:4px solid var(--blue)">
          <small style="color:var(--muted)">TOTAL INVOICED</small>
          <h2 style="margin:4px 0;color:var(--blue-dark)">₹${totalInvoiced}</h2>
          <small style="color:var(--muted)">${invoices.length} Total Invoice Records</small>
        </div>

        <div class="card" style="border-left:4px solid var(--emerald)">
          <small style="color:var(--muted)">COLLECTED REVENUE</small>
          <h2 style="margin:4px 0;color:#15803d">₹${paidTotal}</h2>
          <small style="color:var(--muted)">${paidInvoices.length} Paid Invoices</small>
        </div>

        <div class="card" style="border-left:4px solid var(--red)">
          <small style="color:var(--muted)">OUTSTANDING BALANCES</small>
          <h2 style="margin:4px 0;color:#b91c1c">₹${unpaidTotal}</h2>
          <small style="color:var(--muted)">${unpaidInvoices.length} Unpaid Invoices Pending</small>
        </div>
      </div>

      <!-- Invoices Directory Table -->
      <div class="card">
        <h3>Connected Invoices (${invoices.length})</h3>
        ${invoices.length === 0 ? `
          <div style="text-align:center;padding:32px;background:#f8fafc;border-radius:8px;border:1px dashed var(--border)">
            <strong style="color:var(--muted)">No invoice records found in database.</strong>
            <p style="font-size:13px;color:var(--muted);margin:6px 0 0">Invoices are automatically generated when doctors prescribe medications, order diagnostics, or allocate beds.</p>
          </div>
        ` : `
          <table style="margin-top:12px">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Patient Name</th>
                <th>Subtotal</th>
                <th>Tax (5%)</th>
                <th>Total Amount</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${invoices.map(inv => `
                <tr>
                  <td><strong style="color:var(--blue-dark)">${esc(inv.invoiceNumber || inv.id)}</strong></td>
                  <td><strong>${esc(inv.patientName || 'Patient')}</strong> (${esc(inv.patientId)})</td>
                  <td>₹${inv.subtotal || inv.totalAmount}</td>
                  <td>₹${inv.tax || 0}</td>
                  <td><strong style="font-size:15px;color:var(--ink)">₹${inv.totalAmount}</strong></td>
                  <td>${new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td><span class="pill ${inv.status==='PAID'?'pill-green':'pill-red'}">${esc(inv.status)}</span></td>
                  <td>
                    ${inv.status==='UNPAID' ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="payInvoiceModal('${inv.id}')">Collect Payment</button>` : `<span style="font-size:11px;color:var(--muted)">✓ Paid</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    </main>
  `);
}

async function renderPatientPortal() {
  if (me && me.role === "PATIENT") {
    return renderPatient360View(me.id);
  }

  let patients = [];
  try {
    const res = await api("/api/patients");
    patients = res.patients || [];
  } catch (err) { console.error(err); }

  layout(`
    <main class="page">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="color:var(--blue-dark);margin:0">👤 PATIENT PORTAL & MEDICAL RECORDS LOOKUP</h2>
          <p style="font-size:13px;color:var(--muted);margin-top:2px">Access Patient Longitudinal Records, PATINOTE Summaries, Prescriptions & Bills</p>
        </div>
        <button class="btn btn-primary" onclick="openRegisterPatientModal()">+ Register Patient</button>
      </div>

      <div class="card">
        <h3>Select Patient Record to View Longitudinal 360° Timeline</h3>
        ${patients.length === 0 ? `
          <div style="text-align:center;padding:32px;background:#f8fafc;border-radius:8px;border:1px dashed var(--border)">
            <p style="color:var(--muted)">No registered patients in database.</p>
            <button class="btn btn-primary" style="margin-top:10px" onclick="openRegisterPatientModal()">+ Register First Patient</button>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px;margin-top:14px">
            ${patients.map(p => `
              <div class="card" style="cursor:pointer;border-left:4px solid var(--blue)" onclick="renderPatient360View('${p.id}')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <strong style="font-size:16px;color:var(--blue-dark)">${esc(p.name)}</strong>
                  <span class="pill pill-green">${esc(p.mrn)}</span>
                </div>
                <p style="font-size:12px;color:var(--muted);margin:6px 0 0">
                  Age: ${p.age} | Gender: ${p.gender} | Blood: ${p.bloodGroup}
                </p>
                <small style="color:var(--blue);display:block;margin-top:8px;font-weight:700">Open Patient 360° Portal →</small>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </main>
  `);
}

function renderAccessRestrictedNotice(requestedModuleId, fallbackModuleId) {
  layout(`
    <main class="page" style="max-width:600px;margin:40px auto">
      <div class="card" style="text-align:center;padding:40px;border-top:6px solid #ef4444">
        <div style="font-size:48px;margin-bottom:12px">🚫</div>
        <h2 style="color:#b91c1c;margin:0">Access Restricted</h2>
        <p style="color:var(--muted);margin:10px 0 20px;font-size:14px">
          Your account role (<strong>${esc(me.role)}</strong>) does not have permission to access the <strong>${esc(requestedModuleId.toUpperCase())}</strong> module.
        </p>
        <button class="btn btn-primary" onclick="switchModule('${fallbackModuleId}')">
          Return to ${esc(fallbackModuleId.toUpperCase())} Module
        </button>
      </div>
    </main>
  `);
}

/* ------------------------------------------------------------------ */
/* VISUAL BED MAP & CONCURRENCY-SAFE ALLOCATION                       */
/* ------------------------------------------------------------------ */

function allocateBedModal(bedId) {
  if (dynamicPatientsList.length === 0) {
    alert("No registered patients in database. Register a patient first before allocating a bed.");
    openRegisterPatientModal();
    return;
  }
  const patientId = prompt(`Allocate Bed ${bedId} to Patient ID:`, dynamicPatientsList[0].id);
  if (!patientId) return;

  api(`/api/beds/allocate`, {
    method: "POST",
    body: JSON.stringify({ bedId, patientId, reason: "Inpatient Care & Monitoring" })
  }).then(res => {
    alert(`✓ Bed ${res.bed.bedId} allocated to ${res.bed.currentPatientName}! Bed Status set to OCCUPIED.`);
    boot();
  }).catch(err => {
    alert(`❌ ALLOCATION BLOCKED: ${err.message}`);
  });
}

/* ------------------------------------------------------------------ */
/* PATIENT 360° VIEW & PATINOTE CLINICAL TIMELINE (Section 30)         */
/* ------------------------------------------------------------------ */

async function renderPatient360View(patientId) {
  let data = null, timelineData = [];
  try {
    const [dRes, tRes] = await Promise.all([
      api(`/api/patient/360/${patientId}`),
      api(`/api/patient/timeline?patientId=${patientId}`).catch(() => ({ timeline: [] }))
    ]);
    data = dRes;
    timelineData = tRes.timeline || [];
  } catch (err) { showError(err); return; }

  const p = data.patient;

  layout(`
    <main class="page">
      <section class="card" style="background:linear-gradient(135deg, #ffffff 0%, #f0f7ff 100%);border:1.5px solid #bae6fd;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <h2 style="font-size:26px;color:var(--blue-dark);margin:0">${esc(p.name)}</h2>
              <span class="pill pill-blue">${esc(p.id)}</span>
              <span class="pill pill-green">${esc(p.mrn)}</span>
            </div>
            <p style="font-size:13px;color:var(--muted);margin:6px 0 0">
              Age: <strong>${esc(p.age)}</strong> | Gender: <strong>${esc(p.gender)}</strong> | Blood Group: <strong style="color:red">${esc(p.bloodGroup)}</strong> | Phone: ${esc(p.phone)} | Email: ${esc(p.email)}
            </p>
          </div>
          <button class="btn btn-outline" style="font-size:12px" onclick="speakText('Patient ${p.name}, Age ${p.age}, Blood Group ${p.bloodGroup}. Journey stage: ${data.journeyStage}')">🔊 Read Aloud</button>
        </div>

        ${data.allergies.length > 0 ? `
          <div style="margin-top:12px;padding:10px 14px;background:#fee2e2;border-radius:6px;color:#991b1b;font-size:12px">
            <strong>⚠️ DOCUMENTED CRITICAL ALLERGIES & ALERTS:</strong> ${data.allergies.map(a => `${a.allergen} [${a.reaction || 'Allergy'}]`).join(", ")}
          </div>
        ` : ''}
      </section>

      <!-- Connected Patient Journey Tracker -->
      <div class="journey-tracker">
        <div class="journey-step ${['BOOKED', 'CHECKED_IN', 'DOCTOR_CONSULTATION', 'PHARMACY_PENDING', 'DIAGNOSTICS_PENDING', 'ADMITTED'].includes(data.journeyStage)?'done':''}">
          <div class="journey-step-circle">✓</div>
          <div class="journey-step-label">BOOKED</div>
        </div>
        <div class="journey-step ${['CHECKED_IN', 'DOCTOR_CONSULTATION', 'PHARMACY_PENDING', 'DIAGNOSTICS_PENDING', 'ADMITTED'].includes(data.journeyStage)?'done':''}">
          <div class="journey-step-circle">✓</div>
          <div class="journey-step-label">CHECKED-IN</div>
        </div>
        <div class="journey-step ${['DOCTOR_CONSULTATION', 'PHARMACY_PENDING', 'DIAGNOSTICS_PENDING', 'ADMITTED'].includes(data.journeyStage)?'done':''}">
          <div class="journey-step-circle">✓</div>
          <div class="journey-step-label">DOCTOR</div>
        </div>
        <div class="journey-step ${['PHARMACY_PENDING', 'DIAGNOSTICS_PENDING', 'ADMITTED'].includes(data.journeyStage)?'active':''}">
          <div class="journey-step-circle">💊</div>
          <div class="journey-step-label">PHARMACY</div>
        </div>
        <div class="journey-step ${['DIAGNOSTICS_PENDING', 'ADMITTED'].includes(data.journeyStage)?'active':''}">
          <div class="journey-step-circle">🧪</div>
          <div class="journey-step-label">DIAGNOSTICS</div>
        </div>
        <div class="journey-step ${data.journeyStage==='ADMITTED'?'active':''}">
          <div class="journey-step-circle">🛏</div>
          <div class="journey-step-label">ADMISSION</div>
        </div>
      </div>

      <!-- COMPLETE 11-STAGE LONGITUDINAL TIMELINE -->
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;color:var(--blue-dark)">⏱️ 11-Stage Longitudinal Patient Event Timeline (${timelineData.length} Events)</h3>
          <span class="pill pill-blue">Real-Time Database Records</span>
        </div>
        ${timelineData.length === 0 ? `
          <p style="font-size:13px;color:var(--muted);margin-top:10px">No historical events recorded for this patient.</p>
        ` : `
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
            ${timelineData.map(ev => `
              <div style="padding:12px 16px;border-left:4px solid ${
                ev.type.includes('DISCHARGE') ? '#10b981' :
                ev.type.includes('ADMISSION') ? '#6366f1' :
                ev.type.includes('PRESCRIPTION') || ev.type.includes('PHARMACY') ? '#f59e0b' :
                ev.type.includes('LAB') || ev.type.includes('SCAN') ? '#0284c7' :
                ev.type.includes('PATINOTE') ? '#8b5cf6' :
                ev.type.includes('BILLING') ? '#ec4899' : '#64748b'
              };background:#f8fafc;border-radius:0 8px 8px 0;border:1px solid #e2e8f0;border-left-width:4px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <strong style="font-size:14px;color:var(--blue-dark)">${esc(ev.title)}</strong>
                  <span class="pill" style="font-size:10px">${esc(ev.type)} | ${new Date(ev.date).toLocaleDateString()}</span>
                </div>
                <p style="margin:4px 0 0;font-size:12px;color:var(--muted)">${esc(ev.summary)}</p>
              </div>
            `).join("")}
          </div>
        `}
      </div>

      <!-- PATINOTE CLINICAL ENCOUNTERS TIMELINE -->
      <div class="card" style="margin-bottom:20px">
        <h3>PATINOTE Clinical Case Sheets (${data.caseSheets ? data.caseSheets.length : 0})</h3>
        ${!data.caseSheets || data.caseSheets.length === 0 ? `
          <p style="font-size:13px;color:var(--muted)">No PATINOTE case sheets recorded for this patient yet.</p>
        ` : data.caseSheets.map(cs => `
          <div style="padding:16px;border:1px solid var(--border);border-radius:10px;margin-top:10px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between">
              <strong style="color:var(--blue-dark);font-size:16px">PATINOTE Case Sheet #${esc(cs.id)} by ${esc(cs.doctorName)}</strong>
              <span class="pill pill-green">${esc(cs.status || 'FINALIZED')} (${new Date(cs.createdAt).toLocaleDateString()})</span>
            </div>
            <p style="margin:6px 0 2px;font-size:13px"><strong>Chief Complaints:</strong> ${Array.isArray(cs.chiefComplaints) ? cs.chiefComplaints.map(c => c.complaint + ' (' + c.duration + ')').join(", ") : esc(cs.chiefComplaint)}</p>
            <p style="margin:2px 0;font-size:13px"><strong>Diagnosis:</strong> ${esc(cs.clinicalAssessment?.finalDiagnosis || cs.sectionL_Diagnosis?.provisionalDiagnosis)}</p>
            <p style="margin:2px 0;font-size:13px"><strong>Vitals:</strong> BP: ${cs.vitals?.sysBp}/${cs.vitals?.diaBp} | Pulse: ${cs.vitals?.pulse || cs.vitals?.heartRate} | Temp: ${cs.vitals?.temp}°F | SpO2: ${cs.vitals?.spO2}%</p>
            ${cs.signedByDoctor ? `<small style="color:var(--muted);display:block;margin-top:4px">✓ Signed by ${esc(cs.signedByDoctor)} at ${new Date(cs.signedAt).toLocaleTimeString()}</small>` : ''}
          </div>
        `).join("")}
      </div>

      <!-- DIAGNOSTICS: LAB & SCAN REPORTS -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card">
          <h3>Laboratory Test Reports (${(data.labOrders || []).length})</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            ${(!data.labOrders || data.labOrders.length === 0) ? `<p style="font-size:13px;color:var(--muted)">No laboratory orders.</p>` : data.labOrders.map(l => `
              <div style="padding:10px;border:1px solid var(--border);border-radius:8px">
                <div style="display:flex;justify-content:space-between">
                  <strong>🧪 ${esc(l.testName)}</strong>
                  <span class="pill ${l.status==='PUBLISHED'?'pill-green':'pill-yellow'}">${esc(l.status)}</span>
                </div>
                ${l.result ? `<div style="margin-top:4px;font-size:12px;color:#15803d"><strong>Result:</strong> ${esc(l.result)} ${l.isAbnormal ? '<span class="pill pill-red">ABNORMAL</span>' : ''}</div>` : ''}
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <h3>Radiology & Imaging Reports (${(data.scanOrders || []).length})</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            ${(!data.scanOrders || data.scanOrders.length === 0) ? `<p style="font-size:13px;color:var(--muted)">No imaging scans ordered.</p>` : data.scanOrders.map(s => `
              <div style="padding:10px;border:1px solid var(--border);border-radius:8px">
                <div style="display:flex;justify-content:space-between">
                  <strong>📻 ${esc(s.scanType)}</strong>
                  <span class="pill ${s.status==='PUBLISHED'?'pill-green':'pill-yellow'}">${esc(s.status)}</span>
                </div>
                ${s.reportText || s.findings ? `<div style="margin-top:4px;font-size:12px;color:var(--muted)"><strong>Findings:</strong> ${esc(s.reportText || s.findings)}</div>` : ''}
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card">
          <h3>Prescriptions & Active Medications</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            ${data.prescriptions.length === 0 ? `<p style="font-size:13px;color:var(--muted)">No active prescriptions.</p>` : data.prescriptions.map(rx => `
              <div style="padding:10px;border:1px solid var(--border);border-radius:8px">
                <div style="display:flex;justify-content:space-between">
                  <strong>💊 ${esc(rx.medicationName)}</strong>
                  <span class="pill ${rx.dispensedStatus==='DISPENSED'?'pill-green':'pill-yellow'}">${esc(rx.dispensedStatus)}</span>
                </div>
                <small style="color:var(--muted)">Dosage: ${esc(rx.dosage)} | Price: ₹${rx.totalPrice || 250}</small>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <h3>Connected Invoices & Billing History</h3>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            ${data.invoices.length === 0 ? `<p style="font-size:13px;color:var(--muted)">No invoice records found.</p>` : data.invoices.map(inv => `
              <div style="padding:10px;border:1px solid var(--border);border-radius:8px">
                <div style="display:flex;justify-content:space-between">
                  <strong>🧾 Invoice #${esc(inv.invoiceNumber || inv.id)}</strong>
                  <span class="pill ${inv.status==='PAID'?'pill-green':'pill-red'}">${esc(inv.status)}</span>
                </div>
                <small style="color:var(--muted)">Total Amount: <strong>₹${inv.totalAmount}</strong> | Date: ${new Date(inv.createdAt).toLocaleDateString()}</small>
                ${inv.status==='UNPAID' ? `<button class="btn btn-secondary" style="font-size:10px;margin-top:6px;padding:3px 8px" onclick="payInvoiceModal('${inv.id}')">Pay Invoice</button>` : ''}
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </main>
  `);
}

async function payInvoiceModal(invoiceId) {
  try {
    const res = await api(`/api/billing/pay`, { method: "POST", body: JSON.stringify({ invoiceId, paymentMethod: "Credit Card" }) });
    alert(`✓ Payment of ₹${res.invoice.totalAmount} received! Invoice status set to PAID.`);
    boot();
  } catch (err) { showError(err); }
}

/* ------------------------------------------------------------------ */
/* EASY MODE (Elderly-Friendly Accessible View)                    */
/* ------------------------------------------------------------------ */

async function renderElderlyEasyModeView() {
  let data = null;
  try {
    data = await api(`/api/patient/360/${me.id}`);
  } catch (err) { console.error(err); }

  const pendingRx = data?.prescriptions.find(p => p.dispensedStatus !== "DISPENSED");

  layout(`
    <main class="page" style="max-width:800px;margin:0 auto">
      <div class="card" style="text-align:center;padding:32px;border:4px solid #000;background:#fffbeb;margin-bottom:20px">
        <h1 style="font-size:32px;margin-bottom:8px">👓 WELCOME, ${esc(me.name).toUpperCase()}</h1>
        <p style="font-size:20px;color:#000">MEDI CORE EASY ELDERLY PORTAL</p>
        <button class="btn btn-primary" style="font-size:20px;padding:16px 32px" onclick="speakText('Welcome ${me.name}. Your active medicine status is: ${pendingRx ? pendingRx.medicationName + ' is ' + pendingRx.dispensedStatus : 'No pending medicines'}.')">
          🔊 READ MY HEALTH STATUS OUT LOUD
        </button>
      </div>

      <div class="card" style="border:4px solid #000;margin-bottom:20px">
        <h2 style="font-size:26px">💊 YOUR MEDICINE STATUS</h2>
        ${pendingRx ? `
          <div style="background:#dcfce7;padding:20px;border-radius:12px;border:3px solid #16a34a;margin-top:12px">
            <h2 style="color:#15803d;margin:0">YOUR MEDICINES ARE READY</h2>
            <p style="font-size:20px;margin:8px 0"><strong>${esc(pendingRx.medicationName)}</strong> (${esc(pendingRx.dosage)})</p>
            <p style="font-size:18px;margin:0">Collect them at Pharmacy Counter #2.</p>
          </div>
        ` : `
          <p style="font-size:20px">No pending medicines. All prescribed medications have been dispensed.</p>
        `}
      </div>
    </main>
  `);
}

function initSplashScreen() {
  const splash = document.getElementById("splashScreen");
  if (splash) {
    setTimeout(() => {
      splash.classList.add("fade-out");
      setTimeout(() => {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 600);
    }, 2000);
  }
}

initSplashScreen();
boot();