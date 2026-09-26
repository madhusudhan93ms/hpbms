import { Invoice } from '../../models/Invoice.js';
import { Receipt } from '../../models/Receipt.js';
import { Patient } from '../../models/Patient.js';
import { Consultation } from '../../models/Consultation.js';
import { Notification } from '../../models/Notification.js';
import { PAYMENT_STATUS } from '../../config/constants.js';
import { ApiError } from '../../utils/apiError.js';
import { socketManager } from '../../events/socketManager.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { requireHospitalContext } from '../../utils/tenantContext.js';

export class BillingService {
  /**
   * Called by cashier dashboard: fetch all UNPAID invoices with
   * full patient + consultation context already populated.
   */
  static async getUnpaidInvoices(user) {
    const hospitalId = requireHospitalContext(user);

    const invoices = await Invoice.find({
      hospitalId,
      status: { $in: [PAYMENT_STATUS.UNPAID, PAYMENT_STATUS.PARTIALLY_PAID] },
      isDeleted: { $ne: true },
      $or: [
        { doctorReviewQuery: null },
        { doctorReviewQuery: { $exists: false } },
        { 'doctorReviewQuery.query': '' },
        { 'doctorReviewQuery.query': { $in: ['', null] } },
        { 'doctorReviewQuery.query': { $exists: false } },
        { 'doctorReviewQuery.resolved': true },
        { 'doctorReviewQuery.resolved': { $ne: false } },
      ],
    })
      .populate('patientId', 'firstName lastName uhid phone age gender')
      .populate('doctorId', 'name specialization cabinNo')
      .populate({
        path: 'consultationId',
        populate: { path: 'doctorId', select: 'name specialization cabinNo' },
      })
      .sort({ createdAt: 1 });

    // For any legacy invoices without an explicit consultationId reference, batch lookup consultations in one query
    const missingPatientIds = invoices
      .filter((inv) => !inv.consultationId && (inv.patientId?._id || inv.patientId))
      .map((inv) => inv.patientId._id || inv.patientId);

    const fallbackConsultationMap = new Map();
    if (missingPatientIds.length > 0) {
      const fallbackConsultations = await Consultation.find({
        hospitalId,
        patientId: { $in: missingPatientIds },
      })
        .populate('doctorId', 'name specialization cabinNo')
        .sort({ createdAt: -1 });

      for (const c of fallbackConsultations) {
        const key = String(c.patientId?._id || c.patientId);
        if (!fallbackConsultationMap.has(key)) {
          fallbackConsultationMap.set(key, c);
        }
      }
    }

    return invoices.map((inv) => {
      let consultation = inv.consultationId || null;
      if (!consultation && inv.patientId) {
        const key = String(inv.patientId._id || inv.patientId);
        consultation = fallbackConsultationMap.get(key) || null;
      }

      if (consultation && typeof consultation.toObject === 'function') {
        consultation = consultation.toObject();
      }

      return {
        ...inv.toObject(),
        consultation: consultation || null,
      };
    });
  }

  /**
   * Manually create an invoice (used when no doctor consultation exists).
   */
  static async createInvoice(data, user) {
    const hospitalId = requireHospitalContext(user);
    const patient = await Patient.findOne({ _id: data.patientId, hospitalId });
    if (!patient) {
      throw new ApiError(404, 'Patient record not found for billing', null, 'NOT_FOUND');
    }

    // Collision-proof invoice number generation (same pattern as UHID)
    const year = new Date().getFullYear();
    let seqNum = await Invoice.countDocuments({ hospitalId: user.hospitalId }) + 1;
    let invoiceNo = `INV-${year}-${String(seqNum).padStart(5, '0')}`;
    let existing = await Invoice.findOne({ hospitalId: user.hospitalId, invoiceNo });
    while (existing) {
      seqNum++;
      invoiceNo = `INV-${year}-${String(seqNum).padStart(5, '0')}`;
      existing = await Invoice.findOne({ hospitalId: user.hospitalId, invoiceNo });
    }

    const items = data.items || [
      { description: 'OPD Consultation Fee', category: 'CONSULTATION', qty: 1, unitPrice: 100.0, totalPrice: 100.0 },
    ];

    const subtotal = items.reduce((acc, item) => acc + item.totalPrice, 0);
    const discountAmount = data.discountAmount || 0;
    const grandTotal = Math.max(0, subtotal - discountAmount);

    const invoice = await Invoice.create({
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      patientId: patient._id,
      invoiceNo,
      items,
      subtotal,
      discountAmount,
      grandTotal,
      paidAmount: 0,
      balanceAmount: grandTotal,
      status: PAYMENT_STATUS.UNPAID,
    });

    const billingPayload = {
      invoiceId: invoice._id,
      invoiceNo: invoice.invoiceNo,
      patientId: patient._id,
      patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Patient',
      uhid: patient.uhid || 'N/A',
      grandTotal: invoice.grandTotal,
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      linkedPath: `/billing/dashboard?tab=CENTRAL_DESK&invoiceId=${invoice._id}`,
    };
    socketManager.emitToBranch(user.branchId, 'billing:invoice_created', billingPayload);
    if (user.hospitalId) {
      socketManager.emitToHospital(user.hospitalId, 'billing:invoice_created', billingPayload);
    }
    socketManager.emitToRole('CASHIER', 'billing:invoice_created', billingPayload);
    socketManager.emitToRole('BILLING_STAFF', 'billing:invoice_created', billingPayload);

    return await Invoice.findById(invoice._id).populate('patientId');
  }

