import mongoose from 'mongoose';
import { Medicine } from '../../models/Medicine.js';
import { MedicineBatch } from '../../models/MedicineBatch.js';
import { PharmacyStockAdjustment } from '../../models/PharmacyStockAdjustment.js';
import { PharmacySubstitutionRequest } from '../../models/PharmacySubstitutionRequest.js';
import { Prescription } from '../../models/Prescription.js';
import { NurseTask } from '../../models/NurseTask.js';
import { Invoice } from '../../models/Invoice.js';
import { Patient } from '../../models/Patient.js';
import { AuditLog } from '../../models/AuditLog.js';
import { ApiError } from '../../utils/apiError.js';
import { socketManager } from '../../events/socketManager.js';
import { PAYMENT_STATUS } from '../../config/constants.js';
import { requireHospitalContext } from '../../utils/tenantContext.js';

export class PharmacyService {
  // --- INVENTORY MANAGEMENT ---

  static async getMedicines(user, query = {}) {
    const filter = { isActive: true };
    if (user?.role === 'SUPER_ADMIN') {
      if (query.hospitalId && query.hospitalId !== 'ALL') {
        filter.hospitalId = query.hospitalId;
      } else if (query.all !== 'true' && user._hospitalContextApplied && user.hospitalId) {
        filter.hospitalId = user.hospitalId;
      }
    } else {
      if (user?.hospitalId) filter.hospitalId = user.hospitalId;
      if (user?.branchId) filter.branchId = user.branchId;
    }

    if (query.category) filter.category = query.category;
    if (query.dosageForm) filter.dosageForm = query.dosageForm;
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter.$or = [{ name: regex }, { genericName: regex }, { brandName: regex }, { manufacturer: regex }];
    }

    const medicines = await Medicine.find(filter).sort({ name: 1 }).lean();

    // Attach batch & stock details
    const medicineIds = medicines.map((m) => m._id);
    const now = new Date();
    const batchFilter = { medicineId: { $in: medicineIds }, isActive: true };
    if (filter.hospitalId) batchFilter.hospitalId = filter.hospitalId;
    if (query.location) batchFilter.location = query.location;

    const batches = await MedicineBatch.find(batchFilter).sort({ expiryDate: 1 }).lean();

    // Index batches by medicineId for O(1) lookup
    const batchesByMedId = new Map();
    for (const b of batches) {
      const key = String(b.medicineId);
      let list = batchesByMedId.get(key);
      if (!list) {
        list = [];
        batchesByMedId.set(key, list);
      }
      list.push(b);
    }

    // Redact purchase price if patient or guardian
    const isPatientOrGuardian = ['PATIENT', 'GUARDIAN'].includes(user.role);

