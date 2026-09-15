import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { sendError } from '../utils/apiResponse.js';
import { Branch } from '../models/Branch.js';
import { Hospital } from '../models/Hospital.js';
import { User } from '../models/User.js';
import { hasOperationalRoleForModule, hasPermission } from '../config/permissions.js';
import { getTenantConnection } from '../config/tenantDatabase.js';
import { setTenantModelConnection } from '../config/tenantModelContext.js';
import { tenantRuntimeReadiness } from '../config/tenantAwareModel.js';
import { acquireTenantWriteLease } from '../config/tenantOperationLease.js';

const moduleForRequest = (url) => {
  const routes = [
    ['/patients', 'patients'],
    ['/appointments', 'appointments'],
    ['/emr', 'doctor'],
    ['/doctor-updates', 'doctor'],
    ['/beds', 'beds'],
    ['/requests', 'requests'],
    ['/billing', 'billing'],
    ['/diagnostics', 'diagnostics'],
    ['/admissions', 'ipd'],
    ['/emergency', 'emergency'],
    ['/pharmacy', 'pharmacy'],
    ['/inventory', 'pharmacy'],
  ];
  return routes.find(([prefix]) => url.startsWith(`/api/v1${prefix}`))?.[1];
};

const applyContextIfNeeded = async (req) => {
  if (req.user?.role !== 'SUPER_ADMIN') return;

  // Never divert Super Admin's identity profile, logout, or SaaS platform management to a tenant context
  if (
    req.originalUrl?.startsWith('/api/v1/auth/me') ||
    req.originalUrl?.startsWith('/api/v1/auth/logout') ||
    req.originalUrl?.startsWith('/api/v1/saas')
  ) {
    return;
  }

  const contextHospitalId = req.headers['x-hospital-context'] || req.query.hospitalId || req.query.hospitalDomain || req.query.hospital;
  if (!contextHospitalId) return;

  let hospitalDoc = null;
  if (mongoose.Types.ObjectId.isValid(String(contextHospitalId))) {
    hospitalDoc = await Hospital.findById(contextHospitalId);
  }
  if (!hospitalDoc) {
    hospitalDoc = await Hospital.findOne({
      $or: [
        { domain: String(contextHospitalId).toLowerCase() },
        { code: String(contextHospitalId).toUpperCase() },
        { name: String(contextHospitalId) },
      ],
    });
  }

  if (hospitalDoc) {
    req.user.hospitalId = hospitalDoc._id.toString();
    req.user._hospitalContextApplied = true;

    const branch =
      (await Branch.findOne({ hospitalId: hospitalDoc._id, isMainBranch: true })) ||
      (await Branch.findOne({ hospitalId: hospitalDoc._id }));
    if (branch) {
      req.user.branchId = branch._id.toString();
    }
  }
};

const extractId = (val) => {
  if (!val) return '';
  if (typeof val === 'object') {
    return val._id ? String(val._id) : (val.id ? String(val.id) : String(val));
  }
  return String(val);
};

export const activateVerifiedTenantConnection = async (user) => {
  const hospitalId = extractId(user?.hospitalId);
  if (!hospitalId || user?.role === 'SUPER_ADMIN' && !user?._hospitalContextApplied) return null;

  const hospital = await Hospital.findById(hospitalId)
    .select('_id storageMode databaseKey databaseMigrationStatus databaseProvisionedAt')
    .lean();
  if (!hospital) {
    throw new Error('Authenticated hospital tenant no longer exists.');
  }
  if (hospital.storageMode !== 'DEDICATED') return null;
  if (hospital.databaseMigrationStatus !== 'COPY_PREPARED' || !hospital.databaseProvisionedAt) {
    const error = new Error('Dedicated tenant database has not passed copy verification.');
    error.code = 'TENANT_DATABASE_NOT_READY';
    throw error;
  }
  const runtimeReadiness = tenantRuntimeReadiness();
  if (!runtimeReadiness.ready) {
    const error = new Error(`Dedicated tenant runtime is not ready for: ${runtimeReadiness.missingModels.join(', ')}.`);
    error.code = 'TENANT_RUNTIME_NOT_READY';
    throw error;
  }

  const connection = getTenantConnection(hospital);
  setTenantModelConnection({ connection, hospitalId: hospital._id });
  user._tenantDatabase = hospital.databaseKey;
  return connection;
};

