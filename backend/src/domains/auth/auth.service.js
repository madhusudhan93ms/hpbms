import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Hospital } from '../../models/Hospital.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { ApiError } from '../../utils/apiError.js';
import { permissionsFor } from '../../config/permissions.js';
import { requireHospitalContext } from '../../utils/tenantContext.js';
import { getTenantConnection } from '../../config/tenantDatabase.js';
import { setTenantModelConnection } from '../../config/tenantModelContext.js';
import { tenantRuntimeReadiness } from '../../config/tenantAwareModel.js';
import { EmailDeliveryService } from '../../services/emailDelivery.service.js';

const activateAuthTenant = (hospital) => {
  if (hospital?.storageMode !== 'DEDICATED') return;
  const readiness = tenantRuntimeReadiness();
  if (
    hospital.databaseMigrationStatus !== 'COPY_PREPARED' ||
    !hospital.databaseProvisionedAt ||
    !readiness.ready
  ) {
    throw new ApiError(503, 'This hospital workspace is not ready for dedicated database login.', null, 'TENANT_DATABASE_NOT_READY');
  }
  setTenantModelConnection({ connection: getTenantConnection(hospital), hospitalId: hospital._id });
};

const normalizedPhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const phonesMatch = (left, right) => {
  const a = normalizedPhone(left);
  const b = normalizedPhone(right);
  return a.length >= 7 && b.length >= 7 && a === b;
};

export class AuthService {
  static CLINIC_OWNER_WORK_ROLES = [
    'RECEPTIONIST', 'CASHIER', 'NURSE_INCHARGE', 'IPD_STAFF',
    'PHARMACIST', 'LAB_TECH', 'RADIOLOGIST', 'EMERGENCY_STAFF',
    'INVENTORY_MANAGER', 'HR_MANAGER',
  ];

