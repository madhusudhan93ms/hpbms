import { DiagnosticOrder } from '../../models/DiagnosticOrder.js';
import { Patient } from '../../models/Patient.js';
import { User } from '../../models/User.js';
import { AuditLog } from '../../models/AuditLog.js';
import { socketManager } from '../../events/socketManager.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { ApiError } from '../../utils/apiError.js';
import { Appointment } from '../../models/Appointment.js';
import { requireBranchContext, requireHospitalContext } from '../../utils/tenantContext.js';

export class DiagnosticsService {
  static async requestInvestigation(data, user) {
    const hospitalId = requireHospitalContext(user);
    const branchId = requireBranchContext(user);

    const patient = await Patient.findOne({ _id: data.patientId, hospitalId });
    if (!patient) {
      throw new ApiError(404, 'Patient record not found', null, 'NOT_FOUND');
    }

    // Compute patient age
    let patientAge = '30 Y';
    if (patient.dob) {
      const ageYears = new Date().getFullYear() - new Date(patient.dob).getFullYear();
      patientAge = `${ageYears} Y`;
    }

    const testCategory = data.testCategory || 'OTHER';
    const testName = data.testName || 'General Diagnostic Investigation';
    const priority = data.priority || 'NORMAL';
    const doctorId = data.doctorId || user?.id || user?._id;
    const doctorName = data.doctorName || user?.name || 'Doctor Consultant';

    if (!data.appointmentId) {
      throw new ApiError(400, 'An active appointment is required before sending a department request', null, 'APPOINTMENT_REQUIRED');
    }

    const appointment = await Appointment.findOne({ _id: data.appointmentId, hospitalId });
    if (!appointment) {
      throw new ApiError(404, 'The active appointment could not be found', null, 'APPOINTMENT_NOT_FOUND');
    }
    if (String(appointment.doctorId) !== String(doctorId)) {
      throw new ApiError(403, 'This appointment is assigned to another doctor', null, 'FORBIDDEN');
    }
    if (String(appointment.patientId) !== String(patient._id)) {
      throw new ApiError(409, 'The selected patient does not match the active appointment', null, 'APPOINTMENT_PATIENT_MISMATCH');
    }
    if (['COMPLETED', 'CANCELLED'].includes(appointment.status)) {
      throw new ApiError(409, 'A department request cannot be sent for a closed appointment', null, 'APPOINTMENT_CLOSED');
    }

    const newOrder = await DiagnosticOrder.create({
      hospitalId,
      branchId,
      patientId: patient._id,
      uhid: patient.uhid,
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientAge,
      patientGender: patient.gender || 'MALE',
      opIpNumber: data.opIpNumber || `OP-${patient.uhid}`,
      tokenNumber: data.tokenNumber || 1,
      doctorId,
      doctorName,
      appointmentId: data.appointmentId || undefined,
      testCategory,
      testName,
      clinicalNotes: data.clinicalNotes || '',
      priority,
      price: data.price || 75.0,
      status: 'REQUESTED',
      timeline: [
        {
          status: 'REQUESTED',
          timestamp: new Date(),
          updatedBy: doctorName,
          notes: `Investigation '${testName}' requested by ${doctorName} (Priority: ${priority})`,
        },
      ],
    });

    appointment.status = 'WAITING_DEPARTMENT';
    appointment.departmentReturnedAt = null;
    await appointment.save();
    socketManager.emitToBranch(appointment.branchId, 'opd_queue:status_changed', {
      appointmentId: appointment._id,
      status: appointment.status,
      tokenNumber: appointment.tokenNumber,
    });

    // Create Audit Log
    try {
      await AuditLog.create({
        hospitalId,
        branchId,
        userId: user.id || user._id,
        userName: user.name || 'Doctor',
        userRole: user.role || 'DOCTOR',
        action: 'INVESTIGATION_REQUESTED',
        module: 'DIAGNOSTICS',
        entityType: 'DiagnosticOrder',
        entityId: newOrder._id,
        resourceId: String(newOrder._id),
        details: JSON.stringify({ testCategory, testName, patientUhid: patient.uhid, priority }),
      });
    } catch (e) {
      console.error('Audit log write skipped:', e.message);
    }

    const newRequestPayload = {
      orderId: newOrder._id,
      senderUserId: user.id || user._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      uhid: patient.uhid,
      patientAge,
      patientGender: patient.gender,
      doctorName: user.name || 'Doctor',
      testCategory,
      testName,
      priority,
      status: 'REQUESTED',
      createdAt: newOrder.createdAt,
    };

    const isRadio = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(testCategory);
    const departmentRoles = isRadio
      ? ['RADIOLOGIST', 'RADIOLOGY_STAFF']
      : ['LAB_TECH', 'LABORATORY_STAFF'];
    departmentRoles.forEach((role) => {
      socketManager.emitToBranchRole(branchId, role, 'investigation:new_request', newRequestPayload);
    });
    const evtName = isRadio ? WORKFLOW_EVENTS.RADIOLOGY_ORDER_CREATED : WORKFLOW_EVENTS.LAB_ORDER_CREATED;

    // Check if any available staff exist in the target department
    const targetRole = isRadio ? 'RADIOLOGIST' : 'LAB_TECH';
    const availableStaff = await User.find({ hospitalId, role: { $in: isRadio ? ['RADIOLOGIST', 'RADIOLOGY_STAFF'] : ['LAB_TECH', 'LABORATORY_STAFF'] }, isAvailable: { $ne: false } });
    if (availableStaff.length === 0) {
      // Still create the order (it queues), but record status note
      newOrder.timeline.push({ status: 'REQUESTED', timestamp: new Date(), updatedBy: doctorName, notes: `No ${isRadio ? 'radiology' : 'lab'} staff currently available. Order queued.` });
      await newOrder.save();
    }

    await WorkflowEventService.emit(evtName, {
      orderId: newOrder._id,
      hospitalId,
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      uhid: patient.uhid,
      doctorName,
      testName,
      testCategory,
      priority,
      // linkedPath includes orderId so notification click opens exact order
      linkedPath: isRadio
        ? `/radiology/dashboard?orderId=${newOrder._id}`
        : `/laboratory/dashboard?orderId=${newOrder._id}`,
      targetModule: isRadio ? 'radiology' : 'laboratory',
    }, branchId);

    return newOrder;
  }

