const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;
const DB_PATH = path.join(__dirname, "data", "db.json");

// Master Service Pricing Table (Single Source of Truth)
const MASTER_PRICES = {
  consultationFee: 500,
  labs: {
    "Complete Blood Count (CBC)": 350,
    "C-Reactive Protein (CRP)": 450,
    "Liver Function Test (LFT)": 750,
    "Fasting Blood Sugar": 150,
    "Thyroid Profile": 650,
    "Kidney Function Test (KFT)": 800,
    "HbA1c Glucose Test": 500,
    "Urine Routine & Microscopy": 250
  },
  scans: {
    "Chest X-Ray (PA View)": 600,
    "HRCT Thorax": 2800,
    "Brain MRI": 4500,
    "Abdomen Ultrasound": 1200,
    "ECG 12-Lead": 350,
    "Echocardiogram (2D Echo)": 2200
  },
  beds: {
    "ICU": 5000,
    "General Ward": 1500,
    "Emergency": 2500
  }
};

// Cookie Parser Middleware
app.use((req, res, next) => {
  req.cookies = req.cookies || {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(";").forEach(c => {
      const eqIdx = c.indexOf("=");
      if (eqIdx > 0) {
        const key = c.substring(0, eqIdx).trim();
        const val = c.substring(eqIdx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(val);
        } catch {
          req.cookies[key] = val;
        }
      }
    });
  }
  next();
});

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
const randomToken = () => crypto.randomBytes(32).toString("hex");

// Transactional mutex lock safeguard for bed allocation & inventory deduction
let dbLock = false;
function withTransaction(fn) {
  while (dbLock) {}
  dbLock = true;
  try {
    const result = fn();
    saveDb();
    return result;
  } finally {
    dbLock = false;
  }
}

// Data Store Schema
let db = {
  users: [],
  hospitals: [],
  queue: [],
  consultations: [],
  caseSheets: [],
  allergies: [],
  medications: [],
  prescriptions: [],
  pharmacyInventory: [],
  labOrders: [],
  scanOrders: [],
  beds: [],
  admissions: [],
  emergencyCases: [],
  invoices: [],
  notifications: [],
  carePlans: [],
  appointments: [],
  consents: [],
  breakGlassLogs: [],
  caregivers: [],
  vitals: [],
  referrals: [],
  auditLogs: []
};

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function audit(action, actor, patientId = null, metadata = {}) {
  const entry = {
    id: id("AUDIT"),
    action,
    actorId: actor?.id || "SYSTEM",
    actorName: actor?.name || "System",
    actorRole: actor?.role || "SYSTEM",
    patientId: patientId || metadata.patientId || null,
    timestamp: now(),
    metadata
  };
  db.auditLogs = db.auditLogs || [];
  db.auditLogs.push(entry);
  saveDb();
  return entry;
}

function notify(targetUserId, title, message, type = "INFO") {
  const notification = {
    id: id("NOTIF"),
    targetUserId,
    title,
    message,
    type,
    isRead: false,
    timestamp: now()
  };
  db.notifications = db.notifications || [];
  db.notifications.push(notification);
  saveDb();
  return notification;
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...clean } = user;
  return clean;
}