  static async processPayment(data, user) {
    const hospitalId = requireHospitalContext(user);
    const invoice = await Invoice.findOne({ _id: data.invoiceId, hospitalId }).populate('patientId');
    if (!invoice) {
      throw new ApiError(404, 'Invoice record not found', null, 'NOT_FOUND');
    }
    if (invoice.doctorReviewQuery?.query && invoice.doctorReviewQuery.resolved === false) {
      throw new ApiError(409, 'This invoice is awaiting the attending doctor response.', null, 'DOCTOR_REVIEW_PENDING');
    }

    const amountPaid = Number(data.amountPaid);
    if (isNaN(amountPaid) || amountPaid <= 0) {
      throw new ApiError(400, 'Valid payment amount is required', null, 'INVALID_AMOUNT');
    }
    if (amountPaid > Number(invoice.balanceAmount || 0)) {
      throw new ApiError(400, 'Payment cannot exceed the outstanding invoice balance.', null, 'OVERPAYMENT_NOT_ALLOWED');
    }

    // Handle Split / Multi-Tender Payments
    let finalSplitPayments = [];
    let isSplit = data.paymentMode === 'SPLIT' || (Array.isArray(data.splitPayments) && data.splitPayments.length > 0);

    if (Array.isArray(data.splitPayments) && data.splitPayments.length > 0) {
      finalSplitPayments = data.splitPayments
        .filter((s) => s && Number(s.amount) > 0)
        .map((s) => ({
          mode: s.mode || 'CASH',
          amount: Number(s.amount),
          reference: s.reference ? String(s.reference).trim() : '',
          notes: s.notes ? String(s.notes).trim() : '',
        }));

      if (finalSplitPayments.length > 0) {
        const splitSum = finalSplitPayments.reduce((acc, cur) => acc + cur.amount, 0);
        if (Math.abs(splitSum - amountPaid) > 0.01) {
          throw new ApiError(
            400,
            `Split payments total (₹${splitSum.toFixed(2)}) must equal the amount paid (₹${amountPaid.toFixed(2)}).`,
            null,
            'SPLIT_AMOUNT_MISMATCH'
          );
        }
        isSplit = true;
      }
    }

    let primaryMode = isSplit ? 'SPLIT' : (data.paymentMode || 'CARD');
    let autoRemarks = data.remarks || 'Payment collected successfully';
    if (isSplit && finalSplitPayments.length > 0) {
      const splitSummary = finalSplitPayments
        .map((s) => `${s.mode}: ₹${s.amount.toFixed(2)}${s.reference ? ` (${s.reference})` : ''}`)
        .join(', ');
      autoRemarks = data.remarks
        ? `${data.remarks} | Split Breakdown: ${splitSummary}`
        : `Split: ${splitSummary}`;
    }

    // Collision-proof receipt number generation
    const rcYear = new Date().getFullYear();
    let rcSeq = (await Receipt.countDocuments({ hospitalId: user.hospitalId })) + 1;
    let receiptNo = `REC-${rcYear}-${String(rcSeq).padStart(5, '0')}`;
    let rcExisting = await Receipt.findOne({ hospitalId: user.hospitalId, receiptNo });
    while (rcExisting) {
      rcSeq++;
      receiptNo = `REC-${rcYear}-${String(rcSeq).padStart(5, '0')}`;
      rcExisting = await Receipt.findOne({ hospitalId: user.hospitalId, receiptNo });
    }

    const receipt = await Receipt.create({
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      invoiceId: invoice._id,
      patientId: invoice.patientId._id,
      cashierId: user.id,
      receiptNo,
      amountPaid,
      paymentMode: primaryMode,
      splitPayments: finalSplitPayments,
      transactionRef: data.transactionRef || (isSplit ? 'TXN-SPLIT-MULTI' : 'TXN-COUNTER'),
      remarks: autoRemarks,
      followUpDate: invoice.followUpDate || null,
    });

    invoice.paidAmount += amountPaid;
    invoice.balanceAmount = Math.max(0, invoice.grandTotal - invoice.paidAmount);

    if (invoice.balanceAmount === 0) {
      invoice.status = PAYMENT_STATUS.PAID;
    } else {
      invoice.status = PAYMENT_STATUS.PARTIALLY_PAID;
    }

    await invoice.save();
    socketManager.emitToBranch(invoice.branchId, 'workflow:pending_changed', { resourceId: invoice._id, status: invoice.status });

    if (invoice.status === PAYMENT_STATUS.PAID) {
      const { NotificationService } = await import('../notifications/notification.service.js');
      const { NurseTask } = await import('../../models/NurseTask.js');
      await NurseTask.updateMany(
        {
          hospitalId,
          patientId: invoice.patientId?._id || invoice.patientId,
          doctorReviewedAt: null,
        },
        { $set: { doctorReviewedAt: new Date() } }
      ).catch(() => {});
      await NotificationService.completeEntityTasks({
        hospitalId,
        entityType: 'Invoice',
        entityId: invoice._id,
        relatedPatientId: invoice.patientId?._id || invoice.patientId,
        targetModule: 'doctor',
      });
      await Notification.updateMany(
        {
          hospitalId,
          $or: [
            { entityId: String(invoice._id) },
            { relatedTaskId: String(invoice._id) },
            { relatedPatientId: invoice.patientId?._id || invoice.patientId },
            { 'metadata.invoiceId': String(invoice._id) },
            { targetModule: 'billing', relatedPatientId: invoice.patientId?._id || invoice.patientId },
            { targetModule: 'doctor', relatedPatientId: invoice.patientId?._id || invoice.patientId },
          ],
        },
        { $set: { isCompleted: true, completedAt: new Date(), isRead: true, readAt: new Date(), status: 'COMPLETED' } }
      ).catch(() => {});

      const patientName = `${invoice.patientId?.firstName || ''} ${invoice.patientId?.lastName || ''}`.trim() || 'Patient';
      const paymentPayload = {
        hospitalId: invoice.hospitalId,
        invoiceId: invoice._id,
        invoiceNo: invoice.invoiceNo,
        receiptId: receipt._id,
        patientId: invoice.patientId?._id || invoice.patientId,
        patientName,
        uhid: invoice.patientId?.uhid || 'N/A',
        receiptNo: receipt.receiptNo,
        linkedPath: `/billing/dashboard?tab=RECEIPTS&receiptId=${receipt._id}&patientId=${invoice.patientId?._id || invoice.patientId}`,
      };
      await WorkflowEventService.emit(WORKFLOW_EVENTS.PAYMENT_COLLECTED, paymentPayload, invoice.branchId).catch(() => {});
      socketManager.emitToBranch(invoice.branchId, 'billing:payment_collected', paymentPayload);
      socketManager.emitToBranch(invoice.branchId, 'workflow:notification_cleared', { targetModule: 'billing', patientId: invoice.patientId });
      socketManager.emitToBranch(invoice.branchId, 'workflow:pending_changed', { invoiceId: invoice._id });
    }

    const populatedReceipt = await Receipt.findById(receipt._id)
      .populate('hospitalId', 'name code domain address contactPhone contactEmail logo')
      .populate({
        path: 'invoiceId',
        populate: [
          { path: 'patientId' },
          { path: 'doctorId', select: 'name specialization cabinNo' },
        ],
      })
      .populate('patientId')
      .populate('cashierId', 'name email role');

    return {
      receipt: populatedReceipt || receipt,
      invoice,
    };
  }

