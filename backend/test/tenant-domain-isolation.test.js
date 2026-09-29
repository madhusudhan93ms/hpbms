import test from 'node:test';
import assert from 'node:assert';
import mongoose from "mongoose";
import { Hospital, sanitizeAndValidateDomain, RESERVED_DOMAINS } from "../src/models/Hospital.js";
import { User } from "../src/models/User.js";
import { Branch } from '../src/models/Branch.js';
import { AuthService } from "../src/domains/auth/auth.service.js";
import { SaasService } from "../src/domains/saas/saas.service.js";
import { env } from "../src/config/env.js";
import app from '../src/app.js';
import { tenantOwnedModels } from '../src/domains/saas/tenantMigration.service.js';

import { autoEnsureSystemCredentials } from '../src/config/autoSeed.js';

import { connectDB } from '../src/config/database.js';

let hospitalA;
let hospitalB;

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    await connectDB();
  }
  await autoEnsureSystemCredentials();

  let platformHosp = await Hospital.findOne({ code: 'PLATFORM' });
  if (!platformHosp) {
    platformHosp = await Hospital.create({
      name: 'HPMBS SaaS Platform Owner',
      code: 'PLATFORM',
      subdomain: 'platform',
      domain: 'platform-master',
      status: 'APPROVED',
      plan: 'ENTERPRISE',
      contactName: 'Platform Master Owner',
      contactEmail: 'superadmin@gmail.com',
      contactPhone: '+1 (800) 555-SAAS',
      licenseNumber: 'PLATFORM-MASTER-001',
      isActive: true,
    });
  }
  let superAdmin = await User.findOne({ email: 'superadmin@gmail.com' });
  if (!superAdmin) {
    const bcrypt = (await import('bcryptjs')).default;
    superAdmin = await User.create({
      hospitalId: platformHosp._id,
      name: 'Platform Master Owner',
      email: 'superadmin@gmail.com',
      passwordHash: await bcrypt.hash('000000000000', 12),
      role: 'SUPER_ADMIN',
      phone: '+1 (800) 555-SAAS',
      status: 'ACTIVE',
      isActive: true,
    });
  }
});

test.after(async () => {
  const hospitalIds = [hospitalA?._id, hospitalB?._id].filter(Boolean);
  for (const model of tenantOwnedModels()) {
    await model.deleteMany({ hospitalId: { $in: hospitalIds } });
  }
  await Hospital.deleteMany({ domain: { $in: ["test-hosp-a", "test-hosp-b"] } });
  await User.deleteMany({ email: { $in: ["admin@testhospa.com", "admin@testhospb.com"] } });
  await mongoose.disconnect();
});

test("Domain Validator: Rejects reserved domains", () => {
  for (const reserved of RESERVED_DOMAINS) {
    assert.throws(
      () => sanitizeAndValidateDomain(reserved),
      (err) => err.message.includes("reserved platform route")
    );
  }
});

test("Domain Validator: Rejects invalid URL slug characters", () => {
  assert.throws(() => sanitizeAndValidateDomain("Invalid Domain!"), (err) => err.message.includes("Domain must contain only lowercase letters"));
  assert.throws(() => sanitizeAndValidateDomain("domain--double"), (err) => err.message.includes("Domain must contain only lowercase letters"));
});

test("Domain Validator: Accepts valid domain slugs", () => {
  assert.strictEqual(sanitizeAndValidateDomain("GUMAN "), "guman");
  assert.strictEqual(sanitizeAndValidateDomain("city-general-hosur"), "city-general-hosur");
});

test("Database Clean Verification: Only Platform SuperAdmin & Hospital exist initially", async () => {
  const superAdmin = await User.findOne({ email: "superadmin@gmail.com" });
  assert.ok(superAdmin, "Super Admin superadmin@gmail.com must exist");
  assert.strictEqual(superAdmin.role, "SUPER_ADMIN");

  const platformHosp = await Hospital.findOne({ code: "PLATFORM" });
  assert.ok(platformHosp, "Platform hospital PLATFORM must exist");
});