  static staffManagementFilter(staffId, requestingUser) {
    if (requestingUser?.role === 'SUPER_ADMIN') return { _id: staffId };
    const hospitalId = requestingUser?.hospitalId?._id || requestingUser?.hospitalId;
    if (!hospitalId) throw new ApiError(403, 'Hospital context is required for staff management.', null, 'HOSPITAL_CONTEXT_REQUIRED');
    return { _id: staffId, hospitalId };
  }
  static async assertStaffCreationAllowed(data, requestingUser) {
    if (!requestingUser?.hospitalId) {
      throw new ApiError(403, 'A hospital context is required to create staff.', null, 'HOSPITAL_CONTEXT_REQUIRED');
    }

    const hospital = await Hospital.findById(requestingUser.hospitalId);
    if (!hospital || !hospital.isActive || hospital.status !== 'APPROVED') {
      throw new ApiError(403, 'This hospital account is not active for staff provisioning.', null, 'HOSPITAL_INACTIVE');
    }
    if (hospital.subscriptionEndDate && hospital.subscriptionEndDate < new Date()) {
      throw new ApiError(403, 'The hospital subscription has expired. Upgrade the plan to create staff.', null, 'SUBSCRIPTION_EXPIRED');
    }

    const role = data.role || 'DOCTOR';
    const roleLimitKey = {
      HOSPITAL_ADMIN: 'hospitalAdmins', DOCTOR: 'doctors', RECEPTIONIST: 'receptionists',
      NURSE: 'nurses', NURSE_INCHARGE: 'nurses', LAB_TECH: 'laboratoryStaff',
      RADIOLOGIST: 'radiologyStaff', PHARMACIST: 'pharmacyStaff', CASHIER: 'billingStaff',
    }[role];
    const moduleKey = {
      DOCTOR: 'doctors', RECEPTIONIST: 'reception', NURSE: 'nursing', NURSE_INCHARGE: 'nursing',
      LAB_TECH: 'laboratory', RADIOLOGIST: 'radiology', PHARMACIST: 'pharmacy', CASHIER: 'billing',
    }[role];
    if (moduleKey && hospital.enabledModules?.[moduleKey] === false) {
      throw new ApiError(403, `The ${moduleKey} module is not enabled for this hospital.`, null, 'MODULE_DISABLED');
    }

    const base = { hospitalId: hospital._id, isActive: true };
    const totalStaff = await User.countDocuments({ ...base, role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] } });
    const totalLimit = Number(hospital.staffLimits?.totalStaff);
    if (Number.isFinite(totalLimit) && totalStaff >= totalLimit) {
      throw new ApiError(403, `The total staff limit (${totalLimit}) for your subscription has been reached.`, null, 'TOTAL_STAFF_LIMIT_REACHED');
    }
    if (roleLimitKey) {
      const roleCount = roleLimitKey === 'nurses'
        ? await User.countDocuments({ ...base, role: { $in: ['NURSE', 'NURSE_INCHARGE'] } })
        : await User.countDocuments({ ...base, role });
      const limit = Number(hospital.staffLimits?.[roleLimitKey]);
      if (Number.isFinite(limit) && roleCount >= limit) {
        throw new ApiError(403, `The ${roleLimitKey} limit (${limit}) for your current subscription plan has been reached.`, null, 'ROLE_STAFF_LIMIT_REACHED');
      }
    }
  }

  static async formatAuthResponse(user) {
    user.lastLoginAt = new Date();
    await user.save().catch(() => {});

    if (user.hospitalId) {
      if (!user.hospitalId.name || !user.hospitalId.domain) {
        const hospId = user.hospitalId._id || user.hospitalId;
        user.hospitalId = await Hospital.findById(hospId).lean();
      }
    }

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    const roleDoc = await Role.findOne({ code: user.role });
    const domain = user.hospitalId?.domain || user.hospitalId?.subdomain || '';

    let defaultRoute = '/dashboard';
    if (user.role === 'SUPER_ADMIN') {
      defaultRoute = '/admin/dashboard';
    } else if (domain) {
      const baseMap = {
        HOSPITAL_ADMIN: `/${domain}/admin/dashboard`,
        DOCTOR: `/${domain}/doctor/dashboard`,
        NURSE: `/${domain}/nurse/dashboard`,
        NURSE_INCHARGE: `/${domain}/nurse-incharge/dashboard`,
        RECEPTIONIST: `/${domain}/reception/dashboard`,
        PHARMACIST: `/${domain}/pharmacy/dashboard`,
        LAB_TECH: `/${domain}/laboratory/dashboard`,
        RADIOLOGIST: `/${domain}/radiology/dashboard`,
        CASHIER: `/${domain}/billing/dashboard`,
        PATIENT: `/${domain}/patient/dashboard`,
        GUARDIAN: `/${domain}/guardian/dashboard`,
      };
      defaultRoute = baseMap[user.role] || `/${domain}/dashboard`;
    } else {
      const baseMap = {
        HOSPITAL_ADMIN: '/hospital-admin/dashboard',
        DOCTOR: '/doctor/dashboard',
        NURSE: '/nursing/dashboard',
        NURSE_INCHARGE: '/nurse-incharge/dashboard',
        RECEPTIONIST: '/reception/dashboard',
        PHARMACIST: '/pharmacy/dashboard',
        LAB_TECH: '/laboratory/dashboard',
        RADIOLOGIST: '/radiology/dashboard',
        CASHIER: '/billing/dashboard',
        PATIENT: '/patient-portal/dashboard',
        GUARDIAN: '/guardian-portal/dashboard',
      };
      defaultRoute = baseMap[user.role] || '/dashboard';
    }

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        uhid: user.uhid,
        role: user.role,
        additionalRoles: user.additionalRoles || [],
        additionalDepartments: user.additionalDepartments || [],
        status: user.status || (user.isActive ? 'ACTIVE' : 'INACTIVE'),
        isActive: user.isActive,
        roleName: roleDoc ? roleDoc.name : user.role,
        permissions: permissionsFor(user, user.hospitalId?.enabledModules),
        defaultRoute,
        hospitalId: user.hospitalId?._id || user.hospitalId,
        hospitalName: user.hospitalId?.name,
        hospitalDomain: domain,
        enabledModules: user.hospitalId?.enabledModules || {},
        branchId: user.branchId?._id || user.branchId,
        branchName: user.branchId?.name,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  static async login(identifier, password, hospitalDomain = null) {
    const cleanId = identifier ? String(identifier).trim() : '';
    const cleanPass = password ? String(password) : '';

    if (!cleanId) {
      throw new ApiError(400, 'Email, phone, or UHID identifier is required.', null, 'VALIDATION_ERROR');
    }
    if (!cleanPass) {
      throw new ApiError(400, 'Password is required.', null, 'VALIDATION_ERROR');
    }

    let targetHospital = null;
    if (hospitalDomain && String(hospitalDomain).trim()) {
      const cleanDomain = String(hospitalDomain).toLowerCase().trim();
      targetHospital = await Hospital.findOne({
        $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }],
        isDeleted: { $ne: true },
      });
      if (!targetHospital) {
        throw new ApiError(404, `Hospital '${cleanDomain}' not found.`, null, 'HOSPITAL_NOT_FOUND');
      }
      activateAuthTenant(targetHospital);
    }

    const safeEscapedId = cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idRegex = new RegExp(`^${safeEscapedId}$`, 'i');

    const searchQueries = [
      { loginIds: cleanId },
      { loginIds: idRegex },
      { email: cleanId.toLowerCase() },
      { email: idRegex },
      { phone: cleanId },
      { employeeId: cleanId },
      { employeeId: cleanId.toUpperCase() },
      { employeeId: cleanId.toLowerCase() },
      { employeeId: idRegex },
      { uhid: cleanId.toUpperCase() },
      { uhid: idRegex },
    ];

    if (mongoose.Types.ObjectId.isValid(cleanId)) {
      searchQueries.push({ _id: cleanId });
    }

    let candidates = await User.find({
      $or: searchQueries,
    })
      .select('+passwordHash +failedLoginAttempts +lockUntil')
      .populate('hospitalId')
      .populate('branchId');

    // Filter out users belonging to deleted/soft-deleted hospitals
    candidates = candidates.filter((candidate) => {
      if (candidate.hospitalId && (candidate.hospitalId.isDeleted === true || candidate.hospitalId.status === 'DELETED')) {
        return false;
      }
      return true;
    });

    // Enforce tenant isolation if hospitalDomain is specified
    if (targetHospital) {
      const domainCandidates = candidates.filter((candidate) => {
        if (candidate.role === 'SUPER_ADMIN') return true;
        const candHospId = candidate.hospitalId?._id ? String(candidate.hospitalId._id) : String(candidate.hospitalId);
        return candHospId === String(targetHospital._id);
      });

      if (domainCandidates.length === 0 && candidates.length > 0) {
        throw new ApiError(403, `Access Denied: Your account does not belong to ${targetHospital.name}. Please log in through your hospital's URL.`, null, 'TENANT_MISMATCH');
      }
      candidates = domainCandidates;
    }

    if (candidates.length === 0) {
      throw new ApiError(401, 'No user account found matching this Staff ID, Email, or Phone number.', null, 'USER_NOT_FOUND');
    }

    // PRIORITIZE STAFF AND ADMIN ROLES OVER PATIENT / GUARDIAN ROLES
    const STAFF_ROLES = [
      'SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'NURSE_INCHARGE',
      'RECEPTIONIST', 'PHARMACIST', 'LAB_TECH', 'RADIOLOGIST', 'CASHIER',
      'INVENTORY_MANAGER', 'HR_MANAGER'
    ];

    candidates.sort((a, b) => {
      const aIsStaff = STAFF_ROLES.includes(a.role);
      const bIsStaff = STAFF_ROLES.includes(b.role);
      if (aIsStaff && !bIsStaff) return -1;
      if (!aIsStaff && bIsStaff) return 1;
      return 0;
    });

    if (candidates.length > 0) {
      const lockCandidate = candidates[0];
      if (lockCandidate.lockUntil && lockCandidate.lockUntil > new Date()) {
        const remainingSecs = Math.max(1, Math.ceil((lockCandidate.lockUntil.getTime() - Date.now()) / 1000));
        const timeMsg = remainingSecs < 60 ? `${remainingSecs} seconds` : `${Math.ceil(remainingSecs / 60)} minute(s)`;
        throw new ApiError(403, `Account is temporarily locked due to multiple failed login attempts. Please try again after ${timeMsg}.`, null, 'ACCOUNT_LOCKED');
      } else if (lockCandidate.lockUntil && lockCandidate.lockUntil <= new Date()) {
        lockCandidate.failedLoginAttempts = 0;
        lockCandidate.lockUntil = null;
        await lockCandidate.save().catch(() => {});
      }
    }

    let user = null;
    let failedAttempts = 0;
    for (const candidate of candidates) {
      if (await candidate.comparePassword(password)) {
        user = candidate;
        break;
      } else {
        candidate.failedLoginAttempts = (candidate.failedLoginAttempts || 0) + 1;
        failedAttempts = candidate.failedLoginAttempts;
        if (candidate.failedLoginAttempts >= 5) {
          candidate.lockUntil = new Date(Date.now() + 30 * 1000); // Lock for 30 seconds
        }
        await candidate.save().catch(() => {});
      }
    }

    if (!user) {
      if (failedAttempts >= 5) {
        throw new ApiError(403, 'Account is temporarily locked due to multiple failed login attempts. Please try again after 30 seconds.', null, 'ACCOUNT_LOCKED');
      }
      const attemptsLeft = Math.max(0, 5 - failedAttempts);
      const remainingHint = attemptsLeft > 0 ? ` (${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} remaining before account lock)` : '';
      throw new ApiError(401, `Incorrect password entered for this Staff ID / Account.${remainingHint}`, null, 'INCORRECT_PASSWORD');
    }

    if (!user.isActive) {
      throw new ApiError(403, 'Account has been deactivated. Please contact your Hospital Administrator.', null, 'ACCOUNT_DEACTIVATED');
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save().catch(() => {});

    return await this.formatAuthResponse(user);
  }

  static async patientLogin(mobileNumber, dob, hospitalDomain = null) {
    if (!mobileNumber || !String(mobileNumber).trim()) {
      throw new ApiError(400, 'Patient Mobile Number is required.', null, 'VALIDATION_ERROR');
    }
    if (!dob || !String(dob).trim()) {
      throw new ApiError(400, 'Date of Birth (DOB) is required.', null, 'VALIDATION_ERROR');
    }

    const cleanMobile = String(mobileNumber).trim();
    const cleanMobileDigits = cleanMobile.replace(/\D/g, '');
    const { Patient } = await import('../../models/Patient.js');

    let targetHospitalId = null;
    if (hospitalDomain && String(hospitalDomain).trim()) {
      const cleanDomain = String(hospitalDomain).toLowerCase().trim();
      const hosp = await Hospital.findOne({ $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }], isDeleted: { $ne: true } });
      if (!hosp) throw new ApiError(404, `Hospital '${cleanDomain}' not found.`, null, 'HOSPITAL_NOT_FOUND');
      targetHospitalId = hosp._id;
      activateAuthTenant(hosp);
    }

    const safeEscapedMobile = cleanMobile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const phoneQueries = [
      { phone: cleanMobile },
      { phone: { $regex: cleanMobileDigits, $options: 'i' } },
      { uhid: cleanMobile.toUpperCase() },
      { uhid: { $regex: `^${safeEscapedMobile}$`, $options: 'i' } },
    ];
    if (cleanMobileDigits.length >= 6) {
      phoneQueries.push({ phone: { $regex: cleanMobileDigits.slice(-7), $options: 'i' } });
    }

    const patientQuery = { $or: phoneQueries };
    if (targetHospitalId) {
      patientQuery.hospitalId = targetHospitalId;
    }

    let patients = await Patient.find(patientQuery).populate('hospitalId').populate('branchId');

    if (!patients || patients.length === 0) {
      throw new ApiError(401, `No registered patient found matching Mobile Number or UHID '${cleanMobile}'. Please check your input or contact reception.`, null, 'PATIENT_NOT_FOUND');
    }

    const inputDobDate = new Date(dob);
    if (isNaN(inputDobDate.getTime())) {
      throw new ApiError(400, 'Invalid Date of Birth format. Please select a valid date.', null, 'VALIDATION_ERROR');
    }
    const inputDobStr = inputDobDate.toISOString().split('T')[0];

    let matchedPatient = patients.find((p) => {
      if (!p.dob) return false;
      const pDobDate = new Date(p.dob);
      if (isNaN(pDobDate.getTime())) return false;
      const pDobStr = pDobDate.toISOString().split('T')[0];
      return pDobStr === inputDobStr;
    });

    if (!matchedPatient) {
      throw new ApiError(401, 'Date of Birth (DOB) does not match our records for this patient. Please verify your date of birth.', null, 'DOB_MISMATCH');
    }

    // Look up existing user strictly with role 'PATIENT' to prevent accidental admin/staff collision
    let user = await User.findOne({
      hospitalId: matchedPatient.hospitalId?._id || matchedPatient.hospitalId,
      role: 'PATIENT',
      $or: [
        { uhid: matchedPatient.uhid },
        { phone: cleanMobile },
        { phone: matchedPatient.phone },
        ...(matchedPatient.email ? [{ email: matchedPatient.email }] : [])
      ]
    }).populate('hospitalId').populate('branchId');

    if (!user) {
      const dummyPass = await bcrypt.hash(matchedPatient.uhid + 'PatientKey!', 12);
      const uhidClean = matchedPatient.uhid.toLowerCase().replace(/[^a-z0-9]/g, '');
      const patientEmail = matchedPatient.email || `${uhidClean}@patient.local`;

      try {
        user = await User.create({
          hospitalId: matchedPatient.hospitalId._id || matchedPatient.hospitalId,
          branchId: matchedPatient.branchId?._id || matchedPatient.branchId,
          name: `${matchedPatient.firstName} ${matchedPatient.lastName}`.trim(),
          email: patientEmail,
          phone: matchedPatient.phone || cleanMobile,
          uhid: matchedPatient.uhid,
          passwordHash: dummyPass,
          role: 'PATIENT',
          status: 'ACTIVE',
          isActive: true,
        });
      } catch (err) {
        if (err.code === 11000 || err.message?.includes('already exists') || err.message?.includes('duplicate key')) {
          user = await User.findOne({
            hospitalId: matchedPatient.hospitalId?._id || matchedPatient.hospitalId,
            role: 'PATIENT',
            $or: [
              { uhid: matchedPatient.uhid },
              { email: patientEmail },
              { phone: matchedPatient.phone || cleanMobile }
            ]
          }).populate('hospitalId').populate('branchId');
        } else {
          throw err;
        }
      }
    }

    return await this.formatAuthResponse(user);
  }

  static async guardianLogin(guardianMobile, patientMobile, patientNumber, hospitalDomain = null) {
    if (!guardianMobile || !String(guardianMobile).trim()) {
      throw new ApiError(400, 'Guardian Mobile Number is required.', null, 'VALIDATION_ERROR');
    }
    if (!patientMobile || !String(patientMobile).trim()) {
      throw new ApiError(400, 'Patient Mobile Number is required.', null, 'VALIDATION_ERROR');
    }
    if (!patientNumber || !String(patientNumber).trim()) {
      throw new ApiError(400, 'Patient Number (UHID) is required.', null, 'VALIDATION_ERROR');
    }

    const cleanGuardian = String(guardianMobile).trim();
    const cleanPatientMobile = String(patientMobile).trim();
    const cleanUHID = String(patientNumber).trim().toUpperCase();

    let targetHospital = null;
    if (hospitalDomain && String(hospitalDomain).trim()) {
      const cleanDomain = String(hospitalDomain).toLowerCase().trim();
      targetHospital = await Hospital.findOne({
        $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }],
        isDeleted: { $ne: true },
      });
      if (!targetHospital) throw new ApiError(404, `Hospital '${cleanDomain}' not found.`, null, 'HOSPITAL_NOT_FOUND');
      activateAuthTenant(targetHospital);
    }

    const patient = await Patient.findOne({
      uhid: cleanUHID,
      ...(targetHospital ? { hospitalId: targetHospital._id } : {}),
    }).populate('hospitalId').populate('branchId');

    if (!patient) {
      throw new ApiError(401, `No patient record found with Patient UHID '${cleanUHID}'. Please verify the UHID number.`, null, 'UHID_NOT_FOUND');
    }

    const inputGuardianDigits = normalizedPhone(cleanGuardian);
    const patientMatched = phonesMatch(patient.phone, cleanPatientMobile);
    const guardianMatched = phonesMatch(patient.emergencyContact?.phone, cleanGuardian);

    if (!patientMatched) {
      throw new ApiError(401, `Patient Mobile Number does not match the registered mobile for UHID '${cleanUHID}'.`, null, 'PATIENT_PHONE_MISMATCH');
    }
    if (!guardianMatched) {
      throw new ApiError(401, 'Guardian Mobile Number does not match the registered emergency contact for this patient.', null, 'GUARDIAN_PHONE_MISMATCH');
    }

    // Look up existing Guardian user by phone, role, and hospital
    let user = await User.findOne({
      phone: cleanGuardian,
      role: 'GUARDIAN',
      hospitalId: patient.hospitalId?._id || patient.hospitalId,
    }).populate('hospitalId').populate('branchId');

    if (!user) {
      // Also try looking up by email in case created before with different logic
      const guardianEmail = `${inputGuardianDigits || 'guardian'}_${cleanUHID}@guardian.local`.toLowerCase();
      user = await User.findOne({
        email: guardianEmail,
        hospitalId: patient.hospitalId?._id || patient.hospitalId,
      }).populate('hospitalId').populate('branchId');
    }

    if (!user) {
      const dummyPass = await bcrypt.hash(cleanUHID + 'GuardianKey!', 12);
      const guardianEmail = `${inputGuardianDigits || 'guardian'}_${cleanUHID}@guardian.local`.toLowerCase();
      try {
        user = await User.create({
          hospitalId: patient.hospitalId?._id || patient.hospitalId,
          branchId: patient.branchId?._id || patient.branchId,
          name: `Guardian (${patient.firstName} ${patient.lastName})`,
          email: guardianEmail,
          phone: cleanGuardian,
          passwordHash: dummyPass,
          role: 'GUARDIAN',
          status: 'ACTIVE',
          isActive: true,
        });
      } catch (createErr) {
        // Handle race condition or duplicate â€” retry lookup
        if (createErr.code === 11000) {
          user = await User.findOne({
            email: guardianEmail,
            hospitalId: patient.hospitalId?._id || patient.hospitalId,
          }).populate('hospitalId').populate('branchId');
          if (!user) {
            user = await User.findOne({
              phone: cleanGuardian,
              role: 'GUARDIAN',
              hospitalId: patient.hospitalId?._id || patient.hospitalId,
            }).populate('hospitalId').populate('branchId');
          }
        } else {
          throw createErr;
        }
      }
      if (user?._id && !(user.hospitalId?.name)) {
        user = await User.findById(user._id).populate('hospitalId').populate('branchId');
      }
    }

    // Auto-create & auto-approve GuardianLink immediately upon successful login with Guardian Mobile + Patient Mobile + UHID
    try {
      const { GuardianLink } = await import('../../models/GuardianLink.js');
      let linkDoc = await GuardianLink.findOne({
        hospitalId: patient.hospitalId?._id || patient.hospitalId,
        guardianUserId: user._id,
        patientId: patient._id,
      });
      if (!linkDoc) {
        await GuardianLink.create({
          hospitalId: patient.hospitalId?._id || patient.hospitalId,
          branchId: patient.branchId?._id || patient.branchId,
          patientId: patient._id,
          guardianUserId: user._id,
          relationship: 'OTHER',
          accessStatus: 'APPROVED',
          approvedAt: new Date(),
        });
      } else if (linkDoc.accessStatus !== 'APPROVED') {
        linkDoc.accessStatus = 'APPROVED';
        linkDoc.approvedAt = new Date();
        await linkDoc.save();
      }
    } catch (linkErr) {
      console.error('[GuardianAuth] Auto-link status update note:', linkErr.message);
    }

    return await this.formatAuthResponse(user);
  }

  static async createStaffUser(data, requestingUser) {
    if (!data.name || !String(data.name).trim()) {
      throw new ApiError(400, 'Staff full name is required.', null, 'VALIDATION_ERROR');
    }
    if (!data.email || !String(data.email).trim()) {
      throw new ApiError(400, 'Staff email address is required.', null, 'VALIDATION_ERROR');
    }
    if (!data.password || !String(data.password).trim()) {
      throw new ApiError(400, 'Staff account password is required.', null, 'VALIDATION_ERROR');
    }

    const cleanEmail = String(data.email).toLowerCase().trim();
    const cleanPhone = data.phone ? String(data.phone).trim() : '';
    const cleanEmpId = data.employeeId ? String(data.employeeId).trim() : '';

    let hospitalId = requireHospitalContext(requestingUser);
    if (typeof hospitalId === 'object' && hospitalId?._id) {
      hospitalId = hospitalId._id;
    }
    let branchId = requestingUser?.branchId || data.branchId;
    if (typeof branchId === 'object' && branchId?._id) {
      branchId = branchId._id;
    }

    // Uniqueness is strictly scoped per hospital (tenant isolation)
    const existingUser = await User.findOne({
      hospitalId,
      $or: [
        { email: cleanEmail },
        { loginIds: cleanEmail },
        ...(cleanPhone ? [{ phone: cleanPhone }, { loginIds: cleanPhone }] : []),
        ...(cleanEmpId ? [{ employeeId: cleanEmpId }] : []),
      ],
    });

    if (existingUser) {
      let identifierReason = `email '${cleanEmail}'`;
      if (existingUser.phone && cleanPhone && existingUser.phone === cleanPhone) {
        identifierReason = `phone number '${cleanPhone}'`;
      } else if (existingUser.employeeId && cleanEmpId && existingUser.employeeId === cleanEmpId) {
        identifierReason = `employee ID '${cleanEmpId}'`;
      }
      throw new ApiError(400, `User already registered: A user with ${identifierReason} already exists in this hospital.`, null, 'USER_ALREADY_REGISTERED');
    }

    await this.assertStaffCreationAllowed(data, requestingUser);
    branchId = requestingUser?.branchId || data.branchId || branchId;
    if (typeof branchId === 'object' && branchId?._id) {
      branchId = branchId._id;
    }

    if (!branchId && hospitalId) {
      let branch = await Branch.findOne({ hospitalId });
      if (!branch) {
        try {
          const hosp = await Hospital.findById(hospitalId);
          branch = await Branch.create({
            hospitalId,
            name: hosp?.name ? `${hosp.name} Main Branch` : 'Main Branch',
            branchCode: hosp?.code ? `${hosp.code}-MAIN` : 'MAIN',
            isMainBranch: true,
          });
        } catch (e) {
          // ignore creation error
        }
      }
      if (branch) branchId = branch._id;
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const status = data.status || 'ACTIVE';
    const isActive = status === 'ACTIVE';

    const cleanEmployeeId = data.employeeId ? String(data.employeeId).trim() : '';
    const loginIds = [
      data.email.toLowerCase().trim(),
      ...(cleanPhone ? [cleanPhone] : []),
      ...(cleanEmployeeId ? [cleanEmployeeId, cleanEmployeeId.toUpperCase(), cleanEmployeeId.toLowerCase()] : []),
    ];

    const newUser = await User.create({
      hospitalId,
      branchId,
      name: data.name,
      email: data.email.toLowerCase().trim(),
      phone: cleanPhone,
      loginIds,
      passwordHash,
      role: data.role || 'DOCTOR',
      additionalRoles: Array.isArray(data.additionalRoles) ? data.additionalRoles : [],
      departmentId: data.departmentId || undefined,
      additionalDepartments: Array.isArray(data.additionalDepartments) ? data.additionalDepartments : [],
      employeeId: cleanEmployeeId,
      designation: data.designation || '',
      assignedUnit: data.assignedUnit || '',
      shiftDetails: data.shiftDetails || '',
      permissions: data.permissions || {},
      revokedPermissions: data.revokedPermissions || {},
      specialization: data.specialization || '',
      status,
      isActive,
    });

    return newUser;
  }

  static async updateStaffPassword(staffId, { newPassword, adminPassword }, adminUser) {
    const adminId = adminUser?.id || adminUser?._id;
    if (!newPassword || String(newPassword).length < 8) {
      throw new ApiError(400, 'New password must be at least 8 characters long.', null, 'WEAK_PASSWORD');
    }
    if (adminUser?.role !== 'SUPER_ADMIN') {
      const adminDoc = adminId ? await User.findOne(this.staffManagementFilter(adminId, adminUser)).select('+passwordHash') : null;
      if (!adminDoc) {
        throw new ApiError(404, 'Admin account not found. Please log out and log in again.', null, 'NOT_FOUND');
      }
      if (!adminPassword || !(await adminDoc.comparePassword(adminPassword))) {
        throw new ApiError(401, 'Invalid Admin verification password. Please enter your logged-in Admin password.', null, 'INVALID_ADMIN_PASSWORD');
      }
    }

    const staffDoc = await User.findOne(this.staffManagementFilter(staffId, adminUser)).select('+passwordHash +passwordResetToken +passwordResetExpires +failedLoginAttempts +lockUntil');
    if (!staffDoc) {
      throw new ApiError(404, 'Staff user account not found', null, 'NOT_FOUND');
    }

    staffDoc.passwordHash = await bcrypt.hash(newPassword, 12);
    staffDoc.assignedPasswordHint = '';
    staffDoc.passwordResetToken = null;
    staffDoc.passwordResetExpires = null;
    staffDoc.failedLoginAttempts = 0;
    staffDoc.lockUntil = null;
    await staffDoc.save();


    return {
      id: staffDoc._id,
      name: staffDoc.name,
      email: staffDoc.email,
    };
  }

  static async toggleDoctorAvailability(staffId, isAvailable, cabinNo, requestingUser, adminDepartmentAvailability = null) {
    const targetId = (staffId === 'me' || !staffId) ? (requestingUser?.id || requestingUser?._id) : staffId;
    const staffDoc = await User.findOne(this.staffManagementFilter(targetId, requestingUser));
    if (!staffDoc) {
      throw new ApiError(404, 'Staff account not found', null, 'NOT_FOUND');
    }

    const requesterId = requestingUser?.id || requestingUser?._id;
    const isOwner = String(staffDoc._id) === String(requesterId);
    const isAdmin = ['HOSPITAL_ADMIN', 'SUPER_ADMIN', 'RECEPTIONIST'].includes(requestingUser?.role);
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'You are not authorised to change this staff member\'s availability', null, 'FORBIDDEN');
    }

    if (isAvailable !== undefined && isAvailable !== null) {
      staffDoc.isAvailable = Boolean(isAvailable);
    }
    if (adminDepartmentAvailability && typeof adminDepartmentAvailability === 'object') {
      staffDoc.adminDepartmentAvailability = {
        ...(staffDoc.adminDepartmentAvailability || {}),
        ...adminDepartmentAvailability,
      };
    }
    if (cabinNo && typeof cabinNo === 'string' && cabinNo.trim()) {
      staffDoc.cabinNo = cabinNo.trim();
    }

    if (staffDoc.role === 'HOSPITAL_ADMIN') {
      const deptAvail = staffDoc.adminDepartmentAvailability || {
        DOCTOR: true, RECEPTIONIST: true, CASHIER: true, PHARMACIST: true,
        LAB_TECH: true, RADIOLOGIST: true, NURSE: true, EMERGENCY_STAFF: true,
      };
      const roleMap = {
        DOCTOR: ['DOCTOR'],
        RECEPTIONIST: ['RECEPTIONIST'],
        CASHIER: ['CASHIER'],
        PHARMACIST: ['PHARMACIST'],
        LAB_TECH: ['LAB_TECH'],
        RADIOLOGIST: ['RADIOLOGIST'],
        NURSE: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF'],
        EMERGENCY_STAFF: ['EMERGENCY_STAFF'],
      };
      const enabledRoles = [];
      for (const [dept, isEnabled] of Object.entries(deptAvail)) {
        if (isEnabled && roleMap[dept]) {
          enabledRoles.push(...roleMap[dept]);
        }
      }
      staffDoc.additionalRoles = staffDoc.isAvailable ? Array.from(new Set(enabledRoles)) : [];
    }

    staffDoc.availabilityUpdatedAt = new Date();
    await staffDoc.save();

    return {
      id: staffDoc._id,
      _id: staffDoc._id,
      name: staffDoc.name,
      role: staffDoc.role,
      specialization: staffDoc.specialization,
      isAvailable: staffDoc.isAvailable,
      adminDepartmentAvailability: staffDoc.adminDepartmentAvailability,
      additionalRoles: staffDoc.additionalRoles || [],
      cabinNo: staffDoc.cabinNo,
      availabilityUpdatedAt: staffDoc.availabilityUpdatedAt,
      branchId: staffDoc.branchId,
      hospitalId: staffDoc.hospitalId,
    };
  }

  static async getHospitalStaff(requestingUser, queryParams = {}) {
    const query = { role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] } };
    if (requestingUser.role !== 'SUPER_ADMIN') {
      if (requestingUser.hospitalId) {
        const hId = typeof requestingUser.hospitalId === 'object' ? requestingUser.hospitalId._id : requestingUser.hospitalId;
        query.hospitalId = hId;
      }
    } else {
      // Super Admin: check if requesting all hospitals combined or specific hospital
      if (queryParams.all === 'true' || queryParams.hospitalId === 'ALL') {
        // No hospitalId restriction — return all staff across all hospitals
      } else if (queryParams.hospitalId) {
        query.hospitalId = queryParams.hospitalId;
      } else if (requestingUser._hospitalContextApplied && requestingUser.hospitalId) {
        const hId = typeof requestingUser.hospitalId === 'object' ? requestingUser.hospitalId._id : requestingUser.hospitalId;
        query.hospitalId = hId;
      }
    }
    return await User.find(query).populate('hospitalId', 'name code domain').select('-passwordHash -assignedPasswordHint -passwordResetToken -emailVerificationToken').sort({ createdAt: -1 });
  }

  static async getMe(userId) {
    let user = await User.findById(userId).populate('hospitalId').populate('branchId');
    if (!user) {
      // Fallback: Check the base platform User model in case of SUPER_ADMIN or master directory account
      user = await mongoose.model('User').findById(userId).populate('hospitalId').populate('branchId');
    }
    if (!user) {
      throw new ApiError(404, 'User account not found', null, 'USER_NOT_FOUND');
    }

    if (user.departmentId && mongoose.Types.ObjectId.isValid(user.departmentId)) {
      try {
        await user.populate('departmentId');
      } catch (e) {
        // preserve string value if population fails
      }
    }

    const roleDoc = await Role.findOne({ code: user.role });
    const domain = user.hospitalId?.domain || user.hospitalId?.subdomain || '';

    let defaultRoute = '/dashboard';
    if (user.role === 'SUPER_ADMIN') {
      defaultRoute = '/admin/dashboard';
    } else if (domain) {
      const baseMap = {
        HOSPITAL_ADMIN: `/${domain}/admin/dashboard`,
        DOCTOR: `/${domain}/doctor/dashboard`,
        NURSE: `/${domain}/nurse/dashboard`,
        NURSE_INCHARGE: `/${domain}/nurse-incharge/dashboard`,
        RECEPTIONIST: `/${domain}/reception/dashboard`,
        PHARMACIST: `/${domain}/pharmacy/dashboard`,
        LAB_TECH: `/${domain}/laboratory/dashboard`,
        RADIOLOGIST: `/${domain}/radiology/dashboard`,
        CASHIER: `/${domain}/billing/dashboard`,
        PATIENT: `/${domain}/patient/dashboard`,
        GUARDIAN: `/${domain}/guardian/dashboard`,
      };
      defaultRoute = baseMap[user.role] || `/${domain}/dashboard`;
    } else if (roleDoc?.defaultRoute) {
      defaultRoute = roleDoc.defaultRoute;
    }

    const activeAdditionalRoles = new Set(Array.isArray(user.additionalRoles) ? user.additionalRoles : []);
    if (user.role === 'HOSPITAL_ADMIN' && user.isAvailable !== false && user.adminDepartmentAvailability) {
      const roleMap = {
        DOCTOR: ['DOCTOR'],
        RECEPTIONIST: ['RECEPTIONIST', 'OPD_STAFF'],
        CASHIER: ['CASHIER', 'BILLING_STAFF'],
        PHARMACIST: ['PHARMACIST', 'PHARMACY_STAFF'],
        LAB_TECH: ['LAB_TECH', 'LABORATORY_STAFF'],
        RADIOLOGIST: ['RADIOLOGIST', 'RADIOLOGY_STAFF'],
        NURSE: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF'],
        EMERGENCY_STAFF: ['EMERGENCY_STAFF'],
      };
      for (const [dept, isEnabled] of Object.entries(user.adminDepartmentAvailability)) {
        if (isEnabled && roleMap[dept]) {
          roleMap[dept].forEach((r) => activeAdditionalRoles.add(r));
        }
      }
    }

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      uhid: user.uhid,
      role: user.role,
      additionalRoles: Array.from(activeAdditionalRoles),
      additionalDepartments: user.additionalDepartments || [],
      status: user.status || (user.isActive ? 'ACTIVE' : 'INACTIVE'),
      isActive: user.isActive,
      roleName: roleDoc ? roleDoc.name : user.role,
      permissions: permissionsFor(user, user.hospitalId?.enabledModules),
      defaultRoute,
      hospital: user.hospitalId,
      hospitalId: user.hospitalId?._id || user.hospitalId,
      hospitalName: user.hospitalId?.name,
      hospitalDomain: domain,
      enabledModules: user.hospitalId?.enabledModules || {},
      branch: user.branchId,
      branchId: user.branchId?._id || user.branchId,
      branchName: user.branchId?.name,
      department: user.departmentId,
      specialization: user.specialization,
      employeeId: user.employeeId,
      designation: user.designation,
      assignedUnit: user.assignedUnit,
      shiftDetails: user.shiftDetails,
      isAvailable: user.isAvailable,
      adminDepartmentAvailability: user.adminDepartmentAvailability || {
        DOCTOR: true,
        RECEPTIONIST: true,
        CASHIER: true,
        PHARMACIST: true,
        LAB_TECH: true,
        RADIOLOGIST: true,
        NURSE: true,
        EMERGENCY_STAFF: true,
      },
      cabinNo: user.cabinNo || 'Cabin 101',
      availabilityUpdatedAt: user.availabilityUpdatedAt,
      avatarUrl: user.avatarUrl,
    };
  }

  static async enableClinicOwnerWorkMode(userId, requestingUser) {
    if (requestingUser?.role !== 'HOSPITAL_ADMIN' || String(requestingUser.id || '') !== String(userId || '')) {
      throw new ApiError(403, 'Only a Hospital Administrator can enable Work Mode for their own account.', null, 'FORBIDDEN');
    }
    const hospitalId = requireHospitalContext(requestingUser);
    const admin = await User.findOne({ _id: userId, hospitalId, role: 'HOSPITAL_ADMIN', isActive: true });
    if (!admin) throw new ApiError(404, 'Hospital Administrator account not found.', null, 'NOT_FOUND');

    admin.additionalRoles = Array.from(new Set([
      ...(Array.isArray(admin.additionalRoles) ? admin.additionalRoles : []),
      ...this.CLINIC_OWNER_WORK_ROLES,
    ]));
    admin.permissionUpdatedAt = new Date();
    admin.permissionUpdatedBy = admin._id;
    await admin.save();

    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({
      hospitalId,
      branchId: admin.branchId,
      userId: admin._id,
      userName: admin.name,
      userRole: admin.role,
      action: 'CLINIC_OWNER_WORK_MODE_ENABLED',
      module: 'STAFF_MANAGEMENT',
      resourceId: String(admin._id),
      details: `Clinic owner Work Mode enabled with roles: ${admin.additionalRoles.join(', ')}`,
    });

    return this.getMe(admin._id);
  }

  static async updateStaffUser(staffId, data, requestingUser) {
    const staff = await User.findOne(this.staffManagementFilter(staffId, requestingUser));
    if (!staff) throw new ApiError(404, 'Staff user account record not found.', null, 'NOT_FOUND');

    const previousState = {
      name: staff.name,
      email: staff.email,
      role: staff.role,
      additionalRoles: staff.additionalRoles,
      status: staff.status,
      permissions: staff.permissions,
    };

    const cleanEmail = data.email ? String(data.email).toLowerCase().trim() : '';
    const cleanPhone = data.phone !== undefined ? String(data.phone).trim() : '';
    const cleanEmpId = data.employeeId !== undefined ? String(data.employeeId).trim() : '';
    const currentEmail = staff.email ? String(staff.email).toLowerCase().trim() : '';
    const currentPhone = staff.phone ? String(staff.phone).trim() : '';
    const currentEmpId = staff.employeeId ? String(staff.employeeId).trim() : '';

    // Only check identifiers that are actually changing. Older staff records may
    // share the legacy placeholder phone number, which must not block unrelated
    // role/permission updates.
    const changedEmail = cleanEmail && cleanEmail !== currentEmail ? cleanEmail : '';
    const changedPhone = cleanPhone && cleanPhone !== currentPhone ? cleanPhone : '';
    const changedEmpId = cleanEmpId && cleanEmpId !== currentEmpId ? cleanEmpId : '';

    const staffHospId = staff.hospitalId?._id || staff.hospitalId;

    if (changedEmail || changedPhone || changedEmpId) {
      const existingUser = await User.findOne({
        hospitalId: staffHospId,
        _id: { $ne: staff._id },
        $or: [
          ...(changedEmail ? [{ email: changedEmail }, { loginIds: changedEmail }] : []),
          ...(changedPhone ? [{ phone: changedPhone }, { loginIds: changedPhone }] : []),
          ...(changedEmpId ? [{ employeeId: changedEmpId }] : []),
        ],
      });

      if (existingUser) {
        let identifierReason = `email '${cleanEmail || existingUser.email}'`;
        if (existingUser.phone && changedPhone && existingUser.phone === changedPhone) {
          identifierReason = `phone number '${changedPhone}'`;
        } else if (existingUser.employeeId && changedEmpId && existingUser.employeeId === changedEmpId) {
          identifierReason = `employee ID '${changedEmpId}'`;
        }
        throw new ApiError(400, `User already registered: A user with ${identifierReason} already exists in this hospital.`, null, 'USER_ALREADY_REGISTERED');
      }
    }

    if (data.name) staff.name = data.name.trim();
    if (data.email) staff.email = data.email.toLowerCase().trim();
    if (data.phone !== undefined) staff.phone = cleanPhone;
    if (data.employeeId !== undefined) staff.employeeId = data.employeeId;
    if (data.designation !== undefined) staff.designation = data.designation;
    if (data.assignedUnit !== undefined) staff.assignedUnit = data.assignedUnit;
    if (data.shiftDetails !== undefined) staff.shiftDetails = data.shiftDetails;
    if (data.specialization !== undefined) staff.specialization = data.specialization;
    if (data.role) staff.role = data.role;
    if (data.additionalRoles !== undefined) staff.additionalRoles = Array.isArray(data.additionalRoles) ? data.additionalRoles : [];
    if (data.departmentId !== undefined) staff.departmentId = data.departmentId || undefined;
    if (data.additionalDepartments !== undefined) staff.additionalDepartments = Array.isArray(data.additionalDepartments) ? data.additionalDepartments : [];
    if (data.status) {
      staff.status = data.status;
      staff.isActive = data.status === 'ACTIVE';
    } else if (data.isActive !== undefined) {
      staff.isActive = Boolean(data.isActive);
      staff.status = staff.isActive ? 'ACTIVE' : 'INACTIVE';
    }
    if (data.permissions) staff.permissions = data.permissions;
    if (data.revokedPermissions !== undefined) staff.revokedPermissions = data.revokedPermissions;
    if (data.password && data.password.trim()) {
      staff.passwordHash = await bcrypt.hash(data.password.trim(), 12);
      staff.assignedPasswordHint = '';
    }

    staff.permissionUpdatedAt = new Date();
    staff.permissionUpdatedBy = requestingUser.id;
    await staff.save();

    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({
      hospitalId: staff.hospitalId,
      userId: requestingUser.id,
      userRole: requestingUser.role,
      action: 'STAFF_ACCOUNT_UPDATED',
      module: 'STAFF_MANAGEMENT',
      resourceId: String(staff._id),
      previousState,
      newState: {
        name: staff.name,
        role: staff.role,
        additionalRoles: staff.additionalRoles,
        status: staff.status,
        permissions: staff.permissions,
      },
      details: `Staff profile and access configuration updated for ${staff.name}`,
    });

    return staff;
  }

  static async updateStaffPermissions(staffId, data, requestingUser) {
    const staff = await User.findOne(this.staffManagementFilter(staffId, requestingUser));
    if (!staff) throw new ApiError(404, 'Staff user account record not found.', null, 'NOT_FOUND');
    if (!data.permissions || Object.keys(data.permissions).length === 0) {
      throw new ApiError(400, 'Select at least one permission before saving.', null, 'VALIDATION_ERROR');
    }
    const previousState = staff.permissions || {};
    staff.permissions = data.permissions;
    if (data.revokedPermissions !== undefined) staff.revokedPermissions = data.revokedPermissions;
    if (data.departmentId !== undefined) staff.departmentId = data.departmentId || undefined;
    if (data.assignedUnit !== undefined) staff.assignedUnit = data.assignedUnit;
    if (data.shiftDetails !== undefined) staff.shiftDetails = data.shiftDetails;
    staff.permissionUpdatedAt = new Date();
    staff.permissionUpdatedBy = requestingUser.id;
    await staff.save();
    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({ hospitalId: staff.hospitalId, userId: requestingUser.id, userRole: requestingUser.role, action: 'PERMISSIONS_UPDATED', module: 'STAFF_MANAGEMENT', resourceId: String(staff._id), previousState, newState: staff.permissions, details: `Permissions updated for ${staff.name}` });
    return staff;
  }

  static async verifyEmail(token) {
    if (!token) throw new ApiError(400, 'Verification token is required.', null, 'VALIDATION_ERROR');
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires');
    if (!user) {
      throw new ApiError(400, 'Invalid or expired email verification token.', null, 'INVALID_TOKEN');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.status = 'ACTIVE';
    user.isActive = true;
    await user.save();

    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientUserId: user._id,
      recipientRole: user.role,
      hospitalId: user.hospitalId,
      title: 'Email Verified Successfully',
      message: `Your email address (${user.email}) has been verified. You may now log in.`,
      type: 'EMAIL_VERIFIED',
    });

    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({
      hospitalId: user.hospitalId,
      userId: user._id,
      userRole: user.role,
      action: 'EMAIL_VERIFIED',
      module: 'AUTH',
      details: `User ${user.email} successfully verified email address.`,
    });

    return { message: 'Email address verified successfully. You may now log in.' };
  }

  static async resendVerification(email) {
    if (!email) throw new ApiError(400, 'Email address is required.', null, 'VALIDATION_ERROR');
    EmailDeliveryService.assertConfigured();
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      return { message: 'If an unverified account exists with that email, a new verification link has been sent.' };
    }

    const { default: crypto } = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    try {
      await EmailDeliveryService.sendEmailVerification({ to: user.email, name: user.name, token });
    } catch (error) {
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      await user.save();
      throw error;
    }

    return {
      message: 'If an unverified account exists with that email, a new verification link has been requested.',
      ...(process.env.NODE_ENV !== 'production' && process.env.EXPOSE_DEV_AUTH_TOKENS === 'true'
        ? { verificationToken: token }
        : {}),
    };
  }

  static async forgotPassword(email) {
    if (!email) throw new ApiError(400, 'Email address is required.', null, 'VALIDATION_ERROR');
    EmailDeliveryService.assertConfigured();
    const cleanEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return { message: 'If an account exists with that email address, a password reset link has been sent.' };
    }

    const { default: crypto } = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await user.save();

    try {
      await EmailDeliveryService.sendPasswordReset({ to: user.email, name: user.name, token });
    } catch (error) {
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save();
      throw error;
    }

    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientUserId: user._id,
      recipientRole: user.role,
      hospitalId: user.hospitalId,
      title: 'Password Reset Request',
      message: `A password reset link was requested for ${user.email}. Token valid for 30 minutes.`,
      type: 'PASSWORD_RESET_REQUEST',
    });

    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({
      hospitalId: user.hospitalId,
      userId: user._id,
      userRole: user.role,
      action: 'PASSWORD_RESET_REQUESTED',
      module: 'AUTH',
      details: `Password reset token generated for ${user.email}`,
    });

    return {
      message: 'If an account exists with that email address, a password reset link has been requested.',
      ...(process.env.NODE_ENV !== 'production' && process.env.EXPOSE_DEV_AUTH_TOKENS === 'true'
        ? { resetToken: token }
        : {}),
    };
  }

  static async resetPassword(token, newPassword) {
    if (!token || !newPassword || newPassword.trim().length < 8) {
      throw new ApiError(400, 'Token and a valid new password (at least 8 characters) are required.', null, 'VALIDATION_ERROR');
    }

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires +passwordHash +failedLoginAttempts +lockUntil');

    if (!user) {
      throw new ApiError(400, 'Invalid or expired password reset token.', null, 'INVALID_TOKEN');
    }

    user.passwordHash = await bcrypt.hash(newPassword.trim(), 12);
    user.assignedPasswordHint = '';
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientUserId: user._id,
      recipientRole: user.role,
      hospitalId: user.hospitalId,
      title: 'Password Changed Successfully',
      message: `Your account password was updated successfully. If you did not make this change, contact support immediately.`,
      type: 'PASSWORD_CHANGED',
    });

    const { AuditLog } = await import('../../models/AuditLog.js');
    await AuditLog.create({
      hospitalId: user.hospitalId,
      userId: user._id,
      userRole: user.role,
      action: 'PASSWORD_RESET_COMPLETED',
      module: 'AUTH',
      details: `Password successfully updated via reset token for ${user.email}`,
    });

    return { message: 'Password reset successfully. You can now log in with your new password.' };
  }
}