  static async getInvoices(user) {
    const query = { isDeleted: { $ne: true } };
    if (user.branchId) query.branchId = user.branchId;
    else if (user.hospitalId) query.hospitalId = user.hospitalId;

    // Find all patient IDs with pending pharmacy dispense in this hospital
    const { Prescription } = await import('../../models/Prescription.js');
    const rxQuery = { dispenseStatus: { $in: ['PENDING_DISPENSE', 'PARTIALLY_DISPENSED'] } };
    if (user.branchId) rxQuery.branchId = user.branchId;
    else if (user.hospitalId) rxQuery.hospitalId = user.hospitalId;
    const pendingPrescriptions = await Prescription.find(rxQuery).select('patientId').lean().catch(() => []);
    const pendingPatientIds = new Set(pendingPrescriptions.map(p => String(p.patientId?._id || p.patientId)));

    const invoices = await Invoice.find(query)
      .populate('patientId')
      .populate('hospitalId', 'name code domain address contactPhone contactEmail logo')
      .sort({ createdAt: -1 });

    // Exclude invoices for patients whose pharmacy dispensing is still in progress
    return invoices.filter((inv) => !pendingPatientIds.has(String(inv.patientId?._id || inv.patientId)));
  }

  static async getDoctorReviewQueries(user) {
    const doctorId = user?.id || user?._id;
    if (!doctorId) throw new ApiError(401, 'Authenticated doctor is required');
    const hospitalId = requireHospitalContext(user);

    const query = {
      hospitalId,
      'doctorReviewQuery.attendingDoctorId': doctorId,
      'doctorReviewQuery.resolved': false,
      isDeleted: { $ne: true },
    };
    if (user.branchId) query.branchId = user.branchId;

    return Invoice.find(query)
      .populate('patientId', 'firstName lastName uhid phone age gender')
      .populate('doctorId', 'name specialization')
      .populate('consultationId', 'chiefComplaints vitals prescriptions consultationFee doctorProcedureCharges')
      .sort({ 'doctorReviewQuery.requestedAt': -1 })
      .lean();
  }

  static async respondToDoctorReviewQuery(invoiceId, data, user) {
    const hospitalId = requireHospitalContext(user);
    const doctorId = user?.id || user?._id;
    const invoice = await Invoice.findOne({ _id: invoiceId, hospitalId, isDeleted: { $ne: true } });
    if (!invoice) throw new ApiError(404, 'Invoice not found', null, 'NOT_FOUND');
    const query = invoice.doctorReviewQuery;
    if (!query?.query || query.resolved) {
      throw new ApiError(409, 'This billing query is no longer pending.', null, 'BILLING_QUERY_NOT_PENDING');
    }
    if (String(query.attendingDoctorId || '') !== String(doctorId || '')) {
      throw new ApiError(403, 'Only the attending doctor can resolve this billing query.', null, 'NOT_ATTENDING_DOCTOR');
    }

    if (data.consultationFee !== undefined && data.consultationFee !== null && data.consultationFee !== '') {
      const fee = Number(data.consultationFee);
      if (!Number.isFinite(fee) || fee < 0) throw new ApiError(400, 'Consultation fee must be a non-negative amount.', null, 'INVALID_AMOUNT');
      let line = invoice.items.find((item) => 
        item.category === 'CONSULTATION' || (item.description && item.description.toLowerCase().includes('consultation'))
      );
      if (!line) {
        line = { description: 'OPD Consultation Fee', category: 'CONSULTATION', qty: 1, unitPrice: fee, totalPrice: fee };
        invoice.items.unshift(line);
      } else {
        line.unitPrice = fee;
        line.totalPrice = fee * (Number(line.qty) || 1);
      }
    }

    invoice.subtotal = invoice.items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
    invoice.grandTotal = Math.max(0, invoice.subtotal - (Number(invoice.discountAmount) || 0));
    invoice.balanceAmount = Math.max(0, invoice.grandTotal - (Number(invoice.paidAmount) || 0));
    invoice.doctorReviewQuery.resolved = true;
    invoice.doctorReviewQuery.resolvedAt = new Date();
    invoice.doctorReviewQuery.resolvedByDoctorId = doctorId;
    invoice.doctorReviewQuery.responseNote = String(data.responseNote || 'Reviewed and confirmed by the attending doctor.').trim();
    await invoice.save();

    const { Prescription } = await import('../../models/Prescription.js');
    await Prescription.updateMany(
      { hospitalId, $or: [{ 'billingQuery.invoiceId': invoice._id }, { patientId: invoice.patientId, 'billingQuery.resolved': false }] },
      { $set: { 'billingQuery.resolved': true, 'billingQuery.resolvedAt': new Date(), 'billingQuery.resolvedByDoctorId': doctorId, dispenseStatus: 'DISPENSED' } },
    );
    const { Appointment } = await import('../../models/Appointment.js');
    const { NurseTask } = await import('../../models/NurseTask.js');
    await NurseTask.updateMany(
      {
        hospitalId,
        $or: [
          ...(query.appointmentId ? [{ appointmentId: query.appointmentId }] : []),
          { patientId: invoice.patientId },
        ],
        doctorReviewedAt: null,
      },
      { $set: { doctorReviewedAt: new Date() } }
    ).catch(() => {});
    if (query.appointmentId) {
      await Appointment.updateOne(
        { _id: query.appointmentId, hospitalId },
        { $set: { status: 'COMPLETED', departmentReturnedAt: new Date() } },
      );
    }
    const { NotificationService } = await import('../notifications/notification.service.js');
    await NotificationService.completeEntityTasks({
      hospitalId,
      entityId: invoice._id,
      relatedPatientId: invoice.patientId,
      targetModule: 'doctor',
    });
    if (query.appointmentId) {
      await NotificationService.completeEntityTasks({
        hospitalId,
        entityId: query.appointmentId,
        relatedPatientId: invoice.patientId,
        targetModule: 'doctor',
      });
    }
    await Notification.updateMany(
      {
        hospitalId,
        $or: [
          { recipientUserId: doctorId },
          { targetModule: 'doctor' },
        ],
        entityId: { $in: [String(invoice._id), invoice._id] },
      },
      { $set: { isRead: true, readAt: new Date(), isCompleted: true, completedAt: new Date(), status: 'COMPLETED' } },
    );

    if (query.requestedBy) {
      const { NotificationService } = await import('../notifications/notification.service.js');
      await NotificationService.createNotification({
        hospitalId,
        branchId: invoice.branchId,
        recipientUserId: query.requestedBy,
        recipientRole: 'CASHIER',
        title: `Doctor responded to billing query: ${invoice.invoiceNo}`,
        message: invoice.doctorReviewQuery.responseNote,
        notificationType: 'DEPARTMENT_RESPONSE',
        sourceModule: 'doctor',
        targetModule: 'billing',
        entityType: 'Invoice',
        entityId: invoice._id,
        actionType: 'COLLECT_PAYMENT',
        targetRoute: `/billing/dashboard?tab=CENTRAL_DESK&invoiceId=${invoice._id}&patientId=${invoice.patientId}`,
        relatedPatientId: invoice.patientId,
        relatedTaskId: String(invoice._id),
      });
    }

    socketManager.emitToBranch(invoice.branchId, 'billing:invoice_updated', {
      invoiceId: invoice._id,
      patientId: invoice.patientId,
    });
    socketManager.emitToBranch(invoice.branchId, 'workflow:pending_changed', { invoiceId: invoice._id });
    socketManager.emitToBranch(invoice.branchId, 'doctor:billing_query_response', { invoiceId: invoice._id });
    if (query.requestedBy) {
      socketManager.emitToUser(String(query.requestedBy), 'billing:invoice_updated', {
        invoiceId: invoice._id,
        patientId: invoice.patientId,
      });
      socketManager.emitToUser(String(query.requestedBy), 'workflow:pending_changed', { invoiceId: invoice._id });
      socketManager.emitToUser(String(query.requestedBy), 'doctor:billing_query_response', { invoiceId: invoice._id });
    }

    return invoice;
  }

