import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Hospital, sanitizeAndValidateDomain } from '../../models/Hospital.js';
import { Branch } from '../../models/Branch.js';
import { User } from '../../models/User.js';
import { Patient } from '../../models/Patient.js';
import { Appointment } from '../../models/Appointment.js';
import { Admission } from '../../models/Admission.js';
import { Invoice } from '../../models/Invoice.js';
import { Receipt } from '../../models/Receipt.js';
import { DiagnosticOrder } from '../../models/DiagnosticOrder.js';
import { Emergency } from '../../models/Emergency.js';
import { Consultation } from '../../models/Consultation.js';
import { AuditLog } from '../../models/AuditLog.js';
import { PatientRequest } from '../../models/PatientRequest.js';
import { SubscriptionPlan } from '../../models/SubscriptionPlan.js';
import { ROLES } from '../../config/constants.js';
import { ApiError } from '../../utils/apiError.js';
import { socketManager } from '../../events/socketManager.js';
import { getTenantConnection } from '../../config/tenantDatabase.js';

const PLATFORM_CODES = ['PLATFORM', 'PLATFORM-HQ'];

const isPlatformHospital = (hospital) =>
  PLATFORM_CODES.includes(hospital?.code) || hospital?.subdomain === 'platform';

const tenantFilter = () => ({
  code: { $nin: PLATFORM_CODES },
  subdomain: { $ne: 'platform' },
});

const todayDateStr = () => new Date().toISOString().slice(0, 10);

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

const countStaffByRole = async (hospitalId, role) => {
  const query = { role, isActive: true };
  if (hospitalId) query.hospitalId = hospitalId;
  return User.countDocuments(query);
};

const buildStaffCounts = async (hospitalId = null) => {
  const base = hospitalId ? { hospitalId: { $in: [hospitalId, String(hospitalId)] } } : {};

  const [
    hospitalAdmins,
    doctors,
    receptionists,
    nurses,
    labStaff,
    radiologyStaff,
    pharmacyStaff,
    billingStaff,
  ] = await Promise.all([
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.HOSPITAL_ADMIN, 'HOSPITAL_ADMIN', 'ADMIN'] } }, { additionalRoles: 'HOSPITAL_ADMIN' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.DOCTOR, 'DOCTOR', 'PHYSICIAN'] } }, { additionalRoles: 'DOCTOR' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.RECEPTIONIST, 'RECEPTIONIST', 'RECEPTION', 'FRONT_DESK'] } }, { additionalRoles: 'RECEPTIONIST' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.NURSE, 'NURSE', 'NURSE_INCHARGE', 'NURSING', 'NURSE_STAFF'] } }, { additionalRoles: { $in: ['NURSE', 'NURSE_INCHARGE'] } }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.LAB_TECH, 'LAB_TECH', 'LABORATORY_STAFF', 'PATHOLOGIST'] } }, { additionalRoles: 'LAB_TECH' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.RADIOLOGIST, 'RADIOLOGIST', 'RADIOLOGY_STAFF'] } }, { additionalRoles: 'RADIOLOGIST' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.PHARMACIST, 'PHARMACIST', 'PHARMACY_STAFF'] } }, { additionalRoles: 'PHARMACIST' }] }),
    User.countDocuments({ ...base, role: { $ne: 'SUPER_ADMIN' }, $or: [{ role: { $in: [ROLES.CASHIER, 'CASHIER', 'BILLING_STAFF', 'ACCOUNTANT'] } }, { additionalRoles: 'CASHIER' }] }),
  ]);

  const totalStaff = await User.countDocuments({ ...base, role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] } });

  return {
    hospitalAdmins,
    doctors,
    receptionists,
    nurses,
    labStaff,
    radiologyStaff,
    pharmacyStaff,
    billingStaff,
    totalStaff,
  };
};

const buildPatientCounts = async (hospitalId = null) => {
  const base = hospitalId ? { hospitalId } : {};
  const totalPatients = await Patient.countDocuments(base);
  const ipdPatients = await Admission.countDocuments({
    ...base,
    status: 'ADMITTED',
  });
  const opdPatients = Math.max(0, totalPatients - ipdPatients);

  return { totalPatients, opdPatients, ipdPatients };
};

const safeCount = (model, query) => (model ? model.countDocuments(query).catch(() => 0) : Promise.resolve(0));