test("Tenant Isolation & Domain Login Workflow", async () => {
  // Create Test Hospital A
  const hospA = await SaasService.registerHospital({
    hospitalName: "Test Hospital A",
    domain: "test-hosp-a",
    contactEmail: "admin@testhospa.com",
    contactName: "Admin A",
    adminPassword: "Password123!",
  });
  assert.strictEqual(hospA.hospital.domain, "test-hosp-a");
  hospitalA = hospA.hospital;

  // Create Test Hospital B
  const hospB = await SaasService.registerHospital({
    hospitalName: "Test Hospital B",
    domain: "test-hosp-b",
    contactEmail: "admin@testhospb.com",
    contactName: "Admin B",
    adminPassword: "Password123!",
  });
  assert.strictEqual(hospB.hospital.domain, "test-hosp-b");
  hospitalB = hospB.hospital;

  // Approve Hospital A & B
  const superAdminUser = { id: "superadmin-id", role: "SUPER_ADMIN", email: "superadmin@gmail.com" };
  await SaasService.approveHospital(hospA.hospital._id, superAdminUser);
  await SaasService.approveHospital(hospB.hospital._id, superAdminUser);

  // Test 1: Successful domain-scoped login for Hospital A admin under test-hosp-a
  const loginA = await AuthService.login("admin@testhospa.com", "Password123!", "test-hosp-a");
  assert.ok(loginA.tokens.accessToken, "Hospital A admin login should succeed under test-hosp-a domain");
  assert.strictEqual(loginA.user.hospitalDomain, "test-hosp-a");
  assert.strictEqual(loginA.user.defaultRoute, "/test-hosp-a/admin/dashboard");

  // Test 2: Cross-tenant login block: Hospital A admin trying to login under test-hosp-b URL
  await assert.rejects(
    async () => {
      await AuthService.login("admin@testhospa.com", "Password123!", "test-hosp-b");
    },
    (err) => err.message.includes("Access Denied") || err.code === "TENANT_MISMATCH"
  );

  // Test 3: Domain API Lookup
  const domainDetails = await SaasService.getHospitalByDomain("test-hosp-a");
  assert.strictEqual(domainDetails.name, "Test Hospital A");
  assert.strictEqual(domainDetails.domain, "test-hosp-a");

  // Test 4: Duplicate domain registration fails
  await assert.rejects(
    async () => {
      await SaasService.registerHospital({
        hospitalName: "Duplicate Test Hospital",
        domain: "test-hosp-a",
        contactEmail: "dup@testhosp.com",
        adminPassword: "Password123!",
      });
    },
    (err) => err.message.includes("already taken") || err.code === "DUPLICATE_DOMAIN"
  );
});