  static async getReceipts(user, queryParams = {}) {
    const query = { isDeleted: { $ne: true } };
    if (user?.role === 'SUPER_ADMIN') {
      if (queryParams.all === 'true' || queryParams.hospitalId === 'ALL') {
        // No hospitalId restriction — return all receipts across all hospitals
      } else if (queryParams.hospitalId) {
        query.hospitalId = queryParams.hospitalId;
      } else if (user._hospitalContextApplied && user.hospitalId) {
        query.hospitalId = user.hospitalId;
      }
    } else {
      if (user.branchId) query.branchId = user.branchId;
      else if (user.hospitalId) query.hospitalId = user.hospitalId;
    }

    const receipts = await Receipt.find(query)
      .populate('hospitalId', 'name code domain address contactPhone contactEmail logo')
      .populate({
        path: 'invoiceId',
        populate: [
          { path: 'patientId' },
          { path: 'doctorId', select: 'name specialization cabinNo' },
        ],
      })
      .populate('patientId')
      .populate('cashierId', 'name email role')
      .sort({ createdAt: -1 });

    const enriched = await Promise.all(
      receipts.map(async (rc) => {
        const rcObj = rc.toObject();
        if (rcObj.invoiceId && !rcObj.invoiceId.doctorId && rcObj.invoiceId.patientId) {
          const consult = await Consultation.findOne({ patientId: rcObj.invoiceId.patientId._id || rcObj.invoiceId.patientId })
            .populate('doctorId', 'name specialization cabinNo')
            .sort({ createdAt: -1 });
          if (consult) {
            rcObj.invoiceId.consultation = consult.toObject();
          }
        }
        return rcObj;
      })
    );

    return enriched;
  }

