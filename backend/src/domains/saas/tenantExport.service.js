import mongoose from 'mongoose';
import '../../models/index.js';

import { Hospital } from '../../models/Hospital.js';
import { ApiError } from '../../utils/apiError.js';
import { getTenantConnection } from '../../config/tenantDatabase.js';
import { tenantOwnedModels } from './tenantMigration.service.js';

const SECRET_FIELDS = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'resetPasswordToken',
  'resetPasswordExpires',
  'emailVerificationToken',
  'verificationToken',
  'otp',
  'otpHash',
]);

export const safeExportJson = (value) => JSON.stringify(value, (key, item) => (
  SECRET_FIELDS.has(key) ? undefined : item
));

const assertExportAccess = (hospital, user) => {
  const role = user?.role;
  if (role === 'SUPER_ADMIN') return;
  const userHospitalId = user?.hospitalId?._id || user?.hospitalId;
  if (role !== 'HOSPITAL_ADMIN' || String(userHospitalId || '') !== String(hospital._id)) {
    throw new ApiError(403, 'You may export only the hospital tenant you administer.');
  }
};

const exportMetadata = (hospital) => ({
  id: hospital._id,
  code: hospital.code,
  name: hospital.name,
  domain: hospital.domain,
  status: hospital.status,
  plan: hospital.plan,
  storageMode: hospital.storageMode,
  exportedAt: new Date().toISOString(),
  format: 'HMS_TENANT_NDJSON_V1',
});

export class TenantExportService {
  static async open(hospitalId, user) {
    if (!mongoose.Types.ObjectId.isValid(String(hospitalId || ''))) {
      throw new ApiError(400, 'A valid hospital id is required.');
    }

    // Hospital is platform metadata and intentionally comes from the platform DB.
    const hospital = await Hospital.findById(hospitalId).lean();
    if (!hospital || hospital.isDeleted) throw new ApiError(404, 'Hospital not found.');
    assertExportAccess(hospital, user);

    const connection = hospital.storageMode === 'DEDICATED'
      ? getTenantConnection(hospital)
      : mongoose.connection;

    const collections = Array.from(new Map(
      tenantOwnedModels().map((model) => [model.collection.collectionName, model]),
    ).entries()).sort(([a], [b]) => a.localeCompare(b));

    return {
      hospital,
      metadata: exportMetadata(hospital),
      async *records() {
        for (const [collectionName] of collections) {
          const cursor = connection.collection(collectionName)
            .find({ hospitalId: { $in: [hospital._id, String(hospital._id)] } })
            .batchSize(250);
          for await (const document of cursor) {
            yield { collection: collectionName, document };
          }
        }
      },
    };
  }

  static async exportPatientsCsv(hospitalId, user) {
    if (!mongoose.Types.ObjectId.isValid(String(hospitalId || ''))) {
      throw new ApiError(400, 'A valid hospital id is required.');
    }
    const hospital = await Hospital.findById(hospitalId).lean();
    if (!hospital || hospital.isDeleted) throw new ApiError(404, 'Hospital not found.');
    assertExportAccess(hospital, user);

    const connection = hospital.storageMode === 'DEDICATED'
      ? getTenantConnection(hospital)
      : mongoose.connection;

    const patients = await connection.collection('patients')
      .find({ hospitalId: { $in: [hospital._id, String(hospital._id)] } })
      .sort({ createdAt: -1 })
      .toArray();

    return { hospital, patients };
  }
}