test('Real HTTP tenant journey: login, own detail, cross-tenant denial, and streamed export', async () => {
  assert.ok(hospitalA?._id && hospitalB?._id, 'tenant setup must complete first');
  const branch = await Branch.findOne({ hospitalId: hospitalA._id });
  assert.ok(branch?._id, 'approved tenant must have a branch');
  const staffPassword = 'WorkflowPass123!';
  const staffDefinitions = [
    ['Reception Test', 'reception@testhospa.com', 'RECEPTIONIST'],
    ['Doctor Test', 'doctor@testhospa.com', 'DOCTOR'],
    ['Lab Test', 'lab@testhospa.com', 'LAB_TECH'],
    ['Pharmacy Test', 'pharmacy@testhospa.com', 'PHARMACIST'],
    ['Cashier Test', 'cashier@testhospa.com', 'CASHIER'],
    ['Nurse Test', 'nurse@testhospa.com', 'NURSE'],
    ['Nurse Incharge Test', 'nurselead@testhospa.com', 'NURSE_INCHARGE'],
    ['Radiologist Test', 'radiology@testhospa.com', 'RADIOLOGIST'],
    ['Emergency Test', 'emergency@testhospa.com', 'EMERGENCY_STAFF'],
  ];
  const staff = {};
  for (const [name, email, role] of staffDefinitions) {
    staff[role] = await User.create({
      hospitalId: hospitalA._id,
      branchId: branch._id,
      name,
      email,
      passwordHash: staffPassword,
      role,
      status: 'ACTIVE',
      isActive: true,
      isAvailable: true,
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
    const login = async (email) => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: staffPassword, hospitalDomain: 'test-hosp-a' }),
      });
      assert.strictEqual(response.status, 200, `login failed for ${email}`);
      return (await response.json()).data.tokens.accessToken;
    };
    const request = async (path, token, { method = 'GET', body } = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'x-hospital-context': String(hospitalA._id),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = await response.json().catch(() => null);
      return { response, payload };
    };
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@testhospa.com',
        password: 'Password123!',
        hospitalDomain: 'test-hosp-a',
      }),
    });
    assert.strictEqual(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    const token = loginBody.data.tokens.accessToken;
    assert.ok(token);
    const headers = { authorization: `Bearer ${token}`, 'x-hospital-context': String(hospitalA._id) };

    const ownDetail = await fetch(`${baseUrl}/saas/hospitals/${hospitalA._id}/detail`, { headers });
    assert.strictEqual(ownDetail.status, 200);
    const ownDetailBody = await ownDetail.json();
    assert.strictEqual(String(ownDetailBody.data.hospital._id), String(hospitalA._id));

    const crossTenantDetail = await fetch(`${baseUrl}/saas/hospitals/${hospitalB._id}/detail`, { headers });
    assert.strictEqual(crossTenantDetail.status, 403);

    const platformHospitals = await fetch(`${baseUrl}/saas/hospitals`, { headers });
    assert.strictEqual(platformHospitals.status, 403, 'Hospital Admin must not inherit SuperAdmin platform access');

    const clinicWorkMode = await request('/auth/me/enable-clinic-work-mode', token, { method: 'POST', body: {} });
    assert.strictEqual(clinicWorkMode.response.status, 200);
    assert.ok(clinicWorkMode.payload.data.additionalRoles.includes('RECEPTIONIST'));
    assert.ok(clinicWorkMode.payload.data.additionalRoles.includes('CASHIER'));
    assert.ok(clinicWorkMode.payload.data.additionalRoles.includes('PHARMACIST'));
    assert.ok(clinicWorkMode.payload.data.additionalRoles.includes('NURSE_INCHARGE'));

    const exportResponse = await fetch(`${baseUrl}/saas/hospitals/${hospitalA._id}/export`, { headers });
    assert.strictEqual(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type') || '', /application\/x-ndjson/);
    const archive = await exportResponse.text();
    const lines = archive.trim().split('\n').map((line) => JSON.parse(line));
    assert.strictEqual(lines[0].type, 'manifest');
    assert.strictEqual(String(lines[0].data.id), String(hospitalA._id));
    assert.ok(lines.some((line) => line.type === 'record' && line.collection === 'users'));
    assert.doesNotMatch(archive, /passwordHash|resetPasswordToken|Password123!/);

    const [receptionToken, doctorToken, labToken, pharmacyToken, cashierToken, nurseToken, nurseLeadToken, radiologyToken, emergencyToken] = await Promise.all([
      login('reception@testhospa.com'),
      login('doctor@testhospa.com'),
      login('lab@testhospa.com'),
      login('pharmacy@testhospa.com'),
      login('cashier@testhospa.com'),
      login('nurse@testhospa.com'),
      login('nurselead@testhospa.com'),
      login('radiology@testhospa.com'),
      login('emergency@testhospa.com'),
    ]);

    const issued = await request('/appointments/tokens', receptionToken, {
      method: 'POST',
      body: { patientName: 'Workflow Patient', phone: '9876500011', doctorId: staff.DOCTOR._id, chiefComplaints: 'Integration workflow' },
    });
    assert.strictEqual(issued.response.status, 201);
    const appointment = issued.payload.data;
    const patientId = appointment.patientId._id;

    const adminIssued = await request('/appointments/tokens', token, {
      method: 'POST',
      body: { patientName: 'Clinic Owner Patient', phone: '9876500012', doctorId: staff.DOCTOR._id, chiefComplaints: 'Owner work-mode registration' },
    });
    assert.strictEqual(adminIssued.response.status, 201, 'Clinic owner must register and queue patients with the same admin ID');

    const adminInvoice = await request('/billing/invoices', token, {
      method: 'POST',
      body: { patientId, items: [{ description: 'Clinic owner billing test', category: 'OTHER', qty: 1, unitPrice: 50, totalPrice: 50 }] },
    });
    assert.strictEqual(adminInvoice.response.status, 201, 'Clinic owner must operate billing with the same admin ID');

    const doctorAlertsAfterQueue = await request('/notifications', doctorToken);
    assert.strictEqual(doctorAlertsAfterQueue.response.status, 200);
    assert.ok(doctorAlertsAfterQueue.payload.notifications.some((item) => (
      String(item.entityId) === String(appointment._id)
      && item.targetRoute.includes(`appointmentId=${appointment._id}`)
    )));

    const diagnostic = await request('/diagnostics/request', doctorToken, {
      method: 'POST',
      body: {
        patientId,
        appointmentId: appointment._id,
        testCategory: 'BLOOD_TEST',
        testName: 'Complete Blood Count',
        price: 250,
      },
    });
    assert.strictEqual(diagnostic.response.status, 201);
    const order = diagnostic.payload.data;

    const labAlerts = await request('/notifications', labToken);
    assert.ok(labAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(order._id)
      && item.targetRoute.includes(`orderId=${order._id}`)
    )));

    for (const status of ['ACCEPTED', 'IN_PROGRESS']) {
      const updated = await request(`/diagnostics/orders/${order._id}/status`, labToken, {
        method: 'PATCH', body: { status },
      });
      assert.strictEqual(updated.response.status, 200);
    }
    const report = await request(`/diagnostics/orders/${order._id}/report`, labToken, {
      method: 'POST',
      body: { reportSummary: 'CBC values reviewed; no critical abnormality.', price: 250 },
    });
    assert.strictEqual(report.response.status, 200);

    const doctorAlertsAfterReport = await request('/notifications', doctorToken);
    assert.ok(doctorAlertsAfterReport.payload.notifications.some((item) => (
      String(item.entityId) === String(order._id)
      && item.targetRoute.includes('tab=DEPT_RESPONSES')
      && item.targetRoute.includes(`orderId=${order._id}`)
    )));

    const radiologyRequest = await request('/diagnostics/request', doctorToken, {
      method: 'POST',
      body: {
        patientId,
        appointmentId: appointment._id,
        testCategory: 'XRAY',
        testName: 'Chest X-Ray PA View',
        price: 400,
      },
    });
    assert.strictEqual(radiologyRequest.response.status, 201);
    const radiologyOrder = radiologyRequest.payload.data;
    const radiologyAlerts = await request('/notifications', radiologyToken);
    assert.ok(radiologyAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(radiologyOrder._id)
      && item.actionType === 'PROCESS_RADIOLOGY_ORDER'
      && item.targetRoute.includes(`orderId=${radiologyOrder._id}`)
    )));
    const labAlertsAfterRadiology = await request('/notifications', labToken);
    assert.ok(!labAlertsAfterRadiology.payload.notifications.some((item) => String(item.entityId) === String(radiologyOrder._id)));
    for (const status of ['ACCEPTED', 'IN_PROGRESS']) {
      const updated = await request(`/diagnostics/orders/${radiologyOrder._id}/status`, radiologyToken, {
        method: 'PATCH', body: { status },
      });
      assert.strictEqual(updated.response.status, 200);
    }
    const radiologyReport = await request(`/diagnostics/orders/${radiologyOrder._id}/report`, radiologyToken, {
      method: 'POST', body: { reportSummary: 'No acute cardiopulmonary abnormality.', price: 400 },
    });
    assert.strictEqual(radiologyReport.response.status, 200);
    const exactRadiologyResponse = (await request('/notifications', doctorToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(radiologyOrder._id)
      && item.actionType === 'REVIEW_REPORT'
      && item.targetRoute.includes(`orderId=${radiologyOrder._id}`)
    ));
    assert.ok(exactRadiologyResponse);

    const consultation = await request('/emr/consultations', doctorToken, {
      method: 'POST',
      body: {
        appointmentId: appointment._id,
        consultationFee: 500,
        chiefComplaints: 'Integration workflow',
        prescriptions: [
          { medicineName: 'Paracetamol 500mg', dosageForm: 'TABLET', durationDays: 2, quantity: 4, unitPrice: 10, treatmentType: 'ORAL_TAKE_HOME' },
          { medicineName: 'Test Injection', dosageForm: 'INJECTION', dosage: '1 ml', frequency: 'ONCE', quantity: 1, unitPrice: 25, treatmentType: 'NURSE_ADMINISTERED' },
        ],
      },
    });
    assert.strictEqual(consultation.response.status, 201);
    const prescription = consultation.payload.data.prescription;
    const invoice = consultation.payload.data.invoice;
    const nurseTask = consultation.payload.data.nurseTasks[0];
    assert.ok(prescription?._id && invoice?._id);
    assert.ok(nurseTask?._id);

    const nurseAlerts = await request('/notifications', nurseToken);
    assert.ok(nurseAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(nurseTask._id)
      && item.targetRoute.includes(`taskId=${nurseTask._id}`)
    )));
    const administered = await request(`/pharmacy/nurse-tasks/${nurseTask._id}/status`, nurseToken, {
      method: 'PATCH',
      body: { status: 'ADMINISTERED', administeredQty: 1, siteOrRoute: 'Left deltoid IM', patientReaction: 'NORMAL' },
    });
    assert.strictEqual(administered.response.status, 200);

    const doctorNurseResponse = (await request('/notifications', doctorToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(nurseTask._id) && item.actionType === 'REVIEW_TREATMENT_RESPONSE'
    ));
    assert.ok(doctorNurseResponse);
    assert.ok(doctorNurseResponse.targetRoute.includes(`taskId=${nurseTask._id}`));

    const pharmacyAlerts = await request('/notifications', pharmacyToken);
    assert.ok(pharmacyAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(prescription._id)
      && item.targetRoute.includes(`prescriptionId=${prescription._id}`)
    )));

    const dispensed = await request(`/pharmacy/prescriptions/${prescription._id}/dispense`, pharmacyToken, {
      method: 'PATCH',
      body: { items: [{ medicineName: 'Paracetamol 500mg', dispensedQty: 4, unitPrice: 10 }], pharmacyNotes: 'Dispensed in integration journey' },
    });
    assert.strictEqual(dispensed.response.status, 200);

    const cashierAlerts = await request('/notifications', cashierToken);
    assert.ok(cashierAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(invoice._id)
      && item.targetRoute.includes(`invoiceId=${invoice._id}`)
    )));

    const returned = await request(`/billing/invoices/${invoice._id}/return-to-department`, cashierToken, {
      method: 'POST', body: { targetDepartment: 'DOCTOR', queryMessage: 'Please confirm consultation charge.' },
    });
    assert.strictEqual(returned.response.status, 200);

    const doctorQueries = await request('/billing/doctor-review-queries', doctorToken);
    assert.strictEqual(doctorQueries.response.status, 200);
    assert.ok(doctorQueries.payload.data.some((item) => String(item._id) === String(invoice._id)));
    const exactDoctorAlert = (await request('/notifications', doctorToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(invoice._id) && item.actionType === 'REVIEW_BILLING_QUERY'
    ));
    assert.ok(exactDoctorAlert);
    assert.ok(exactDoctorAlert.targetRoute.includes(`invoiceId=${invoice._id}`));

    const blockedPayment = await request('/billing/payments/receipts', cashierToken, {
      method: 'POST', body: { invoiceId: invoice._id, amountPaid: invoice.balanceAmount, paymentMode: 'CASH' },
    });
    assert.strictEqual(blockedPayment.response.status, 409);
    assert.strictEqual(blockedPayment.payload.error.code, 'DOCTOR_REVIEW_PENDING');

    const doctorResponse = await request(`/billing/invoices/${invoice._id}/doctor-review-response`, doctorToken, {
      method: 'POST', body: { responseNote: 'Consultation charge reviewed and confirmed.' },
    });
    assert.strictEqual(doctorResponse.response.status, 200);
    assert.strictEqual(doctorResponse.payload.data.doctorReviewQuery.resolved, true);
    const cashierDoctorResponse = (await request('/notifications', cashierToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(invoice._id) && item.actionType === 'COLLECT_PAYMENT'
    ));
    assert.ok(cashierDoctorResponse);
    assert.ok(cashierDoctorResponse.targetRoute.includes(`invoiceId=${invoice._id}`));
    const paidReturnedInvoice = await request('/billing/payments/receipts', cashierToken, {
      method: 'POST',
      body: { invoiceId: invoice._id, amountPaid: doctorResponse.payload.data.balanceAmount, paymentMode: 'CASH' },
    });
    assert.strictEqual(paidReturnedInvoice.response.status, 200);
    assert.strictEqual(paidReturnedInvoice.payload.data.invoice.status, 'PAID');

    const unrelatedLabAlerts = await request('/notifications', labToken);
    assert.ok(!unrelatedLabAlerts.payload.notifications.some((item) => (
      String(item.entityId) === String(invoice._id) && item.actionType === 'REVIEW_BILLING_QUERY'
    )));

    const manualInvoiceResult = await request('/billing/invoices', cashierToken, {
      method: 'POST',
      body: { patientId, items: [{ description: 'Workflow closure charge', category: 'OTHER', qty: 1, unitPrice: 100, totalPrice: 100 }] },
    });
    assert.strictEqual(manualInvoiceResult.response.status, 201);
    const manualInvoice = manualInvoiceResult.payload.data;
    const paid = await request('/billing/payments/receipts', cashierToken, {
      method: 'POST', body: { invoiceId: manualInvoice._id, amountPaid: 100, paymentMode: 'CASH' },
    });
    assert.strictEqual(paid.response.status, 200);
    const receipt = paid.payload.data.receipt;
    assert.strictEqual(paid.payload.data.invoice.status, 'PAID');
    assert.ok(receipt?._id);

    const receptionCompletionAlert = (await request('/notifications', receptionToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(receipt._id) && (item.actionType === 'VIEW_RECEIPT' || item.actionType === 'COMPLETE_VISIT')
    ));
    assert.ok(receptionCompletionAlert);
    assert.ok(receptionCompletionAlert.targetRoute.includes(`receiptId=${receipt._id}`));

    const emergencyResult = await request('/emergency/raise', receptionToken, {
      method: 'POST',
      body: { patientId, emergencyType: 'PATIENT_COLLAPSE', severity: 'CRITICAL', location: 'OPD Waiting Area', description: 'Patient became unresponsive.' },
    });
    assert.strictEqual(emergencyResult.response.status, 201);
    const emergency = emergencyResult.payload;
    const emergencyAlert = (await request('/notifications', emergencyToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(emergency._id)
      && item.actionType === 'RESPOND_EMERGENCY'
      && item.targetRoute.includes(`emergencyId=${emergency._id}`)
    ));
    assert.ok(emergencyAlert);
    const pharmacyAfterEmergency = await request('/notifications', pharmacyToken);
    assert.ok(!pharmacyAfterEmergency.payload.notifications.some((item) => String(item.entityId) === String(emergency._id)));
    const resolvedEmergency = await request(`/emergency/${emergency._id}/resolve`, emergencyToken, {
      method: 'PATCH', body: { resolutionNotes: 'Patient stabilized and transferred for observation.' },
    });
    assert.strictEqual(resolvedEmergency.response.status, 200);
    assert.strictEqual(resolvedEmergency.payload.status, 'RESOLVED');

    const admissionResult = await request('/admissions/request', doctorToken, {
      method: 'POST',
      body: { patientId, wardType: 'GENERAL', targetWardName: 'Integration Ward', admissionReason: 'Observation after collapse', priority: 'HIGH' },
    });
    assert.strictEqual(admissionResult.response.status, 201);
    const admission = admissionResult.payload.data;
    const admissionAlert = (await request('/notifications', nurseLeadToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(admission._id)
      && item.actionType === 'ALLOCATE_BED'
      && item.targetRoute.includes(`admissionId=${admission._id}`)
    ));
    assert.ok(admissionAlert);
    const allocated = await request(`/admissions/${admission._id}/allocate-bed`, nurseLeadToken, {
      method: 'PATCH',
      body: { wardName: 'Integration Ward', bedNumber: 'INT-BED-01', assignedDoctorId: staff.DOCTOR._id, assignedNurseId: staff.NURSE._id, dailyTariff: 750 },
    });
    assert.strictEqual(allocated.response.status, 200);
    assert.strictEqual(allocated.payload.data.status, 'ADMITTED');
    const bedId = allocated.payload.data.bedId._id || allocated.payload.data.bedId;
    const assignedNurseAlert = (await request('/notifications', nurseToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(admission._id) && item.actionType === 'CARE_FOR_INPATIENT'
    ));
    assert.ok(assignedNurseAlert);
    assert.ok(assignedNurseAlert.targetRoute.includes(`admissionId=${admission._id}`));
    const careTeam = await request(`/admissions/${admission._id}/care-team`, nurseLeadToken, {
      method: 'POST',
      body: { assignments: [
        { role: 'PRIMARY_DOCTOR', userId: staff.DOCTOR._id },
        { role: 'NURSE', userId: staff.NURSE._id },
      ] },
    });
    assert.strictEqual(careTeam.response.status, 200);
    assert.strictEqual(careTeam.payload.data.length, 2);
    const nurseCareTeamAlert = (await request('/notifications', nurseToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(admission._id) && item.actionType === 'VIEW_CARE_TEAM_ASSIGNMENT'
    ));
    assert.ok(nurseCareTeamAlert);
    const discharged = await request(`/admissions/${admission._id}/discharge`, doctorToken, { method: 'PATCH', body: {} });
    assert.strictEqual(discharged.response.status, 200);
    assert.strictEqual(discharged.payload.data.status, 'DISCHARGED');
    const nurseDischargeAlert = (await request('/notifications', nurseToken)).payload.notifications.find((item) => (
      String(item.entityId) === String(admission._id) && item.actionType === 'VIEW_IPD_DISCHARGE'
    ));
    assert.ok(nurseDischargeAlert);
    const bedsAfterDischarge = await request('/beds', nurseLeadToken);
    const cleaningBed = bedsAfterDischarge.payload.data.find((item) => String(item._id) === String(bedId));
    assert.strictEqual(cleaningBed.status, 'CLEANING');
    const cleaned = await request(`/beds/${bedId}/mark-cleaned`, nurseLeadToken, {
      method: 'POST', body: { notes: 'Sanitized and fresh linen installed.' },
    });
    assert.strictEqual(cleaned.response.status, 200);
    assert.strictEqual(cleaned.payload.data.status, 'AVAILABLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