  /**
   * Fetch all voided/deleted bills for the hospital (both voided receipts and cancelled invoices)
   */
  static async getDeletedReceipts(user) {
    const query = { isDeleted: true };
    if (user?.role === 'SUPER_ADMIN') {
      if (user._hospitalContextApplied && user.hospitalId) {
        query.hospitalId = user.hospitalId;
      }
    } else {
      if (user?.branchId) query.branchId = user.branchId;
      else if (user?.hospitalId) query.hospitalId = user.hospitalId;
    }

    const [deletedReceipts, deletedInvoices] = await Promise.all([
      Receipt.find(query)
        .populate('hospitalId', 'name code domain address contactPhone contactEmail logo')
        .populate({
          path: 'invoiceId',
          populate: [
            { path: 'patientId' },
            { path: 'doctorId', select: 'name specialization cabinNo' },
          ],
        })
        .populate('patientId')
        .populate('cashierId', 'name email role')
        .populate('deletedBy', 'name email role')
        .sort({ deletedAt: -1, updatedAt: -1 })
        .lean(),
      Invoice.find(query)
        .populate('hospitalId', 'name code domain address contactPhone contactEmail logo')
        .populate('patientId')
        .populate('doctorId', 'name specialization cabinNo email')
        .populate('deletedBy', 'name email role')
        .sort({ deletedAt: -1, updatedAt: -1 })
        .lean(),
    ]);

    // Track invoice IDs that already have a deleted receipt entry to prevent duplicate cards
    const seenInvoiceIds = new Set(
      deletedReceipts
        .map((r) => String(r.invoiceId?._id || r.invoiceId || ''))
        .filter(Boolean)
    );

    // Format deleted invoices that do not have a deleted receipt (cancelled before payment)
    const formattedDeletedInvoices = deletedInvoices
      .filter((inv) => !seenInvoiceIds.has(String(inv._id)))
      .map((inv) => ({
        _id: inv._id,
        receiptNo: `BILL-${inv.invoiceNo}`,
        invoiceNo: inv.invoiceNo,
        invoiceId: {
          _id: inv._id,
          invoiceNo: inv.invoiceNo,
          patientId: inv.patientId,
          doctorId: inv.doctorId,
          doctorName: inv.doctorName || inv.doctorId?.name || '',
          items: inv.items || [],
          grandTotal: inv.grandTotal,
          balanceAmount: inv.balanceAmount,
          subtotal: inv.subtotal,
        },
        patientId: inv.patientId,
        doctorId: inv.doctorId,
        cashierId: inv.deletedBy ? { _id: inv.deletedBy._id || inv.deletedBy, name: inv.deletedByName || inv.deletedBy.name || 'Staff', email: inv.deletedBy.email || '' } : null,
        amountPaid: inv.grandTotal || inv.subtotal || 0,
        grandTotal: inv.grandTotal || inv.subtotal || 0,
        paymentMode: 'UNPAID / CANCELLED',
        isDeleted: true,
        deletedAt: inv.deletedAt || inv.updatedAt || inv.createdAt,
        deletedBy: inv.deletedBy,
        deletedByName: inv.deletedByName || inv.deletedBy?.name || 'Staff',
        deletionReason: inv.deletionReason || 'Cancelled while billing',
        isInvoiceOnly: true,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      }));

    const combined = [...deletedReceipts, ...formattedDeletedInvoices].sort((a, b) => {
      const dateA = new Date(a.deletedAt || a.updatedAt || a.createdAt || 0);
      const dateB = new Date(b.deletedAt || b.updatedAt || b.createdAt || 0);
      return dateB - dateA;
    });

    return combined;
  }

  /**
   * Delete / void a receipt with audit log
   */
  static async deleteReceipt(receiptId, deletionReason, user) {
    const hospitalId = requireHospitalContext(user);
    const reason = (deletionReason && String(deletionReason).trim()) ? String(deletionReason).trim() : 'Voided by cashier / staff';

    const receipt = await Receipt.findOne({ _id: receiptId, hospitalId })
      .populate('patientId')
      .populate('cashierId', 'name email');

    if (!receipt) {
      throw new ApiError(404, 'Receipt record not found', null, 'NOT_FOUND');
    }

    if (receipt.isDeleted) {
      return { success: true, message: 'This receipt has already been deleted.', receipt };
    }

    // Soft delete receipt
    receipt.isDeleted = true;
    receipt.deletedAt = new Date();
    receipt.deletedBy = user?.id || user?._id || null;
    receipt.deletedByName = user?.name || 'Staff';
    receipt.deletionReason = reason;
    await receipt.save();

    // Rollback invoice payment amounts
    let invoice = null;
    if (receipt.invoiceId) {
      invoice = await Invoice.findOne({ _id: receipt.invoiceId, hospitalId });
      if (invoice) {
        invoice.paidAmount = Math.max(0, (invoice.paidAmount || 0) - receipt.amountPaid);
        invoice.balanceAmount = Math.max(0, invoice.grandTotal - invoice.paidAmount);
        if (invoice.balanceAmount > 0) {
          invoice.status = invoice.paidAmount > 0 ? PAYMENT_STATUS.PARTIALLY_PAID : PAYMENT_STATUS.UNPAID;
        }
        invoice.isDeleted = true;
        invoice.deletionReason = reason;
        invoice.deletedAt = new Date();
        invoice.deletedBy = user?.id || user?._id || null;
        await invoice.save();
      }
    }

    // Immutable Audit Log for Hospital Admin
    try {
      const { AuditLog } = await import('../../models/AuditLog.js');
      await AuditLog.create({
        hospitalId: receipt.hospitalId || user?.hospitalId,
        userId: user?.id || user?._id,
        userRole: user?.role || 'CASHIER',
        action: 'BILL_DELETED',
        module: 'BILLING',
        resourceId: String(receipt._id),
        previousState: {
          receiptNo: receipt.receiptNo,
          amountPaid: receipt.amountPaid,
          paymentMode: receipt.paymentMode,
          cashierName: receipt.cashierId?.name || 'Cashier',
          cashierEmail: receipt.cashierId?.email || '',
        },
        newState: {
          isDeleted: true,
          deletedByName: user?.name || 'Staff',
          deletedByRole: user?.role || 'CASHIER',
          deletionReason: reason,
          deletedAt: receipt.deletedAt,
        },
        details: `Receipt #${receipt.receiptNo} of ₹${receipt.amountPaid} originally billed by ${receipt.cashierId?.name || 'Cashier'} was deleted by ${user?.name || 'Staff'} (${user?.role || 'CASHIER'}). Reason: ${reason}`,
      });
    } catch (auditErr) {
      console.error('Failed to write billing deletion audit log:', auditErr);
    }

    // Real-time notification & pending status broadcast
    const targetRoom = receipt.branchId || user?.branchId || receipt.hospitalId || user?.hospitalId;
    if (targetRoom) {
      socketManager.emitToBranch(targetRoom, 'billing:receipt_deleted', {
        receiptId: receipt._id,
        receiptNo: receipt.receiptNo,
        amountPaid: receipt.amountPaid,
        deletedByName: user?.name || 'Staff',
        deletionReason: reason,
      });
      socketManager.emitToBranch(targetRoom, 'workflow:pending_changed', { resourceId: receipt._id });
    }

    return {
      success: true,
      message: `Receipt #${receipt.receiptNo} deleted successfully`,
      receipt,
      invoice,
    };
  }

