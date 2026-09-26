import mongoose from 'mongoose';
import { Emergency } from '../../models/Emergency.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { socketManager } from '../../events/socketManager.js';
import { requireHospitalContext } from '../../utils/tenantContext.js';
import { ApiError } from '../../utils/apiError.js';

export class EmergencyService {
  static async raiseEmergency(data, user) {
    const hospitalId = requireHospitalContext(user);
    let branchId = user?.branchId?._id || user?.branchId;

    if (!branchId) {
      const defaultBranch = await Branch.findOne({ hospitalId });
      branchId = defaultBranch?._id;
    }

    let patientName = data.patientName || 'Unknown / Unidentified';
    let uhid = data.uhid || 'N/A';

    if (data.patientId) {
      const patient = await Patient.findOne({ _id: data.patientId, hospitalId })
        .select('firstName lastName uhid')
        .lean();
      if (patient) {
        patientName = `${patient.firstName} ${patient.lastName}`;
        uhid = patient.uhid;
      }
    }

    const newEmergency = await Emergency.create({
      hospitalId,
      branchId,
      emergencyType: data.emergencyType || 'CODE_BLUE',
      severity: data.severity || 'CRITICAL',
      raisedByDept: data.raisedByDept || user?.role || 'RECEPTIONIST',
      raisedByUserId: user?.id || user?._id,
      raisedByUserName: user?.name || 'Hospital Staff',
      patientId: data.patientId || null,
      patientName,
      uhid,
      location: data.location || 'General Ward / OPD Area',
      description: data.description || 'Immediate emergency medical response required!',
      status: 'ACTIVE',
      timeline: [
        {
          status: 'ACTIVE',
          timestamp: new Date(),
          updatedBy: user?.name || 'Hospital Staff',
          notes: `Emergency '${data.emergencyType || 'CODE_BLUE'}' raised by ${user?.name || 'Staff'} at ${data.location || 'Location'}`,
        },
      ],
    });

    const emergencyPayload = {
      _id: newEmergency._id,
      emergencyId: newEmergency._id,
      emergencyType: newEmergency.emergencyType,
      severity: newEmergency.severity,
      location: newEmergency.location,
      patientName: newEmergency.patientName,
      uhid: newEmergency.uhid,
      raisedBy: newEmergency.raisedByUserName,
      raisedByUserName: newEmergency.raisedByUserName,
      raisedByDept: newEmergency.raisedByDept,
      description: newEmergency.description,
      createdAt: newEmergency.createdAt,
      hospitalId: newEmergency.hospitalId,
      branchId: newEmergency.branchId,
      status: 'ACTIVE',
    };

    // Broadcast workflow emergency event across the entire facility
    await WorkflowEventService.emit(WORKFLOW_EVENTS.EMERGENCY_RAISED, emergencyPayload, branchId);
    socketManager.emitEmergency('emergency:alert', emergencyPayload, { hospitalId, branchId });
    if (branchId) {
      socketManager.emitToBranch(branchId, 'emergency:alert', emergencyPayload);
      socketManager.emitToBranch(branchId, 'emergency:raised', emergencyPayload);
    }

    return newEmergency;
  }

  static async resolveEmergency(id, data, user) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, `Invalid emergency ID format: '${id}'. The ID must be a valid MongoDB ObjectId. Please reload the emergency console to fetch live data.`, null, 'INVALID_ID');
    }

    const hospitalId = requireHospitalContext(user);
    const emergency = await Emergency.findOne({ _id: id, hospitalId });
    if (!emergency) {
      throw new ApiError(404, 'Emergency record not found. It may have already been resolved.', null, 'NOT_FOUND');
    }

    if (emergency.status === 'RESOLVED') {
      return emergency;
    }

    emergency.status = 'RESOLVED';
    emergency.resolvedAt = new Date();
    emergency.resolvedByUserId = user?.id || user?._id;
    emergency.resolvedByUserName = user?.name || 'Emergency Responder';
    emergency.resolutionNotes = data.resolutionNotes || 'Emergency condition resolved and stabilized.';

    emergency.timeline.push({
      status: 'RESOLVED',
      timestamp: new Date(),
      updatedBy: user?.name || 'Emergency Responder',
      notes: data.resolutionNotes || 'Emergency stabilized and marked as resolved.',
    });

    await emergency.save();

    const resolutionPayload = {
      hospitalId: emergency.hospitalId,
      branchId: emergency.branchId,
      _id: emergency._id,
      emergencyId: emergency._id,
      emergencyType: emergency.emergencyType,
      location: emergency.location,
      resolvedBy: emergency.resolvedByUserName,
      resolutionNotes: emergency.resolutionNotes,
      resolvedAt: emergency.resolvedAt,
      status: 'RESOLVED',
    };

    // Broadcast resolution event to ALL connected roles
    await WorkflowEventService.emit(WORKFLOW_EVENTS.EMERGENCY_RESOLVED, resolutionPayload, emergency.branchId);
    socketManager.emitEmergency('emergency:resolved', resolutionPayload, { hospitalId: emergency.hospitalId, branchId: emergency.branchId });
    if (emergency.branchId) {
      socketManager.emitToBranch(emergency.branchId, 'emergency:resolved', resolutionPayload);
    }

    return emergency;
  }

  static async getActiveEmergencies(user) {
    const hospitalId = user?.role === 'SUPER_ADMIN'
      ? (user?.hospitalId?._id || user?.hospitalId || null)
      : requireHospitalContext(user);
    const filter = hospitalId
      ? { hospitalId, status: { $in: ['ACTIVE', 'RESPONDED'] } }
      : { status: { $in: ['ACTIVE', 'RESPONDED'] } };
    return await Emergency.find(filter).sort({ createdAt: -1 }).lean({ getters: true });
  }

  static async getEmergencyHistory(user) {
    const hospitalId = user?.role === 'SUPER_ADMIN'
      ? (user?.hospitalId?._id || user?.hospitalId || null)
      : requireHospitalContext(user);
    const filter = hospitalId ? { hospitalId } : {};
    return await Emergency.find(filter).sort({ createdAt: -1 }).limit(100).lean({ getters: true });
  }
}
