import bcrypt from "bcryptjs";
import { Hospital } from "../models/Hospital.js";
import { Branch } from "../models/Branch.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { ROLES } from "./constants.js";

export async function autoEnsureSystemCredentials() {
  try {
    // 1. Ensure System Roles exist for Hospital Admin and Clinical/Operational Staff
    const operationalRoles = Object.values(ROLES).filter((r) => r !== 'SUPER_ADMIN');
    const rolesToCreate = operationalRoles.map((roleCode) => {
      let defaultRoute = "/admin/dashboard";
      if (roleCode === ROLES.HOSPITAL_ADMIN) defaultRoute = "/admin/dashboard";
      else if (roleCode === ROLES.DOCTOR) defaultRoute = "/doctor/dashboard";
      else if (roleCode === ROLES.NURSE) defaultRoute = "/nursing/dashboard";
      else if (roleCode === ROLES.NURSE_INCHARGE) defaultRoute = "/nurse-incharge/dashboard";
      else if (roleCode === ROLES.RECEPTIONIST) defaultRoute = "/reception/dashboard";
      else if (roleCode === ROLES.PHARMACIST) defaultRoute = "/pharmacy/dashboard";
      else if (roleCode === ROLES.LAB_TECH) defaultRoute = "/laboratory/dashboard";
      else if (roleCode === ROLES.RADIOLOGIST) defaultRoute = "/radiology/dashboard";
      else if (roleCode === ROLES.CASHIER) defaultRoute = "/billing/dashboard";
      else if (roleCode === ROLES.INVENTORY_MANAGER) defaultRoute = "/inventory/dashboard";
      else if (roleCode === ROLES.HR_MANAGER) defaultRoute = "/hr/dashboard";
      else if (roleCode === ROLES.PATIENT) defaultRoute = "/patient-portal/dashboard";
      else if (roleCode === ROLES.GUARDIAN) defaultRoute = "/guardian-portal/dashboard";

      return {
        code: roleCode,
        name: roleCode.replace(/_/g, " "),
        description: `${roleCode} Role Privileges`,
        permissions: ["ALL"],
        defaultRoute,
      };
    });

    for (const roleData of rolesToCreate) {
      await Role.updateOne({ code: roleData.code }, { $setOnInsert: roleData }, { upsert: true });
    }

    // 2. Ensure Sri Vijaya Lakshmi Hospital is active, unlocked, and has perpetual access
    let hospital = await Hospital.findOne({
      $or: [
        { code: "SVLH" },
        { domain: "sri-vijaya-lakshmi" },
        { name: /vijaya\s*lakshmi/i },
      ],
    });

    if (!hospital) {
      hospital = await Hospital.create({
        name: "Sri Vijaya Lakshmi Hospital",
        code: "SVLH",
        domain: "sri-vijaya-lakshmi",
        subdomain: "sri-vijaya-lakshmi",
        status: "APPROVED",
        plan: "ENTERPRISE",
        isTrial: false,
        trialStatus: "SUBSCRIPTION_ACTIVE",
        trialEndDate: null,
        subscriptionEndDate: null,
        databaseWriteLocked: false,
        databaseWriteLockReason: "",
        storageMode: "SHARED",
        contactName: "Hospital Administrator",
        contactEmail: "admin@srivijayalakshmihospital.com",
        contactPhone: "+91 98765 43210",
        licenseNumber: "TN-HOSP-2024-001",
        isActive: true,
      });
      console.log('[AutoSeed] Sri Vijaya Lakshmi Hospital initialized.');
    } else {
      // Clear any lingering SaaS locks, cutover freezes, or subscription expiries
      await Hospital.updateMany(
        {},
        {
          $set: {
            status: "APPROVED",
            isActive: true,
            isTrial: false,
            trialStatus: "SUBSCRIPTION_ACTIVE",
            trialEndDate: null,
            subscriptionEndDate: null,
            databaseWriteLocked: false,
            databaseWriteLockReason: "",
            databaseWriteLockedAt: null,
            storageMode: "SHARED",
            databaseMigrationStatus: "NOT_STARTED",
          },
        }
      );
      console.log('[AutoSeed] Sri Vijaya Lakshmi Hospital unlocked and verified active.');
    }

    // 3. Ensure Main Branch exists
    let mainBranch = await Branch.findOne({ hospitalId: hospital._id, isMainBranch: true });
    if (!mainBranch) {
      mainBranch = await Branch.create({
        hospitalId: hospital._id,
        name: "Sri Vijaya Lakshmi Hospital - Main Branch",
        branchCode: "SVLH-MAIN",
        phone: "+91 98765 43210",
        email: "admin@srivijayalakshmihospital.com",
        address: "Hospital Main Campus",
        city: "Chennai",
        state: "Tamil Nadu",
        postalCode: "600001",
        isMainBranch: true,
      });
    }

    // 4. Ensure at least one Hospital Admin exists
    const existingAdmin = await User.findOne({
      role: ROLES.HOSPITAL_ADMIN,
      isActive: true,
    });

    if (!existingAdmin) {
      const adminPass = process.env.HOSPITAL_ADMIN_PASSWORD || "Admin@2026!";
      await User.create({
        hospitalId: hospital._id,
        branchId: mainBranch._id,
        name: "Hospital Administrator",
        email: "admin@srivijayalakshmihospital.com",
        loginIds: ["admin@srivijayalakshmihospital.com"],
        passwordHash: await bcrypt.hash(adminPass, 12),
        role: ROLES.HOSPITAL_ADMIN,
        phone: "+91 98765 43210",
        status: "ACTIVE",
        isActive: true,
        isEmailVerified: true,
      });
      console.log('[AutoSeed] Default Hospital Admin created (admin@srivijayalakshmihospital.com).');
    }

    // 5. Clean up old SaaS Platform Owner / SuperAdmin accounts unless explicitly bootstrapped with secret
    const bootstrapPassword = String(process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD || '');
    if (!bootstrapPassword || bootstrapPassword.length < 12) {
      await Hospital.deleteMany({ code: "PLATFORM" }).catch(() => {});
      await User.deleteMany({ email: "superadmin@gmail.com" }).catch(() => {});
    }

    if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_TEST_DATA_SEED === 'true') {
      const { ensureTestHospitalCredentials } = await import('../../scripts/seed-production-test-hospital.js');
      await ensureTestHospitalCredentials().catch((e) => console.error('[AutoSeed Warning] Test hospital seed failed:', e.message));
    }

    console.log('[AutoSeed] Sri Vijaya Lakshmi Hospital bootstrap verified successfully.');
  } catch (err) {
    console.error("[AutoSeed Warning] Hospital bootstrap check:", err.message);
  }
}
