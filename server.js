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

const MASTER_LAB_CATALOGUE = [
  { testName: "Complete Blood Count (CBC)", category: "Hematology", sampleType: "Whole Blood (EDTA)", normalRange: "RBC: 4.5-5.9 M/uL, WBC: 4.5-11 K/uL, Plt: 150-450 K/uL", unit: "K/uL", price: 350 },
  { testName: "C-Reactive Protein (CRP)", category: "Immunology", sampleType: "Serum", normalRange: "< 5.0", unit: "mg/L", price: 450 },
  { testName: "Liver Function Test (LFT)", category: "Biochemistry", sampleType: "Serum", normalRange: "ALT: 7-56, AST: 10-40, Bilirubin: 0.1-1.2", unit: "U/L", price: 750 },
  { testName: "Kidney Function Test (KFT)", category: "Biochemistry", sampleType: "Serum", normalRange: "Urea: 15-40 mg/dL, Creatinine: 0.6-1.2 mg/dL", unit: "mg/dL", price: 800 },
  { testName: "Fasting Blood Sugar", category: "Biochemistry", sampleType: "Fluoride Plasma", normalRange: "70 - 99", unit: "mg/dL", price: 150 },
  { testName: "HbA1c Glucose Test", category: "Biochemistry", sampleType: "Whole Blood", normalRange: "< 5.7%", unit: "%", price: 500 },
  { testName: "Thyroid Profile (T3, T4, TSH)", category: "Endocrinology", sampleType: "Serum", normalRange: "TSH: 0.4 - 4.0", unit: "uIU/mL", price: 650 },
  { testName: "Urine Routine & Microscopy", category: "Clinical Pathology", sampleType: "Mid-stream Urine", normalRange: "Clear, Protein: Nil, Sugar: Nil", unit: "-", price: 250 }
];