  static async updateStatus(orderId, status, notes, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    const allowedStatuses = ['DEPARTMENT_RECEIVED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];
    if (!allowedStatuses.includes(status)) {
      throw new ApiError(400, 'Invalid diagnostic workflow status', null, 'INVALID_STATUS');
    }

    order.status = status;
    if (status === 'ACCEPTED' && !order.acceptedAt) order.acceptedAt = new Date();
    if (status === 'IN_PROGRESS' && !order.startedAt) order.startedAt = new Date();
    order.timeline.push({
      status,
      timestamp: new Date(),
      updatedBy: user?.name || 'Department Specialist',
      notes: notes || `Status changed to ${status}`,
    });

    if (status === 'COMPLETED') {
      order.completedAt = new Date();
      order.responseSubmittedAt = order.responseSubmittedAt || new Date();
    }

    await order.save();

    // Audit Log
    try {
      await AuditLog.create({
        hospitalId: order.hospitalId,
        branchId: order.branchId,
        userId: user?.id || user?._id,
        userName: user?.name || 'Technician',
        userRole: user?.role || 'LAB_TECH',
        action: 'INVESTIGATION_STATUS_UPDATED',
        module: 'DIAGNOSTICS',
        entityType: 'DiagnosticOrder',
        entityId: order._id,
        resourceId: String(order._id),
        details: JSON.stringify({ status, notes, testName: order.testName }),
      });
    } catch (e) {
      console.error('Audit log write skipped:', e.message);
    }

    // Broadcast status change to Doctor and Department
    const payload = {
      orderId: order._id,
      patientId: order.patientId,
      patientName: order.patientName,
      uhid: order.uhid,
      testName: order.testName,
      status: order.status,
      updatedBy: user?.name || 'Technician',
      timestamp: new Date(),
    };

    const isRadio = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(order.testCategory);
    const departmentRoles = isRadio
      ? ['RADIOLOGIST', 'RADIOLOGY_STAFF']
      : ['LAB_TECH', 'LABORATORY_STAFF'];
    departmentRoles.forEach((role) => {
      if (order.branchId) socketManager.emitToBranchRole(order.branchId, role, 'investigation:status_updated', payload);
      else socketManager.emitToHospitalRole(order.hospitalId, role, 'investigation:status_updated', payload);
    });
    if (order.doctorId) socketManager.emitToUser(String(order.doctorId), 'investigation:status_updated', payload);
    // LAB_ACCEPTED / RADIOLOGY_ACCEPTED: internal status, no DB notification (handled by SKIP_DB_EVENTS in workflowEventService)
    if (status === 'ACCEPTED') {
      const evt = isRadio ? WORKFLOW_EVENTS.RADIOLOGY_ACCEPTED : WORKFLOW_EVENTS.LAB_ACCEPTED;
      await WorkflowEventService.emit(evt, {
        orderId: order._id,
        doctorId: order.doctorId,
        patientId: order.patientId,
        patientName: order.patientName,
        uhid: order.uhid,
        testName: order.testName,
        // linkedPath for doctor's dept_responses tab with exact orderId
        linkedPath: `/doctor/dashboard?tab=DEPT_RESPONSES&orderId=${order._id}&patientId=${order.patientId}`,
        targetModule: 'doctor',
      }, order.branchId);
    } else if (status === 'COMPLETED' || status === 'REPORT_UPLOADED') {
      const evt = isRadio ? WORKFLOW_EVENTS.RADIOLOGY_SUBMITTED : WORKFLOW_EVENTS.LAB_SUBMITTED;
      await WorkflowEventService.emit(evt, {
        orderId: order._id,
        doctorId: order.doctorId,
        patientId: order.patientId,
        patientName: order.patientName,
        uhid: order.uhid,
        testName: order.testName,
        reportSummary: order.reportSummary,
        // linkedPath for doctor's dept_responses tab with exact orderId
        linkedPath: `/doctor/dashboard?tab=DEPT_RESPONSES&orderId=${order._id}&patientId=${order.patientId}`,
        targetModule: 'doctor',
      }, order.branchId);
    }

    return order;
  }

  static async uploadReport(orderId, data, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    order.status = 'REPORT_UPLOADED';
    order.completedAt = new Date();
    order.responseSubmittedAt = new Date();
    order.reportSummary = data.reportSummary || 'Investigation scan analyzed and report uploaded.';
    order.technicianName = user?.name || 'Diagnostic Technician';

    if (data.price !== undefined) {
      order.price = Number(data.price) || 0;
    }
    if (data.additionalCharges && Array.isArray(data.additionalCharges)) {
      order.additionalCharges = data.additionalCharges.map((c) => ({
        description: c.description || 'Additional Charge',
        amount: Number(c.amount) || 0,
      }));
    }

    const additionalSum = (order.additionalCharges || []).reduce((sum, item) => sum + (item.amount || 0), 0);
    order.totalDepartmentCharge = (order.price || 0) + additionalSum;
    order.chargeStatus = 'SUBMITTED';

    if (data.attachments && Array.isArray(data.attachments)) {
      data.attachments.forEach((att) => {
        order.attachments.push({
          fileName: att.fileName || 'Diagnostic_Report.pdf',
          fileUrl: att.fileUrl || 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80',
          fileType: att.fileType || 'DICOM_IMAGE',
          uploadedAt: new Date(),
          technicianName: user?.name || 'Technician',
        });
      });
    } else {
      order.attachments.push({
        fileName: `${order.testCategory}_Report_${order.uhid}.pdf`,
        fileUrl: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80',
        fileType: 'REPORT_PDF',
        uploadedAt: new Date(),
        technicianName: user?.name || 'Technician',
      });
    }

    order.timeline.push({
      status: 'REPORT_UPLOADED',
      timestamp: new Date(),
      updatedBy: user?.name || 'Technician',
      notes: `Report and diagnostic findings uploaded by ${user?.name || 'Technician'}`,
    });

    await order.save();

    // Broadcast report ready event
    const reportPayload = {
      orderId: order._id,
      patientId: order.patientId,
      patientName: order.patientName,
      uhid: order.uhid,
      testName: order.testName,
      status: order.status,
      reportSummary: order.reportSummary,
      attachments: order.attachments,
    };

    if (order.doctorId) {
      socketManager.emitToUser(String(order.doctorId), 'diagnostics:report_ready', reportPayload);
      socketManager.emitToUser(String(order.doctorId), 'investigation:status_updated', reportPayload);
    }
    // A report upload is itself the completed department handoff. Do not make
    // the doctor's notification depend on a second status request succeeding.
    const isRadio = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(order.testCategory);
    await WorkflowEventService.emit(
      isRadio ? WORKFLOW_EVENTS.RADIOLOGY_SUBMITTED : WORKFLOW_EVENTS.LAB_SUBMITTED,
      {
        ...reportPayload,
        doctorId: order.doctorId,
        linkedPath: `/doctor/dashboard?tab=DEPT_RESPONSES&orderId=${order._id}&patientId=${order.patientId}`,
      },
      order.branchId,
    );

    return order;
  }

  static async getOrders(query = {}, user) {
    const filter = {};
    if (user?.role === 'SUPER_ADMIN') {
      if (query.hospitalId && query.hospitalId !== 'ALL') {
        filter.hospitalId = query.hospitalId;
      } else if (query.all !== 'true' && user._hospitalContextApplied && user.hospitalId) {
        filter.hospitalId = user.hospitalId;
      }
    } else {
      filter.hospitalId = requireHospitalContext(user);
    }

    if (query.testCategory) {
      if (query.testCategory === 'RADIOLOGY') {
        filter.testCategory = { $in: ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'] };
      } else if (query.testCategory === 'PATHOLOGY') {
        filter.testCategory = { $in: ['LABORATORY', 'BLOOD_TEST', 'URINE_ANALYSIS', 'URINE_TEST', 'CULTURE_TEST', 'BIOPSY', 'PATHOLOGY'] };
      } else if (query.testCategory === 'CARDIOLOGY') {
        filter.testCategory = { $in: ['ECG', 'ECHO', 'EEG', 'PFT', 'CARDIOLOGY'] };
      } else {
        filter.testCategory = query.testCategory;
      }
    }

    if (query.patientId) {
      filter.patientId = query.patientId;
    }

    if (query.status) {
      filter.status = query.status;
    }

    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 200, 1), 500);
    return await DiagnosticOrder.find(filter).sort({ createdAt: -1 }).limit(limit).lean({ getters: true });
  }

