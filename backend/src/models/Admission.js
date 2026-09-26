import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';
import { encryptedFieldsPlugin } from '../plugins/encryptedFieldsPlugin.js';

const admissionSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    uhid: { type: String, required: true },
    patientName: { type: String, required: true },
    // Sequential admission number per patient per hospital (e.g. #001, #002)
    admissionNumber: { type: Number, default: 1 },
    admissionReference: { type: String, default: '' }, // e.g. 'ADM-HOSP-2026-00001-001'
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorName: { type: String, required: true, default: 'Dr. Gregory House' },
    // Consulting team
    consultingDoctorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    assignedNurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedCaretakerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dutyNurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Care team status
    careTeamAssigned: { type: Boolean, default: false },
    // Active authorized guardians for this admission
    activeGuardianIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    wardType: { type: String, default: 'GENERAL' },
    targetWardName: { type: String, default: 'Ward 3B - Inpatient' },
    blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'HospitalBlock', default: null },
    blockName: { type: String, default: '' },
    floorId: { type: mongoose.Schema.Types.ObjectId, ref: 'HospitalFloor', default: null },
    floorName: { type: String, default: '' },
    wardId: { type: mongoose.Schema.Types.ObjectId, ref: 'HospitalWard', default: null },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'HospitalRoom', default: null },
    roomNumber: { type: String, default: '' },
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bed' },
    bedNumber: { type: String, default: 'UNASSIGNED' },
    admissionReason: { type: String, required: true },
    dailyTariff: { type: Number, default: 150.0 },
    bedTariff: { type: Number, default: 0 },
    roomTariff: { type: Number, default: 0 },
    wardTariff: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['ADMISSION_REQUESTED', 'ADMITTED', 'DISCHARGED'],
      default: 'ADMISSION_REQUESTED',
      index: true,
    },
    admittedAt: { type: Date },
    assignedAt: { type: Date },
    dischargedAt: { type: Date },
  },
  { timestamps: true }
);

admissionSchema.plugin(encryptedFieldsPlugin, { fields: ['admissionReason'] });

// High-speed compound indexes for inpatient admission census and patient admission history
admissionSchema.index({ hospitalId: 1, status: 1 });
admissionSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
admissionSchema.index({ hospitalId: 1, createdAt: -1 });

export const Admission = tenantAwareModel(mongoose.model('Admission', admissionSchema));
