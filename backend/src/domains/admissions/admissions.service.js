import { Admission } from '../../models/Admission.js';
import { Bed } from '../../models/Bed.js';
import { Patient } from '../../models/Patient.js';
import { User } from '../../models/User.js';
import { CareTeamAssignment } from '../../models/CareTeamAssignment.js';
import { GlobalPatient } from '../../models/GlobalPatient.js';
import { socketManager } from '../../events/socketManager.js';
import { BED_STATUS } from '../../config/constants.js';
import { ApiError } from '../../utils/apiError.js';
import { requireBranchContext, requireHospitalContext } from '../../utils/tenantContext.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { NotificationService } from '../notifications/notification.service.js';

const notifyAdmissionAssignee = async ({ admission, recipientUserId, recipientRole, actionType, title, message }) => {
  if (!recipientUserId) return;
  const doctorRoute = `/doctor/ipd-rounds?admissionId=${admission._id}&patientId=${admission.patientId}`;
  const nursingRoute = `/nurse-incharge/dashboard?tab=INPATIENTS&admissionId=${admission._id}&patientId=${admission.patientId}`;
  await NotificationService.createNotification({
    hospitalId: admission.hospitalId,
    branchId: admission.branchId,
    recipientUserId,
    recipientRole,
    title,
    message,
    notificationType: 'WORKFLOW',
    sourceModule: 'ipd',
    targetModule: recipientRole === 'DOCTOR' ? 'doctor' : 'nursing',
    entityType: 'Admission',
    entityId: admission._id,
    actionType,
    targetRoute: recipientRole === 'DOCTOR' ? doctorRoute : nursingRoute,
    relatedPatientId: admission.patientId,
    relatedTaskId: String(admission._id),
  });
};

export class AdmissionsService {
  static async requestAdmission(data, user) {
    const hospitalId = requireHospitalContext(user);
    const branchId = requireBranchContext(user);

    const patient = await Patient.findOne({ _id: data.patientId, hospitalId });
    if (!patient) {
      throw new ApiError(404, 'Patient record not found', null, 'NOT_FOUND');
    }

    // Count previous admissions for this patient in this hospital to generate sequential number
    const prevAdmissionCount = await Admission.countDocuments({ patientId: patient._id, hospitalId });
    const admissionNumber = prevAdmissionCount + 1;
    const admissionReference = `ADM-${patient.uhid}-${String(admissionNumber).padStart(3, '0')}`;

    const admission = await Admission.create({
      hospitalId,
      branchId,
      patientId: patient._id,
      uhid: patient.uhid,
      patientName: `${patient.firstName} ${patient.lastName}`,
      doctorId: user.id || user._id,
      doctorName: user.name || 'Dr. Gregory House',
      wardType: data.wardType || 'GENERAL',
      targetWardName: data.targetWardName || 'Ward 3B - Inpatient',
      admissionReason: data.admissionReason || 'Inpatient trauma observation & surgery',
      dailyTariff: data.wardType === 'ICU' ? 650.0 : 150.0,
      admissionNumber,
      admissionReference,
      status: 'ADMISSION_REQUESTED',
    });

    // Update Patient.admissionStatus and optional guardian info
    const patientUpdates = { admissionStatus: 'ACTIVE_ADMISSION', activeAdmissionId: admission._id };
    if (data.guardianName) patientUpdates['emergencyContact.name'] = data.guardianName.trim();
    if (data.guardianPhone) patientUpdates['emergencyContact.phone'] = data.guardianPhone.trim();
    if (data.guardianRelationship) patientUpdates['emergencyContact.relation'] = data.guardianRelationship;

    await Patient.updateOne(
      { _id: patient._id, hospitalId },
      { $set: patientUpdates, $inc: { admissionCount: 1 } }
    );

    // Update GlobalPatient membership hasActiveAdmission flag
    if (patient.globalPatientId) {
      await GlobalPatient.updateOne(
        { _id: patient.globalPatientId, 'hospitalMemberships.localPatientId': patient._id },
        { $set: { 'hospitalMemberships.$.hasActiveAdmission': true, 'hospitalMemberships.$.activeAdmissionId': admission._id } }
      );
    }

    // Real-time broadcast to Nurse In-Charge & Ward Nurse Desks
    socketManager.emitToBranch(branchId, 'admission:requisition_created', {
      admissionId: admission._id,
      patientName: admission.patientName,
      uhid: admission.uhid,
      doctorName: admission.doctorName,
      wardType: admission.wardType,
    });

    await WorkflowEventService.emit(WORKFLOW_EVENTS.IPD_ADMISSION_RECOMMENDED, {
      hospitalId,
      branchId,
      admissionId: admission._id,
      patientId: patient._id,
      patientName: admission.patientName,
      uhid: admission.uhid,
      doctorName: admission.doctorName,
      wardType: admission.wardType,
      reason: admission.admissionReason,
      priority: data.priority || 'NORMAL',
    }, branchId);

    socketManager.emitToBranch(admission.branchId, 'workflow:pending_changed', { resourceId: admission._id, status: admission.status });
    return admission;
  }

