import mongoose from 'mongoose';
import { Hospital } from '../../models/Hospital.js';
import { Bed } from '../../models/Bed.js';
import { HospitalBlock } from '../../models/HospitalBlock.js';
import { HospitalFloor } from '../../models/HospitalFloor.js';
import { HospitalWard } from '../../models/HospitalWard.js';
import { HospitalRoom } from '../../models/HospitalRoom.js';
import { BedTransfer } from '../../models/BedTransfer.js';
import { BedReservation } from '../../models/BedReservation.js';
import { BedStatusHistory } from '../../models/BedStatusHistory.js';
import { Admission } from '../../models/Admission.js';
import { Patient } from '../../models/Patient.js';
import { BED_STATUS } from '../../config/constants.js';
import { ApiError } from '../../utils/apiError.js';
import { socketManager } from '../../events/socketManager.js';
import { requireBranchContext, requireHospitalContext } from '../../utils/tenantContext.js';

export class BedsService {
  /**
   * Helper to resolve hospitalId and branchId from user context
   */
  static async resolveHospitalContext(user) {
    return {
      hospitalId: requireHospitalContext(user),
      branchId: requireBranchContext(user),
    };
  }

  static async resolveHierarchyDocuments(hospitalId, data = {}) {
    const cleanBlockId = data.blockId ? String(data.blockId).trim() : null;
    const cleanFloorId = data.floorId ? String(data.floorId).trim() : null;
    const cleanWardId = data.wardId ? String(data.wardId).trim() : null;
    const cleanRoomId = data.roomId ? String(data.roomId).trim() : null;

    const [block, floor, ward, room] = await Promise.all([
      data.blockId ? HospitalBlock.findOne({ _id: data.blockId, hospitalId }) : null,
      data.floorId ? HospitalFloor.findOne({ _id: data.floorId, hospitalId }) : null,
      data.wardId ? HospitalWard.findOne({ _id: data.wardId, hospitalId }) : null,
      data.roomId ? HospitalRoom.findOne({ _id: data.roomId, hospitalId }) : null,
    ]);
    for (const [id, document, label] of [
      [cleanBlockId, block, 'Block'], [cleanFloorId, floor, 'Floor'],
      [cleanWardId, ward, 'Ward'], [cleanRoomId, room, 'Room'],
    ]) {
      if (id && !document) throw new ApiError(404, `${label} was not found in this hospital.`, null, 'INVALID_HIERARCHY_REFERENCE');
    }
    return { block, floor, ward, room };
  }

  /**
   * Auto-expire reservations whose expiry timestamp has passed
   */
  static async cleanExpiredReservations(hospitalId) {
    try {
      const now = new Date();
      const expiredList = await BedReservation.find({
        hospitalId,
        status: 'ACTIVE',
        expiresAt: { $lte: now },
      });

      for (const res of expiredList) {
        res.status = 'EXPIRED';
        await res.save();

        const bed = await Bed.findOne({ _id: res.bedId, hospitalId, status: BED_STATUS.RESERVED });
        if (bed) {
          bed.status = BED_STATUS.AVAILABLE;
          bed.reservationDetails = {
            patientId: null,
            patientName: '',
            uhid: '',
            reservedBy: null,
            reservedByName: '',
            reservedAt: null,
            expiresAt: null,
            reason: '',
          };
          await bed.save();

          await BedStatusHistory.create({
            hospitalId,
            branchId: bed.branchId,
            bedId: bed._id,
            bedNumber: bed.bedNumber,
            fromStatus: BED_STATUS.RESERVED,
            toStatus: BED_STATUS.AVAILABLE,
            changedByName: 'System (Auto-Expiry)',
            reason: 'Reservation expired automatically after timeout',
          });
        }
      }
    } catch (err) {
      console.error('[BedsService.cleanExpiredReservations] Error:', err.message);
    }
  }

  // ==========================================
  // 1. LIVE BED MATRIX & HIERARCHY QUERIES
  // ==========================================