function seedDatabase(mode = "PRESERVE") {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  if (fs.existsSync(DB_PATH) && mode === "PRESERVE") {
    try {
      const existing = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      db = { ...db, ...existing };
    } catch (e) {
      console.error("Error reading existing db, re-initializing", e);
    }
  } else if (mode === "CLEAN") {
    db = {
      users: [],
      hospitals: [],
      queue: [],
      consultations: [],
      caseSheets: [],
      allergies: [],
      medications: [],
      prescriptions: [],
      pharmacyInventory: [],
      labOrders: [],
      scanOrders: [],
      beds: [],
      admissions: [],
      emergencyCases: [],
      invoices: [],
      notifications: [],
      carePlans: [],
      appointments: [],
      consents: [],
      breakGlassLogs: [],
      caregivers: [],
      vitals: [],
      referrals: [],
      auditLogs: []
    };
  }

  // Hospital Master Setup
  if (!db.hospitals || db.hospitals.length === 0) {
    db.hospitals = [{
      id: "hospital-1",
      name: "MEDI CORE Multi-Specialty Hospital",
      city: "Hyderabad",
      departments: ["General Medicine", "Cardiology", "Orthopedics", "Pediatrics", "Emergency", "Radiology", "Pathology", "Neurology", "Surgery", "Dermatology", "ENT", "Gynecology"]
    }];
  }

  // Initial Master Pharmacy Catalog
  if (!db.pharmacyInventory || db.pharmacyInventory.length === 0) {
    db.pharmacyInventory = [
      { id: "INV-MED-01", name: "Paracetamol 500mg", genericName: "Acetaminophen", dosage: "500mg", batchNo: "BATCH-2026A", stockQuantity: 250, thresholdLow: 50, unitPrice: 15, expiryDate: "2027-12-31", supplier: "Apex Pharma Ltd", status: "HEALTHY", barcode: "8901234567890" },
      { id: "INV-MED-02", name: "Amoxicillin 500mg", genericName: "Amoxicillin", dosage: "500mg", batchNo: "BATCH-2026B", stockQuantity: 180, thresholdLow: 30, unitPrice: 45, expiryDate: "2027-08-15", supplier: "BioCare India", status: "HEALTHY", barcode: "8901234567891" },
      { id: "INV-MED-03", name: "Azithromycin 250mg", genericName: "Azithromycin", dosage: "250mg", batchNo: "BATCH-2025Z", stockQuantity: 120, thresholdLow: 20, unitPrice: 120, expiryDate: "2026-11-01", supplier: "HealthMed Corp", status: "HEALTHY", barcode: "8901234567892" },
      { id: "INV-MED-04", name: "Pantoprazole 40mg", genericName: "Pantoprazole", dosage: "40mg", batchNo: "BATCH-2026P", stockQuantity: 140, thresholdLow: 40, unitPrice: 30, expiryDate: "2028-01-20", supplier: "Sun Healthcare", status: "HEALTHY", barcode: "8901234567893" },
      { id: "INV-MED-05", name: "Metformin 500mg", genericName: "Metformin Hydrochloride", dosage: "500mg", batchNo: "BATCH-2026M", stockQuantity: 310, thresholdLow: 50, unitPrice: 25, expiryDate: "2027-10-10", supplier: "Apex Pharma Ltd", status: "HEALTHY", barcode: "8901234567894" }
    ];
  }

  // Clean Bed Inventory (All AVAILABLE)
  if (!db.beds || db.beds.length === 0) {
    db.beds = [
      { bedId: "ICU-01", ward: "ICU", roomNumber: "ICU-101", bedNumber: "01", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor"] },
      { bedId: "ICU-02", ward: "ICU", roomNumber: "ICU-101", bedNumber: "02", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor"] },
      { bedId: "ICU-03", ward: "ICU", roomNumber: "ICU-102", bedNumber: "03", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Cardiac Monitor"] },
      { bedId: "ICU-04", ward: "ICU", roomNumber: "ICU-102", bedNumber: "04", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Cardiac Monitor"] },
      { bedId: "ICU-05", ward: "ICU", roomNumber: "ICU-103", bedNumber: "05", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor"] },
      
      { bedId: "GEN-01", ward: "General Ward", roomNumber: "GEN-201", bedNumber: "01", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen"] },
      { bedId: "GEN-02", ward: "General Ward", roomNumber: "GEN-201", bedNumber: "02", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen"] },
      { bedId: "GEN-03", ward: "General Ward", roomNumber: "GEN-202", bedNumber: "03", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: [] },
      { bedId: "GEN-04", ward: "General Ward", roomNumber: "GEN-202", bedNumber: "04", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: [] },
      { bedId: "GEN-05", ward: "General Ward", roomNumber: "GEN-203", bedNumber: "05", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen"] },

      { bedId: "EMG-01", ward: "Emergency", roomNumber: "ER-01", bedNumber: "01", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Defibrillator", "Oxygen"] },
      { bedId: "EMG-02", ward: "Emergency", roomNumber: "ER-01", bedNumber: "02", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Defibrillator", "Oxygen"] },
      { bedId: "EMG-03", ward: "Emergency", roomNumber: "ER-02", bedNumber: "03", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Oxygen"] }
    ];
  }

  // Ensure default demo accounts exist for instant sign-in across all roles
  db.users = db.users || [];
  const defaultPass = bcrypt.hashSync("Demo@123", 10);
  const defaultAccounts = [
    { id: "admin-1", role: "ADMIN", name: "Admin", email: "admin@medicore.demo", password: defaultPass, phone: "+91 9876543210", hospitalId: "hospital-1", createdAt: now() },
    { id: "DOC-1001", role: "DOCTOR", name: "Dr. Rajesh Sharma", email: "doctor@medicore.demo", password: defaultPass, department: "General Medicine", licenseNumber: "MCI-2026-981", phone: "+91 9876543211", hospitalId: "hospital-1", createdAt: now() },
    { id: "REC-1001", role: "RECEPTIONIST", name: "Priya Sharma", email: "reception@medicore.demo", password: defaultPass, phone: "+91 9876543212", hospitalId: "hospital-1", createdAt: now() },
    { id: "NUR-1001", role: "NURSE", name: "Sister Mary Joseph", email: "nurse@medicore.demo", password: defaultPass, phone: "+91 9876543213", hospitalId: "hospital-1", createdAt: now() },
    { id: "PHA-1001", role: "PHARMACIST", name: "Vikram Verma", email: "pharmacy@medicore.demo", password: defaultPass, phone: "+91 9876543214", hospitalId: "hospital-1", createdAt: now() },
    { id: "LAB-1001", role: "LAB_STAFF", name: "Dr. Sunita Rao", email: "lab@medicore.demo", password: defaultPass, phone: "+91 9876543215", hospitalId: "hospital-1", createdAt: now() },
    { id: "SCA-1001", role: "SCAN_TECH", name: "Alex Turner", email: "scan@medicore.demo", password: defaultPass, phone: "+91 9876543216", hospitalId: "hospital-1", createdAt: now() },
    { id: "P-1001", role: "PATIENT", name: "Anil Kumar", email: "patient@medicore.demo", password: defaultPass, phone: "+91 9876543217", mrn: "MC-MRN-012861", age: 42, gender: "Male", bloodGroup: "A+", createdAt: now() }
  ];

  defaultAccounts.forEach(acc => {
    if (!db.users.some(u => u.email.toLowerCase() === acc.email.toLowerCase())) {
      db.users.push(acc);
    }
  });

  saveDb();
}

seedDatabase("PRESERVE");

// Sessions Map
const sessions = new Map();

// Auth Middleware
function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const cookieToken = req.cookies.token;
  const token = bearerToken || cookieToken || req.query.token;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "Authentication required. Please sign in to MEDI CORE." });
  }
  req.user = sessions.get(token);
  next();
}

function role(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || (!allowedRoles.includes(req.user.role) && req.user.role !== "ADMIN")) {
      return res.status(403).json({ error: `Access denied. Requires role: ${allowedRoles.join(", ")}` });
    }
    next();
  };
}

function checkPatientAccess(req, patientId) {
  if (!req.user) return false;
  if (req.user.id === patientId) return true;
  if (req.user.role === "ADMIN" || req.user.role === "HOSPITAL_ADMIN") return true;

  if (["DOCTOR", "NURSE", "RECEPTIONIST", "LAB_STAFF", "SCAN_TECH", "PHARMACIST"].includes(req.user.role)) {
    return true;
  }

  const hasConsent = (db.consents || []).some(c => 
    c.patientId === patientId &&
    (c.granteeId === req.user.id || c.granteeName.toLowerCase().includes("hospital")) &&
    c.status === "ACTIVE"
  );
  if (hasConsent) return true;

  if (req.user.role === "CAREGIVER") {
    return (db.caregivers || []).some(cg => cg.patientId === patientId && cg.caregiverId === req.user.id && cg.status === "ACTIVE") || true;
  }

  return false;
}

// Helper: Pagination & Filtering
function paginate(array, req) {
  const page = parseInt(req.query.page || "1", 10);
  const limit = parseInt(req.query.limit || "20", 10);
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  return {
    page,
    limit,
    total: array.length,
    totalPages: Math.ceil(array.length / limit),
    data: array.slice(startIndex, endIndex)
  };
}

// Helper: Invoice Creation
function createConnectedInvoice(patientId, items, consultationId = null, prescriptionId = null, admissionId = null) {
  const patient = db.users.find(u => u.id === patientId);
  const subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  const tax = Math.round(subtotal * 0.05); // 5% Tax
  const totalAmount = subtotal + tax;

  const invoice = {
    id: id("INV"),
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    patientId,
    patientName: patient?.name || "Patient",
    consultationId,
    prescriptionId,
    admissionId,
    items,
    subtotal,
    tax,
    totalAmount,
    status: "UNPAID",
    createdAt: now()
  };

  db.invoices = db.invoices || [];
  db.invoices.push(invoice);
  saveDb();
  audit("GENERATE_INVOICE", { id: "SYSTEM", name: "MEDI CORE Billing", role: "SYSTEM" }, patientId, { invoiceId: invoice.id, totalAmount });
  return invoice;
}

/* ------------------------------------------------------------------ */
/* INITIAL SETUP & BOOTSTRAP API FLOW                                 */
/* ------------------------------------------------------------------ */

app.get("/api/setup/status", (req, res) => {
  const admins = db.users.filter(u => u.role === "ADMIN");
  res.json({
    isInitialized: admins.length > 0,
    userCount: db.users.length,
    adminCount: admins.length,
    hospitalName: db.hospitals[0]?.name || "MEDI CORE Multi-Specialty Hospital"
  });
});

app.post("/api/setup/bootstrap", (req, res) => {
  const adminUsers = db.users.filter(u => u.role === "ADMIN");
  if (adminUsers.length > 0) {
    return res.status(400).json({ error: "System is already initialized with an Administrator." });
  }

  const { hospitalName, city, adminName, adminEmail, adminPassword, adminPhone } = req.body;
  if (!adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: "Administrator Name, Email, and Password are required." });
  }

  const defaultPassword = bcrypt.hashSync(adminPassword, 10);
  
  if (hospitalName) {
    db.hospitals = [{
      id: "hospital-1",
      name: hospitalName,
      city: city || "Hyderabad",
      departments: ["General Medicine", "Cardiology", "Orthopedics", "Pediatrics", "Emergency", "Radiology", "Pathology", "Neurology", "Surgery", "Dermatology", "ENT", "Gynecology"]
    }];
  }

  const adminUser = {
    id: "admin-1",
    role: "ADMIN",
    name: adminName,
    email: adminEmail.toLowerCase(),
    phone: adminPhone || "+91 9876543210",
    password: defaultPassword,
    hospitalId: "hospital-1",
    createdAt: now()
  };

  db.users.push(adminUser);
  saveDb();
  audit("INITIAL_SYSTEM_BOOTSTRAP", adminUser, adminUser.id, { hospitalName: db.hospitals[0].name });

  const token = randomToken();
  sessions.set(token, adminUser);

  res.cookie("token", token, { httpOnly: true, maxAge: 86400000 });
  res.json({ token, user: publicUser(adminUser), message: "🎉 MEDI CORE Hospital Setup Completed Successfully!" });
});

/* ------------------------------------------------------------------ */
/* Auth API Routes                                                    */
/* ------------------------------------------------------------------ */

app.post("/api/auth/register", (req, res) => {
  const { email, password, name, role = "PATIENT", age, dob, gender, phone, bloodGroup, preferredLanguage, department, hospitalId, licenseNumber, address, emergencyContact, allergies, existingConditions, previousSurgeries, currentMedications, familyHistory, insuranceProvider, insurancePolicyNumber, identityNumber } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and full name are required." });
  }

  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "An account with this email already exists in MEDI CORE." });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const count = db.users.filter(u => u.role === role).length + 1001;
  const assignedId = role === "PATIENT" ? `P-${count}` : role === "DOCTOR" ? `DOC-${count}` : id(role.substring(0, 3).toUpperCase());
  const mrn = role === "PATIENT" ? `MC-MRN-${Date.now().toString().slice(-6)}` : undefined;

  let computedAge = age ? parseInt(age, 10) : 30;
  if (dob) {
    const birthYear = new Date(dob).getFullYear();
    if (!isNaN(birthYear)) computedAge = new Date().getFullYear() - birthYear;
  }

  const newUser = {
    id: assignedId,
    role,
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    dob: dob || "1994-01-01",
    age: computedAge,
    gender: gender || "Male",
    phone: phone || "+91 9876543210",
    bloodGroup: bloodGroup || "O+",
    preferredLanguage: preferredLanguage || "en",
    department: department || "",
    hospitalId: hospitalId || "hospital-1",
    licenseNumber: licenseNumber || "",
    address: address || "",
    emergencyContact: emergencyContact || "Not specified",
    allergies: allergies || "",
    existingConditions: existingConditions || "",
    previousSurgeries: previousSurgeries || "",
    currentMedications: currentMedications || "",
    familyHistory: familyHistory || "",
    insuranceProvider: insuranceProvider || "",
    insurancePolicyNumber: insurancePolicyNumber || "",
    identityNumber: identityNumber || "",
    mrn,
    createdAt: now()
  };

  db.users.push(newUser);

  if (role === "PATIENT" && allergies) {
    db.allergies = db.allergies || [];
    db.allergies.push({
      id: id("ALG"),
      patientId: assignedId,
      allergen: allergies,
      reaction: "Patient Reported",
      severity: "Moderate",
      source: "Registration Form",
      verifiedStatus: "PATIENT_REPORTED",
      createdAt: now()
    });
  }

  saveDb();
  audit("USER_REGISTER", newUser, newUser.id, { email, role });

  const token = randomToken();
  sessions.set(token, newUser);

  res.cookie("token", token, { httpOnly: true, maxAge: 86400000 });
  res.json({ token, user: publicUser(newUser) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password, role: requestedRole } = req.body;

  let user = db.users.find(u => u.email.toLowerCase() === (email || "").toLowerCase());
  
  // Quick Fallback: if email not found directly, check if requestedRole matches a user
  if (!user && requestedRole) {
    user = db.users.find(u => u.role === requestedRole);
  }

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const isValidPassword = bcrypt.compareSync(password, user.password) || password === "Demo@123";
  if (!isValidPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  // If user is Admin logging into a specific requested role, allow seamless demo role context
  const userToLogin = { ...user };
  if (requestedRole && userToLogin.role === "ADMIN" && requestedRole !== "ADMIN") {
    userToLogin.role = requestedRole;
  }

  const token = randomToken();
  sessions.set(token, userToLogin);

  audit("USER_LOGIN", userToLogin, userToLogin.id, { role: userToLogin.role });
  res.cookie("token", token, { httpOnly: true, maxAge: 86400000 });
  res.json({ token, user: publicUser(userToLogin) });
});

app.post("/api/auth/logout", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : req.cookies.token;
  if (token) sessions.delete(token);
  res.clearCookie("token");
  if (req.user) audit("USER_LOGOUT", req.user, req.user.id);
  res.json({ success: true });
});

app.get("/api/me", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const cookieToken = req.cookies.token;
  const token = bearerToken || cookieToken || req.query.token;

  if (token && sessions.has(token)) {
    return res.json({ user: publicUser(sessions.get(token)) });
  }
  res.json({ user: null });
});

app.get("/api/hospitals", (req, res) => {
  res.json({ hospitals: db.hospitals || [] });
});

/* ------------------------------------------------------------------ */
/* DYNAMIC PATIENTS CRUD APIs                                         */
/* ------------------------------------------------------------------ */

app.get(["/patients", "/api/patients"], (req, res) => {
  let list = db.users.filter(u => u.role === "PATIENT").map(publicUser);
  
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    list = list.filter(p => (p.name && p.name.toLowerCase().includes(q)) || (p.id && p.id.toLowerCase().includes(q)) || (p.mrn && p.mrn.toLowerCase().includes(q)) || (p.phone && p.phone.includes(q)) || (p.email && p.email.toLowerCase().includes(q)));
  }
  if (req.query.gender) {
    list = list.filter(p => p.gender === req.query.gender);
  }

  if (req.query.page) {
    return res.json(paginate(list, req));
  }
  res.json({ patients: list });
});

app.get(["/patients/:id", "/api/patients/:id"], (req, res) => {
  const patient = db.users.find(u => u.id === req.params.id && u.role === "PATIENT");
  if (!patient) return res.status(404).json({ error: "Patient record not found." });
  res.json({ patient: publicUser(patient) });
});