  static async updateDepartmentCharge(orderId, data, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    if (data.price !== undefined) {
      order.price = Number(data.price) || 0;
    }
    if (data.additionalCharges && Array.isArray(data.additionalCharges)) {
      order.additionalCharges = data.additionalCharges.map((c) => ({
        description: c.description || 'Additional Charge',
        amount: Number(c.amount) || 0,
      }));
    }

    const additionalSum = (order.additionalCharges || []).reduce((sum, item) => sum + (item.amount || 0), 0);
    order.totalDepartmentCharge = order.price + additionalSum;
    order.chargeStatus = 'SUBMITTED';
    const resolvedBillingQuery = order.billingQuery && !order.billingQuery.resolved;
    if (resolvedBillingQuery) {
      order.billingQuery.resolved = true;
      order.timeline.push({
        status: order.status,
        timestamp: new Date(),
        updatedBy: user?.name || 'Department Specialist',
        notes: 'Billing query resolved and corrected charge resubmitted.',
      });
    }

    await order.save();

    if (resolvedBillingQuery) {
      const { NotificationService } = await import('../notifications/notification.service.js');
      const invoiceId = order.billingQuery.invoiceId;

      if (invoiceId) {
        try {
          const { Invoice } = await import('../../models/Invoice.js');
          const inv = await Invoice.findOne({ _id: invoiceId, hospitalId: order.hospitalId });
          if (inv && inv.status !== 'PAID' && !inv.isDeleted) {
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
            const cat = catMap[order.testCategory] || 'OTHER';
            const orderRef = String(order._id);
            let found = false;
            (inv.items || []).forEach((item) => {
              if (item.sourceRef === orderRef || (item.description && item.description.includes(order.testName))) {
                item.unitPrice = order.totalDepartmentCharge;
                item.totalPrice = order.totalDepartmentCharge;
                item.sourceRef = orderRef;
                found = true;
              }
            });
            if (!found) {
              inv.items.push({
                description: `[${order.testCategory}] ${order.testName} (${user?.name || 'Department'})`,
                sourceRef: orderRef,
                category: cat,
                qty: 1,
                unitPrice: order.totalDepartmentCharge,
                totalPrice: order.totalDepartmentCharge,
              });
            }
            inv.subtotal = inv.items.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0);
            inv.grandTotal = Math.max(0, inv.subtotal - (Number(inv.discountAmount) || 0));
            inv.balanceAmount = Math.max(0, inv.grandTotal - (Number(inv.paidAmount) || 0));
            await inv.save();
            socketManager.emitToBranch(inv.branchId || order.branchId, 'billing:invoice_updated', {
              invoiceId: inv._id,
              patientId: inv.patientId,
            });
          }
        } catch (invErr) {
          console.error('Failed to update invoice with corrected diagnostic charge:', invErr);
        }
      }

      await NotificationService.createNotification({
        hospitalId: order.hospitalId,
        branchId: order.branchId,
        recipientRoles: ['CASHIER', 'BILLING_STAFF'],
        targetModule: 'billing',
        type: 'DEPARTMENT_RESPONSE',
        notificationType: 'DEPARTMENT_RESPONSE',
        title: `Corrected diagnostic charge: ${order.patientName}`,
        message: `${order.testName} charge was corrected and resubmitted by ${user?.name || 'the department'}.`,
        targetRoute: `/billing/dashboard?invoiceId=${invoiceId}&tab=CENTRAL_DESK`,
        relatedPatientId: order.patientId,
        sourceModule: order.billingQuery.targetDepartment?.toLowerCase() || 'diagnostics',
        entityType: 'INVOICE',
        entityId: invoiceId,
        actionType: 'REVIEW_DEPARTMENT_RESPONSE',
        metadata: { invoiceId, orderId: order._id, patientId: order.patientId, tab: 'CENTRAL_DESK' },
      });
    }

