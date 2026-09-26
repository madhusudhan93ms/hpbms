import { Appointment } from '../../models/Appointment.js';
import { Patient } from '../../models/Patient.js';
import { User } from '../../models/User.js';
import { socketManager } from '../../events/socketManager.js';
import { WorkflowEventService, WORKFLOW_EVENTS } from '../../events/workflowEventService.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ApiError } from '../../utils/apiError.js';
import { requireBranchContext, requireHospitalContext } from '../../utils/tenantContext.js';

export const FIFO_QUEUE_SORT = { appointmentDate: 1, tokenNumber: 1, createdAt: 1, _id: 1 };

export class AppointmentsService {
  static DOCTOR_SAFE_FIELDS = '_id name email phone role departmentId specialization cabinNo isAvailable consultationFee';
  static PATIENT_SAFE_FIELDS = '_id firstName lastName uhid gender age phone bloodGroup category admissionStatus emergencyContact allergies vitals';

  static async issueToken(data, user) {
    const hospitalId = requireHospitalContext(user);
    const branchId = requireBranchContext(user);

    // Bulletproof Doctor Resolution & Availability Check
    let doctor = null;
    if (user?.role === 'DOCTOR' || (Array.isArray(user?.additionalRoles) && user?.additionalRoles.includes('DOCTOR'))) {
      doctor = await User.findOne({ _id: user.id || user._id, hospitalId, $or: [{ branchId }, { branchId: null }] });
    }
    if (!doctor && data.doctorId) {
      doctor = await User.findOne({ _id: data.doctorId, hospitalId, $or: [{ branchId }, { branchId: null }] });
      if (doctor) {
        const isDoc = doctor.role === 'DOCTOR' || (Array.isArray(doctor.additionalRoles) && doctor.additionalRoles.includes('DOCTOR'));
        if (!isDoc) {
          throw new ApiError(400, 'The selected staff member does not have doctor privileges.', null, 'INVALID_DOCTOR');
        }
        if (doctor.isActive === false || doctor.status === 'INACTIVE') {
          throw new ApiError(400, 'This doctor account is currently inactive.', null, 'DOCTOR_INACTIVE');
        }
        if (doctor.isAvailable === false) {
          throw new ApiError(400, 'This doctor is currently offline/unavailable. Please select an available doctor.', null, 'DOCTOR_UNAVAILABLE');
        }
      }
    }
    if (!doctor) {
      doctor = await User.findOne({
        hospitalId,
        $or: [{ branchId }, { branchId: null }],
        $or: [{ role: 'DOCTOR' }, { additionalRoles: 'DOCTOR' }],
        isAvailable: { $ne: false },
        isActive: { $ne: false },
        status: { $ne: 'INACTIVE' },
      });
    }

    if (!doctor) {
      throw new ApiError(400, 'No active/available doctor exists in system to assign token. Please select an available doctor.', null, 'NO_DOCTOR_AVAILABLE');
    }

    // Find Patient or create walk-in patient
    let patient = null;

    if (data.patientId) {
      patient = await Patient.findOne({ _id: data.patientId, hospitalId })
        .select(this.PATIENT_SAFE_FIELDS)
        .lean({ getters: true });
    } else if (data.uhid) {
      patient = await Patient.findOne({ hospitalId, uhid: data.uhid.toUpperCase() })
        .select(this.PATIENT_SAFE_FIELDS)
        .lean({ getters: true });
    }
    if (!patient) {
      const count = await Patient.countDocuments({ hospitalId });
      const seq = String(count + 1).padStart(5, '0');
      const year = new Date().getFullYear();
      const uhid = `HOSP-${year}-${seq}`;

      patient = await Patient.create({
        hospitalId,
        branchId,
        uhid,
        firstName: data.patientName || 'Walk-in Patient',
        lastName: `(${uhid})`,
        gender: 'MALE',
        dob: new Date('1995-01-01'),
        phone: data.phone || '+1 (555) 000-0000',
        address: 'Walk-in Registration Counter',
        city: 'Main City',
        emergencyContact: {
          name: data.patientName || 'Self / Walk-in',
          phone: data.phone || '+1 (555) 000-0000',
          relation: 'Self',
        },
      });
    }

    // Calculate today's token number
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTokens = await Appointment.countDocuments({
      hospitalId,
      appointmentDate: todayStr,
    });

    const tokenNumber = todayTokens + 1;
    const appointmentNo = `APT-${todayStr.replace(/-/g, '')}-${tokenNumber}`;

    const appointment = await Appointment.create({
      hospitalId: hospitalId || doctor.hospitalId,
      branchId: branchId || doctor.branchId,
      patientId: patient._id,
      doctorId: doctor._id,
      departmentId: doctor.departmentId || branchId || doctor.branchId,
      appointmentNo,
      tokenNumber,
      appointmentDate: todayStr,
      status: 'WAITING', // Strictly WAITING until doctor consults
      chiefComplaints: data.chiefComplaints || 'OPD Check-up',
      cabinNo: doctor.cabinNo || 'Cabin 102',
    });

    // Notify connected Doctor Workstations & Queue TV displays
    const queuePayload = {
      appointmentId: appointment._id,
      doctorId: doctor._id,
      doctorName: doctor.name,
      tokenNumber,
      patientName: `${patient.firstName} ${patient.lastName}`,
      senderUserId: user?.id || user?._id,
      uhid: patient.uhid,
      linkedPath: `/doctor/dashboard?tab=LIVE&appointmentId=${appointment._id}&patientId=${patient._id}`,
      timestamp: new Date(),
    };

    const targetBranch = String(branchId || doctor.branchId || '');
    if (targetBranch) {
      socketManager.emitToBranch(targetBranch, 'opd_queue:updated', queuePayload);
      socketManager.emitToBranch(targetBranch, 'queue:patient_added', queuePayload);
      socketManager.emitToBranch(targetBranch, 'token:generated', queuePayload);
    }

    // Always deliver directly to the specific doctor's private socket room
    socketManager.emitToUser(String(doctor._id), 'opd_queue:updated', queuePayload);
    socketManager.emitToUser(String(doctor._id), 'queue:patient_added', queuePayload);
    socketManager.emitToUser(String(doctor._id), 'token:generated', queuePayload);

    await WorkflowEventService.emit(WORKFLOW_EVENTS.PATIENT_QUEUED, {
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      uhid: patient.uhid,
      tokenNumber,
      doctorId: doctor._id,
      doctorName: doctor.name,
      hospitalId: hospitalId || doctor.hospitalId,
      branchId: branchId || doctor.branchId,
      appointmentId: appointment._id,
      linkedPath: `/doctor/dashboard?tab=LIVE&appointmentId=${appointment._id}&patientId=${patient._id}`,
    }, branchId || doctor.branchId);

    return await Appointment.findById(appointment._id)
      .populate('patientId', this.PATIENT_SAFE_FIELDS)
      .populate('doctorId', this.DOCTOR_SAFE_FIELDS)
      .lean({ getters: true });
  }