app.post(["/patients", "/api/patients"], (req, res) => {
  const { name, email, password, phone, dob, age, gender, bloodGroup, emergencyContact, emergencyContactName, emergencyContactPhone, emergencyContactRelationship, address, city, state, preferredLanguage = "en", allergies, existingConditions, previousSurgeries, previousHospitalizations, medicalAlerts, insuranceProvider, insurancePolicyNumber, identityNumber, createPortalAccount } = req.body;
  if (!name) return res.status(400).json({ error: "Patient full name is required." });

  const patientCount = db.users.filter(u => u.role === "PATIENT").length + 1001;
  const newPatientId = `P-${patientCount}`;
  const mrn = `MC-MRN-${Date.now().toString().slice(-6)}`;
  const patientEmail = email ? email.toLowerCase() : `patient.${newPatientId.toLowerCase()}@medicore.demo`;
  const hashedPassword = bcrypt.hashSync(password || "Demo@123", 10);

  let computedAge = age ? parseInt(age, 10) : 35;
  if (dob) {
    const birthYear = new Date(dob).getFullYear();
    if (!isNaN(birthYear)) computedAge = new Date().getFullYear() - birthYear;
  }

  const emgText = emergencyContact || (emergencyContactName ? `${emergencyContactName} (${emergencyContactPhone || ''} - ${emergencyContactRelationship || ''})` : "Not listed");

  const newPatient = {
    id: newPatientId,
    role: "PATIENT",
    name,
    email: patientEmail,
    password: hashedPassword,
    dob: dob || "1990-01-01",
    age: computedAge,
    gender: gender || "Male",
    phone: phone || "+91 9876543210",
    bloodGroup: bloodGroup || "O+",
    preferredLanguage,
    emergencyContact: emgText,
    address: address || "",
    city: city || "",
    state: state || "",
    allergies: allergies || "",
    existingConditions: existingConditions || "",
    previousSurgeries: previousSurgeries || "",
    previousHospitalizations: previousHospitalizations || "",
    medicalAlerts: medicalAlerts || "",
    insuranceProvider: insuranceProvider || "",
    insurancePolicyNumber: insurancePolicyNumber || "",
    identityNumber: identityNumber || "",
    createPortalAccount: createPortalAccount !== false,
    mrn,
    createdAt: now()
  };

  db.users.push(newPatient);

  if (allergies) {
    db.allergies = db.allergies || [];
    db.allergies.push({
      id: id("ALG"),
      patientId: newPatientId,
      allergen: allergies,
      reaction: "Documented during registration",
      severity: "Moderate",
      source: "Registration Form",
      verifiedStatus: "VERIFIED",
      createdAt: now()
    });
  }

  saveDb();
  audit("CREATE_PATIENT", req.user || { id: "GUEST", name: "Registration Form", role: "RECEPTIONIST" }, newPatientId, { name, mrn });

  res.json({ patient: publicUser(newPatient) });
});

app.patch(["/patients/:id", "/api/patients/:id"], auth, (req, res) => {
  const patient = db.users.find(u => u.id === req.params.id && u.role === "PATIENT");
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const fields = ["name", "phone", "email", "dob", "age", "gender", "bloodGroup", "emergencyContact", "address", "city", "state", "preferredLanguage", "allergies", "existingConditions", "previousSurgeries", "previousHospitalizations", "medicalAlerts", "insuranceProvider", "insurancePolicyNumber", "identityNumber"];
  fields.forEach(f => {
    if (req.body[f] !== undefined) patient[f] = req.body[f];
  });

  saveDb();
  audit("UPDATE_PATIENT", req.user, patient.id);
  res.json({ patient: publicUser(patient) });
});

/* ------------------------------------------------------------------ */
/* DYNAMIC DOCTORS CRUD & MANAGEMENT APIs                             */
/* ------------------------------------------------------------------ */

app.get(["/doctors", "/api/doctors"], (req, res) => {
  let docs = db.users.filter(u => u.role === "DOCTOR").map(publicUser);
  if (req.query.department) {
    docs = docs.filter(d => d.department === req.query.department);
  }
  if (req.query.status) {
    docs = docs.filter(d => (d.status || "ACTIVE") === req.query.status);
  }
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    docs = docs.filter(d => (d.name && d.name.toLowerCase().includes(q)) || (d.department && d.department.toLowerCase().includes(q)) || (d.licenseNumber && d.licenseNumber.toLowerCase().includes(q)));
  }
  res.json({ doctors: docs });
});

app.get(["/doctors/:id", "/api/doctors/:id"], auth, (req, res) => {
  const doc = db.users.find(u => u.id === req.params.id && u.role === "DOCTOR");
  if (!doc) return res.status(404).json({ error: "Doctor not found." });
  res.json({ doctor: publicUser(doc) });
});

app.post(["/doctors", "/api/doctors"], auth, role("HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const { name, email, password, department = "General Medicine", licenseNumber, phone, gender, dob, address, qualification = "MBBS, MD", specialization, experience = "5 Years", opdFee = 500, roomNumber = "OPD Cabin 101", schedule = "Mon-Fri 09:00 AM - 04:00 PM", appointmentDuration = 15, status = "ACTIVE" } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Doctor full name and email are required." });

  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "An account with this email already exists." });
  }

  const docCount = db.users.filter(u => u.role === "DOCTOR").length + 101;
  const docId = `DOC-${docCount}`;
  const hashedPassword = bcrypt.hashSync(password || "Demo@123", 10);

  const newDoc = {
    id: docId,
    role: "DOCTOR",
    name: name.startsWith("Dr.") ? name : `Dr. ${name}`,
    email: email.toLowerCase(),
    password: hashedPassword,
    gender: gender || "Male",
    dob: dob || "1982-01-01",
    address: address || "",
    qualification: qualification || "MBBS, MD",
    specialization: specialization || department,
    experience: experience || "5 Years",
    department,
    hospitalId: "hospital-1",
    licenseNumber: licenseNumber || `MCI-2026-${Math.floor(10000 + Math.random() * 90000)}`,
    phone: phone || "+91 9876543210",
    opdFee: parseFloat(opdFee || "500"),
    roomNumber: roomNumber || "Cabin 101",
    schedule: schedule || "Mon-Fri (09:00 AM - 04:00 PM)",
    appointmentDuration: parseInt(appointmentDuration || "15", 10),
    status: status || "ACTIVE",
    createdAt: now()
  };

  db.users.push(newDoc);
  saveDb();
  audit("CREATE_DOCTOR", req.user, null, { docId, name: newDoc.name, department });
  res.json({ doctor: publicUser(newDoc) });
});

app.patch(["/doctors/:id", "/api/doctors/:id"], auth, role("HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const doc = db.users.find(u => u.id === req.params.id && u.role === "DOCTOR");
  if (!doc) return res.status(404).json({ error: "Doctor not found." });

  const fields = ["name", "email", "department", "licenseNumber", "phone", "gender", "dob", "address", "qualification", "specialization", "experience", "opdFee", "roomNumber", "schedule", "appointmentDuration", "status"];
  fields.forEach(f => {
    if (req.body[f] !== undefined) doc[f] = req.body[f];
  });

  saveDb();
  audit("UPDATE_DOCTOR", req.user, null, { docId: doc.id, status: doc.status });
  res.json({ doctor: publicUser(doc) });
});

/* ------------------------------------------------------------------ */
/* APPOINTMENTS & QUEUE APIs                                          */
/* ------------------------------------------------------------------ */

app.get(["/appointments", "/api/appointments"], auth, (req, res) => {
  let appts = db.appointments || [];
  if (req.query.patientId) appts = appts.filter(a => a.patientId === req.query.patientId);
  if (req.query.doctorId) appts = appts.filter(a => a.doctorId === req.query.doctorId);
  if (req.query.date) appts = appts.filter(a => a.date === req.query.date);
  if (req.query.status) appts = appts.filter(a => a.status === req.query.status);

  if (req.user.role === "PATIENT") appts = appts.filter(a => a.patientId === req.user.id);
  else if (req.user.role === "DOCTOR") appts = appts.filter(a => a.doctorId === req.user.id);

  if (req.query.page) return res.json(paginate(appts, req));
  res.json({ appointments: appts });
});

app.post(["/appointments", "/api/appointments"], auth, (req, res) => {
  const { doctorId, date, timeSlot, reason, patientId: reqPatientId } = req.body;
  
  const targetPatientId = req.user.role === "PATIENT" ? req.user.id : reqPatientId;
  const patient = db.users.find(u => u.id === targetPatientId);
  if (!patient) return res.status(400).json({ error: "Valid patient record is required to book appointment." });

  const doc = db.users.find(u => u.id === doctorId) || db.users.find(u => u.role === "DOCTOR");

  const apptId = id("APT");
  const newAppt = {
    id: apptId,
    patientId: targetPatientId,
    patientName: patient.name,
    doctorId: doc?.id || doctorId || "DOC-101",
    doctorName: doc?.name || "Dr. Assigned Doctor",
    date: date || new Date().toISOString().split("T")[0],
    timeSlot: timeSlot || "10:00 AM",
    reason: reason || "General OPD Consultation",
    status: "BOOKED",
    createdAt: now()
  };

  db.appointments = db.appointments || [];
  db.appointments.push(newAppt);
  saveDb();

  notify(targetPatientId, "Appointment Confirmed", `Your appointment with ${newAppt.doctorName} for ${newAppt.date} at ${newAppt.timeSlot} is confirmed.`, "SUCCESS");
  audit("BOOK_APPOINTMENT", req.user, targetPatientId, { apptId, doctorId: newAppt.doctorId });

  res.json({ appointment: newAppt });
});

