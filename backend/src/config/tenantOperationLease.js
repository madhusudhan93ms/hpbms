import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

const COLLECTION = 'tenantoperationleases';
let indexesReady = null;

const collection = () => {
  if (!mongoose.connection.db) throw new Error('MongoDB is not connected.');
  return mongoose.connection.collection(COLLECTION);
};

const ensureIndexes = async () => {
  if (!indexesReady) {
    indexesReady = Promise.all([
      collection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection().createIndex({ hospitalId: 1, expiresAt: 1 }),
      collection().createIndex({ requestId: 1 }, { unique: true }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  await indexesReady;
};

export const acquireTenantWriteLease = async ({ hospitalId, method, path } = {}) => {
  await ensureIndexes();
  const requestId = randomUUID();
  const tenantId = hospitalId ? new mongoose.Types.ObjectId(String(hospitalId)) : null;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  if (tenantId) {
    await collection().insertOne({ requestId, hospitalId: tenantId, method, path, createdAt: new Date(), expiresAt });

    const hospital = await mongoose.connection.collection('hospitals').findOne(
      { _id: tenantId },
      { projection: { databaseWriteLocked: 1, databaseWriteLockReason: 1 } },
    );
    if (hospital?.databaseWriteLocked) {
      await collection().deleteOne({ requestId });
      const error = new Error(hospital.databaseWriteLockReason || 'Hospital data is temporarily read-only for database maintenance.');
      error.code = 'TENANT_WRITE_MAINTENANCE';
      throw error;
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (tenantId) {
      await collection().deleteOne({ requestId }).catch(() => {});
    }
  };
};

export const waitForTenantWritesToDrain = async (hospitalId, { timeoutMs = 30000, pollMs = 100 } = {}) => {
  await ensureIndexes();
  const tenantId = new mongoose.Types.ObjectId(String(hospitalId));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    await collection().deleteMany({ expiresAt: { $lte: new Date() } });
    const active = await collection().countDocuments({ hospitalId: tenantId, expiresAt: { $gt: new Date() } });
    if (active === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const error = new Error('Timed out waiting for active hospital writes to finish.');
  error.code = 'TENANT_WRITES_DRAIN_TIMEOUT';
  throw error;
};