const buildTodayMetrics = async (hospitalId = null) => {
  const today = todayDateStr();
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const base = hospitalId ? { hospitalId } : {};

  let hospitalObjId = null;
  if (hospitalId && mongoose.Types.ObjectId.isValid(hospitalId)) {
    hospitalObjId = new mongoose.Types.ObjectId(String(hospitalId));
  }
  const aggBase = hospitalId
    ? { hospitalId: { $in: [hospitalObjId, String(hospitalId)].filter(Boolean) }, isDeleted: { $ne: true } }
    : { isDeleted: { $ne: true } };

  const [
    registrations,
    appointments,
    consultations,
    admissions,
    discharges,
    invRevenueAgg,
    rcRevenueAgg,
    pendingLab,
    pendingRad,
    pendingBilling,
    activeEmgCount,
    activeEmgReqCount,
  ] = await Promise.all([
    safeCount(Patient, { ...base, createdAt: { $gte: todayStart, $lte: todayEnd } }),
    safeCount(Appointment, { ...base, appointmentDate: today }),
    safeCount(Consultation, { ...base, createdAt: { $gte: todayStart, $lte: todayEnd } }),
    safeCount(Admission, { ...base, admittedAt: { $gte: todayStart, $lte: todayEnd } }),
    safeCount(Admission, { ...base, dischargedAt: { $gte: todayStart, $lte: todayEnd } }),
    Invoice.aggregate([
      {
        $match: {
          ...aggBase,
          createdAt: { $gte: todayStart, $lte: todayEnd },
          $or: [{ paidAmount: { $gt: 0 } }, { status: { $in: ['PAID', 'PARTIALLY_PAID'] } }],
        },
      },
      { $group: { _id: null, total: { $sum: '$paidAmount' } } },
    ]).catch(() => []),
    Receipt.aggregate([
      {
        $match: {
          ...aggBase,
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } },
    ]).catch(() => []),
    safeCount(DiagnosticOrder, {
      ...base,
      testCategory: { $in: ['LABORATORY', 'BLOOD_TEST', 'URINE_TEST', 'URINE_ANALYSIS', 'CULTURE_TEST'] },
      status: { $in: ['REQUESTED', 'SAMPLE_COLLECTED', 'IN_PROGRESS'] },
    }),
    safeCount(DiagnosticOrder, {
      ...base,
      testCategory: { $in: ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'ECG', 'ECHO', 'EEG'] },
      status: { $in: ['REQUESTED', 'IN_PROGRESS'] },
    }),
    safeCount(Invoice, { ...base, status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }),
    safeCount(Emergency, { ...base, status: { $in: ['ACTIVE', 'RESPONDED'] } }),
    safeCount(PatientRequest, { ...base, requestCategory: 'EMERGENCY', status: { $in: ['SUBMITTED', 'PENDING', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ESCALATED'] } }),
  ]);

  const emergencies = (activeEmgCount || 0) + (activeEmgReqCount || 0);

  return {
    todayRegistrations: registrations,
    todayAppointments: appointments,
    todayConsultations: consultations,
    todayAdmissions: admissions,
    todayDischarges: discharges,
    todayRevenue: Math.max(invRevenueAgg[0]?.total || 0, rcRevenueAgg[0]?.total || 0),
    pendingLabReports: pendingLab,
    pendingRadiologyReports: pendingRad,
    pendingBilling,
    emergencyCases: emergencies,
  };
};

export class SaasService {
  static async registerHospital(data) {
    if (!data.contactEmail || !data.hospitalName) {
      throw new ApiError(400, 'Hospital name and contact email are required', null, 'VALIDATION_ERROR');
    }
    if (!data.adminPassword || String(data.adminPassword).length < 8) {
      throw new ApiError(400, 'Hospital administrator password must be at least 8 characters long.', null, 'WEAK_PASSWORD');
    }

    const cleanEmail = data.contactEmail.toLowerCase().trim();
    const existingEmail = await Hospital.findOne({ contactEmail: cleanEmail, isDeleted: { $ne: true } });
    if (existingEmail) {
      throw new ApiError(400, `A hospital application with email '${cleanEmail}' already exists`, null, 'DUPLICATE_EMAIL');
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      throw new ApiError(
        400,
        `A user with email '${cleanEmail}' already exists in the system. If this email belongs to a deleted hospital, please permanently delete it first to free up the email.`,
        null,
        'DUPLICATE_EMAIL'
      );
    }

    let rawDomain = data.domain || data.hospitalDomain || data.subdomain || data.hospitalName;
    let cleanDomain = '';
    try {
      cleanDomain = sanitizeAndValidateDomain(rawDomain);
    } catch (err) {
      throw new ApiError(400, err.message, null, 'INVALID_DOMAIN');
    }

    const existingDomain = await Hospital.findOne({
      $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }],
      isDeleted: { $ne: true },
    });
    if (existingDomain) {
      throw new ApiError(
        400,
        `Hospital Domain / URL Name '${cleanDomain}' is already taken. Please choose another unique domain.`,
        null,
        'DUPLICATE_DOMAIN'
      );
    }

    const subdomain = cleanDomain;
    let code = cleanDomain.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) code = `HOSP${Math.floor(100 + Math.random() * 900)}`;

    const trialStartDate = new Date();
    const trialEndDate = new Date(trialStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    const hospital = await Hospital.create({
      name: data.hospitalName.trim(),
      code,
      domain: cleanDomain,
      subdomain: cleanDomain,
      status: 'PENDING_APPROVAL',
      plan: data.plan || 'BASIC',
      contactName: data.contactName || data.hospitalName || 'Hospital Administrator',
      contactEmail: cleanEmail,
      contactPhone: data.contactPhone || '+1 (555) 000-0000',
      licenseNumber: data.licenseNumber || `LIC-${Date.now()}`,
      address: {
        street: data.street || data.address || '123 Healthcare Boulevard, Medical Enclave',
        city: data.city || 'Chennai',
        state: data.state || 'Tamil Nadu',
        country: data.country || 'India',
        postalCode: data.postalCode || data.pincode || '600001',
      },
      isTrial: true,
      trialStartDate,
      trialEndDate,
      trialStatus: 'TRIAL_ACTIVE',
      isActive: true,
    });

    // Create the pending administrator immediately so only a bcrypt hash is
    // retained while the hospital awaits approval. Approval activates it.
    await User.create({
      hospitalId: hospital._id,
      name: data.contactName || data.hospitalName || 'Hospital Administrator',
      email: cleanEmail,
      phone: data.contactPhone || '',
      passwordHash: await bcrypt.hash(String(data.adminPassword), 12),
      role: ROLES.HOSPITAL_ADMIN,
      additionalRoles: [
        'RECEPTIONIST', 'CASHIER', 'NURSE_INCHARGE', 'IPD_STAFF',
        'PHARMACIST', 'LAB_TECH', 'RADIOLOGIST', 'EMERGENCY_STAFF',
        'INVENTORY_MANAGER', 'HR_MANAGER',
      ],
      status: 'INACTIVE',
      isActive: false,
    });

    // Create Notification for Super Admin
    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientRole: 'SUPER_ADMIN',
      hospitalId: hospital._id,
      title: `New Hospital Registration: ${hospital.name}`,
      message: `Hospital ${hospital.name} (Code: ${hospital.code}) registered by ${hospital.contactName} (${hospital.contactEmail}, ${hospital.contactPhone}) on ${trialStartDate.toLocaleString()}. 7-Day Free Trial ends on ${trialEndDate.toLocaleDateString()}.`,
      type: 'REGISTRATION',
      link: '/admin/pending-approvals',
      metadata: {
        hospitalId: hospital._id,
        hospitalName: hospital.name,
        contactName: hospital.contactName,
        contactEmail: hospital.contactEmail,
        contactPhone: hospital.contactPhone,
        trialStatus: 'TRIAL_ACTIVE',
        trialExpiryDate: trialEndDate,
      },
    });

    // Real-time Socket.IO emission to Super Admin online consoles
    try {
      const { socketManager } = await import('../../events/socketManager.js');
      socketManager.emitToRole('SUPER_ADMIN', 'workflow:notification', {
        title: `New Hospital Application: ${hospital.name}`,
        message: `New hospital '${hospital.name}' registered by ${hospital.contactName} (${hospital.contactEmail}). Awaiting Super Admin approval.`,
        type: 'REGISTRATION',
        linkedPath: '/admin/pending-approvals',
        event: 'HOSPITAL_REGISTERED',
        timestamp: new Date().toISOString(),
      });
      socketManager.emitToRole('SUPER_ADMIN', 'saas:pending_changed', {
        hospitalId: hospital._id,
        action: 'NEW_REGISTRATION',
      });
    } catch (e) {
      console.error('Socket emission failed on hospital registration:', e.message);
    }

    // Audit Log Entry
    await AuditLog.create({
      hospitalId: hospital._id,
      action: 'HOSPITAL_REGISTRATION',
      module: 'SAAS',
      details: `New hospital '${hospital.name}' registered with 7-day free trial ending ${trialEndDate.toLocaleDateString()}`,
    });

    return {
      hospital,
      trialEndDate,
    };
  }

  static async getAllHospitals(user, query = {}) {
    const filter = {
      ...tenantFilter(),
    };
    if (query?.includeDeleted !== 'true' && query?.includeDeleted !== true) {
      filter.isDeleted = { $ne: true };
      filter.status = { $ne: 'DELETED' };
    }
    return await Hospital.find(filter).sort({ createdAt: -1 });
  }

  static async getPendingApprovals() {
    const hospitals = await Hospital.find({
      ...tenantFilter(),
      status: { $in: ['PENDING_APPROVAL', 'PENDING'] },
      isDeleted: { $ne: true },
    }).sort({ createdAt: -1 });
    return hospitals;
  }

  static async getSubscriptionAlerts() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Paid plans expiring within 7 days
    const expiringSoon = await Hospital.find({
      ...tenantFilter(),
      isDeleted: { $ne: true },
      isTrial: false,
      subscriptionEndDate: { $ne: null, $gte: now, $lte: sevenDaysFromNow },
    }).sort({ subscriptionEndDate: 1 });

    // Already expired
    const expired = await Hospital.find({
      ...tenantFilter(),
      isDeleted: { $ne: true },
      status: 'EXPIRED',
    }).sort({ subscriptionEndDate: -1 }).limit(20);

    // Trials expiring within 7 days
    const trialsExpiringSoon = await Hospital.find({
      ...tenantFilter(),
      isDeleted: { $ne: true },
      isTrial: true,
      status: 'APPROVED',
      trialEndDate: { $ne: null, $gte: now, $lte: sevenDaysFromNow },
    }).sort({ trialEndDate: 1 });

    return {
      expiringSoon,
      expired,
      trialsExpiringSoon,
    };
  }

  static async getPlatformMetrics() {
    const hospitals = await Hospital.find(tenantFilter());
    const activeHospitals = hospitals.filter((h) => h.status === 'APPROVED');
    const inactiveHospitals = hospitals.filter((h) => h.status !== 'APPROVED');

    const staffCounts = await buildStaffCounts();
    const patientCounts = await buildPatientCounts();
    const todayMetrics = await buildTodayMetrics();

    const recentHospitals = await Hospital.find(tenantFilter())
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name code status plan contactEmail createdAt');

    const recentActivities = await AuditLog.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('hospitalId', 'name')
      .populate('userId', 'name email role')
      .lean();

    return {
      totalHospitals: hospitals.length,
      activeHospitals: activeHospitals.length,
      inactiveHospitals: inactiveHospitals.length,
      ...staffCounts,
      ...patientCounts,
      ...todayMetrics,
      recentHospitalRegistrations: recentHospitals,
      recentActivities: recentActivities.map((a) => ({
        id: a._id,
        action: a.action,
        module: a.module,
        details: a.details,
        hospitalName: a.hospitalId?.name || 'Platform',
        userName: a.userId?.name || 'System',
        userRole: a.userRole || a.userId?.role,
        timestamp: a.createdAt,
      })),
    };
  }

  static async getHospitalDetail(hospitalId, user) {
    const requesterHospitalId = user?.hospitalId?._id || user?.hospitalId;
    if (user?.role !== ROLES.SUPER_ADMIN && (
      user?.role !== ROLES.HOSPITAL_ADMIN
      || String(requesterHospitalId || '') !== String(hospitalId)
    )) {
      throw new ApiError(403, 'You may view only the hospital tenant you administer.');
    }
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital || isPlatformHospital(hospital)) {
      throw new ApiError(404, 'Hospital not found', null, 'NOT_FOUND');
    }

    const admin = await User.findOne({
      hospitalId: hospital._id,
      role: ROLES.HOSPITAL_ADMIN,
    }).select('-passwordHash -assignedPasswordHint -passwordResetToken -emailVerificationToken');

    const staffCounts = await buildStaffCounts(hospital._id);
    const patientCounts = await buildPatientCounts(hospital._id);
    const todayMetrics = await buildTodayMetrics(hospital._id);

    const hospitalObjId = hospital._id;
    const hospitalStrId = String(hospital._id);
    const hospitalFilter = { hospitalId: { $in: [hospitalObjId, hospitalStrId] } };

    const staffRoleFilter = { role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] } };
    const totalStaffCount = await User.countDocuments({ ...hospitalFilter, ...staffRoleFilter });
    const activeStaff = await User.countDocuments({ ...hospitalFilter, ...staffRoleFilter, isActive: true });
    const inactiveStaff = await User.countDocuments({ ...hospitalFilter, ...staffRoleFilter, isActive: false });

    // Fetch all staff members created for this hospital
    const rawStaff = await User.find({ ...hospitalFilter, ...staffRoleFilter })
      .select('-passwordHash -assignedPasswordHint -passwordResetToken -emailVerificationToken')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch invoices for revenue calculations
    const invoices = await Invoice.find({ hospitalId: hospital._id }).lean();
    const totalHospitalRevenue = invoices.reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);

    const consultations = await Consultation.find({ hospitalId: hospital._id }).lean();
    const appointments = await Appointment.find({ hospitalId: hospital._id }).lean();

    const staffList = rawStaff.map((s) => {
      let patientsHandled = 0;
      let revenueGenerated = 0;

      if (s.role === ROLES.DOCTOR) {
        patientsHandled = consultations.filter((c) => String(c.doctorId) === String(s._id)).length;
        revenueGenerated = invoices
          .filter((inv) => String(inv.doctorId) === String(s._id))
          .reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);
      } else if (s.role === ROLES.RECEPTIONIST) {
        patientsHandled = appointments.filter((a) => String(a.createdBy || a.receptionistId) === String(s._id)).length;
      } else {
        revenueGenerated = invoices
          .filter((inv) => String(inv.createdBy || inv.cashierId) === String(s._id))
          .reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);
      }

      return {
        ...s,
        patientsHandled,
        revenueGenerated,
      };
    });

    const patientList = await Patient.find({
      hospitalId: { $in: [hospitalObjId, hospitalStrId] }
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const branches = await Branch.find({
      hospitalId: { $in: [hospitalObjId, hospitalStrId] }
    })
      .sort({ isMainBranch: -1, createdAt: 1 })
      .lean();

    const adminLastLogin = admin?.lastLoginAt || null;

    return {
      hospital: {
        ...hospital.toObject(),
        administrator: admin
          ? { name: admin.name, email: admin.email, phone: admin.phone, lastLoginAt: admin.lastLoginAt }
          : null,
        registrationDate: hospital.createdAt,
        subscriptionPlan: hospital.plan,
        subscriptionExpiry: null,
        lastLogin: adminLastLogin,
        totalStaff: totalStaffCount,
        totalPatients: patientCounts.totalPatients,
        todayRevenue: todayMetrics.todayRevenue,
        totalHospitalRevenue,
      },
      stats: {
        ...staffCounts,
        ...patientCounts,
        activeStaff,
        inactiveStaff,
        ...todayMetrics,
        todayBills: todayMetrics.pendingBilling,
        totalHospitalRevenue,
      },
      staffList,
      patientList,
      branches,
    };
  }

  static async getAllHospitalAdminOverview() {
    const hospitals = await Hospital.find({
      ...tenantFilter(),
      isDeleted: { $ne: true },
      status: { $ne: 'DELETED' },
    }).sort({ name: 1 });

    const overview = await Promise.all(
      hospitals.map(async (hospital) => {
        const staffCounts = await buildStaffCounts(hospital._id);
        const patientCounts = await buildPatientCounts(hospital._id);
        return {
          hospitalId: hospital._id,
          hospitalName: hospital.name,
          hospitalCode: hospital.code,
          status: hospital.status,
          plan: hospital.plan,
          ...staffCounts,
          ...patientCounts,
        };
      })
    );

    return overview;
  }

  static async globalSearch(query, filters = {}) {
    const term = String(query || '').trim();
    if (!term || term.length < 2) {
      return { hospitals: [], doctors: [], staff: [], patients: [], bills: [], departments: [], administrators: [] };
    }

    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hospitalQuery = {
      ...tenantFilter(),
      isDeleted: { $ne: true },
      status: { $ne: 'DELETED' },
      $or: [{ name: regex }, { code: regex }, { subdomain: regex }],
    };
    if (filters.hospitalId) hospitalQuery._id = filters.hospitalId;

    const [hospitals, doctors, staff, patients, bills, administrators] = await Promise.all([
      Hospital.find(hospitalQuery).limit(10).select('name code status plan contactEmail'),
      User.find({
        role: ROLES.DOCTOR,
        $or: [{ name: regex }, { email: regex }, { specialization: regex }],
        ...(filters.hospitalId ? { hospitalId: filters.hospitalId } : {}),
      })
        .limit(10)
        .select('name email role specialization hospitalId')
        .populate('hospitalId', 'name'),
      User.find({
        role: { $nin: [ROLES.SUPER_ADMIN, ROLES.PATIENT, ROLES.GUARDIAN] },
        $or: [{ name: regex }, { email: regex }],
        ...(filters.hospitalId ? { hospitalId: filters.hospitalId } : {}),
      })
        .limit(10)
        .select('name email role hospitalId')
        .populate('hospitalId', 'name'),
      Patient.find({
        $or: [{ firstName: regex }, { lastName: regex }, { uhid: regex }, { phone: regex }],
        ...(filters.hospitalId ? { hospitalId: filters.hospitalId } : {}),
      })
        .limit(10)
        .select('firstName lastName uhid phone hospitalId')
        .populate('hospitalId', 'name'),
      Invoice.find({
        invoiceNo: regex,
        ...(filters.hospitalId ? { hospitalId: filters.hospitalId } : {}),
      })
        .limit(10)
        .select('invoiceNo grandTotal status hospitalId')
        .populate('hospitalId', 'name'),
      User.find({
        role: ROLES.HOSPITAL_ADMIN,
        $or: [{ name: regex }, { email: regex }],
      })
        .limit(10)
        .select('name email hospitalId')
        .populate('hospitalId', 'name'),
    ]);

    return {
      hospitals,
      doctors,
      staff,
      patients,
      bills,
      departments: [],
      administrators,
      tokens: [],
    };
  }

  static async getAuditLogs(filters = {}) {
    const query = {};
    if (filters.hospitalId) query.hospitalId = filters.hospitalId;
    if (filters.module) query.module = filters.module;

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 50)
      .populate('hospitalId', 'name')
      .populate('userId', 'name email role')
      .lean();

    return logs.map((log) => ({
      id: log._id,
      action: log.action,
      module: log.module,
      details: log.details,
      hospitalName: log.hospitalId?.name || 'Platform',
      userName: log.userId?.name || 'System',
      userRole: log.userRole || log.userId?.role,
      ipAddress: log.ipAddress,
      timestamp: log.createdAt,
    }));
  }

  static async getAllHospitalsWithStats() {
    const hospitals = await Hospital.find({
      code: { $nin: PLATFORM_CODES },
      subdomain: { $ne: 'platform' },
    }).sort({ createdAt: -1 }).lean();

    if (!hospitals.length) return [];

    const hospitalIds = hospitals.map((h) => h._id);
    const todayStart = startOfToday();
    const todayEnd = endOfToday();

    const [admins, staffCounts, patientCounts, revenueCounts] = await Promise.all([
      User.find({ hospitalId: { $in: hospitalIds }, role: ROLES.HOSPITAL_ADMIN })
        .select('hospitalId name email lastLoginAt')
        .lean(),
      User.aggregate([
        { $match: { hospitalId: { $in: hospitalIds }, role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] }, isActive: true } },
        { $group: { _id: '$hospitalId', count: { $sum: 1 } } },
      ]),
      Patient.aggregate([
        { $match: { hospitalId: { $in: hospitalIds } } },
        { $group: { _id: '$hospitalId', count: { $sum: 1 } } },
      ]),
      Invoice.aggregate([
        { $match: { hospitalId: { $in: hospitalIds }, createdAt: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: '$hospitalId', total: { $sum: '$paidAmount' } } },
      ]),
    ]);

    const adminMap = new Map(admins.map((a) => [String(a.hospitalId), a]));
    const staffMap = new Map(staffCounts.map((s) => [String(s._id), s.count]));
    const patientMap = new Map(patientCounts.map((p) => [String(p._id), p.count]));
    const revenueMap = new Map(revenueCounts.map((r) => [String(r._id), r.total]));

    const now = new Date();
    return Promise.all(
      hospitals.map(async (hospital) => {
        const hId = String(hospital._id);
        const admin = adminMap.get(hId);
        let totalPatients = patientMap.get(hId) || 0;
        let totalStaff = staffMap.get(hId) || 0;
        let todayRevenue = revenueMap.get(hId) || 0;

        if (hospital.storageMode === 'DEDICATED' && totalPatients === 0) {
          try {
            const tenantConn = getTenantConnection(hospital);
            if (tenantConn) {
              const dedicatedPatients = await tenantConn.collection('patients').countDocuments({
                hospitalId: { $in: [hospital._id, String(hospital._id)] },
              });
              if (dedicatedPatients > 0) totalPatients = dedicatedPatients;
            }
          } catch {
            // ignore tenant lookup errors gracefully
          }
        }

        const isExpired = hospital.status === 'EXPIRED' || (hospital.subscriptionEndDate && new Date(hospital.subscriptionEndDate) < now);

        return {
          ...hospital,
          isExpired,
          administrator: admin ? { name: admin.name, email: admin.email } : null,
          registrationDate: hospital.createdAt,
          subscriptionPlan: hospital.plan,
          subscriptionExpiry: hospital.subscriptionEndDate || null,
          lastLogin: admin?.lastLoginAt || null,
          totalStaff,
          totalPatients,
          todayRevenue,
        };
      })
    );
  }

  static async deleteHospital(hospitalId) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital tenant record not found');
    }
    if (hospital.code === 'PLATFORM' || hospital.domain === 'platform') {
      throw new ApiError(400, 'The master platform owner hospital cannot be deleted.');
    }

    const updated = await Hospital.findByIdAndUpdate(
      hospitalId,
      { $set: { status: 'DELETED', isDeleted: true, isActive: false } },
      { new: true }
    );

    await User.updateMany({ hospitalId: hospital._id }, { $set: { isActive: false } });
    return updated;
  }

  static async permanentlyDeleteHospital(hospitalId) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital tenant record not found');
    }
    if (hospital.code === 'PLATFORM' || hospital.domain === 'platform') {
      throw new ApiError(400, 'The master platform owner hospital cannot be deleted.');
    }

    await Hospital.findByIdAndDelete(hospitalId);

    const collections = [
      'Branch',
      'Department',
      'User',
      'Patient',
      'Appointment',
      'Consultation',
      'Prescription',
      'Invoice',
      'Receipt',
      'DiagnosticOrder',
      'Bed',
      'Emergency',
      'NurseTask',
      'PatientRequest',
      'AuditLog',
      'Notification',
      'Medicine',
      'MedicineBatch',
      'GuardianLink',
      'DoctorUpdate'
    ];

    const mongoose = (await import('mongoose')).default;
    for (const colName of collections) {
      try {
        if (mongoose.models[colName]) {
          await mongoose.models[colName].deleteMany({ hospitalId });
        }
      } catch (err) {
        console.error(`Failed to delete records in ${colName} for hospital ${hospitalId}:`, err.message);
      }
    }

    return { success: true, hospitalId };
  }

  static async restoreHospital(hospitalId) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital tenant record not found');
    }
    const updated = await Hospital.findByIdAndUpdate(
      hospitalId,
      { $set: { status: 'APPROVED', isDeleted: false, isActive: true } },
      { new: true }
    );

    await User.updateMany({ hospitalId: hospital._id }, { $set: { isActive: true } });
    return updated;
  }

  static async approveHospital(hospitalId, user) {
    const hospital = await Hospital.findById(hospitalId).select('+initialAdminPassword');
    if (!hospital) {
      throw new ApiError(404, 'Hospital tenant record not found', null, 'NOT_FOUND');
    }

    hospital.status = 'APPROVED';
    await hospital.save();

    // Create Main Branch for this approved hospital
    let branch = await Branch.findOne({ hospitalId: hospital._id });
    if (!branch) {
      branch = await Branch.create({
        hospitalId: hospital._id,
        name: `${hospital.name} Main Branch`,
        branchCode: `${hospital.code}-MAIN`,
        phone: hospital.contactPhone || '+1 (555) 000-0000',
        email: hospital.contactEmail,
        address: hospital.address?.street || 'Main Medical St',
        city: hospital.address?.city || 'Metropolis',
        state: hospital.address?.state || 'NY',
        postalCode: '10001',
        isMainBranch: true,
      });
    }

    // Activate the pre-created administrator. Legacy pending records may still
    // carry a one-time initial password; it is hashed and erased on approval.
    const cleanEmail = hospital.contactEmail.toLowerCase().trim();

    let adminUser = await User.findOne({ hospitalId: hospital._id, email: cleanEmail });
    if (adminUser) {
      adminUser.hospitalId = hospital._id;
      adminUser.branchId = branch._id;
      adminUser.role = ROLES.HOSPITAL_ADMIN;
      adminUser.status = 'ACTIVE';
      adminUser.isActive = true;
      await adminUser.save();
    } else {
      const legacyInitialPassword = hospital.initialAdminPassword;
      if (!legacyInitialPassword) {
        throw new ApiError(409, 'Administrator credentials are not initialized. Set a new administrator password before approval.', null, 'ADMIN_SETUP_REQUIRED');
      }
      adminUser = await User.create({
        hospitalId: hospital._id,
        branchId: branch._id,
        name: hospital.contactName || 'Hospital Admin',
        email: cleanEmail,
        passwordHash: await bcrypt.hash(legacyInitialPassword, 12),
        role: ROLES.HOSPITAL_ADMIN,
        additionalRoles: [
          'RECEPTIONIST', 'CASHIER', 'NURSE_INCHARGE', 'IPD_STAFF',
          'PHARMACIST', 'LAB_TECH', 'RADIOLOGIST', 'EMERGENCY_STAFF',
          'INVENTORY_MANAGER', 'HR_MANAGER',
        ],
        phone: hospital.contactPhone || '+1 (555) 000-0000',
        status: 'ACTIVE',
      });
    }
    hospital.initialAdminPassword = undefined;
    await hospital.save();
    return {
      hospital,
      adminUser: {
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
    };
  }

  static async updateHospitalStatus(hospitalId, status, user) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital tenant record not found', null, 'NOT_FOUND');
    }

    hospital.status = status;
    await hospital.save();
    return hospital;
  }

  static async updateHospitalConfiguration(hospitalId, data, user, req) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital || isPlatformHospital(hospital)) {
      throw new ApiError(404, 'Hospital not found', null, 'NOT_FOUND');
    }
    const allowed = ['plan', 'status', 'isActive', 'subscriptionStartDate', 'subscriptionEndDate', 'enabledModules', 'enabledDepartments', 'staffLimits', 'usageLimits'];
    const previousState = {};
    for (const key of allowed) {
      if (data[key] !== undefined) {
        previousState[key] = hospital[key];
        hospital[key] = data[key];
      }
    }
    await hospital.save();
    await AuditLog.create({
      hospitalId: hospital._id, userId: user.id, userRole: user.role,
      action: 'HOSPITAL_CONFIGURATION_UPDATED', module: 'PLATFORM_CONFIGURATION',
      resourceId: String(hospital._id), previousState,
      newState: allowed.reduce((values, key) => (data[key] !== undefined ? { ...values, [key]: hospital[key] } : values), {}),
      details: `Platform configuration updated for ${hospital.name}`,
      ipAddress: req?.ip, endpoint: req?.originalUrl, httpMethod: req?.method,
    });
    return hospital;
  }

  // ── SUBSCRIPTION PLAN MANAGEMENT ──
  static async createSubscriptionPlan(data, user) {
    const { SubscriptionPlan } = await import('../../models/SubscriptionPlan.js');
    if (!data.name || !data.code) {
      throw new ApiError(400, 'Plan name and unique plan code are required.', null, 'VALIDATION_ERROR');
    }
    const code = String(data.code).toUpperCase().trim();
    const existing = await SubscriptionPlan.findOne({ code });
    if (existing) {
      throw new ApiError(400, `Subscription plan with code '${code}' already exists.`, null, 'DUPLICATE_CODE');
    }
    const plan = await SubscriptionPlan.create({ ...data, code });
    return plan;
  }

  static async getAllSubscriptionPlans() {
    const { SubscriptionPlan } = await import('../../models/SubscriptionPlan.js');
    let plans = await SubscriptionPlan.find({ code: { $in: ['BASIC', 'STANDARD', 'UNLIMITED'] } }).sort({ monthlyPrice: 1 });
    if (plans.length < 3) {
      // Clear old plans and seed the 3-tier pricing
      await SubscriptionPlan.deleteMany({ code: { $in: ['STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'BASIC', 'STANDARD', 'UNLIMITED'] } });
      plans = await SubscriptionPlan.insertMany([
        {
          name: 'BASIC PLAN',
          code: 'BASIC',
          description: 'For small clinics — register and bill up to 100 patients per month',
          monthlyPrice: 4000,
          yearlyPrice: 40000,
          trialDays: 7,
          patientLimit: 100,
          staffLimits: { hospitalAdmins: 1, doctors: 5, receptionists: 2, nurses: 5, laboratoryStaff: 2, radiologyStaff: 2, pharmacyStaff: 2, billingStaff: 2, totalStaff: 20 },
          usageLimits: { monthlyPatients: 100, storageInGB: 10, branches: 1, departments: 10, notifications: 1000 },
          supportLevel: 'BASIC',
          backupFrequency: 'WEEKLY',
          apiAccess: false,
          isDefault: true,
        },
        {
          name: 'STANDARD PLAN',
          code: 'STANDARD',
          description: 'For growing hospitals — register and bill up to 1,000 patients per month',
          monthlyPrice: 30000,
          yearlyPrice: 300000,
          trialDays: 7,
          patientLimit: 1000,
          staffLimits: { hospitalAdmins: 2, doctors: 20, receptionists: 8, nurses: 20, laboratoryStaff: 8, radiologyStaff: 8, pharmacyStaff: 8, billingStaff: 8, totalStaff: 80 },
          usageLimits: { monthlyPatients: 1000, storageInGB: 50, branches: 3, departments: 25, notifications: 10000 },
          supportLevel: 'PRIORITY',
          backupFrequency: 'DAILY',
          apiAccess: true,
          isDefault: false,
        },
        {
          name: 'UNLIMITED PLAN',
          code: 'UNLIMITED',
          description: 'For large hospital networks — unlimited patients with full platform access',
          monthlyPrice: 50000,
          yearlyPrice: 500000,
          trialDays: 7,
          patientLimit: -1,
          staffLimits: { hospitalAdmins: 5, doctors: 100, receptionists: 30, nurses: 100, laboratoryStaff: 30, radiologyStaff: 30, pharmacyStaff: 30, billingStaff: 30, totalStaff: 500 },
          usageLimits: { monthlyPatients: -1, storageInGB: 500, branches: 20, departments: 100, notifications: 100000 },
          supportLevel: '24_7_DEDICATED',
          backupFrequency: 'HOURLY',
          apiAccess: true,
          isDefault: false,
        },
      ]);
    }
    return plans;
  }

  static async updateSubscriptionPlan(planId, data, user) {
    const { SubscriptionPlan } = await import('../../models/SubscriptionPlan.js');
    const plan = await SubscriptionPlan.findByIdAndUpdate(planId, data, { new: true });
    if (!plan) throw new ApiError(404, 'Subscription plan not found', null, 'NOT_FOUND');
    return plan;
  }

  static async extendHospitalTrial(hospitalId, extraDays = 7, user) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) throw new ApiError(404, 'Hospital tenant not found', null, 'NOT_FOUND');

    const currentEnd = hospital.trialEndDate && new Date(hospital.trialEndDate) > new Date()
      ? new Date(hospital.trialEndDate)
      : new Date();
    
    hospital.trialEndDate = new Date(currentEnd.getTime() + Number(extraDays) * 24 * 60 * 60 * 1000);
    hospital.trialStatus = 'TRIAL_ACTIVE';
    hospital.isTrial = true;
    hospital.status = 'APPROVED';
    await hospital.save();

    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientRole: 'HOSPITAL_ADMIN',
      hospitalId: hospital._id,
      title: 'Free Trial Extended!',
      message: `Your hospital free trial has been extended by ${extraDays} days. New trial expiry date: ${hospital.trialEndDate.toLocaleDateString()}.`,
      type: 'TRIAL_STARTED',
    });

    await AuditLog.create({
      hospitalId: hospital._id,
      userId: user.id,
      userRole: user.role,
      action: 'TRIAL_EXTENDED',
      module: 'SAAS',
      details: `Super Admin extended trial for ${hospital.name} by ${extraDays} days until ${hospital.trialEndDate.toLocaleDateString()}`,
    });

    return hospital;
  }

  static async assignPlanToHospital(hospitalId, { planCode, billingCycle = 'MONTHLY', paymentAmount, paymentMethod, paymentRef, paidAt, renewalNote }, user) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) throw new ApiError(404, 'Hospital tenant not found', null, 'NOT_FOUND');

    const { SubscriptionPlan } = await import('../../models/SubscriptionPlan.js');
    const plan = await SubscriptionPlan.findOne({ code: String(planCode).toUpperCase() });
    if (!plan) throw new ApiError(404, `Subscription plan '${planCode}' not found`, null, 'NOT_FOUND');

    const months = billingCycle === 'YEARLY' ? 12 : 1;
    const previousPlan = hospital.plan;
    const previousEndDate = hospital.subscriptionEndDate;

    hospital.plan = plan.code;
    hospital.subscriptionPlanId = plan._id;
    hospital.isTrial = false;
    hospital.trialStatus = 'SUBSCRIPTION_ACTIVE';
    hospital.status = 'APPROVED';
    hospital.subscriptionStartDate = new Date();
    hospital.subscriptionEndDate = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
    hospital.staffLimits = plan.staffLimits;
    hospital.usageLimits = plan.usageLimits;
    hospital.enabledModules = plan.availableModules;
    // Reset subscription warning flags on renewal
    hospital.subscriptionWarningsSent = { '7_days': false, '3_days': false, '1_day': false, '0_days': false };
    await hospital.save();

    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.createNotification({
      recipientRole: 'HOSPITAL_ADMIN',
      hospitalId: hospital._id,
      title: 'Subscription Activated!',
      message: `Your hospital is now subscribed to the ${plan.name} (${billingCycle}). Active until ${hospital.subscriptionEndDate.toLocaleDateString()}.`,
      type: 'SUBSCRIPTION_ACTIVATED',
    });

    // Build payment trail for audit log
    const paymentDetails = [];
    if (paymentAmount) paymentDetails.push(`Amount: ₹${Number(paymentAmount).toLocaleString('en-IN')}`);
    if (paymentMethod) paymentDetails.push(`Method: ${paymentMethod}`);
    if (paymentRef) paymentDetails.push(`Ref: ${paymentRef}`);
    if (paidAt) paymentDetails.push(`Paid On: ${new Date(paidAt).toLocaleDateString('en-IN')}`);
    if (renewalNote) paymentDetails.push(`Note: ${renewalNote}`);
    const paymentTrail = paymentDetails.length ? ` | Payment — ${paymentDetails.join(' | ')}` : '';
    const previousInfo = previousPlan ? ` | Previous: ${previousPlan} (until ${previousEndDate ? new Date(previousEndDate).toLocaleDateString('en-IN') : 'N/A'})` : '';

    await AuditLog.create({
      hospitalId: hospital._id,
      userId: user.id,
      userRole: user.role,
      action: 'SUBSCRIPTION_PURCHASED',
      module: 'SAAS',
      details: `Plan '${plan.name}' (${billingCycle}) manually assigned to ${hospital.name} until ${hospital.subscriptionEndDate.toLocaleDateString('en-IN')}${previousInfo}${paymentTrail}`,
    });

    return hospital;
  }

  // ── AUTOMATED SUBSCRIPTION EXPIRY & 7-DAY WARNING ──
  static async evaluateSubscriptionExpiry() {
    const hospitals = await Hospital.find({ isDeleted: false, isTrial: false, subscriptionEndDate: { $ne: null } });
    const now = new Date();
    const { NotificationService } = await import('../notifications/notification.service.js');

    for (const hosp of hospitals) {
      if (!hosp.subscriptionEndDate) continue;

      const diffTime = new Date(hosp.subscriptionEndDate) - now;
      const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const warnings = hosp.subscriptionWarningsSent || { '7_days': false, '3_days': false, '1_day': false, '0_days': false };

      // Expired — set data retention deadline (90 days)
      if (remainingDays <= 0 && hosp.status !== 'EXPIRED') {
        hosp.status = 'EXPIRED';
        hosp.trialStatus = 'TRIAL_EXPIRED';
        // Expiry is read-only, never an automatic clinical-data deletion timer.
        hosp.dataRetentionDeadline = null;
        hosp.dataRetentionNotified = false;
        warnings['0_days'] = true;
        hosp.subscriptionWarningsSent = warnings;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Subscription Expired',
          message: `Your ${hosp.plan} plan has expired. Your hospital data remains available in read-only mode. Please renew to restore operational changes.`,
          type: 'TRIAL_EXPIRED',
        });

        await NotificationService.createNotification({
          recipientRole: 'SUPER_ADMIN',
          hospitalId: hosp._id,
          title: `Subscription Expired: ${hosp.name}`,
          message: `${hosp.plan} plan for ${hosp.name} (${hosp.contactEmail}) expired today. The tenant is now read-only; no automatic data deletion is scheduled.`,
          type: 'TRIAL_EXPIRED',
          link: `/admin/hospital/${hosp._id}/dashboard`,
        });
      } else if (remainingDays <= 7 && !warnings['7_days']) {
        // 7-day warning
        warnings['7_days'] = true;
        hosp.subscriptionWarningsSent = warnings;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Subscription Expiring in 7 Days',
          message: `Your ${hosp.plan} subscription expires on ${new Date(hosp.subscriptionEndDate).toLocaleDateString()}. Renew to maintain uninterrupted service.`,
          type: 'TRIAL_EXPIRING',
        });

        await NotificationService.createNotification({
          recipientRole: 'SUPER_ADMIN',
          hospitalId: hosp._id,
          title: `Plan Expiring Soon: ${hosp.name}`,
          message: `${hosp.name}'s ${hosp.plan} plan expires in ${remainingDays} days on ${new Date(hosp.subscriptionEndDate).toLocaleDateString()}. Contact organization to renew.`,
          type: 'TRIAL_EXPIRING',
          link: `/admin/hospital/${hosp._id}/dashboard`,
        });
      } else if (remainingDays <= 3 && !warnings['3_days']) {
        warnings['3_days'] = true;
        hosp.subscriptionWarningsSent = warnings;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: `Subscription Expiring in ${remainingDays} Days`,
          message: `Your ${hosp.plan} plan expires in ${remainingDays} days. Please renew to prevent service disruption.`,
          type: 'TRIAL_EXPIRING',
        });
      } else if (remainingDays <= 1 && !warnings['1_day']) {
        warnings['1_day'] = true;
        hosp.subscriptionWarningsSent = warnings;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Subscription Expires Tomorrow',
          message: `Your ${hosp.plan} plan expires tomorrow. Renew immediately to maintain access.`,
          type: 'TRIAL_EXPIRING',
        });
      }
    }

    // Check 90-day data retention deadlines — clear legacy deadlines if present
    const expiringRetention = await Hospital.find({
      dataRetentionDeadline: { $ne: null },
    });
    for (const hosp of expiringRetention) {
      hosp.dataRetentionDeadline = null;
      hosp.dataRetentionNotified = true;
      await hosp.save();
    }
  }

  // ── AUTOMATED TRIAL EXPIRY & REMINDERS EVALUATOR ──
  static async evaluateHospitalTrials() {
    const hospitals = await Hospital.find({ isDeleted: false });
    const now = new Date();
    const { NotificationService } = await import('../notifications/notification.service.js');

    for (const hosp of hospitals) {
      if (!hosp.isTrial || !hosp.trialEndDate) continue;

      const diffTime = hosp.trialEndDate - now;
      const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const reminders = hosp.trialRemindersSent || { '3_days': false, '2_days': false, '1_day': false, '0_days': false };

      if (remainingDays <= 0 && hosp.trialStatus !== 'TRIAL_EXPIRED') {
        hosp.trialStatus = 'TRIAL_EXPIRED';
        hosp.status = 'EXPIRED';
        reminders['0_days'] = true;
        hosp.trialRemindersSent = reminders;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Free Trial Expired',
          message: `Your free trial has ended. Please renew your subscription to continue using the Hospital Billing & Management System. All your hospital data is safe.`,
          type: 'TRIAL_EXPIRED',
        });

        await NotificationService.createNotification({
          recipientRole: 'SUPER_ADMIN',
          hospitalId: hosp._id,
          title: `Trial Expired: ${hosp.name}`,
          message: `Free trial for ${hosp.name} (Admin: ${hosp.contactEmail}) has expired today.`,
          type: 'TRIAL_EXPIRED',
          link: `/admin/hospital/${hosp._id}/dashboard`,
        });
      } else if (remainingDays === 1 && !reminders['1_day']) {
        hosp.trialStatus = 'TRIAL_EXPIRING_SOON';
        reminders['1_day'] = true;
        hosp.trialRemindersSent = reminders;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Trial Expires Tomorrow!',
          message: `Your hospital free trial will expire in 1 day. Subscribe now to continue uninterrupted access.`,
          type: 'TRIAL_EXPIRING',
        });
      } else if (remainingDays === 2 && !reminders['2_days']) {
        hosp.trialStatus = 'TRIAL_EXPIRING_SOON';
        reminders['2_days'] = true;
        hosp.trialRemindersSent = reminders;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Trial Expiring in 2 Days',
          message: `Your hospital free trial will expire in 2 days. Subscribe now to continue uninterrupted access.`,
          type: 'TRIAL_EXPIRING',
        });
      } else if (remainingDays === 3 && !reminders['3_days']) {
        hosp.trialStatus = 'TRIAL_EXPIRING_SOON';
        reminders['3_days'] = true;
        hosp.trialRemindersSent = reminders;
        await hosp.save();

        await NotificationService.createNotification({
          recipientRole: 'HOSPITAL_ADMIN',
          hospitalId: hosp._id,
          title: 'Trial Expiring in 3 Days',
          message: `Your hospital free trial will expire in 3 days. Subscribe now to continue uninterrupted access.`,
          type: 'TRIAL_EXPIRING',
        });
      }
    }
  }

  static async updateHospitalAdminCredentials(hospitalId, data) {
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital not found');
    }

    const {
      name,
      hospitalName,
      domain,
      subdomain,
      email,
      phone,
      contactPhone,
      password,
      street,
      city,
      state,
      postalCode,
    } = data;

    const cleanEmail = email ? email.toLowerCase().trim() : '';
    const cleanPhone = (phone || contactPhone || '').trim();
    const cleanDomain = (domain || subdomain || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '');

    // Check domain uniqueness if changed
    if (cleanDomain && cleanDomain !== hospital.domain && cleanDomain !== hospital.subdomain) {
      const existingDomain = await Hospital.findOne({
        _id: { $ne: hospital._id },
        $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }]
      });
      if (existingDomain) {
        throw new ApiError(400, `Hospital domain/subdomain '${cleanDomain}' is already taken.`);
      }
      hospital.domain = cleanDomain;
      hospital.subdomain = cleanDomain;
    }

    if (hospitalName && String(hospitalName).trim()) {
      hospital.name = String(hospitalName).trim();
    }

    const hospitalObjId = hospital._id;
    const hospitalStrId = String(hospital._id);

    let adminUser = await User.findOne({
      hospitalId: { $in: [hospitalObjId, hospitalStrId, hospitalId] },
      role: { $in: [ROLES.HOSPITAL_ADMIN, 'HOSPITAL_ADMIN', 'ADMIN'] },
    });

    if (cleanEmail) {
      const existingUser = await User.findOne({ email: cleanEmail });
      if (existingUser && existingUser._id.toString() !== adminUser?._id?.toString()) {
        throw new ApiError(400, `A user with email '${cleanEmail}' already exists in the system.`);
      }
    }

    const cleanPassword = password ? String(password).trim() : '';
    if (cleanPassword && cleanPassword.length < 8) {
      throw new ApiError(400, 'Administrator password must be at least 8 characters long.', null, 'WEAK_PASSWORD');
    }

    if (!adminUser) {
      if (!cleanPassword) {
        throw new ApiError(400, 'A password is required when creating the hospital administrator.', null, 'PASSWORD_REQUIRED');
      }
      const passwordHash = await bcrypt.hash(cleanPassword, 12);
      adminUser = await User.create({
        hospitalId: hospital._id,
        name: name || hospital.contactName || 'Hospital Admin',
        email: cleanEmail || hospital.contactEmail,
        passwordHash,
        role: ROLES.HOSPITAL_ADMIN || 'HOSPITAL_ADMIN',
        phone: cleanPhone || hospital.contactPhone || '+1 (555) 000-0000',
        status: 'ACTIVE',
      });
    } else {
      if (name) adminUser.name = name;
      if (cleanEmail) adminUser.email = cleanEmail;
      if (cleanPhone) adminUser.phone = cleanPhone;
      if (!adminUser.phone) adminUser.phone = hospital.contactPhone || '+1 (555) 000-0000';
      if (!adminUser.role) adminUser.role = ROLES.HOSPITAL_ADMIN || 'HOSPITAL_ADMIN';
      if (cleanPassword) {
        adminUser.passwordHash = cleanPassword;
        adminUser.assignedPasswordHint = '';
      }
      await adminUser.save();
    }

    if (name) hospital.contactName = name;
    if (cleanEmail) hospital.contactEmail = cleanEmail;
    if (cleanPhone) hospital.contactPhone = cleanPhone;
    if (!hospital.contactPhone) hospital.contactPhone = adminUser.phone || '+1 (555) 000-0000';
    if (!hospital.licenseNumber) hospital.licenseNumber = 'LIC-' + (hospital.code || 'DEFAULT');

    if (street !== undefined || city !== undefined || state !== undefined || postalCode !== undefined) {
      hospital.address = {
        street: street !== undefined ? street : hospital.address?.street || '',
        city: city !== undefined ? city : hospital.address?.city || '',
        state: state !== undefined ? state : hospital.address?.state || '',
        postalCode: postalCode !== undefined ? postalCode : hospital.address?.postalCode || '',
        country: 'India',
      };
    }

    await hospital.save();

    return {
      hospital,
      adminUser: {
        name: adminUser.name,
        email: adminUser.email,
        phone: adminUser.phone,
        role: adminUser.role,
        passwordReset: Boolean(cleanPassword),
      }
    };
  }

  static async getHospitalByDomain(domainSlug) {
    if (!domainSlug || !String(domainSlug).trim()) {
      throw new ApiError(400, 'Hospital domain parameter is required', null, 'VALIDATION_ERROR');
    }
    const cleanDomain = String(domainSlug).toLowerCase().trim();
    const hospital = await Hospital.findOne({
      $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }],
      isDeleted: { $ne: true },
    }).select('name code domain subdomain status plan contactEmail logoUrl address enabledModules').lean();

    if (!hospital) {
      throw new ApiError(404, `Hospital domain '${cleanDomain}' not found.`, null, 'HOSPITAL_NOT_FOUND');
    }
    return hospital;
  }

  static async updateHospitalDomain(hospitalId, newDomain, requestingUser) {
    if (requestingUser?.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'Only Super Admin can update a hospital domain.', null, 'FORBIDDEN');
    }
    const cleanDomain = sanitizeAndValidateDomain(newDomain);
    const existing = await Hospital.findOne({
      _id: { $ne: hospitalId },
      $or: [{ domain: cleanDomain }, { subdomain: cleanDomain }],
      isDeleted: { $ne: true },
    });
    if (existing) {
      throw new ApiError(400, `Domain '${cleanDomain}' is already in use by another hospital.`, null, 'DUPLICATE_DOMAIN');
    }

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital not found', null, 'NOT_FOUND');
    }
    const oldDomain = hospital.domain;
    hospital.domain = cleanDomain;
    hospital.subdomain = cleanDomain;
    await hospital.save();

    await AuditLog.create({
      action: 'UPDATE_HOSPITAL_DOMAIN',
      userId: requestingUser.id,
      userRole: requestingUser.role,
      userEmail: requestingUser.email,
      hospitalId,
      details: { oldDomain, newDomain: cleanDomain },
    }).catch(() => {});

    return hospital;
  }

  // ── Multi-Branch Expansion Requests & Management ──────────────────────────────
  static async createBranchRequest(data, user) {
    const { BranchRequest } = await import('../../models/BranchRequest.js');
    const { Branch } = await import('../../models/Branch.js');
    const { Hospital } = await import('../../models/Hospital.js');

    const hospitalId = user.hospitalId?._id || user.hospitalId || data.hospitalId;
    if (!hospitalId) {
      throw new ApiError(400, 'Hospital context is required for branch request.');
    }

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Hospital organization not found.');
    }

    const branchName = String(data.branchName || '').trim();
    const branchCode = String(data.branchCode || '').trim().toUpperCase();
    const phone = String(data.phone || hospital.contactPhone || user.phone || '9999999999').trim();
    const email = String(data.email || hospital.contactEmail || user.email || 'admin@hospital.com').trim();

    const hospAddr = hospital.address || {};
    const defaultAddress = typeof hospital.address === 'string'
      ? hospital.address
      : (hospAddr.street || hospAddr.city || branchName || 'Main Campus');
    const defaultCity = typeof hospital.address === 'object'
      ? (hospAddr.city || 'Hosur')
      : (hospital.city || 'Hosur');
    const defaultState = typeof hospital.address === 'object'
      ? (hospAddr.state || 'Tamil Nadu')
      : (hospital.state || 'Tamil Nadu');
    const defaultPostalCode = typeof hospital.address === 'object'
      ? (hospAddr.postalCode || '635109')
      : (hospital.postalCode || '635109');

    const address = String(data.address || defaultAddress).trim();
    const city = String(data.city || defaultCity).trim();
    const state = String(data.state || defaultState).trim();
    const postalCode = String(data.postalCode || defaultPostalCode).trim();
    const reason = String(data.reason || '').trim();

    if (!branchName || !branchCode) {
      throw new ApiError(400, 'Branch Name and Branch Code are required.');
    }

    // Check if branchCode already exists for this hospital
    const existingBranch = await Branch.findOne({ hospitalId, branchCode });
    if (existingBranch) {
      throw new ApiError(400, `Branch with code '${branchCode}' already exists for this hospital.`);
    }

    const existingPending = await BranchRequest.findOne({ hospitalId, branchCode, status: 'PENDING' });
    if (existingPending) {
      throw new ApiError(400, `A pending request for branch code '${branchCode}' already exists.`);
    }

    const branchReq = await BranchRequest.create({
      hospitalId,
      requestedByUserId: user.id || user._id,
      branchName,
      branchCode,
      phone,
      email: email || hospital.contactEmail || 'admin@hospital.com',
      address,
      city,
      state: state || 'Tamil Nadu',
      postalCode: postalCode || '635109',
      reason,
      status: 'PENDING',
    });

    // Notify Super Admin
    try {
      const { NotificationService } = await import('../notifications/notification.service.js');
      await NotificationService.createNotification({
        recipientRole: 'SUPER_ADMIN',
        title: 'New Branch Expansion Request',
        message: `${hospital.name} requested approval for a new branch: "${branchName}" (${city}).`,
        type: 'NEW_HOSPITAL_SIGNUP',
        targetModule: 'super-admin',
        targetRoute: '/admin/pending-approvals',
      });
    } catch (_) {}

    // Real-time socket emission to Super Admin
    if (socketManager.io) {
      socketManager.emitToRole('SUPER_ADMIN', 'branch_request:created', branchReq);
      socketManager.emitToRole('SUPER_ADMIN', 'superadmin:pending_count_changed', { type: 'branch' });
      socketManager.emitToRole('SUPER_ADMIN', 'notification:created', {
        title: 'New Branch Expansion Request',
        message: `${hospital.name} requested approval for a new branch: "${branchName}" (${city}).`,
        targetRoute: '/admin/pending-approvals',
      });
    }

    return branchReq;
  }

  static async getBranchRequests(query = {}, user) {
    const { BranchRequest } = await import('../../models/BranchRequest.js');
    const filter = {};
    if (user.role !== 'SUPER_ADMIN') {
      const hospitalId = user.hospitalId?._id || user.hospitalId;
      if (hospitalId) filter.hospitalId = hospitalId;
    }
    if (query.status) {
      filter.status = query.status;
    }

    const requests = await BranchRequest.find(filter)
      .populate('hospitalId', 'name code domain plan contactName contactPhone')
      .populate('requestedByUserId', 'name email phone role')
      .populate('reviewedByUserId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return requests;
  }

  static async approveBranchRequest(requestId, user) {
    const { BranchRequest } = await import('../../models/BranchRequest.js');
    const { Branch } = await import('../../models/Branch.js');
    const { Hospital } = await import('../../models/Hospital.js');

    const reqDoc = await BranchRequest.findById(requestId);
    if (!reqDoc) {
      throw new ApiError(404, 'Branch request not found.');
    }
    if (reqDoc.status !== 'PENDING') {
      throw new ApiError(400, `Branch request has already been ${reqDoc.status.toLowerCase()}.`);
    }

    const hospital = await Hospital.findById(reqDoc.hospitalId);
    if (!hospital) {
      throw new ApiError(404, 'Associated hospital not found.');
    }

    // Create the active branch
    const branch = await Branch.create({
      hospitalId: hospital._id,
      name: reqDoc.branchName,
      branchCode: reqDoc.branchCode,
      phone: reqDoc.phone,
      email: reqDoc.email,
      address: reqDoc.address,
      city: reqDoc.city,
      state: reqDoc.state,
      postalCode: reqDoc.postalCode,
      isMainBranch: false,
      status: 'ACTIVE',
    });

    // Increment branch limit if needed
    const currentLimit = Number(hospital.usageLimits?.branches || 1);
    const activeBranchCount = await Branch.countDocuments({ hospitalId: hospital._id, status: 'ACTIVE' });
    if (activeBranchCount > currentLimit) {
      hospital.usageLimits = {
        ...(hospital.usageLimits || {}),
        branches: activeBranchCount,
      };
      await hospital.save();
    }

    reqDoc.status = 'APPROVED';
    reqDoc.createdBranchId = branch._id;
    reqDoc.reviewedByUserId = user.id || user._id;
    reqDoc.reviewedAt = new Date();
    await reqDoc.save();

    // Notify Hospital Admin
    try {
      const { NotificationService } = await import('../notifications/notification.service.js');
      await NotificationService.createNotification({
        recipientRole: 'HOSPITAL_ADMIN',
        hospitalId: hospital._id,
        title: 'Branch Approved & Activated!',
        message: `Your new branch "${reqDoc.branchName}" (${reqDoc.city}) has been approved and is now active. You can switch to it from the top navbar.`,
        type: 'SUBSCRIPTION_ACTIVATED',
        targetModule: 'admin',
        targetRoute: '/admin/dashboard',
      });
    } catch (_) {}

    return { branch, request: reqDoc };
  }

  static async rejectBranchRequest(requestId, { reason }, user) {
    const { BranchRequest } = await import('../../models/BranchRequest.js');
    const reqDoc = await BranchRequest.findById(requestId);
    if (!reqDoc) {
      throw new ApiError(404, 'Branch request not found.');
    }
    if (reqDoc.status !== 'PENDING') {
      throw new ApiError(400, `Branch request has already been ${reqDoc.status.toLowerCase()}.`);
    }

    reqDoc.status = 'REJECTED';
    reqDoc.rejectionReason = reason || 'Declined by platform administration.';
    reqDoc.reviewedByUserId = user.id || user._id;
    reqDoc.reviewedAt = new Date();
    await reqDoc.save();

    return reqDoc;
  }

  static async getHospitalBranches(hospitalId, user) {
    const { Branch } = await import('../../models/Branch.js');
    const targetHospId = hospitalId || user?.hospitalId?._id || user?.hospitalId;
    if (!targetHospId) {
      throw new ApiError(400, 'Hospital ID is required to fetch branches.');
    }

    const isAdmin = ['HOSPITAL_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role);
    const filter = { hospitalId: targetHospId };
    if (!isAdmin) {
      filter.status = 'ACTIVE';
    }

    const branches = await Branch.find(filter)
      .sort({ isMainBranch: -1, createdAt: 1 })
      .lean();

    return branches;
  }

  static async updateBranchStatus(branchId, status, user) {
    const { Branch } = await import('../../models/Branch.js');
    const branch = await Branch.findById(branchId);
    if (!branch) {
      throw new ApiError(404, 'Branch not found.');
    }

    if (user.role !== 'SUPER_ADMIN') {
      const userHospId = String(user.hospitalId?._id || user.hospitalId || '');
      if (String(branch.hospitalId) !== userHospId) {
        throw new ApiError(403, 'Unauthorized to modify branches of another hospital.');
      }
    }

    if (branch.isMainBranch && status !== 'ACTIVE') {
      throw new ApiError(400, 'The Main Campus branch cannot be suspended or deactivated.');
    }

    const validStatuses = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
    const cleanStatus = String(status || '').toUpperCase();
    if (!validStatuses.includes(cleanStatus)) {
      throw new ApiError(400, `Invalid branch status '${status}'. Must be one of: ${validStatuses.join(', ')}`);
    }

    branch.status = cleanStatus;
    await branch.save();

    socketManager.emitToHospital(String(branch.hospitalId), 'branch:updated', branch);
    socketManager.emitToRole('SUPER_ADMIN', 'branch:updated', branch);

    return branch;
  }

  static async deleteBranch(branchId, user) {
    const { Branch } = await import('../../models/Branch.js');
    const { BranchRequest } = await import('../../models/BranchRequest.js');
    const branch = await Branch.findById(branchId);
    if (!branch) {
      throw new ApiError(404, 'Branch not found.');
    }

    if (user.role !== 'SUPER_ADMIN') {
      const userHospId = String(user.hospitalId?._id || user.hospitalId || '');
      if (String(branch.hospitalId) !== userHospId) {
        throw new ApiError(403, 'Unauthorized to delete branches of another hospital.');
      }
    }

    if (branch.isMainBranch) {
      throw new ApiError(400, 'The Main Campus branch cannot be deleted.');
    }

    await Branch.findByIdAndDelete(branchId);
    await BranchRequest.deleteMany({ createdBranchId: branchId });

    const branchEvent = { branchId, hospitalId: branch.hospitalId };
    socketManager.emitToHospital(String(branch.hospitalId), 'branch:deleted', branchEvent);
    socketManager.emitToRole('SUPER_ADMIN', 'branch:deleted', branchEvent);

    return { message: `Branch "${branch.name}" has been deleted.` };
  }

  static async assignBranchPlan(branchId, planData, user) {
    const { Branch } = await import('../../models/Branch.js');
    const { Hospital } = await import('../../models/Hospital.js');

    const branch = await Branch.findById(branchId);
    if (!branch) {
      throw new ApiError(404, 'Branch not found.');
    }

    const {
      planCode,
      billingCycle = 'MONTHLY',
      paymentAmount,
      paymentMethod = 'Cash',
      paymentRef,
      paidAt = new Date(),
      renewalNote,
    } = planData;

    const validPlans = ['BASIC', 'STANDARD', 'UNLIMITED', 'PROFESSIONAL', 'ENTERPRISE', 'STARTER'];
    if (!validPlans.includes(planCode)) {
      throw new ApiError(400, `Invalid plan code '${planCode}'. Must be one of: ${validPlans.join(', ')}`);
    }

    const startDate = new Date(paidAt || Date.now());
    const daysToAdd = billingCycle === 'YEARLY' ? 365 : 30;
    const endDate = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

    branch.plan = planCode;
    branch.billingCycle = billingCycle;
    branch.subscriptionStartDate = startDate;
    branch.subscriptionEndDate = endDate;
    branch.isTrial = false;
    branch.status = 'ACTIVE';

    if (!Array.isArray(branch.subscriptionHistory)) {
      branch.subscriptionHistory = [];
    }

    branch.subscriptionHistory.push({
      plan: planCode,
      billingCycle,
      amount: paymentAmount ? Number(paymentAmount) : undefined,
      paymentMethod,
      paymentRef,
      paidAt: startDate,
      renewalNote,
      renewedBy: user.id || user._id,
      createdAt: new Date(),
    });

    await branch.save();

    await AuditLog.create({
      hospitalId: branch.hospitalId,
      userId: user.id || user._id,
      userRole: user.role,
      action: 'BRANCH_PLAN_ASSIGNED',
      module: 'SAAS',
      details: `Plan '${planCode}' (${billingCycle}) assigned to sub-branch '${branch.name}' (${branch.branchCode}). Valid until ${endDate.toLocaleDateString()}`,
    });

    socketManager.emitToHospital(String(branch.hospitalId), 'branch:updated', branch);
    socketManager.emitToRole('SUPER_ADMIN', 'branch:updated', branch);

    return branch;
  }

  static async getBranchDetail(branchId) {
    const { Branch } = await import('../../models/Branch.js');
    const { Hospital } = await import('../../models/Hospital.js');
    const { User } = await import('../../models/User.js');
    const { Patient } = await import('../../models/Patient.js');
    const { Invoice } = await import('../../models/Invoice.js');
    const { Consultation } = await import('../../models/Consultation.js');
    const { Appointment } = await import('../../models/Appointment.js');
    const { DiagnosticOrder } = await import('../../models/DiagnosticOrder.js');

    const branch = await Branch.findById(branchId).populate('hospitalId');
    if (!branch) {
      throw new ApiError(404, 'Branch not found.');
    }

    const hospital = branch.hospitalId;
    const branchObjId = branch._id;
    const branchStrId = String(branch._id);
    const branchCode = branch.branchCode;

    // Staff filter: staff with branchId matching or assigned to hospital
    const branchStaffFilter = {
      hospitalId: hospital._id,
      role: { $nin: ['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'] },
      $or: [
        { branchId: { $in: [branchObjId, branchStrId] } },
        { assignedBranchCode: branchCode },
        ...(branch.isMainBranch ? [{ branchId: { $exists: false } }, { branchId: null }] : []),
      ],
    };

    const rawStaff = await User.find(branchStaffFilter).select('-passwordHash -assignedPasswordHint -passwordResetToken -emailVerificationToken').sort({ createdAt: -1 }).lean();

    // Invoices for this branch
    const branchInvFilter = {
      hospitalId: hospital._id,
      $or: [
        { branchId: { $in: [branchObjId, branchStrId] } },
        { branchCode: branchCode },
        ...(branch.isMainBranch ? [{ branchId: { $exists: false } }, { branchId: null }] : []),
      ],
    };
    const invoices = await Invoice.find(branchInvFilter).sort({ createdAt: -1 }).lean();
    const totalBranchRevenue = invoices.reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);

    const consultations = await Consultation.find(branchInvFilter).lean();
    const appointments = await Appointment.find(branchInvFilter).lean();
    const diagnostics = await DiagnosticOrder.find(branchInvFilter).lean();

    const staffList = rawStaff.map((s) => {
      let patientsHandled = 0;
      let revenueGenerated = 0;

      if (s.role === 'DOCTOR') {
        patientsHandled = consultations.filter((c) => String(c.doctorId) === String(s._id)).length;
        revenueGenerated = invoices
          .filter((inv) => String(inv.doctorId) === String(s._id))
          .reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);
      } else if (s.role === 'RECEPTIONIST') {
        patientsHandled = appointments.filter((a) => String(a.createdBy || a.receptionistId) === String(s._id)).length;
      } else {
        revenueGenerated = invoices
          .filter((inv) => String(inv.createdBy || inv.cashierId) === String(s._id))
          .reduce((sum, inv) => sum + (inv.paidAmount || inv.grandTotal || 0), 0);
      }

      return {
        ...s,
        patientsHandled,
        revenueGenerated,
      };
    });

    // Patients registered at or associated with this branch
    const branchPatientFilter = {
      hospitalId: hospital._id,
      $or: [
        { branchId: { $in: [branchObjId, branchStrId] } },
        { registrationBranchCode: branchCode },
        ...(branch.isMainBranch ? [{ branchId: { $exists: false } }, { branchId: null }] : []),
      ],
    };

    const patientList = await Patient.find(branchPatientFilter).sort({ createdAt: -1 }).limit(100).lean();

    const stats = {
      doctors: staffList.filter((s) => s.role === 'DOCTOR').length,
      receptionists: staffList.filter((s) => s.role === 'RECEPTIONIST').length,
      nurses: staffList.filter((s) => ['NURSE', 'NURSE_INCHARGE'].includes(s.role)).length,
      labStaff: staffList.filter((s) => s.role === 'LAB_TECH').length,
      radiologyStaff: staffList.filter((s) => s.role === 'RADIOLOGIST').length,
      pharmacyStaff: staffList.filter((s) => s.role === 'PHARMACIST').length,
      billingStaff: staffList.filter((s) => s.role === 'CASHIER').length,
      activeStaff: staffList.filter((s) => s.isActive).length,
      inactiveStaff: staffList.filter((s) => !s.isActive).length,
      totalPatients: patientList.length,
      opdPatients: consultations.length,
      ipdPatients: patientList.filter((p) => p.isIPD || p.admissionStatus === 'ADMITTED').length,
      totalBranchRevenue,
      todayConsultations: consultations.filter((c) => {
        const d = new Date(c.createdAt || c.consultationDate);
        const today = new Date();
        return d.toDateString() === today.toDateString();
      }).length,
    };

    return {
      branch: branch.toObject(),
      hospital: {
        _id: hospital._id,
        name: hospital.name,
        code: hospital.code,
        domain: hospital.domain,
        contactEmail: hospital.contactEmail,
        contactPhone: hospital.contactPhone,
        plan: hospital.plan,
      },
      stats,
      staffList,
      patientList,
      invoices: invoices.slice(0, 50),
    };
  }

  static async getAllBranches() {
    const { Branch } = await import('../../models/Branch.js');
    return await Branch.find({})
      .populate('hospitalId', 'name code domain plan')
      .sort({ isMainBranch: -1, createdAt: 1 })
      .lean();
  }
}