    return medicines.map((med) => {
      const medBatches = batchesByMedId.get(String(med._id)) || [];
      const validBatches = medBatches.filter((b) => new Date(b.expiryDate) > now && b.quantity > 0);
      const totalAvailableQty = validBatches.reduce((sum, b) => sum + b.quantity, 0);

      const baseMed = {
        ...med,
        totalQuantity: totalAvailableQty,
        stockStatus:
          totalAvailableQty === 0
            ? 'OUT_OF_STOCK'
            : totalAvailableQty <= med.minimumStockLevel
            ? 'LOW_STOCK'
            : 'IN_STOCK',
        batches: isPatientOrGuardian
          ? validBatches.map(({ purchasePrice, ...b }) => b)
          : medBatches,
      };

      if (isPatientOrGuardian) {
        delete baseMed.purchasePrice;
        delete baseMed.supplier;
      }

      return baseMed;
    });
  }

  static async createMedicine(data, user) {
    if (!data.name || !data.genericName || !data.category) {
      throw new ApiError(400, 'Medicine Name, Generic Name, and Category are required');
    }

    const medicine = await Medicine.create({
      ...data,
      purchasePrice: (data.purchasePrice !== undefined && data.purchasePrice !== '' && data.purchasePrice !== null) ? Number(data.purchasePrice) : 0,
      sellingPrice: (data.sellingPrice !== undefined && data.sellingPrice !== '' && data.sellingPrice !== null) ? Number(data.sellingPrice) : 0,
      taxPercentage: (data.taxPercentage !== undefined && data.taxPercentage !== '' && data.taxPercentage !== null) ? Number(data.taxPercentage) : 0,
      minimumStockLevel: (data.minimumStockLevel !== undefined && data.minimumStockLevel !== '' && data.minimumStockLevel !== null) ? Number(data.minimumStockLevel) : 20,
      reorderQuantity: (data.reorderQuantity !== undefined && data.reorderQuantity !== '' && data.reorderQuantity !== null) ? Number(data.reorderQuantity) : 100,
      hospitalId: user.hospitalId,
      branchId: user.branchId,
    });

    await AuditLog.create({
      hospitalId: user.hospitalId,
      userId: user.id,
      userRole: user.role,
      action: 'MEDICINE_CREATED',
      module: 'PHARMACY',
      resourceId: String(medicine._id),
      details: `Created new medicine SKU: ${medicine.name} (${medicine.genericName})`,
    });

    // Automatically create initial batch stock if initialQuantity is provided
    const initialQty = Number(data.initialQuantity || data.quantity || 0);
    if (initialQty > 0) {
      const defaultExp = new Date();
      defaultExp.setFullYear(defaultExp.getFullYear() + 1);
      const expiryDate = data.initialExpiryDate || data.expiryDate ? new Date(data.initialExpiryDate || data.expiryDate) : defaultExp;
      const batchNumber = (data.initialBatchNumber || data.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`).trim();

      const batch = await MedicineBatch.create({
        hospitalId: user.hospitalId || medicine.hospitalId,
        branchId: user.branchId || medicine.branchId,
        medicineId: medicine._id,
        batchNumber,
        location: data.location || 'MAIN_PHARMACY',
        mfgDate: data.mfgDate ? new Date(data.mfgDate) : new Date(),
        expiryDate,
        purchasePrice: medicine.purchasePrice,
        sellingPrice: medicine.sellingPrice,
        quantity: initialQty,
        storageLocation: data.rackLocation || data.storageLocation || 'Rack 1',
      });

      await PharmacyStockAdjustment.create({
        hospitalId: user.hospitalId || medicine.hospitalId,
        branchId: user.branchId || medicine.branchId,
        medicineId: medicine._id,
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        type: 'ADD_STOCK',
        sourceLocation: batch.location,
        previousQuantity: 0,
        quantityChanged: initialQty,
        newQuantity: initialQty,
        reason: 'Initial stock on SKU creation',
        performedBy: user.id,
        performedByName: user.name,
      });

      socketManager.emitToBranch(user.branchId || user.hospitalId || medicine.hospitalId, 'workflow:pending_changed', {
        resource: 'PHARMACY_STOCK',
      });
    }

    return medicine;
  }

  static async updateMedicine(medicineId, data, user) {
    const query = { _id: medicineId };
    if (user?.hospitalId && user.role !== 'SUPER_ADMIN') {
      query.hospitalId = user.hospitalId;
    }
    const medicine = await Medicine.findOne(query);
    if (!medicine) throw new ApiError(404, 'Medicine not found');

    const updatableFields = [
      'name', 'genericName', 'brandName', 'category', 'dosageForm', 'strength',
      'manufacturer', 'supplier', 'purchasePrice', 'sellingPrice', 'taxPercentage',
      'minimumStockLevel', 'reorderQuantity', 'prescriptionRequired', 'isActive'
    ];

    updatableFields.forEach((field) => {
      if (data[field] !== undefined) {
        if (['purchasePrice', 'sellingPrice', 'taxPercentage', 'minimumStockLevel', 'reorderQuantity'].includes(field)) {
          medicine[field] = data[field] === '' ? 0 : Number(data[field]);
        } else {
          medicine[field] = data[field];
        }
      }
    });

    await medicine.save();

    await AuditLog.create({
      hospitalId: medicine.hospitalId,
      userId: user.id,
      userRole: user.role,
      action: 'MEDICINE_UPDATED',
      module: 'PHARMACY',
      resourceId: String(medicine._id),
      details: `Updated medicine details for ${medicine.name}`,
    });

    socketManager.emitToBranch(user.branchId || user.hospitalId || medicine.hospitalId, 'workflow:pending_changed', {
      resource: 'PHARMACY_STOCK',
    });

    return medicine;
  }

  // --- BATCH MANAGEMENT ---

  static async addBatch(data, user) {
    const query = { _id: data.medicineId };
    if (user?.hospitalId && user.role !== 'SUPER_ADMIN') {
      query.hospitalId = user.hospitalId;
    }
    const medicine = await Medicine.findOne(query);
    if (!medicine) throw new ApiError(404, 'Medicine record not found');

    const defaultExp = new Date();
    defaultExp.setFullYear(defaultExp.getFullYear() + 1);
    const expiryDate = data.expiryDate ? new Date(data.expiryDate) : defaultExp;
    const batchNumber = (data.batchNumber || `BATCH-${Date.now().toString().slice(-6)}`).trim();

    const purchasePrice = (data.purchasePrice !== undefined && data.purchasePrice !== '' && data.purchasePrice !== null && Number(data.purchasePrice) > 0)
      ? Number(data.purchasePrice)
      : (medicine.purchasePrice || 0);

    const sellingPrice = (data.sellingPrice !== undefined && data.sellingPrice !== '' && data.sellingPrice !== null && Number(data.sellingPrice) > 0)
      ? Number(data.sellingPrice)
      : (medicine.sellingPrice || 0);

    const quantity = Number(data.quantity) || 0;

    const batch = await MedicineBatch.create({
      hospitalId: user.hospitalId || medicine.hospitalId,
      branchId: user.branchId || medicine.branchId,
      medicineId: medicine._id,
      batchNumber,
      location: data.location || 'MAIN_PHARMACY',
      mfgDate: data.mfgDate ? new Date(data.mfgDate) : new Date(),
      expiryDate,
      purchasePrice,
      sellingPrice,
      quantity,
      storageLocation: data.storageLocation || 'Rack 1',
    });

    // Record stock adjustment audit log
    await PharmacyStockAdjustment.create({
      hospitalId: user.hospitalId || medicine.hospitalId,
      branchId: user.branchId || medicine.branchId,
      medicineId: medicine._id,
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      type: 'ADD_STOCK',
      sourceLocation: batch.location,
      previousQuantity: 0,
      quantityChanged: batch.quantity,
      newQuantity: batch.quantity,
      reason: data.reason || 'Batch purchase / stock addition',
      performedBy: user.id,
      performedByName: user.name,
    });

    socketManager.emitToBranch(user.branchId || user.hospitalId || medicine.hospitalId, 'workflow:pending_changed', {
      resource: 'PHARMACY_STOCK',
    });

    return batch;
  }

  static async adjustStock(data, user) {
    const { batchId, type, quantityChanged, reason } = data;
    if (!reason || !reason.trim()) {
      throw new ApiError(400, 'A reason is required for stock adjustments');
    }

    const batch = await MedicineBatch.findOne({ _id: batchId, hospitalId: user.hospitalId });
    if (!batch) throw new ApiError(404, 'Batch not found');

    const qtyChange = Number(quantityChanged);
    const prevQty = batch.quantity;
    const newQty = Math.max(0, prevQty + qtyChange);

    batch.quantity = newQty;
    await batch.save();

    await PharmacyStockAdjustment.create({
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      medicineId: batch.medicineId,
      batchId: batch._id,
      batchNumber: batch.batchNumber,
      type: type || 'ADJUSTMENT',
      sourceLocation: batch.location,
      previousQuantity: prevQty,
      quantityChanged: qtyChange,
      newQuantity: newQty,
      reason: reason.trim(),
      performedBy: user.id,
      performedByName: user.name,
    });

    return batch;
  }

  static async transferStock(data, user) {
    const { batchId, destinationLocation, transferQuantity, reason } = data;
    if (!destinationLocation || !transferQuantity || transferQuantity <= 0) {
      throw new ApiError(400, 'Destination location and positive transfer quantity are required');
    }

    const sourceBatch = await MedicineBatch.findOne({ _id: batchId, hospitalId: user.hospitalId });
    if (!sourceBatch) throw new ApiError(404, 'Source batch not found');
    if (sourceBatch.quantity < transferQuantity) {
      throw new ApiError(400, `Insufficient quantity in source location. Available: ${sourceBatch.quantity}`);
    }

    // Deduct from source batch
    const sourcePrev = sourceBatch.quantity;
    sourceBatch.quantity -= transferQuantity;
    await sourceBatch.save();

    // Find or create destination batch
    let destBatch = await MedicineBatch.findOne({
      hospitalId: user.hospitalId,
      medicineId: sourceBatch.medicineId,
      batchNumber: sourceBatch.batchNumber,
      location: destinationLocation,
    });

    if (!destBatch) {
      destBatch = await MedicineBatch.create({
        hospitalId: user.hospitalId,
        branchId: user.branchId,
        medicineId: sourceBatch.medicineId,
        batchNumber: sourceBatch.batchNumber,
        location: destinationLocation,
        mfgDate: sourceBatch.mfgDate,
        expiryDate: sourceBatch.expiryDate,
        purchasePrice: sourceBatch.purchasePrice,
        sellingPrice: sourceBatch.sellingPrice,
        quantity: transferQuantity,
        storageLocation: sourceBatch.storageLocation,
      });
    } else {
      destBatch.quantity += transferQuantity;
      await destBatch.save();
    }

    // Log adjustment audit
    await PharmacyStockAdjustment.create({
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      medicineId: sourceBatch.medicineId,
      batchId: sourceBatch._id,
      batchNumber: sourceBatch.batchNumber,
      type: 'TRANSFER',
      sourceLocation: sourceBatch.location,
      destinationLocation,
      previousQuantity: sourcePrev,
      quantityChanged: -transferQuantity,
      newQuantity: sourceBatch.quantity,
      reason: reason || `Inter-departmental transfer to ${destinationLocation}`,
      performedBy: user.id,
      performedByName: user.name,
    });

    return { sourceBatch, destBatch };
  }

  // --- DASHBOARD ALERTS & REPORTS ---

  static async getDashboardAlerts(user) {
    const filter = { isActive: true };
    if (user?.hospitalId && user.role !== 'SUPER_ADMIN') {
      filter.hospitalId = user.hospitalId;
    }

    const medicines = await Medicine.find(filter).lean();
    const batches = await MedicineBatch.find(filter).lean();

    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const lowStock = [];
    const outOfStock = [];
    const nearExpiry = [];
    const expired = [];

    for (const med of medicines) {
      const medBatches = batches.filter((b) => String(b.medicineId) === String(med._id));
      const validBatches = medBatches.filter((b) => new Date(b.expiryDate) > now && b.quantity > 0);
      const totalQty = validBatches.reduce((sum, b) => sum + b.quantity, 0);

      if (totalQty === 0) {
        outOfStock.push(med);
      } else if (totalQty <= med.minimumStockLevel) {
        lowStock.push({ ...med, totalQuantity: totalQty });
      }

      for (const b of medBatches) {
        const exp = new Date(b.expiryDate);
        if (exp <= now && b.quantity > 0) {
          expired.push({ ...med, batchNumber: b.batchNumber, location: b.location, quantity: b.quantity, expiryDate: b.expiryDate });
        } else if (exp > now && exp <= thirtyDays && b.quantity > 0) {
          nearExpiry.push({ ...med, batchNumber: b.batchNumber, location: b.location, quantity: b.quantity, expiryDate: b.expiryDate });
        }
      }
    }

    return {
      lowStock,
      outOfStock,
      nearExpiry,
      expired,
    };
  }

  static async getStockAdjustments(user) {
    return PharmacyStockAdjustment.find({ hospitalId: user.hospitalId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('medicineId', 'name genericName')
      .populate('performedBy', 'name role')
      .lean();
  }

  // --- PRESCRIPTION DISPENSING (FEFO) ---

  static async getPrescriptions(user, query = {}) {
    const filter = { hospitalId: requireHospitalContext(user) };

    if (query?.patientId) {
      filter.patientId = query.patientId;
    }
    if (query?.doctorId) {
      filter.doctorId = query.doctorId;
    }
    if (query?.dispenseStatus) {
      filter.dispenseStatus = query.dispenseStatus;
    }

    return Prescription.find(filter)
      .populate('patientId', 'firstName lastName uhid phone age gender chiefComplaints')
      .populate('doctorId', 'name specialization')
      .populate('consultationId', 'chiefComplaints vitals prescriptions consultationFee')
      .sort({ createdAt: -1 })
      .lean();
  }


  static async dispense(prescriptionId, dispenseData, user) {
    const prescription = await Prescription.findOne({ _id: prescriptionId, hospitalId: user.hospitalId });
    if (!prescription) throw new ApiError(404, 'Prescription not found');

    const isAllExternal = dispenseData?.isExternal === true || dispenseData?.external === true;
    const now = new Date();
    const itemsToDispense = dispenseData?.items || prescription.medicines;

    let overallDispensed = true;
    let anyDispensed = false;

    for (const item of prescription.medicines) {
      const dispenseReq = itemsToDispense.find(
        (i) => String(i.medicineName || '').toLowerCase() === String(item.medicineName || '').toLowerCase()
      ) || {};

      if (isAllExternal || dispenseReq.purchasedExternally || item.externalPurchaseRequired) {
        item.itemStatus = 'PURCHASED_EXTERNALLY';
        item.externalPurchaseRequired = true;
        item.externalPurchaseNote = dispenseData?.pharmacyNotes || dispenseReq.note || 'Patient purchased externally';
        anyDispensed = true;
        continue;
      }

      // Check available FEFO batches for this medicine
      const medicine = await Medicine.findOne({
        hospitalId: user.hospitalId,
        $or: [{ name: item.medicineName }, { genericName: item.genericName || item.medicineName }],
      });

      const requestedQty = Number(dispenseReq.dispensedQty || dispenseReq.qty || dispenseReq.quantity) || ((item.durationDays || 5) * 2);
      const unitPrice = Number(dispenseReq.unitPrice || dispenseReq.price) || (medicine?.sellingPrice || 20.0);

      if (!medicine) {
        // If medicine SKU not in inventory, treat as dispensed custom / ad-hoc item
        item.itemStatus = 'DISPENSED';
        item.dispensedQty = requestedQty;
        item.price = unitPrice;
        item.unitPrice = unitPrice;
        item.totalPrice = unitPrice * requestedQty;
        anyDispensed = true;

        if (unitPrice * requestedQty > 0) {
          await PharmacyService.addPharmacyChargeToBill({
            hospitalId: user.hospitalId,
            branchId: user.branchId,
            patientId: prescription.patientId,
            doctorId: prescription.doctorId,
            description: `[Prescription Medicine] ${item.medicineName} (${item.dosageForm || 'Tab'}) x ${requestedQty}`,
            sourceRef: `prescription:${prescription._id}:medicine:${item._id}`,
            qty: requestedQty,
            unitPrice,
            taxPercentage: 0,
          });
        }
        continue;
      }

      // Find valid batches sorted by earliest expiry date (FEFO)
      const batches = await MedicineBatch.find({
        hospitalId: user.hospitalId,
        medicineId: medicine._id,
        location: 'MAIN_PHARMACY',
        quantity: { $gt: 0 },
        expiryDate: { $gt: now },
      }).sort({ expiryDate: 1 });

      let qtyNeeded = requestedQty;
      let qtyDispensed = 0;
      let usedBatchNo = '';

      for (const batch of batches) {
        if (qtyNeeded <= 0) break;
        const takeQty = Math.min(qtyNeeded, batch.quantity);

        batch.quantity -= takeQty;
        await batch.save();

        qtyNeeded -= takeQty;
        qtyDispensed += takeQty;
        usedBatchNo = batch.batchNumber;

        // Log audit
        await PharmacyStockAdjustment.create({
          hospitalId: user.hospitalId,
          branchId: user.branchId,
          medicineId: medicine._id,
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          type: 'DISPENSE',
          sourceLocation: 'MAIN_PHARMACY',
          previousQuantity: batch.quantity + takeQty,
          quantityChanged: -takeQty,
          newQuantity: batch.quantity,
          reason: `Dispensed for Prescription #${prescription.prescriptionNo}`,
          performedBy: user.id,
          performedByName: user.name,
        });
      }

      if (qtyDispensed > 0) {
        anyDispensed = true;
        item.dispensedQty = qtyDispensed;
        item.batchNumberUsed = usedBatchNo;
        item.unitPrice = unitPrice;
        item.totalPrice = unitPrice * qtyDispensed;
        item.itemStatus = qtyDispensed >= requestedQty ? 'DISPENSED' : 'PARTIALLY_DISPENSED';
        if (qtyDispensed < requestedQty) overallDispensed = false;

        // Automatically add to Patient Invoice
        await PharmacyService.addPharmacyChargeToBill({
          hospitalId: user.hospitalId,
          branchId: user.branchId,
          patientId: prescription.patientId,
          doctorId: prescription.doctorId,
          description: `${item.medicineName} (${item.dosageForm || 'Tab'}) [Batch: ${usedBatchNo}]`,
          sourceRef: `prescription:${prescription._id}:medicine:${item._id}`,
          qty: qtyDispensed,
          unitPrice,
          taxPercentage: medicine.taxPercentage,
        });
      } else {
        item.itemStatus = 'UNAVAILABLE';
        overallDispensed = false;
      }
    }

    // Handle any extra custom items / consumables added by pharmacist
    let extraCharge = 0;
    if (Array.isArray(dispenseData?.items)) {
      for (const [extraIndex, extraItem] of dispenseData.items.entries()) {
        if (extraItem.isCustom || !prescription.medicines.some(m => String(m.medicineName || '').toLowerCase() === String(extraItem.medicineName || '').toLowerCase())) {
          const cQty = Number(extraItem.qty || 1);
          const cPrice = Number(extraItem.unitPrice || 0);
          const cTotal = cQty * cPrice;
          if (cTotal > 0) {
            extraCharge += cTotal;
            await PharmacyService.addPharmacyChargeToBill({
              hospitalId: user.hospitalId,
              branchId: user.branchId,
              patientId: prescription.patientId,
              doctorId: prescription.doctorId,
              description: `[Pharmacy Item] ${extraItem.medicineName} (${extraItem.dosageForm || 'Consumable'})`,
              sourceRef: `prescription:${prescription._id}:extra:${extraIndex}`,
              qty: cQty,
              unitPrice: cPrice,
              taxPercentage: 0,
            });
          }
        }
      }
    }

    const allAreExternal = prescription.medicines.every((m) => m.itemStatus === 'PURCHASED_EXTERNALLY');
    if (isAllExternal || allAreExternal) {
      prescription.dispenseStatus = 'DISPENSED';
      prescription.totalMedicineCharge = 0;
    } else {
      prescription.dispenseStatus = overallDispensed ? 'DISPENSED' : anyDispensed ? 'PARTIALLY_DISPENSED' : 'PENDING_DISPENSE';
      const medTotal = (prescription.medicines || []).reduce((sum, m) => sum + (Number(m.totalPrice) || 0), 0);
      prescription.totalMedicineCharge = medTotal + extraCharge;
    }

    prescription.dispensedBy = user.id;
    prescription.dispensedAt = new Date();
    prescription.pharmacyNotes = dispenseData?.pharmacyNotes || (isAllExternal ? 'Purchased externally by patient' : 'Processed by Pharmacy');
    if (prescription.billingQuery) {
      prescription.billingQuery.resolved = true;
    }
    await prescription.save();

    // Fetch patient name & UHID for clean notification
    const { Patient } = await import('../../models/Patient.js');
    const pat = await Patient.findOne({ _id: prescription.patientId, hospitalId: user.hospitalId }).select('firstName lastName uhid').lean();
    const patientName = pat ? `${pat.firstName} ${pat.lastName}`.trim() : 'Patient';
    const patientUhid = pat?.uhid || 'N/A';

    // Auto-clear associated DB notifications (e.g. PRESCRIPTION_ISSUED) so bell count reduces
    try {
      const { Notification } = await import('../../models/Notification.js');
      await Notification.updateMany(
        {
          hospitalId: user.hospitalId,
          $or: [
            { relatedTaskId: String(prescription._id) },
            { relatedRequestId: String(prescription._id) },
          ],
          isCleared: { $ne: true },
        },
        { isRead: true, isCleared: true, readAt: new Date(), clearedAt: new Date() }
      );
    } catch (e) {}

    // Notify Central Billing / Cashier Desk
    try {
      const { WorkflowEventService, WORKFLOW_EVENTS } = await import('../../events/workflowEventService.js');

      const billingInvoice = await Invoice.findOne({
        hospitalId: user.hospitalId,
        patientId: prescription.patientId,
        status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
      }).sort({ createdAt: -1 }).select('_id').lean();
      await WorkflowEventService.emit(WORKFLOW_EVENTS.PHARMACY_DISPENSED, {
        hospitalId: user.hospitalId,
        branchId: prescription.branchId || user.branchId,
        invoiceId: billingInvoice?._id,
        prescriptionId: prescription._id,
        patientId: prescription.patientId,
        patientName,
        uhid: patientUhid,
        doctorId: prescription.doctorId,
        dispensedBy: user.name || 'Pharmacist',
        dispenseStatus: prescription.dispenseStatus,
      }, prescription.branchId || user.branchId);
    } catch (notifErr) {
      console.warn('[PharmacyService] Notification error:', notifErr.message);
    }

    try {
      const { Appointment } = await import('../../models/Appointment.js');
      await Appointment.updateMany(
        { hospitalId: user.hospitalId, patientId: prescription.patientId, status: 'WAITING_PHARMACY' },
        { $set: { status: 'COMPLETED' } }
      );
    } catch (appErr) {}

    socketManager.emitToBranch(prescription.branchId || user.hospitalId, 'billing:invoice_updated', {
      patientId: prescription.patientId,
    });

    socketManager.emitToBranch(prescription.branchId || user.hospitalId, 'workflow:pending_changed', {
      resourceId: prescription._id,
      status: prescription.dispenseStatus,
    });

    return prescription;
  }

  // --- AUTOMATED BILLING INTEGRATION ---

  static async addPharmacyChargeToBill({ hospitalId, branchId, patientId, doctorId, description, sourceRef, qty, unitPrice, taxPercentage }) {
    const rawPatientId = patientId?._id || patientId;
    const rawHospitalId = hospitalId?._id || hospitalId;
    const rawBranchId = branchId?._id || branchId;

    const tax = (unitPrice * (taxPercentage || 0)) / 100;
    const itemUnitPrice = unitPrice + tax;
    const totalPrice = itemUnitPrice * qty;

    let invoice = await Invoice.findOne({
      hospitalId: rawHospitalId,
      patientId: rawPatientId,
      status: { $in: ['UNPAID', 'PARTIALLY_PAID'] },
    }).sort({ createdAt: -1 });

    if (!invoice) {
      const invCount = await Invoice.countDocuments({ hospitalId: rawHospitalId });
      const invoiceNo = `INV-PHARM-${Date.now().toString().slice(-4)}-${invCount + 1}`;

      invoice = new Invoice({
        hospitalId: rawHospitalId,
        branchId: rawBranchId,
        patientId: rawPatientId,
        doctorId,
        invoiceNo,
        items: [],
        subtotal: 0,
        discountAmount: 0,
        grandTotal: 0,
        paidAmount: 0,
        balanceAmount: 0,
        status: 'UNPAID',
      });
    }

    const stableRef = String(sourceRef || `pharmacy:${description}`).slice(0, 250);
    // Replace only the same producer line so a retry is idempotent without
    // erasing the other medicines already accumulated on this invoice.
    const cleanItems = (invoice.items || []).filter((it) => {
      if (it.category !== 'PHARMACY') return true;
      return String(it.sourceRef || '') !== stableRef
        && !(String(it.sourceRef || '') === '' && it.description === description);
    });
    cleanItems.push({
      description,
      sourceRef: stableRef,
      category: 'PHARMACY',
      qty,
      unitPrice: itemUnitPrice,
      totalPrice,
    });
    invoice.items = cleanItems;

    invoice.subtotal = invoice.items.reduce((acc, i) => acc + (Number(i.totalPrice) || 0), 0);
    invoice.totalAmount = Math.max(0, invoice.subtotal - (Number(invoice.discountAmount) || 0) + (Number(invoice.taxAmount) || 0));
    invoice.grandTotal = invoice.totalAmount;
    invoice.balanceAmount = Math.max(0, invoice.totalAmount - (Number(invoice.paidAmount) || 0));

    await invoice.save();
    return invoice;
  }

  // --- SUBSTITUTION WORKFLOW ---

  static async requestSubstitution(data, user) {
    const { prescriptionId, originalMedicineName, suggestedMedicineId, reason } = data;
    const prescription = await Prescription.findOne({ _id: prescriptionId, hospitalId: user.hospitalId });
    if (!prescription) throw new ApiError(404, 'Prescription not found');

    let suggestedMed = null;
    let availQty = 0;

    if (suggestedMedicineId) {
      suggestedMed = await Medicine.findOne({ _id: suggestedMedicineId, hospitalId: user.hospitalId });
      if (suggestedMed) {
        const batches = await MedicineBatch.find({
          hospitalId: user.hospitalId,
          medicineId: suggestedMed._id,
          quantity: { $gt: 0 },
          expiryDate: { $gt: new Date() },
        });
        availQty = batches.reduce((acc, b) => acc + b.quantity, 0);
      }
    }

    const req = await PharmacySubstitutionRequest.create({
      hospitalId: user.hospitalId,
      branchId: user.branchId,
      prescriptionId: prescription._id,
      patientId: prescription.patientId,
      doctorId: prescription.doctorId,
      pharmacistId: user.id,
      originalMedicineName,
      suggestedMedicineId: suggestedMed ? suggestedMed._id : null,
      suggestedMedicineName: suggestedMed ? suggestedMed.name : 'No specific alternative suggested (Physician discretion)',
      genericComposition: suggestedMed ? suggestedMed.genericName : '',
      strength: suggestedMed ? suggestedMed.strength : '',
      availableQty: availQty,
      priceDifference: suggestedMed ? suggestedMed.sellingPrice : 0,
      reason: reason || 'Prescribed brand is out of stock in pharmacy, offering bioequivalent alternative',
    });

    try {
      const { NotificationService } = await import('../notifications/notification.service.js');
      const { Patient } = await import('../../models/Patient.js');
      const patient = await Patient.findOne({ _id: prescription.patientId, hospitalId: user.hospitalId }).select('firstName lastName uhid').lean();
      const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : 'Patient';

      const notifMsg = suggestedMed
        ? `Pharmacy requested substitution for ${patientName} (${patient?.uhid || 'N/A'}): Replace "${originalMedicineName}" with "${suggestedMed.name}" (${suggestedMed.manufacturer ? `Brand/Mfg: ${suggestedMed.manufacturer}` : 'Alternative Company'}). Reason: ${req.reason}`
        : `Pharmacy requested consultation for ${patientName} (${patient?.uhid || 'N/A'}): Prescribed medicine "${originalMedicineName}" is out of stock. Reason: ${req.reason}. Please prescribe an alternative.`;

      await NotificationService.createNotification({
        hospitalId: user.hospitalId,
        branchId: user.branchId,
        recipientUserId: prescription.doctorId,
        recipientRole: 'DOCTOR',
        title: 'Medicine Substitution Request',
        message: notifMsg,
        notificationType: 'ACTION_REQUIRED',
        sourceModule: 'pharmacy',
        entityType: 'PharmacySubstitutionRequest',
        entityId: req._id,
        actionType: 'REVIEW_SUBSTITUTION',
        targetModule: 'doctor',
        targetRoute: `/doctor/dashboard?tab=DEPT_RESPONSES&substitutionId=${req._id}`,
        relatedPatientId: prescription.patientId,
        relatedTaskId: String(req._id),
      });
    } catch (e) {}

    socketManager.emitToUser(String(prescription.doctorId), 'workflow:notification', {
      type: 'SUBSTITUTION_REQUEST',
      doctorId: prescription.doctorId,
      requestId: req._id,
    });

    return req;
  }

  static async respondSubstitution(requestId, { status, doctorNotes }, user) {
    const req = await PharmacySubstitutionRequest.findOne({ _id: requestId, hospitalId: user.hospitalId });
    if (!req) throw new ApiError(404, 'Substitution request not found');

    req.status = status;
    req.doctorResponseNotes = doctorNotes || '';
    req.respondedAt = new Date();
    await req.save();

    socketManager.emitToUser(String(req.pharmacistId), 'workflow:notification', {
      type: 'SUBSTITUTION_RESPONSE',
      requestId: req._id,
      status,
    });

    try {
      const { NotificationService } = await import('../notifications/notification.service.js');
      await NotificationService.completeEntityTasks({
        hospitalId: user.hospitalId,
        entityType: 'PharmacySubstitutionRequest',
        entityId: requestId,
        branchId: user.branchId,
      });
    } catch (err) {
      console.warn('Failed to clear notifications for substitution response:', err?.message);
    }

    return req;
  }

  static async acknowledgeSubstitution(requestId, user) {
    const req = await PharmacySubstitutionRequest.findOne({ _id: requestId, hospitalId: user.hospitalId });
    if (!req) throw new ApiError(404, 'Substitution request not found');

    req.acknowledgedByPharmacist = true;
    await req.save();

    socketManager.emitToBranch(user.branchId || user.hospitalId, 'workflow:pending_changed', {
      resourceId: req._id,
      status: 'ACKNOWLEDGED',
    });

    return req;
  }

  static async getBatches(user, query = {}) {
    const filter = { hospitalId: user.hospitalId, isActive: true };
    if (query.medicineId) filter.medicineId = query.medicineId;
    if (query.location) filter.location = query.location;
    return MedicineBatch.find(filter)
      .populate('medicineId', 'name genericName dosageForm sellingPrice')
      .sort({ expiryDate: 1 })
      .lean();
  }

  static async getSubstitutions(user, query = {}) {
    const filter = { hospitalId: user.hospitalId };
    if (user.role === 'DOCTOR') filter.doctorId = user.id;
    return PharmacySubstitutionRequest.find(filter)
      .populate('patientId', 'firstName lastName uhid')
      .populate('doctorId', 'name')
      .populate('pharmacistId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }

  static async getPendingSubstitutions(user) {
    const filter = { hospitalId: user.hospitalId };
    if (user.role === 'DOCTOR') filter.doctorId = user.id;

    return PharmacySubstitutionRequest.find(filter)
      .populate('patientId', 'firstName lastName uhid')
      .populate('doctorId', 'name')
      .populate('pharmacistId', 'name')
      .sort({ createdAt: -1 })
      .lean();
  }
}