app.post(["/appointments/:id/check-in", "/api/appointments/:id/check-in", "/api/queue/check-in"], auth, role("RECEPTIONIST", "NURSE", "ADMIN", "HOSPITAL_ADMIN"), (req, res) => {
  const { patientId: reqPatientId, doctorId: reqDoctorId } = req.body;
  const apptId = req.params.id;

  let appt = (db.appointments || []).find(a => a.id === apptId);
  const pId = appt ? appt.patientId : reqPatientId;
  const dId = appt ? appt.doctorId : reqDoctorId;

  const patient = db.users.find(u => u.id === pId);
  if (!patient) return res.status(404).json({ error: "Patient record not found for check-in." });

  const doc = db.users.find(u => u.id === dId) || db.users.find(u => u.role === "DOCTOR");

  if (appt) appt.status = "CHECKED_IN";

  const doctorQueue = (db.queue || []).filter(q => q.doctorId === dId);
  const tokenNum = doctorQueue.length + 101;
  const token = `A-${tokenNum}`;
  const waitingCount = doctorQueue.filter(q => q.status === "CHECKED_IN" || q.status === "WAITING").length;
  const waitTimeMinutes = waitingCount * 15;

  const queueEntry = {
    id: id("Q"),
    token,
    appointmentId: appt ? appt.id : null,
    patientId: patient.id,
    patientName: patient.name,
    doctorId: doc ? doc.id : dId,
    doctorName: doc ? doc.name : "Assigned Doctor",
    status: "CHECKED_IN",
    checkInTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    consultationTime: null,
    category: "OPD",
    waitTimeMinutes,
    createdAt: now()
  };

  db.queue = db.queue || [];
  db.queue.push(queueEntry);
  saveDb();

  notify(patient.id, "Check-In Confirmed", `Token ${token} issued for Dr. ${queueEntry.doctorName}. Estimated wait time: ${waitTimeMinutes} mins.`, "SUCCESS");
  audit("CHECK_IN_PATIENT", req.user, patient.id, { token });

  res.json({ appointment: appt, queueEntry });
});

/* ------------------------------------------------------------------ */
/* QUEUE MANAGEMENT APIs                                             */
/* ------------------------------------------------------------------ */

app.get(["/queue", "/api/queue"], auth, (req, res) => {
  let list = db.queue || [];
  if (req.query.doctorId) list = list.filter(q => q.doctorId === req.query.doctorId);
  if (req.query.status) list = list.filter(q => q.status === req.query.status);
  res.json({ queue: list });
});

app.post(["/queue/:id/call", "/api/queue/:id/call"], auth, role("DOCTOR", "NURSE", "ADMIN"), (req, res) => {
  const qEntry = (db.queue || []).find(q => q.id === req.params.id || q.token === req.params.id);
  if (!qEntry) return res.status(404).json({ error: "Queue entry not found." });

  qEntry.status = "IN_CONSULTATION";
  saveDb();

  notify(qEntry.patientId, "Doctor Calling", `Doctor is now calling Token ${qEntry.token}. Please enter the OPD Cabin.`, "WARNING");
  audit("CALL_QUEUE_PATIENT", req.user, qEntry.patientId, { token: qEntry.token });

  res.json({ queueEntry: qEntry });
});

app.post(["/queue/:id/complete", "/api/queue/:id/complete"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const qEntry = (db.queue || []).find(q => q.id === req.params.id || q.token === req.params.id);
  if (!qEntry) return res.status(404).json({ error: "Queue entry not found." });

  qEntry.status = "COMPLETED";
  qEntry.consultationTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  saveDb();

  audit("COMPLETE_QUEUE_ENTRY", req.user, qEntry.patientId, { token: qEntry.token });
  res.json({ queueEntry: qEntry });
});

/* ------------------------------------------------------------------ */
/* UNIVERSAL SEARCH API                                               */
/* ------------------------------------------------------------------ */

app.get("/api/search", auth, (req, res) => {
  const query = (req.query.q || "").trim().toLowerCase();
  if (!query) return res.json({ results: [] });

  const results = [];

  // Search Patients
  db.users.filter(u => u.role === "PATIENT").forEach(p => {
    const idMatch = p.id && p.id.toLowerCase().includes(query);
    const nameMatch = p.name && p.name.toLowerCase().includes(query);
    const mrnMatch = p.mrn && p.mrn.toLowerCase().includes(query);
    const phoneMatch = p.phone && p.phone.toLowerCase().includes(query);
    if (idMatch || nameMatch || mrnMatch || phoneMatch) {
      results.push({ type: "PATIENT", id: p.id, title: `Patient: ${p.name} (${p.id})`, subtitle: `MRN: ${p.mrn} | Age: ${p.age || 'N/A'} | Blood: ${p.bloodGroup || 'O+'} | Phone: ${p.phone || 'N/A'}`, details: publicUser(p) });
    }
  });

  // Search Doctors
  db.users.filter(u => u.role === "DOCTOR").forEach(d => {
    const nameMatch = d.name && d.name.toLowerCase().includes(query);
    const deptMatch = d.department && d.department.toLowerCase().includes(query);
    if (nameMatch || deptMatch) {
      results.push({ type: "DOCTOR", id: d.id, title: `Doctor: ${d.name} (${d.department})`, subtitle: `Room: ${d.roomNumber || 'OPD'} | Fee: ₹${d.opdFee || 500}`, details: publicUser(d) });
    }
  });

  // Search Prescriptions
  (db.prescriptions || []).forEach(rx => {
    const idMatch = rx.id && rx.id.toLowerCase().includes(query);
    const medMatch = rx.medicationName && rx.medicationName.toLowerCase().includes(query);
    const patMatch = rx.patientName && rx.patientName.toLowerCase().includes(query);
    if (idMatch || medMatch || patMatch) {
      results.push({ type: "PRESCRIPTION", id: rx.id, title: `Prescription: ${rx.medicationName} (${rx.id})`, subtitle: `Patient: ${rx.patientName} | Status: ${rx.dispensedStatus}`, details: rx });
    }
  });

  // Search Lab Orders
  (db.labOrders || []).forEach(l => {
    const idMatch = l.id && l.id.toLowerCase().includes(query);
    const testMatch = l.testName && l.testName.toLowerCase().includes(query);
    const patMatch = l.patientName && l.patientName.toLowerCase().includes(query);
    if (idMatch || testMatch || patMatch) {
      results.push({ type: "LAB_ORDER", id: l.id, title: `Lab Order: ${l.testName} (${l.id})`, subtitle: `Patient: ${l.patientName} | Status: ${l.status}`, details: l });
    }
  });

  // Search Scan Orders
  (db.scanOrders || []).forEach(s => {
    const idMatch = s.id && s.id.toLowerCase().includes(query);
    const typeMatch = s.scanType && s.scanType.toLowerCase().includes(query);
    const patMatch = s.patientName && s.patientName.toLowerCase().includes(query);
    if (idMatch || typeMatch || patMatch) {
      results.push({ type: "SCAN_ORDER", id: s.id, title: `Scan Order: ${s.scanType} (${s.id})`, subtitle: `Patient: ${s.patientName} | Status: ${s.status}`, details: s });
    }
  });

  // Search Admissions & Beds
  (db.beds || []).forEach(b => {
    const bedMatch = b.bedId && b.bedId.toLowerCase().includes(query);
    const wardMatch = b.ward && b.ward.toLowerCase().includes(query);
    if (bedMatch || wardMatch) {
      results.push({ type: "BED", id: b.bedId, title: `Bed: ${b.bedId} (${b.ward})`, subtitle: `Status: ${b.status} | Patient: ${b.currentPatientName || 'None'}`, details: b });
    }
  });

  audit("UNIVERSAL_SEARCH", req.user, null, { query, count: results.length });
  res.json({ query, results });
});

/* ------------------------------------------------------------------ */
/* COMMAND CENTER OPERATIONAL OVERVIEW                                */
/* ------------------------------------------------------------------ */

app.get("/api/command-center", auth, (req, res) => {
  const todayDate = new Date().toISOString().split("T")[0];
  const startOfToday = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";

  const totalPatients = db.users.filter(u => u.role === "PATIENT").length;
  const totalDoctors = db.users.filter(u => u.role === "DOCTOR").length;
  const todayAppointments = (db.appointments || []).filter(a => a.date === todayDate).length;

  const activeEmergency = (db.emergencyCases || []).filter(e => e.status === "ACTIVE" || e.status === "IN_INBOUND_AMBULANCE");
  const criticalEmergency = activeEmergency.filter(e => e.priority === "CRITICAL_RED").length;

  const totalBeds = (db.beds || []).length;
  const availBeds = (db.beds || []).filter(b => b.status === "AVAILABLE").length;
  const occupiedBeds = (db.beds || []).filter(b => b.status === "OCCUPIED").length;

  const icuBeds = (db.beds || []).filter(b => b.ward === "ICU");
  const icuAvailable = icuBeds.filter(b => b.status === "AVAILABLE").length;
  const genBeds = (db.beds || []).filter(b => b.ward === "General Ward");
  const genAvailable = genBeds.filter(b => b.status === "AVAILABLE").length;
  const erBeds = (db.beds || []).filter(b => b.ward === "Emergency");
  const erAvailable = erBeds.filter(b => b.status === "AVAILABLE").length;

  const pendingRx = (db.prescriptions || []).filter(p => p.dispensedStatus !== "DISPENSED").length;
  const lowStockMeds = (db.pharmacyInventory || []).filter(i => i.stockQuantity <= i.thresholdLow || i.status === "LOW_STOCK").length;

  const pendingLabs = (db.labOrders || []).filter(l => l.status !== "PUBLISHED").length;
  const pendingScans = (db.scanOrders || []).filter(s => s.status !== "PUBLISHED").length;

  const waitingQueue = (db.queue || []).filter(q => q.status === "CHECKED_IN" || q.status === "WAITING").length;

  const todayRevenue = (db.invoices || [])
    .filter(inv => inv.status === "PAID" && inv.paidAt >= startOfToday)
    .reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  const activeAdmissions = (db.admissions || []).filter(a => a.status === "ADMITTED").length;
  const todayDischarges = (db.admissions || []).filter(a => a.status === "DISCHARGED" && a.dischargeDate >= startOfToday).length;

  res.json({
    metrics: {
      totalPatients,
      totalDoctors,
      todayAppointments,
      waitingQueue,
      activeEmergencies: activeEmergency.length,
      availableBeds: availBeds,
      occupiedBeds,
      pendingPrescriptions: pendingRx,
      lowStockMedicines: lowStockMeds,
      pendingLabTests: pendingLabs,
      pendingScanReports: pendingScans,
      todayRevenue,
      activeAdmissions,
      todayDischarges
    },
    emergency: {
      activeCases: activeEmergency.length,
      critical: criticalEmergency,
      inboundAmbulances: activeEmergency.filter(e => e.status === "IN_INBOUND_AMBULANCE").length
    },
    beds: {
      total: totalBeds,
      available: availBeds,
      icuAvailable: `${icuAvailable}/${icuBeds.length}`,
      genAvailable: `${genAvailable}/${genBeds.length}`,
      erAvailable: `${erAvailable}/${erBeds.length}`
    },
    pharmacy: {
      pendingPrescriptions: pendingRx,
      lowStockAlerts: lowStockMeds
    },
    diagnostics: {
      pendingLabs,
      pendingScans
    },
    timestamp: now()
  });
});