  static async getAdmissions(user) {
    const filter = { hospitalId: requireHospitalContext(user) };

    return await Admission.find(filter)
      .populate('patientId', 'firstName lastName uhid phone age gender dob emergencyContact bloodGroup address')
      .populate('doctorId', 'name specialization cabinNo phone')
      .populate('assignedNurseId', 'name role assignedUnit shiftDetails phone')
      .populate('assignedCaretakerId', 'name role assignedUnit shiftDetails phone')
      .populate({ path: 'bedId', populate: { path: 'assignedNurseId', select: 'name role assignedUnit shiftDetails phone' } })
      .sort({ createdAt: -1 })
      .lean({ getters: true });
  }

  static async allocateBed(admissionId, data, user) {
    const hospitalId = requireHospitalContext(user);
    const admission = await Admission.findOne({ _id: admissionId, hospitalId });
    if (!admission) {
      throw new ApiError(404, 'Admission requisition record not found', null, 'NOT_FOUND');
    }

    const { wardName, bedNumber, dailyTariff } = data;
    let assignedDoctorId = data.assignedDoctorId || admission.doctorId;
    let assignedNurseId = data.assignedNurseId || null;
    let assignedCaretakerId = data.assignedCaretakerId || null;
    if (!assignedNurseId && ['NURSE', 'NURSE_INCHARGE'].includes(user.role)) {
      assignedNurseId = user.id || user._id;
    }
    if (assignedNurseId) {
      const assignedNurse = await User.findOne({
        _id: assignedNurseId,
        hospitalId: admission.hospitalId,
        isActive: true,
        role: { $in: ['NURSE', 'NURSE_INCHARGE'] },
      });
      if (!assignedNurse) {
        throw new ApiError(400, 'Selected nurse is unavailable or belongs to another hospital.', null, 'INVALID_NURSE_ASSIGNMENT');
      }
    }
    const assignedDoctor = await User.findOne({
      _id: assignedDoctorId,
      hospitalId: admission.hospitalId,
      isActive: true,
      role: 'DOCTOR',
    });
    if (!assignedDoctor) {
      throw new ApiError(400, 'Select an active doctor from this hospital.', null, 'INVALID_DOCTOR_ASSIGNMENT');
    }
    if (assignedCaretakerId) {
      const assignedCaretaker = await User.findOne({
        _id: assignedCaretakerId,
        hospitalId: admission.hospitalId,
        isActive: true,
        role: { $in: ['SUPPORT_STAFF', 'IPD_STAFF', 'NURSE', 'NURSE_INCHARGE'] },
      });
      if (!assignedCaretaker) {
        throw new ApiError(400, 'Select an active caretaker or ward-support staff member.', null, 'INVALID_CARETAKER_ASSIGNMENT');
      }
    }
    if (admission.status === 'ADMITTED' && data.reassignOnly) {
      admission.doctorId = assignedDoctor._id;
      admission.doctorName = assignedDoctor.name;
      admission.assignedNurseId = assignedNurseId;
      admission.assignedCaretakerId = assignedCaretakerId;
      admission.assignedAt = new Date();
      await admission.save();
      if (admission.bedId) {
        await Bed.updateOne({ _id: admission.bedId, hospitalId }, { assignedNurseId: assignedNurseId || null });
      }
      return Admission.findById(admission._id)
        .populate('patientId')
        .populate('doctorId', 'name specialization cabinNo phone')
        .populate('assignedNurseId', 'name role assignedUnit shiftDetails phone')
        .populate('assignedCaretakerId', 'name role assignedUnit shiftDetails phone');
    }

    if (admission.status === 'ADMITTED') {
      throw new ApiError(400, `Patient ${admission.patientName} is already admitted to Bed ${admission.bedNumber}.`, null, 'ALREADY_ADMITTED');
    }

    let bed = null;
    if (data.bedId) {
      bed = await Bed.findOne({ _id: data.bedId, hospitalId });
    } else if (bedNumber) {
      bed = await Bed.findOne({
        branchId: admission.branchId,
        bedNumber: bedNumber.trim()
      }).populate('currentPatientId');
    }

    // Check if bed is already occupied by a different patient
    if (bed && bed.status === BED_STATUS.OCCUPIED) {
      const currentPatId = bed.currentPatientId?._id || bed.currentPatientId;
      if (String(currentPatId) !== String(admission.patientId)) {
        const occPat = bed.currentPatientId;
        const occName = occPat ? `${occPat.firstName || ''} ${occPat.lastName || ''}`.trim() : 'another patient';
        throw new ApiError(400, `Bed '${bed.bedNumber}' in ${bed.wardName} is currently OCCUPIED by patient '${occName}'. Please select an available bed.`, null, 'BED_OCCUPIED');
      }
    }

    const selectedWard = wardName || (bed ? bed.wardName : admission.targetWardName) || 'Ward 3B - Inpatient';
    const selectedBedNo = bedNumber ? bedNumber.trim() : (bed ? bed.bedNumber : `BED-30${Math.floor(Math.random() * 90 + 10)}`);
    const selectedTariff = dailyTariff ? Number(dailyTariff) : (bed ? bed.dailyTariff : (admission.dailyTariff || 150.0));

    if (!bed) {
      // Create new bed record with wardName and bedNumber specified
      bed = await Bed.create({
        hospitalId: admission.hospitalId,
        branchId: admission.branchId,
        bedNumber: selectedBedNo,
        wardName: selectedWard,
        wardType: admission.wardType || 'GENERAL',
        dailyTariff: selectedTariff,
        status: BED_STATUS.OCCUPIED,
        currentPatientId: admission.patientId,
        currentAdmissionId: admission._id,
        assignedNurseId,
        assignedDoctorId: assignedDoctor._id,
      });
    } else {
      bed.status = BED_STATUS.OCCUPIED;
      bed.currentPatientId = admission.patientId;
      bed.currentAdmissionId = admission._id;
      if (assignedNurseId) bed.assignedNurseId = assignedNurseId;
      bed.assignedDoctorId = assignedDoctor._id;
      bed.wardName = selectedWard;
      bed.dailyTariff = selectedTariff;
      await bed.save();
    }

    // Record Bed Status History
    try {
      const { BedStatusHistory } = await import('../../models/BedStatusHistory.js');
      await BedStatusHistory.create({
        hospitalId: admission.hospitalId,
        branchId: admission.branchId,
        bedId: bed._id,
        bedNumber: bed.bedNumber,
        patientId: admission.patientId,
        admissionId: admission._id,
        fromStatus: BED_STATUS.AVAILABLE,
        toStatus: BED_STATUS.OCCUPIED,
        changedBy: user?.id || user?._id,
        changedByName: user?.name || 'Staff User',
        reason: `Admitted patient ${admission.patientName} (${admission.uhid})`,
      });
    } catch (e) {
      console.error('[AdmissionsService/BedStatusHistory]', e.message);
    }

    admission.status = 'ADMITTED';
    admission.doctorId = assignedDoctor._id;
    admission.doctorName = assignedDoctor.name;
    admission.assignedNurseId = assignedNurseId;
    admission.assignedCaretakerId = assignedCaretakerId;
    admission.assignedAt = new Date();
    admission.bedId = bed._id;
    admission.bedNumber = bed.bedNumber;
    admission.targetWardName = bed.wardName;
    admission.wardType = bed.wardType || admission.wardType || 'GENERAL';
    admission.dailyTariff = bed.dailyTariff;
    admission.blockId = bed.blockId || null;
    admission.blockName = bed.blockName || '';
    admission.floorId = bed.floorId || null;
    admission.floorName = bed.floorName || '';
    admission.wardId = bed.wardId || null;
    admission.roomId = bed.roomId || null;
    admission.roomNumber = bed.roomNumber || '';
    admission.bedTariff = bed.dailyBedCharge || 0;
    admission.roomTariff = bed.dailyRoomCharge || 0;
    admission.wardTariff = bed.dailyWardCharge || 0;
    admission.admittedAt = new Date();
    await admission.save();

    await notifyAdmissionAssignee({
      admission,
      recipientUserId: assignedDoctor._id,
      recipientRole: 'DOCTOR',
      actionType: 'REVIEW_IPD_ADMISSION',
      title: `Patient admitted: ${admission.patientName}`,
      message: `${admission.patientName} (${admission.uhid}) was admitted to ${bed.wardName}, bed ${bed.bedNumber}.`,
    });
    if (assignedNurseId) {
      await notifyAdmissionAssignee({
        admission,
        recipientUserId: assignedNurseId,
        recipientRole: 'NURSE',
        actionType: 'CARE_FOR_INPATIENT',
        title: `New inpatient assignment: ${admission.patientName}`,
        message: `${admission.patientName} (${admission.uhid}) is assigned to you in ${bed.wardName}, bed ${bed.bedNumber}.`,
      });
    }

    // Broadcast admission confirmation
    socketManager.emitToBranch(admission.branchId, 'admission:confirmed', {
      admissionId: admission._id,
      patientName: admission.patientName,
      uhid: admission.uhid,
      bedNumber: bed.bedNumber,
      wardName: bed.wardName,
    });
    socketManager.emitToBranch(admission.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.OCCUPIED,
      patientId: admission.patientId,
    });
    socketManager.emitToBranch(admission.branchId, 'workflow:pending_changed', { resourceId: admission._id, status: admission.status });

