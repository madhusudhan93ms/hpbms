import { SaasService } from './saas.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { TenantMigrationService } from './tenantMigration.service.js';
import { TenantExportService, safeExportJson } from './tenantExport.service.js';
import { decryptField } from '../../utils/fieldEncryption.js';
import { once } from 'node:events';

export const registerHospital = async (req, res, next) => {
  try {
    const result = await SaasService.registerHospital(req.body);
    return sendSuccess(res, 201, 'Hospital SaaS registration application submitted successfully! Pending Super Admin Approval.', result);
  } catch (error) {
    next(error);
  }
};

export const getAllHospitals = async (req, res, next) => {
  try {
    const hospitals = await SaasService.getAllHospitals(req.user, req.query);
    return sendSuccess(res, 200, 'SaaS Hospital Tenants retrieved successfully', hospitals);
  } catch (error) {
    next(error);
  }
};

export const approveHospital = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await SaasService.approveHospital(id, req.user);
    return sendSuccess(res, 200, 'Hospital tenant approved & Hospital Admin account provisioned!', result);
  } catch (error) {
    next(error);
  }
};

export const prepareDedicatedDatabase = async (req, res, next) => {
  try {
    const result = await TenantMigrationService.prepareDedicatedDatabase(req.params.id, req.user);
    return sendSuccess(res, 200, 'Dedicated tenant database copy prepared and verified. Runtime activation remains disabled.', result);
  } catch (error) {
    next(error);
  }
};

export const activateDedicatedDatabase = async (req, res, next) => {
  try {
    const result = await TenantMigrationService.activateDedicatedDatabase(req.params.id, req.user);
    return sendSuccess(res, 200, 'Dedicated tenant database activated after final verified cutover.', result);
  } catch (error) {
    next(error);
  }
};

export const exportHospitalData = async (req, res, next) => {
  try {
    const exportJob = await TenantExportService.open(req.params.id, req.user);
    const filename = `${exportJob.hospital.domain || exportJob.hospital.code || 'hospital'}-export-${new Date().toISOString().slice(0, 10)}.ndjson`;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');

    if (!res.write(`${safeExportJson({ type: 'manifest', data: exportJob.metadata })}\n`)) {
      await once(res, 'drain');
    }
    for await (const record of exportJob.records()) {
      if (!res.write(`${safeExportJson({ type: 'record', ...record })}\n`)) {
        await once(res, 'drain');
      }
    }
    res.end();
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    next(error);
  }
};

export const exportHospitalPatientsCsv = async (req, res, next) => {
  try {
    const { hospital, patients } = await TenantExportService.exportPatientsCsv(req.params.id, req.user);
    const filename = `${hospital.domain || hospital.code || 'hospital'}-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');

    const safeDecrypt = (val) => {
      if (!val) return '';
      try {
        const decrypted = decryptField(val);
        return decrypted === 'N/A' || decrypted === 'General Registration' || decrypted === 'Self / N/A' || decrypted === '+1 (555) 000-0000'
          ? ''
          : String(decrypted || '');
      } catch {
        return '';
      }
    };

    const headers = [
      'UHID',
      'First Name',
      'Last Name',
      'Phone Number',
      'Gender',
      'Age',
      'Date of Birth',
      'Blood Group',
      'Category',
      'Address',
      'City',
      'Emergency Contact Name',
      'Emergency Contact Phone',
      'Registration Date',
    ];

    res.write('\uFEFF'); // UTF-8 BOM for Microsoft Excel
    res.write(headers.join(',') + '\r\n');

    for (const p of patients) {
      const rawAddr = p.address ? safeDecrypt(p.address) : '';
      const emName = p.emergencyContact?.name ? safeDecrypt(p.emergencyContact.name) : '';
      const emPhone = p.emergencyContact?.phone ? safeDecrypt(p.emergencyContact.phone) : '';

      const row = [
        `"${p.uhid || ''}"`,
        `"${String(p.firstName || '').replace(/"/g, '""')}"`,
        `"${String(p.lastName || '').replace(/"/g, '""')}"`,
        `"${String(p.phone || '')}"`,
        p.gender || '',
        p.age || '',
        p.dob ? new Date(p.dob).toISOString().slice(0, 10) : '',
        p.bloodGroup || '',
        p.category || 'GENERAL',
        `"${rawAddr.replace(/"/g, '""')}"`,
        `"${String(p.city || '').replace(/"/g, '""')}"`,
        `"${emName.replace(/"/g, '""')}"`,
        `"${emPhone.replace(/"/g, '""')}"`,
        p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '',
      ];
      res.write(row.join(',') + '\r\n');
    }
    res.end();
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    next(error);
  }
};

