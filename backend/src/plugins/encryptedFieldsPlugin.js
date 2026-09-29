import { decryptField, encryptField } from '../utils/fieldEncryption.js';

/**
 * Encrypts String schema paths at rest while exposing decrypted values through
 * normal Mongoose property access and JSON serialization. Do not attach this
 * plugin to fields used in MongoDB filters, sorting, indexes, or text search.
 */
export const encryptedFieldsPlugin = (schema, { fields = [] } = {}) => {
  for (const field of fields) {
    const schemaType = schema.path(field);
    if (!schemaType) throw new Error(`Encrypted schema path does not exist: ${field}`);
    if (schemaType.instance !== 'String') {
      throw new Error(`Encrypted schema path must be a String: ${field}`);
    }
    schemaType.set((value) => encryptField(value));
    schemaType.get((value) => {
      try {
        return decryptField(value);
      } catch (err) {
        return value;
      }
    });
  }

  const existingToJSON = schema.get('toJSON') || {};
  const existingToObject = schema.get('toObject') || {};
  schema.set('toJSON', { ...existingToJSON, getters: true });
  schema.set('toObject', { ...existingToObject, getters: true });
};
