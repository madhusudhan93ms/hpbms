import { Router } from 'express';
import {
  login,
  patientLogin,
  guardianLogin,
  getMe,
  enableClinicOwnerWorkMode,
  logout,
  createStaffUser,
  updateStaffUser,
  getHospitalStaff,
  updateStaffPassword,
  updateDoctorAvailability,
  updateStaffPermissions,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} from './auth.controller.js';
import { verifyJwt } from '../../middleware/verifyJwt.js';
import { authRateLimiter } from '../../middleware/rateLimiter.js';
import { requireRole } from '../../middleware/permissions.js';
import { ROLES } from '../../config/constants.js';

const router = Router();

// Public Authentication Endpoints
router.post('/login', authRateLimiter, login);
router.post('/patient-login', authRateLimiter, patientLogin);
router.post('/guardian-login', authRateLimiter, guardianLogin);
router.post('/logout', verifyJwt, logout);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', authRateLimiter, resetPassword);

router.get('/me', verifyJwt, getMe);
router.post('/me/enable-clinic-work-mode', verifyJwt, requireRole(ROLES.HOSPITAL_ADMIN), enableClinicOwnerWorkMode);

// Protected Staff Management Endpoints
router.post('/staff', verifyJwt, requireRole(ROLES.HOSPITAL_ADMIN), createStaffUser);
router.get('/staff', verifyJwt, getHospitalStaff);
router.patch('/staff/:id', verifyJwt, requireRole(ROLES.HOSPITAL_ADMIN), updateStaffUser);
router.patch('/staff/:id/password', verifyJwt, requireRole(ROLES.HOSPITAL_ADMIN, ROLES.SUPER_ADMIN), updateStaffPassword);
router.patch('/staff/:id/permissions', verifyJwt, requireRole(ROLES.HOSPITAL_ADMIN), updateStaffPermissions);
router.patch('/staff/:id/availability', verifyJwt, updateDoctorAvailability);

export default router;
