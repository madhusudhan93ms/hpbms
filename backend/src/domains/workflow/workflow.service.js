import mongoose from 'mongoose';
import { Appointment } from '../../models/Appointment.js';
import { DiagnosticOrder } from '../../models/DiagnosticOrder.js';
import { Prescription } from '../../models/Prescription.js';
import { Invoice } from '../../models/Invoice.js';
import { Receipt } from '../../models/Receipt.js';
import { PatientRequest } from '../../models/PatientRequest.js';
import { Admission } from '../../models/Admission.js';
import { Emergency } from '../../models/Emergency.js';
import { GuardianLink } from '../../models/GuardianLink.js';
import { Hospital } from '../../models/Hospital.js';
import { User } from '../../models/User.js';
import { Patient } from '../../models/Patient.js';
import { PharmacySubstitutionRequest } from '../../models/PharmacySubstitutionRequest.js';
import { NurseTask } from '../../models/NurseTask.js';
import { Bed } from '../../models/Bed.js';
import { Consultation } from '../../models/Consultation.js';

export const RADIOLOGY_CATEGORIES = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'];
export const LAB_CATEGORIES = ['LABORATORY', 'BLOOD_TEST', 'URINE_ANALYSIS', 'URINE_TEST', 'CULTURE_TEST', 'BIOPSY', 'PATHOLOGY'];
export const ACTIVE_DIAGNOSTIC_STATUSES = ['REQUESTED', 'DEPARTMENT_RECEIVED', 'ACCEPTED', 'IN_PROGRESS'];
export const ACTIVE_REQUEST_STATUSES = ['SUBMITTED', 'PENDING', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ESCALATED'];

const idOf = (value) => String(value?._id || value || '');
const task = (type, record, path, title, extra = {}) => {
  const resourceId = idOf(record._id);
  const idKeys = {
    DOCTOR_PATIENT: 'appointmentId',
    DEPARTMENT_RESPONSE: 'orderId',
    DOCTOR_REQUEST: 'requestId',
    SUBSTITUTION_REQUEST: 'substitutionId',
    NURSE_RESPONSE: 'taskId',
    BILLING_QUERY: 'invoiceId',
    BILLING_WORK: 'invoiceId',
    LAB_WORK: 'orderId',
    RADIOLOGY_WORK: 'orderId',
    PHARMACY_WORK: 'prescriptionId',
    NURSING_WORK: 'requestId',
    IPD_WORK: 'admissionId',
    EMERGENCY_WORK: 'emergencyId',
    NURSE_TREATMENT: 'taskId',
    RECEPTION_WORK: 'appointmentId',
    ADMIN_APPROVAL: 'linkId',
    SUPER_ADMIN_APPROVAL: 'hospitalId',
  };
  const idKey = idKeys[type] || 'entityId';
  const separator = path.includes('?') ? '&' : '?';
  const exactPath = resourceId ? `${path}${separator}${idKey}=${encodeURIComponent(resourceId)}` : path;
  return {
    id: `${type}:${record._id}`,
    resourceId,
    type,
    notificationType: type,
    title,
    message: extra.message || '',
    patientName: extra.patientName || record.patientName || 'Patient',
    uhid: extra.uhid || record.uhid || 'N/A',
    status: record.status || extra.status || 'PENDING',
    priority: record.priority || extra.priority || 'NORMAL',
    targetModule: extra.targetModule || 'dashboard',
    linkedPath: exactPath,
    targetRoute: exactPath,
    createdAt: record.createdAt,
  };
};

export class WorkflowService {
  static async getPendingWork(user) {
      if (!user) {
        return { total: 0, byPath: {}, tasks: [] };
      }

      const userId = user.id || user._id;
      let currentUser = null;
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        currentUser = await User.findById(userId).select('role additionalRoles hospitalId branchId').lean();
      }

      const identity = currentUser || user;
      const activeRole = user.role || identity.role || 'GUEST';
      const rawHospitalId = identity.hospitalId?._id || identity.hospitalId;
      const rawBranchId = identity.branchId?._id || identity.branchId;

      let hospitalId = rawHospitalId && mongoose.Types.ObjectId.isValid(rawHospitalId) ? rawHospitalId : null;
      let branchId = rawBranchId && mongoose.Types.ObjectId.isValid(rawBranchId) ? rawBranchId : null;

      if (user.role === 'SUPER_ADMIN') {
        if (user._hospitalContextApplied && user.hospitalId) {
          hospitalId = user.hospitalId;
        } else {
          hospitalId = null;
        }
      }

      const scope = { ...(hospitalId ? { hospitalId } : {}) };
      const tasks = [];

      const userRoles = new Set([
        activeRole,
        ...(Array.isArray(user?.additionalRoles) ? user.additionalRoles : []),
        ...(Array.isArray(identity?.additionalRoles) ? identity.additionalRoles : []),
      ].filter(Boolean));

      if (userRoles.has('DOCTOR')) {
        const docId = userId && mongoose.Types.ObjectId.isValid(userId) ? userId : null;
        const docQuery = docId ? { doctorId: docId } : { doctorId: null };
        const [appointments, reports, doctorRequests, subRequests, nurseResponses, billingQueries, returnedRx] = await Promise.all([
          Appointment.find({
            ...scope,
            ...docQuery,
            status: { $in: ['WAITING', 'IN_CONSULTATION'] },
            departmentReturnedAt: null,
          }).populate('patientId', 'firstName lastName uhid').lean(),
          DiagnosticOrder.find({
            ...scope,
            ...docQuery,
            status: { $in: ['REPORT_UPLOADED', 'COMPLETED'] },
            reviewedAt: null,
            chargeStatus: { $nin: ['CANCELLED', 'APPROVED', 'INCLUDED_IN_FINAL_BILL'] },
          }).populate('appointmentId').lean(),
          PatientRequest.find({ ...scope, requestCategory: 'DOCTOR', status: { $in: ACTIVE_REQUEST_STATUSES }, ...(docId ? { $or: [{ assignedDoctorId: docId }, { assignedDoctorId: null }] } : { assignedDoctorId: null }) }).populate('patientId', 'firstName lastName uhid').lean(),
          PharmacySubstitutionRequest.find({ ...scope, ...docQuery, status: 'PENDING' }).populate('patientId', 'firstName lastName uhid').lean(),
          NurseTask.find({
            ...scope,
            ...docQuery,
            status: 'ADMINISTERED',
            doctorReviewedAt: null,
            isResolved: { $ne: true },
          }).populate('patientId', 'firstName lastName uhid').populate('appointmentId').lean(),
          Invoice.find({
            ...scope,
            ...(docId ? { 'doctorReviewQuery.attendingDoctorId': docId } : {}),
            'doctorReviewQuery.resolved': false,
            isDeleted: { $ne: true },
          }).populate('patientId', 'firstName lastName uhid').lean(),
          Prescription.find({
            ...scope,
            ...docQuery,
            dispenseStatus: 'RETURNED_TO_DOCTOR',
            'billingQuery.resolved': false,
          }).populate('patientId', 'firstName lastName uhid').lean(),
        ]);

        appointments.forEach((item) => item && tasks.push(task('DOCTOR_PATIENT', item, '/doctor/dashboard', `Patient waiting: ${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
        reports
          .filter((item) => item && item.appointmentId?.status !== 'COMPLETED' && item.appointmentId?.status !== 'CANCELLED' && !item.reviewedAt && item.chargeStatus !== 'APPROVED')
          .forEach((item) => tasks.push(task('DEPARTMENT_RESPONSE', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=DEPT_TRACKER', `Review report: ${item.testName || 'Report'}`, { targetModule: 'doctor' })));
        doctorRequests.forEach((item) => item && tasks.push(task('DOCTOR_REQUEST', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=QUERIES', `Patient request: ${item.requestType || 'Request'}`, { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
        subRequests.forEach((item) => item && tasks.push(task('SUBSTITUTION_REQUEST', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=QUERIES', `Substitution approval: ${item.originalMedicineName || 'Medicine'}`, { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
        nurseResponses
          .filter((item) => item && item.appointmentId?.status !== 'COMPLETED' && item.appointmentId?.status !== 'CANCELLED' && !item.doctorReviewedAt && item.status !== 'CANCELLED' && !item.isResolved)
          .forEach((item) => tasks.push(task('NURSE_RESPONSE', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=NURSE', `Injection Administered: ${item.medicineName || 'Treatment'}`, { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));

        const seenInvoiceIds = new Set();
        billingQueries.forEach((item) => {
          if (!item) return;
          seenInvoiceIds.add(String(item._id));
          tasks.push(task('BILLING_QUERY', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=QUERIES', `Billing Query: ${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid, message: item.doctorReviewQuery?.query || 'Billing Query' }));
        });
        returnedRx.forEach((item) => {
          if (!item) return;
          const invId = String(item.billingQuery?.invoiceId || '');
          if (invId && seenInvoiceIds.has(invId)) return;
          tasks.push(task('BILLING_QUERY', item, '/doctor/dashboard?tab=DEPT_RESPONSES&subTab=QUERIES', `Prescription Returned: ${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), { targetModule: 'doctor', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid, message: item.billingQuery?.query || 'Returned to Doctor' }));
        });
      }

      if (Array.from(userRoles).some((r) => ['CASHIER', 'BILLING_STAFF', 'ACCOUNTANT'].includes(r))) {
          const pendingPrescriptions = await Prescription.find({
            dispenseStatus: { $in: ['PENDING_DISPENSE', 'PARTIALLY_DISPENSED'] },
          }).select('patientId').lean();
          const pendingPatientIds = new Set(pendingPrescriptions.map(p => String(p.patientId?._id || p.patientId)));

          const records = await Invoice.find({
            ...scope,
            status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
            isDeleted: { $ne: true },
            $or: [
              { doctorReviewQuery: { $exists: false } },
              { 'doctorReviewQuery.resolved': { $ne: false } },
              { 'doctorReviewQuery.query': null },
              { 'doctorReviewQuery.query': { $exists: false } },
            ],
          }).populate('patientId', 'firstName lastName uhid').lean();
          records
            .filter((item) => !pendingPatientIds.has(String(item.patientId?._id || item.patientId)))
            .forEach((item) => item && tasks.push(task('BILLING_WORK', item, '/billing/dashboard', `Collect payment: ${item.invoiceNo || 'Invoice'}`, { targetModule: 'billing', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid, message: `Balance: ${item.balanceAmount || 0}` })));
      }

      if (Array.from(userRoles).some((r) => ['LAB_TECH', 'LABORATORY_STAFF', 'PATHOLOGIST'].includes(r))) {
          const records = await DiagnosticOrder.find({ ...scope, testCategory: { $in: LAB_CATEGORIES }, status: { $in: ACTIVE_DIAGNOSTIC_STATUSES } }).lean();
          records.forEach((item) => item && tasks.push(task('LAB_WORK', item, '/laboratory/dashboard', `Lab pending: ${item.testName || 'Test'}`, { targetModule: 'laboratory' })));
      }

      if (Array.from(userRoles).some((r) => ['RADIOLOGIST', 'RADIOLOGY_STAFF'].includes(r))) {
          const records = await DiagnosticOrder.find({ ...scope, testCategory: { $in: RADIOLOGY_CATEGORIES }, status: { $in: ACTIVE_DIAGNOSTIC_STATUSES } }).lean();
          records.forEach((item) => item && tasks.push(task('RADIOLOGY_WORK', item, '/radiology/dashboard', `Radiology pending: ${item.testName || 'Scan'}`, { targetModule: 'radiology' })));
      }

      if (Array.from(userRoles).some((r) => ['PHARMACIST', 'PHARMACY_STAFF'].includes(r))) {
          const prescriptions = await Prescription.find({ ...scope, dispenseStatus: { $in: ['PENDING_DISPENSE', 'PARTIALLY_DISPENSED'] } }).populate('patientId', 'firstName lastName uhid').lean();
          prescriptions.forEach((item) => item && tasks.push(task('PHARMACY_WORK', item, '/pharmacy/dashboard', `Dispense prescription: ${item.prescriptionNo || 'Rx'}`, { targetModule: 'pharmacy', status: item.dispenseStatus, patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
      }

      if (Array.from(userRoles).some((r) => ['NURSE', 'NURSE_INCHARGE', 'NURSING'].includes(r))) {
          const filter = { ...scope, requestCategory: 'NURSE', status: { $in: ACTIVE_REQUEST_STATUSES } };
          if (!userRoles.has('NURSE_INCHARGE') && userId && mongoose.Types.ObjectId.isValid(userId)) {
            filter.$or = [{ assignedNurseId: userId }, { assignedNurseId: null }];
          }
          const [records, admissions, emergencies, nurseTasks, admittedInpatients, totalBeds] = await Promise.all([
            PatientRequest.find(filter).populate('patientId', 'firstName lastName uhid').lean(),
            Admission.find({ ...scope, status: { $in: ['ADMISSION_REQUESTED', 'REQUISITION_RAISED'] } }).lean(),
            Emergency.find({ ...scope, status: { $in: ['ACTIVE', 'RESPONDED'] } }).lean(),
            NurseTask.find({ ...scope, status: { $in: ['PENDING', 'ACCEPTED', 'SCHEDULED', 'DELAYED'] } }).lean(),
            Admission.find({ ...scope, status: 'ADMITTED' }).lean(),
            Bed.countDocuments({ ...(hospitalId ? { hospitalId } : {}) }),
          ]);
          records.forEach((item) => item && tasks.push(task('NURSING_WORK', item, '/nurse-incharge/dashboard?tab=REQUESTS', `Nursing request: ${item.requestType || 'Request'}`, { targetModule: 'nursing', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
          admissions.forEach((item) => item && tasks.push(task('IPD_WORK', item, '/nurse-incharge/dashboard?tab=REQUISITIONS', `Admission pending: ${item.patientName || 'Admission'}`, { targetModule: 'ipd' })));
          emergencies.forEach((item) => item && tasks.push(task('EMERGENCY_WORK', item, '/emergency', `Emergency: ${item.emergencyType || 'Alert'}`, { targetModule: 'emergency' })));
          nurseTasks.forEach((item) => item && tasks.push(task('NURSE_TREATMENT', item, '/nurse-incharge/dashboard?tab=TASKS', `Treatment: ${item.medicineName || 'Medication'}`, { targetModule: 'nursing' })));
      }

      if (Array.from(userRoles).some((r) => ['RECEPTIONIST', 'OPD_STAFF', 'FRONT_DESK'].includes(r))) {
          const records = await Appointment.find({ ...scope, status: 'BOOKED' }).populate('patientId', 'firstName lastName uhid').lean();
          records.forEach((item) => item && tasks.push(task('RECEPTION_WORK', item, '/reception/registered-patients', `Appointment booked: ${item.patientId?.firstName || ''}`, { targetModule: 'reception', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid })));
      }

      if (userRoles.has('HOSPITAL_ADMIN')) {
          const records = await GuardianLink.find({ ...(hospitalId ? { hospitalId } : {}), accessStatus: 'PENDING' }).populate('patientId', 'firstName lastName uhid').lean();
          records.forEach((item) => item && tasks.push(task('ADMIN_APPROVAL', item, '/hospital-admin/dashboard?tab=notifications', 'Guardian access approval', { targetModule: 'dashboard', patientName: `${item.patientId?.firstName || ''} ${item.patientId?.lastName || ''}`.trim(), uhid: item.patientId?.uhid, status: item.accessStatus })));
      }

      if (userRoles.has('SUPER_ADMIN')) {
          const records = await Hospital.find({ status: 'PENDING_APPROVAL' }).lean();
          records.forEach((item) => item && tasks.push(task('SUPER_ADMIN_APPROVAL', item, '/admin/hospitals', `Hospital approval: ${item.name || 'Hospital'}`, { targetModule: 'saas', patientName: item.name, status: item.status })));
      }

      const validTasks = tasks.filter((t) => t && t.id);
      const uniqueTasks = Array.from(new Map(validTasks.map((item) => [item.id, item])).values())
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      const byPath = uniqueTasks.reduce((counts, item) => ({ ...counts, [item.linkedPath]: (counts[item.linkedPath] || 0) + 1 }), {});
      return { total: uniqueTasks.length, byPath, tasks: uniqueTasks };
  }


  static async getHospitalDataJourney(query = {}, user) {
    try {
      if (!user) return { journeys: [], stats: {} };

      const userId = user.id || user._id;
      let currentUser = null;
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        currentUser = await User.findById(userId).select('hospitalId branchId role').lean().catch(() => null);
      }
      const rawHospId = currentUser?.hospitalId || user.hospitalId;
      const rawBranchId = currentUser?.branchId || user.branchId;

      const hospitalId = rawHospId && mongoose.Types.ObjectId.isValid(rawHospId) ? rawHospId : null;
      const branchId = rawBranchId && mongoose.Types.ObjectId.isValid(rawBranchId) ? rawBranchId : null;

      const scope = {
        ...(hospitalId ? { hospitalId } : {}),
        ...(branchId && user.role !== 'SUPER_ADMIN' ? { branchId } : {}),
      };

      // Search and date filters
      const search = (query.search || '').trim();
      const stageFilter = (query.stage || 'ALL').toUpperCase();

      // Targeted search queries if search query is provided
      let searchedApptIds = [];
      let searchedPatientIds = [];
      let searchedInvoiceIds = [];

      if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const [foundReceipts, foundInvoices, foundPatients, foundAppts] = await Promise.all([
          Receipt.find({ ...scope, isDeleted: { $ne: true }, $or: [{ receiptNo: searchRegex }, { transactionRef: searchRegex }, { remarks: searchRegex }] }).select('_id invoiceId patientId appointmentId').lean().catch(() => []),
          Invoice.find({ ...scope, isDeleted: { $ne: true }, $or: [{ invoiceNo: searchRegex }] }).select('_id patientId appointmentId').lean().catch(() => []),
          Patient.find({ ...scope, $or: [{ uhid: searchRegex }, { firstName: searchRegex }, { lastName: searchRegex }, { phone: searchRegex }] }).select('_id').lean().catch(() => []),
          Appointment.find({ ...scope, $or: [{ appointmentNo: searchRegex }, { tokenNumber: !isNaN(Number(search)) ? Number(search) : -1 }] }).select('_id patientId').lean().catch(() => []),
        ]);

        foundReceipts.forEach((r) => {
          if (r.invoiceId) searchedInvoiceIds.push(r.invoiceId);
          if (r.patientId) searchedPatientIds.push(r.patientId);
          if (r.appointmentId) searchedApptIds.push(r.appointmentId);
        });

        foundInvoices.forEach((inv) => {
          searchedInvoiceIds.push(inv._id);
          if (inv.patientId) searchedPatientIds.push(inv.patientId);
          if (inv.appointmentId) searchedApptIds.push(inv.appointmentId);
        });

        foundPatients.forEach((p) => searchedPatientIds.push(p._id));
        foundAppts.forEach((a) => {
          searchedApptIds.push(a._id);
          if (a.patientId) searchedPatientIds.push(a.patientId);
        });
      }

      // Fetch recent appointments (up to 150) plus any specifically searched
      const apptQuery = { ...scope };
      if (searchedApptIds.length > 0 || searchedPatientIds.length > 0) {
        apptQuery.$or = [
          { _id: { $in: searchedApptIds } },
          { patientId: { $in: searchedPatientIds } },
        ];
      }

      const [appointments, recentInvoices, recentReceipts] = await Promise.all([
        Appointment.find(searchedApptIds.length > 0 || searchedPatientIds.length > 0 ? apptQuery : scope)
          .populate('patientId', 'firstName lastName uhid gender age phone bloodGroup emergencyContact')
          .populate('doctorId', 'name specialization cabinNo departmentId')
          .sort({ createdAt: -1 })
          .limit(150)
          .lean()
          .catch(() => []),
        Invoice.find({
          ...scope,
          isDeleted: { $ne: true },
          ...(searchedInvoiceIds.length > 0 || searchedPatientIds.length > 0 ? { $or: [{ _id: { $in: searchedInvoiceIds } }, { patientId: { $in: searchedPatientIds } }] } : {}),
        })
          .populate('patientId', 'firstName lastName uhid gender age phone')
          .populate('doctorId', 'name specialization cabinNo')
          .sort({ createdAt: -1 })
          .limit(150)
          .lean()
          .catch(() => []),
        Receipt.find({
          ...scope,
          isDeleted: { $ne: true },
          ...(searchedInvoiceIds.length > 0 || searchedPatientIds.length > 0 ? { $or: [{ invoiceId: { $in: searchedInvoiceIds } }, { patientId: { $in: searchedPatientIds } }] } : {}),
        })
          .populate('patientId', 'firstName lastName uhid gender age phone')
          .populate('cashierId', 'name role')
          .sort({ createdAt: -1 })
          .limit(150)
          .lean()
          .catch(() => []),
      ]);

      const apptIds = appointments.map((a) => a._id);
      const allPatientIds = Array.from(
        new Set([
          ...appointments.map((a) => a.patientId?._id || a.patientId),
          ...recentInvoices.map((inv) => inv.patientId?._id || inv.patientId),
          ...recentReceipts.map((rc) => rc.patientId?._id || rc.patientId),
        ].filter(Boolean).map((id) => String(id)))
      );

      const allInvoiceIds = Array.from(
        new Set([
          ...recentInvoices.map((inv) => String(inv._id)),
          ...recentReceipts.map((rc) => rc.invoiceId ? String(rc.invoiceId) : null).filter(Boolean),
        ])
      );

      // Fetch all related clinical, diagnostic, pharmacy, invoice, and receipt records
      const [consultations, nurseTasks, diagnosticOrders, prescriptions, allInvoices, allReceipts] = await Promise.all([
        Consultation.find({ ...scope, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }] }).lean().catch(() => []),
        NurseTask.find({ ...scope, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }] }).populate('assignedNurseId', 'name role').lean().catch(() => []),
        DiagnosticOrder.find({ ...scope, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }] }).lean().catch(() => []),
        Prescription.find({ ...scope, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }] }).populate('doctorId', 'name').lean().catch(() => []),
        Invoice.find({ ...scope, isDeleted: { $ne: true }, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }, { _id: { $in: allInvoiceIds } }] }).populate('doctorId', 'name specialization cabinNo').populate('patientId', 'firstName lastName uhid gender age phone').lean().catch(() => []),
        Receipt.find({ ...scope, isDeleted: { $ne: true }, $or: [{ appointmentId: { $in: apptIds } }, { patientId: { $in: allPatientIds } }, { invoiceId: { $in: allInvoiceIds } }] }).populate('cashierId', 'name role').populate('patientId', 'firstName lastName uhid gender age phone').lean().catch(() => []),
      ]);

      const now = new Date();
      let stats = { total: 0, atNurse: 0, inLab: 0, atPharmacy: 0, atBilling: 0, completed: 0, delayedAlerts: 0 };
      const handledPatientIds = new Set();
      const journeys = [];

      // Helper function to build a single journey object
      const buildJourney = ({ appt, invoice, patient, doctor }) => {
        const pId = patient?._id || patient?.id || appt?.patientId?._id || invoice?.patientId?._id;
        const pName = `${patient?.firstName || ''} ${patient?.lastName || ''}`.trim() || 'Patient';
        const uhid = patient?.uhid || 'UHID-N/A';

        const apptId = appt?._id ? String(appt._id) : null;
        const apptConsultation = consultations.find((c) => (apptId && String(c.appointmentId) === apptId) || (pId && String(c.patientId) === String(pId)));
        const apptNurseTasks = nurseTasks.filter((t) => (apptId && String(t.appointmentId) === apptId) || (pId && String(t.patientId) === String(pId)));
        const apptDiagOrders = diagnosticOrders.filter((d) => (apptId && String(d.appointmentId) === apptId) || (pId && String(d.patientId) === String(pId)));
        const apptPrescriptions = prescriptions.filter((p) => (apptConsultation && String(p.consultationId) === String(apptConsultation._id)) || (pId && String(p.patientId) === String(pId)));

        const apptInvoices = allInvoices.filter((inv) => (apptId && String(inv.appointmentId) === apptId) || (pId && String(inv.patientId?._id || inv.patientId) === String(pId)));
        const invoiceIds = apptInvoices.map((inv) => String(inv._id));
        const apptReceipts = allReceipts.filter((rc) =>
          (apptId && String(rc.appointmentId) === apptId) ||
          (rc.invoiceId && invoiceIds.includes(String(rc.invoiceId))) ||
          (pId && String(rc.patientId?._id || rc.patientId) === String(pId))
        );

        // Compute Financial Summary
        const primaryInvoice = apptInvoices[0] || invoice;
        const totalAmount = apptInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal || inv.totalAmount || 0), 0) || (apptReceipts.reduce((sum, rc) => sum + Number(rc.amountPaid || 0), 0));
        const paidAmount = apptReceipts.reduce((sum, rc) => sum + Number(rc.amountPaid || 0), 0) || apptInvoices.reduce((sum, inv) => sum + Number(inv.paidAmount || 0), 0);
        const balanceAmount = Math.max(0, totalAmount - paidAmount);

        let paymentStatus = 'PENDING_GENERATION';
        if (totalAmount > 0 && paidAmount >= totalAmount) {
          paymentStatus = 'PAID';
        } else if (paidAmount > 0) {
          paymentStatus = 'PARTIALLY_PAID';
        } else if (totalAmount > 0) {
          paymentStatus = 'UNPAID';
        }

        const invoiceNoList = apptInvoices.map((inv) => inv.invoiceNo).filter(Boolean);
        const receiptNoList = apptReceipts.map((rc) => rc.receiptNo).filter(Boolean);
        const primaryInvoiceNo = invoiceNoList[0] || primaryInvoice?.invoiceNo || (totalAmount > 0 ? 'Pending Number' : 'None');
        const primaryReceiptNo = receiptNoList[0] || (paidAmount > 0 ? 'Paid' : 'None');

        // Stage & Handling Staff Determination
        let currentStage = 'WAITING';
        let currentStageLabel = 'Queued at Reception / Waiting for Doctor';
        let handlingStaff = { name: doctor?.name || 'Assigned Consultant', role: 'DOCTOR', department: 'Clinical OPD' };
        let nextDestination = 'Doctor Consultation';
        let isDelayed = false;
        const auditAlerts = [];

        const hasPendingNurse = apptNurseTasks.some((t) => ['PENDING', 'ACCEPTED', 'SCHEDULED'].includes(t.status));
        const hasPendingLab = apptDiagOrders.some((o) => ACTIVE_DIAGNOSTIC_STATUSES.includes(o.status));
        const hasPendingPharmacy = apptPrescriptions.some((p) => p.dispenseStatus === 'PENDING_DISPENSE');
        const hasUnpaidInvoice = balanceAmount > 0 && totalAmount > 0;

        if (paymentStatus === 'PAID' || (apptReceipts.length > 0 && balanceAmount === 0 && !hasPendingNurse && !hasPendingLab && !hasPendingPharmacy)) {
          currentStage = 'COMPLETED_SETTLED';
          currentStageLabel = 'Bill Settled & Patient Discharged';
          const latestRc = apptReceipts[0];
          handlingStaff = {
            name: latestRc?.cashierId?.name || latestRc?.createdByName || primaryInvoice?.createdByName || 'Cashier Desk',
            role: 'CASHIER',
            department: 'Central Billing',
          };
          nextDestination = 'Visit Closed / Patient Discharged';
        } else if (hasPendingNurse || appt?.status === 'WAITING_NURSE') {
          currentStage = 'AT_NURSE';
          currentStageLabel = 'At Nurse Station (Injection / IV Administration)';
          const activeTask = apptNurseTasks.find((t) => ['PENDING', 'ACCEPTED'].includes(t.status));
          handlingStaff = {
            name: activeTask?.assignedNurseName || activeTask?.assignedNurseId?.name || 'Duty Nurse',
            role: 'NURSE',
            department: 'Nursing Station',
          };
          nextDestination = 'Doctor Consultation Sign-Off & Billing';
          if (new Date(activeTask?.createdAt || appt?.updatedAt || now).getTime() < now.getTime() - 15 * 60 * 1000) {
            isDelayed = true;
            auditAlerts.push({ type: 'NURSE_DELAY', message: 'Nursing procedure pending for >15 mins.' });
          }
        } else if (hasPendingLab || appt?.status === 'WAITING_DEPARTMENT') {
          currentStage = 'IN_DIAGNOSTICS';
          currentStageLabel = 'In Pathology / Radiology (Sample / Scan in Progress)';
          const activeDiag = apptDiagOrders.find((o) => ACTIVE_DIAGNOSTIC_STATUSES.includes(o.status));
          handlingStaff = {
            name: activeDiag?.technicianName || 'Diagnostic Technician',
            role: activeDiag?.testCategory === 'RADIOLOGY' ? 'RADIOLOGIST' : 'LAB_TECH',
            department: activeDiag?.testCategory === 'RADIOLOGY' ? 'Radiology & Imaging' : 'Pathology & Lab',
          };
          nextDestination = 'Doctor Report Review';
        } else if (hasPendingPharmacy || appt?.status === 'WAITING_PHARMACY') {
          currentStage = 'AT_PHARMACY';
          currentStageLabel = 'At Pharmacy Desk (Take-Home Medication Packaging)';
          handlingStaff = { name: 'Duty Pharmacist', role: 'PHARMACIST', department: 'Pharmacy' };
          nextDestination = 'Central Billing Desk for Payment';
        } else if (hasUnpaidInvoice) {
          currentStage = 'AT_BILLING';
          currentStageLabel = 'At Central Billing Desk (Awaiting Payment Collection)';
          handlingStaff = { name: 'Cashier Desk', role: 'CASHIER', department: 'Central Billing' };
          nextDestination = 'Final Payment Settlement & Receipt Print';
          if (primaryInvoice?.createdAt && new Date(primaryInvoice.createdAt).getTime() < now.getTime() - 20 * 60 * 1000) {
            isDelayed = true;
            auditAlerts.push({ type: 'UNCOLLECTED_BILL', message: `Unpaid invoice of ₹${balanceAmount} waiting for >20 mins.` });
          }
        } else if (appt?.departmentReturnedAt && appt?.status === 'IN_CONSULTATION') {
          currentStage = 'RETURNED_TO_DOCTOR';
          currentStageLabel = 'Returned from Department (Ready for Doctor Finalization)';
          handlingStaff = { name: doctor?.name || 'Doctor', role: 'DOCTOR', department: `Cabin ${doctor?.cabinNo || '101'}` };
          nextDestination = 'Prescribe Take-Home Medicine / Send to Bill';
        } else if (appt?.status === 'IN_CONSULTATION') {
          currentStage = 'IN_CONSULTATION';
          currentStageLabel = 'In Doctor Cabin (Active Consultation)';
          handlingStaff = { name: doctor?.name || 'Doctor', role: 'DOCTOR', department: `Cabin ${doctor?.cabinNo || '101'}` };
          nextDestination = 'Nurse Station / Diagnostics / Billing';
        } else if (appt?.status === 'CANCELLED') {
          currentStage = 'CANCELLED';
          currentStageLabel = 'Visit Cancelled';
          handlingStaff = { name: 'Reception / Doctor', role: 'STAFF', department: 'OPD' };
          nextDestination = 'None';
        }

        // Build Chronological Journey Steps
        const journeySteps = [
          {
            stepIndex: 1,
            title: 'Registration & Token Issued',
            department: 'Reception / Front Desk',
            staff: 'Reception Desk',
            timestamp: appt?.createdAt || primaryInvoice?.createdAt || now,
            status: 'COMPLETED',
            details: `Token #${appt?.tokenNumber || 'Walk-In'} registered for ${pName} (${uhid}). Consultant: Dr. ${doctor?.name || 'Attending Physician'}.`,
          },
        ];

        if (apptConsultation || appt?.status === 'IN_CONSULTATION' || appt?.status === 'WAITING_NURSE' || appt?.status === 'WAITING_DEPARTMENT' || currentStage === 'COMPLETED_SETTLED') {
          journeySteps.push({
            stepIndex: 2,
            title: 'Doctor Clinical Examination',
            department: 'Clinical EMR',
            staff: `Dr. ${doctor?.name || 'Doctor'}`,
            timestamp: apptConsultation?.createdAt || appt?.updatedAt || primaryInvoice?.createdAt || now,
            status: apptConsultation || currentStage === 'COMPLETED_SETTLED' ? 'COMPLETED' : 'IN_PROGRESS',
            details: apptConsultation
              ? `Diagnosis: ${apptConsultation.chiefComplaints || 'Clinical consultation completed'}. Consultation fee: ₹${apptConsultation.consultationFee || 0}.`
              : `Consultation recorded in Cabin ${doctor?.cabinNo || '101'}.`,
          });
        }

        if (apptNurseTasks.length > 0) {
          apptNurseTasks.forEach((nt, idx) => {
            journeySteps.push({
              stepIndex: 3 + idx,
              title: `Nursing: ${nt.medicineName || 'Treatment'} (${nt.dose || 'Dose'})`,
              department: 'Nursing Station',
              staff: nt.administrationDetails?.nurseName || nt.assignedNurseName || 'Duty Nurse',
              timestamp: nt.administrationDetails?.administeredAt || nt.createdAt,
              status: nt.status === 'ADMINISTERED' ? 'COMPLETED' : 'IN_PROGRESS',
              details: nt.status === 'ADMINISTERED'
                ? `Administered via ${nt.administrationDetails?.siteOrRoute || nt.route || 'IV'} by Nurse ${nt.administrationDetails?.nurseName || 'Staff'}. Notes: "${nt.administrationDetails?.notes || 'Normal'}".`
                : `Pending administration in nurse station. Prescribed by Dr. ${doctor?.name || 'Doctor'}.`,
            });
          });
        }

        if (apptDiagOrders.length > 0) {
          apptDiagOrders.forEach((ord, idx) => {
            journeySteps.push({
              stepIndex: 4 + idx,
              title: `Diagnostics: ${ord.testName}`,
              department: ord.testCategory === 'RADIOLOGY' ? 'Radiology' : 'Pathology Lab',
              staff: ord.technicianName || 'Lab Technician',
              timestamp: ord.reviewedAt || ord.updatedAt || ord.createdAt,
              status: ['COMPLETED', 'REPORT_UPLOADED'].includes(ord.status) ? 'COMPLETED' : 'IN_PROGRESS',
              details: ['COMPLETED', 'REPORT_UPLOADED'].includes(ord.status)
                ? `Report verified: "${ord.reportSummary || 'Normal findings'}". Technician: ${ord.technicianName || 'Diagnostics'}.`
                : `Diagnostic test ordered by Dr. ${doctor?.name || 'Doctor'}. Status: ${ord.status}.`,
            });
          });
        }

        if (apptPrescriptions.length > 0) {
          apptPrescriptions.forEach((rx, idx) => {
            journeySteps.push({
              stepIndex: 5 + idx,
              title: `Pharmacy: Prescription ${rx.prescriptionNo || ''}`,
              department: 'Pharmacy Desk',
              staff: rx.dispensedByName || 'Pharmacist Desk',
              timestamp: rx.dispensedAt || rx.createdAt,
              status: rx.dispenseStatus === 'DISPENSED' ? 'COMPLETED' : 'IN_PROGRESS',
              details: rx.dispenseStatus === 'DISPENSED'
                ? `Dispensed ${rx.medicines?.length || 0} medications. Total charge: ₹${rx.totalMedicineCharge || 0}.`
                : `Prescription received with ${rx.medicines?.length || 0} items. Packaging in progress.`,
            });
          });
        }

        if (apptInvoices.length > 0) {
          apptInvoices.forEach((inv, idx) => {
            journeySteps.push({
              stepIndex: 6 + idx,
              title: `Central Billing: Invoice #${inv.invoiceNo}`,
              department: 'Central Billing',
              staff: inv.createdByName || 'Cashier Desk',
              timestamp: inv.createdAt,
              status: inv.status === 'PAID' ? 'COMPLETED' : 'PENDING',
              details: `Invoice #${inv.invoiceNo} for ₹${inv.grandTotal || inv.totalAmount}. Status: ${inv.status}. Balance pending: ₹${inv.balanceAmount || 0}.`,
            });
          });
        }

        if (apptReceipts.length > 0) {
          apptReceipts.forEach((rc, idx) => {
            journeySteps.push({
              stepIndex: 7 + idx,
              title: `Payment Settled: Receipt #${rc.receiptNo}`,
              department: 'Central Billing',
              staff: rc.cashierId?.name || rc.createdByName || 'Cashier Desk',
              timestamp: rc.createdAt || rc.paidAt,
              status: 'COMPLETED',
              details: `Payment of ₹${rc.amountPaid} collected via ${rc.paymentMode}${rc.transactionRef ? ` (${rc.transactionRef})` : ''}. Official Receipt #${rc.receiptNo} generated.`,
            });
          });
        }

        // Stats accumulation
        stats.total++;
        if (currentStage === 'AT_NURSE') stats.atNurse++;
        if (currentStage === 'IN_DIAGNOSTICS') stats.inLab++;
        if (currentStage === 'AT_PHARMACY') stats.atPharmacy++;
        if (currentStage === 'AT_BILLING') stats.atBilling++;
        if (currentStage === 'COMPLETED_SETTLED') stats.completed++;
        if (isDelayed || auditAlerts.length > 0) stats.delayedAlerts++;

        return {
          id: appt?._id || primaryInvoice?._id || `j_${pId}_${Date.now()}`,
          appointmentNo: appt?.appointmentNo || primaryInvoice?.invoiceNo || 'DIRECT-VISIT',
          tokenNumber: appt?.tokenNumber || (primaryInvoice ? 'BILL' : '0'),
          createdAt: appt?.createdAt || primaryInvoice?.createdAt || now,
          patient: {
            id: pId,
            name: pName,
            uhid,
            gender: patient?.gender || 'N/A',
            age: patient?.age || 'N/A',
            phone: patient?.phone || 'N/A',
          },
          doctor: {
            id: doctor?._id || null,
            name: doctor?.name || primaryInvoice?.doctorName || 'General Consultant',
            specialization: doctor?.specialization || 'Clinical Services',
            cabin: doctor?.cabinNo || appt?.cabinNo || 'Cabin 101',
          },
          origin: {
            department: 'Reception / Front Desk',
            time: appt?.createdAt || primaryInvoice?.createdAt || now,
            tokenNumber: appt?.tokenNumber || 'N/A',
          },
          currentStage,
          currentStageLabel,
          handlingStaff,
          nextDestination,
          isDelayed,
          auditAlerts,
          journeySteps,
          financials: {
            invoiceNo: primaryInvoiceNo,
            invoiceNos: invoiceNoList,
            receiptNo: primaryReceiptNo,
            receiptNos: receiptNoList,
            receipts: apptReceipts.map((r) => ({
              id: r._id,
              receiptNo: r.receiptNo,
              amountPaid: r.amountPaid,
              paymentMode: r.paymentMode,
              transactionRef: r.transactionRef,
              cashierName: r.cashierId?.name || r.createdByName || 'Cashier Desk',
              paidAt: r.createdAt || r.paidAt,
              remarks: r.remarks,
            })),
            invoices: apptInvoices.map((i) => ({
              id: i._id,
              invoiceNo: i.invoiceNo,
              grandTotal: i.grandTotal || i.totalAmount,
              paidAmount: i.paidAmount,
              balanceAmount: i.balanceAmount,
              status: i.status,
            })),
            totalAmount,
            paidAmount,
            balanceAmount,
            paymentStatus,
          },
        };
      };

      // 1. Build journeys for all appointments
      appointments.forEach((appt) => {
        const pId = String(appt.patientId?._id || appt.patientId || '');
        if (pId) handledPatientIds.add(pId);
        journeys.push(buildJourney({
          appt,
          patient: appt.patientId,
          doctor: appt.doctorId,
        }));
      });

      // 2. Build journeys for standalone invoices/receipts (e.g. direct billing or walk-in patients)
      allInvoices.forEach((inv) => {
        const pId = String(inv.patientId?._id || inv.patientId || '');
        if (pId && !handledPatientIds.has(pId)) {
          handledPatientIds.add(pId);
          journeys.push(buildJourney({
            invoice: inv,
            patient: inv.patientId,
            doctor: inv.doctorId,
          }));
        }
      });

      allReceipts.forEach((rc) => {
        const pId = String(rc.patientId?._id || rc.patientId || '');
        if (pId && !handledPatientIds.has(pId)) {
          handledPatientIds.add(pId);
          journeys.push(buildJourney({
            patient: rc.patientId,
          }));
        }
      });

      // Filter by search query across all patient, clinical, financial, receipt, and invoice identifiers
      let filteredJourneys = journeys;
      if (search) {
        const q = search.toLowerCase();
        filteredJourneys = filteredJourneys.filter((j) => {
          const inPatient = (j.patient.name || '').toLowerCase().includes(q) ||
                            (j.patient.uhid || '').toLowerCase().includes(q) ||
                            (j.patient.phone || '').toLowerCase().includes(q);
          const inToken = String(j.tokenNumber).toLowerCase().includes(q) || (j.appointmentNo || '').toLowerCase().includes(q);
          const inDoctor = (j.doctor.name || '').toLowerCase().includes(q);
          const inStaff = (j.handlingStaff.name || '').toLowerCase().includes(q);
          const inStage = (j.currentStageLabel || '').toLowerCase().includes(q);
          const inInvoice = (j.financials.invoiceNo || '').toLowerCase().includes(q) ||
                            (j.financials.invoiceNos || []).some((no) => no.toLowerCase().includes(q));
          const inReceipt = (j.financials.receiptNo || '').toLowerCase().includes(q) ||
                            (j.financials.receiptNos || []).some((no) => no.toLowerCase().includes(q)) ||
                            (j.financials.receipts || []).some((r) =>
                              (r.receiptNo || '').toLowerCase().includes(q) ||
                              (r.transactionRef || '').toLowerCase().includes(q) ||
                              (r.cashierName || '').toLowerCase().includes(q) ||
                              (r.remarks || '').toLowerCase().includes(q)
                            );
          const inSteps = (j.journeySteps || []).some((s) =>
            (s.title || '').toLowerCase().includes(q) ||
            (s.details || '').toLowerCase().includes(q) ||
            (s.staff || '').toLowerCase().includes(q)
          );

          return inPatient || inToken || inDoctor || inStaff || inStage || inInvoice || inReceipt || inSteps;
        });
      }

      // Filter by stage tab
      if (stageFilter !== 'ALL') {
        if (stageFilter === 'NURSE') filteredJourneys = filteredJourneys.filter((j) => j.currentStage === 'AT_NURSE');
        else if (stageFilter === 'DIAGNOSTICS') filteredJourneys = filteredJourneys.filter((j) => j.currentStage === 'IN_DIAGNOSTICS');
        else if (stageFilter === 'PHARMACY') filteredJourneys = filteredJourneys.filter((j) => j.currentStage === 'AT_PHARMACY');
        else if (stageFilter === 'BILLING') filteredJourneys = filteredJourneys.filter((j) => j.currentStage === 'AT_BILLING');
        else if (stageFilter === 'COMPLETED') filteredJourneys = filteredJourneys.filter((j) => j.currentStage === 'COMPLETED_SETTLED');
        else if (stageFilter === 'ALERTS') filteredJourneys = filteredJourneys.filter((j) => j.auditAlerts.length > 0 || j.isDelayed);
      }

      return {
        journeys: filteredJourneys,
        stats,
      };
    } catch (err) {
      console.error('[WorkflowService.getHospitalDataJourney Error]', err);
      return { journeys: [], stats: {} };
    }
  }
}
