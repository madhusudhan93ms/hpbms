import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';
import { PATIENT_CATEGORIES } from '../config/constants.js';
import { encryptedFieldsPlugin } from '../plugins/encryptedFieldsPlugin.js';

const patientSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    uhid: { type: String, required: true, uppercase: true, trim: true },
    // Global identity — links this hospital-specific record to the real-world person
    globalPatientId: { type: mongoose.Schema.Types.ObjectId, ref: 'GlobalPatient', default: null, index: true },
    // Admission tracking
    admissionStatus: {
      type: String,
      enum: ['NEVER_ADMITTED', 'ACTIVE_ADMISSION', 'DISCHARGED'],
      default: 'NEVER_ADMITTED',
      index: true,
    },
    activeAdmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admission', default: null },
    admissionCount: { type: Number, default: 0 }, // total admissions ever in this hospital
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: '', trim: true },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], default: 'MALE' },
    age: { type: Number },
    dob: { type: Date, default: null },
    chiefComplaints: { type: String, default: '' },
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'O_POSITIVE', 'O_NEGATIVE', 'A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', '', null, 'UNKNOWN'],
      default: ''
    },
    phone: { type: String, default: '', trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    nationalId: { type: String, default: '' },
    address: { type: String, default: 'General Registration' },
    city: { type: String, default: 'Main City' },
    allergies: [{ type: String }],
    emergencyContact: {
      name: { type: String, default: 'Self / N/A' },
      phone: { type: String, default: '+1 (555) 000-0000' },
      relation: { type: String, default: 'Family' },
    },
    category: { type: String, enum: Object.values(PATIENT_CATEGORIES), default: PATIENT_CATEGORIES.GENERAL },
    qrCodeUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

patientSchema.index({ hospitalId: 1, uhid: 1 }, { unique: true });
patientSchema.index({ hospitalId: 1, phone: 1 });
patientSchema.index({ hospitalId: 1, createdAt: -1 });
patientSchema.index({ hospitalId: 1, isActive: 1, createdAt: -1 });
patientSchema.index({ hospitalId: 1, admissionStatus: 1 });

patientSchema.plugin(encryptedFieldsPlugin, {
  fields: ['chiefComplaints', 'nationalId', 'address', 'emergencyContact.name', 'emergencyContact.phone'],
});

export const Patient = tenantAwareModel(mongoose.model('Patient', patientSchema));