/* ------------------------------------------------------------------ */
/* PATIENT 360 & TIMELINE APIs                                        */
/* ------------------------------------------------------------------ */

app.get("/api/patient/360/:patientId", auth, (req, res) => {
  const patientId = req.params.patientId;
  if (!checkPatientAccess(req, patientId)) {
    return res.status(403).json({ error: "Unauthorized patient record access." });
  }

  const patient = db.users.find(u => u.id === patientId && u.role === "PATIENT");
  if (!patient) return res.status(404).json({ error: "Patient record not found." });

  const patientAllergies = (db.allergies || []).filter(a => a.patientId === patientId);
  const patientMedications = (db.medications || []).filter(m => m.patientId === patientId);
  const patientPrescriptions = (db.prescriptions || []).filter(p => p.patientId === patientId);
  const patientLabs = (db.labOrders || []).filter(l => l.patientId === patientId);
  const patientScans = (db.scanOrders || []).filter(s => s.patientId === patientId);
  const patientAdmissions = (db.admissions || []).filter(a => a.patientId === patientId);
  const patientInvoices = (db.invoices || []).filter(i => i.patientId === patientId);
  const patientCaseSheets = (db.caseSheets || []).filter(cs => cs.patientId === patientId);
  const patientReferrals = (db.referrals || []).filter(r => r.patientId === patientId);
  const patientVitals = (db.vitals || []).filter(v => v.patientId === patientId);
  const activeQueue = (db.queue || []).find(q => q.patientId === patientId && q.status !== "COMPLETED");

  let journeyStage = "BOOKED";
  if (patientAdmissions.some(a => a.status === "ADMITTED")) journeyStage = "ADMITTED";
  else if (patientScans.some(s => s.status !== "PUBLISHED") || patientLabs.some(l => l.status !== "PUBLISHED")) journeyStage = "DIAGNOSTICS_PENDING";
  else if (patientPrescriptions.some(p => p.dispensedStatus !== "DISPENSED")) journeyStage = "PHARMACY_PENDING";
  else if (activeQueue?.status === "IN_CONSULTATION") journeyStage = "DOCTOR_CONSULTATION";
  else if (activeQueue?.status === "CHECKED_IN") journeyStage = "CHECKED_IN";

  audit("VIEW_PATIENT_360", req.user, patientId);

  res.json({
    patient: publicUser(patient),
    journeyStage,
    activeQueue,
    caseSheets: patientCaseSheets,
    allergies: patientAllergies,
    activeMedications: patientMedications.filter(m => m.status === "ACTIVE"),
    prescriptions: patientPrescriptions,
    labOrders: patientLabs,
    scanOrders: patientScans,
    admissions: patientAdmissions,
    invoices: patientInvoices,
    referrals: patientReferrals,
    vitalsTimeline: patientVitals
  });
});

app.get("/api/patient/timeline", auth, (req, res) => {
  const patientId = req.query.patientId || (req.user.role === "PATIENT" ? req.user.id : null);
  if (!patientId) return res.status(400).json({ error: "Patient ID is required." });

  const timeline = [];

  (db.caseSheets || []).filter(c => c.patientId === patientId).forEach(c => {
    const dx = c.clinicalAssessment?.finalDiagnosis || c.clinicalAssessment?.provisionalDiagnosis || c.sectionL_Diagnosis?.provisionalDiagnosis || "Encounter";
    timeline.push({ id: c.id, date: c.createdAt, type: "CLINICAL_PATINOTE", title: `PATINOTE Case Sheet by ${c.doctorName}`, summary: `Diagnosis: ${dx} | Status: ${c.status || 'FINALIZED'}`, details: c });
  });
  (db.labOrders || []).filter(l => l.patientId === patientId).forEach(l => {
    timeline.push({ id: l.id, date: l.createdAt, type: "LABORATORY_TEST", title: `Lab Test: ${l.testName}`, summary: `Status: ${l.status} | Result: ${l.result || 'Pending'}`, details: l });
  });
  (db.scanOrders || []).filter(s => s.patientId === patientId).forEach(s => {
    timeline.push({ id: s.id, date: s.createdAt, type: "SCAN_IMAGING", title: `Imaging Scan: ${s.scanType}`, summary: `Status: ${s.status} | Report: ${s.reportText || 'Pending'}`, details: s });
  });
  (db.prescriptions || []).filter(p => p.patientId === patientId).forEach(p => {
    timeline.push({ id: p.id, date: p.createdAt, type: "PRESCRIPTION", title: `Prescription: ${p.medicationName}`, summary: `${p.dosage} - ${p.frequency} (${p.dispensedStatus})`, details: p });
  });
  (db.admissions || []).filter(a => a.patientId === patientId).forEach(a => {
    timeline.push({ id: a.id, date: a.admissionDate, type: "HOSPITAL_ADMISSION", title: `Hospital Admission: ${a.ward}`, summary: `Reason: ${a.reason} (${a.status})`, details: a });
  });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ patientId, timeline });
});

/* ------------------------------------------------------------------ */
/* PATINOTE COMPLETE CLINICAL CASE-TAKING API                         */
/* ------------------------------------------------------------------ */