  /**
   * Get full real-time Bed Matrix with advanced filtering, searching, and auto-seeding if empty
   */
  static async getBedMatrix(query = {}, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    await this.cleanExpiredReservations(hospitalId);

    const filter = { hospitalId };
    if (branchId) filter.branchId = branchId;

    if (query.blockId) filter.blockId = query.blockId;
    if (query.floorId) filter.floorId = query.floorId;
    if (query.wardId) filter.wardId = query.wardId;
    if (query.roomId) filter.roomId = query.roomId;
    if (query.status && query.status !== 'ALL') filter.status = query.status;
    if (query.wardType && query.wardType !== 'ALL') filter.wardType = query.wardType;
    if (query.bedType && query.bedType !== 'ALL') filter.bedType = query.bedType;

    let beds = await Bed.find(filter)
      .populate('currentPatientId', 'firstName lastName uhid gender age phone admissionStatus activeAdmissionId emergencyContact')
      .populate('assignedNurseId', 'name role specialization phone')
      .populate('assignedDoctorId', 'name role specialization phone')
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType genderRestriction defaultDailyCharge')
      .populate('roomId', 'roomNumber roomName roomType maxBedCapacity dailyRoomCharge')
      .sort({ bedNumber: 1 })
      .lean({ getters: true });

    // Auto-seed default bed matrix ONLY if hospital has never been initialized and is completely empty
    if (beds.length === 0 && Object.keys(query).length === 0) {
      const hospital = await Hospital.findById(hospitalId).select('bedStructureInitialized');
      if (!hospital?.bedStructureInitialized) {
        const [existingBlocks, existingFloors, existingWards, existingRooms, existingCount] = await Promise.all([
          HospitalBlock.countDocuments({ hospitalId }),
          HospitalFloor.countDocuments({ hospitalId }),
          HospitalWard.countDocuments({ hospitalId }),
          HospitalRoom.countDocuments({ hospitalId }),
          Bed.countDocuments({ hospitalId }),
        ]);
        if (existingBlocks === 0 && existingFloors === 0 && existingWards === 0 && existingRooms === 0 && existingCount === 0) {
          await this.seedDefaultHospitalSetup(hospitalId, branchId, user?.id);
          await Hospital.findByIdAndUpdate(hospitalId, { bedStructureInitialized: true });
          beds = await Bed.find({ hospitalId })
            .populate('currentPatientId', 'firstName lastName uhid gender age phone admissionStatus activeAdmissionId emergencyContact')
            .populate('assignedNurseId', 'name role specialization phone')
            .populate('assignedDoctorId', 'name role specialization phone')
            .populate('blockId', 'name code')
            .populate('floorId', 'name floorNumber')
            .populate('wardId', 'name code wardType genderRestriction defaultDailyCharge')
            .populate('roomId', 'roomNumber roomName roomType maxBedCapacity dailyRoomCharge')
            .sort({ bedNumber: 1 })
            .lean({ getters: true });
        } else {
          await Hospital.findByIdAndUpdate(hospitalId, { bedStructureInitialized: true });
        }
      }
    }

    // In-memory text search across bed number, room number, patient name, and uhid
    if (query.search && query.search.trim()) {
      const s = query.search.trim().toLowerCase();
      beds = beds.filter((b) => {
        const bedNo = (b.bedNumber || '').toLowerCase();
        const wardN = (b.wardName || '').toLowerCase();
        const roomN = (b.roomNumber || '').toLowerCase();
        const pat = b.currentPatientId;
        const patName = pat ? `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase() : '';
        const patUhid = pat ? (pat.uhid || '').toLowerCase() : '';
        return bedNo.includes(s) || wardN.includes(s) || roomN.includes(s) || patName.includes(s) || patUhid.includes(s);
      });
    }

    return beds;
  }

  /**
   * Summary KPI dashboard counts for top metric cards
   */
  static async getDashboardSummary(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    await this.cleanExpiredReservations(hospitalId);

    const beds = await Bed.find({ hospitalId, isActive: true }).lean();

    const total = beds.length;
    const available = beds.filter((b) => b.status === BED_STATUS.AVAILABLE).length;
    const occupied = beds.filter((b) => b.status === BED_STATUS.OCCUPIED).length;
    const reserved = beds.filter((b) => b.status === BED_STATUS.RESERVED).length;
    const cleaning = beds.filter((b) => b.status === BED_STATUS.CLEANING || b.status === BED_STATUS.CLEANING_SANITIZING).length;
    const maintenance = beds.filter((b) => b.status === BED_STATUS.MAINTENANCE).length;
    const blocked = beds.filter((b) => b.status === BED_STATUS.BLOCKED).length;
    const isolation = beds.filter((b) => b.status === BED_STATUS.ISOLATION || b.wardType === 'ISOLATION' || b.bedType === 'ISOLATION').length;
    const icu = beds.filter((b) => b.wardType === 'ICU' || b.bedType === 'ICU' || (b.wardName && b.wardName.toUpperCase().includes('ICU'))).length;

    const occupancyRate = total > 0 ? ((occupied / total) * 100).toFixed(1) : '0.0';

    return {
      total,
      available,
      occupied,
      reserved,
      cleaning,
      maintenance,
      blocked,
      isolation,
      icu,
      occupancyRate: parseFloat(occupancyRate),
    };
  }

  /**
   * Get complete hierarchical tree (Blocks -> Floors -> Wards -> Rooms -> Beds)
   */
  static async getHierarchy(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    await this.cleanExpiredReservations(hospitalId);

    const [blocks, floors, wards, rooms, beds] = await Promise.all([
      HospitalBlock.find({ hospitalId }).sort({ name: 1 }).lean(),
      HospitalFloor.find({ hospitalId }).sort({ floorNumber: 1, name: 1 }).lean(),
      HospitalWard.find({ hospitalId }).sort({ name: 1 }).lean(),
      HospitalRoom.find({ hospitalId }).sort({ roomNumber: 1 }).lean(),
      Bed.find({ hospitalId, isActive: true })
        .populate('currentPatientId', 'firstName lastName uhid gender age')
        .populate('assignedNurseId', 'name phone')
        .sort({ bedNumber: 1 })
        .lean(),
    ]);

    // Build hierarchy tree
    const tree = blocks.map((block) => {
      const blockFloors = floors.filter((f) => String(f.blockId) === String(block._id));
      return {
        ...block,
        floors: blockFloors.map((floor) => {
          const floorWards = wards.filter((w) => String(w.floorId) === String(floor._id) || (String(w.blockId) === String(block._id) && !w.floorId));
          return {
            ...floor,
            wards: floorWards.map((ward) => {
              const wardRooms = rooms.filter((r) => String(r.wardId) === String(ward._id) || (String(r.floorId) === String(floor._id) && !r.wardId));
              return {
                ...ward,
                rooms: wardRooms.map((room) => {
                  const roomBeds = beds.filter((b) => String(b.roomId) === String(room._id));
                  return {
                    ...room,
                    beds: roomBeds,
                  };
                }),
                directBeds: beds.filter((b) => String(b.wardId) === String(ward._id) && !b.roomId),
              };
            }),
            directRooms: rooms.filter((r) => String(r.floorId) === String(floor._id) && !r.wardId).map((room) => ({
              ...room,
              beds: beds.filter((b) => String(b.roomId) === String(room._id)),
            })),
          };
        }),
      };
    });

    // Unassigned floating items for hospitals without full 5-tier hierarchy
    const unassignedWards = wards.filter((w) => !w.blockId && !w.floorId).map((ward) => ({
      ...ward,
      rooms: rooms.filter((r) => String(r.wardId) === String(ward._id)).map((room) => ({
        ...room,
        beds: beds.filter((b) => String(b.roomId) === String(room._id)),
      })),
      directBeds: beds.filter((b) => String(b.wardId) === String(ward._id) && !b.roomId),
    }));

    const unassignedRooms = rooms.filter((r) => !r.blockId && !r.floorId && !r.wardId).map((room) => ({
      ...room,
      beds: beds.filter((b) => String(b.roomId) === String(room._id)),
    }));

    const unassignedBeds = beds.filter((b) => !b.blockId && !b.floorId && !b.wardId && !b.roomId);

    return {
      blocks: tree,
      unassignedWards,
      unassignedRooms,
      unassignedBeds,
      raw: {
        blocks,
        floors,
        wards,
        rooms,
        beds,
      },
    };
  }

  /**
   * Occupancy and capacity breakdown analytics
   */
  static async getOccupancyReports(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const beds = await Bed.find({ hospitalId, isActive: true })
      .populate('wardId', 'name wardType')
      .populate('floorId', 'name')
      .populate('blockId', 'name')
      .lean();

    const wardStats = {};
    const floorStats = {};
    const blockStats = {};

    beds.forEach((b) => {
      const wardName = b.wardName || b.wardId?.name || 'General Ward';
      if (!wardStats[wardName]) {
        wardStats[wardName] = { name: wardName, wardType: b.wardType || 'GENERAL', total: 0, occupied: 0, available: 0, cleaning: 0, maintenance: 0 };
      }
      wardStats[wardName].total++;
      if (b.status === BED_STATUS.OCCUPIED) wardStats[wardName].occupied++;
      else if (b.status === BED_STATUS.AVAILABLE) wardStats[wardName].available++;
      else if (b.status === BED_STATUS.CLEANING || b.status === BED_STATUS.CLEANING_SANITIZING) wardStats[wardName].cleaning++;
      else if (b.status === BED_STATUS.MAINTENANCE) wardStats[wardName].maintenance++;

      const floorName = b.floorName || b.floorId?.name || 'Ground Floor';
      if (!floorStats[floorName]) {
        floorStats[floorName] = { name: floorName, total: 0, occupied: 0, available: 0 };
      }
      floorStats[floorName].total++;
      if (b.status === BED_STATUS.OCCUPIED) floorStats[floorName].occupied++;
      else if (b.status === BED_STATUS.AVAILABLE) floorStats[floorName].available++;

      const blockName = b.blockName || b.blockId?.name || 'Main Block';
      if (!blockStats[blockName]) {
        blockStats[blockName] = { name: blockName, total: 0, occupied: 0, available: 0 };
      }
      blockStats[blockName].total++;
      if (b.status === BED_STATUS.OCCUPIED) blockStats[blockName].occupied++;
      else if (b.status === BED_STATUS.AVAILABLE) blockStats[blockName].available++;
    });

    const wardReports = Object.values(wardStats).map((w) => ({
      ...w,
      occupancyRate: w.total > 0 ? parseFloat(((w.occupied / w.total) * 100).toFixed(1)) : 0,
    }));

    const floorReports = Object.values(floorStats).map((f) => ({
      ...f,
      occupancyRate: f.total > 0 ? parseFloat(((f.occupied / f.total) * 100).toFixed(1)) : 0,
    }));

    const blockReports = Object.values(blockStats).map((b) => ({
      ...b,
      occupancyRate: b.total > 0 ? parseFloat(((b.occupied / b.total) * 100).toFixed(1)) : 0,
    }));

    return {
      wardReports,
      floorReports,
      blockReports,
    };
  }

  // ==========================================
  // 2. PHYSICAL HIERARCHY CRUD OPERATIONS
  // ==========================================

  // --- BLOCKS ---
  static async getBlocks(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await HospitalBlock.find({ hospitalId }).sort({ name: 1 });
  }

  static async createBlock(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    if (!data.name || !data.name.trim()) {
      throw new ApiError(400, 'Block Name is required.', null, 'VALIDATION_ERROR');
    }

    const existing = await HospitalBlock.findOne({ hospitalId, name: data.name.trim() });
    if (existing) {
      throw new ApiError(400, `Block with name "${data.name}" already exists in this hospital.`, null, 'DUPLICATE_NAME');
    }

    const block = await HospitalBlock.create({
      hospitalId,
      branchId,
      name: data.name.trim(),
      code: (data.code || '').trim().toUpperCase(),
      description: data.description || '',
      numberOfFloors: Number(data.numberOfFloors) || 1,
      status: data.status || 'ACTIVE',
      createdBy: user?.id || user?._id,
    });

    return block;
  }

  static async updateBlock(id, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const block = await HospitalBlock.findOne({ _id: id, hospitalId });
    if (!block) throw new ApiError(404, 'Hospital block not found.', null, 'NOT_FOUND');

    if (data.name && data.name.trim() !== block.name) {
      const dup = await HospitalBlock.findOne({ hospitalId, name: data.name.trim(), _id: { $ne: id } });
      if (dup) throw new ApiError(400, `Block "${data.name}" already exists.`, null, 'DUPLICATE_NAME');
      block.name = data.name.trim();
    }
    if (data.code !== undefined) block.code = (data.code || '').trim().toUpperCase();
    if (data.description !== undefined) block.description = data.description;
    if (data.numberOfFloors !== undefined) block.numberOfFloors = Number(data.numberOfFloors);
    if (data.status) block.status = data.status;

    await block.save();
    return block;
  }

  static async deleteBlock(id, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const block = await HospitalBlock.findOne({ _id: id, hospitalId });
    if (!block) throw new ApiError(404, 'Block not found.', null, 'NOT_FOUND');

    // 1. Find all child floors under this block
    const childFloors = await HospitalFloor.find({ hospitalId, blockId: id }).select('_id');
    const floorIds = childFloors.map((f) => f._id);

    // 2. Find all child wards under this block or its floors
    const childWards = await HospitalWard.find({
      hospitalId,
      $or: [{ blockId: id }, { floorId: { $in: floorIds } }],
    }).select('_id');
    const wardIds = childWards.map((w) => w._id);

    // 3. Find all child rooms under this block, its floors, or its wards
    const childRooms = await HospitalRoom.find({
      hospitalId,
      $or: [
        { blockId: id },
        { floorId: { $in: floorIds } },
        { wardId: { $in: wardIds } },
      ],
    }).select('_id');
    const roomIds = childRooms.map((r) => r._id);

    // 4. Deletion safety check across all subordinate beds
    const occupiedCount = await Bed.countDocuments({
      hospitalId,
      status: BED_STATUS.OCCUPIED,
      $or: [
        { blockId: id },
        { floorId: { $in: floorIds } },
        { wardId: { $in: wardIds } },
        { roomId: { $in: roomIds } },
      ],
    });
    if (occupiedCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete Block "${block.name}" because it contains ${occupiedCount} currently occupied bed(s). Transfer or discharge patients first.`,
        null,
        'HAS_OCCUPIED_PATIENTS'
      );
    }

    // 5. Cascade delete: Beds -> Rooms -> Wards -> Floors -> Block
    const bedDel = await Bed.deleteMany({
      hospitalId,
      $or: [
        { blockId: id },
        { floorId: { $in: floorIds } },
        { wardId: { $in: wardIds } },
        { roomId: { $in: roomIds } },
      ],
    });
    const roomDel = await HospitalRoom.deleteMany({
      hospitalId,
      $or: [
        { blockId: id },
        { floorId: { $in: floorIds } },
        { wardId: { $in: wardIds } },
      ],
    });
    const wardDel = await HospitalWard.deleteMany({
      hospitalId,
      $or: [{ blockId: id }, { floorId: { $in: floorIds } }],
    });
    const floorDel = await HospitalFloor.deleteMany({ hospitalId, blockId: id });
    await HospitalBlock.deleteOne({ _id: id, hospitalId });

    return {
      message: `Block "${block.name}" and all subordinate floors (${floorDel.deletedCount}), wards (${wardDel.deletedCount}), rooms (${roomDel.deletedCount}), and beds (${bedDel.deletedCount}) deleted successfully.`,
    };
  }

  // --- FLOORS ---
  static async getFloors(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await HospitalFloor.find({ hospitalId }).populate('blockId', 'name code').sort({ floorNumber: 1, name: 1 });
  }

  static async createFloor(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    if (!data.name || !data.name.trim()) {
      throw new ApiError(400, 'Floor Name is required.', null, 'VALIDATION_ERROR');
    }
    await this.resolveHierarchyDocuments(hospitalId, { blockId: data.blockId });

    const floor = await HospitalFloor.create({
      hospitalId,
      branchId,
      blockId: data.blockId || null,
      name: data.name.trim(),
      floorNumber: data.floorNumber !== undefined ? Number(data.floorNumber) : 0,
      description: data.description || '',
      status: data.status || 'ACTIVE',
      createdBy: user?.id || user?._id,
    });

    return await HospitalFloor.findById(floor._id).populate('blockId', 'name code');
  }

  static async updateFloor(id, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const floor = await HospitalFloor.findOne({ _id: id, hospitalId });
    if (!floor) throw new ApiError(404, 'Floor not found.', null, 'NOT_FOUND');
    await this.resolveHierarchyDocuments(hospitalId, { blockId: data.blockId });

    if (data.name) floor.name = data.name.trim();
    if (data.blockId !== undefined) floor.blockId = data.blockId || null;
    if (data.floorNumber !== undefined) floor.floorNumber = Number(data.floorNumber);
    if (data.description !== undefined) floor.description = data.description;
    if (data.status) floor.status = data.status;

    await floor.save();
    return await HospitalFloor.findById(id).populate('blockId', 'name code');
  }

  static async deleteFloor(id, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const floor = await HospitalFloor.findOne({ _id: id, hospitalId });
    if (!floor) throw new ApiError(404, 'Floor not found.', null, 'NOT_FOUND');

    // 1. Find all child wards under this floor
    const childWards = await HospitalWard.find({ hospitalId, floorId: id }).select('_id');
    const wardIds = childWards.map((w) => w._id);

    // 2. Find all child rooms under this floor or its wards
    const childRooms = await HospitalRoom.find({
      hospitalId,
      $or: [{ floorId: id }, { wardId: { $in: wardIds } }],
    }).select('_id');
    const roomIds = childRooms.map((r) => r._id);

    // 3. Safety check across all subordinate beds
    const occupiedCount = await Bed.countDocuments({
      hospitalId,
      status: BED_STATUS.OCCUPIED,
      $or: [
        { floorId: id },
        { wardId: { $in: wardIds } },
        { roomId: { $in: roomIds } },
      ],
    });
    if (occupiedCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete Floor "${floor.name}" because it contains ${occupiedCount} active occupied bed(s). Transfer or discharge patients first.`,
        null,
        'HAS_OCCUPIED_PATIENTS'
      );
    }

    // 4. Cascade delete: Beds -> Rooms -> Wards -> Floor
    const bedDel = await Bed.deleteMany({
      hospitalId,
      $or: [
        { floorId: id },
        { wardId: { $in: wardIds } },
        { roomId: { $in: roomIds } },
      ],
    });
    const roomDel = await HospitalRoom.deleteMany({
      hospitalId,
      $or: [{ floorId: id }, { wardId: { $in: wardIds } }],
    });
    const wardDel = await HospitalWard.deleteMany({ hospitalId, floorId: id });
    await HospitalFloor.deleteOne({ _id: id, hospitalId });

    return {
      message: `Floor "${floor.name}" and all subordinate wards (${wardDel.deletedCount}), rooms (${roomDel.deletedCount}), and beds (${bedDel.deletedCount}) deleted successfully.`,
    };
  }

  // --- WARDS ---
  static async getWards(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await HospitalWard.find({ hospitalId })
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .sort({ name: 1 });
  }

  static async createWard(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    if (!data.name || !data.name.trim()) {
      throw new ApiError(400, 'Ward Name is required.', null, 'VALIDATION_ERROR');
    }
    const hierarchy = await this.resolveHierarchyDocuments(hospitalId, { blockId: data.blockId, floorId: data.floorId });

    const existing = await HospitalWard.findOne({ hospitalId, name: data.name.trim() });
    if (existing) {
      throw new ApiError(400, `Ward "${data.name}" already exists in this hospital.`, null, 'DUPLICATE_NAME');
    }

    const blockId = data.blockId || (hierarchy.floor?.blockId ? String(hierarchy.floor.blockId) : null);

    const ward = await HospitalWard.create({
      hospitalId,
      branchId,
      blockId,
      floorId: data.floorId || null,
      name: data.name.trim(),
      code: (data.code || '').trim().toUpperCase(),
      wardType: data.wardType || 'GENERAL',
      department: data.department || 'Inpatient',
      genderRestriction: data.genderRestriction || 'ANY',
      bedCapacity: Number(data.bedCapacity) || 10,
      defaultDailyCharge: Number(data.defaultDailyCharge) || 150.0,
      description: data.description || '',
      status: data.status || 'ACTIVE',
      createdBy: user?.id || user?._id,
    });

    return await HospitalWard.findById(ward._id)
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber');
  }

  static async updateWard(id, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const ward = await HospitalWard.findOne({ _id: id, hospitalId });
    if (!ward) throw new ApiError(404, 'Ward not found.', null, 'NOT_FOUND');
    await this.resolveHierarchyDocuments(hospitalId, { blockId: data.blockId, floorId: data.floorId });

    if (data.name && data.name.trim() !== ward.name) {
      const dup = await HospitalWard.findOne({ hospitalId, name: data.name.trim(), _id: { $ne: id } });
      if (dup) throw new ApiError(400, `Ward "${data.name}" already exists.`, null, 'DUPLICATE_NAME');
      ward.name = data.name.trim();
    }

    if (data.blockId !== undefined) ward.blockId = data.blockId || null;
    if (data.floorId !== undefined) ward.floorId = data.floorId || null;
    if (data.code !== undefined) ward.code = (data.code || '').trim().toUpperCase();
    if (data.wardType) ward.wardType = data.wardType;
    if (data.department) ward.department = data.department;
    if (data.genderRestriction) ward.genderRestriction = data.genderRestriction;
    if (data.bedCapacity !== undefined) ward.bedCapacity = Number(data.bedCapacity);
    if (data.defaultDailyCharge !== undefined) ward.defaultDailyCharge = Number(data.defaultDailyCharge);
    if (data.description !== undefined) ward.description = data.description;
    if (data.status) ward.status = data.status;

    await ward.save();

    // Propagate updated ward name and tariff to existing beds linked to this ward
    await Bed.updateMany(
      { hospitalId, wardId: id },
      { $set: { wardName: ward.name, wardType: ward.wardType, dailyWardCharge: ward.defaultDailyCharge } }
    );

    return await HospitalWard.findById(id)
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber');
  }

  static async deleteWard(id, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const ward = await HospitalWard.findOne({ _id: id, hospitalId });
    if (!ward) throw new ApiError(404, 'Ward not found.', null, 'NOT_FOUND');

    // 1. Find all child rooms in this ward
    const childRooms = await HospitalRoom.find({ hospitalId, wardId: id }).select('_id');
    const roomIds = childRooms.map((r) => r._id);

    // 2. Safety check: ensure no occupied beds exist in this ward or its rooms
    const occupiedCount = await Bed.countDocuments({
      hospitalId,
      status: BED_STATUS.OCCUPIED,
      $or: [{ wardId: id }, { roomId: { $in: roomIds } }],
    });
    if (occupiedCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete Ward "${ward.name}" because it contains ${occupiedCount} active admitted patient(s). Transfer or discharge patients first.`,
        null,
        'HAS_OCCUPIED_PATIENTS'
      );
    }

    // 3. Cascade delete: Beds -> Rooms -> Ward
    const bedDel = await Bed.deleteMany({
      hospitalId,
      $or: [{ wardId: id }, { roomId: { $in: roomIds } }],
    });
    const roomDel = await HospitalRoom.deleteMany({ hospitalId, wardId: id });
    await HospitalWard.deleteOne({ _id: id, hospitalId });

    return {
      message: `Ward "${ward.name}" and all subordinate rooms (${roomDel.deletedCount}) and beds (${bedDel.deletedCount}) deleted successfully.`,
    };
  }

