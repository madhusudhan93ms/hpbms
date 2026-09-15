import bcrypt from 'bcryptjs';
import { Patient } from '../../models/Patient.js';
import { Hospital } from '../../models/Hospital.js';
import { GlobalPatient } from '../../models/GlobalPatient.js';
import { User } from '../../models/User.js';
import { GuardianLink } from '../../models/GuardianLink.js';
import { ApiError } from '../../utils/apiError.js';
import { requireBranchContext, requireHospitalContext } from '../../utils/tenantContext.js';

const pad = (n, len = 5) => String(n).padStart(len, '0');

export class PatientsService {

  /**
   * Check if a patient already exists in this hospital before registering.
   * Supports family members (children/spouses) sharing the same mobile number with different DOB / Names.
   * Only flags duplicates if exact same Person (Phone + DOB, Phone + Name, or Name + DOB) matches.
   */
  static async checkDuplicate(data, hospitalId) {
    const phone = String(data.phone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '').slice(-10);
    const email = String(data.email || '').trim().toLowerCase();
    const nationalId = String(data.nationalId || '').trim();
    const firstName = String(data.firstName || '').trim();
    const lastName = String(data.lastName || '').trim();
    const dob = data.dob ? new Date(data.dob) : null;

    const orConditions = [];

    // Exact Match 1: Same Mobile AND Same Date of Birth
    if (phoneDigits.length >= 8 && dob && !isNaN(dob.getTime())) {
      orConditions.push({
        phone: { $regex: phoneDigits, $options: 'i' },
        dob: {
          $gte: new Date(new Date(dob).setHours(0, 0, 0, 0)),
          $lte: new Date(new Date(dob).setHours(23, 59, 59, 999)),
        },
      });
    }

    // Exact Match 2: Same Mobile AND Same First & Last Name
    if (phoneDigits.length >= 8 && firstName) {
      orConditions.push({
        phone: { $regex: phoneDigits, $options: 'i' },
        firstName: { $regex: `^${firstName.trim()}$`, $options: 'i' },
        ...(lastName ? { lastName: { $regex: `^${lastName.trim()}$`, $options: 'i' } } : {}),
      });
    }

    // Exact Match 3: Same Email
    if (email) orConditions.push({ email });

    // Exact Match 4: Same National ID / Aadhar
    if (nationalId) orConditions.push({ nationalId });

    // Exact Match 5: Same Full Name AND Same DOB (even if phone is formatted differently)
    if (firstName && dob && !isNaN(dob.getTime())) {
      orConditions.push({
        firstName: { $regex: `^${firstName.trim()}$`, $options: 'i' },
        ...(lastName ? { lastName: { $regex: `^${lastName.trim()}$`, $options: 'i' } } : {}),
        dob: {
          $gte: new Date(new Date(dob).setHours(0, 0, 0, 0)),
          $lte: new Date(new Date(dob).setHours(23, 59, 59, 999)),
        },
      });
    }

    if (orConditions.length === 0) return [];

    const matches = await Patient.find({
      hospitalId,
      $or: orConditions,
    }).populate('activeAdmissionId', 'status admittedAt wardType bedNumber').sort({ createdAt: -1 }).limit(5);

    return matches;
  }

  /**
   * Search for a global patient by phone / email / globalPatientId (across all hospitals).
   * Used when a new hospital wants to register an existing global patient.
   */
  static async searchGlobalPatient(query) {
    if (!query || !query.trim()) {
      throw new ApiError(400, 'Search query is required', null, 'VALIDATION_ERROR');
    }
    const digits = query.trim().replace(/\D/g, '').slice(-10);
    const orConditions = [
      { primaryPhone: { $regex: digits, $options: 'i' } },
      { email: { $regex: query.trim(), $options: 'i' } },
      { globalPatientId: { $regex: query.trim(), $options: 'i' } },
    ];

    const globalPatients = await GlobalPatient.find({ $or: orConditions, isActive: true })
      .select('globalPatientId firstName lastName dob gender primaryPhone email bloodGroup hospitalMemberships')
      .limit(5);

    // Redact internal hospital patient IDs — only return membership count and hospital names
    return globalPatients.map(gp => ({
      _id: gp._id,
      globalPatientId: gp.globalPatientId,
      firstName: gp.firstName,
      lastName: gp.lastName,
      dob: gp.dob,
      gender: gp.gender,
      primaryPhone: gp.primaryPhone,
      email: gp.email,
      bloodGroup: gp.bloodGroup,
      hospitalCount: gp.hospitalMemberships.length,
      hospitals: gp.hospitalMemberships.map(m => ({
        hospitalName: m.hospitalName,
        localUhid: m.localUhid,
        joinedAt: m.joinedAt,
        hasActiveAdmission: m.hasActiveAdmission,
      })),
    }));
  }