    socketManager.emitToBranch(order.branchId, 'investigation:status_updated', {
      orderId: order._id,
      patientId: order.patientId,
      status: order.status,
      chargeStatus: order.chargeStatus,
      totalDepartmentCharge: order.totalDepartmentCharge,
    });

    return order;
  }

  static async cancelInvestigation(orderId, cancellationReason, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    if (!cancellationReason || !cancellationReason.trim()) {
      throw new ApiError(400, 'A mandatory cancellation reason must be provided.', null, 'CANCELLATION_REASON_REQUIRED');
    }

    order.status = 'COMPLETED';
    order.chargeStatus = 'CANCELLED';
    order.cancellationReason = cancellationReason.trim();
    order.timeline.push({
      status: 'CANCELLED',
      timestamp: new Date(),
      updatedBy: user?.name || 'Doctor',
      notes: `Order cancelled by Dr. ${user?.name || 'Doctor'}. Reason: ${cancellationReason.trim()}`,
    });

    await order.save();

    socketManager.emitToBranch(order.branchId, 'investigation:status_updated', {
      orderId: order._id,
      patientId: order.patientId,
      status: order.status,
      chargeStatus: order.chargeStatus,
      cancellationReason: order.cancellationReason,
    });

    return order;
  }

  static async requestCorrection(orderId, correctionNote, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    if (!correctionNote || !correctionNote.trim()) {
      throw new ApiError(400, 'A correction note must be provided when returning to department.', null, 'CORRECTION_NOTE_REQUIRED');
    }

    order.chargeStatus = 'CORRECTION_REQUESTED';
    order.correctionNote = correctionNote.trim();
    order.status = 'IN_PROGRESS';
    order.timeline.push({
      status: 'CORRECTION_REQUESTED',
      timestamp: new Date(),
      updatedBy: user?.name || 'Doctor',
      notes: `Correction requested by Dr. ${user?.name || 'Doctor'}: ${correctionNote.trim()}`,
    });

    await order.save();

    socketManager.emitToBranch(order.branchId, 'investigation:status_updated', {
      orderId: order._id,
      patientId: order.patientId,
      status: order.status,
      chargeStatus: order.chargeStatus,
      correctionNote: order.correctionNote,
    });

    return order;
  }

  static async approveCharge(orderId, user) {
    const hospitalId = requireHospitalContext(user);
    const order = await DiagnosticOrder.findOne({ _id: orderId, hospitalId });
    if (!order) {
      throw new ApiError(404, 'Investigation order not found', null, 'NOT_FOUND');
    }

    if (!['REPORT_UPLOADED', 'COMPLETED', 'REVIEWED'].includes(order.status)) {
      throw new ApiError(409, 'The department response is not ready for doctor review', null, 'RESPONSE_NOT_READY');
    }

    order.chargeStatus = 'APPROVED';
    order.status = 'REVIEWED';
    order.reviewedAt = new Date();
    order.reviewedBy = user?.id || user?._id;
    order.timeline.push({
      status: 'REVIEWED',
      timestamp: order.reviewedAt,
      updatedBy: user?.name || 'Doctor',
      notes: 'Department response reviewed and accepted by doctor',
    });
    await order.save();
    socketManager.emitToBranch(order.branchId, 'workflow:pending_changed', { resourceId: order._id, chargeStatus: order.chargeStatus });

    socketManager.emitToBranch(order.branchId, 'investigation:status_updated', {
      orderId: order._id,
      patientId: order.patientId,
      chargeStatus: order.chargeStatus,
      status: order.status,
      reviewedAt: order.reviewedAt,
    });

    const isRadio = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(order.testCategory);
    await WorkflowEventService.emit(
      isRadio ? WORKFLOW_EVENTS.DOCTOR_REVIEWED_RADIOLOGY : WORKFLOW_EVENTS.DOCTOR_REVIEWED_LAB,
      {
        orderId: order._id,
        doctorName: user?.name || 'Doctor',
        patientName: order.patientName,
        testName: order.testName,
        linkedPath: isRadio ? '/radiology/dashboard?tab=COMPLETED' : '/laboratory/dashboard?tab=COMPLETED',
      },
      order.branchId,
    );

    // Auto-complete active review notifications for this order
    const { Notification } = await import('../../models/Notification.js');
    const notifs = await Notification.find({
      hospitalId,
      $or: [
        { relatedTaskId: String(orderId) },
        { entityId: String(orderId) },
        { 'metadata.orderId': String(orderId) },
      ],
      isCompleted: { $ne: true },
    }).lean();

    if (notifs.length > 0) {
      const ids = notifs.map((n) => n._id);
      await Notification.updateMany(
        { _id: { $in: ids } },
        { $set: { isCompleted: true, completedAt: new Date(), status: 'COMPLETED', isRead: true, readAt: new Date() } }
      );
      notifs.forEach((n) => {
        if (n.recipientUserId) {
          socketManager.emitToUser(String(n.recipientUserId), 'notification:completed', { notificationId: n._id });
          socketManager.emitToUser(String(n.recipientUserId), 'notification:read', { notificationId: n._id });
        }
      });
    }

    return order;
  }

  static async getPatientReports(patientId, user) {
    return await DiagnosticOrder.find({ patientId }).sort({ createdAt: -1 }).lean({ getters: true });
  }
}