export const updateHospitalStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await SaasService.updateHospitalStatus(id, status, req.user);
    return sendSuccess(res, 200, `Hospital tenant status updated to ${status}`, updated);
  } catch (error) {
    next(error);
  }
};

export const updateHospitalConfiguration = async (req, res, next) => {
  try {
    const updated = await SaasService.updateHospitalConfiguration(
      req.params.id,
      req.body,
      req.user,
      req,
    );
    return sendSuccess(res, 200, 'Hospital configuration updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

export const getPlatformMetrics = async (req, res, next) => {
  try {
    const metrics = await SaasService.getPlatformMetrics();
    return sendSuccess(res, 200, 'Platform metrics retrieved', metrics);
  } catch (error) {
    next(error);
  }
};

export const getHospitalDetail = async (req, res, next) => {
  try {
    const result = await SaasService.getHospitalDetail(req.params.id, req.user);
    return sendSuccess(res, 200, 'Hospital detail retrieved', result);
  } catch (error) {
    next(error);
  }
};

export const getHospitalAdminOverview = async (req, res, next) => {
  try {
    const overview = await SaasService.getAllHospitalAdminOverview();
    return sendSuccess(res, 200, 'Hospital administrator overview retrieved', overview);
  } catch (error) {
    next(error);
  }
};

export const globalSearch = async (req, res, next) => {
  try {
    const { q, hospitalId, role, status } = req.query;
    const results = await SaasService.globalSearch(q, { hospitalId, role, status });
    return sendSuccess(res, 200, 'Search results retrieved', results);
  } catch (error) {
    next(error);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const { hospitalId, module, limit } = req.query;
    const logs = await SaasService.getAuditLogs({ hospitalId, module, limit: limit ? Number(limit) : 50 });
    return sendSuccess(res, 200, 'Audit logs retrieved', logs);
  } catch (error) {
    next(error);
  }
};

export const getHospitalsWithStats = async (req, res, next) => {
  try {
    const hospitals = await SaasService.getAllHospitalsWithStats();
    return sendSuccess(res, 200, 'Hospitals with stats retrieved', hospitals);
  } catch (error) {
    next(error);
  }
};

export const deleteHospital = async (req, res, next) => {
  try {
    const deleted = await SaasService.deleteHospital(req.params.id);
    return sendSuccess(res, 200, 'Hospital tenant soft-deleted successfully', deleted);
  } catch (error) {
    next(error);
  }
};

export const permanentlyDeleteHospital = async (req, res, next) => {
  try {
    const deleted = await SaasService.permanentlyDeleteHospital(req.params.id);
    return sendSuccess(res, 200, 'Hospital tenant permanently deleted successfully', deleted);
  } catch (error) {
    next(error);
  }
};

export const restoreHospital = async (req, res, next) => {
  try {
    const restored = await SaasService.restoreHospital(req.params.id);
    return sendSuccess(res, 200, 'Hospital tenant restored successfully', restored);
  } catch (error) {
    next(error);
  }
};

export const getAllSubscriptionPlans = async (req, res, next) => {
  try {
    const plans = await SaasService.getAllSubscriptionPlans();
    return sendSuccess(res, 200, 'Subscription plans retrieved', plans);
  } catch (error) { next(error); }
};

export const createSubscriptionPlan = async (req, res, next) => {
  try {
    const plan = await SaasService.createSubscriptionPlan(req.body, req.user);
    return sendSuccess(res, 201, 'Subscription plan created successfully', plan);
  } catch (error) { next(error); }
};

export const updateSubscriptionPlan = async (req, res, next) => {
  try {
    const plan = await SaasService.updateSubscriptionPlan(req.params.id, req.body, req.user);
    return sendSuccess(res, 200, 'Subscription plan updated successfully', plan);
  } catch (error) { next(error); }
};

export const extendHospitalTrial = async (req, res, next) => {
  try {
    const { extraDays } = req.body;
    const hospital = await SaasService.extendHospitalTrial(req.params.id, extraDays || 7, req.user);
    return sendSuccess(res, 200, `Hospital free trial extended by ${extraDays || 7} days.`, hospital);
  } catch (error) { next(error); }
};

export const assignPlanToHospital = async (req, res, next) => {
  try {
    const hospital = await SaasService.assignPlanToHospital(req.params.id, req.body, req.user);
    return sendSuccess(res, 200, 'Subscription plan assigned to hospital successfully', hospital);
  } catch (error) { next(error); }
};

export const getPendingApprovals = async (req, res, next) => {
  try {
    const hospitals = await SaasService.getPendingApprovals();
    return sendSuccess(res, 200, 'Pending approval queue retrieved', hospitals);
  } catch (error) { next(error); }
};

export const getSubscriptionAlerts = async (req, res, next) => {
  try {
    const alerts = await SaasService.getSubscriptionAlerts();
    return sendSuccess(res, 200, 'Subscription alerts retrieved', alerts);
  } catch (error) { next(error); }
};

export const updateHospitalAdminCredentials = async (req, res, next) => {
  try {
    const result = await SaasService.updateHospitalAdminCredentials(req.params.id, req.body);
    return sendSuccess(res, 200, 'Hospital admin credentials updated successfully', result);
  } catch (error) { next(error); }
};

export const getHospitalByDomain = async (req, res, next) => {
  try {
    const { domain } = req.params;
    const hospital = await SaasService.getHospitalByDomain(domain);
    return sendSuccess(res, 200, 'Hospital domain details retrieved', hospital);
  } catch (error) { next(error); }
};

export const updateHospitalDomain = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { domain } = req.body;
    const updated = await SaasService.updateHospitalDomain(id, domain, req.user);
    return sendSuccess(res, 200, 'Hospital domain updated successfully', updated);
  } catch (error) { next(error); }
};

export const createBranchRequest = async (req, res, next) => {
  try {
    const result = await SaasService.createBranchRequest(req.body, req.user);
    return sendSuccess(res, 201, 'Branch request submitted successfully. Pending Super Admin approval.', result);
  } catch (error) { next(error); }
};

export const getBranchRequests = async (req, res, next) => {
  try {
    const results = await SaasService.getBranchRequests(req.query, req.user);
    return sendSuccess(res, 200, 'Branch requests retrieved successfully', results);
  } catch (error) { next(error); }
};

export const approveBranchRequest = async (req, res, next) => {
  try {
    const result = await SaasService.approveBranchRequest(req.params.id, req.user);
    return sendSuccess(res, 200, 'Branch approved and activated successfully', result);
  } catch (error) { next(error); }
};

export const rejectBranchRequest = async (req, res, next) => {
  try {
    const result = await SaasService.rejectBranchRequest(req.params.id, req.body, req.user);
    return sendSuccess(res, 200, 'Branch request rejected', result);
  } catch (error) { next(error); }
};

export const getHospitalBranches = async (req, res, next) => {
  try {
    const hospitalId = req.query.hospitalId || req.params.hospitalId;
    const branches = await SaasService.getHospitalBranches(hospitalId, req.user);
    return sendSuccess(res, 200, 'Hospital branches retrieved successfully', branches);
  } catch (error) { next(error); }
};

export const updateBranchStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const result = await SaasService.updateBranchStatus(id, status, req.user);
    return sendSuccess(res, 200, `Branch status updated to ${result.status}`, result);
  } catch (error) { next(error); }
};

export const deleteBranch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await SaasService.deleteBranch(id, req.user);
    return sendSuccess(res, 200, result.message, result);
  } catch (error) { next(error); }
};

export const assignBranchPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await SaasService.assignBranchPlan(id, req.body, req.user);
    return sendSuccess(res, 200, `Plan assigned to branch successfully`, result);
  } catch (error) { next(error); }
};

export const getBranchDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await SaasService.getBranchDetail(id);
    return sendSuccess(res, 200, 'Branch detail retrieved successfully', result);
  } catch (error) { next(error); }
};

export const getAllBranches = async (req, res, next) => {
  try {
    const result = await SaasService.getAllBranches();
    return sendSuccess(res, 200, 'All branches retrieved successfully', result);
  } catch (error) { next(error); }
};

