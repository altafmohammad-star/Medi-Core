# MEDI CORE | Connected Hospital Operating & Patient Care Platform

> **ONE PATIENT • ONE LONGITUDINAL MEDICAL RECORD • COMPLETE PATINOTE**

MEDI CORE is a production-grade, database-driven hospital operating system designed to connect all clinical, administrative, diagnostic, pharmacy, inpatient, and financial workflows into one unified patient journey.

---

## 🌟 Key Platform Features

- **11 Integrated Role Modules**:
  - 🏥 **Admin Command Center**: System governance, hospital settings & audit logs.
  - 🧑‍💼 **Reception Desk**: Patient self-registration, OPD appointments & real-time queue management.
  - 👨‍⚕️ **Doctor Workspace**: Dynamic consultation desk & complete **30-Section PATINOTE** clinical case-taking (Sections A–N).
  - 👩‍⚕️ **Nurse Ward**: Vital signs entry, bed care & nursing order execution.
  - 💊 **Pharmacy Dispensing**: Closed-loop prescription fulfillment & automated stock inventory deduction.
  - 🧪 **Pathology Laboratory**: Test order management, sample tracking & report generation.
  - 🩻 **Radiology Scanning**: X-Ray, CT, MRI & Ultrasound diagnostic imaging.
  - 🛏️ **Beds & IPD Admission**: Ward allocation, ICU/General bed management & patient transfers.
  - 🚨 **Emergency Department**: Urgent care triage, trauma desk & Break-Glass emergency access.
  - 💳 **Billing & Invoicing**: Automated itemized billing, service charges & payment receipts.
  - 👤 **Patient Portal**: Medical record lookup, prescription history & follow-up care plans.

- **2-Second Animated Splash Screen**:
  - Custom entry splash screen featuring glowing logo symbol (`✚`), pulsing outer glow ring, gradient typography, and progress animation.

- **⚡ 1-Click Default Demo Sign-In**:
  - Pre-configured demo login cards for instant test driving across all 8 user roles (`ADMIN`, `DOCTOR`, `RECEPTIONIST`, `NURSE`, `PHARMACIST`, `LAB_STAFF`, `SCAN_TECH`, `PATIENT`).

---

## 🚀 Quick Start & Installation

### Prerequisites
- Node.js (v18 or higher)

### Setup Instructions

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/altafmohammad-star/Medi-Core.git
   cd Medi-Core
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start the MEDI CORE Server**:
   ```bash
   node server.js
   ```

4. **Access the Application**:
   Open your browser and navigate to:
   `http://localhost:4000`

---

## 🔐 Default Demo Credentials

For testing and demonstration, use the **1-Click Quick Demo Sign In** panel on the sign-in screen, or use the following credentials (Password for all: `Demo@123`):

| Role | Email | Password |
|---|---|---|
| 🏥 **Admin** | `admin@medicore.demo` | `Demo@123` |
| 👨‍⚕️ **Doctor** | `doctor@medicore.demo` | `Demo@123` |
| 🧑‍💼 **Receptionist** | `reception@medicore.demo` | `Demo@123` |
| 👩‍⚕️ **Nurse** | `nurse@medicore.demo` | `Demo@123` |
| 💊 **Pharmacist** | `pharmacy@medicore.demo` | `Demo@123` |
| 🧪 **Pathology Lab** | `lab@medicore.demo` | `Demo@123` |
| 🩻 **Radiology Scan** | `scan@medicore.demo` | `Demo@123` |
| 👤 **Patient Portal** | `patient@medicore.demo` | `Demo@123` |

---

## 🛠️ Architecture & Tech Stack

- **Backend**: Node.js & Express.js REST API
- **Frontend**: Native Vanilla JS SPA architecture with dynamic module routing
- **Styles**: Custom CSS3 design system with CSS custom properties & keyframe animations
- **Database**: Single Source of Truth JSON database store (`data/db.json`)
