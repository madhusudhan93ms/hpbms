import { PatientsService } from './patients.service.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { requireHospitalContext } from '../../utils/tenantContext.js';

export const registerPatient = async (req, res, next) => {
  try {
    const patient = await PatientsService.registerPatient(req.body, req.user);
    return sendSuccess(res, 201, 'Patient registered successfully', patient);
  } catch (error) {
    // 409 Duplicate / Conflict — return it as a structured response, not a 500
    if (error.statusCode === 409 || error.possibleDuplicate || error.exactDuplicate) {
      return res.status(409).json({
        success: false,
        statusCode: 409,
        message: error.message,
        code: error.code || (error.exactDuplicate ? 'EXACT_DUPLICATE_FORBIDDEN' : 'POSSIBLE_DUPLICATE'),
        possibleDuplicate: Boolean(error.possibleDuplicate),
        exactDuplicate: Boolean(error.exactDuplicate),
        existingRecords: error.errors || [],
      });
    }
    next(error);
  }
};

export const checkDuplicatePatient = async (req, res, next) => {
  try {
    const hospitalId = requireHospitalContext(req.user);
    const duplicates = await PatientsService.checkDuplicate(req.body, hospitalId);
    return sendSuccess(res, 200, 'Duplicate check completed', {
      hasDuplicates: duplicates.length > 0,
      count: duplicates.length,
      matches: duplicates.map(p => ({
        _id: p._id,
        uhid: p.uhid,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        dob: p.dob,
        admissionStatus: p.admissionStatus,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const searchGlobalPatient = async (req, res, next) => {
  try {
    const query = req.query.q || '';
    const results = await PatientsService.searchGlobalPatient(query);
    return sendSuccess(res, 200, 'Global patient search results', results);
  } catch (error) {
    next(error);
  }
};

export const getPatients = async (req, res, next) => {
  try {
    const query = req.query.q || '';
    const hospitalId = req.query.hospitalId || null;
    const patients = await PatientsService.getPatients(req.user, query, hospitalId);
    return sendSuccess(res, 200, 'Patients retrieved successfully', patients);
  } catch (error) {
    next(error);
  }
};

export const getPatientByUhid = async (req, res, next) => {
  try {
    const patient = await PatientsService.getPatientByUhid(req.params.uhid, req.user);
    return sendSuccess(res, 200, 'Patient record retrieved successfully', patient);
  } catch (error) {
    next(error);
  }
};

export const deletePatient = async (req, res, next) => {
  try {
    const result = await PatientsService.deletePatient(req.params.id, req.user);
    return sendSuccess(res, 200, result.message, result);
  } catch (error) {
    next(error);
  }
};