  /**
   * Cancel / delete a pending unpaid invoice with audit log
   */
  static async deleteInvoice(invoiceId, deletionReason, user) {
    const hospitalId = requireHospitalContext(user);
    const reason = (deletionReason && String(deletionReason).trim()) ? String(deletionReason).trim() : 'Cancelled by cashier / staff';

    const invoice = await Invoice.findOne({ _id: invoiceId, hospitalId })
      .populate('patientId')
      .populate('doctorId', 'name email');

    if (!invoice) {
      throw new ApiError(404, 'Invoice record not found', null, 'NOT_FOUND');
    }

    if (invoice.isDeleted) {
      return { success: true, message: 'This invoice has already been cancelled or deleted.', invoice };
    }

    // Soft delete invoice
    invoice.isDeleted = true;
    invoice.status = PAYMENT_STATUS.CANCELLED || 'CANCELLED';
    invoice.deletedAt = new Date();
    invoice.deletedBy = user?.id || user?._id || null;
    invoice.deletedByName = user?.name || 'Staff';
    invoice.deletionReason = reason;
    await invoice.save();

    // Immutable Audit Log for Hospital Admin
    try {
      const { AuditLog } = await import('../../models/AuditLog.js');
      await AuditLog.create({
        hospitalId: invoice.hospitalId || user?.hospitalId,
        userId: user?.id || user?._id,
        userRole: user?.role || 'CASHIER',
        action: 'INVOICE_CANCELLED',
        module: 'BILLING',
        resourceId: String(invoice._id),
        previousState: {
          invoiceNo: invoice.invoiceNo,
          grandTotal: invoice.grandTotal,
          balanceAmount: invoice.balanceAmount,
          patientName: `${invoice.patientId?.firstName || ''} ${invoice.patientId?.lastName || ''}`.trim(),
        },
        newState: {
          isDeleted: true,
          status: 'CANCELLED',
          deletedByName: user?.name || 'Staff',
          deletedByRole: user?.role || 'CASHIER',
          deletionReason: reason,
          deletedAt: invoice.deletedAt,
        },
        details: `Pending Invoice #${invoice.invoiceNo} (₹${invoice.grandTotal}) for patient ${invoice.patientId?.firstName || ''} was cancelled/deleted by ${user?.name || 'Staff'} (${user?.role || 'CASHIER'}). Reason: ${reason}`,
      });
    } catch (auditErr) {
      console.error('Failed to write invoice deletion audit log:', auditErr);
    }

    // Real-time broadcast
    const targetRoom = invoice.branchId || user?.branchId || invoice.hospitalId || user?.hospitalId;
    if (targetRoom) {
      socketManager.emitToBranch(targetRoom, 'billing:invoice_deleted', {
        invoiceId: invoice._id,
        invoiceNo: invoice.invoiceNo,
        deletedByName: user?.name || 'Staff',
        deletionReason: reason,
      });
      socketManager.emitToBranch(targetRoom, 'workflow:pending_changed', { resourceId: invoice._id });
    }

    return {
      success: true,
      message: `Invoice #${invoice.invoiceNo} cancelled successfully`,
      invoice,
    };
  }