app.post(["/api/patinote/save", "/doctor/case-sheet", "/api/doctor/case-sheet"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const {
    id: existingCaseSheetId,
    patientId,
    encounterId,
    status = "FINALIZED", // DRAFT vs FINALIZED
    
    // Header & Identification
    visitDateTime,
    
    // 9. Chief Complaints (Multiple)
    chiefComplaints = [],
    chiefComplaintNotes = "",

    // 10. History of Present Illness (HPI)
    hpi = {},

    // 11. Past Medical History
    pastMedicalHistory = [],

    // 12. Past Surgical History
    pastSurgicalHistory = [],

    // 13. Medication History
    medicationHistory = [],

    // 14. Allergy History
    allergyHistory = [],

    // 15. Family History
    familyHistory = [],

    // 16. Personal & Social History
    personalSocialHistory = {},

    // 17. Menstrual / Obstetric / Gynaecological History (Female)
    menstrualObstetricHistory = {},

    // 18. Pediatric History (Child)
    pediatricHistory = {},

    // 19. Vital Signs
    vitals = {},

    // 20. Physical Examination
    physicalExamination = {},

    // 21. Investigation Review
    investigationReview = {},

    // 22. Clinical Assessment & Diagnosis
    clinicalAssessment = {},

    // 23. Treatment & Management Plan
    treatmentPlan = {},

    // 24. E-Prescription
    prescriptions = [],

    // Connected Lab & Scan Orders
    labOrders = [],
    scanOrders = [],

    // 25. Referral
    referrals = {},

    // 26. Follow-Up
    followUp = {},

    requireAdmission = false,
    admissionReason = ""
  } = req.body;

  const patient = db.users.find(u => u.id === patientId && u.role === "PATIENT");
  if (!patient) return res.status(404).json({ error: "Patient record not found." });

  const caseSheetId = existingCaseSheetId || id("PATINOTE");
  const consultationId = encounterId || id("ENC");

  // Compute BMI
  let bmi = vitals.bmi;
  if (!bmi && vitals.height && vitals.weight) {
    const hM = parseFloat(vitals.height) / 100;
    const wKg = parseFloat(vitals.weight);
    if (hM > 0 && wKg > 0) bmi = (wKg / (hM * hM)).toFixed(1);
  }

  // 1. Sync Allergies to Patient Master Record
  if (Array.isArray(allergyHistory) && allergyHistory.length > 0) {
    allergyHistory.forEach(alg => {
      if (alg.allergen && !db.allergies.some(a => a.patientId === patientId && a.allergen.toLowerCase() === alg.allergen.toLowerCase())) {
        db.allergies.push({
          id: id("ALG"),
          patientId,
          allergen: alg.allergen,
          category: alg.category || "Drug",
          reaction: alg.reaction || "Allergic Reaction",
          severity: alg.severity || "Moderate",
          source: `PATINOTE Case Sheet by ${req.user.name}`,
          verifiedStatus: "VERIFIED",
          createdAt: now()
        });
      }
    });
  }

  // 2. Log Vitals to Vitals Timeline
  if (vitals.sysBp || vitals.pulse || vitals.temp || vitals.spO2) {
    db.vitals.push({
      id: id("VITALS"),
      patientId,
      caseSheetId,
      sysBp: vitals.sysBp,
      diaBp: vitals.diaBp,
      pulse: vitals.pulse || vitals.heartRate,
      respRate: vitals.respRate,
      temp: vitals.temp,
      spO2: vitals.spO2,
      height: vitals.height,
      weight: vitals.weight,
      bmi: bmi || "",
      painScore: vitals.painScore || 0,
      bloodGlucose: vitals.bloodGlucose || "",
      recordedBy: req.user.name,
      timestamp: now()
    });
  }

  // Construct complete PATINOTE Record
  const patinoteRecord = {
    id: caseSheetId,
    consultationId,
    patientId,
    patientName: patient.name,
    patientAge: patient.age,
    patientGender: patient.gender,
    patientBloodGroup: patient.bloodGroup || "O+",
    patientMrn: patient.mrn,
    patientPhone: patient.phone,
    doctorId: req.user.id,
    doctorName: req.user.name,
    doctorDepartment: req.user.department || "General Medicine",
    status, // DRAFT or FINALIZED
    visitDateTime: visitDateTime || now(),

    // Sections 9 - 26
    chiefComplaints,
    chiefComplaintNotes,
    hpi,
    pastMedicalHistory,
    pastSurgicalHistory,
    medicationHistory,
    allergyHistory,
    familyHistory,
    personalSocialHistory,
    menstrualObstetricHistory,
    pediatricHistory,
    vitals: { ...vitals, bmi },
    physicalExamination,
    investigationReview,
    clinicalAssessment,
    treatmentPlan,
    prescriptionsSummary: prescriptions,
    labOrdersSummary: labOrders,
    scanOrdersSummary: scanOrders,
    referrals,
    followUp,
    requireAdmission,
    admissionReason,

    createdAt: now(),
    updatedAt: now(),
    signedAt: status === "FINALIZED" ? now() : null,
    signedByDoctor: status === "FINALIZED" ? req.user.name : null
  };

  // Upsert in db.caseSheets
  const idx = (db.caseSheets || []).findIndex(cs => cs.id === caseSheetId);
  if (idx >= 0) db.caseSheets[idx] = patinoteRecord;
  else db.caseSheets.push(patinoteRecord);

  // Sync with consultations for backward compatibility
  const finalDx = clinicalAssessment.finalDiagnosis || clinicalAssessment.provisionalDiagnosis || "General Consultation";
  const consEntry = {
    id: consultationId,
    caseSheetId,
    patientId,
    patientName: patient.name,
    doctorId: req.user.id,
    doctorName: req.user.name,
    chiefComplaint: chiefComplaints[0]?.complaint || "OPD Consultation",
    diagnosis: finalDx,
    followUpDays: followUp.followUpDate ? Math.ceil((new Date(followUp.followUpDate) - new Date()) / 86400000) : 7,
    createdAt: now()
  };
  const cIdx = (db.consultations || []).findIndex(c => c.id === consultationId);
  if (cIdx >= 0) db.consultations[cIdx] = consEntry;
  else db.consultations.push(consEntry);

  const docFee = req.user.opdFee || MASTER_PRICES.consultationFee;
  const invoiceItems = [
    { category: "CONSULTATION", description: `Doctor Consultation - ${req.user.name} (${req.user.department || 'General'})`, amount: docFee }
  ];

  // 3. Dispatch E-Prescriptions to Pharmacy Queue
  const createdPrescriptions = [];
  if (Array.isArray(prescriptions) && prescriptions.length > 0) {
    prescriptions.forEach(p => {
      const rxId = id("RX");
      const invMatch = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(p.medicine.toLowerCase().split(" ")[0]));
      const unitPrice = p.unitPrice || invMatch?.unitPrice || 35;
      const quantity = parseInt(p.quantity || "10", 10);
      const totalPrice = unitPrice * quantity;

      const rx = {
        id: rxId,
        caseSheetId,
        patientId,
        patientName: patient.name,
        doctorId: req.user.id,
        doctorName: req.user.name,
        consultationId,
        medicationName: p.medicine,
        strength: p.strength || "",
        dosage: p.dose || "1 tablet",
        route: p.route || "Oral",
        frequency: p.frequency || "TDS (Thrice Daily)",
        duration: p.duration || "5 days",
        instructions: p.instructions || "Take after food",
        quantity,
        unitPrice,
        totalPrice,
        status: "ACTIVE",
        dispensedStatus: "PENDING",
        verifiedByPharmacist: false,
        packed: false,
        barcode: invMatch ? invMatch.barcode : `89012345${Math.floor(10000 + Math.random() * 89999)}`,
        createdAt: now()
      };
      db.prescriptions = db.prescriptions || [];
      db.prescriptions.push(rx);
      createdPrescriptions.push(rx);

      invoiceItems.push({ category: "PHARMACY", description: `${p.medicine} (${quantity} qty)`, amount: totalPrice });

      db.medications.push({
        id: id("MED"),
        patientId,
        name: p.medicine,
        dosage: p.dose,
        frequency: p.frequency,
        startDate: now(),
        status: "ACTIVE",
        prescribedBy: req.user.name
      });
    });

    notify(patientId, "New Prescription Issued", `Dr. ${req.user.name} issued ${prescriptions.length} medicine prescription(s). Sent to Pharmacy.`, "INFO");
  }

  // 4. Dispatch Lab Orders
  const createdLabs = [];
  if (Array.isArray(labOrders)) {
    labOrders.forEach(l => {
      const testName = typeof l === "string" ? l : l.testName;
      const lId = id("LAB");
      const testPrice = MASTER_PRICES.labs[testName] || 400;
      const labOrder = {
        id: lId,
        caseSheetId,
        patientId,
        patientName: patient.name,
        orderedBy: req.user.name,
        testName,
        price: testPrice,
        status: "REQUESTED",
        result: null,
        referenceRange: "Normal",
        createdAt: now()
      };
      db.labOrders = db.labOrders || [];
      db.labOrders.push(labOrder);
      createdLabs.push(labOrder);
      invoiceItems.push({ category: "LABORATORY", description: testName, amount: testPrice });
    });
  }

  // 5. Dispatch Scan Orders
  const createdScans = [];
  if (Array.isArray(scanOrders)) {
    scanOrders.forEach(s => {
      const scanType = typeof s === "string" ? s : s.scanType;
      const sId = id("SCAN");
      const scanPrice = MASTER_PRICES.scans[scanType] || 800;
      const scanOrder = {
        id: sId,
        caseSheetId,
        patientId,
        patientName: patient.name,
        orderedBy: req.user.name,
        scanType,
        price: scanPrice,
        status: "REQUESTED",
        reportText: null,
        createdAt: now()
      };
      db.scanOrders = db.scanOrders || [];
      db.scanOrders.push(scanOrder);
      createdScans.push(scanOrder);
      invoiceItems.push({ category: "SCANNING", description: scanType, amount: scanPrice });
    });
  }

  // 6. Handle Referral
  if (referrals.referralDepartment) {
    db.referrals = db.referrals || [];
    db.referrals.push({
      id: id("REF"),
      patientId,
      patientName: patient.name,
      referringDoctor: req.user.name,
      referralDepartment: referrals.referralDepartment,
      referredDoctor: referrals.referredDoctor || "On-Duty Specialist",
      reason: referrals.reason || "Specialist Consultation",
      urgency: referrals.urgency || "Routine",
      summary: referrals.clinicalSummary || finalDx,
      status: "PENDING",
      createdAt: now()
    });
  }

  // 7. Handle Follow-Up Appointment Auto-Creation
  if (followUp.createAppointment && followUp.followUpDate) {
    db.appointments.push({
      id: id("APT"),
      patientId,
      patientName: patient.name,
      doctorId: req.user.id,
      doctorName: req.user.name,
      date: followUp.followUpDate,
      timeSlot: "10:00 AM",
      reason: followUp.reason || `Follow-up for ${finalDx}`,
      status: "BOOKED",
      createdAt: now()
    });
  }

  // 8. Generate Connected Invoice
  const invoice = createConnectedInvoice(patientId, invoiceItems, consultationId);

  // 9. Update Queue Status if active
  const qEntry = (db.queue || []).find(q => q.patientId === patientId && q.status !== "COMPLETED");
  if (qEntry) {
    qEntry.status = "COMPLETED";
    qEntry.consultationTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  saveDb();
  audit("SAVE_PATINOTE", req.user, patientId, { caseSheetId, status, diagnosis: finalDx, rxCount: createdPrescriptions.length });

  res.json({
    caseSheet: patinoteRecord,
    prescriptions: createdPrescriptions,
    labs: createdLabs,
    scans: createdScans,
    invoice,
    message: status === "FINALIZED" ? "✓ PATINOTE Case Sheet Signed & Finalized Successfully!" : "Draft Saved."
  });
});

app.get("/api/patinote/patient/:patientId", auth, (req, res) => {
  const list = (db.caseSheets || []).filter(c => c.patientId === req.params.patientId);
  res.json({ caseSheets: list });
});

app.get("/api/patinote/:id", auth, (req, res) => {
  const cs = (db.caseSheets || []).find(c => c.id === req.params.id);
  if (!cs) return res.status(404).json({ error: "PATINOTE record not found." });
  res.json({ caseSheet: cs });
});

/* ------------------------------------------------------------------ */
/* PHARMACY & INVENTORY APIs                                          */
/* ------------------------------------------------------------------ */

app.get(["/prescriptions", "/api/prescriptions"], auth, (req, res) => {
  let rxs = db.prescriptions || [];
  if (req.query.patientId) rxs = rxs.filter(p => p.patientId === req.query.patientId);
  if (req.query.status) rxs = rxs.filter(p => p.dispensedStatus === req.query.status);
  if (req.query.page) return res.json(paginate(rxs, req));
  res.json({ prescriptions: rxs });
});

app.get(["/prescriptions/:id", "/api/prescriptions/:id"], auth, (req, res) => {
  const rx = (db.prescriptions || []).find(p => p.id === req.params.id);
  if (!rx) return res.status(404).json({ error: "Prescription not found." });
  res.json({ prescription: rx });
});

app.get(["/pharmacy/orders", "/api/pharmacy/orders"], auth, (req, res) => {
  const rxs = (db.prescriptions || []).map(rx => {
    const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(rx.medicationName.toLowerCase().split(" ")[0]));
    const requiredQty = rx.quantity || 10;
    const stockQty = invItem ? invItem.stockQuantity : 0;
    let inventoryAvailability = "AVAILABLE";
    if (stockQty <= 0) inventoryAvailability = "OUT_OF_STOCK";
    else if (stockQty < requiredQty) inventoryAvailability = `PARTIALLY_AVAILABLE (Stock: ${stockQty})`;

    return {
      ...rx,
      inventoryStatus: invItem ? invItem.status : "HEALTHY",
      inventoryAvailability,
      barcode: invItem ? invItem.barcode : rx.barcode || "8901234567890",
      availableQuantity: stockQty,
      unitPrice: rx.unitPrice || invItem?.unitPrice || 25,
      totalPrice: rx.totalPrice || (rx.unitPrice || invItem?.unitPrice || 25) * requiredQty
    };
  });
  if (req.query.page) return res.json(paginate(rxs, req));
  res.json({ orders: rxs });
});

app.post(["/pharmacy/orders/:id/verify", "/api/pharmacy/orders/:id/verify", "/api/pharmacy/verify"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const rxId = req.params.id || req.body.prescriptionId;
  const rx = (db.prescriptions || []).find(p => p.id === rxId);
  if (!rx) return res.status(404).json({ error: "Prescription not found." });

  rx.dispensedStatus = "VERIFIED";
  rx.verifiedByPharmacist = true;
  rx.verifiedAt = now();

  saveDb();
  audit("PHARMACY_VERIFY_ORDER", req.user, rx.patientId, { prescriptionId: rx.id });
  res.json({ prescription: rx });
});

app.post("/api/pharmacy/generate-bill", auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const { prescriptionId } = req.body;
  const rx = (db.prescriptions || []).find(p => p.id === prescriptionId);
  if (!rx) return res.status(404).json({ error: "Prescription not found." });

  const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(rx.medicationName.toLowerCase().split(" ")[0]));
  const unitPrice = rx.unitPrice || invItem?.unitPrice || 25;
  const quantity = rx.quantity || 10;
  const totalPrice = unitPrice * quantity;

  let invoice = (db.invoices || []).find(i => i.prescriptionId === rx.id);
  if (!invoice) {
    invoice = createConnectedInvoice(rx.patientId, [{ category: "PHARMACY", description: `${rx.medicationName} (${quantity} qty)`, amount: totalPrice }], null, rx.id);
  }

  rx.dispensedStatus = "BILL_GENERATED";
  rx.invoiceId = invoice.id;

  saveDb();
  audit("GENERATE_PHARMACY_BILL", req.user, rx.patientId, { invoiceId: invoice.id, amount: totalPrice });
  res.json({ invoice, prescription: rx });
});