  static async generateOpdToken(data, user) {
    const hospitalId = requireHospitalContext(user);
    const branchId = data.branchId || user?.branchId;

    const [patient, doctor] = await Promise.all([
      Patient.findOne({ _id: data.patientId, hospitalId })
        .select('firstName lastName uhid')
        .lean(),
      User.findOne({ _id: data.doctorId, hospitalId, role: 'DOCTOR' })
        .select('name cabinNo departmentId branchId consultationFee')
        .lean(),
    ]);

    if (!patient) {
      throw new ApiError(404, 'Patient record not found', null, 'NOT_FOUND');
    }
    if (!doctor) {
      throw new ApiError(404, 'Doctor not found in this hospital', null, 'NOT_FOUND');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const countToday = await Appointment.countDocuments({
      hospitalId,
      doctorId: doctor._id,
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });

    const tokenNumber = countToday + 1;
    const appointmentNo = `APT-${Date.now().toString().slice(-6)}-${tokenNumber}`;

    const appointment = await Appointment.create({
      hospitalId,
      branchId: branchId || doctor.branchId,
      patientId: patient._id,
      doctorId: doctor._id,
      departmentId: data.departmentId || doctor.departmentId || 'OPD',
      appointmentNo,
      tokenNumber,
      tokenType: data.tokenType || 'STANDARD',
      appointmentDate: new Date(),
      status: 'WAITING',
      queuePriority: data.queuePriority || 0,
      fee: data.fee !== undefined ? data.fee : (doctor.consultationFee || 0),
      paymentStatus: data.paymentStatus || 'PENDING',
      notes: data.notes || '',
      registeredBy: user?.id || user?._id,
    });

    const queuePayload = {
      appointmentId: appointment._id,
      tokenNumber,
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      uhid: patient.uhid,
      doctorId: doctor._id,
      doctorName: doctor.name,
      cabinNo: doctor.cabinNo || 'Cabin 101',
      status: 'WAITING',
      tokenType: appointment.tokenType,
      createdAt: appointment.createdAt,
    };

    if (appointment.branchId) {
      socketManager.emitToBranch(appointment.branchId, 'opd_queue:patient_added', queuePayload);
    }
    socketManager.emitToUser(String(doctor._id), 'queue:patient_added', queuePayload);
    socketManager.emitToUser(String(doctor._id), 'token:generated', queuePayload);

    await WorkflowEventService.emit(WORKFLOW_EVENTS.PATIENT_QUEUED, {
      patientId: patient._id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      uhid: patient.uhid,
      tokenNumber,
      doctorId: doctor._id,
      doctorName: doctor.name,
      hospitalId: hospitalId,
      branchId: branchId || doctor.branchId,
      appointmentId: appointment._id,
      linkedPath: `/doctor/dashboard?tab=LIVE&appointmentId=${appointment._id}&patientId=${patient._id}`,
    }, branchId || doctor.branchId);

    return await Appointment.findById(appointment._id)
      .populate('patientId', this.PATIENT_SAFE_FIELDS)
      .populate('doctorId', this.DOCTOR_SAFE_FIELDS)
      .lean({ getters: true });
  }

  static async getOpdQueue(user, doctorId = null) {
    const hospitalId = requireHospitalContext(user);

    const targetDocId = doctorId || user?.id || user?._id;

    const filter = {
      hospitalId,
      status: { $in: ['WAITING', 'IN_CONSULTATION', 'WAITING_NURSE', 'WAITING_DEPARTMENT', 'HOLD', 'COMPLETED'] },
    };

    if (targetDocId) {
      filter.doctorId = targetDocId;
    }

    return await Appointment.find(filter)
      .populate('patientId', this.PATIENT_SAFE_FIELDS)
      .populate('doctorId', this.DOCTOR_SAFE_FIELDS)
      .sort(FIFO_QUEUE_SORT)
      .lean({ getters: true });
  }

  static async updateTokenStatus(appointmentId, status, user) {
    const hospitalId = requireHospitalContext(user);
    const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId })
      .populate('patientId', this.PATIENT_SAFE_FIELDS)
      .populate('doctorId', this.DOCTOR_SAFE_FIELDS);
    if (!appointment) {
      throw new ApiError(404, 'OPD token appointment not found', null, 'NOT_FOUND');
    }