  // --- ROOMS ---
  static async getRooms(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await HospitalRoom.find({ hospitalId })
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType')
      .sort({ roomNumber: 1 });
  }

  static async createRoom(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    if (!data.roomNumber || !data.roomNumber.trim()) {
      throw new ApiError(400, 'Room Number is required.', null, 'VALIDATION_ERROR');
    }
    const hierarchy = await this.resolveHierarchyDocuments(hospitalId, data);

    const roomNumber = data.roomNumber.trim();
    const existing = await HospitalRoom.findOne({
      hospitalId,
      roomNumber,
      wardId: data.wardId || null,
    });
    if (existing) {
      throw new ApiError(400, `Room "${roomNumber}" already exists in this ward/setup.`, null, 'DUPLICATE_ROOM');
    }

    const capacity = Number(data.maxBedCapacity) || 1;
    const dailyRoomCharge = Number(data.dailyRoomCharge) || 0;
    const wardDoc = hierarchy.ward;
    const floorId = data.floorId || (wardDoc?.floorId ? String(wardDoc.floorId) : null);
    const blockId = data.blockId || (wardDoc?.blockId ? String(wardDoc.blockId) : (hierarchy.floor?.blockId ? String(hierarchy.floor.blockId) : null));

    const room = await HospitalRoom.create({
      hospitalId,
      branchId,
      blockId,
      floorId,
      wardId: data.wardId || null,
      roomNumber,
      roomName: data.roomName ? data.roomName.trim() : `Room ${roomNumber}`,
      roomType: data.roomType || 'SINGLE',
      maxBedCapacity: capacity,
      dailyRoomCharge,
      description: data.description || '',
      status: data.status || 'ACTIVE',
      createdBy: user?.id || user?._id,
    });

    // Auto-generate beds if requested
    if (data.autoGenerateBeds && capacity > 0) {
      const bedSuffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      const floorDoc = hierarchy.floor;
      const blockDoc = hierarchy.block;

      const bedsToCreate = [];
      for (let i = 0; i < capacity; i++) {
        const suffix = capacity === 1 ? '' : `-${bedSuffixes[i] || (i + 1)}`;
        const bedNum = `${roomNumber}${suffix}`;
        const wardTariff = wardDoc?.defaultDailyCharge || 150;

        bedsToCreate.push({
          hospitalId,
          branchId,
          blockId,
          floorId,
          wardId: data.wardId || null,
          roomId: room._id,
          blockName: blockDoc?.name || '',
          floorName: floorDoc?.name || '',
          wardName: wardDoc?.name || 'General Ward',
          wardType: wardDoc?.wardType || 'GENERAL',
          roomNumber,
          bedNumber: bedNum,
          bedName: `Bed ${bedNum}`,
          bedType: data.bedType || 'NORMAL',
          dailyBedCharge: 0,
          dailyRoomCharge: 0,
          dailyWardCharge: wardTariff,
          dailyTariff: wardTariff,
          status: BED_STATUS.AVAILABLE,
        });
      }

      if (bedsToCreate.length > 0) {
        await Bed.insertMany(bedsToCreate);
      }
    }

    return await HospitalRoom.findById(room._id)
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType');
  }