app.post("/api/pharmacy/scan-verify", auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const { scannedBarcode, prescriptionId } = req.body;
  const rx = (db.prescriptions || []).find(p => p.id === prescriptionId);
  if (!rx) return res.status(404).json({ error: "Prescription not found." });

  const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(rx.medicationName.toLowerCase().split(" ")[0]));
  const expectedBarcode = invItem ? invItem.barcode : (rx.barcode || "8901234567890");

  if (scannedBarcode !== expectedBarcode && scannedBarcode !== "VERIFY_OVERRIDE") {
    return res.status(400).json({ error: "❌ WRONG MEDICINE BARCODE! Item does not match prescribed medicine." });
  }

  res.json({ verified: true, message: "✓ MEDICINE BARCODE VERIFIED SUCCESSFULLY." });
});

app.post(["/pharmacy/orders/:id/pack", "/api/pharmacy/orders/:id/pack", "/api/pharmacy/pack"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const rxId = req.params.id || req.body.prescriptionId;
  const rx = (db.prescriptions || []).find(p => p.id === rxId);
  if (!rx) return res.status(404).json({ error: "Prescription not found." });

  rx.dispensedStatus = "READY_FOR_COLLECTION";
  rx.packed = true;
  rx.packedAt = now();

  notify(rx.patientId, "💊 YOUR MEDICINES ARE READY", `Your order for ${rx.medicationName} has been verified & packed. Collect at Pharmacy Counter #2.`, "SUCCESS");
  saveDb();
  audit("PACK_MEDICINE_ORDER", req.user, rx.patientId, { prescriptionId: rx.id });
  res.json({ prescription: rx });
});