  /**
   * Calculate cumulative accommodation stay charges across all bed/ward transfers
   */
  static async calculateInpatientStayCharges(admissionId, user) {
    const { Admission } = await import('../../models/Admission.js');
    const { BedTransfer } = await import('../../models/BedTransfer.js');

    const hospitalId = requireHospitalContext(user);
    const admission = await Admission.findOne({ _id: admissionId, hospitalId }).populate('patientId');
    if (!admission) {
      throw new ApiError(404, 'Admission record not found', null, 'NOT_FOUND');
    }

    const transfers = await BedTransfer.find({ admissionId: admission._id, hospitalId }).sort({ transferDate: 1 });
    const startTime = new Date(admission.admittedAt || admission.createdAt);
    const endTime = admission.dischargedAt ? new Date(admission.dischargedAt) : new Date();

    const stayItems = [];

    if (transfers.length === 0) {
      const msDiff = Math.max(1000 * 60 * 60, endTime - startTime);
      const days = Math.max(1, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
      const unitPrice = Number(admission.dailyTariff) || 150.0;
      stayItems.push({
        description: `Accommodation: ${admission.targetWardName || 'Ward'} (Bed ${admission.bedNumber})`,
        wardName: admission.targetWardName,
        bedNumber: admission.bedNumber,
        wardType: admission.wardType,
        qty: days,
        unitPrice,
        totalPrice: days * unitPrice,
        fromDate: startTime,
        toDate: endTime,
      });
    } else {
      let currentStart = startTime;
      for (let i = 0; i < transfers.length; i++) {
        const t = transfers[i];
        const legEnd = new Date(t.transferDate);
        const msDiff = Math.max(1000 * 60 * 60, legEnd - currentStart);
        const days = Math.max(1, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
        const unitPrice = Number(t.fromDailyTariff) || 150.0;

        stayItems.push({
          description: `Accommodation: ${t.fromWardName || 'Ward'} (Bed ${t.fromBedNumber})`,
          wardName: t.fromWardName,
          bedNumber: t.fromBedNumber,
          qty: days,
          unitPrice,
          totalPrice: days * unitPrice,
          fromDate: currentStart,
          toDate: legEnd,
        });

        currentStart = legEnd;
      }

      // Final leg from last transfer to endTime
      const lastTransfer = transfers[transfers.length - 1];
      const msDiff = Math.max(1000 * 60 * 60, endTime - currentStart);
      const days = Math.max(1, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
      const unitPrice = Number(lastTransfer.toDailyTariff) || Number(admission.dailyTariff) || 150.0;

      stayItems.push({
        description: `Accommodation: ${lastTransfer.toWardName || admission.targetWardName || 'Ward'} (Bed ${lastTransfer.toBedNumber})`,
        wardName: lastTransfer.toWardName || admission.targetWardName,
        bedNumber: lastTransfer.toBedNumber,
        qty: days,
        unitPrice,
        totalPrice: days * unitPrice,
        fromDate: currentStart,
        toDate: endTime,
      });
    }

    const totalAccommodationCost = stayItems.reduce((acc, item) => acc + item.totalPrice, 0);

    return {
      admissionId: admission._id,
      patient: admission.patientId,
      admissionReference: admission.admissionReference,
      admittedAt: startTime,
      dischargedAt: admission.dischargedAt || null,
      status: admission.status,
      stayItems,
      totalAccommodationCost,
    };
  }

  static async returnInvoiceToDepartment(invoiceId, data, user) {
    const hospitalId = requireHospitalContext(user);
    const targetDepartment = String(data.targetDepartment || 'PHARMACY').toUpperCase();
    const { reason = '', note = '' } = data;
    const allowedDepartments = ['PHARMACY', 'LABORATORY', 'RADIOLOGY', 'DOCTOR'];
    if (!allowedDepartments.includes(targetDepartment)) {
      throw new ApiError(400, 'Unsupported billing return department.', null, 'INVALID_TARGET_DEPARTMENT');
    }
    const queryMessage = note.trim() || reason || 'Returned from Central Billing for review / price correction';

    const invoice = await Invoice.findOne({ _id: invoiceId, hospitalId }).populate('patientId');
    if (!invoice) {
      throw new ApiError(404, 'Invoice not found', null, 'NOT_FOUND');
    }
    if (invoice.status === 'PAID') {
      throw new ApiError(400, 'Cannot return an already settled/paid invoice.', null, 'ALREADY_PAID');
    }

    const patientId = invoice.patientId?._id || invoice.patientId;
    const patientName = `${invoice.patientId?.firstName || ''} ${invoice.patientId?.lastName || ''}`.trim() || 'Patient';
    const uhid = invoice.patientId?.uhid || 'N/A';

    const [{ Prescription }, { NotificationService }, { socketManager }, { Appointment }] = await Promise.all([
      import('../../models/Prescription.js'),
      import('../notifications/notification.service.js'),
      import('../../events/socketManager.js'),
      import('../../models/Appointment.js'),
    ]);

    if (targetDepartment === 'PHARMACY') {
      const rx = await Prescription.findOne({
        patientId,
        hospitalId: invoice.hospitalId,
      }).sort({ createdAt: -1 });

      if (!rx) {
        throw new ApiError(409, 'No prescription is linked to this patient invoice.', null, 'PRESCRIPTION_NOT_FOUND');
      }

      rx.dispenseStatus = 'PENDING_DISPENSE';
      rx.billingQuery = {
          invoiceId: invoice._id,
          query: queryMessage,
          requestedBy: user.id || user._id,
          requestedByName: user.name || 'Cashier',
          requestedAt: new Date(),
          resolved: false,
          targetDepartment: 'PHARMACY',
      };
      await rx.save();

        await Appointment.findOneAndUpdate(
          { patientId, hospitalId: invoice.hospitalId },
          { $set: { status: 'WAITING_PHARMACY' } },
          { sort: { createdAt: -1 } }
        ).catch(() => {});

      // Remove / exclude pharmacy lines from unpaid invoice temporarily
      const nonPharmacyItems = (invoice.items || []).filter((item) => item.category !== 'PHARMACY');
      invoice.items = nonPharmacyItems;
      invoice.subtotal = nonPharmacyItems.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0);
      invoice.totalAmount = Math.max(0, invoice.subtotal - (Number(invoice.discountAmount) || 0) + (Number(invoice.taxAmount) || 0));
      invoice.balanceAmount = Math.max(0, invoice.totalAmount - (Number(invoice.paidAmount) || 0));
      await invoice.save();

      // Notify both supported pharmacy role codes; each alert opens the exact prescription.
      const pharmacyTargetRoute = `/pharmacy/dashboard?prescriptionId=${rx._id}&tab=BILLING_QUERIES`;
      await NotificationService.createNotification({
        hospitalId: invoice.hospitalId,
        branchId: invoice.branchId,
        recipientRoles: ['PHARMACIST', 'PHARMACY_STAFF'],
        targetModule: 'pharmacy',
        notificationType: 'BILLING_QUERY',
        type: 'BILLING_QUERY',
        title: `Billing Query & Return: ${patientName}`,
        message: `Billing Desk returned ${patientName}'s prescription (${uhid}): "${queryMessage}"`,
        targetRoute: pharmacyTargetRoute,
        relatedPatientId: patientId,
        sourceModule: 'billing',
        entityType: 'PRESCRIPTION',
        entityId: rx._id,
        actionType: 'REVIEW_BILLING_QUERY',
        metadata: { invoiceId: invoice._id, prescriptionId: rx._id, patientId, query: queryMessage },
      });

      // Emit real-time events — scoped to branch only (no global broadcast)
      socketManager.emitToBranch(invoice.branchId, 'billing:invoice_updated', {
        invoiceId: invoice._id,
        patientId,
      });
      socketManager.emitToBranch(invoice.branchId, 'workflow:pending_changed', {});

      return {
        success: true,
        message: `Prescription successfully returned to Pharmacy Desk with query: "${queryMessage}"`,
        invoice,
        prescription: rx,
      };
    }

    if (targetDepartment === 'DOCTOR') {
      const rx = await Prescription.findOne({
        patientId,
        hospitalId: invoice.hospitalId,
      }).sort({ createdAt: -1 });

      if (rx) {
        rx.dispenseStatus = 'RETURNED_TO_DOCTOR';
        rx.billingQuery = {
          invoiceId: invoice._id,
          query: queryMessage,
          requestedBy: user.id || user._id,
          requestedByName: user.name || 'Cashier',
          requestedAt: new Date(),
          resolved: false,
          targetDepartment: 'DOCTOR',
        };
        await rx.save();
      }

      // Re-activate Appointment in Doctor's OPD live queue
      const appointment = await Appointment.findOne({
        patientId,
        hospitalId: invoice.hospitalId,
      }).sort({ createdAt: -1 });

      if (appointment) {
        appointment.status = 'WAITING_DEPARTMENT';
        appointment.departmentReturnedAt = new Date();
        await appointment.save();
      }

      // Create high-priority notification for the ATTENDING Doctor only (not all doctors)
      const attendingDoctorId = rx?.doctorId || invoice.doctorId || appointment?.doctorId;
      if (!attendingDoctorId) {
        throw new ApiError(409, 'No attending doctor is assigned to this invoice or patient visit.', null, 'ATTENDING_DOCTOR_NOT_FOUND');
      }

      invoice.doctorReviewQuery = {
        query: queryMessage,
        requestedBy: user.id || user._id,
        requestedByName: user.name || 'Cashier',
        requestedAt: new Date(),
        attendingDoctorId,
        appointmentId: appointment?._id,
        resolved: false,
      };
      await invoice.save();
      const linkedPathWithParams = `/doctor/dashboard?tab=DEPT_RESPONSES&subTab=QUERIES&invoiceId=${invoice._id}&patientId=${patientId}&appointmentId=${appointment?._id || ''}`;

      await NotificationService.createNotification({
        hospitalId: invoice.hospitalId,
        branchId: invoice.branchId,
        recipientUserId: attendingDoctorId,  // Target ONLY the attending doctor
        targetModule: 'doctor',
        notificationType: 'BILLING_QUERY',
        type: 'BILLING_QUERY',
        title: `Billing Review Required — ${patientName}`,
        message: `Billing Desk has a query for ${patientName} (${uhid}) that requires your review: "${queryMessage}"`,
        linkedPath: linkedPathWithParams,
        targetRoute: linkedPathWithParams,
        relatedPatientId: patientId,
        sourceModule: 'billing',
        entityType: 'INVOICE',
        entityId: invoice._id,
        actionType: 'REVIEW_BILLING_QUERY',
        metadata: {
          patientId,
          appointmentId: appointment?._id,
          invoiceId: invoice._id,
          patientName,
          uhid,
          query: queryMessage,
        },
      });

      // Emit real-time events — targeted to the attending doctor only (no global broadcast)
      if (attendingDoctorId) {
        socketManager.emitToUser(String(attendingDoctorId), 'opd_queue:updated', { patientId });
        socketManager.emitToUser(String(attendingDoctorId), 'doctor:billing_query', {
          patientId,
          patientName,
          uhid,
          query: queryMessage,
          requestedByName: user.name || 'Cashier',
          appointmentId: appointment?._id,
        });
        socketManager.emitToUser(String(attendingDoctorId), 'workflow:pending_changed', { patientId });
      }
      // Also emit branch-scoped updates so billing and OPD queues refresh immediately
      socketManager.emitToBranch(invoice.branchId, 'opd_queue:updated', { patientId });
      socketManager.emitToBranch(invoice.branchId, 'billing:invoice_updated', { invoiceId: invoice._id, patientId });
      socketManager.emitToBranch(invoice.branchId, 'workflow:pending_changed', { invoiceId: invoice._id });

      return {
        success: true,
        message: `Case & prescription successfully returned to Attending Doctor with query: "${queryMessage}"`,
        invoice,
        prescription: rx,
      };
    }

    if (targetDepartment === 'LABORATORY' || targetDepartment === 'RADIOLOGY') {
      const { DiagnosticOrder } = await import('../../models/DiagnosticOrder.js');
      const radiologyCategories = ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'];
      const categoryQuery = targetDepartment === 'RADIOLOGY'
        ? { $in: radiologyCategories }
        : { $nin: radiologyCategories };
      const order = await DiagnosticOrder.findOne({
        hospitalId: invoice.hospitalId,
        patientId,
        testCategory: categoryQuery,
        chargeStatus: { $ne: 'CANCELLED' },
      }).sort({ createdAt: -1 });

      if (!order) {
        throw new ApiError(
          409,
          `No ${targetDepartment.toLowerCase()} order is linked to this patient invoice.`,
          null,
          'DIAGNOSTIC_ORDER_NOT_FOUND',
        );
      }

      order.chargeStatus = 'CORRECTION_REQUESTED';
      order.correctionNote = queryMessage;
      order.billingQuery = {
        invoiceId: invoice._id,
        query: queryMessage,
        requestedBy: user.id || user._id,
        requestedByName: user.name || 'Cashier',
        requestedAt: new Date(),
        resolved: false,
        targetDepartment,
      };
      order.timeline.push({
        status: order.status,
        timestamp: new Date(),
        updatedBy: user.name || 'Cashier',
        notes: `Billing correction requested: ${queryMessage}`,
      });
      await order.save();

      const isRadiology = targetDepartment === 'RADIOLOGY';
      const recipientRoles = isRadiology
        ? ['RADIOLOGIST', 'RADIOLOGY_STAFF']
        : ['LAB_TECH', 'LABORATORY_STAFF'];
      const moduleName = isRadiology ? 'radiology' : 'laboratory';
      const targetRoute = `/${moduleName}/dashboard?orderId=${order._id}&tab=BILLING_QUERIES`;

      await NotificationService.createNotification({
        hospitalId: invoice.hospitalId,
        branchId: invoice.branchId,
        recipientRoles,
        targetModule: moduleName,
        notificationType: 'BILLING_QUERY',
        type: 'BILLING_QUERY',
        title: `Billing Review Required: ${patientName}`,
        message: `Billing Desk returned ${patientName}'s ${moduleName} charge (${uhid}): "${queryMessage}"`,
        targetRoute,
        relatedPatientId: patientId,
        sourceModule: 'billing',
        entityType: 'DIAGNOSTIC_ORDER',
        entityId: order._id,
        actionType: 'REVIEW_BILLING_QUERY',
        metadata: { invoiceId: invoice._id, orderId: order._id, patientId, query: queryMessage },
      });

      const diagnosticQueryPayload = {
        orderId: order._id,
        patientId,
        targetDepartment,
      };
      recipientRoles.forEach((recipientRole) => {
        socketManager.emitToBranchRole(invoice.branchId, recipientRole, 'diagnostics:billing_query', diagnosticQueryPayload);
      });
      return {
        success: true,
        message: `${targetDepartment} order returned for billing correction.`,
        invoice,
        diagnosticOrder: order,
      };
    }

    throw new ApiError(400, 'Unsupported billing return workflow.', null, 'INVALID_TARGET_DEPARTMENT');
  }
}