  static async updateRoom(id, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const room = await HospitalRoom.findOne({ _id: id, hospitalId });
    if (!room) throw new ApiError(404, 'Room not found.', null, 'NOT_FOUND');
    await this.resolveHierarchyDocuments(hospitalId, data);

    if (data.roomNumber && data.roomNumber.trim() !== room.roomNumber) {
      const dup = await HospitalRoom.findOne({
        hospitalId,
        roomNumber: data.roomNumber.trim(),
        wardId: data.wardId !== undefined ? data.wardId : room.wardId,
        _id: { $ne: id },
      });
      if (dup) throw new ApiError(400, `Room number "${data.roomNumber}" already exists in this ward.`, null, 'DUPLICATE_ROOM');
      room.roomNumber = data.roomNumber.trim();
    }

    if (data.roomName !== undefined) room.roomName = data.roomName.trim();
    if (data.blockId !== undefined) room.blockId = data.blockId || null;
    if (data.floorId !== undefined) room.floorId = data.floorId || null;
    if (data.wardId !== undefined) room.wardId = data.wardId || null;
    if (data.roomType) room.roomType = data.roomType;
    if (data.maxBedCapacity !== undefined) room.maxBedCapacity = Number(data.maxBedCapacity);
    if (data.dailyRoomCharge !== undefined) room.dailyRoomCharge = Number(data.dailyRoomCharge);
    if (data.description !== undefined) room.description = data.description;
    if (data.status) room.status = data.status;

    await room.save();

    // Propagate room updates to beds in this room
    await Bed.updateMany(
      { hospitalId, roomId: id },
      { $set: { roomNumber: room.roomNumber, dailyRoomCharge: room.dailyRoomCharge } }
    );

    return await HospitalRoom.findById(id)
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType');
  }

