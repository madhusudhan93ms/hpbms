import mongoose from 'mongoose';
import { tenantAwareModel } from '../config/tenantAwareModel.js';

const branchSchema = new mongoose.Schema(
  {
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, index: true },
    name: { type: String, required: true, trim: true },
    branchCode: { type: String, required: true, uppercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    isMainBranch: { type: Boolean, default: false },
    plan: {
      type: String,
      enum: ['BASIC', 'STANDARD', 'UNLIMITED', 'PROFESSIONAL', 'ENTERPRISE', 'STARTER'],
      default: 'BASIC',
    },
    billingCycle: {
      type: String,
      enum: ['MONTHLY', 'YEARLY'],
      default: 'MONTHLY',
    },
    subscriptionStartDate: { type: Date, default: Date.now },
    subscriptionEndDate: { type: Date },
    isTrial: { type: Boolean, default: false },
    trialEndDate: { type: Date },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING'], default: 'ACTIVE' },
    subscriptionHistory: [
      {
        plan: { type: String },
        billingCycle: { type: String },
        amount: { type: Number },
        paymentMethod: { type: String },
        paymentRef: { type: String },
        paidAt: { type: Date },
        renewalNote: { type: String },
        renewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    settings: {
      currencySymbol: { type: String, default: '₹' },
      thermalPrinterWidth: { type: Number, default: 80 },
      autoApproveLabReports: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

branchSchema.index({ hospitalId: 1, branchCode: 1 }, { unique: true });
branchSchema.index({ hospitalId: 1, isMainBranch: -1, createdAt: 1 });

export const Branch = tenantAwareModel(mongoose.model('Branch', branchSchema));