    appointment.status = status;
    await appointment.save();

    if (appointment.branchId) {
      socketManager.emitToBranch(appointment.branchId, 'opd_queue:status_changed', {
        appointmentId,
        status,
        tokenNumber: appointment.tokenNumber,
      });
    }

    const pName = appointment.patientId ? `${appointment.patientId.firstName || ''} ${appointment.patientId.lastName || ''}`.trim() : 'Patient';
    const uhid = appointment.patientId?.uhid || 'N/A';
    const docName = appointment.doctorId?.name || user?.name || 'Doctor';

    if (status === 'IN_CONSULTATION') {
      await WorkflowEventService.emit(WORKFLOW_EVENTS.DOCTOR_ACCEPTED_PATIENT, {
        patientName: pName,
        senderUserId: user?.id || user?._id,
        uhid,
        doctorName: docName,
        hospitalId,
        branchId: appointment.branchId,
        appointmentId: appointment._id,
        patientId: appointment.patientId?._id,
        linkedPath: '/reception/registered-patients?tab=QUEUED',
      }, appointment.branchId);
    } else if (status === 'COMPLETED' || status === 'CANCELLED') {
      if (status === 'COMPLETED') {
        await WorkflowEventService.emit(WORKFLOW_EVENTS.CONSULTATION_COMPLETE, {
          patientName: pName,
          senderUserId: user?.id || user?._id,
          uhid,
          doctorName: docName,
          hospitalId,
          branchId: appointment.branchId,
          appointmentId: appointment._id,
          patientId: appointment.patientId?._id,
          linkedPath: '/billing/dashboard',
        }, appointment.branchId);
      }
      try {
        await NotificationService.completeEntityTasks({
          hospitalId,
          entityType: 'Appointment',
          entityId: appointment._id,
          relatedPatientId: appointment.patientId?._id || appointment.patientId,
          branchId: appointment.branchId,
        });
      } catch (err) {
        console.warn('Failed to complete notifications on appointment status update:', err?.message);
      }
    }

    return appointment;
  }
}
