import { Consultation } from '../../models/Consultation.js';
import { Prescription } from '../../models/Prescription.js';
import { Appointment } from '../../models/Appointment.js';
import { Patient } from '../../models/Patient.js';
import { Hospital } from '../../models/Hospital.js';
import { Invoice } from '../../models/Invoice.js';
import { NurseTasksService } from '../pharmacy/nurse-tasks.service.js';
import { PAYMENT_STATUS } from '../../config/constants.js';
import { socketManager } from '../../events/socketManager.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { ApiError } from '../../utils/apiError.js';

export class EmrService {
  static async createConsultation(data, user) {
    const hospitalId = user.hospitalId;
    const appointment = await Appointment.findOne({ _id: data.appointmentId, hospitalId });
    if (!appointment) {
      throw new ApiError(404, 'Appointment not found for consultation', null, 'NOT_FOUND');
    }
    const apptDocId = appointment.doctorId?._id ? String(appointment.doctorId._id) : (appointment.doctorId ? String(appointment.doctorId) : '');
    const currentUserId = String(user.id || user._id || '');
    if (apptDocId && currentUserId && apptDocId !== currentUserId && user.role === 'DOCTOR') {
      throw new ApiError(403, 'This appointment is assigned to another doctor', null, 'FORBIDDEN');
    }

    // Check for any department requests for this patient/appointment
    const { DiagnosticOrder } = await import('../../models/DiagnosticOrder.js');
    const departmentOrders = await DiagnosticOrder.find({
      hospitalId,
      appointmentId: appointment._id,
      chargeStatus: { $ne: 'CANCELLED' },
    }).lean({ getters: true });

    const consultationFee = data.consultationFee !== undefined && data.consultationFee !== null && data.consultationFee !== ''
      ? Number(data.consultationFee)
      : 0;
    const emergencyFee = Number(data.emergencyFee) || 0;
    const doctorProcedureCharges = Array.isArray(data.doctorProcedureCharges)
      ? data.doctorProcedureCharges.filter(p => p && p.description && p.description.trim() !== '')
      : [];

    const sanitizedPrescriptions = (data.prescriptions || [])
      .filter(p => p && p.medicineName && p.medicineName.trim() !== '')
      .map(p => ({
        ...p,
        medicineName: p.medicineName.trim(),
        dosage: p.dosage || (p.dosageForm === 'INJECTION' ? '1 Ampoule IV Stat' : '1 Tablet'),
        frequency: p.frequency || (p.dosageForm === 'INJECTION' ? 'STAT_IMMEDIATE' : 'TWICE_DAILY'),
        durationDays: Number(p.durationDays) || 1,
        timing: ['BEFORE_FOOD', 'AFTER_FOOD', 'WITH_FOOD', 'STAT', 'AS_DIRECTED'].includes(p.timing) ? p.timing : 'AFTER_FOOD',
        treatmentType: p.treatmentType || (['INJECTION', 'IV_FLUID'].includes(p.dosageForm) ? 'NURSE_ADMINISTERED' : 'ORAL_TAKE_HOME'),
        unitPrice: Number(p.unitPrice) || 0,
        price: Number(p.unitPrice) || 0,
        quantity: Number(p.quantity) || 1,
        totalPrice: Number(p.totalPrice) || 0,
      }));

    const hospId = user.hospitalId || appointment.hospitalId;
    let brId = user.branchId || appointment.branchId;
    if (!brId) {
      try {
        const { Branch } = await import('../../models/Branch.js');
        const defaultBranch = (await Branch.findOne({ hospitalId: hospId, isDefault: true }).lean()) || (await Branch.findOne({ hospitalId: hospId }).lean());
        if (defaultBranch) brId = defaultBranch._id;
      } catch (e) {}
    }

    const consultation = await Consultation.create({
      hospitalId: hospId,
      branchId: brId,
      appointmentId: appointment._id,
      patientId: appointment.patientId,
      doctorId: user.id || user._id,
      vitals: data.vitals || { bp: '120/80', pulse: 72, spo2: 98, temperature: 98.6, weightKg: 70 },
      chiefComplaints: data.chiefComplaints || appointment.chiefComplaints || 'General Consultation',
      historyOfPresentIllness: data.historyOfPresentIllness || '',
      prescriptions: sanitizedPrescriptions,
      consultationFee,
      emergencyFee,
      doctorProcedureCharges,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : undefined,
      adviceToPatient: data.adviceToPatient || '',
      status: 'FINALIZED',
    });

    // Create prescription if medicines provided
    let prescription = null;
    let nurseTasks = [];
    if (sanitizedPrescriptions.length > 0) {
      const [rxCount, hospitalDoc] = await Promise.all([
        Prescription.countDocuments({ hospitalId: hospId }),
        Hospital.findById(hospId).select('code').lean().catch(() => null),
      ]);
      const hospCode = hospitalDoc?.code ? `${hospitalDoc.code}-` : '';
      let rxNo = `RX-${hospCode}${new Date().getFullYear()}-${String(rxCount + 1).padStart(5, '0')}`;

      let attempts = 0;
      while (await Prescription.exists({ hospitalId: hospId, prescriptionNo: rxNo }) && attempts < 100) {
        attempts++;
        rxNo = `RX-${hospCode}${new Date().getFullYear()}-${String(rxCount + 1 + attempts).padStart(5, '0')}`;
      }

      const hasTakeHomeInHouseMedicines = sanitizedPrescriptions.some(
        (p) =>
          !p.externalPurchaseRequired &&
          p.treatmentType !== 'EXTERNAL_PURCHASE_OUTSIDE' &&
          p.treatmentType !== 'NURSE_ADMINISTERED' &&
          p.treatmentType !== 'DOCTOR_ADMINISTERED_NOW' &&
          !['INJECTION', 'IV_FLUID'].includes(p.dosageForm)
      );

      const isExternalPharmacy = data.pharmacyMode === 'EXTERNAL_NO_INHOUSE_PHARMACY' || !hasTakeHomeInHouseMedicines;

      const finalMedicines = sanitizedPrescriptions.map(p => {
        const isNurseTask = p.treatmentType === 'NURSE_ADMINISTERED' || ['INJECTION', 'IV_FLUID'].includes(p.dosageForm);
        if (isNurseTask) {
          return {
            ...p,
            treatmentType: 'NURSE_ADMINISTERED',
            // Administration is tracked by the linked NurseTask. The medicine
            // remains pending until a nurse records the actual administration.
            itemStatus: 'PENDING',
          };
        }
        if (isExternalPharmacy || p.treatmentType === 'EXTERNAL_PURCHASE_OUTSIDE' || p.externalPurchaseRequired) {
          return {
            ...p,
            externalPurchaseRequired: true,
            itemStatus: 'PURCHASED_EXTERNALLY',
          };
        }
        if (p.treatmentType === 'DOCTOR_ADMINISTERED_NOW') {
          return {
            ...p,
            itemStatus: 'ADMINISTERED_BY_DOCTOR',
          };
        }
        return p;
      });

      prescription = await Prescription.create({
        hospitalId: hospId,
        branchId: brId,
        consultationId: consultation._id,
        patientId: appointment.patientId,
        doctorId: user.id || user._id,
        prescriptionNo: rxNo,
        medicines: finalMedicines,
        pharmacyMode: isExternalPharmacy ? 'EXTERNAL_NO_INHOUSE_PHARMACY' : 'IN_HOUSE_PHARMACY',
        dispenseStatus: hasTakeHomeInHouseMedicines ? 'PENDING_DISPENSE' : 'DISPENSED',
        totalMedicineCharge: 0,
      });

      // Automatically extract nurse-administered treatments (injections, IV fluids, dressings) into Nurse Tasks
      nurseTasks = await NurseTasksService.createTasksFromPrescription(prescription, user, appointment._id);

      // Only notify hospital pharmacy desk if there are in-house take-home medicines to package & dispense
      if (hasTakeHomeInHouseMedicines) {
        const patient = await Patient.findOne({ _id: appointment.patientId, hospitalId: hospId }).select('firstName lastName uhid');
        await WorkflowEventService.emit(WORKFLOW_EVENTS.PRESCRIPTION_ISSUED, {
          hospitalId: hospId,
          branchId: brId,
          prescriptionId: prescription._id,
          patientId: appointment.patientId,
          senderUserId: user.id || user._id,
          patientName: patient ? `${patient.firstName} ${patient.lastName}`.trim() : 'Patient',
          uhid: patient?.uhid || 'N/A',
          doctorName: user.name || 'Doctor',
          linkedPath: `/pharmacy/dashboard?prescriptionId=${prescription._id}&patientId=${appointment.patientId}`,
        }, brId);
      }
    }

    // Resolve any previous nurse tasks, department orders, and returned billing queries for this consultation
    try {
      const { NurseTask } = await import('../../models/NurseTask.js');
      await NurseTask.updateMany(
        {
          hospitalId: hospId,
          $or: [{ appointmentId: appointment._id }, { patientId: appointment.patientId }],
          doctorReviewedAt: null,
        },
        { $set: { doctorReviewedAt: new Date() } }
      );
      // Auto-resolve any pending billing query on previous prescriptions for this patient
      const { Prescription: RxModel } = await import('../../models/Prescription.js');
      await RxModel.updateMany(
        {
          hospitalId: hospId,
          patientId: appointment.patientId,
          $or: [
            { 'billingQuery.resolved': false },
            { dispenseStatus: 'RETURNED_TO_DOCTOR' },
          ],
        },
        {
          $set: {
            'billingQuery.resolved': true,
            'billingQuery.resolvedAt': new Date(),
            'billingQuery.resolvedByDoctorId': user.id || user._id,
            dispenseStatus: 'DISPENSED',
          },
        }
      );
      const { Invoice } = await import('../../models/Invoice.js');
      await Invoice.updateMany(
        {
          hospitalId: hospId,
          patientId: appointment.patientId,
          'doctorReviewQuery.attendingDoctorId': user.id || user._id,
          'doctorReviewQuery.resolved': false,
        },
        {
          $set: {
            'doctorReviewQuery.resolved': true,
            'doctorReviewQuery.resolvedAt': new Date(),
            'doctorReviewQuery.resolvedByDoctorId': user.id || user._id,
          },
        }
      );

      const { NotificationService } = await import('../notifications/notification.service.js');
      await NotificationService.completeEntityTasks({
        hospitalId: hospId,
        entityType: 'Appointment',
        entityId: appointment._id,
        relatedPatientId: appointment.patientId,
        targetModule: 'doctor',
        branchId: appointment.branchId,
      });
      const pendingInvoices = await Invoice.find({
        hospitalId: hospId,
        patientId: appointment.patientId,
      }).select('_id').lean();
      await Promise.all(
        pendingInvoices.map((inv) =>
          NotificationService.completeEntityTasks({
            hospitalId: hospId,
            entityId: inv._id,
            relatedPatientId: appointment.patientId,
            targetModule: 'doctor',
          })
        )
      );
    } catch (ntErr) {
      console.warn('Failed to auto-resolve nurse tasks or billing queries:', ntErr?.message);
    }

    // Determine workflow state:
    // 1. Nurse administration takes first clinical precedence
    // 2. In-house pharmacy take-home packaging takes second precedence (BEFORE billing)
    // 3. Otherwise, directly to central billing / completed
    const hasPendingNurseAdministration = nurseTasks && nurseTasks.length > 0;
    const hasPendingPharmacyDispense = sanitizedPrescriptions.some(
      (p) =>
        !p.externalPurchaseRequired &&
        p.treatmentType !== 'EXTERNAL_PURCHASE_OUTSIDE' &&
        p.treatmentType !== 'NURSE_ADMINISTERED' &&
        p.treatmentType !== 'DOCTOR_ADMINISTERED_NOW' &&
        !['INJECTION', 'IV_FLUID'].includes(p.dosageForm)
    ) && (data.pharmacyMode !== 'EXTERNAL_NO_INHOUSE_PHARMACY');

    if (hasPendingNurseAdministration) {
      appointment.status = 'WAITING_NURSE';
      appointment.departmentReturnedAt = null;
      await appointment.save();
      socketManager.emitToBranch(appointment.branchId, 'opd_queue:status_changed', {
        appointmentId: appointment._id,
        status: appointment.status,
        tokenNumber: appointment.tokenNumber,
      });
    } else if (hasPendingPharmacyDispense) {
      appointment.status = 'WAITING_PHARMACY';
      appointment.departmentReturnedAt = null;
      await appointment.save();
      socketManager.emitToBranch(appointment.branchId, 'opd_queue:status_changed', {
        appointmentId: appointment._id,
        status: appointment.status,
        tokenNumber: appointment.tokenNumber,
      });
    } else {
      appointment.status = 'COMPLETED';
      await appointment.save();
      socketManager.emitToBranch(appointment.branchId, 'opd_queue:status_changed', {
        appointmentId: appointment._id,
        status: appointment.status,
        tokenNumber: appointment.tokenNumber,
      });
    }

    // IPD Recommendation handling & Requisition to Inpatient Ward
    if (data.ipdRecommendation?.isRecommended) {
      try {
        const { AdmissionsService } = await import('../admissions/admissions.service.js');
        const gInfo = data.ipdRecommendation.guardianInfo || {};

        // If optional guardian info was provided, update patient record
        if (gInfo.name || gInfo.phone) {
          const updateFields = {};
          if (gInfo.name) updateFields['emergencyContact.name'] = gInfo.name.trim();
          if (gInfo.phone) updateFields['emergencyContact.phone'] = gInfo.phone.trim();
          if (gInfo.relationship) updateFields['emergencyContact.relation'] = gInfo.relationship;
          if (gInfo.address) updateFields.address = gInfo.address.trim();
          await Patient.updateOne({ _id: appointment.patientId, hospitalId: hospId }, { $set: updateFields });
        }

        // Trigger official admission requisition
        await AdmissionsService.requestAdmission({
          patientId: appointment.patientId,
          wardType: data.ipdRecommendation.recommendedWard || 'GENERAL',
          targetWardName: data.ipdRecommendation.recommendedWard || 'Ward 3B - Inpatient',
          admissionReason: data.ipdRecommendation.admissionReason || data.chiefComplaints || 'Doctor Inpatient Admission Recommendation',
        }, user);

        const patientObj = await Patient.findOne({ _id: appointment.patientId, hospitalId: hospId }).select('firstName lastName uhid');
        await WorkflowEventService.emit(WORKFLOW_EVENTS.IPD_ADMISSION_RECOMMENDED, {
          patientId: appointment.patientId,
          patientName: patientObj ? `${patientObj.firstName} ${patientObj.lastName}`.trim() : 'Patient',
          uhid: patientObj?.uhid || 'N/A',
          doctorName: user.name || 'Doctor',
          wardType: data.ipdRecommendation.recommendedWard || 'General Ward',
          priority: data.ipdRecommendation.priority || 'ROUTINE',
          reason: data.ipdRecommendation.admissionReason || data.chiefComplaints || 'Clinical Inpatient Stay',
          senderUserId: user.id || user._id,
          linkedPath: '/reception/dashboard',
        }, appointment.branchId);
      } catch (err) {
        console.error('Failed to trigger IPD admission requisition:', err);
      }
    }

    let existingInvoice = null;
    if (data.invoiceId) {
      existingInvoice = await Invoice.findOne({
        _id: data.invoiceId,
        hospitalId: hospId,
        status: { $in: [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.PARTIALLY_PAID] },
        isDeleted: { $ne: true },
      });
    }
    if (!existingInvoice) {
      existingInvoice = await Invoice.findOne({
        hospitalId: hospId,
        patientId: appointment.patientId,
        status: { $in: [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.PARTIALLY_PAID] },
        isDeleted: { $ne: true },
      }).sort({ createdAt: -1 });
    }

    const consultationItem = {
      description: `OPD Consultation — Dr. ${user.name || 'Doctor'} (${data.chiefComplaints || 'OPD Check-up'})`,
      category: 'CONSULTATION',
      qty: 1,
      unitPrice: consultationFee + emergencyFee,
      totalPrice: consultationFee + emergencyFee,
    };

    const newProcedureItems = [];
    if (doctorProcedureCharges.length > 0) {
      doctorProcedureCharges.forEach((proc) => {
        if (proc.description && proc.amount) {
          newProcedureItems.push({
            description: `Doctor Procedure: ${proc.description}`,
            category: 'OTHER',
            qty: 1,
            unitPrice: Number(proc.amount) || 0,
            totalPrice: Number(proc.amount) || 0,
          });
        }
      });
    }

    const activeDeptOrders = departmentOrders.filter(
      (ord) => ord.chargeStatus !== 'CANCELLED' && ord.chargeStatus !== 'INCLUDED_IN_FINAL_BILL'
    );
    const newDeptItems = [];
    for (const ord of activeDeptOrders) {
      const catMap = {
        XRAY: 'RADIOLOGY',
        MRI: 'RADIOLOGY',
        CT_SCAN: 'RADIOLOGY',
        ULTRASOUND: 'RADIOLOGY',
        LABORATORY: 'LAB',
        BLOOD_TEST: 'LAB',
        URINE_ANALYSIS: 'LAB',
        ECG: 'OTHER',
      };
      const cat = catMap[ord.testCategory] || 'OTHER';
      const chgAmount = ord.totalDepartmentCharge || ord.price || 50.0;
      newDeptItems.push({
        description: `[${ord.testCategory}] ${ord.testName} (${ord.technicianName || 'Department'})`,
        sourceRef: String(ord._id),
        category: cat,
        qty: 1,
        unitPrice: chgAmount,
        totalPrice: chgAmount,
      });
    }

    let invoiceNo;
    let isNewInvoice = false;
    let activeInvoice = existingInvoice;

    if (activeInvoice) {
      invoiceNo = activeInvoice.invoiceNo;
      // Filter out old CONSULTATION and old Doctor Procedure items to replace with updated ones
      const remainingItems = (activeInvoice.items || []).filter((item) => {
        if (item.category === 'CONSULTATION') return false;
        if (item.category === 'OTHER' && (item.description?.startsWith('Doctor Procedure:') || item.description?.toLowerCase().includes('procedure'))) return false;
        return true;
      });

      const existingDeptRefs = new Set(remainingItems.map((it) => it.sourceRef).filter(Boolean));
      const filteredDeptItems = newDeptItems.filter((it) => !existingDeptRefs.has(it.sourceRef));

      activeInvoice.items = [consultationItem, ...newProcedureItems, ...remainingItems, ...filteredDeptItems];
      activeInvoice.consultationId = consultation._id;
      if (data.followUpDate) activeInvoice.followUpDate = new Date(data.followUpDate);
      if (user.id || user._id) {
        activeInvoice.doctorId = user.id || user._id;
        activeInvoice.doctorName = user.name ? `Dr. ${user.name}` : 'Doctor Consultant';
      }
      activeInvoice.subtotal = activeInvoice.items.reduce((acc, item) => acc + item.totalPrice, 0);
      const discount = Number(activeInvoice.discountAmount) || 0;
      activeInvoice.grandTotal = Math.max(0, activeInvoice.subtotal - discount);
      activeInvoice.balanceAmount = Math.max(0, activeInvoice.grandTotal - (Number(activeInvoice.paidAmount) || 0));

      if (activeInvoice.doctorReviewQuery) {
        activeInvoice.doctorReviewQuery.resolved = true;
        activeInvoice.doctorReviewQuery.resolvedAt = new Date();
        activeInvoice.doctorReviewQuery.resolvedByDoctorId = user.id || user._id;
        activeInvoice.doctorReviewQuery.responseNote = `Consultation fees & clinical items updated by Dr. ${user.name || 'Doctor'}`;
      }

      await activeInvoice.save();
    } else {
      isNewInvoice = true;
      const year = new Date().getFullYear();
      let seqNum = (await Invoice.countDocuments({ hospitalId: hospId })) + 1;
      invoiceNo = `INV-${year}-${String(seqNum).padStart(5, '0')}`;
      let existing = await Invoice.findOne({ hospitalId: hospId, invoiceNo });
      while (existing) {
        seqNum++;
        invoiceNo = `INV-${year}-${String(seqNum).padStart(5, '0')}`;
        existing = await Invoice.findOne({ hospitalId: hospId, invoiceNo });
      }

      const items = [consultationItem, ...newProcedureItems, ...newDeptItems];
      const subtotal = items.reduce((acc, item) => acc + item.totalPrice, 0);

      const invoice = await Invoice.create({
        hospitalId: hospId,
        branchId: brId,
        patientId: appointment.patientId,
        doctorId: user.id || user._id,
        doctorName: user.name ? `Dr. ${user.name}` : 'Doctor Consultant',
        consultationId: consultation._id,
        followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
        invoiceNo,
        items,
        subtotal,
        discountAmount: 0,
        grandTotal: subtotal,
        paidAmount: 0,
        balanceAmount: subtotal,
        status: PAYMENT_STATUS.UNPAID,
      });
      activeInvoice = invoice;
    }

    const invoice = activeInvoice;

    if (activeDeptOrders.length > 0) {
      await DiagnosticOrder.updateMany(
        { hospitalId: hospId, _id: { $in: activeDeptOrders.map((order) => order._id) } },
        { $set: { chargeStatus: 'INCLUDED_IN_FINAL_BILL' } },
      );
    }

    // Auto-resolve completed nurse tasks for this patient so they disappear from active department responses
    try {
      const { NurseTask } = await import('../../models/NurseTask.js');
      await NurseTask.updateMany(
        {
          hospitalId: hospId,
          patientId: appointment.patientId,
          doctorReviewedAt: null,
        },
        { $set: { doctorReviewedAt: new Date() } }
      );
    } catch (e) {
      console.error('Failed to resolve nurse tasks on consultation completion:', e);
    }

    const patObj = await Patient.findOne({ _id: appointment.patientId, hospitalId: hospId }).select('firstName lastName uhid').lean();
    const patientName = patObj ? `${patObj.firstName} ${patObj.lastName}`.trim() : 'Patient';
    const billingRoute = `/billing/dashboard?tab=CENTRAL_DESK&invoiceId=${invoice._id}`;

    const billingPayload = {
      invoiceId: invoice._id,
      invoiceNo,
      patientId: appointment.patientId,
      patientName,
      uhid: patObj?.uhid || 'N/A',
      doctorName: user.name || 'Doctor',
      grandTotal: invoice.grandTotal,
      hospitalId: hospId,
      branchId: brId,
      linkedPath: billingRoute,
    };

    // Notify Central Billing Desk (CASHIER / BILLING_STAFF) ONLY if patient is not waiting at pharmacy
    if (!hasPendingPharmacyDispense && !hasPendingNurseAdministration) {
      await WorkflowEventService.emit(WORKFLOW_EVENTS.CONSULTATION_COMPLETE, {
        hospitalId: hospId,
        branchId: brId,
        invoiceId: invoice._id,
        patientId: appointment.patientId,
        invoiceNo,
        patientName,
        uhid: patObj?.uhid || 'N/A',
        doctorName: user.name || 'Doctor',
        grandTotal: invoice.grandTotal,
        linkedPath: billingRoute,
      }, brId);
    }

    const billingEvent = isNewInvoice ? 'billing:invoice_created' : 'billing:invoice_updated';
    socketManager.emitToBranch(brId, billingEvent, billingPayload);
    if (hospId) {
      socketManager.emitToHospital(hospId, billingEvent, billingPayload);
    }
    socketManager.emitToRole('CASHIER', billingEvent, billingPayload);
    socketManager.emitToRole('BILLING_STAFF', billingEvent, billingPayload);

    const populatedConsultation = await Consultation.findById(consultation._id)
      .populate('patientId')
      .populate('doctorId', 'name specialization');

    return {
      consultation: populatedConsultation,
      prescription,
      nurseTasks,
      invoice,
    };
  }

