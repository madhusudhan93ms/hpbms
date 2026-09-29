/**
 * auth-behavior-contract.test.js
 * ---------------------------------------------------------------------------
 * Contract tests for auth runtime behaviors that were untested and caused
 * PRODUCTION BUGS:
 *
 *  Bug 1 - Intermittent 401 after migration   => loginIds self-healing in login()
 *  Bug 2 - Password reset success never shown => ResetPasswordPage reads res.message
 *  Bug 3 - Admin gets logged out changing pw  => 401 guard + 400 error code
 *
 * Run: node --test tests/auth-behavior-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFile(path.resolve(dir, ...parts), 'utf8');

// ---------------------------------------------------------------------------
// BUG 1: Intermittent 401 in Production After Data Migration
// loginIds self-healing must exist in login() and updateStaffPassword()
// ---------------------------------------------------------------------------

test('[Bug1] login() self-heals loginIds on every successful authentication', async () => {
  const src = await read('../../backend/src/domains/auth/auth.service.js');

  assert.match(src, /Self-healing loginIds/, 'Must have loginIds self-healing comment');
  assert.match(src, /const healedIds = new Set\(Array\.isArray\(user\.loginIds\)/, 'Must build healedIds Set');
  assert.match(src, /if \(user\.email\) healedIds\.add\(user\.email\.toLowerCase\(\)\.trim\(\)\)/, 'Must add email to healedIds');
  assert.match(src, /if \(user\.phone\) healedIds\.add\(user\.phone\.trim\(\)\)/, 'Must add phone to healedIds');
  assert.match(src, /if \(user\.employeeId\)/, 'Must add employeeId to healedIds');
  assert.match(src, /user\.loginIds = Array\.from\(healedIds\)/, 'Must assign healed array back to user.loginIds');

  // Must be inside login(), not some other method
  const loginStart = src.indexOf('static async login(');
  const loginEnd = src.indexOf('static async patientLogin(');
  const loginBody = src.slice(loginStart, loginEnd);
  assert.match(loginBody, /user\.loginIds = Array\.from\(healedIds\)/, 'Self-healing must be inside login()');
});

test('[Bug1] updateStaffPassword() also rebuilds loginIds after password change', async () => {
  const src = await read('../../backend/src/domains/auth/auth.service.js');
  const methodStart = src.indexOf('static async updateStaffPassword(');
  const methodEnd = src.indexOf('static async toggleDoctorAvailability(');
  const body = src.slice(methodStart, methodEnd);

  assert.match(body, /Keep loginIds in sync/, 'updateStaffPassword must have loginIds sync comment');
  assert.match(body, /staffDoc\.loginIds = Array\.from\(/, 'updateStaffPassword must rebuild loginIds');
});

// ---------------------------------------------------------------------------
// BUG 2: Password Reset - Success Screen Never Shown
// ResetPasswordPage must read res.message (axiosClient unwraps response.data)
// ---------------------------------------------------------------------------

test('[Bug2] ResetPasswordPage reads res.message not res.data.message', async () => {
  const src = await read('../src/pages/Auth/ResetPasswordPage.jsx');

  assert.match(src, /res\.message\s*\|\|\s*res\.data\?\.message/, 'Must read res.message first');
  // The bad pattern: res.data.message without fallback
  assert.doesNotMatch(src, /setSuccessMessage\(res\.data\.message\)/, 'Must NOT call setSuccessMessage(res.data.message) directly');
});

test('[Bug2] ResetPasswordPage redirects to /login after success', async () => {
  const src = await read('../src/pages/Auth/ResetPasswordPage.jsx');

  assert.match(src, /import.*useNavigate.*from 'react-router-dom'/, 'Must import useNavigate');
  assert.match(src, /const navigate = useNavigate\(\)/, 'Must call useNavigate()');
  assert.match(src, /navigate\(['"]\/login['"]\)/, 'Must navigate to /login after reset');
  assert.match(src, /setTimeout/, 'Must use setTimeout before redirecting');
});

test('[Bug2] ResetPasswordPage error handler reads err.error?.message (axiosClient error shape)', async () => {
  const src = await read('../src/pages/Auth/ResetPasswordPage.jsx');
  assert.match(src, /err\.error\?\.message/, 'Error handler must read err.error?.message');
});

test('[Bug2] axiosClient response interceptor returns response.data not raw response', async () => {
  const src = await read('../src/api/axiosClient.js');
  assert.match(src, /return response\.data/, 'axiosClient must return response.data in success interceptor');
});

// ---------------------------------------------------------------------------
// BUG 3: Hospital Admin Gets Logged Out When Changing Staff Password
// Backend must use 400 not 401; axiosClient must guard the auto-logout
// ---------------------------------------------------------------------------

test('[Bug3] updateStaffPassword uses 400 not 401 for wrong admin password', async () => {
  const src = await read('../../backend/src/domains/auth/auth.service.js');
  const methodStart = src.indexOf('static async updateStaffPassword(');
  const methodEnd = src.indexOf('static async toggleDoctorAvailability(');
  const body = src.slice(methodStart, methodEnd);

  assert.doesNotMatch(body, /new ApiError\(401[^)]*INVALID_ADMIN_PASSWORD/, 'Must NOT throw 401 for INVALID_ADMIN_PASSWORD');
  assert.match(body, /new ApiError\(400[^)]*INVALID_ADMIN_PASSWORD/, 'Must throw 400 for INVALID_ADMIN_PASSWORD');
});

test('[Bug3] axiosClient 401 auto-logout is guarded - does not fire on INVALID_ADMIN_PASSWORD', async () => {
  const src = await read('../src/api/axiosClient.js');

  assert.match(src, /const serverErrorCode = error\.response\?\.data\?\.error\?\.code/, 'Must extract server error code');
  assert.match(src, /const isPasswordVerificationError = serverErrorCode === 'INVALID_ADMIN_PASSWORD'/, 'Must check INVALID_ADMIN_PASSWORD');
  assert.match(src, /if \(!isPasswordVerificationError\)/, 'Must guard logout block');
});

test('[Bug3] localStorage.removeItem is inside the isPasswordVerificationError guard', async () => {
  const src = await read('../src/api/axiosClient.js');
  const block401 = src.slice(src.indexOf('if (status === 401)'), src.indexOf('// Meaningful error message mapping'));

  const removeIdx = block401.indexOf('localStorage.removeItem');
  const guardIdx = block401.indexOf('if (!isPasswordVerificationError)');

  assert.ok(removeIdx > guardIdx, 'localStorage.removeItem must appear AFTER the guard, not before it');
});

test('[Bug3] HospitalAdminDashboard handleChangePasswordSubmit shows error in UI, not redirect', async () => {
  const src = await read('../src/pages/Dashboards/HospitalAdminDashboard.jsx');
  const fnStart = src.indexOf('handleChangePasswordSubmit');
  const fnEnd = src.indexOf('const { doctorsCount', fnStart);
  const body = src.slice(fnStart, fnEnd);

  assert.match(body, /catch\s*\(err\)/, 'Must have catch block');
  assert.match(body, /setErrorMsg/, 'Must call setErrorMsg on error (not redirect)');
  assert.doesNotMatch(body, /window\.location/, 'Must NOT redirect on password error');
});

// ---------------------------------------------------------------------------
// GENERAL CONTRACTS: Prevent regressions
// ---------------------------------------------------------------------------

test('[Contract] PATCH /auth/staff/:id/password requires HOSPITAL_ADMIN or SUPER_ADMIN', async () => {
  const src = await read('../../backend/src/domains/auth/auth.routes.js');
  assert.match(
    src,
    /patch\('\/staff\/:id\/password'.*requireRole\(ROLES\.HOSPITAL_ADMIN.*ROLES\.SUPER_ADMIN/s,
    'Staff password route must require HOSPITAL_ADMIN or SUPER_ADMIN',
  );
});

test('[Contract] SUPER_ADMIN bypasses adminPassword verification in updateStaffPassword', async () => {
  const src = await read('../../backend/src/domains/auth/auth.service.js');
  const methodStart = src.indexOf('static async updateStaffPassword(');
  const methodEnd = src.indexOf('static async toggleDoctorAvailability(');
  const body = src.slice(methodStart, methodEnd);
  assert.match(body, /adminUser\?\.role !== 'SUPER_ADMIN'/, 'SUPER_ADMIN must skip adminPassword verification');
});

test('[Contract] HospitalAdminDashboard sends adminPassword for staff password change', async () => {
  const src = await read('../src/pages/Dashboards/HospitalAdminDashboard.jsx');
  assert.match(src, /adminPassword/, 'HospitalAdminDashboard must include adminPassword in password change request');
});

test('[Contract] password change routes in all admin pages send newPassword field', async () => {
  const [superDashboard, superReports] = await Promise.all([
    read('../src/pages/SuperAdmin/SuperAdminHospitalDashboard.jsx'),
    read('../src/pages/SuperAdmin/SuperAdminReportsPage.jsx'),
  ]);
  assert.match(superDashboard, /newPassword/, 'SuperAdminHospitalDashboard must send newPassword');
  assert.match(superReports, /newPassword/, 'SuperAdminReportsPage must send newPassword');
});

test('[Contract] axiosClient error shape is { error: { code, message } }', async () => {
  const src = await read('../src/api/axiosClient.js');
  assert.match(src, /error: \{/, 'Error response must have error object');
  assert.match(src, /message: errorMessage/, 'Error response must include errorMessage');
});

test('[Contract] User model pre-save hook guards against double-hashing', async () => {
  const src = await read('../../backend/src/models/User.js');
  assert.match(
    src,
    /\$2\[abxy\]\\\$\\d\+\\\$/,
    'pre-save hook must check for existing bcrypt hash to prevent double-hashing',
  );
  assert.match(src, /if \(!this\.isModified\('passwordHash'\)\) return next/, 'Must skip if passwordHash not modified');
});