  static async registerPatient(data, user) {
    const hospitalId = requireHospitalContext(user);
    const branchId = requireBranchContext(user);

    const firstName = String(data.firstName || '').trim();
    if (!firstName) {
      throw new ApiError(422, 'Patient first name is required.', null, 'VALIDATION_ERROR');
    }

    const lastName = String(data.lastName || '').trim();
    const patientPhone = String(data.phone || '').trim();
    const guardianPhone = String(data.guardianPhone || '').trim();

    // Format Date of Birth (Optional - default null)
    let parsedDob = null;
    if (data.dob && String(data.dob).trim()) {
      const d = new Date(data.dob);
      if (!isNaN(d.getTime())) {
        parsedDob = d;
      }
    }

    // Format Blood Group (Optional - default empty string)
    let parsedBloodGroup = '';
    if (data.bloodGroup && String(data.bloodGroup).trim()) {
      const bg = String(data.bloodGroup).toUpperCase().replace(/_/g, '').trim();
      if (bg === 'OPOSITIVE' || bg === 'O+') parsedBloodGroup = 'O+';
      else if (bg === 'ONEGATIVE' || bg === 'O-') parsedBloodGroup = 'O-';
      else if (bg === 'APOSITIVE' || bg === 'A+') parsedBloodGroup = 'A+';
      else if (bg === 'ANEGATIVE' || bg === 'A-') parsedBloodGroup = 'A-';
      else if (bg === 'BPOSITIVE' || bg === 'B+') parsedBloodGroup = 'B+';
      else if (bg === 'BNEGATIVE' || bg === 'B-') parsedBloodGroup = 'B-';
      else if (bg === 'ABPOSITIVE' || bg === 'AB+') parsedBloodGroup = 'AB+';
      else if (bg === 'ABNEGATIVE' || bg === 'AB-') parsedBloodGroup = 'AB-';
      else parsedBloodGroup = data.bloodGroup.trim();
    }

    // --- 1. STRICT EXACT DUPLICATE CHECK (Same Mobile AND Same Date of Birth) ---
    // A single mobile number can have multiple family members (e.g. children with different DOBs),
    // but the EXACT SAME Person (Same Phone + Same DOB) is strictly rejected to prevent duplicate accounts.
    const phoneDigits = patientPhone.replace(/\D/g, '').slice(-10);
    if (phoneDigits.length >= 8 && parsedDob) {
      const exactDuplicate = await Patient.findOne({
        hospitalId,
        phone: { $regex: phoneDigits, $options: 'i' },
        dob: {
          $gte: new Date(new Date(parsedDob).setHours(0, 0, 0, 0)),
          $lte: new Date(new Date(parsedDob).setHours(23, 59, 59, 999)),
        },
      });

      if (exactDuplicate) {
        const err = new ApiError(
          409,
          `A patient with Mobile ${patientPhone} and Date of Birth ${parsedDob.toLocaleDateString()} is already registered as ${exactDuplicate.firstName} ${exactDuplicate.lastName} (UHID: ${exactDuplicate.uhid}). Duplicate registration is not permitted.`,
          [{
            _id: exactDuplicate._id,
            uhid: exactDuplicate.uhid,
            firstName: exactDuplicate.firstName,
            lastName: exactDuplicate.lastName,
            phone: exactDuplicate.phone,
            dob: exactDuplicate.dob,
          }],
          'EXACT_DUPLICATE_FORBIDDEN'
        );
        err.exactDuplicate = true;
        throw err;
      }
    }

    // --- 2. SOFT DUPLICATE CHECK (unless allowForce is set) ---
    if (!data.allowForce && (patientPhone || firstName)) {
      const duplicates = await PatientsService.checkDuplicate({ ...data, firstName, lastName, phone: patientPhone, dob: parsedDob }, hospitalId);
      if (duplicates.length > 0) {
        const err = new ApiError(
          409,
          'Possible duplicate patient found in this hospital. Review existing records or confirm this is a different person.',
          duplicates.map(p => ({
            _id: p._id,
            uhid: p.uhid,
            firstName: p.firstName,
            lastName: p.lastName,
            phone: p.phone,
            dob: p.dob,
            admissionStatus: p.admissionStatus,
            activeAdmissionId: p.activeAdmissionId,
            createdAt: p.createdAt,
          })),
          'POSSIBLE_DUPLICATE'
        );
        err.possibleDuplicate = true;
        throw err;
      }
    }

    // Generate unique, collision-free UHID auto-sequence (e.g. HOSP-2026-00001)
    // Scoped to hospitalId + current year for accurate sequence numbering
    const year = new Date().getFullYear();
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const hospitalCount = await Patient.countDocuments({ hospitalId, createdAt: { $gte: yearStart } });
    let seqNum = hospitalCount + 1;
    let uhid = `HOSP-${year}-${String(seqNum).padStart(5, '0')}`;

    // Guarantee uniqueness — use index-efficient exact match
    let existingPatient = await Patient.findOne({ hospitalId, uhid }).select('_id').lean();
    while (existingPatient) {
      seqNum++;
      uhid = `HOSP-${year}-${String(seqNum).padStart(5, '0')}`;
      existingPatient = await Patient.findOne({ hospitalId, uhid }).select('_id').lean();
    }

    // Calculate age if not provided
    let patientAge = data.age ? Number(data.age) : undefined;
    if (!patientAge && parsedDob) {
      const birthYear = parsedDob.getFullYear();
      patientAge = new Date().getFullYear() - birthYear;
    }

    try {
      const patient = await Patient.create({
        hospitalId,
        branchId,
        uhid,
        firstName,
        lastName,
        gender: (data.gender || 'MALE').toUpperCase(),
        age: patientAge,
        dob: parsedDob,
        chiefComplaints: data.chiefComplaints || data.chiefComplaint || '',
        bloodGroup: parsedBloodGroup,
        phone: patientPhone,
        email: '',
        nationalId: data.nationalId || '',
        address: typeof data.address === 'object' && data.address !== null
          ? [data.address.street, data.address.city, data.address.state, data.address.postalCode].filter(Boolean).join(', ')
          : (data.address || 'General Registration'),
        city: data.city || 'Metropolis',
        allergies: data.allergies || [],
        emergencyContact: data.emergencyContact || { name: 'Family Contact', phone: patientPhone, relation: 'Family' },
        category: (data.category || 'GENERAL').toUpperCase(),
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${uhid}`,
      });

      // --- GLOBAL IDENTITY LINKING ---
      let globalPatient = null;
      try {
        const hospital = await Hospital.findById(hospitalId).lean();
        const phoneDigits = patientPhone.replace(/\D/g, '').slice(-10);

        // Search for existing GlobalPatient
        globalPatient = await GlobalPatient.findOne({
          $or: [
            { primaryPhone: { $regex: phoneDigits, $options: 'i' } },
            ...(data.email ? [{ email: data.email.toLowerCase().trim() }] : []),
            ...(data.nationalId ? [{ nationalId: data.nationalId.trim() }] : []),
          ]
        });

        if (!globalPatient) {
          const gpCount = await GlobalPatient.countDocuments({});
          const gpYear = new Date().getFullYear();
          const globalPatientId = `GP-${gpYear}-${pad(gpCount + 1)}`;

          globalPatient = await GlobalPatient.create({
            globalPatientId,
            firstName: data.firstName,
            lastName: data.lastName,
            dob: parsedDob,
            gender: (data.gender || 'MALE').toUpperCase(),
            primaryPhone: patientPhone,
            email: data.email || '',
            nationalId: data.nationalId || '',
            bloodGroup: (() => {
              const bg = String(data.bloodGroup || 'O+').toUpperCase().replace(/_/g, '').trim();
              if (bg === 'OPOSITIVE' || bg === 'O+') return 'O+';
              if (bg === 'ONEGATIVE' || bg === 'O-') return 'O-';
              if (bg === 'APOSITIVE' || bg === 'A+') return 'A+';
              if (bg === 'ANEGATIVE' || bg === 'A-') return 'A-';
              if (bg === 'BPOSITIVE' || bg === 'B+') return 'B+';
              if (bg === 'BNEGATIVE' || bg === 'B-') return 'B-';
              if (bg === 'ABPOSITIVE' || bg === 'AB+') return 'AB+';
              if (bg === 'ABNEGATIVE' || bg === 'AB-') return 'AB-';
              return 'O+';
            })(),
            allergies: data.allergies || [],
            emergencyContact: data.emergencyContact || {},
            hospitalMemberships: [{
              hospitalId,
              hospitalName: hospital?.name || '',
              localPatientId: patient._id,
              localUhid: uhid,
              joinedAt: new Date(),
            }],
          });
        } else {
          // Existing global patient — add this hospital as new membership
          const alreadyMember = globalPatient.hospitalMemberships.some(
            m => String(m.hospitalId) === String(hospitalId)
          );
          if (!alreadyMember) {
            await GlobalPatient.updateOne({ _id: globalPatient._id }, {
              $push: {
                hospitalMemberships: {
                  hospitalId,
                  hospitalName: hospital?.name || '',
                  localPatientId: patient._id,
                  localUhid: uhid,
                  joinedAt: new Date(),
                }
              }
            });
          }
        }

        await Patient.updateOne({ _id: patient._id }, { $set: { globalPatientId: globalPatient._id } });
      } catch (gpErr) {
        console.error('[GlobalPatient Link Notice]', gpErr.message);
      }

      // Auto-provision User login account for Patient Portal
      let patientUserAccount = null;
      let guardianUserAccount = null;

      try {
        const userEmail = `${uhid.toLowerCase()}@hospital.local`;
        const userPassword = patientPhone || uhid;
        // Cost 10: ~4x faster than 12, still cryptographically strong (>100ms)
        const passwordHash = await bcrypt.hash(userPassword, 10);

        const existingUser = await User.findOne({
          $or: [
            { email: userEmail },
            ...(patientPhone ? [{ role: 'PATIENT', loginIds: patientPhone }] : []),
            { uhid },
          ],
        });

        if (!existingUser) {
          patientUserAccount = await User.create({
            hospitalId,
            branchId,
            name: `${data.firstName}${data.lastName ? ` ${data.lastName}` : ''}`.trim(),
            email: userEmail,
            phone: patientPhone || '',
            loginIds: patientPhone ? [patientPhone, uhid] : [uhid],
            uhid,
            passwordHash,
            role: 'PATIENT',
            status: 'ACTIVE',
            isActive: true,
          });

          // Link patient user to GlobalPatient
          if (globalPatient && !globalPatient.patientUserId) {
            await GlobalPatient.updateOne({ _id: globalPatient._id }, { $set: { patientUserId: patientUserAccount._id } });
          }
        }

        // Auto-provision Guardian User & APPROVED GuardianLink if guardian info provided
        const gPhone = guardianPhone;
        const gName = data.guardianName || data.emergencyContact?.name || `Guardian of ${data.firstName}`;
        const gRelation = (data.guardianRelationship || data.emergencyContact?.relation || 'FAMILY').toUpperCase();
        const validRelations = ['FATHER', 'MOTHER', 'SPOUSE', 'SIBLING', 'CHILD', 'LEGAL_GUARDIAN', 'CARETAKER', 'OTHER'];
        const relationship = validRelations.includes(gRelation) ? gRelation : 'OTHER';

        if (gPhone && gPhone.trim() && gPhone !== data.phone) {
          const cleanGPhone = gPhone.trim();
          const gEmail = data.guardianEmail && data.guardianEmail.trim()
            ? data.guardianEmail.toLowerCase().trim()
            : `guardian.${cleanGPhone.replace(/\D/g, '')}@hospital.local`;
          const gPassword = cleanGPhone;
          const gPasswordHash = await bcrypt.hash(gPassword, 10);

          let guardianUser = await User.findOne({
            $or: [{ phone: cleanGPhone }, { email: gEmail }],
            role: 'GUARDIAN',
          });

          if (!guardianUser) {
            guardianUser = await User.create({
              hospitalId,
              branchId,
              name: gName,
              email: gEmail,
              phone: cleanGPhone,
              loginIds: [patientPhone],
              passwordHash: gPasswordHash,
              role: 'GUARDIAN',
              status: 'ACTIVE',
              isActive: true,
            });
          } else if (!guardianUser.loginIds?.includes(patientPhone)) {
            guardianUser.loginIds = [...(guardianUser.loginIds || []), patientPhone];
            await guardianUser.save();
          }

          guardianUserAccount = {
            id: guardianUser._id,
            name: guardianUser.name,
            phone: guardianUser.phone,
            username: patientPhone,
            password: gPassword,
            loginUrl: '/login',
          };

          const existingLink = await GuardianLink.findOne({
            guardianUserId: guardianUser._id,
            patientId: patient._id,
          });

          if (!existingLink) {
            await GuardianLink.create({
              hospitalId,
              branchId,
              patientId: patient._id,
              guardianUserId: guardianUser._id,
              relationship,
              accessStatus: 'APPROVED',
              approvedAt: new Date(),
              liveAccessActive: true,
              notes: 'Auto-linked & approved during patient registration',
            });
          }
        }
      } catch (userErr) {
        console.error('[Patient/Guardian User Auto-Provision Notice]', userErr.message);
      }

      const responseData = patient.toObject();
      responseData.globalPatientRef = globalPatient?.globalPatientId;
      responseData.patientCredentials = {
        username: patientPhone,
        password: patientPhone,
        loginUrl: '/login',
      };
      responseData.guardianCredentials = guardianUserAccount;

      // Real-time broadcast to connected staff
      try {
        const { socketManager } = await import('../../events/socketManager.js');
        const regPayload = {
          patientId: patient._id,
          uhid: patient.uhid,
          firstName: patient.firstName,
          lastName: patient.lastName,
          patientName: `${patient.firstName} ${patient.lastName}`,
          phone: patient.phone,
          timestamp: new Date(),
        };
        if (branchId) {
          socketManager.emitToBranch(String(branchId), 'patient:registered', regPayload);
          socketManager.emitToBranch(String(branchId), 'patient:created', regPayload);
        } else if (patient.hospitalId) {
          socketManager.emitToHospital(String(patient.hospitalId), 'patient:registered', regPayload);
          socketManager.emitToHospital(String(patient.hospitalId), 'patient:created', regPayload);
        }
      } catch (sockErr) {
        // Socket broadcast failures do not interrupt registration completion
      }

      return responseData;
    } catch (err) {
      if (err.possibleDuplicate) throw err;
      console.error('[Patient Registration Error]', err);
      if (err.name === 'ValidationError') {
        const issues = Object.values(err.errors).map((e) => e.message);
        throw new ApiError(422, `Patient validation failed: ${issues.join(', ')}`, issues, 'VALIDATION_ERROR');
      }
      throw new ApiError(500, err.message || 'Failed to register patient in database', null, 'REGISTRATION_FAILED');
    }
  }

  static async getPatients(user, query = '', targetHospitalId = null) {
    let filter = {};
    if (targetHospitalId && targetHospitalId !== 'ALL') {
      filter.hospitalId = targetHospitalId;
    } else if (user?.hospitalId && (user.role !== 'SUPER_ADMIN' || user._hospitalContextApplied)) {
      const hId = typeof user.hospitalId === 'object' ? user.hospitalId._id : user.hospitalId;
      filter.hospitalId = hId;
    }

    if (query) {
      filter.$or = [
        { uhid: { $regex: query, $options: 'i' } },
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } },
      ];
    }
    // Select only fields needed for the roster list — avoid shipping full encrypted blobs
    return await Patient.find(filter)
      .select('firstName lastName uhid phone gender dob admissionStatus admissionCount activeAdmissionId branchId createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  }

  static async getPatientByUhid(uhid, user) {
    const hospitalId = requireHospitalContext(user);
    const filter = { hospitalId, uhid: uhid.toUpperCase() };
    const patient = await Patient.findOne(filter);
    if (!patient) {
      throw new ApiError(404, `Patient with UHID ${uhid} not found`, null, 'NOT_FOUND');
    }
    return patient;
  }
}