  static async deleteRoom(id, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const room = await HospitalRoom.findOne({ _id: id, hospitalId });
    if (!room) throw new ApiError(404, 'Room not found.', null, 'NOT_FOUND');

    const occupiedCount = await Bed.countDocuments({ hospitalId, roomId: id, status: BED_STATUS.OCCUPIED });
    if (occupiedCount > 0) {
      throw new ApiError(400, `Cannot delete Room "${room.roomNumber}" because it contains ${occupiedCount} active occupied bed(s). Transfer or discharge patients first.`, null, 'HAS_OCCUPIED_PATIENTS');
    }

    const bedDel = await Bed.deleteMany({ hospitalId, roomId: id });
    await HospitalRoom.deleteOne({ _id: id, hospitalId });

    return { message: `Room "${room.roomNumber}" and its beds (${bedDel.deletedCount}) deleted successfully.` };
  }

  // --- BEDS CRUD ---
  static async createBed(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    if (!data.bedNumber || !data.bedNumber.trim()) {
      throw new ApiError(400, 'Bed Number is required.', null, 'VALIDATION_ERROR');
    }
    const hierarchy = await this.resolveHierarchyDocuments(hospitalId, data);

    const bedNumber = data.bedNumber.trim().toUpperCase();

    // Duplicate check
    const existing = await Bed.findOne({
      hospitalId,
      bedNumber,
      roomId: data.roomId || null,
      isActive: true,
    });
    if (existing) {
      throw new ApiError(400, `Bed Number "${bedNumber}" already exists in this room/hospital.`, null, 'DUPLICATE_BED');
    }

    const roomDoc = hierarchy.room;
    const wardDoc = hierarchy.ward;
    const floorDoc = hierarchy.floor;
    const blockDoc = hierarchy.block;

    const wardId = data.wardId || (roomDoc?.wardId ? String(roomDoc.wardId) : null);
    const floorId = data.floorId || (roomDoc?.floorId ? String(roomDoc.floorId) : (wardDoc?.floorId ? String(wardDoc.floorId) : null));
    const blockId = data.blockId || (roomDoc?.blockId ? String(roomDoc.blockId) : (wardDoc?.blockId ? String(wardDoc.blockId) : (floorDoc?.blockId ? String(floorDoc.blockId) : null)));

    let blockName = blockDoc?.name || '';
    let floorName = floorDoc?.name || '';
    let wardName = data.wardName || wardDoc?.name || 'General Ward';
    let roomNumber = data.roomNumber || roomDoc?.roomNumber || '';

    if (hierarchy.block) blockName = hierarchy.block.name;
    if (hierarchy.floor) floorName = hierarchy.floor.name;
    if (hierarchy.ward) wardName = hierarchy.ward.name;
    if (hierarchy.room) roomNumber = hierarchy.room.roomNumber;

    const dailyBedCharge = Number(data.dailyBedCharge) || 0;
    const dailyRoomCharge = Number(data.dailyRoomCharge) || 0;
    const dailyWardCharge = Number(data.dailyWardCharge) || 0;
    const computedTariff = Number(data.dailyTariff) || (dailyBedCharge + dailyRoomCharge + dailyWardCharge) || 150.0;

    const bed = await Bed.create({
      hospitalId,
      branchId,
      blockId: blockId || null,
      floorId: floorId || null,
      wardId: wardId || null,
      roomId: data.roomId || null,
      blockName,
      floorName,
      wardName,
      roomNumber,
      wardType: data.wardType || 'GENERAL',
      bedNumber,
      bedName: data.bedName || `Bed ${bedNumber}`,
      bedType: data.bedType || 'NORMAL',
      dailyBedCharge,
      dailyRoomCharge,
      dailyWardCharge,
      dailyTariff: computedTariff,
      status: data.status || BED_STATUS.AVAILABLE,
      notes: data.notes || '',
    });

    await BedStatusHistory.create({
      hospitalId,
      branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      fromStatus: 'INITIAL_CREATION',
      toStatus: bed.status,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Hospital Admin',
      reason: 'Bed record created',
    });

    return await Bed.findById(bed._id)
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType')
      .populate('roomId', 'roomNumber roomName roomType');
  }

  static async updateBed(id, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: id, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed record not found.', null, 'NOT_FOUND');
    await this.resolveHierarchyDocuments(hospitalId, data);

    if (data.bedNumber && data.bedNumber.trim().toUpperCase() !== bed.bedNumber) {
      const newNo = data.bedNumber.trim().toUpperCase();
      const dup = await Bed.findOne({
        hospitalId,
        bedNumber: newNo,
        roomId: data.roomId !== undefined ? data.roomId : bed.roomId,
        _id: { $ne: id },
        isActive: true,
      });
      if (dup) throw new ApiError(400, `Bed Number "${newNo}" already exists.`, null, 'DUPLICATE_BED');
      bed.bedNumber = newNo;
    }

    if (data.bedName !== undefined) bed.bedName = data.bedName.trim();
    if (data.bedType) bed.bedType = data.bedType;
    if (data.wardType) bed.wardType = data.wardType;
    if (data.wardName) bed.wardName = data.wardName;
    if (data.blockId !== undefined) bed.blockId = data.blockId || null;
    if (data.floorId !== undefined) bed.floorId = data.floorId || null;
    if (data.wardId !== undefined) bed.wardId = data.wardId || null;
    if (data.roomId !== undefined) bed.roomId = data.roomId || null;
    if (data.dailyBedCharge !== undefined) bed.dailyBedCharge = Number(data.dailyBedCharge);
    if (data.dailyRoomCharge !== undefined) bed.dailyRoomCharge = Number(data.dailyRoomCharge);
    if (data.dailyWardCharge !== undefined) bed.dailyWardCharge = Number(data.dailyWardCharge);
    if (data.dailyTariff !== undefined) bed.dailyTariff = Number(data.dailyTariff);
    if (data.notes !== undefined) bed.notes = data.notes;

    await bed.save();
    return await Bed.findById(id)
      .populate('currentPatientId', 'firstName lastName uhid gender age')
      .populate('assignedNurseId', 'name phone')
      .populate('blockId', 'name code')
      .populate('floorId', 'name floorNumber')
      .populate('wardId', 'name code wardType')
      .populate('roomId', 'roomNumber roomName roomType');
  }

  static async deleteBed(id, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: id, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed not found.', null, 'NOT_FOUND');

    if (bed.status === BED_STATUS.OCCUPIED || bed.currentPatientId) {
      throw new ApiError(400, `Cannot delete Bed "${bed.bedNumber}" because it is currently occupied by a patient. Discharge or transfer patient first.`, null, 'BED_OCCUPIED');
    }

    await Bed.deleteOne({ _id: id, hospitalId });
    return { message: `Bed "${bed.bedNumber}" deleted successfully.` };
  }

  // ==========================================
  // 3. BULK GENERATION WIZARD
  // ==========================================

  /**
   * Bulk generate a range of rooms and beds (e.g. Rooms 101 to 110, 2 beds each)
   */
  static async bulkGenerate(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);

    const {
      blockId,
      floorId,
      wardId,
      startRoomNumber,
      endRoomNumber,
      roomType = 'TWIN_SHARING',
      bedsPerRoom = 2,
      bedType = 'NORMAL',
      dailyRoomCharge = 0,
      dailyBedCharge = 0,
      namingPattern = 'ALPHA', // 'ALPHA' (101-A, 101-B) | 'NUMERIC' (101-01, 101-02)
    } = data;

