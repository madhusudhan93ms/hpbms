import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';
import { encryptedFieldsPlugin } from '../plugins/encryptedFieldsPlugin.js';

const appointmentSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    departmentId: { type: mongoose.Schema.Types.Mixed },
    appointmentNo: { type: String, required: true },
    tokenNumber: { type: Number, required: true },
    appointmentDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    type: { type: String, enum: ['OPD', 'FOLLOW_UP', 'EMERGENCY'], default: 'OPD' },
    status: { type: String, enum: ['WAITING', 'IN_CONSULTATION', 'WAITING_DEPARTMENT', 'WAITING_NURSE', 'WAITING_PHARMACY', 'HOLD', 'COMPLETED', 'CANCELLED'], default: 'WAITING', index: true },
    departmentReturnedAt: { type: Date, default: null },
    chiefComplaints: { type: String, default: '' },
    cabinNo: { type: String, default: 'Cabin 102' },
  },
  { timestamps: true }
);

appointmentSchema.index({ branchId: 1, doctorId: 1, appointmentDate: 1, tokenNumber: 1 });
appointmentSchema.index({ hospitalId: 1, doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ hospitalId: 1, appointmentDate: 1 });
appointmentSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });
appointmentSchema.index({ hospitalId: 1, createdAt: -1 });
appointmentSchema.plugin(encryptedFieldsPlugin, { fields: ['chiefComplaints'] });

export const Appointment = tenantAwareModel(mongoose.model('Appointment', appointmentSchema));
