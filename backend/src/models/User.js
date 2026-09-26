import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ROLES } from '../config/constants.js';
import { syncUserAcrossDirectoryAndTenant } from '../config/userDirectorySync.js';

const userSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', index: true },
    departmentId: { type: mongoose.Schema.Types.Mixed },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: false, sparse: true, lowercase: true, trim: true, default: null },
    phone: { type: String, trim: true, default: '' },
    loginIds: [{ type: String, trim: true, index: true }],
    passwordHash: { type: String, required: true, select: false },
    // Legacy cleanup-only field. Never return recoverable passwords.
    assignedPasswordHint: { type: String, default: '', select: false },
    role: { type: String, required: true, enum: Object.values(ROLES), index: true },
    additionalRoles: [{ type: String }],
    additionalDepartments: [{ type: mongoose.Schema.Types.Mixed }],
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    specialization: { type: String, default: '' },
    medicalLicenseNo: { type: String, default: '' },
    qualification: { type: String, default: '' },
    consultationFee: { type: Number, default: 0 },
    shiftPattern: { type: String, default: 'ROTATIONAL' },
    avatarUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },       // Staff on-duty / availability toggle
    adminDepartmentAvailability: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        DOCTOR: true,
        RECEPTIONIST: true,
        CASHIER: true,
        PHARMACIST: true,
        LAB_TECH: true,
        RADIOLOGIST: true,
        NURSE: true,
        EMERGENCY_STAFF: true,
      }),
    },
    availabilityUpdatedAt: { type: Date, default: null }, // When availability was last changed
    cabinNo: { type: String, default: 'Cabin 101' },     // Doctor's assigned OPD cabin/room number
    employeeId: { type: String, default: '' },
    designation: { type: String, default: '' },
    assignedUnit: { type: String, default: '' },
    shiftDetails: { type: String, default: '' },
    permissions: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    revokedPermissions: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    permissionUpdatedAt: { type: Date, default: null },
    permissionUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastLoginAt: { type: Date },

    // Email Verification & Password Reset Security (Exempt from API responses)
    isEmailVerified: { type: Boolean, default: true }, // Default true for seed/admin users, updated dynamically for registrations
    emailVerificationToken: { type: String, default: null, select: false },
    emailVerificationExpires: { type: Date, default: null, select: false },
    passwordResetToken: { type: String, default: null, select: false },
    passwordResetExpires: { type: Date, default: null, select: false },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        delete ret.passwordHash;
        delete ret.assignedPasswordHint;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        delete ret.passwordHash;
        delete ret.assignedPasswordHint;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
  }
);

// High-speed compound indexes for tenant-scoped staff, admin, and role resolution
userSchema.index({ hospitalId: 1, role: 1, isActive: 1 });
userSchema.index({ hospitalId: 1, createdAt: -1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  // Prevent double hashing if passwordHash is already a valid bcrypt hash
  if (/^\$2[abxy]\$\d+\$/.test(this.passwordHash)) {
    return next();
  }
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  next();
});

userSchema.post('save', async function syncIdentityDirectory(document) {
  await syncUserAcrossDirectoryAndTenant(document);
});

userSchema.post('findOneAndUpdate', async function syncUpdatedIdentity(document) {
  if (document) await syncUserAcrossDirectoryAndTenant(document);
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  if (!enteredPassword || typeof enteredPassword !== 'string' || !this.passwordHash) return false;
  try {
    return await bcrypt.compare(enteredPassword, this.passwordHash);
  } catch {
    return false;
  }
};

userSchema.methods.generateAccessToken = function () {
  const hId = this.hospitalId?._id ? this.hospitalId._id.toString() : (this.hospitalId ? String(this.hospitalId) : null);
  const bId = this.branchId?._id ? this.branchId._id.toString() : (this.branchId ? String(this.branchId) : null);
  const hDomain = this.hospitalId?.domain || this.hospitalId?.subdomain || null;
  return jwt.sign(
    {
      id: this._id,
      hospitalId: hId,
      branchId: bId,
      hospitalDomain: hDomain,
      role: this.role,
      email: this.email,
      name: this.name,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { id: this._id },
    env.REFRESH_TOKEN_SECRET || env.JWT_REFRESH_SECRET || env.JWT_SECRET || 'dev_secret',
    { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN || env.JWT_REFRESH_EXPIRES_IN || '90d' }
  );
};

export const User = tenantAwareModel(mongoose.model('User', userSchema));
