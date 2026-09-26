import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';
import { encryptedFieldsPlugin } from '../plugins/encryptedFieldsPlugin.js';

const consultationSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vitals: {
      bp: { type: String, default: '120/80' },
      pulse: { type: Number, default: 72 },
      spo2: { type: Number, default: 98 },
      temperature: { type: Number, default: 98.6 },
      weightKg: { type: Number, default: 70 },
    },
    // 10 Real Hospital Consultation Sections
    chiefComplaints: { type: String, required: true },
    historyOfPresentIllness: { type: String, default: '' },
    clinicalExamination: { type: String, default: '' },
    provisionalDiagnosis: { type: String, default: '' },
    finalDiagnosis: { type: String, default: '' },
    treatmentPlan: { type: String, default: '' },
    doctorsNotes: { type: String, default: '' },
    prescriptions: [
      {
        medicineName: { type: String, required: true },
        dosage: { type: String, default: '1 Tablet' },
        frequency: { type: String, default: 'TWICE_DAILY' },
        durationDays: { type: Number, default: 5 },
        timing: { type: String, enum: ['BEFORE_FOOD', 'AFTER_FOOD', 'WITH_FOOD', 'STAT', 'AS_DIRECTED'], default: 'AFTER_FOOD' },
        instructions: { type: String, default: '' },
      },
    ],
    consultationFee: { type: Number, default: 0.0 },
    emergencyFee: { type: Number, default: 0 },
    doctorProcedureCharges: [
      {
        description: { type: String, default: 'General Procedure' },
        amount: { type: Number, default: 0 },
      },
    ],
    followUpDate: { type: Date },
    adviceToPatient: { type: String, default: '' },
    status: { type: String, enum: ['DRAFT', 'FINALIZED', 'COMPLETED'], default: 'FINALIZED' },
  },
  { timestamps: true }
);

consultationSchema.plugin(encryptedFieldsPlugin, {
  fields: [
    'chiefComplaints',
    'historyOfPresentIllness',
    'clinicalExamination',
    'provisionalDiagnosis',
    'finalDiagnosis',
    'treatmentPlan',
    'doctorsNotes',
    'adviceToPatient',
  ],
});

// High-speed compound indexes for clinical histories and doctor consultation rosters
consultationSchema.index({ hospitalId: 1, doctorId: 1, createdAt: -1 });
consultationSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
consultationSchema.index({ hospitalId: 1, createdAt: -1 });

export const Consultation = tenantAwareModel(mongoose.model('Consultation', consultationSchema));
