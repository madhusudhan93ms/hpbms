import { Router } from 'express';
import {
  registerHospital,
  getAllHospitals,
  approveHospital,
  updateHospitalStatus,
  getPlatformMetrics,
  getHospitalDetail,
  getHospitalAdminOverview,
  globalSearch,
  getAuditLogs,
  getHospitalsWithStats,
  updateHospitalConfiguration,
  deleteHospital,
  permanentlyDeleteHospital,
  restoreHospital,
  getAllSubscriptionPlans,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  extendHospitalTrial,
  assignPlanToHospital,
  getPendingApprovals,
  getSubscriptionAlerts,
  updateHospitalAdminCredentials,
  getHospitalByDomain,
  updateHospitalDomain,
  createBranchRequest,
  getBranchRequests,
  approveBranchRequest,
  rejectBranchRequest,
  getHospitalBranches,
  updateBranchStatus,
  deleteBranch,
  assignBranchPlan,
  getBranchDetail,
  getAllBranches,
  prepareDedicatedDatabase,
  activateDedicatedDatabase,
  exportHospitalData,
  exportHospitalPatientsCsv,
} from './saas.controller.js';
import { verifyJwt } from '../../middleware/verifyJwt.js';
import { requireRole } from '../../middleware/permissions.js';
import { ROLES } from '../../config/constants.js';

const router = Router();
const superAdminOnly = [verifyJwt, requireRole(ROLES.SUPER_ADMIN)];
const adminOrSuper = [verifyJwt, requireRole(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.ADMIN)];

// Public Endpoint for Hospital Registration & Subscription Plans
router.post('/register-hospital', registerHospital);
router.get('/plans', getAllSubscriptionPlans);
router.get('/hospitals/by-domain/:domain', getHospitalByDomain);

// Multi-Branch Expansion Requests & Management
router.post('/branch-requests', ...adminOrSuper, createBranchRequest);
router.get('/branch-requests', ...adminOrSuper, getBranchRequests);
router.patch('/branch-requests/:id/approve', ...superAdminOnly, approveBranchRequest);
router.patch('/branch-requests/:id/reject', ...superAdminOnly, rejectBranchRequest);
router.get('/branches/my-hospital', verifyJwt, getHospitalBranches);
router.get('/branches/all', ...superAdminOnly, getAllBranches);
router.patch('/branches/:id/status', ...superAdminOnly, updateBranchStatus);
router.delete('/branches/:id', ...superAdminOnly, deleteBranch);
router.post('/branches/:id/assign-plan', ...superAdminOnly, assignBranchPlan);
router.get('/branches/:id/detail', ...superAdminOnly, getBranchDetail);

// Protected Platform Super Admin Endpoints
router.get('/platform/metrics', ...superAdminOnly, getPlatformMetrics);
router.get('/hospitals/stats', ...superAdminOnly, getHospitalsWithStats);
router.get('/hospitals/overview', ...superAdminOnly, getHospitalAdminOverview);
router.get('/hospitals/pending', ...superAdminOnly, getPendingApprovals);
router.get('/hospitals/:id/detail', verifyJwt, getHospitalDetail);
router.patch('/hospitals/:id/configuration', ...superAdminOnly, updateHospitalConfiguration);
router.patch('/hospitals/:id/domain', ...superAdminOnly, updateHospitalDomain);
router.post('/hospitals/:id/database/prepare', ...superAdminOnly, prepareDedicatedDatabase);
router.post('/hospitals/:id/database/activate', ...superAdminOnly, activateDedicatedDatabase);
router.get('/hospitals/:id/export', verifyJwt, exportHospitalData);
router.get('/hospitals/:id/export-patients-csv', verifyJwt, exportHospitalPatientsCsv);
router.post('/hospitals/:id/extend-trial', ...superAdminOnly, extendHospitalTrial);
router.post('/hospitals/:id/assign-plan', ...superAdminOnly, assignPlanToHospital);
router.get('/search', ...superAdminOnly, globalSearch);
router.get('/audit-logs', ...superAdminOnly, getAuditLogs);

// Subscription Plan Management
router.get('/subscriptions/alerts', ...superAdminOnly, getSubscriptionAlerts);
router.post('/plans', ...superAdminOnly, createSubscriptionPlan);
router.patch('/plans/:id', ...superAdminOnly, updateSubscriptionPlan);

router.get('/hospitals', ...superAdminOnly, getAllHospitals);
router.patch('/hospitals/:id/approve', ...superAdminOnly, approveHospital);
router.patch('/hospitals/:id/status', ...superAdminOnly, updateHospitalStatus);
router.delete('/hospitals/:id', ...superAdminOnly, deleteHospital);
router.patch('/hospitals/:id/delete', ...superAdminOnly, deleteHospital);
router.patch('/hospitals/:id/restore', ...superAdminOnly, restoreHospital);
router.delete('/hospitals/:id/permanent', ...superAdminOnly, permanentlyDeleteHospital);
router.patch('/hospitals/:id/admin-credentials', ...superAdminOnly, updateHospitalAdminCredentials);

export default router;