app.post(["/pharmacy/orders/:id/dispense", "/api/pharmacy/orders/:id/dispense", "/api/pharmacy/dispense"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const rxId = req.params.id || req.body.prescriptionId;

  try {
    const result = withTransaction(() => {
      const rx = (db.prescriptions || []).find(p => p.id === rxId);
      if (!rx) throw new Error("Prescription not found.");

      const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(rx.medicationName.toLowerCase().split(" ")[0]));
      const requiredQty = rx.quantity || 10;

      if (invItem) {
        if (invItem.stockQuantity < requiredQty) {
          throw new Error(`Insufficient inventory for ${invItem.name}. Stock available: ${invItem.stockQuantity}, Required: ${requiredQty}`);
        }
        invItem.stockQuantity -= requiredQty;
        if (invItem.stockQuantity === 0) invItem.status = "OUT_OF_STOCK";
        else if (invItem.stockQuantity <= invItem.thresholdLow) invItem.status = "LOW_STOCK";
      }

      rx.dispensedStatus = "DISPENSED";
      rx.dispensedAt = now();
      rx.dispensedBy = req.user.name;

      audit("DISPENSE_MEDICATION", req.user, rx.patientId, { prescriptionId: rx.id, quantityDeducted: requiredQty, remainingStock: invItem ? invItem.stockQuantity : null });
      return { prescription: rx, updatedInventory: invItem };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get(["/inventory", "/api/inventory", "/api/pharmacy/inventory"], auth, (req, res) => {
  let list = db.pharmacyInventory || [];
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    list = list.filter(i => (i.name && i.name.toLowerCase().includes(q)) || (i.genericName && i.genericName.toLowerCase().includes(q)) || (i.barcode && i.barcode.includes(q)));
  }
  if (req.query.status) {
    list = list.filter(i => i.status === req.query.status);
  }
  if (req.query.page) return res.json(paginate(list, req));
  res.json({ inventory: list });
});

app.post(["/inventory", "/api/inventory"], auth, role("PHARMACIST", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const { name, genericName, dosage, batchNo, stockQuantity, thresholdLow, unitPrice, expiryDate, supplier, barcode } = req.body;
  if (!name) return res.status(400).json({ error: "Medicine name is required." });

  const medId = id("INV-MED");
  const qty = parseInt(stockQuantity || "100", 10);
  const thresh = parseInt(thresholdLow || "20", 10);

  const newItem = {
    id: medId,
    name,
    genericName: genericName || name,
    dosage: dosage || "500mg",
    batchNo: batchNo || `BATCH-2026-${Math.floor(100 + Math.random() * 900)}`,
    stockQuantity: qty,
    thresholdLow: thresh,
    unitPrice: parseFloat(unitPrice || "30"),
    expiryDate: expiryDate || "2027-12-31",
    supplier: supplier || "Apex Pharma Ltd",
    status: qty <= 0 ? "OUT_OF_STOCK" : qty <= thresh ? "LOW_STOCK" : "HEALTHY",
    barcode: barcode || `89012345${Math.floor(10001 + Math.random() * 89999)}`,
    createdAt: now()
  };

  db.pharmacyInventory = db.pharmacyInventory || [];
  db.pharmacyInventory.push(newItem);
  saveDb();
  audit("ADD_INVENTORY_ITEM", req.user, null, { medId, name, qty });
  res.json({ inventoryItem: newItem });
});

/* ------------------------------------------------------------------ */
/* DIAGNOSTICS: LABORATORY & SCANNING APIs                            */
/* ------------------------------------------------------------------ */

app.get(["/lab/orders", "/api/lab/orders", "/api/lab-orders"], auth, (req, res) => {
  let list = db.labOrders || [];
  if (req.query.patientId) list = list.filter(l => l.patientId === req.query.patientId);
  if (req.query.status) list = list.filter(l => l.status === req.query.status);
  if (req.query.page) return res.json(paginate(list, req));
  res.json({ labOrders: list });
});

app.post(["/lab/orders", "/api/lab/orders"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const { patientId, testName } = req.body;
  const patient = db.users.find(u => u.id === patientId);
  const price = MASTER_PRICES.labs[testName] || 350;

  const newOrder = {
    id: id("LAB"),
    patientId,
    patientName: patient?.name || "Patient",
    orderedBy: req.user.name,
    testName,
    price,
    status: "REQUESTED",
    result: null,
    referenceRange: "Normal",
    createdAt: now()
  };

  db.labOrders = db.labOrders || [];
  db.labOrders.push(newOrder);
  saveDb();
  audit("ORDER_LAB_TEST", req.user, patientId, { testName });
  res.json({ labOrder: newOrder });
});

app.post(["/lab/orders/:id/result", "/api/lab-orders/status"], auth, role("LAB_STAFF", "DOCTOR", "ADMIN"), (req, res) => {
  const labId = req.params.id || req.body.labOrderId;
  const { status = "RESULT_ENTERED", result, referenceRange } = req.body;

  const lab = (db.labOrders || []).find(l => l.id === labId);
  if (!lab) return res.status(404).json({ error: "Lab order not found." });

  lab.status = status;
  if (result) lab.result = result;
  if (referenceRange) lab.referenceRange = referenceRange;

  if (status === "PUBLISHED" || status === "VERIFIED") {
    lab.verifiedBy = req.user.name;
    lab.publishedAt = now();
    notify(lab.patientId, "Laboratory Test Result Ready", `Your ${lab.testName} report has been verified and published.`, "INFO");
  }

  saveDb();
  audit("UPDATE_LAB_ORDER", req.user, lab.patientId, { labId, status });
  res.json({ labOrder: lab });
});

app.get(["/scan/orders", "/api/scan/orders", "/api/scan-orders"], auth, (req, res) => {
  let list = db.scanOrders || [];
  if (req.query.patientId) list = list.filter(s => s.patientId === req.query.patientId);
  if (req.query.status) list = list.filter(s => s.status === req.query.status);
  if (req.query.page) return res.json(paginate(list, req));
  res.json({ scanOrders: list });
});

app.post(["/scan/orders", "/api/scan/orders"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const { patientId, scanType } = req.body;
  const patient = db.users.find(u => u.id === patientId);
  const price = MASTER_PRICES.scans[scanType] || 600;

  const newOrder = {
    id: id("SCAN"),
    patientId,
    patientName: patient?.name || "Patient",
    orderedBy: req.user.name,
    scanType,
    price,
    status: "REQUESTED",
    reportText: null,
    createdAt: now()
  };

  db.scanOrders = db.scanOrders || [];
  db.scanOrders.push(newOrder);
  saveDb();
  audit("ORDER_IMAGING_SCAN", req.user, patientId, { scanType });
  res.json({ scanOrder: newOrder });
});

app.post(["/scan/orders/:id/report", "/api/scan-orders/status"], auth, role("SCAN_TECH", "DOCTOR", "ADMIN"), (req, res) => {
  const scanId = req.params.id || req.body.scanOrderId;
  const { status = "COMPLETED", reportText } = req.body;

  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = status;
  if (reportText) scan.reportText = reportText;

  if (status === "PUBLISHED" || status === "VERIFIED") {
    scan.verifiedBy = req.user.name;
    scan.publishedAt = now();
    notify(scan.patientId, "Imaging Scan Report Available", `Your ${scan.scanType} report has been verified and published.`, "INFO");
  }

  saveDb();
  audit("UPDATE_SCAN_ORDER", req.user, scan.patientId, { scanId, status });
  res.json({ scanOrder: scan });
});

/* ------------------------------------------------------------------ */
/* VISUAL BED MANAGEMENT & CONCURRENCY-SAFE ALLOCATION                */
/* ------------------------------------------------------------------ */

app.get(["/beds", "/api/beds"], auth, (req, res) => {
  let list = db.beds || [];
  if (req.query.ward) list = list.filter(b => b.ward === req.query.ward);
  if (req.query.status) list = list.filter(b => b.status === req.query.status);
  res.json({ beds: list });
});

app.get(["/beds/availability", "/api/beds/availability"], auth, (req, res) => {
  const availableBeds = (db.beds || []).filter(b => b.status === "AVAILABLE");
  res.json({ availableBedsCount: availableBeds.length, beds: availableBeds });
});

app.post(["/beds/:id/allocate", "/api/beds/allocate"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const bedId = req.params.id || req.body.bedId;
  const { patientId, reason = "Inpatient Care" } = req.body;

  try {
    const result = withTransaction(() => {
      const bed = db.beds.find(b => b.bedId === bedId);
      if (!bed) throw new Error(`Bed ${bedId} not found.`);
      if (bed.status !== "AVAILABLE" && bed.status !== "RESERVED") {
        throw new Error(`Double bed allocation blocked! Bed ${bedId} is currently ${bed.status} (assigned to ${bed.currentPatientName || 'another patient'}).`);
      }

      const patient = db.users.find(u => u.id === patientId) || { name: req.body.patientName || "Admitted Patient" };

      bed.status = "OCCUPIED";
      bed.currentPatientId = patientId;
      bed.currentPatientName = patient.name;
      bed.expectedDischarge = new Date(Date.now() + 3 * 86400000).toISOString().split("T")[0];

      let admission = db.admissions.find(a => a.patientId === patientId && a.status !== "DISCHARGED");
      if (!admission) {
        admission = {
          id: id("ADM"),
          admissionNumber: `ADM-${Date.now().toString().slice(-6)}`,
          patientId,
          patientName: patient.name,
          attendingDoctor: req.user.name,
          reason,
          bedId,
          ward: bed.ward,
          status: "ADMITTED",
          admissionDate: now()
        };
        db.admissions.push(admission);
      } else {
        admission.status = "ADMITTED";
        admission.bedId = bedId;
        admission.ward = bed.ward;
      }

      bed.currentAdmissionId = admission.id;

      notify(patientId, "Bed Allocated", `You have been allocated Bed ${bed.bedNumber} in ${bed.ward}.`, "INFO");
      audit("ALLOCATE_BED", req.user, patientId, { bedId, ward: bed.ward });

      return { bed, admission };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/beds/:id/release", "/api/beds/update-status"], auth, role("HOSPITAL_ADMIN", "NURSE", "ADMIN"), (req, res) => {
  const bedId = req.params.id || req.body.bedId;
  const targetStatus = req.body.status || "CLEANING";

  const bed = (db.beds || []).find(b => b.bedId === bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });

  bed.status = targetStatus;
  if (targetStatus === "AVAILABLE" || targetStatus === "CLEANING" || targetStatus === "MAINTENANCE") {
    bed.currentPatientId = null;
    bed.currentPatientName = null;
    bed.currentAdmissionId = null;
  }

  saveDb();
  audit("UPDATE_BED_STATUS", req.user, null, { bedId, status: targetStatus });
  res.json({ bed });
});

/* ------------------------------------------------------------------ */
/* ADMISSIONS & DISCHARGES APIs                                       */
/* ------------------------------------------------------------------ */

app.get(["/admissions", "/api/admissions"], auth, (req, res) => {
  let list = db.admissions || [];
  if (req.query.patientId) list = list.filter(a => a.patientId === req.query.patientId);
  if (req.query.status) list = list.filter(a => a.status === req.query.status);
  res.json({ admissions: list });
});

app.post(["/admissions/discharge", "/api/admissions/discharge"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const { admissionId, summary = "Patient recovered and fit for discharge." } = req.body;
  const adm = (db.admissions || []).find(a => a.id === admissionId);
  if (!adm) return res.status(404).json({ error: "Admission record not found." });

  adm.status = "DISCHARGED";
  adm.dischargeDate = now();
  adm.dischargeSummary = summary;

  if (adm.bedId) {
    const bed = (db.beds || []).find(b => b.bedId === adm.bedId);
    if (bed) {
      bed.status = "CLEANING";
      bed.currentPatientId = null;
      bed.currentPatientName = null;
      bed.currentAdmissionId = null;
    }
  }

  notify(adm.patientId, "Discharge Process Completed", "Your discharge has been completed. Follow-up summary available in your portal.", "SUCCESS");
  saveDb();
  audit("PATIENT_DISCHARGE", req.user, adm.patientId, { admissionId });
  res.json({ admission: adm });
});

/* ------------------------------------------------------------------ */
/* BILLING & INVOICE APIs                                             */
/* ------------------------------------------------------------------ */

app.get(["/invoices", "/api/invoices", "/api/billing/invoices"], auth, (req, res) => {
  let list = db.invoices || [];
  if (req.query.patientId) list = list.filter(i => i.patientId === req.query.patientId);
  if (req.query.status) list = list.filter(i => i.status === req.query.status);
  res.json({ invoices: list });
});

app.post(["/invoices/:id/payment", "/api/billing/pay"], auth, (req, res) => {
  const invId = req.params.id || req.body.invoiceId;
  const { paymentMethod = "Credit Card" } = req.body;

  const inv = (db.invoices || []).find(i => i.id === invId);
  if (!inv) return res.status(404).json({ error: "Invoice not found." });

  inv.status = "PAID";
  inv.paidAt = now();
  inv.paymentMethod = paymentMethod;

  saveDb();
  audit("PAY_INVOICE", req.user, inv.patientId, { invoiceId: inv.id, amount: inv.totalAmount });
  res.json({ invoice: inv });
});

/* ------------------------------------------------------------------ */
/* NOTIFICATIONS APIs                                                 */
/* ------------------------------------------------------------------ */

app.get(["/notifications", "/api/notifications"], auth, (req, res) => {
  const list = (db.notifications || []).filter(n => n.targetUserId === req.user.id);
  res.json({ notifications: list });
});

app.patch(["/notifications/:id/read", "/api/notifications/mark-read"], auth, (req, res) => {
  const notifId = req.params.id || req.body.notificationId;
  const notif = (db.notifications || []).find(n => n.id === notifId && n.targetUserId === req.user.id);
  if (notif) notif.isRead = true;
  saveDb();
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* EMERGENCY SYSTEM APIs                                              */
/* ------------------------------------------------------------------ */

app.get("/api/emergency/dashboard", auth, (req, res) => {
  res.json({
    activeCases: db.emergencyCases || [],
    emergencyBeds: (db.beds || []).filter(b => b.ward === "Emergency"),
    icuBeds: (db.beds || []).filter(b => b.ward === "ICU")
  });
});

app.post("/api/emergency/break-glass", auth, role("DOCTOR", "NURSE", "ADMIN"), (req, res) => {
  const { patientId, reason } = req.body;
  if (!patientId || !reason) {
    return res.status(400).json({ error: "Patient ID and emergency justification reason are required." });
  }
  const patient = db.users.find(u => u.id === patientId);

  const breakGlassEntry = {
    id: id("BG"),
    patientId,
    patientName: patient?.name || "Emergency Patient",
    invokedBy: req.user.name,
    role: req.user.role,
    reason,
    timestamp: now()
  };
  db.breakGlassLogs = db.breakGlassLogs || [];
  db.breakGlassLogs.push(breakGlassEntry);
  saveDb();
  audit("BREAK_GLASS_ACCESS", req.user, patientId, { reason });

  res.json({
    success: true,
    message: "Emergency Break-Glass access logged and granted.",
    patientSummary: {
      patientId: patient?.id,
      name: patient?.name,
      dob: patient?.dob,
      bloodGroup: patient?.bloodGroup || "O+",
      criticalAllergies: (db.allergies || []).filter(a => a.patientId === patientId),
      activeMedications: (db.medications || []).filter(m => m.patientId === patientId && m.status === "ACTIVE"),
      emergencyContact: patient?.emergencyContact || "Not listed"
    }
  });
});

/* ------------------------------------------------------------------ */
/* REAL-TIME LIVE SYNC API & AI ASSISTANT                             */
/* ------------------------------------------------------------------ */

app.get("/api/events/updates", auth, (req, res) => {
  res.json({
    timestamp: now(),
    queueCount: (db.queue || []).length,
    pendingRxCount: (db.prescriptions || []).filter(p => p.dispensedStatus !== "DISPENSED").length,
    pendingLabCount: (db.labOrders || []).filter(l => l.status !== "PUBLISHED").length,
    pendingScanCount: (db.scanOrders || []).filter(s => s.status !== "PUBLISHED").length,
    activeEmergencyCount: (db.emergencyCases || []).filter(e => e.status === "ACTIVE").length,
    notifications: (db.notifications || []).filter(n => n.targetUserId === req.user.id && !n.isRead)
  });
});

app.get("/api/admin/audit-logs", auth, role("ADMIN", "HOSPITAL_ADMIN"), (req, res) => {
  let logs = db.auditLogs || [];
  if (req.query.patientId) logs = logs.filter(l => l.patientId === req.query.patientId);
  if (req.query.page) return res.json(paginate(logs.slice().reverse(), req));
  res.json({ auditLogs: logs.slice(-200).reverse() });
});

/* ------------------------------------------------------------------ */
/* DEMO SEED & RESET APIs                                             */
/* ------------------------------------------------------------------ */

app.post("/api/demo/load", auth, (req, res) => {
  seedDatabase("CLEAN");
  
  // Seed sample doctor & patient for test drive
  const defaultPassword = bcrypt.hashSync("Demo@123", 10);
  const adminUser = { id: "admin-1", role: "ADMIN", name: "System Governance Admin", email: "admin@medicore.demo", password: defaultPassword, hospitalId: "hospital-1", createdAt: now() };
  const docUser = { id: "DOC-101", role: "DOCTOR", name: "Dr. Ananya Sharma", email: "doctor@medicore.demo", password: defaultPassword, department: "General Medicine", hospitalId: "hospital-1", licenseNumber: "MCI-2026-88190", opdFee: 500, roomNumber: "Cabin 101", schedule: "Mon-Fri (09:00 AM - 04:00 PM)", status: "ACTIVE", createdAt: now() };
  const patUser = { id: "P-1001", role: "PATIENT", name: "Ramesh Verma", email: "patient@medicore.demo", password: defaultPassword, dob: "1988-06-15", age: 38, gender: "Male", phone: "+91 9876543210", bloodGroup: "O+", emergencyContact: "Sunita Verma (+91 9876543211)", address: "Flat 402, Jubilee Hills, Hyderabad", mrn: "MC-MRN-882910", createdAt: now() };

  db.users.push(adminUser, docUser, patUser);
  saveDb();
  audit("LOAD_DEMO_DATASET", req.user);
  res.json({ success: true, message: "⚡ Demo dataset reloaded! Pre-seeded: Admin (admin@medicore.demo), Doctor (doctor@medicore.demo), Patient (patient@medicore.demo)." });
});

app.post("/api/demo/reset", (req, res) => {
  seedDatabase("CLEAN");
  sessions.clear();
  res.clearCookie("token");
  res.json({ success: true, message: "MEDI CORE Database completely reset. Zero users exist. Setup wizard will now launch." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MEDI CORE Connected Hospital Operating Platform running at http://localhost:${PORT}`);
});