  static async getPatientEhr(identifier, user) {
    let patient = null;
    const currentTenantHospitalId = user?.hospitalId?._id || user?.hospitalId;
    if (!currentTenantHospitalId) {
      throw new ApiError(403, 'Hospital context is required to access an EHR.', null, 'HOSPITAL_CONTEXT_REQUIRED');
    }
    const { mongoose } = await import('mongoose');
    const { DiagnosticOrder } = await import('../../models/DiagnosticOrder.js');
    const { NurseTask } = await import('../../models/NurseTask.js');
    const { Hospital } = await import('../../models/Hospital.js');

    if (mongoose.Types.ObjectId.isValid(identifier)) {
      patient = await Patient.findOne({ _id: identifier, hospitalId: currentTenantHospitalId }).populate('hospitalId', 'name domain code');
    }
    if (!patient && identifier) {
      const clean = String(identifier).trim();
      patient = await Patient.findOne({
        hospitalId: currentTenantHospitalId,
        $or: [
          { uhid: clean },
          { uhid: { $regex: `^${clean}$`, $options: 'i' } },
          { phone: clean },
          { phone: { $regex: clean.replace(/\D/g, '').slice(-10), $options: 'i' } },
        ],
      }).populate('hospitalId', 'name domain code');
    }

    if (!patient) {
      throw new ApiError(404, 'Patient record not found for this UHID / Phone / ID', null, 'NOT_FOUND');
    }

    // EHR access stays inside the authenticated hospital. Cross-hospital records
    // must use the explicit MedicalRecordShare consent workflow.
    const patientSearchConditions = [{ _id: patient._id }];
    if (patient.uhid) patientSearchConditions.push({ uhid: patient.uhid });
    if (patient.phone && patient.phone.trim().length >= 7) {
      patientSearchConditions.push({ phone: patient.phone.trim() });
    }
    if (patient.globalPatientId) {
      patientSearchConditions.push({ globalPatientId: patient.globalPatientId });
    }

    const matchedPatients = await Patient.find({ hospitalId: currentTenantHospitalId, $or: patientSearchConditions })
      .select('_id hospitalId uhid')
      .lean();
    const patientIds = Array.from(new Set(matchedPatients.map((p) => p._id.toString())));

    const [consultations, prescriptions, diagnosticOrders, nurseTasks, invoices] = await Promise.all([
      Consultation.find({ hospitalId: currentTenantHospitalId, patientId: { $in: patientIds } })
        .populate('doctorId', 'name specialization cabinNo')
        .populate('hospitalId', 'name domain code')
        .sort({ createdAt: -1 })
        .lean({ getters: true }),
      Prescription.find({ hospitalId: currentTenantHospitalId, patientId: { $in: patientIds } })
        .populate('doctorId', 'name specialization')
        .populate('hospitalId', 'name domain code')
        .sort({ createdAt: -1 })
        .lean({ getters: true }),
      DiagnosticOrder.find({ hospitalId: currentTenantHospitalId, patientId: { $in: patientIds } })
        .populate('hospitalId', 'name domain code')
        .sort({ createdAt: -1 })
        .lean({ getters: true }),
      NurseTask.find({ hospitalId: currentTenantHospitalId, patientId: { $in: patientIds } })
        .populate('assignedNurseId', 'name')
        .sort({ createdAt: -1 })
        .lean({ getters: true }),
      Invoice.find({ hospitalId: currentTenantHospitalId, patientId: { $in: patientIds }, isDeleted: { $ne: true } })
        .populate('hospitalId', 'name domain code')
        .sort({ createdAt: -1 })
        .lean({ getters: true }),
    ]);

    const currentHospitalId = user?.hospitalId?._id
      ? String(user.hospitalId._id)
      : user?.hospitalId
      ? String(user.hospitalId)
      : null;

    // Apply strict Financial Privacy Redaction:
    // Doctors can see full clinical treatment history (diagnoses, notes, vitals, prescriptions, lab results)
    // from all hospitals, but financial amounts and fees from other hospitals are strictly stripped.

    const sanitizedConsultations = consultations.map((c) => {
      const doc = c.toObject ? c.toObject() : { ...c };
      const recHospId = doc.hospitalId?._id ? String(doc.hospitalId._id) : (doc.hospitalId ? String(doc.hospitalId) : null);
      const isCurrentHosp = !currentHospitalId || !recHospId || recHospId === currentHospitalId;

      if (!isCurrentHosp) {
        delete doc.consultationFee;
        delete doc.emergencyFee;
        delete doc.doctorProcedureCharges;
        doc.isExternalHospitalRecord = true;
        doc.originHospitalName = doc.hospitalId?.name || 'Partner Hospital';
      } else {
        doc.isExternalHospitalRecord = false;
        doc.originHospitalName = doc.hospitalId?.name || 'This Hospital';
      }
      return doc;
    });

    const sanitizedPrescriptions = prescriptions.map((p) => {
      const doc = p.toObject ? p.toObject() : { ...p };
      const recHospId = doc.hospitalId?._id ? String(doc.hospitalId._id) : (doc.hospitalId ? String(doc.hospitalId) : null);
      const isCurrentHosp = !currentHospitalId || !recHospId || recHospId === currentHospitalId;

      if (!isCurrentHosp) {
        delete doc.totalMedicineCharge;
        if (Array.isArray(doc.medicines)) {
          doc.medicines = doc.medicines.map((m) => {
            const mDoc = { ...m };
            delete mDoc.unitPrice;
            delete mDoc.price;
            delete mDoc.totalPrice;
            return mDoc;
          });
        }
        doc.isExternalHospitalRecord = true;
        doc.originHospitalName = doc.hospitalId?.name || 'Partner Hospital';
      } else {
        doc.isExternalHospitalRecord = false;
        doc.originHospitalName = doc.hospitalId?.name || 'This Hospital';
      }
      return doc;
    });

    const sanitizedDiagnosticOrders = diagnosticOrders.map((d) => {
      const doc = d.toObject ? d.toObject() : { ...d };
      const recHospId = doc.hospitalId?._id ? String(doc.hospitalId._id) : (doc.hospitalId ? String(doc.hospitalId) : null);
      const isCurrentHosp = !currentHospitalId || !recHospId || recHospId === currentHospitalId;

      if (!isCurrentHosp) {
        delete doc.price;
        delete doc.totalDepartmentCharge;
        doc.isExternalHospitalRecord = true;
        doc.originHospitalName = doc.hospitalId?.name || 'Partner Hospital';
      } else {
        doc.isExternalHospitalRecord = false;
        doc.originHospitalName = doc.hospitalId?.name || 'This Hospital';
      }
      return doc;
    });

    // Invoices: Zero financial leak — only show invoices from the CURRENT hospital
    const sanitizedInvoices = invoices.filter((inv) => {
      const invHospId = inv.hospitalId?._id ? String(inv.hospitalId._id) : (inv.hospitalId ? String(inv.hospitalId) : null);
      return !currentHospitalId || !invHospId || invHospId === currentHospitalId;
    });

    return {
      patient,
      consultations: sanitizedConsultations,
      prescriptions: sanitizedPrescriptions,
      diagnosticOrders: sanitizedDiagnosticOrders,
      nurseTasks,
      invoices: sanitizedInvoices,
    };
  }