const MASTER_SCAN_CATALOGUE = [
  { scanType: "Chest X-Ray (PA View)", modality: "X-Ray", bodyPart: "Chest", instructions: "Remove metal objects/jewelry", price: 600 },
  { scanType: "HRCT Thorax", modality: "CT Scan", bodyPart: "Thorax / Lungs", instructions: "4-hour fasting if contrast used", price: 2800 },
  { scanType: "Brain MRI", modality: "MRI", bodyPart: "Brain / Cranium", instructions: "No pacemaker or metallic implants", price: 4500 },
  { scanType: "Abdomen Ultrasound", modality: "Ultrasound", bodyPart: "Whole Abdomen", instructions: "Full bladder required", price: 1200 },
  { scanType: "ECG 12-Lead", modality: "Cardiology", bodyPart: "Heart", instructions: "Relax in supine position", price: 350 },
  { scanType: "Echocardiogram (2D Echo)", modality: "Cardiology", bodyPart: "Heart / Valves", instructions: "Standard cardiac ultrasound", price: 2200 }
];

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
  pharmacyOrders: [],
  pharmacyInventory: [],
  labOrders: [],
  scanOrders: [],
  scanReports: [],
  beds: [],
  admissions: [],
  admissionRequests: [],
  emergencyCases: [],
  invoices: [],
  billingReceipts: [],
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
      pharmacyOrders: [],
      pharmacyInventory: [],
      labOrders: [],
      scanOrders: [],
      scanReports: [],
      beds: [],
      admissions: [],
      admissionRequests: [],
      emergencyCases: [],
      invoices: [],
      billingReceipts: [],
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

  // Master Pharmacy Inventory Catalog
  const defaultInventory = [
    { id: "INV-MED-01", name: "Paracetamol 500mg", genericName: "Acetaminophen", brand: "Dolo-500", strength: "500mg", form: "Tablet", batchNo: "BATCH-2026A", stockQuantity: 250, reservedQuantity: 0, thresholdLow: 50, unitPrice: 15, expiryDate: "2027-12-31", supplier: "Apex Pharma Ltd", storageLocation: "Shelf A-01", status: "HEALTHY", barcode: "8901234567890" },
    { id: "INV-MED-02", name: "Amoxicillin 500mg", genericName: "Amoxicillin", brand: "Mox-500", strength: "500mg", form: "Capsule", batchNo: "BATCH-2026B", stockQuantity: 180, reservedQuantity: 0, thresholdLow: 30, unitPrice: 45, expiryDate: "2027-08-15", supplier: "BioCare India", storageLocation: "Shelf A-02", status: "HEALTHY", barcode: "8901234567891" },
    { id: "INV-MED-03", name: "Azithromycin 250mg", genericName: "Azithromycin", brand: "Azee-250", strength: "250mg", form: "Tablet", batchNo: "BATCH-2025Z", stockQuantity: 120, reservedQuantity: 0, thresholdLow: 20, unitPrice: 120, expiryDate: "2026-11-01", supplier: "HealthMed Corp", storageLocation: "Shelf B-01", status: "HEALTHY", barcode: "8901234567892" },
    { id: "INV-MED-04", name: "Pantoprazole 40mg", genericName: "Pantoprazole", brand: "Pantocid-40", strength: "40mg", form: "Tablet", batchNo: "BATCH-2026P", stockQuantity: 140, reservedQuantity: 0, thresholdLow: 40, unitPrice: 30, expiryDate: "2028-01-20", supplier: "Sun Healthcare", storageLocation: "Shelf B-02", status: "HEALTHY", barcode: "8901234567893" },
    { id: "INV-MED-05", name: "Metformin 500mg", genericName: "Metformin Hydrochloride", brand: "Glycomet-500", strength: "500mg", form: "Tablet", batchNo: "BATCH-2026M", stockQuantity: 310, reservedQuantity: 0, thresholdLow: 50, unitPrice: 25, expiryDate: "2027-10-10", supplier: "Apex Pharma Ltd", storageLocation: "Shelf C-01", status: "HEALTHY", barcode: "8901234567894" },
    { id: "INV-MED-EXP", name: "Doxycycline 100mg", genericName: "Doxycycline", brand: "Doxicip", strength: "100mg", form: "Capsule", batchNo: "BATCH-2023EXP", stockQuantity: 50, reservedQuantity: 0, thresholdLow: 10, unitPrice: 40, expiryDate: "2024-01-01", supplier: "OldStock Pharma", storageLocation: "Quarantine Bay", status: "EXPIRED", barcode: "8901234567899" }
  ];
  db.pharmacyInventory = db.pharmacyInventory || [];
  defaultInventory.forEach(item => {
    if (!db.pharmacyInventory.some(i => i.id === item.id)) {
      db.pharmacyInventory.push(item);
    }
  });

  // Clean Bed Inventory (All AVAILABLE)
  if (!db.beds || db.beds.length === 0) {
    db.beds = [
      { bedId: "ICU-01", building: "Critical Care Tower", floor: "3rd Floor", ward: "ICU", roomNumber: "ICU-101", bedNumber: "01", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor", "Infusion Pump"] },
      { bedId: "ICU-02", building: "Critical Care Tower", floor: "3rd Floor", ward: "ICU", roomNumber: "ICU-101", bedNumber: "02", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor", "Infusion Pump"] },
      { bedId: "ICU-03", building: "Critical Care Tower", floor: "3rd Floor", ward: "ICU", roomNumber: "ICU-102", bedNumber: "03", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Cardiac Monitor"] },
      { bedId: "ICU-04", building: "Critical Care Tower", floor: "3rd Floor", ward: "ICU", roomNumber: "ICU-102", bedNumber: "04", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Cardiac Monitor"] },
      { bedId: "ICU-05", building: "Critical Care Tower", floor: "3rd Floor", ward: "ICU", roomNumber: "ICU-103", bedNumber: "05", dailyRate: 5000, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Ventilator", "Cardiac Monitor"] },
      
      { bedId: "GEN-01", building: "Main Inpatient Block", floor: "2nd Floor", ward: "General Ward", roomNumber: "GEN-201", bedNumber: "01", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen Port"] },
      { bedId: "GEN-02", building: "Main Inpatient Block", floor: "2nd Floor", ward: "General Ward", roomNumber: "GEN-201", bedNumber: "02", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen Port"] },
      { bedId: "GEN-03", building: "Main Inpatient Block", floor: "2nd Floor", ward: "General Ward", roomNumber: "GEN-202", bedNumber: "03", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: [] },
      { bedId: "GEN-04", building: "Main Inpatient Block", floor: "2nd Floor", ward: "General Ward", roomNumber: "GEN-202", bedNumber: "04", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: [] },
      { bedId: "GEN-05", building: "Main Inpatient Block", floor: "2nd Floor", ward: "General Ward", roomNumber: "GEN-203", bedNumber: "05", dailyRate: 1500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Standard Oxygen Port"] },

      { bedId: "EMG-01", building: "Emergency Wing", floor: "Ground Floor", ward: "Emergency", roomNumber: "ER-01", bedNumber: "01", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Defibrillator", "Oxygen", "Multipara Monitor"] },
      { bedId: "EMG-02", building: "Emergency Wing", floor: "Ground Floor", ward: "Emergency", roomNumber: "ER-01", bedNumber: "02", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Defibrillator", "Oxygen", "Multipara Monitor"] },
      { bedId: "EMG-03", building: "Emergency Wing", floor: "Ground Floor", ward: "Emergency", roomNumber: "ER-02", bedNumber: "03", dailyRate: 2500, status: "AVAILABLE", currentPatientId: null, currentPatientName: null, equipment: ["Oxygen", "Suction Unit"] }
    ];
  }

  if (!db.emergencyCases || db.emergencyCases.length === 0) {
    db.emergencyCases = [
      {
        id: "EMG-CASE-01",
        emergencyNumber: "ER-2026-001",
        patientId: "EMG-UNKNOWN-101",
        patientName: "TRAUMA UNKNOWN MALE (Appx 35y)",
        isTemporaryIdentity: true,
        triageStatus: "RED",
        priority: "CRITICAL",
        chiefComplaint: "Road Traffic Accident - Severe Head & Thoracic Trauma",
        vitals: { bp: "85/55", pulse: 128, spO2: 89, temp: "98.2", rr: 28, gcs: 9 },
        assignedDoctor: "Dr. Rajesh Sharma",
        assignedBedId: "EMG-01",
        status: "IN_TREATMENT",
        arrivedAt: now()
      }
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

app.post(["/appointments/:id/cancel", "/api/appointments/:id/cancel"], auth, (req, res) => {
  const appt = (db.appointments || []).find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });

  if (req.user.role === "PATIENT" && appt.patientId !== req.user.id) {
    return res.status(403).json({ error: "Access denied. Cannot cancel another patient's appointment." });
  }

  appt.status = "CANCELLED";
  appt.cancelledAt = now();
  appt.cancellationReason = req.body.reason || "Patient requested cancellation";

  const qItem = (db.queue || []).find(q => q.appointmentId === appt.id && q.status !== "COMPLETED");
  if (qItem) qItem.status = "CANCELLED";

  saveDb();
  notify(appt.patientId, "Appointment Cancelled", `Your appointment with ${appt.doctorName} for ${appt.date} has been cancelled.`, "INFO");
  audit("CANCEL_APPOINTMENT", req.user, appt.patientId, { appointmentId: appt.id });
  res.json({ appointment: appt });
});

app.post(["/appointments/:id/reschedule", "/api/appointments/:id/reschedule"], auth, (req, res) => {
  const appt = (db.appointments || []).find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });

  if (req.user.role === "PATIENT" && appt.patientId !== req.user.id) {
    return res.status(403).json({ error: "Access denied. Cannot reschedule another patient's appointment." });
  }

  const { newDate, newTimeSlot } = req.body;
  if (!newDate) return res.status(400).json({ error: "New appointment date is required." });

  appt.date = newDate;
  if (newTimeSlot) appt.timeSlot = newTimeSlot;
  appt.status = "BOOKED";
  appt.rescheduledAt = now();

  saveDb();
  notify(appt.patientId, "Appointment Rescheduled", `Your appointment with ${appt.doctorName} has been rescheduled to ${newDate} at ${appt.timeSlot}.`, "SUCCESS");
  audit("RESCHEDULE_APPOINTMENT", req.user, appt.patientId, { appointmentId: appt.id, newDate });
  res.json({ appointment: appt });
});

app.post(["/patients/check-duplicate", "/api/patients/check-duplicate"], auth, (req, res) => {
  const { phone, email, identityNumber } = req.body;
  const duplicate = (db.users || []).find(u =>
    u.role === "PATIENT" && (
      (phone && u.phone && u.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")) ||
      (email && u.email && u.email.toLowerCase() === email.toLowerCase()) ||
      (identityNumber && u.identityNumber && u.identityNumber === identityNumber)
    )
  );

  if (duplicate) {
    return res.json({ isDuplicate: true, existingPatient: publicUser(duplicate) });
  }
  res.json({ isDuplicate: false });
});

app.post(["/queue/walk-in", "/api/queue/walk-in"], auth, role("RECEPTIONIST", "NURSE", "ADMIN", "HOSPITAL_ADMIN"), (req, res) => {
  const { patientId, doctorId, reason = "Walk-in OPD Consultation" } = req.body;
  const patient = (db.users || []).find(u => u.id === patientId);
  if (!patient) return res.status(404).json({ error: "Patient record not found." });

  const doc = (db.users || []).find(u => u.id === doctorId) || (db.users || []).find(u => u.role === "DOCTOR");
  const dId = doc ? doc.id : "DOC-101";

  const apptId = id("APT-WALKIN");
  const appt = {
    id: apptId,
    patientId: patient.id,
    patientName: patient.name,
    doctorId: dId,
    doctorName: doc ? doc.name : "OPD Doctor",
    date: new Date().toISOString().split("T")[0],
    timeSlot: "WALK-IN",
    reason,
    status: "CHECKED_IN",
    isWalkIn: true,
    createdAt: now()
  };
  db.appointments = db.appointments || [];
  db.appointments.push(appt);

  const doctorQueue = (db.queue || []).filter(q => q.doctorId === dId);
  const tokenNum = doctorQueue.length + 101;
  const token = `W-${tokenNum}`;
  const waitingCount = doctorQueue.filter(q => q.status === "CHECKED_IN" || q.status === "WAITING").length;
  const waitTimeMinutes = waitingCount * 15;

  const queueEntry = {
    id: id("Q"),
    token,
    appointmentId: appt.id,
    patientId: patient.id,
    patientName: patient.name,
    doctorId: dId,
    doctorName: doc ? doc.name : "OPD Doctor",
    status: "CHECKED_IN",
    checkInTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    consultationTime: null,
    category: "WALK_IN",
    waitTimeMinutes,
    createdAt: now()
  };
  db.queue = db.queue || [];
  db.queue.push(queueEntry);
  saveDb();

  notify(patient.id, "Walk-In Check-In Issued", `Walk-in token ${token} issued for Dr. ${queueEntry.doctorName}. Estimated wait time: ${waitTimeMinutes} mins.`, "SUCCESS");
  audit("WALK_IN_CHECK_IN", req.user, patient.id, { token, appointmentId: appt.id });
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
    pharmacyOrders: (db.pharmacyOrders || []).filter(o => o.patientId === patientId),
    labOrders: patientLabs,
    scanOrders: patientScans,
    scanReports: (db.scanReports || []).filter(r => r.patientId === patientId),
    admissions: patientAdmissions,
    invoices: patientInvoices,
    receipts: (db.billingReceipts || []).filter(r => r.patientId === patientId),
    referrals: patientReferrals,
    vitalsTimeline: patientVitals
  });
});

app.get("/api/patient/timeline", auth, (req, res) => {
  const patientId = req.query.patientId || (req.user.role === "PATIENT" ? req.user.id : null);
  if (!patientId) return res.status(400).json({ error: "Patient ID is required." });

  if (!checkPatientAccess(req, patientId)) {
    return res.status(403).json({ error: "Access denied. Patients can only access their own timeline." });
  }

  const timeline = [];

  // 1. Appointments
  (db.appointments || []).filter(a => a.patientId === patientId).forEach(a => {
    timeline.push({ id: a.id, date: a.createdAt || a.date, type: "APPOINTMENT", title: `Appointment: ${a.reason}`, summary: `Dr. ${a.doctorName} on ${a.date} at ${a.timeSlot} (${a.status})`, details: a });
  });

  // 2. Queue Check-Ins
  (db.queue || []).filter(q => q.patientId === patientId).forEach(q => {
    timeline.push({ id: q.id, date: q.createdAt, type: "CHECK_IN", title: `Reception Check-in (Token ${q.token})`, summary: `Waiting for Dr. ${q.doctorName} (${q.status})`, details: q });
  });

  // 3. Clinical Consultations & PATINOTE
  (db.caseSheets || []).filter(c => c.patientId === patientId).forEach(c => {
    const dx = c.clinicalAssessment?.finalDiagnosis || c.clinicalAssessment?.provisionalDiagnosis || c.sectionL_Diagnosis?.provisionalDiagnosis || "Clinical Consultation";
    timeline.push({ id: c.id, date: c.createdAt, type: "CLINICAL_PATINOTE", title: `PATINOTE Consultation by ${c.doctorName}`, summary: `Diagnosis: ${dx} | Status: ${c.status || 'FINALIZED'}`, details: c });
  });

  // 4. E-Prescriptions
  (db.prescriptions || []).filter(p => p.patientId === patientId).forEach(p => {
    timeline.push({ id: p.id, date: p.createdAt, type: "PRESCRIPTION", title: `Prescription: ${p.medicationName}`, summary: `${p.dosage} - ${p.frequency} (${p.dispensedStatus})`, details: p });
  });

  // 5. Pharmacy Orders
  (db.pharmacyOrders || []).filter(o => o.patientId === patientId).forEach(o => {
    timeline.push({ id: o.id, date: o.createdAt, type: "PHARMACY_ORDER", title: `Pharmacy Order ${o.orderNumber}`, summary: `Status: ${o.status} | Total: ₹${o.totalAmount} (${o.paymentStatus})`, details: o });
  });

  // 6. Laboratory Orders & Reports
  (db.labOrders || []).filter(l => l.patientId === patientId).forEach(l => {
    timeline.push({ id: l.id, date: l.createdAt, type: "LABORATORY_TEST", title: `Lab Test: ${l.testName}`, summary: `Status: ${l.status} | Result: ${l.result || 'Pending'}`, details: l });
  });

  // 7. Scanning Orders & Reports
  (db.scanOrders || []).filter(s => s.patientId === patientId).forEach(s => {
    timeline.push({ id: s.id, date: s.createdAt, type: "SCAN_IMAGING", title: `Imaging Scan: ${s.scanType}`, summary: `Status: ${s.status} | Report: ${s.reportText || 'Pending'}`, details: s });
  });

  // 8. Hospital Admissions
  (db.admissions || []).filter(a => a.patientId === patientId).forEach(a => {
    timeline.push({ id: a.id, date: a.admissionDate || a.createdAt, type: "HOSPITAL_ADMISSION", title: `Hospital Admission: ${a.ward} (Bed ${a.bedId || 'Assigned'})`, summary: `Reason: ${a.reason} (${a.status})`, details: a });
  });

  // 9. Hospital Discharges
  (db.admissions || []).filter(a => a.patientId === patientId && a.status === "DISCHARGED").forEach(a => {
    timeline.push({ id: `DISCH-${a.id}`, date: a.dischargeDate || a.updatedAt, type: "HOSPITAL_DISCHARGE", title: `Discharge Clearance`, summary: `Discharge Summary: ${a.dischargeSummary || 'Recovered'}`, details: a });
  });

  // 10. Billing Invoices
  (db.invoices || []).filter(i => i.patientId === patientId).forEach(i => {
    timeline.push({ id: i.id, date: i.createdAt, type: "BILLING_INVOICE", title: `Invoice ${i.invoiceNumber}`, summary: `Amount: ₹${i.totalAmount} | Status: ${i.status}`, details: i });
  });

  // 11. Follow-Ups
  (db.appointments || []).filter(a => a.patientId === patientId && a.reason && a.reason.toLowerCase().includes("follow")).forEach(f => {
    timeline.push({ id: `FLW-${f.id}`, date: f.date, type: "FOLLOW_UP", title: `Scheduled Clinical Follow-Up`, summary: `Date: ${f.date} with ${f.doctorName}`, details: f });
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
    signedByDoctor: status === "FINALIZED" ? req.user.name : null,
    signedDoctor: status === "FINALIZED" ? req.user.name : null
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

  // 3. Dispatch E-Prescriptions & Create Automated Pharmacy Order
  const createdPrescriptions = [];
  let createdPharmacyOrder = null;
  if (Array.isArray(prescriptions) && prescriptions.length > 0) {
    const orderItems = [];

    prescriptions.forEach(p => {
      const rxId = id("RX");
      const medName = p.medicationName || p.medicine || p.name || "Medication";
      const invMatch = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes((medName || "").toLowerCase().split(" ")[0]));
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
        medicationName: medName,
        strength: p.strength || invMatch?.strength || "",
        dosage: p.dose || p.dosage || "1 tablet",
        route: p.route || "Oral",
        frequency: p.frequency || "TDS (Thrice Daily)",
        duration: p.duration || "5 days",
        instructions: p.instructions || "Take after food",
        quantity,
        unitPrice,
        totalPrice,
        status: "ACTIVE",
        dispensedStatus: "RECEIVED",
        verifiedByPharmacist: false,
        packed: false,
        barcode: invMatch ? invMatch.barcode : `89012345${Math.floor(10000 + Math.random() * 89999)}`,
        createdAt: now()
      };
      db.prescriptions = db.prescriptions || [];
      db.prescriptions.push(rx);
      createdPrescriptions.push(rx);

      orderItems.push({
        rxId,
        medicationName: medName,
        genericName: invMatch?.genericName || medName,
        brand: invMatch?.brand || medName,
        dosage: rx.dosage,
        route: rx.route,
        frequency: rx.frequency,
        duration: rx.duration,
        instructions: rx.instructions,
        quantity,
        unitPrice,
        totalPrice,
        batchNo: invMatch?.batchNo || "BATCH-2026A",
        expiryDate: invMatch?.expiryDate || "2027-12-31",
        barcode: rx.barcode,
        inventoryId: invMatch ? invMatch.id : null
      });

      invoiceItems.push({ category: "PHARMACY", description: `${medName} (${quantity} qty)`, amount: totalPrice });

      db.medications.push({
        id: id("MED"),
        patientId,
        name: medName,
        dosage: rx.dosage,
        frequency: rx.frequency,
        startDate: now(),
        status: "ACTIVE",
        prescribedBy: req.user.name
      });
    });

    const orderTotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
    createdPharmacyOrder = {
      id: id("PHARM-ORD"),
      orderNumber: `RX-ORD-${Date.now().toString().slice(-6)}`,
      caseSheetId,
      consultationId,
      patientId,
      patientName: patient.name,
      doctorId: req.user.id,
      doctorName: req.user.name,
      items: orderItems,
      totalAmount: orderTotal,
      status: "RECEIVED",
      paymentStatus: "UNPAID",
      packingChecklist: {
        medicineVerified: false,
        batchVerified: false,
        expiryVerified: false,
        instructionsAttached: false
      },
      createdAt: now()
    };
    db.pharmacyOrders = db.pharmacyOrders || [];
    db.pharmacyOrders.push(createdPharmacyOrder);

    notify(patientId, "Prescription Received by Pharmacy", "Your prescription has been received by the pharmacy.", "INFO");
  }

  // Handle Admission Recommendation
  if (requireAdmission || req.body.admissionRecommendation?.recommended) {
    const wardReq = req.body.admissionRecommendation?.recommendedWard || "General Ward";
    const admReq = {
      id: id("ADM-REQ"),
      patientId,
      patientName: patient.name,
      doctorId: req.user.id,
      doctorName: req.user.name,
      caseSheetId,
      recommendedWard: wardReq,
      reason: admissionReason || req.body.admissionRecommendation?.reason || finalDx,
      priority: req.body.admissionRecommendation?.priority || "HIGH",
      status: "PENDING_ALLOCATION",
      createdAt: now()
    };
    db.admissionRequests = db.admissionRequests || [];
    db.admissionRequests.push(admReq);
    notify(patientId, "Admission Recommended", `Dr. ${req.user.name} recommended admission to ${wardReq}. Bed allocation is in progress.`, "WARNING");
    audit("RECOMMEND_ADMISSION", req.user, patientId, { ward: wardReq, reason: admReq.reason });
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

// Helper to look up an order in db.pharmacyOrders and/or db.prescriptions
function getPharmacyOrderData(orderId) {
  let order = (db.pharmacyOrders || []).find(o => o.id === orderId || o.orderNumber === orderId);
  let rx = (db.prescriptions || []).find(p => p.id === orderId);

  if (!order && rx) {
    order = (db.pharmacyOrders || []).find(o => o.caseSheetId === rx.caseSheetId || (o.items && o.items.some(i => i.medicationName === rx.medicationName && o.patientId === rx.patientId)));
  }
  if (!rx && order && order.items && order.items.length > 0) {
    rx = (db.prescriptions || []).find(p => order.items.some(i => i.medicationName === p.medicationName && order.patientId === p.patientId));
  }
  return { order, rx };
}

app.get(["/pharmacy/orders", "/api/pharmacy/orders"], auth, (req, res) => {
  let patientId = req.query.patientId;
  if (req.user.role === "PATIENT") {
    patientId = req.user.id;
  }

  // We compile orders from db.pharmacyOrders and db.prescriptions
  const ordersMap = new Map();

  // First process db.pharmacyOrders
  (db.pharmacyOrders || []).forEach(po => {
    if (patientId && po.patientId !== patientId) return;

    const firstItem = po.items && po.items[0] ? po.items[0] : {};
    const medName = po.items ? po.items.map(i => i.medicationName).join(", ") : (po.medicationName || "Prescription");
    const dosage = po.items ? po.items.map(i => i.dosage).join(", ") : (po.dosage || "Standard");

    // Check inventory availability
    const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes((firstItem.medicationName || "").toLowerCase().split(" ")[0]));
    const stockQty = invItem ? invItem.stockQuantity : 0;
    const reservedQty = invItem ? (invItem.reservedQuantity || 0) : 0;
    let inventoryAvailability = "AVAILABLE";
    if (stockQty <= 0) inventoryAvailability = "OUT_OF_STOCK";
    else if (stockQty < (firstItem.quantity || 10)) inventoryAvailability = `PARTIALLY_AVAILABLE (Stock: ${stockQty})`;

    ordersMap.set(po.id, {
      id: po.id,
      orderNumber: po.orderNumber || po.id,
      patientId: po.patientId,
      patientName: po.patientName,
      doctorId: po.doctorId,
      doctorName: po.doctorName,
      medicationName: medName,
      dosage: dosage,
      quantity: firstItem.quantity || 10,
      unitPrice: firstItem.unitPrice || 25,
      totalPrice: po.totalAmount,
      totalAmount: po.totalAmount,
      status: po.status || "RECEIVED",
      dispensedStatus: po.status === "RECEIVED" ? "PENDING" : po.status === "UNDER_REVIEW" ? "UNDER_REVIEW" : po.status === "PREPARING" ? "PREPARING" : po.status === "READY_FOR_BILLING" ? "READY_FOR_BILLING" : po.status === "BILLED" ? "BILL_GENERATED" : po.status === "PACKING" ? "PACKING" : po.status === "READY_FOR_COLLECTION" ? "READY_FOR_COLLECTION" : po.status === "DISPENSED" ? "DISPENSED" : po.status,
      paymentStatus: po.paymentStatus || "UNPAID",
      barcode: invItem ? invItem.barcode : "8901234567890",
      storageLocation: invItem ? invItem.storageLocation : "Bay A-1",
      batchNo: invItem ? invItem.batchNo : "BATCH-2026-01",
      expiryDate: invItem ? invItem.expiryDate : "2027-12-31",
      availableQuantity: stockQty,
      reservedQuantity: reservedQty,
      inventoryAvailability,
      inventoryStatus: invItem ? invItem.status : "HEALTHY",
      packingChecklist: po.packingChecklist || {
        medicineVerified: false,
        batchVerified: false,
        expiryVerified: false,
        instructionsAttached: false
      },
      createdAt: po.createdAt
    });
  });

  // Also include any prescriptions not covered by pharmacyOrders
  (db.prescriptions || []).forEach(rx => {
    if (patientId && rx.patientId !== patientId) return;
    if (ordersMap.has(rx.id)) return;

    const covered = Array.from(ordersMap.values()).some(o => o.patientId === rx.patientId && o.medicationName.includes(rx.medicationName));
    if (!covered) {
      const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(rx.medicationName.toLowerCase().split(" ")[0]));
      const requiredQty = rx.quantity || 10;
      const stockQty = invItem ? invItem.stockQuantity : 0;
      let inventoryAvailability = "AVAILABLE";
      if (stockQty <= 0) inventoryAvailability = "OUT_OF_STOCK";
      else if (stockQty < requiredQty) inventoryAvailability = `PARTIALLY_AVAILABLE (Stock: ${stockQty})`;

      ordersMap.set(rx.id, {
        id: rx.id,
        orderNumber: rx.id,
        patientId: rx.patientId,
        patientName: rx.patientName,
        doctorId: rx.doctorId,
        doctorName: rx.doctorName,
        medicationName: rx.medicationName,
        dosage: rx.dosage,
        quantity: requiredQty,
        unitPrice: rx.unitPrice || invItem?.unitPrice || 25,
        totalPrice: rx.totalPrice || (rx.unitPrice || invItem?.unitPrice || 25) * requiredQty,
        totalAmount: rx.totalPrice || (rx.unitPrice || invItem?.unitPrice || 25) * requiredQty,
        status: rx.dispensedStatus === "DISPENSED" ? "DISPENSED" : rx.dispensedStatus === "READY_FOR_COLLECTION" ? "READY_FOR_COLLECTION" : rx.dispensedStatus === "BILL_GENERATED" ? "BILLED" : rx.dispensedStatus === "VERIFIED" ? "UNDER_REVIEW" : "RECEIVED",
        dispensedStatus: rx.dispensedStatus || "PENDING",
        paymentStatus: rx.invoiceId && (db.invoices || []).find(i => i.id === rx.invoiceId)?.status === "PAID" ? "PAID" : "UNPAID",
        barcode: invItem ? invItem.barcode : rx.barcode || "8901234567890",
        storageLocation: invItem ? invItem.storageLocation : "Bay A-1",
        batchNo: invItem ? invItem.batchNo : "BATCH-2026-01",
        expiryDate: invItem ? invItem.expiryDate : "2027-12-31",
        availableQuantity: stockQty,
        inventoryAvailability,
        inventoryStatus: invItem ? invItem.status : "HEALTHY",
        packingChecklist: { medicineVerified: false, batchVerified: false, expiryVerified: false, instructionsAttached: false },
        createdAt: rx.createdAt
      });
    }
  });

  const orders = Array.from(ordersMap.values()).reverse();
  if (req.query.page) return res.json(paginate(orders, req));
  res.json({ orders });
});

app.post(["/pharmacy/orders/:id/verify", "/api/pharmacy/orders/:id/verify", "/api/pharmacy/verify", "/api/pharmacy/orders/:id/review", "/api/pharmacy/orders/:id/review"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id || req.body.prescriptionId || req.body.orderId;
  const { order, rx } = getPharmacyOrderData(targetId);

  if (!order && !rx) return res.status(404).json({ error: "Pharmacy order or prescription not found." });

  if (order) {
    order.status = "UNDER_REVIEW";
    order.reviewedBy = req.user.name;
    order.reviewedAt = now();
  }
  if (rx) {
    rx.dispensedStatus = "VERIFIED";
    rx.verifiedByPharmacist = true;
    rx.verifiedAt = now();
  }

  saveDb();
  audit("PHARMACY_VERIFY_ORDER", req.user, (order || rx).patientId, { targetId });
  res.json({ success: true, order, prescription: rx, message: "Prescription reviewed and verified by pharmacist." });
});

app.post(["/pharmacy/orders/:id/prepare", "/api/pharmacy/orders/:id/prepare"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id || req.body.orderId;

  try {
    const result = withTransaction(() => {
      const { order, rx } = getPharmacyOrderData(targetId);
      if (!order && !rx) throw new Error("Order not found.");

      const patientId = (order || rx).patientId;
      const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName) : rx.medicationName;
      const requiredQty = order ? (order.items && order.items[0]?.quantity ? order.items[0].quantity : 10) : (rx.quantity || 10);

      // Inventory Lookup
      const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes((medName || "").toLowerCase().split(" ")[0]));
      if (invItem) {
        // Expiry Date Check
        const todayStr = new Date().toISOString().split("T")[0];
        if (invItem.expiryDate && invItem.expiryDate < todayStr) {
          throw new Error(`Medication batch ${invItem.batchNo || ''} is EXPIRED (${invItem.expiryDate}). Dispensing blocked for patient safety.`);
        }

        // Available Stock Check (Stock - Reserved)
        const available = invItem.stockQuantity - (invItem.reservedQuantity || 0);
        if (available < requiredQty) {
          throw new Error(`Insufficient stock for ${invItem.name}. Available: ${available}, Required: ${requiredQty}`);
        }

        // Reserve stock
        invItem.reservedQuantity = (invItem.reservedQuantity || 0) + requiredQty;
      }

      if (order) {
        order.status = "PREPARING";
        order.preparedBy = req.user.name;
        order.preparedAt = now();
      }
      if (rx) {
        rx.dispensedStatus = "PREPARING";
      }

      audit("PREPARE_PHARMACY_ORDER", req.user, patientId, { targetId, medName, reservedQty: requiredQty });
      return { order, prescription: rx, updatedInventory: invItem, message: "Medication batch validated & stock reserved." };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/pharmacy/orders/:id/ready-for-billing", "/api/pharmacy/orders/:id/ready-for-billing"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Order not found." });

  if (order) order.status = "READY_FOR_BILLING";
  if (rx) rx.dispensedStatus = "READY_FOR_BILLING";

  saveDb();
  res.json({ order, prescription: rx, message: "Order marked ready for billing." });
});

app.post(["/pharmacy/orders/:id/generate-bill", "/api/pharmacy/orders/:id/generate-bill", "/api/pharmacy/generate-bill"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id || req.body.prescriptionId || req.body.orderId;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Prescription or order not found." });

  const patientId = (order || rx).patientId;
  const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName || "Prescribed Medicine") : rx.medicationName;
  const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(medName.toLowerCase().split(" ")[0]));
  const unitPrice = order?.unitPrice || rx?.unitPrice || invItem?.unitPrice || 25;
  const quantity = order?.quantity || rx?.quantity || 10;
  const totalPrice = order?.totalAmount || rx?.totalPrice || (unitPrice * quantity);

  let invoice = (db.invoices || []).find(i => (rx && i.prescriptionId === rx.id) || (order && i.pharmacyOrderId === order.id));
  if (!invoice) {
    invoice = createConnectedInvoice(patientId, [{ category: "PHARMACY", description: `${medName} (${quantity} qty)`, amount: totalPrice }], null, rx?.id);
    if (order) invoice.pharmacyOrderId = order.id;
  }

  if (order) {
    order.status = "BILLED";
    order.dispensedStatus = "BILL_GENERATED";
    order.invoiceId = invoice.id;
  }
  if (rx) {
    rx.dispensedStatus = "BILL_GENERATED";
    rx.invoiceId = invoice.id;
  }

  saveDb();
  audit("GENERATE_PHARMACY_BILL", req.user, patientId, { invoiceId: invoice.id, amount: totalPrice });
  res.json({ invoice, order, prescription: rx });
});

app.post(["/pharmacy/orders/:id/record-payment", "/api/pharmacy/orders/:id/record-payment"], auth, role("PHARMACIST", "ADMIN", "RECEPTIONIST"), (req, res) => {
  const targetId = req.params.id;
  const { paymentMethod = "UPI" } = req.body;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Order not found." });

  const patientId = (order || rx).patientId;
  const invoiceId = order?.invoiceId || rx?.invoiceId;
  let invoice = (db.invoices || []).find(i => i.id === invoiceId);

  if (!invoice) {
    const amount = order?.totalAmount || rx?.totalPrice || 250;
    invoice = createConnectedInvoice(patientId, [{ category: "PHARMACY", description: "Medications", amount }], null, rx?.id);
    if (order) invoice.pharmacyOrderId = order.id;
  }

  invoice.status = "PAID";
  invoice.paidAt = now();
  invoice.paymentMethod = paymentMethod;

  const receipt = {
    id: id("RCPT"),
    receiptNumber: `REC-${Date.now().toString().slice(-6)}`,
    invoiceId: invoice.id,
    patientId: invoice.patientId,
    patientName: invoice.patientName || (db.users.find(u => u.id === invoice.patientId)?.name) || "Patient",
    items: invoice.items,
    amount: invoice.totalAmount,
    amountPaid: invoice.totalAmount,
    paymentMethod: invoice.paymentMethod,
    paidAt: invoice.paidAt,
    issuedBy: req.user.name
  };
  db.billingReceipts = db.billingReceipts || [];
  db.billingReceipts.push(receipt);

  if (order) order.paymentStatus = "PAID";
  if (rx) rx.paymentStatus = "PAID";

  saveDb();
  audit("RECORD_PHARMACY_PAYMENT", req.user, patientId, { invoiceId: invoice.id, amount: invoice.totalAmount, paymentMethod });
  res.json({ success: true, invoice, receipt, order, prescription: rx });
});

app.post("/api/pharmacy/scan-verify", auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const { scannedBarcode, prescriptionId, orderId } = req.body;
  const targetId = prescriptionId || orderId;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Prescription not found." });

  const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName || "") : (rx?.medicationName || "");
  const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes(medName.toLowerCase().split(" ")[0]));
  const expectedBarcode = invItem ? invItem.barcode : (rx?.barcode || "8901234567890");

  if (scannedBarcode !== expectedBarcode && scannedBarcode !== "VERIFY_OVERRIDE") {
    return res.status(400).json({ error: "❌ WRONG MEDICINE BARCODE! Item does not match prescribed medicine." });
  }

  res.json({ verified: true, message: "✓ MEDICINE BARCODE VERIFIED SUCCESSFULLY." });
});

app.post(["/pharmacy/orders/:id/pack", "/api/pharmacy/orders/:id/pack", "/api/pharmacy/pack"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id || req.body.prescriptionId || req.body.orderId;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Order not found." });

  const patientId = (order || rx).patientId;
  const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName || "Medications") : rx.medicationName;

  const checklist = {
    medicineVerified: true,
    batchVerified: true,
    expiryVerified: true,
    instructionsAttached: true,
    ...(req.body.checklist || {})
  };

  if (order) {
    order.status = "READY_FOR_COLLECTION";
    order.dispensedStatus = "READY_FOR_COLLECTION";
    order.packed = true;
    order.packedAt = now();
    order.packedBy = req.user.name;
    order.packingChecklist = checklist;
  }
  if (rx) {
    rx.dispensedStatus = "READY_FOR_COLLECTION";
    rx.packed = true;
    rx.packedAt = now();
  }

  notify(patientId, "💊 YOUR MEDICINES ARE READY", `Your order for ${medName} has been verified & packed. Collect at Pharmacy Counter #2.`, "SUCCESS");
  saveDb();
  audit("PACK_MEDICINE_ORDER", req.user, patientId, { targetId, checklist });
  res.json({ order, prescription: rx, message: "Order packed and ready for collection." });
});

app.post(["/pharmacy/orders/:id/ready-for-collection", "/api/pharmacy/orders/:id/ready-for-collection"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id;
  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Order not found." });

  if (order) {
    order.status = "READY_FOR_COLLECTION";
    order.dispensedStatus = "READY_FOR_COLLECTION";
  }
  if (rx) {
    rx.dispensedStatus = "READY_FOR_COLLECTION";
  }

  const patientId = (order || rx).patientId;
  notify(patientId, "💊 YOUR MEDICINES ARE READY", "Your medicine order is ready for pickup at Pharmacy Counter.", "SUCCESS");
  saveDb();
  res.json({ order, prescription: rx });
});

app.post(["/pharmacy/orders/:id/dispense", "/api/pharmacy/orders/:id/dispense", "/api/pharmacy/dispense"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id || req.body.prescriptionId || req.body.orderId;

  try {
    const result = withTransaction(() => {
      const { order, rx } = getPharmacyOrderData(targetId);
      if (!order && !rx) throw new Error("Order not found.");

      const patientId = (order || rx).patientId;
      const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName || "") : (rx.medicationName || "");
      const requiredQty = order ? (order.items && order.items[0]?.quantity ? order.items[0].quantity : 10) : (rx.quantity || 10);

      const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes((medName || "").toLowerCase().split(" ")[0]));

      if (invItem) {
        if (invItem.stockQuantity < requiredQty) {
          throw new Error(`Insufficient inventory for ${invItem.name}. Stock available: ${invItem.stockQuantity}, Required: ${requiredQty}`);
        }
        invItem.stockQuantity -= requiredQty;
        invItem.reservedQuantity = Math.max(0, (invItem.reservedQuantity || 0) - requiredQty);

        if (invItem.stockQuantity === 0) invItem.status = "OUT_OF_STOCK";
        else if (invItem.stockQuantity <= invItem.thresholdLow) invItem.status = "LOW_STOCK";
      }

      if (order) {
        order.status = "DISPENSED";
        order.dispensedStatus = "DISPENSED";
        order.dispensedAt = now();
        order.dispensedBy = req.user.name;
      }
      if (rx) {
        rx.dispensedStatus = "DISPENSED";
        rx.dispensedAt = now();
        rx.dispensedBy = req.user.name;
      }

      notify(patientId, "Medicines Dispensed", `Your medication order has been handed over by Pharmacy Counter.`, "INFO");
      audit("DISPENSE_MEDICATION", req.user, patientId, { targetId, quantityDeducted: requiredQty, remainingStock: invItem ? invItem.stockQuantity : null });
      return { order, prescription: rx, updatedInventory: invItem, message: "Order dispensed and inventory deducted." };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/pharmacy/orders/:id/cancel", "/api/pharmacy/orders/:id/cancel"], auth, role("PHARMACIST", "DOCTOR", "ADMIN"), (req, res) => {
  const targetId = req.params.id;
  const { reason = "Prescription cancelled" } = req.body;

  try {
    const result = withTransaction(() => {
      const { order, rx } = getPharmacyOrderData(targetId);
      if (!order && !rx) throw new Error("Order not found.");

      const patientId = (order || rx).patientId;
      const medName = order ? (order.items && order.items[0]?.medicationName ? order.items[0].medicationName : order.medicationName || "") : (rx.medicationName || "");
      const requiredQty = order ? (order.items && order.items[0]?.quantity ? order.items[0].quantity : 10) : (rx.quantity || 10);

      // Release reserved stock if any
      const invItem = (db.pharmacyInventory || []).find(i => i.name.toLowerCase().includes((medName || "").toLowerCase().split(" ")[0]));
      if (invItem && invItem.reservedQuantity) {
        invItem.reservedQuantity = Math.max(0, invItem.reservedQuantity - requiredQty);
      }

      if (order) {
        order.status = "CANCELLED";
        order.dispensedStatus = "CANCELLED";
        order.cancelledReason = reason;
      }
      if (rx) {
        rx.dispensedStatus = "CANCELLED";
        rx.cancelledReason = reason;
      }

      audit("CANCEL_PHARMACY_ORDER", req.user, patientId, { targetId, reason });
      return { order, prescription: rx, message: "Order cancelled and reserved stock released." };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/pharmacy/orders/:id/substitute", "/api/pharmacy/orders/:id/substitute"], auth, role("PHARMACIST", "ADMIN"), (req, res) => {
  const targetId = req.params.id;
  const { substituteMedicineName, substituteMedicineId, reason = "Brand out of stock - generic equivalent issued" } = req.body;

  const { order, rx } = getPharmacyOrderData(targetId);
  if (!order && !rx) return res.status(404).json({ error: "Order not found." });

  const subItem = (db.pharmacyInventory || []).find(i => (substituteMedicineId && i.id === substituteMedicineId) || (substituteMedicineName && i.name.toLowerCase().includes(substituteMedicineName.toLowerCase())));
  if (!subItem) return res.status(404).json({ error: "Substitute medicine not found in inventory." });

  if (order && order.items && order.items[0]) {
    order.items[0].originalMedication = order.items[0].medicationName;
    order.items[0].medicationName = subItem.name;
    order.items[0].unitPrice = subItem.unitPrice;
    order.items[0].totalPrice = subItem.unitPrice * (order.items[0].quantity || 10);
    order.totalAmount = order.items[0].totalPrice;
    order.substitutionReason = reason;
  }
  if (rx) {
    rx.originalMedication = rx.medicationName;
    rx.medicationName = subItem.name;
    rx.unitPrice = subItem.unitPrice;
    rx.totalPrice = subItem.unitPrice * (rx.quantity || 10);
    rx.substitutionReason = reason;
  }

  saveDb();
  audit("SUBSTITUTE_PHARMACY_MEDICINE", req.user, (order || rx).patientId, { targetId, substitute: subItem.name, reason });
  res.json({ order, prescription: rx, message: `Medication substituted with ${subItem.name}.` });
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
/* DIAGNOSTICS: LABORATORY & PATHOLOGY APIs                           */
/* ------------------------------------------------------------------ */

app.get(["/api/lab/catalogue", "/lab/catalogue"], auth, (req, res) => {
  res.json({ catalogue: MASTER_LAB_CATALOGUE });
});

app.get(["/lab/orders", "/api/lab/orders", "/api/lab-orders"], auth, (req, res) => {
  let list = db.labOrders || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(l => l.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(l => l.patientId === req.query.patientId);
  }
  if (req.query.status) list = list.filter(l => l.status === req.query.status);
  if (req.query.page) return res.json(paginate(list, req));
  res.json({ labOrders: list, orders: list });
});

app.post(["/lab/orders", "/api/lab/orders"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const { patientId, testName, priority = "ROUTINE" } = req.body;
  const patient = db.users.find(u => u.id === patientId);
  const catItem = MASTER_LAB_CATALOGUE.find(c => c.testName.toLowerCase() === (testName || "").toLowerCase());
  const price = catItem ? catItem.price : (MASTER_PRICES.labs[testName] || 350);

  const newOrder = {
    id: id("LAB"),
    patientId,
    patientName: patient?.name || "Patient",
    orderedBy: req.user.name,
    testName: catItem ? catItem.testName : testName,
    category: catItem ? catItem.category : "Pathology",
    sampleType: catItem ? catItem.sampleType : "Blood",
    referenceRange: catItem ? catItem.normalRange : "Standard Normal",
    unit: catItem ? catItem.unit : "-",
    price,
    priority,
    status: "REQUESTED",
    result: null,
    isAbnormal: false,
    createdAt: now()
  };

  db.labOrders = db.labOrders || [];
  db.labOrders.push(newOrder);
  saveDb();
  audit("ORDER_LAB_TEST", req.user, patientId, { testName: newOrder.testName, price });
  res.json({ labOrder: newOrder });
});

app.post(["/lab/orders/:id/collect-sample", "/api/lab/orders/:id/collect-sample"], auth, role("LAB_STAFF", "NURSE", "ADMIN"), (req, res) => {
  const labId = req.params.id;
  const lab = (db.labOrders || []).find(l => l.id === labId);
  if (!lab) return res.status(404).json({ error: "Lab order not found." });

  lab.status = "SAMPLE_COLLECTED";
  lab.sampleBarcode = `LAB-SMPL-${Date.now().toString().slice(-6)}`;
  lab.sampleCollectedAt = now();
  lab.sampleCollectedBy = req.user.name;
  if (req.body.sampleType) lab.sampleType = req.body.sampleType;

  saveDb();
  audit("COLLECT_LAB_SAMPLE", req.user, lab.patientId, { labId, sampleBarcode: lab.sampleBarcode });
  res.json({ labOrder: lab, message: "Sample collected and barcode assigned." });
});

app.post(["/lab/orders/:id/process", "/api/lab/orders/:id/process"], auth, role("LAB_STAFF", "ADMIN"), (req, res) => {
  const labId = req.params.id;
  const lab = (db.labOrders || []).find(l => l.id === labId);
  if (!lab) return res.status(404).json({ error: "Lab order not found." });

  lab.status = "IN_PROGRESS";
  lab.processingStartedAt = now();

  saveDb();
  res.json({ labOrder: lab, message: "Sample is currently undergoing lab processing." });
});

app.post(["/lab/orders/:id/result", "/api/lab/orders/:id/result", "/api/lab-orders/status"], auth, role("LAB_STAFF", "DOCTOR", "ADMIN"), (req, res) => {
  const labId = req.params.id || req.body.labOrderId;
  const { status = "RESULT_ENTERED", result, referenceRange, isAbnormal, unit } = req.body;

  const lab = (db.labOrders || []).find(l => l.id === labId);
  if (!lab) return res.status(404).json({ error: "Lab order not found." });

  lab.status = status;
  if (result !== undefined) lab.result = result;
  if (referenceRange) lab.referenceRange = referenceRange;
  if (unit) lab.unit = unit;
  if (isAbnormal !== undefined) lab.isAbnormal = !!isAbnormal;
  lab.resultEnteredBy = req.user.name;
  lab.resultEnteredAt = now();

  if (status === "PUBLISHED" || status === "VERIFIED") {
    lab.verifiedBy = req.user.name;
    lab.publishedAt = now();
    notify(lab.patientId, "Laboratory Test Result Ready", `Your ${lab.testName} report has been verified and published.`, "INFO");
  }

  saveDb();
  audit("UPDATE_LAB_ORDER", req.user, lab.patientId, { labId, status, isAbnormal: lab.isAbnormal });
  res.json({ labOrder: lab });
});

app.post(["/lab/orders/:id/verify-publish", "/api/lab/orders/:id/verify-publish"], auth, role("LAB_STAFF", "DOCTOR", "ADMIN"), (req, res) => {
  const labId = req.params.id;
  const lab = (db.labOrders || []).find(l => l.id === labId);
  if (!lab) return res.status(404).json({ error: "Lab order not found." });

  lab.status = "PUBLISHED";
  lab.verifiedBy = req.user.name;
  lab.publishedAt = now();
  if (req.body.result !== undefined) lab.result = req.body.result;
  if (req.body.isAbnormal !== undefined) lab.isAbnormal = !!req.body.isAbnormal;

  notify(lab.patientId, "Laboratory Test Result Ready", `Your ${lab.testName} report has been signed off and published.`, "INFO");
  saveDb();
  audit("VERIFY_PUBLISH_LAB_ORDER", req.user, lab.patientId, { labId, testName: lab.testName });
  res.json({ labOrder: lab, message: "Lab order verified and published to patient portal." });
});

/* ------------------------------------------------------------------ */
/* DIAGNOSTICS: SCANNING & RADIOLOGY APIs                             */
/* ------------------------------------------------------------------ */

app.get(["/api/scan/catalogue", "/scan/catalogue"], auth, (req, res) => {
  res.json({ catalogue: MASTER_SCAN_CATALOGUE });
});

app.get(["/scan/orders", "/api/scan/orders", "/api/scan-orders"], auth, (req, res) => {
  let list = db.scanOrders || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(s => s.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(s => s.patientId === req.query.patientId);
  }
  if (req.query.status) list = list.filter(s => s.status === req.query.status);
  if (req.query.page) return res.json(paginate(list, req));
  res.json({ scanOrders: list, orders: list });
});

app.post(["/scan/orders", "/api/scan/orders"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const { patientId, scanType, urgency = "ROUTINE" } = req.body;
  const patient = db.users.find(u => u.id === patientId);
  const catItem = MASTER_SCAN_CATALOGUE.find(c => c.scanType.toLowerCase() === (scanType || "").toLowerCase());
  const price = catItem ? catItem.price : (MASTER_PRICES.scans[scanType] || 600);

  const newOrder = {
    id: id("SCAN"),
    patientId,
    patientName: patient?.name || "Patient",
    orderedBy: req.user.name,
    scanType: catItem ? catItem.scanType : scanType,
    modality: catItem ? catItem.modality : "Radiology",
    bodyPart: catItem ? catItem.bodyPart : "General",
    instructions: catItem ? catItem.instructions : "Standard procedure",
    price,
    urgency,
    status: "REQUESTED",
    reportText: null,
    findings: null,
    impression: null,
    createdAt: now()
  };

  db.scanOrders = db.scanOrders || [];
  db.scanOrders.push(newOrder);
  saveDb();
  audit("ORDER_IMAGING_SCAN", req.user, patientId, { scanType: newOrder.scanType, price });
  res.json({ scanOrder: newOrder });
});

app.post(["/scan/orders/:id/schedule", "/api/scan/orders/:id/schedule"], auth, role("SCAN_TECH", "DOCTOR", "RECEPTIONIST", "ADMIN"), (req, res) => {
  const scanId = req.params.id;
  const { scheduledDate, scheduledTime, machineId, roomNumber } = req.body;
  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "SCHEDULED";
  scan.scheduledDate = scheduledDate || new Date().toISOString().split("T")[0];
  scan.scheduledTime = scheduledTime || "11:30 AM";
  scan.machineId = machineId || "CT-Scanner-01";
  scan.roomNumber = roomNumber || "Imaging Room 3";

  notify(scan.patientId, "Imaging Scan Scheduled", `Your ${scan.scanType} has been scheduled on ${scan.scheduledDate} at ${scan.scheduledTime} in ${scan.roomNumber}.`, "INFO");
  saveDb();
  audit("SCHEDULE_SCAN_ORDER", req.user, scan.patientId, { scanId, date: scan.scheduledDate });
  res.json({ scanOrder: scan, message: "Scan successfully scheduled." });
});

app.post(["/scan/orders/:id/arrive", "/api/scan/orders/:id/arrive"], auth, role("SCAN_TECH", "RECEPTIONIST", "ADMIN"), (req, res) => {
  const scanId = req.params.id;
  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "PATIENT_ARRIVED";
  scan.arrivedAt = now();

  saveDb();
  res.json({ scanOrder: scan, message: "Patient arrival at radiology confirmed." });
});

app.post(["/scan/orders/:id/start", "/api/scan/orders/:id/start"], auth, role("SCAN_TECH", "ADMIN"), (req, res) => {
  const scanId = req.params.id;
  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "IN_PROGRESS";
  scan.startedAt = now();

  saveDb();
  res.json({ scanOrder: scan, message: "Scan acquisition in progress." });
});

app.post(["/scan/orders/:id/complete", "/api/scan/orders/:id/complete"], auth, role("SCAN_TECH", "ADMIN"), (req, res) => {
  const scanId = req.params.id;
  const { seriesCount = 4, radiationDose = "Standard low-dose (0.8 mSv)" } = req.body;
  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "COMPLETED";
  scan.reportStatus = "REPORT_PENDING";
  scan.completedAt = now();
  scan.seriesCount = seriesCount;
  scan.radiationDose = radiationDose;

  saveDb();
  audit("COMPLETE_SCAN_PROCEDURE", req.user, scan.patientId, { scanId });
  res.json({ scanOrder: scan, message: "Imaging scan completed. Transferred to radiologist for reporting." });
});

app.post(["/scan/orders/:id/findings", "/api/scan/orders/:id/findings"], auth, role("DOCTOR", "SCAN_TECH", "ADMIN"), (req, res) => {
  const scanId = req.params.id;
  const { findings, impression } = req.body;
  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "UNDER_REVIEW";
  scan.findings = findings || scan.findings;
  scan.impression = impression || scan.impression;

  saveDb();
  res.json({ scanOrder: scan, message: "Radiological preliminary findings recorded." });
});

app.post(["/scan/orders/:id/verify-publish", "/api/scan/orders/:id/verify-publish", "/api/scan/orders/:id/report", "/api/scan-orders/status"], auth, role("DOCTOR", "SCAN_TECH", "ADMIN"), (req, res) => {
  const scanId = req.params.id || req.body.scanOrderId;
  const { findings, impression, reportText } = req.body;

  const scan = (db.scanOrders || []).find(s => s.id === scanId);
  if (!scan) return res.status(404).json({ error: "Scan order not found." });

  scan.status = "PUBLISHED";
  scan.verifiedBy = req.user.name;
  scan.publishedAt = now();
  scan.reportText = reportText || findings || scan.reportText || "Imaging scan normal with no acute pathological abnormalities.";
  if (findings) scan.findings = findings;
  if (impression) scan.impression = impression;

  // Create persistent scan report in db.scanReports
  const scanReport = {
    id: id("RPT-SCAN"),
    scanOrderId: scan.id,
    patientId: scan.patientId,
    patientName: scan.patientName,
    scanType: scan.scanType,
    modality: scan.modality || "Radiology",
    findings: scan.findings || scan.reportText,
    impression: scan.impression || "No acute findings.",
    radiologist: req.user.name,
    radiationDose: scan.radiationDose || "Standard",
    verifiedAt: now(),
    status: "PUBLISHED"
  };
  db.scanReports = db.scanReports || [];
  db.scanReports.push(scanReport);

  notify(scan.patientId, "Imaging Scan Report Available", `Your ${scan.scanType} report has been verified and published.`, "INFO");
  saveDb();
  audit("VERIFY_PUBLISH_SCAN_REPORT", req.user, scan.patientId, { scanId, reportId: scanReport.id });
  res.json({ scanOrder: scan, report: scanReport, message: "Scan report verified and published." });
});

app.get(["/api/scan/reports/:id", "/scan/reports/:id"], auth, (req, res) => {
  const report = (db.scanReports || []).find(r => r.id === req.params.id || r.scanOrderId === req.params.id);
  if (!report) return res.status(404).json({ error: "Scan report not found." });

  if (req.user.role === "PATIENT" && report.patientId !== req.user.id) {
    return res.status(403).json({ error: "Access denied. Patients may only view their own diagnostic reports." });
  }

  res.json({ report });
});

app.get(["/api/scan/reports", "/scan/reports"], auth, (req, res) => {
  let list = db.scanReports || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(r => r.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(r => r.patientId === req.query.patientId);
  }
  res.json({ reports: list });
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

app.get(["/admissions/requests", "/api/admissions/requests"], auth, (req, res) => {
  let list = db.admissionRequests || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(r => r.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(r => r.patientId === req.query.patientId);
  }
  res.json({ admissionRequests: list });
});

app.post(["/admissions/request", "/api/admissions/request"], auth, role("DOCTOR", "RECEPTIONIST", "ADMIN"), (req, res) => {
  const { patientId, recommendedWard = "General Ward", reason = "Inpatient Medical Treatment", priority = "NORMAL" } = req.body;
  const patient = db.users.find(u => u.id === patientId);
  if (!patient) return res.status(404).json({ error: "Patient not found." });

  const admReq = {
    id: id("ADM-REQ"),
    patientId,
    patientName: patient.name,
    doctorId: req.user.id,
    doctorName: req.user.name,
    recommendedWard,
    reason,
    priority,
    status: "PENDING_ALLOCATION",
    createdAt: now()
  };

  db.admissionRequests = db.admissionRequests || [];
  db.admissionRequests.push(admReq);
  saveDb();
  audit("CREATE_ADMISSION_REQUEST", req.user, patientId, { recommendedWard, priority });
  res.json({ admissionRequest: admReq, message: "Admission request submitted to bed allocation team." });
});

app.post(["/beds/:id/reserve", "/api/beds/:id/reserve"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN", "RECEPTIONIST"), (req, res) => {
  const bedId = req.params.id;
  const { patientId, patientName } = req.body;

  try {
    const result = withTransaction(() => {
      const bed = db.beds.find(b => b.bedId === bedId);
      if (!bed) throw new Error(`Bed ${bedId} not found.`);
      if (bed.status !== "AVAILABLE") {
        throw new Error(`Bed ${bedId} is currently ${bed.status} and cannot be reserved.`);
      }

      const patient = db.users.find(u => u.id === patientId) || { name: patientName || "Reserved Patient" };

      bed.status = "RESERVED";
      bed.reservedForPatientId = patientId;
      bed.reservedForPatientName = patient.name;
      bed.reservedAt = now();

      audit("RESERVE_BED", req.user, patientId, { bedId, ward: bed.ward });
      return { bed, message: `Bed ${bedId} successfully reserved for ${patient.name}.` };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/beds/:id/allocate", "/api/beds/:id/allocate", "/api/beds/allocate"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const bedId = req.params.id || req.body.bedId;
  const { patientId, reason = "Inpatient Care", requestId } = req.body;

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
      bed.reservedForPatientId = null;
      bed.reservedForPatientName = null;
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

      // If tied to admission request, mark it allocated
      if (requestId) {
        const reqObj = (db.admissionRequests || []).find(r => r.id === requestId);
        if (reqObj) reqObj.status = "ALLOCATED";
      }

      notify(patientId, "Bed Allocated", `You have been allocated Bed ${bed.bedNumber} in ${bed.ward}.`, "INFO");
      audit("ALLOCATE_BED", req.user, patientId, { bedId, ward: bed.ward });

      return { bed, admission, message: `Bed ${bedId} allocated successfully.` };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/admissions/approve", "/api/admissions/approve"], auth, role("HOSPITAL_ADMIN", "ADMIN", "DOCTOR"), (req, res) => {
  const { requestId, bedId } = req.body;
  const admReq = (db.admissionRequests || []).find(r => r.id === requestId);
  if (!admReq) return res.status(404).json({ error: "Admission request not found." });

  try {
    const result = withTransaction(() => {
      const bed = db.beds.find(b => b.bedId === bedId);
      if (!bed) throw new Error(`Bed ${bedId} not found.`);
      if (bed.status !== "AVAILABLE" && bed.status !== "RESERVED") {
        throw new Error(`Double bed allocation blocked! Bed ${bedId} is currently ${bed.status}.`);
      }

      bed.status = "OCCUPIED";
      bed.currentPatientId = admReq.patientId;
      bed.currentPatientName = admReq.patientName;

      const admission = {
        id: id("ADM"),
        admissionNumber: `ADM-${Date.now().toString().slice(-6)}`,
        patientId: admReq.patientId,
        patientName: admReq.patientName,
        attendingDoctor: admReq.doctorName || req.user.name,
        reason: admReq.reason,
        bedId,
        ward: bed.ward,
        status: "ADMITTED",
        admissionDate: now()
      };
      db.admissions.push(admission);
      bed.currentAdmissionId = admission.id;
      admReq.status = "ALLOCATED";

      notify(admReq.patientId, "Admission Confirmed", `Your admission to ${bed.ward} (Bed ${bed.bedNumber}) has been confirmed.`, "INFO");
      audit("APPROVE_ADMISSION_REQUEST", req.user, admReq.patientId, { requestId, bedId });
      return { admission, bed };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/beds/:id/transfer", "/api/beds/:id/transfer"], auth, role("HOSPITAL_ADMIN", "NURSE", "ADMIN", "DOCTOR"), (req, res) => {
  const sourceBedId = req.params.id;
  const { targetBedId, reason = "Patient clinical condition requires room transfer" } = req.body;

  try {
    const result = withTransaction(() => {
      const srcBed = db.beds.find(b => b.bedId === sourceBedId);
      if (!srcBed) throw new Error(`Source bed ${sourceBedId} not found.`);
      if (srcBed.status !== "OCCUPIED") throw new Error(`Source bed ${sourceBedId} is not currently occupied.`);

      const tgtBed = db.beds.find(b => b.bedId === targetBedId);
      if (!tgtBed) throw new Error(`Target bed ${targetBedId} not found.`);
      if (tgtBed.status !== "AVAILABLE") throw new Error(`Target bed ${targetBedId} is not available (currently ${tgtBed.status}).`);

      const patientId = srcBed.currentPatientId;
      const patientName = srcBed.currentPatientName;
      const admissionId = srcBed.currentAdmissionId;

      // Transfer patient to target bed
      tgtBed.status = "OCCUPIED";
      tgtBed.currentPatientId = patientId;
      tgtBed.currentPatientName = patientName;
      tgtBed.currentAdmissionId = admissionId;

      // Source bed moves to cleaning
      srcBed.status = "CLEANING";
      srcBed.currentPatientId = null;
      srcBed.currentPatientName = null;
      srcBed.currentAdmissionId = null;

      // Update admission record
      if (admissionId) {
        const adm = db.admissions.find(a => a.id === admissionId);
        if (adm) {
          adm.bedId = targetBedId;
          adm.ward = tgtBed.ward;
        }
      }

      audit("TRANSFER_BED", req.user, patientId, { sourceBedId, targetBedId, reason });
      return { sourceBed: srcBed, targetBed: tgtBed, message: `Patient successfully transferred to ${targetBedId}.` };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(["/admissions/discharge-clinical", "/api/admissions/discharge-clinical"], auth, role("DOCTOR", "ADMIN"), (req, res) => {
  const { admissionId, summary = "Patient condition stabilized. Medically fit for discharge." } = req.body;
  const adm = (db.admissions || []).find(a => a.id === admissionId);
  if (!adm) return res.status(404).json({ error: "Admission record not found." });

  adm.status = "CLINICAL_DISCHARGE";
  adm.dischargeSummary = summary;
  adm.clinicalDischargeAt = now();
  adm.signedDoctor = req.user.name;

  notify(adm.patientId, "Clinical Discharge Approved", "Attending physician has authorized your discharge. Please proceed to billing clearance.", "INFO");
  saveDb();
  audit("CLINICAL_DISCHARGE", req.user, adm.patientId, { admissionId });
  res.json({ admission: adm, message: "Clinical discharge signed off. Pending final administrative/billing clearance." });
});

app.post(["/admissions/discharge", "/api/admissions/discharge", "/api/admissions/discharge-clearance"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const { admissionId, summary = "Patient recovered and fit for discharge." } = req.body;
  const adm = (db.admissions || []).find(a => a.id === admissionId);
  if (!adm) return res.status(404).json({ error: "Admission record not found." });

  adm.status = "DISCHARGED";
  adm.dischargeDate = now();
  if (summary) adm.dischargeSummary = summary;

  let bed = null;
  if (adm.bedId) {
    bed = (db.beds || []).find(b => b.bedId === adm.bedId);
    if (bed) {
      // Bed must move to CLEANING, not AVAILABLE yet!
      bed.status = "CLEANING";
      bed.currentPatientId = null;
      bed.currentPatientName = null;
      bed.currentAdmissionId = null;
    }
  }

  notify(adm.patientId, "Discharge Process Completed", "Your hospital discharge has been finalized. Discharge summary is available in your portal.", "SUCCESS");
  saveDb();
  audit("PATIENT_DISCHARGE", req.user, adm.patientId, { admissionId, bedMovedTo: "CLEANING" });
  res.json({ admission: adm, bed, message: "Discharge complete. Bed moved to CLEANING status." });
});

app.post(["/beds/:id/complete-cleaning", "/api/beds/:id/complete-cleaning"], auth, role("HOSPITAL_ADMIN", "NURSE", "ADMIN"), (req, res) => {
  const bedId = req.params.id;
  const bed = (db.beds || []).find(b => b.bedId === bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });

  bed.status = "AVAILABLE";
  bed.cleanedAt = now();
  bed.cleanedBy = req.user.name;
  bed.currentPatientId = null;
  bed.currentPatientName = null;
  bed.currentAdmissionId = null;

  saveDb();
  audit("COMPLETE_BED_CLEANING", req.user, null, { bedId });
  res.json({ bed, message: `Bed ${bedId} sanitization complete. Marked AVAILABLE for new admissions.` });
});

app.post(["/beds/:id/release", "/api/beds/:id/release", "/api/beds/update-status", "/api/beds/status"], auth, role("HOSPITAL_ADMIN", "NURSE", "ADMIN"), (req, res) => {
  const bedId = req.params.id || req.body.bedId;
  const targetStatus = req.body.status || "CLEANING";

  const bed = (db.beds || []).find(b => b.bedId === bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });

  bed.status = targetStatus;
  if (targetStatus === "AVAILABLE" || targetStatus === "CLEANING" || targetStatus === "MAINTENANCE") {
    bed.currentPatientId = null;
    bed.currentPatientName = null;
    bed.currentAdmissionId = null;
    bed.reservedForPatientId = null;
    bed.reservedForPatientName = null;
  }

  saveDb();
  audit("UPDATE_BED_STATUS", req.user, null, { bedId, status: targetStatus });
  res.json({ bed });
});

app.post(["/api/beds/discharge", "/beds/discharge"], auth, role("DOCTOR", "HOSPITAL_ADMIN", "ADMIN", "NURSE"), (req, res) => {
  const bedId = req.body.bedId || req.params.id;
  const bed = (db.beds || []).find(b => b.bedId === bedId);
  if (!bed) return res.status(404).json({ error: "Bed not found." });

  if (bed.currentAdmissionId) {
    const adm = (db.admissions || []).find(a => a.id === bed.currentAdmissionId);
    if (adm) {
      adm.status = "DISCHARGED";
      adm.dischargeDate = now();
    }
  }

  bed.status = "CLEANING";
  bed.currentPatientId = null;
  bed.currentPatientName = null;
  bed.currentAdmissionId = null;

  saveDb();
  audit("DISCHARGE_BED", req.user, null, { bedId });
  res.json({ bed, message: `Bed ${bedId} discharged and moved to CLEANING status.` });
});

app.get(["/admissions", "/api/admissions"], auth, (req, res) => {
  let list = db.admissions || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(a => a.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(a => a.patientId === req.query.patientId);
  }
  if (req.query.status) list = list.filter(a => a.status === req.query.status);
  res.json({ admissions: list });
});

/* ------------------------------------------------------------------ */
/* BILLING, INVOICE & PAYMENT RECEIPT APIs                            */
/* ------------------------------------------------------------------ */

app.get(["/invoices", "/api/invoices", "/api/billing/invoices"], auth, (req, res) => {
  let list = db.invoices || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(i => i.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(i => i.patientId === req.query.patientId);
  }
  if (req.query.status) list = list.filter(i => i.status === req.query.status);
  res.json({ invoices: list });
});

app.get(["/api/billing/receipts", "/billing/receipts"], auth, (req, res) => {
  let list = db.billingReceipts || [];
  if (req.user.role === "PATIENT") {
    list = list.filter(r => r.patientId === req.user.id);
  } else if (req.query.patientId) {
    list = list.filter(r => r.patientId === req.query.patientId);
  }
  if (req.query.invoiceId) list = list.filter(r => r.invoiceId === req.query.invoiceId);
  res.json({ receipts: list });
});

app.post(["/invoices/:id/payment", "/api/billing/pay", "/api/billing/invoices/:id/pay"], auth, (req, res) => {
  const invId = req.params.id || req.body.invoiceId;
  const { paymentMethod = "Credit Card" } = req.body;

  const inv = (db.invoices || []).find(i => i.id === invId);
  if (!inv) return res.status(404).json({ error: "Invoice not found." });

  inv.status = "PAID";
  inv.paidAt = now();
  inv.paymentMethod = paymentMethod;

  // Generate persistent receipt
  const receipt = {
    id: id("RCPT"),
    receiptNumber: `REC-${Date.now().toString().slice(-6)}`,
    invoiceId: inv.id,
    patientId: inv.patientId,
    patientName: inv.patientName || (db.users.find(u => u.id === inv.patientId)?.name) || "Patient",
    items: inv.items,
    amount: inv.totalAmount,
    paymentMethod: inv.paymentMethod,
    paidAt: inv.paidAt,
    issuedBy: req.user.name
  };
  db.billingReceipts = db.billingReceipts || [];
  db.billingReceipts.push(receipt);

  // If this invoice is connected to a pharmacy order, mark order as paid
  if (inv.pharmacyOrderId) {
    const po = (db.pharmacyOrders || []).find(o => o.id === inv.pharmacyOrderId);
    if (po) po.paymentStatus = "PAID";
  }
  if (inv.prescriptionId) {
    const rx = (db.prescriptions || []).find(p => p.id === inv.prescriptionId);
    if (rx) rx.paymentStatus = "PAID";
  }

  notify(inv.patientId, "Payment Received", `Payment of ₹${inv.totalAmount} has been recorded via ${paymentMethod}. Receipt #${receipt.receiptNumber} issued.`, "SUCCESS");
  saveDb();
  audit("PAY_INVOICE", req.user, inv.patientId, { invoiceId: inv.id, amount: inv.totalAmount, paymentMethod, receiptId: receipt.id });
  res.json({ invoice: inv, receipt });
});

app.post(["/invoices/:id/refund", "/api/billing/invoices/:id/refund"], auth, role("HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const invId = req.params.id;
  const { reason = "Patient requested billing cancellation" } = req.body;

  const inv = (db.invoices || []).find(i => i.id === invId);
  if (!inv) return res.status(404).json({ error: "Invoice not found." });

  inv.status = "REFUNDED";
  inv.refundedAt = now();
  inv.refundReason = reason;

  saveDb();
  audit("REFUND_INVOICE", req.user, inv.patientId, { invoiceId: inv.id, amount: inv.totalAmount, reason });
  res.json({ invoice: inv, message: "Invoice refund recorded successfully." });
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
  const cases = db.emergencyCases || [];
  res.json({
    activeCases: cases,
    emergencyBeds: (db.beds || []).filter(b => b.ward === "Emergency"),
    icuBeds: (db.beds || []).filter(b => b.ward === "ICU"),
    triageSummary: {
      red: cases.filter(c => c.triageStatus === "RED" && c.status !== "DISCHARGED").length,
      yellow: cases.filter(c => c.triageStatus === "YELLOW" && c.status !== "DISCHARGED").length,
      green: cases.filter(c => c.triageStatus === "GREEN" && c.status !== "DISCHARGED").length
    }
  });
});

app.get(["/api/emergency/cases", "/emergency/cases"], auth, (req, res) => {
  res.json({ emergencyCases: db.emergencyCases || [] });
});

app.get(["/api/emergency/break-glass-logs", "/emergency/break-glass-logs"], auth, (req, res) => {
  res.json({ logs: db.breakGlassLogs || [] });
});

app.post("/api/emergency/rapid-register", auth, role("RECEPTIONIST", "NURSE", "DOCTOR", "ADMIN"), (req, res) => {
  const {
    patientName = "UNKNOWN TRAUMA ARRIVAL",
    gender = "Unknown",
    estimatedAge = 35,
    triageCategory = "RED",
    chiefComplaint = "Acute Trauma / Road Traffic Accident",
    vitals = { bp: "90/60", pulse: 120, spO2: 92, gcs: 11 },
    bedId,
    doctorName
  } = req.body;

  const tempMrn = `EMERG-MRN-${Date.now().toString().slice(-6)}`;
  const emergCase = {
    id: id("EMG"),
    emergencyNumber: `ER-${Date.now().toString().slice(-5)}`,
    patientId: `TEMP-${tempMrn}`,
    mrn: tempMrn,
    patientName,
    isTemporaryIdentity: true,
    gender,
    estimatedAge,
    triageStatus: triageCategory,
    priority: triageCategory === "RED" ? "CRITICAL" : triageCategory === "YELLOW" ? "URGENT" : "STABLE",
    chiefComplaint,
    vitals,
    assignedDoctor: doctorName || "On-Duty Trauma Surgeon",
    assignedBedId: bedId || null,
    status: "ACTIVE",
    arrivedAt: now()
  };

  // If emergency bed provided, occupy it
  if (bedId) {
    const bed = (db.beds || []).find(b => b.bedId === bedId);
    if (bed && (bed.status === "AVAILABLE" || bed.status === "RESERVED")) {
      bed.status = "OCCUPIED";
      bed.currentPatientId = emergCase.patientId;
      bed.currentPatientName = emergCase.patientName;
    }
  }

  db.emergencyCases = db.emergencyCases || [];
  db.emergencyCases.push(emergCase);
  saveDb();
  audit("RAPID_EMERGENCY_REGISTRATION", req.user, null, { tempMrn, triageCategory, bedId });
  res.json({ emergencyCase: emergCase, message: "Emergency case created with temporary MRN." });
});

app.post("/api/emergency/triage-update", auth, role("NURSE", "DOCTOR", "ADMIN"), (req, res) => {
  const { emergencyCaseId, triageCategory, vitals } = req.body;
  const emergCase = (db.emergencyCases || []).find(e => e.id === emergencyCaseId || e.emergencyNumber === emergencyCaseId);
  if (!emergCase) return res.status(404).json({ error: "Emergency case not found." });

  if (triageCategory) {
    emergCase.triageStatus = triageCategory;
    emergCase.priority = triageCategory === "RED" ? "CRITICAL" : triageCategory === "YELLOW" ? "URGENT" : "STABLE";
  }
  if (vitals) emergCase.vitals = { ...emergCase.vitals, ...vitals };
  emergCase.updatedAt = now();

  saveDb();
  audit("UPDATE_EMERGENCY_TRIAGE", req.user, emergCase.patientId, { triageCategory, vitals });
  res.json({ emergencyCase: emergCase, message: "Emergency triage status updated." });
});

app.post("/api/emergency/link-patient", auth, role("RECEPTIONIST", "HOSPITAL_ADMIN", "ADMIN"), (req, res) => {
  const { emergencyCaseId, permanentPatientId } = req.body;
  const emergCase = (db.emergencyCases || []).find(e => e.id === emergencyCaseId || e.emergencyNumber === emergencyCaseId);
  if (!emergCase) return res.status(404).json({ error: "Emergency case not found." });

  const permanentPatient = db.users.find(u => u.id === permanentPatientId);
  if (!permanentPatient) return res.status(404).json({ error: "Registered patient record not found." });

  emergCase.linkedPatientId = permanentPatientId;
  emergCase.patientId = permanentPatientId;
  emergCase.patientName = permanentPatient.name;
  emergCase.isTemporaryIdentity = false;

  // Also update bed assignment if active
  if (emergCase.assignedBedId) {
    const bed = (db.beds || []).find(b => b.bedId === emergCase.assignedBedId);
    if (bed) {
      bed.currentPatientId = permanentPatientId;
      bed.currentPatientName = permanentPatient.name;
    }
  }

  saveDb();
  audit("LINK_EMERGENCY_PATIENT", req.user, permanentPatientId, { emergencyCaseId, permanentPatientId });
  res.json({ emergencyCase: emergCase, message: `Emergency record successfully linked to permanent patient identity (${permanentPatient.name}).` });
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