    const startNum = parseInt(startRoomNumber, 10);
    const endNum = parseInt(endRoomNumber, 10);

    if (isNaN(startNum) || isNaN(endNum) || startNum > endNum) {
      throw new ApiError(400, 'Please provide valid start and end room numbers (e.g. 101 to 120).', null, 'INVALID_RANGE');
    }
    if (endNum - startNum > 50) {
      throw new ApiError(400, 'Maximum 50 rooms can be generated in a single batch.', null, 'LIMIT_EXCEEDED');
    }

    const { block: blockDoc, floor: floorDoc, ward: wardDoc } = await this.resolveHierarchyDocuments(hospitalId, { blockId, floorId, wardId });

    const bedCount = Math.max(1, parseInt(bedsPerRoom, 10) || 1);
    const alphaSuffixes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    const createdRooms = [];
    const createdBeds = [];

    for (let r = startNum; r <= endNum; r++) {
      const roomNumber = String(r);

      // Upsert or find room
      let room = await HospitalRoom.findOne({ hospitalId, roomNumber, wardId: wardId || null });
      if (!room) {
        room = await HospitalRoom.create({
          hospitalId,
          branchId,
          blockId: blockId || null,
          floorId: floorId || null,
          wardId: wardId || null,
          roomNumber,
          roomName: `Room ${roomNumber}`,
          roomType,
          maxBedCapacity: bedCount,
          dailyRoomCharge: Number(dailyRoomCharge) || 0,
          status: 'ACTIVE',
          createdBy: user?.id || user?._id,
        });
      }
      createdRooms.push(room);

      // Generate beds for this room
      for (let b = 0; b < bedCount; b++) {
        let suffix = '';
        if (bedCount > 1) {
          suffix = namingPattern === 'NUMERIC' ? `-${String(b + 1).padStart(2, '0')}` : `-${alphaSuffixes[b] || (b + 1)}`;
        }
        const bedNumber = `${roomNumber}${suffix}`;

        const existingBed = await Bed.findOne({ hospitalId, bedNumber, roomId: room._id });
        if (!existingBed) {
          const wardTariff = wardDoc?.defaultDailyCharge || 150;

          const newBed = await Bed.create({
            hospitalId,
            branchId,
            blockId: blockId || null,
            floorId: floorId || null,
            wardId: wardId || null,
            roomId: room._id,
            blockName: blockDoc?.name || '',
            floorName: floorDoc?.name || '',
            wardName: wardDoc?.name || 'General Ward',
            wardType: wardDoc?.wardType || 'GENERAL',
            roomNumber,
            bedNumber,
            bedName: `Bed ${bedNumber}`,
            bedType,
            dailyBedCharge: 0,
            dailyRoomCharge: 0,
            dailyWardCharge: wardTariff,
            dailyTariff: wardTariff,
            status: BED_STATUS.AVAILABLE,
          });
          createdBeds.push(newBed);
        }
      }
    }