  static async getFollowUps(user, query = {}) {
    const filter = { followUpDate: { $exists: true, $ne: null } };
    if (user?.hospitalId) {
      const hId = typeof user.hospitalId === 'object' ? user.hospitalId._id : user.hospitalId;
      filter.hospitalId = hId;
    }
    if (user?.role === 'DOCTOR' && user?.id) {
      filter.doctorId = user.id;
    }

    const consultations = await Consultation.find(filter)
      .populate('patientId', 'firstName lastName uhid phone age gender')
      .populate('doctorId', 'name specialization cabinNo')
      .sort({ followUpDate: 1 })
      .lean();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const patientIds = Array.from(
      new Set(
        consultations
          .map((c) => (c.patientId?._id ? String(c.patientId._id) : (c.patientId ? String(c.patientId) : null)))
          .filter(Boolean)
      )
    );

    // Batch query attended appointments for all patients to eliminate N+1 waterfall
    const attendedAppointments = patientIds.length > 0
      ? await Appointment.find({
          patientId: { $in: patientIds },
          status: { $in: ['COMPLETED', 'ENGAGED', 'IN_CONSULTATION'] },
        })
          .select('_id patientId createdAt status')
          .sort({ createdAt: 1 })
          .lean()
      : [];

    const apptsByPatientId = new Map();
    for (const appt of attendedAppointments) {
      const pid = String(appt.patientId);
      let list = apptsByPatientId.get(pid);
      if (!list) {
        list = [];
        apptsByPatientId.set(pid, list);
      }
      list.push(appt);
    }

    const enriched = consultations.map((c) => {
      if (!c.patientId) return null;
      const fDate = new Date(c.followUpDate);
      fDate.setHours(0, 0, 0, 0);

      const pid = c.patientId._id ? String(c.patientId._id) : String(c.patientId);
      const patientAppts = apptsByPatientId.get(pid) || [];
      const attendedVisit = patientAppts.find((a) => new Date(a.createdAt) >= fDate) || null;

      const isOverdue = fDate < today && !attendedVisit;
      const isToday = fDate.getTime() === today.getTime() && !attendedVisit;
      const isUpcoming = fDate > today && !attendedVisit;
      const followUpStatus = attendedVisit ? 'VISITED' : isOverdue ? 'MISSED_OVERDUE' : isToday ? 'TODAY' : 'UPCOMING';

      return {
        ...c,
        followUpStatus,
        isMissed: isOverdue,
        attendedVisitId: attendedVisit?._id || null,
      };
    });

    return enriched.filter(Boolean);
  }
}