export const verifyJwt = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return sendError(res, 401, 'Authentication token missing', null, 'UNAUTHORIZED');
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;

    // Platform Super Admin operational rule
    if (
      decoded.role === 'SUPER_ADMIN' &&
      req.method !== 'GET' &&
      !req.originalUrl.startsWith('/api/v1/saas') &&
      !req.originalUrl.startsWith('/api/v1/workflow') &&
      !req.originalUrl.startsWith('/api/v1/auth') &&
      !req.originalUrl.startsWith('/api/v1/notifications')
    ) {
      return sendError(res, 403, 'Super Admin accounts have read-only platform access and cannot modify hospital operational data.', null, 'OPERATIONAL_ACCESS_FORBIDDEN');
    }

    // Always keep currentUser roles, status, hospitalId & permissions in sync with DB
    let currentUser = null;
    if (decoded.id && decoded.role !== 'SUPER_ADMIN') {
      currentUser = await User.findById(decoded.id)
        .select('hospitalId branchId role additionalRoles isActive status permissions revokedPermissions departmentId additionalDepartments phone uhid patientId email name')
        .lean();

      if (currentUser) {
        if (!currentUser.isActive || currentUser.status === 'INACTIVE') {
          return sendError(res, 403, 'Your account is inactive.', null, 'ACCOUNT_INACTIVE');
        }
        req.user.role = currentUser.role || decoded.role;
        req.user.additionalRoles = currentUser.additionalRoles || [];
        req.user.additionalDepartments = currentUser.additionalDepartments || [];
        req.user.permissions = currentUser.permissions || {};
        req.user.departmentId = currentUser.departmentId;
        req.user.phone = currentUser.phone || req.user.phone || '';
        req.user.uhid = currentUser.uhid || req.user.uhid || '';
        req.user.patientId = currentUser.patientId || req.user.patientId || null;
        req.user.name = currentUser.name || req.user.name || '';
        req.user.email = currentUser.email || req.user.email || '';
        if (currentUser.hospitalId) {
          req.user.hospitalId = currentUser.hospitalId.toString();
        }
        if (currentUser.branchId) {
          req.user.branchId = currentUser.branchId.toString();
        }
      }
    }

    // Expired subscriptions retain readable data but cannot create or mutate
    // operational records. Notification acknowledgement and authentication
    // remain available so the retained account is still usable for review.
    if (req.user.role !== 'SUPER_ADMIN' && req.user.hospitalId) {
      const hospitalAccess = await Hospital.findById(req.user.hospitalId)
        .select('status trialStatus isTrial trialEndDate subscriptionEndDate')
        .lean();
      if (!hospitalAccess) {
        return sendError(res, 403, 'Your hospital tenant is no longer available.', null, 'HOSPITAL_UNAVAILABLE');
      }
      const now = Date.now();
      const isExpired = hospitalAccess.status === 'EXPIRED'
        || hospitalAccess.trialStatus === 'TRIAL_EXPIRED'
        || (hospitalAccess.isTrial && hospitalAccess.trialEndDate && new Date(hospitalAccess.trialEndDate).getTime() <= now)
        || (!hospitalAccess.isTrial && hospitalAccess.subscriptionEndDate && new Date(hospitalAccess.subscriptionEndDate).getTime() <= now);
      const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const retainedAccountAction = req.originalUrl.startsWith('/api/v1/notifications')
        || req.originalUrl.startsWith('/api/v1/auth');
      if (isExpired && isWrite && !retainedAccountAction) {
        return sendError(
          res,
          402,
          'The hospital plan has expired. Data remains available in read-only mode; renew the subscription to resume operational changes.',
          null,
          'SUBSCRIPTION_READ_ONLY',
        );
      }
      req.user.subscriptionReadOnly = isExpired;
    }

    const module = moduleForRequest(req.originalUrl);
    if (
      module &&
      req.method !== 'GET' &&
      ['HOSPITAL_ADMIN', 'SUPER_ADMIN'].includes(req.user.role) &&
      !hasOperationalRoleForModule(req.user, module)
    ) {
      return sendError(
        res,
        403,
        'Governance access is read-only for operational workflows. A hospital administrator needs the corresponding staff role; SuperAdmin must not perform tenant clinical work.',
        null,
        'OPERATIONAL_ROLE_REQUIRED',
      );
    }
    if (module && decoded.role !== 'SUPER_ADMIN' && currentUser) {
      const action = req.method === 'GET' ? 'view' : req.method === 'POST' ? 'create' : req.method === 'DELETE' ? 'delete' : 'edit';
      if (!hasPermission(currentUser, module, action)) {
        return sendError(res, 403, 'You do not have permission to perform this action.', null, 'FORBIDDEN');
      }
    }

    await applyContextIfNeeded(req);
    const isTenantWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.user.role !== 'SUPER_ADMIN' &&
      req.user.hospitalId &&
      !req.originalUrl.startsWith('/api/v1/saas');
    if (isTenantWrite) {
      const releaseLease = await acquireTenantWriteLease({
        hospitalId: req.user.hospitalId,
        method: req.method,
        path: req.originalUrl,
      });
      res.once('finish', releaseLease);
      res.once('close', releaseLease);
    }
    const isAuthProfileOrLogout = req.originalUrl?.startsWith('/api/v1/auth/me') ||
      req.originalUrl?.startsWith('/api/v1/auth/logout');
    const isSuperAdminSaas = req.user.role === 'SUPER_ADMIN' && req.originalUrl?.startsWith('/api/v1/saas');
    if (!isAuthProfileOrLogout && !isSuperAdminSaas) {
      await activateVerifiedTenantConnection(req.user);
    }
    next();
  } catch (error) {
    if (['TENANT_DATABASE_NOT_READY', 'TENANT_RUNTIME_NOT_READY', 'TENANT_WRITE_MAINTENANCE'].includes(error.code)) {
      return sendError(res, 503, error.message, null, error.code);
    }
    if (error.name === 'TokenExpiredError') {
      return sendError(res, 401, 'Token expired', null, 'TOKEN_EXPIRED');
    }
    return sendError(res, 401, 'Invalid authentication token', null, 'INVALID_TOKEN');
  }
};