    return {
      message: `Successfully generated ${createdRooms.length} room(s) and ${createdBeds.length} bed(s).`,
      roomsCount: createdRooms.length,
      bedsCount: createdBeds.length,
    };
  }

  // ==========================================
  // 4. BED STATUS WORKFLOWS (CLEANING, MAINTENANCE, RESERVATIONS)
  // ==========================================

  /**
   * Update generic bed status
   */
  static async updateBedStatus(bedId, status, patientId, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed record not found', null, 'NOT_FOUND');

    const previousStatus = bed.status;
    bed.status = status;

    if (patientId) {
      const patient = await Patient.findOne({ _id: patientId, hospitalId });
      if (!patient) throw new ApiError(404, 'Patient was not found in this hospital.', null, 'PATIENT_NOT_FOUND');
      bed.currentPatientId = patientId;
    } else if (status === BED_STATUS.AVAILABLE) {
      bed.currentPatientId = null;
      bed.currentAdmissionId = null;
    }

    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId: bed.branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      patientId: bed.currentPatientId || null,
      fromStatus: previousStatus,
      toStatus: status,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Staff User',
      reason: `Status changed from ${previousStatus} to ${status}`,
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: bed.status,
      patientId: bed.currentPatientId,
    });

    return await Bed.findById(bedId)
      .populate('currentPatientId')
      .populate('assignedNurseId', 'name phone');
  }

  /**
   * Temporary Bed Reservation
   */
  static async reserveBed(bedId, data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed record not found', null, 'NOT_FOUND');

    if (bed.status !== BED_STATUS.AVAILABLE) {
      throw new ApiError(400, `Cannot reserve Bed "${bed.bedNumber}" because its current status is ${bed.status}. Only AVAILABLE beds can be reserved.`, null, 'NOT_AVAILABLE');
    }

    const durationMinutes = Number(data.durationMinutes) || 30;
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

    let patientName = data.patientName || '';
    let uhid = data.uhid || '';
    if (data.patientId) {
      const pat = await Patient.findOne({ _id: data.patientId, hospitalId });
      if (!pat) throw new ApiError(404, 'Patient was not found in this hospital.', null, 'PATIENT_NOT_FOUND');
      patientName = `${pat.firstName} ${pat.lastName}`;
      uhid = pat.uhid;
    }

    const reservation = await BedReservation.create({
      hospitalId,
      branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      patientId: data.patientId || null,
      patientName,
      uhid,
      reservedBy: user?.id || user?._id,
      reservedByName: user?.name || 'Staff Member',
      reservedAt: new Date(),
      expiresAt,
      reason: data.reason || `Temporary reservation for ${durationMinutes} mins`,
      status: 'ACTIVE',
    });

    bed.status = BED_STATUS.RESERVED;
    bed.reservationDetails = {
      patientId: data.patientId || null,
      patientName,
      uhid,
      reservedBy: user?.id || user?._id,
      reservedByName: user?.name || 'Staff Member',
      reservedAt: new Date(),
      expiresAt,
      reason: data.reason || 'Patient reservation',
    };
    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      patientId: data.patientId || null,
      fromStatus: BED_STATUS.AVAILABLE,
      toStatus: BED_STATUS.RESERVED,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Staff Member',
      reason: `Reserved for ${patientName || 'Patient'} until ${expiresAt.toLocaleTimeString()}`,
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.RESERVED,
    });

    return { reservation, bed };
  }

  /**
   * Release temporary reservation
   */
  static async releaseReservation(bedId, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed record not found', null, 'NOT_FOUND');

    await BedReservation.updateMany(
      { hospitalId, bedId: bed._id, status: 'ACTIVE' },
      { $set: { status: 'CANCELLED', cancelledBy: user?.id || user?._id } }
    );

    bed.status = BED_STATUS.AVAILABLE;
    bed.reservationDetails = {
      patientId: null,
      patientName: '',
      uhid: '',
      reservedBy: null,
      reservedByName: '',
      reservedAt: null,
      expiresAt: null,
      reason: '',
    };
    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId: bed.branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      fromStatus: BED_STATUS.RESERVED,
      toStatus: BED_STATUS.AVAILABLE,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Staff User',
      reason: 'Reservation released / cancelled manually',
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.AVAILABLE,
    });

    return bed;
  }

  /**
   * Mark Housekeeping / Cleaning Complete -> transitions bed from CLEANING to AVAILABLE
   */
  static async markCleaningComplete(bedId, data = {}, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed not found', null, 'NOT_FOUND');

    bed.status = BED_STATUS.AVAILABLE;
    bed.currentPatientId = null;
    bed.currentAdmissionId = null;
    bed.cleaningDetails = {
      requestedAt: bed.cleaningDetails?.requestedAt || null,
      requestedBy: bed.cleaningDetails?.requestedBy || null,
      cleanedAt: new Date(),
      cleanedBy: user?.id || user?._id,
      cleanedByName: user?.name || data.cleanedByName || 'Housekeeping Staff',
      notes: data.notes || 'Sanitized, linen replaced, and ready for patient occupancy',
    };
    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId: bed.branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      fromStatus: BED_STATUS.CLEANING,
      toStatus: BED_STATUS.AVAILABLE,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Housekeeping',
      reason: 'Housekeeping cleaning & sanitization verified complete',
      notes: data.notes || '',
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.AVAILABLE,
    });

    return bed;
  }

  /**
   * Report Bed Maintenance issue -> transitions bed to MAINTENANCE
   */
  static async markMaintenance(bedId, data, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed not found', null, 'NOT_FOUND');

    if (bed.status === BED_STATUS.OCCUPIED) {
      throw new ApiError(400, 'Cannot put an occupied bed into maintenance. Please transfer the patient first.', null, 'BED_OCCUPIED');
    }

    const previousStatus = bed.status;
    bed.status = BED_STATUS.MAINTENANCE;
    bed.maintenanceDetails = {
      issue: data.issue || 'Mechanical / electrical fault reported',
      reportedBy: user?.id || user?._id,
      reportedByName: user?.name || 'Staff User',
      reportedAt: new Date(),
      priority: data.priority || 'MEDIUM',
    };
    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId: bed.branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      fromStatus: previousStatus,
      toStatus: BED_STATUS.MAINTENANCE,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Staff User',
      reason: `Maintenance reported: ${data.issue || 'Fault reported'}`,
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.MAINTENANCE,
    });

    return bed;
  }

  /**
   * Complete Maintenance & Repair -> transitions bed from MAINTENANCE to AVAILABLE
   */
  static async repairCompleted(bedId, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    const bed = await Bed.findOne({ _id: bedId, hospitalId });
    if (!bed) throw new ApiError(404, 'Bed not found', null, 'NOT_FOUND');

    bed.status = BED_STATUS.AVAILABLE;
    await bed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId: bed.branchId,
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      fromStatus: BED_STATUS.MAINTENANCE,
      toStatus: BED_STATUS.AVAILABLE,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Biomedical / Maintenance Tech',
      reason: 'Maintenance & repair completed. Certified safe for patient use.',
    });

    socketManager.emitToBranch(bed.branchId, 'bed:status_changed', {
      bedId: bed._id,
      bedNumber: bed.bedNumber,
      status: BED_STATUS.AVAILABLE,
    });

    return bed;
  }

  // ==========================================
  // 5. PATIENT BED TRANSFER & AUDIT TRAIL
  // ==========================================

  /**
   * Transfer patient from one bed to another (across bed, room, ward, floor, or block)
   */
  static async transferPatient(data, user) {
    const { hospitalId, branchId } = await this.resolveHospitalContext(user);
    const { admissionId, targetBedId, reason } = data;

    if (!admissionId || !targetBedId || !reason || !reason.trim()) {
      throw new ApiError(400, 'Admission ID, Target Bed ID, and Reason for transfer are required.', null, 'VALIDATION_ERROR');
    }

    const admission = await Admission.findOne({ _id: admissionId, hospitalId });
    if (!admission) throw new ApiError(404, 'Admission record not found.', null, 'NOT_FOUND');
    if (admission.status !== 'ADMITTED') {
      throw new ApiError(400, 'Only currently admitted patients can be transferred.', null, 'INVALID_ADMISSION_STATE');
    }

    const targetBed = await Bed.findOne({ _id: targetBedId, hospitalId });
    if (!targetBed) throw new ApiError(404, 'Target destination bed not found.', null, 'NOT_FOUND');

    if (targetBed.status !== BED_STATUS.AVAILABLE) {
      throw new ApiError(400, `Target Bed "${targetBed.bedNumber}" is ${targetBed.status}. Only AVAILABLE beds can receive transfers.`, null, 'TARGET_BED_UNAVAILABLE');
    }

    // Resolve source bed
    let sourceBed = null;
    if (admission.bedId) {
      sourceBed = await Bed.findOne({ _id: admission.bedId, hospitalId });
    } else if (admission.bedNumber) {
      sourceBed = await Bed.findOne({ hospitalId, bedNumber: admission.bedNumber });
    }

    // Release source bed into CLEANING status
    if (sourceBed) {
      sourceBed.status = BED_STATUS.CLEANING;
      sourceBed.currentPatientId = null;
      sourceBed.currentAdmissionId = null;
      sourceBed.cleaningDetails = {
        requestedAt: new Date(),
        requestedBy: user?.id || user?._id,
        cleanedAt: null,
        cleanedBy: null,
        notes: `Patient transferred to Bed ${targetBed.bedNumber}. Requires sanitization.`,
      };
      await sourceBed.save();

      await BedStatusHistory.create({
        hospitalId,
        branchId,
        bedId: sourceBed._id,
        bedNumber: sourceBed.bedNumber,
        patientId: admission.patientId,
        admissionId: admission._id,
        fromStatus: BED_STATUS.OCCUPIED,
        toStatus: BED_STATUS.CLEANING,
        changedBy: user?.id || user?._id,
        changedByName: user?.name || 'Staff User',
        reason: `Patient transferred out to Bed ${targetBed.bedNumber}. Bed queued for cleaning.`,
      });
    }

    // Occupy target bed
    targetBed.status = BED_STATUS.OCCUPIED;
    targetBed.currentPatientId = admission.patientId;
    targetBed.currentAdmissionId = admission._id;
    if (admission.assignedNurseId) targetBed.assignedNurseId = admission.assignedNurseId;
    await targetBed.save();

    await BedStatusHistory.create({
      hospitalId,
      branchId,
      bedId: targetBed._id,
      bedNumber: targetBed.bedNumber,
      patientId: admission.patientId,
      admissionId: admission._id,
      fromStatus: BED_STATUS.AVAILABLE,
      toStatus: BED_STATUS.OCCUPIED,
      changedBy: user?.id || user?._id,
      changedByName: user?.name || 'Staff User',
      reason: `Patient transferred in from Bed ${sourceBed ? sourceBed.bedNumber : 'Previous Bed'}: ${reason}`,
    });

    // Create BedTransfer log
    const transferRecord = await BedTransfer.create({
      hospitalId,
      branchId,
      admissionId: admission._id,
      patientId: admission.patientId,
      uhid: admission.uhid,
      patientName: admission.patientName,
      fromBedId: sourceBed?._id || targetBed._id,
      fromBedNumber: sourceBed?.bedNumber || 'UNASSIGNED',
      fromWardName: sourceBed?.wardName || admission.targetWardName || '',
      fromRoomNumber: sourceBed?.roomNumber || admission.roomNumber || '',
      fromBlockName: sourceBed?.blockName || admission.blockName || '',
      fromFloorName: sourceBed?.floorName || admission.floorName || '',
      fromDailyTariff: sourceBed?.dailyTariff || admission.dailyTariff || 0,
      toBedId: targetBed._id,
      toBedNumber: targetBed.bedNumber,
      toWardName: targetBed.wardName,
      toRoomNumber: targetBed.roomNumber,
      toBlockName: targetBed.blockName,
      toFloorName: targetBed.floorName,
      toDailyTariff: targetBed.dailyTariff,
      transferredBy: user?.id || user?._id,
      transferredByName: user?.name || 'Staff User',
      reason: reason.trim(),
      transferDate: new Date(),
    });

    // Update Admission record with new location and tariffs
    admission.bedId = targetBed._id;
    admission.bedNumber = targetBed.bedNumber;
    admission.targetWardName = targetBed.wardName;
    admission.wardType = targetBed.wardType || 'GENERAL';
    admission.dailyTariff = targetBed.dailyTariff;
    admission.blockId = targetBed.blockId || null;
    admission.blockName = targetBed.blockName || '';
    admission.floorId = targetBed.floorId || null;
    admission.floorName = targetBed.floorName || '';
    admission.wardId = targetBed.wardId || null;
    admission.roomId = targetBed.roomId || null;
    admission.roomNumber = targetBed.roomNumber || '';
    admission.bedTariff = targetBed.dailyBedCharge || 0;
    admission.roomTariff = targetBed.dailyRoomCharge || 0;
    admission.wardTariff = targetBed.dailyWardCharge || 0;
    await admission.save();

    // Broadcast transfer events
    socketManager.emitToBranch(branchId, 'bed:transfer_completed', {
      admissionId: admission._id,
      patientName: admission.patientName,
      uhid: admission.uhid,
      fromBedNumber: sourceBed?.bedNumber,
      toBedNumber: targetBed.bedNumber,
      toWardName: targetBed.wardName,
    });
    socketManager.emitToBranch(branchId, 'workflow:pending_changed', { resourceId: admission._id, status: 'ADMITTED' });

    return {
      message: `Patient ${admission.patientName} transferred successfully to Bed ${targetBed.bedNumber}.`,
      transferRecord,
      admission,
      targetBed,
    };
  }

  /**
   * Get complete status history for a specific bed
   */
  static async getBedHistory(bedId, user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await BedStatusHistory.find({ hospitalId, bedId })
      .populate('patientId', 'firstName lastName uhid')
      .populate('changedBy', 'name role')
      .sort({ timestamp: -1 })
      .limit(100);
  }

  /**
   * Get all patient bed transfers across the hospital
   */
  static async getTransferHistory(user) {
    const { hospitalId } = await this.resolveHospitalContext(user);
    return await BedTransfer.find({ hospitalId })
      .populate('patientId', 'firstName lastName uhid gender age')
      .populate('transferredBy', 'name role')
      .sort({ transferDate: -1 })
      .limit(100);
  }

  // ==========================================
  // 6. DEFAULT SEEDER (IF HOSPITAL HAS NO BEDS)
  // ==========================================

  static async seedDefaultHospitalSetup(hospitalId, branchId, userId) {
    try {
      // 1. Create Main Block
      const mainBlock = await HospitalBlock.create({
        hospitalId,
        branchId,
        name: 'Main Block',
        code: 'MB',
        description: 'Main Inpatient and Surgical Block',
        numberOfFloors: 3,
        status: 'ACTIVE',
        createdBy: userId,
      });

      // 2. Create Floors
      const groundFloor = await HospitalFloor.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        name: 'Ground Floor',
        floorNumber: 0,
        description: 'Emergency & Triage',
        status: 'ACTIVE',
        createdBy: userId,
      });

      const firstFloor = await HospitalFloor.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        name: 'First Floor',
        floorNumber: 1,
        description: 'General Inpatient & Semi-Private',
        status: 'ACTIVE',
        createdBy: userId,
      });

      const secondFloor = await HospitalFloor.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        name: 'Second Floor',
        floorNumber: 2,
        description: 'ICU & Critical Care',
        status: 'ACTIVE',
        createdBy: userId,
      });

      // 3. Create Wards
      const emergencyWard = await HospitalWard.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: groundFloor._id,
        name: 'Emergency Observation Ward',
        code: 'EM-OBS',
        wardType: 'EMERGENCY',
        department: 'Emergency',
        genderRestriction: 'ANY',
        bedCapacity: 6,
        defaultDailyCharge: 200,
        status: 'ACTIVE',
        createdBy: userId,
      });

      const generalWard = await HospitalWard.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: firstFloor._id,
        name: 'Ward 3B - Inpatient',
        code: 'GW-3B',
        wardType: 'GENERAL',
        department: 'Inpatient',
        genderRestriction: 'ANY',
        bedCapacity: 10,
        defaultDailyCharge: 150,
        status: 'ACTIVE',
        createdBy: userId,
      });

      const icuWard = await HospitalWard.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: secondFloor._id,
        name: 'Intensive Care Unit (ICU)',
        code: 'ICU-MAIN',
        wardType: 'ICU',
        department: 'Critical Care',
        genderRestriction: 'ANY',
        bedCapacity: 6,
        defaultDailyCharge: 650,
        status: 'ACTIVE',
        createdBy: userId,
      });

      // 4. Create Rooms
      const room101 = await HospitalRoom.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: groundFloor._id,
        wardId: emergencyWard._id,
        roomNumber: 'EM-01',
        roomName: 'Emergency Bay 1',
        roomType: 'EMERGENCY_OBSERVATION',
        maxBedCapacity: 2,
        dailyRoomCharge: 50,
        status: 'ACTIVE',
        createdBy: userId,
      });

      const room201 = await HospitalRoom.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: firstFloor._id,
        wardId: generalWard._id,
        roomNumber: '201',
        roomName: 'General Ward Room 201',
        roomType: 'FOUR_SHARING',
        maxBedCapacity: 4,
        dailyRoomCharge: 0,
        status: 'ACTIVE',
        createdBy: userId,
      });

      const roomICU1 = await HospitalRoom.create({
        hospitalId,
        branchId,
        blockId: mainBlock._id,
        floorId: secondFloor._id,
        wardId: icuWard._id,
        roomNumber: 'ICU-1',
        roomName: 'ICU Critical Bay 1',
        roomType: 'ICU',
        maxBedCapacity: 2,
        dailyRoomCharge: 100,
        status: 'ACTIVE',
        createdBy: userId,
      });

      // 5. Create Beds
      const initialBeds = [
        { bedNumber: 'EM-01A', blockId: mainBlock._id, floorId: groundFloor._id, wardId: emergencyWard._id, roomId: room101._id, blockName: 'Main Block', floorName: 'Ground Floor', wardName: emergencyWard.name, roomNumber: 'EM-01', wardType: 'EMERGENCY', bedType: 'EMERGENCY', dailyTariff: 250 },
        { bedNumber: 'EM-01B', blockId: mainBlock._id, floorId: groundFloor._id, wardId: emergencyWard._id, roomId: room101._id, blockName: 'Main Block', floorName: 'Ground Floor', wardName: emergencyWard.name, roomNumber: 'EM-01', wardType: 'EMERGENCY', bedType: 'EMERGENCY', dailyTariff: 250 },
        { bedNumber: 'BED-301', blockId: mainBlock._id, floorId: firstFloor._id, wardId: generalWard._id, roomId: room201._id, blockName: 'Main Block', floorName: 'First Floor', wardName: generalWard.name, roomNumber: '201', wardType: 'GENERAL', bedType: 'NORMAL', dailyTariff: 150 },
        { bedNumber: 'BED-302', blockId: mainBlock._id, floorId: firstFloor._id, wardId: generalWard._id, roomId: room201._id, blockName: 'Main Block', floorName: 'First Floor', wardName: generalWard.name, roomNumber: '201', wardType: 'GENERAL', bedType: 'NORMAL', dailyTariff: 150 },
        { bedNumber: 'BED-303', blockId: mainBlock._id, floorId: firstFloor._id, wardId: generalWard._id, roomId: room201._id, blockName: 'Main Block', floorName: 'First Floor', wardName: generalWard.name, roomNumber: '201', wardType: 'SEMI_PRIVATE', bedType: 'ELECTRIC', dailyTariff: 250 },
        { bedNumber: 'ICU-101', blockId: mainBlock._id, floorId: secondFloor._id, wardId: icuWard._id, roomId: roomICU1._id, blockName: 'Main Block', floorName: 'Second Floor', wardName: icuWard.name, roomNumber: 'ICU-1', wardType: 'ICU', bedType: 'VENTILATOR', dailyTariff: 650 },
        { bedNumber: 'ICU-102', blockId: mainBlock._id, floorId: secondFloor._id, wardId: icuWard._id, roomId: roomICU1._id, blockName: 'Main Block', floorName: 'Second Floor', wardName: icuWard.name, roomNumber: 'ICU-1', wardType: 'ICU', bedType: 'VENTILATOR', dailyTariff: 650 },
      ];

      await Bed.insertMany(
        initialBeds.map((b) => ({
          hospitalId,
          branchId,
          ...b,
          status: BED_STATUS.AVAILABLE,
        }))
      );
    } catch (e) {
      console.error('[seedDefaultHospitalSetup] Non-critical error:', e.message);
    }
  }
}