    return Admission.findById(admission._id)
      .populate('patientId')
      .populate('doctorId', 'name specialization cabinNo phone')
      .populate('assignedNurseId', 'name role assignedUnit shiftDetails phone')
      .populate('assignedCaretakerId', 'name role assignedUnit shiftDetails phone');
  }

  static async dischargePatient(admissionId, user) {
    const hospitalId = requireHospitalContext(user);
    const admission = await Admission.findOne({ _id: admissionId, hospitalId });
    if (!admission) {
      throw new ApiError(404, 'Admission record not found', null, 'NOT_FOUND');
    }

    const dischargeRecipients = [
      { id: admission.doctorId, role: 'DOCTOR' },
      { id: admission.assignedNurseId, role: 'NURSE' },
      { id: admission.dutyNurseId, role: 'NURSE' },
      { id: admission.assignedCaretakerId, role: 'IPD_STAFF' },
    ].filter((entry) => entry.id);

    admission.status = 'DISCHARGED';
    admission.dischargedAt = new Date();
    await admission.save();
    socketManager.emitToBranch(admission.branchId, 'workflow:pending_changed', { resourceId: admission._id, status: admission.status });

    // Update Patient.admissionStatus to DISCHARGED
    await Patient.updateOne(
      { _id: admission.patientId, hospitalId },
      { $set: { admissionStatus: 'DISCHARGED', activeAdmissionId: null } }
    );

    // Update GlobalPatient membership active admission flag
    const patient = await Patient.findOne({ _id: admission.patientId, hospitalId }).select('globalPatientId').lean();
    if (patient?.globalPatientId) {
      await GlobalPatient.updateOne(
        { _id: patient.globalPatientId, 'hospitalMemberships.activeAdmissionId': admission._id },
        { $set: { 'hospitalMemberships.$.hasActiveAdmission': false, 'hospitalMemberships.$.activeAdmissionId': null, 'hospitalMemberships.$.lastVisitAt': new Date() } }
      );
    }

    // Close all active care team assignments
    await CareTeamAssignment.updateMany(
      { admissionId, hospitalId, removedAt: null },
      { $set: { removedAt: new Date(), removalReason: 'Patient discharged', removedByName: user?.name || 'System' } }
    );

    // Disable guardian live access for this admission
    try {
      const { GuardianLink } = await import('../../models/GuardianLink.js');
      await GuardianLink.updateMany(
        { patientId: admission.patientId, hospitalId, liveAccessActive: true },
        { $set: { liveAccessActive: false, liveAccessDisabledAt: new Date() } }
      );
    } catch (e) {
      console.error('[Discharge/GuardianLink]', e.message);
    }

    // Cancel pending NurseTasks
    try {
      const { NurseTask } = await import('../../models/NurseTask.js');
      await NurseTask.updateMany(
        { patientId: admission.patientId, hospitalId, status: { $in: ['PENDING', 'ACCEPTED', 'SCHEDULED'] } },
        { $set: { status: 'CANCELLED' } }
      );
    } catch (e) {
      console.error('[Discharge/NurseTask]', e.message);
    }

    // Bed sanitation safety: transition bed to CLEANING status (not directly to AVAILABLE)
    let dischargedBed = null;
    if (admission.bedId) {
      dischargedBed = await Bed.findOne({ _id: admission.bedId, hospitalId });
    } else if (admission.bedNumber) {
      dischargedBed = await Bed.findOne({ branchId: admission.branchId, bedNumber: admission.bedNumber });
    }

    if (dischargedBed) {
      dischargedBed.status = BED_STATUS.CLEANING;
      dischargedBed.currentPatientId = null;
      dischargedBed.currentAdmissionId = null;
      dischargedBed.assignedNurseId = null;
      dischargedBed.cleaningDetails = {
        requestedAt: new Date(),
        requestedBy: user?.id || user?._id,
        cleanedAt: null,
        cleanedBy: null,
        notes: `Patient ${admission.patientName} discharged. Full sanitization and fresh linen required.`,
      };
      await dischargedBed.save();

      try {
        const { BedStatusHistory } = await import('../../models/BedStatusHistory.js');
        await BedStatusHistory.create({
          hospitalId: admission.hospitalId,
          branchId: admission.branchId,
          bedId: dischargedBed._id,
          bedNumber: dischargedBed.bedNumber,
          patientId: admission.patientId,
          admissionId: admission._id,
          fromStatus: BED_STATUS.OCCUPIED,
          toStatus: BED_STATUS.CLEANING,
          changedBy: user?.id || user?._id,
          changedByName: user?.name || 'Staff User',
          reason: 'Patient discharged. Bed queued for housekeeping cleaning and sanitization.',
        });
      } catch (e) {
        console.error('[Discharge/BedStatusHistory]', e.message);
      }

      socketManager.emitToBranch(admission.branchId, 'bed:status_changed', {
        bedId: dischargedBed._id,
        bedNumber: dischargedBed.bedNumber,
        status: BED_STATUS.CLEANING,
      });
    }

    for (const recipient of dischargeRecipients) {
      await notifyAdmissionAssignee({
        admission,
        recipientUserId: recipient.id,
        recipientRole: recipient.role,
        actionType: 'VIEW_IPD_DISCHARGE',
        title: `Patient discharged: ${admission.patientName}`,
        message: `${admission.patientName} (${admission.uhid}) has been discharged. Bed ${admission.bedNumber} is awaiting cleaning.`,
      });
    }

    return admission;
  }

  /**
   * Assign or update a care team member for an admission.
   * Automatically closes any existing active assignment for the same role before adding the new one.
   */
  static async assignCareTeam(admissionId, assignments, user) {
    const hospitalId = requireHospitalContext(user);
    const admission = await Admission.findOne({ _id: admissionId, hospitalId });
    if (!admission) {
      throw new ApiError(404, 'Admission not found', null, 'NOT_FOUND');
    }
    if (admission.status === 'DISCHARGED') {
      throw new ApiError(400, 'Cannot modify care team for a discharged admission.', null, 'ADMISSION_DISCHARGED');
    }

    const results = [];
    for (const assignment of assignments) {
      const { role, userId, notes } = assignment;

      if (!role || !userId) continue;

      const staffUser = await User.findOne({ _id: userId, hospitalId: admission.hospitalId, isActive: true });
      if (!staffUser) continue;

      // Close existing active assignment for this role
      await CareTeamAssignment.updateMany(
        { admissionId, hospitalId, role, removedAt: null },
        {
          $set: {
            removedAt: new Date(),
            removedBy: user._id || user.id,
            removedByName: user.name || 'System',
            removalReason: 'Replaced by new assignment',
          }
        }
      );

      const newAssignment = await CareTeamAssignment.create({
        hospitalId: admission.hospitalId,
        branchId: admission.branchId,
        admissionId,
        patientId: admission.patientId,
        uhid: admission.uhid,
        role,
        userId: staffUser._id,
        userName: staffUser.name,
        userRole: staffUser.role,
        department: staffUser.assignedUnit || staffUser.specialization || '',
        assignedAt: new Date(),
        assignedBy: user._id || user.id,
        assignedByName: user.name || 'System',
        notes: notes || '',
      });

      results.push(newAssignment);

      await notifyAdmissionAssignee({
        admission,
        recipientUserId: staffUser._id,
        recipientRole: staffUser.role,
        actionType: 'VIEW_CARE_TEAM_ASSIGNMENT',
        title: `IPD care-team assignment: ${admission.patientName}`,
        message: `You were assigned as ${role.replaceAll('_', ' ').toLowerCase()} for ${admission.patientName} (${admission.uhid}).`,
      });

      // Update Admission quick-reference fields
      if (role === 'PRIMARY_DOCTOR') {
        await Admission.updateOne({ _id: admissionId, hospitalId }, { $set: { doctorId: staffUser._id, doctorName: staffUser.name } });
      } else if (role === 'NURSE' || role === 'DUTY_NURSE') {
        const field = role === 'DUTY_NURSE' ? 'dutyNurseId' : 'assignedNurseId';
        await Admission.updateOne({ _id: admissionId, hospitalId }, { $set: { [field]: staffUser._id } });
      } else if (role === 'CARETAKER') {
        await Admission.updateOne({ _id: admissionId, hospitalId }, { $set: { assignedCaretakerId: staffUser._id } });
      } else if (role === 'CONSULTING_DOCTOR') {
        await Admission.updateOne({ _id: admissionId, hospitalId }, { $addToSet: { consultingDoctorIds: staffUser._id } });
      }

      // Notify the newly assigned staff member via socket
      socketManager.emitToUser(String(staffUser._id), 'care_team:assigned', {
        admissionId,
        role,
        patientName: admission.patientName,
        uhid: admission.uhid,
        assignedAt: new Date(),
      });
    }

    // Mark care team as assigned if we have at least a doctor and nurse
    const activeDoctorCount = await CareTeamAssignment.countDocuments({ admissionId, hospitalId, role: 'PRIMARY_DOCTOR', removedAt: null });
    const activeNurseCount = await CareTeamAssignment.countDocuments({ admissionId, hospitalId, role: { $in: ['NURSE', 'DUTY_NURSE'] }, removedAt: null });
    if (activeDoctorCount > 0 && activeNurseCount > 0) {
      await Admission.updateOne({ _id: admissionId, hospitalId }, { $set: { careTeamAssigned: true } });
    }

    return results;
  }

  /**
   * Get full care team for an admission — current active + history.
   */
  static async getCareTeam(admissionId, user) {
    const hospitalId = requireHospitalContext(user);
    const admissionExists = await Admission.exists({ _id: admissionId, hospitalId });
    if (!admissionExists) throw new ApiError(404, 'Admission not found', null, 'NOT_FOUND');
    const active = await CareTeamAssignment.find({ admissionId, hospitalId, removedAt: null })
      .populate('userId', 'name role specialization phone avatarUrl')
      .sort({ assignedAt: -1 });

    const history = await CareTeamAssignment.find({ admissionId, hospitalId, removedAt: { $ne: null } })
      .populate('userId', 'name role specialization phone')
      .sort({ removedAt: -1 })
      .limit(50);

    return { active, history };
  }
}
