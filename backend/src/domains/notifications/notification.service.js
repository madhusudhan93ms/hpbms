import mongoose from 'mongoose';
import { Notification } from '../../models/Notification.js';
import { User } from '../../models/User.js';
import { socketManager } from '../../events/socketManager.js';

const normalizeNotificationRoute = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return { path: '', tab: '' };
  const relative = raw.replace(/^https?:\/\/[^/]+/i, '');
  const withoutTenant = relative.replace(/^\/[^/]+(?=\/(?:doctor|reception|nursing|nurse-incharge|admin|billing|pharmacy|laboratory|radiology|emergency|workflow))/, '');
  const [pathPart, query = ''] = withoutTenant.split('?');
  const path = (pathPart.replace(/\/+$/, '') || '/').toLowerCase();
  const tab = String(new URLSearchParams(query).get('tab') || '').toUpperCase();
  return { path, tab };
};

export const notificationBelongsToRoute = (notificationRoute, currentRoute) => {
  const notification = normalizeNotificationRoute(notificationRoute);
  const current = normalizeNotificationRoute(currentRoute);
  if (!notification.path || notification.path !== current.path) return false;
  // Opening a specific tab only reads notifications for that tab. Opening a
  // base dashboard reads only base-dashboard notifications.
  return notification.tab === current.tab;
};

const recipientQuery = async (context = {}) => {
  const userId = context?.userId || context?.id;
  const role = context?.role;
  const hospitalId = context?.hospitalId;
  const branchId = context?.branchId;

  let user = null;
  const cachedAdditionalRoles = context?.additionalRoles ?? context?.user?.additionalRoles;
  if (userId && cachedAdditionalRoles === undefined) {
    user = await User.findById(userId).select('hospitalId branchId role additionalRoles').lean().catch(() => null);
  }
  const activeRole = role || user?.role;
  const userRoles = Array.from(new Set([
    activeRole,
    ...(Array.isArray(cachedAdditionalRoles) ? cachedAdditionalRoles : (Array.isArray(user?.additionalRoles) ? user.additionalRoles : [])),
    ...(user?.role ? [user.role] : []),
  ].filter(Boolean)));
  const tenantId = hospitalId || user?.hospitalId;
  const tenantBranchId = branchId || user?.branchId;

  if (activeRole === 'SUPER_ADMIN') {
    return {
      $and: [
        {
          $or: [
            { recipientRole: 'SUPER_ADMIN' },
            { targetModule: { $in: ['super-admin', 'SUPER_ADMIN', 'saas', 'SAAS'] } },
            { type: { $in: ['TRIAL_EXPIRED', 'TRIAL_EXPIRING', 'PLAN_EXPIRATION', 'PLATFORM_REVENUE', 'SECURITY_LOGIN', 'NEW_HOSPITAL_SIGNUP', 'SAAS_ALERT', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_WARNING', 'PAYMENT_RECEIVED', 'HOSPITAL_REGISTRATION', 'HOSPITAL_APPROVED', 'HOSPITAL_SUSPENDED', 'HOSPITAL_CREATED', 'SYSTEM_ALERT'] } },
            { notificationType: { $in: ['PLATFORM_REVENUE', 'SECURITY_LOGIN', 'NEW_HOSPITAL_SIGNUP', 'SAAS_ALERT', 'SUBSCRIPTION_EXPIRED', 'PAYMENT_RECEIVED', 'HOSPITAL_REGISTRATION'] } },
          ],
        },
        {
          notificationType: { $nin: ['WORKFLOW', 'WORKFLOW_ALERT', 'NEW_DATA', 'DEPT_RESPONSE', 'DEPARTMENT_RESPONSE', 'NURSE_RESPONSE', 'BILLING_UPDATE', 'PRESCRIPTION_ISSUED', 'PATIENT_QUEUED', 'DIAGNOSTIC_ORDER', 'NURSE_TASK_CREATED', 'NURSE_TASK_COMPLETED', 'REPORT_READY', 'CONSULTATION_COMPLETE'] },
        },
        {
          type: { $nin: ['NURSE_TASKS', 'LAB_ORDER_CREATED', 'PATIENT_QUEUED', 'DOCTOR_PATIENT', 'NURSE_RESPONSE', 'DEPARTMENT_RESPONSE', 'BILLING_WORK', 'LAB_WORK', 'RADIOLOGY_WORK'] },
        },
        {
          targetModule: { $nin: ['doctor', 'nursing', 'pharmacy', 'laboratory', 'radiology', 'billing', 'reception', 'ipd', 'opd'] },
        },
        {
          recipientRole: { $nin: ['ALL', 'DOCTOR', 'NURSE', 'NURSE_INCHARGE', 'RECEPTIONIST', 'CASHIER', 'LAB_TECH', 'RADIOLOGIST', 'PHARMACIST', 'PATIENT', 'GUARDIAN', 'HOSPITAL_ADMIN'] },
        },
      ],
    };
  }

  const orConditions = [];
  if (userId) {
    orConditions.push({ recipientUserId: userId });
    if (mongoose.Types.ObjectId.isValid(String(userId))) {
      orConditions.push({ recipientUserId: new mongoose.Types.ObjectId(String(userId)) });
    }
  }
  // Compatibility only for legacy non-materialized notifications. New role
  // notifications are owned by a concrete recipientUserId.
  orConditions.push({
    recipientUserId: null,
    recipientRole: { $in: [...userRoles, 'ALL'] },
  });

  const clauses = [];
  if (orConditions.length > 0) {
    clauses.push({ $or: orConditions });
  }

  // 1. Non-doctor isolation: Users without DOCTOR role must NEVER receive doctor OPD consultation queue tasks
  if (!userRoles.includes('DOCTOR')) {
    clauses.push({
      $and: [
        { type: { $nin: ['PATIENT_QUEUED', 'TOKEN_REQUEUED', 'DOCTOR_ACCEPTED_PATIENT'] } },
        { notificationType: { $nin: ['PATIENT_QUEUED', 'TOKEN_REQUEUED', 'DOCTOR_ACCEPTED_PATIENT'] } },
        { title: { $not: /(patient in queue|patient re-queued)/i } },
        { targetRoute: { $not: /\/doctor\/dashboard\?tab=live/i } },
      ],
    });
  }

  // 2. Doctor role notification isolation: pure doctors should only receive clinical responses, reports, and returned queries
  if (userRoles.includes('DOCTOR') && !userRoles.includes('HOSPITAL_ADMIN') && !userRoles.includes('CASHIER') && !userRoles.includes('PHARMACIST')) {
    const doctorExclusions = [
      'New Bill Pending',
      'Pharmacy Dispensed & Billed',
      'Pharmacy Clearance (External Purchase)',
      'Pharmacy Clearance',
      'Medicines Dispensed',
      'Invoice Generated',
      'Bill Generation Requested',
      'Payment Collected',
      'Payment Received',
      'Bill Ready (Post-Injection)',
      'Bill Ready',
      'Billing Query & Return',
    ];
    clauses.push({
      $and: [
        { title: { $nin: doctorExclusions } },
        { title: { $not: /(New Bill|Medicines Dispensed|Pharmacy Dispensed|Pharmacy Clearance|Invoice Generated|Payment Collected|Payment Received|Bill Ready|Bill Generation)/i } },
        { recipientRole: { $nin: ['CASHIER', 'BILLING_STAFF', 'PHARMACIST', 'PHARMACY_STAFF', 'RECEPTIONIST'] } },
        {
          $or: [
            {
              $and: [
                { targetModule: { $nin: ['billing', 'cashier'] } },
                { targetRoute: { $not: /\/(billing|cashier)/i } },
                { link: { $not: /\/(billing|cashier)/i } },
              ],
            },
            { notificationType: 'BILLING_QUERY' },
            { type: 'BILLING_QUERY' },
            { title: { $regex: /Billing (Query|Review)/i } },
          ],
        },
        {
          $or: [
            {
              $and: [
                { targetModule: { $nin: ['pharmacy', 'stock', 'inventory'] } },
                { targetRoute: { $not: /\/(pharmacy|stock|inventory)/i } },
                { link: { $not: /\/(pharmacy|stock|inventory)/i } },
              ],
            },
            { notificationType: 'SUBSTITUTION_REQUEST' },
            { type: 'SUBSTITUTION_REQUEST' },
            { title: { $regex: /Substitution/i } },
          ],
        },
      ],
    });
  }



  if (tenantId) {
    const hIdStr = typeof tenantId === 'object' ? String(tenantId._id || tenantId) : String(tenantId);
    if (mongoose.Types.ObjectId.isValid(hIdStr)) {
      clauses.push({ hospitalId: new mongoose.Types.ObjectId(hIdStr) });
    } else {
      clauses.push({ hospitalId: tenantId });
    }
  }

  if (tenantBranchId) {
    const bIdStr = typeof tenantBranchId === 'object' ? String(tenantBranchId._id || tenantBranchId) : String(tenantBranchId);
    if (mongoose.Types.ObjectId.isValid(bIdStr)) {
      clauses.push({ $or: [{ branchId: new mongoose.Types.ObjectId(bIdStr) }, { branchId: null }] });
    } else {
      clauses.push({ $or: [{ branchId: tenantBranchId }, { branchId: null }] });
    }
  }

  return clauses.length > 1 ? { $and: clauses } : (clauses[0] || {});
};

export class NotificationService {
  /**
   * Create an in-app notification & log system event
   */
  static async createNotification(data) {
    const recipientRoles = Array.from(new Set([
      ...(Array.isArray(data.recipientRoles) ? data.recipientRoles : []),
      ...(data.recipientRole ? [data.recipientRole] : []),
    ].filter(Boolean).map((role) => String(role).toUpperCase())));
    if (!data.hospitalId && !recipientRoles.includes('SUPER_ADMIN') && data.targetModule !== 'saas') {
        throw new Error('Hospital context is required for tenant notifications');
    }
    const base = {
        hospitalId: data.hospitalId || null,
        branchId: data.branchId || null,
        recipientRole: recipientRoles.length === 1 ? recipientRoles[0] : null,
        recipientDepartment: data.recipientDepartment || '',
        notificationType: data.notificationType || data.type || 'SYSTEM_ALERT',
        type: data.type || 'SYSTEM_ALERT',
        priority: data.priority || 'NORMAL',
        title: data.title,
        message: data.message,
        relatedPatientId: data.relatedPatientId || null,
        relatedTaskId: data.relatedTaskId || data.relatedRequestId || '',
        relatedRequestId: data.relatedRequestId || '',
        sourceModule: data.sourceModule || data.metadata?.sourceModule || '',
        entityType: data.entityType || data.metadata?.entityType || '',
        entityId: String(data.entityId || data.relatedTaskId || data.relatedRequestId || data.metadata?.entityId || ''),
        actionType: data.actionType || data.metadata?.actionType || '',
        targetModule: data.targetModule || '',
        targetRoute: data.targetRoute || data.linkedPath || data.link || '',
        link: data.link || data.linkedPath || data.targetRoute || '',
        isRead: false,
        isCompleted: false,
        status: data.status || 'ACTIVE',
        metadata: data.metadata || {},
      };

      if (data.recipientUserId) {
        const recipient = await User.findOne({
          _id: data.recipientUserId,
          ...(data.hospitalId ? { hospitalId: data.hospitalId } : {}),
          isActive: { $ne: false },
          status: { $ne: 'INACTIVE' },
        }).select('_id').lean();
        if (!recipient) throw new Error('Notification recipient is not active in the target hospital');
        const notif = await Notification.create({ ...base, recipientUserId: data.recipientUserId });
        socketManager.emitToUser(String(data.recipientUserId), 'notification:created', notif);
        return notif;
      }

      // Role/department alerts are materialized per current recipient so read and
      // clear state belongs to one user and can never hide another user's bell.
      const userQuery = { status: { $ne: 'INACTIVE' }, isActive: { $ne: false } };
      const isPlatformRecipient = recipientRoles.includes('SUPER_ADMIN');
      if (data.hospitalId && !isPlatformRecipient) userQuery.hospitalId = data.hospitalId;
      if (data.branchId && !isPlatformRecipient) userQuery.$or = [{ branchId: data.branchId }, { branchId: null }];
      if (data.recipientDepartment) {
        userQuery.$and = [{ $or: [
          { departmentId: data.recipientDepartment },
          { additionalDepartments: data.recipientDepartment },
        ] }];
      } else if (recipientRoles.length > 0 && !recipientRoles.includes('ALL')) {
        userQuery.$and = [{ $or: [
          { role: { $in: recipientRoles } },
          { additionalRoles: { $in: recipientRoles } },
        ] }];
      } else if (recipientRoles.includes('ALL')) {
        // Exclude SUPER_ADMIN from hospital tenant broadcasts
        if (data.hospitalId) {
          userQuery.role = { $ne: 'SUPER_ADMIN' };
        }
      }

      const recipients = await User.find(userQuery).select('_id').lean();
      if (recipients.length === 0) return null;

      // Deduplicate recipient IDs to avoid duplicate insertions
      const seenIds = new Set();
      const uniqueRecipients = recipients.filter((r) => {
        const idStr = String(r._id);
        if (seenIds.has(idStr)) return false;
        seenIds.add(idStr);
        return true;
      });

      const notifications = await Notification.insertMany(
        uniqueRecipients.map((recipient) => ({ ...base, recipientUserId: recipient._id }))
      );

      uniqueRecipients.forEach((recipient) => {
        socketManager.emitToUser(String(recipient._id), 'notification:created', { ...base, recipientUserId: recipient._id });
      });

    return notifications[0] || null;
  }

  /**
   * Get unread notification counts for badges
   */
  static async getUnreadCount(context) {
    const query = await recipientQuery(context);
    return Notification.countDocuments({ ...query, isRead: false, isCleared: { $ne: true }, isCompleted: { $ne: true } });
  }

  /**
   * Fetch paginated notifications for current user/role
   * Supports view = 'active' (default) or 'history' or 'all'
   */
  static async getNotifications({ limit = 30, page = 1, view = 'active', ...context }) {
    const baseQuery = await recipientQuery(context);
    let viewFilter = {};

    if (view === 'active') {
      viewFilter = { isCleared: { $ne: true }, isCompleted: { $ne: true } };
    } else if (view === 'history') {
      viewFilter = { $or: [{ isCompleted: true }, { isCleared: true }] };
    }

    const query = { ...baseQuery, ...viewFilter };
    const skip = Math.max(0, (page - 1) * limit);

    const [notifications, unreadCount, activeCount, historyCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ ...baseQuery, isRead: false, isCleared: { $ne: true }, isCompleted: { $ne: true } }),
      Notification.countDocuments({ ...baseQuery, isCleared: { $ne: true }, isCompleted: { $ne: true } }),
      Notification.countDocuments({ ...baseQuery, $or: [{ isCompleted: true }, { isCleared: true }] }),
    ]);

    return { notifications, unreadCount, activeCount, historyCount, page, limit };
  }

  /**
   * Mark a single notification as read.
   * Ownership is mandatory. A user must never mutate another user's alert.
   */
  static async markAsRead(notificationId, context) {
    const ownership = await recipientQuery(context);
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, ...ownership },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (notification && notification.recipientUserId) {
      socketManager.emitToUser(String(notification.recipientUserId), 'notification:read', { notificationId: notification._id });
    }
    return notification;
  }

  /**
   * Mark a single notification as completed.
   */
  static async markAsCompleted(notificationId, context) {
    const ownership = await recipientQuery(context);
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, ...ownership },
      {
        isCompleted: true,
        completedAt: new Date(),
        status: 'COMPLETED',
        isRead: true,
        readAt: new Date(),
      },
      { new: true }
    );
    if (notification && notification.recipientUserId) {
      socketManager.emitToUser(String(notification.recipientUserId), 'notification:completed', { notificationId: notification._id });
    }
    return notification;
  }

  /**
   * Auto-complete all active notifications matching an entity when its workflow step finishes.
   */
  static async completeEntityTasks({ hospitalId, entityType, entityId, actionType }) {
    if (!hospitalId || !entityId) return { modifiedCount: 0 };
    const entityIdStr = String(entityId);
    const orConds = [
      { entityId: entityIdStr },
      { relatedTaskId: entityIdStr },
      { 'metadata.taskId': entityIdStr },
      { 'metadata.entityId': entityIdStr },
      { 'metadata.orderId': entityIdStr },
      { 'metadata.prescriptionId': entityIdStr },
      { 'metadata.appointmentId': entityIdStr },
    ];
    if (mongoose.Types.ObjectId.isValid(entityIdStr)) {
      const objId = new mongoose.Types.ObjectId(entityIdStr);
      orConds.push({ entityId: objId });
      orConds.push({ relatedPatientId: objId });
    }
    const query = {
      hospitalId,
      $or: orConds,
      isCompleted: { $ne: true },
    };
    if (actionType) {
      query.actionType = actionType;
    }
    const matching = await Notification.find(query).select('_id recipientUserId').lean();
    if (matching.length === 0) return { modifiedCount: 0 };

    const ids = matching.map((n) => n._id);
    await Notification.updateMany(
      { _id: { $in: ids } },
      {
        isCompleted: true,
        completedAt: new Date(),
        status: 'COMPLETED',
        isRead: true,
        readAt: new Date(),
      }
    );

    matching.forEach((notif) => {
      if (notif.recipientUserId) {
        socketManager.emitToUser(String(notif.recipientUserId), 'notification:completed', { notificationId: notif._id });
      }
    });

    return { modifiedCount: matching.length };
  }

  /**
   * Mark all unread notifications matching a route path as read
   */
  static async markRouteAsRead(routePath, context) {
    if (!routePath) return { success: false };
    const query = await recipientQuery(context);
    const unread = await Notification.find({ ...query, isRead: false })
      .select('_id targetRoute link recipientUserId')
      .lean();
    const ids = unread
      .filter((item) => notificationBelongsToRoute(item.targetRoute || item.link, routePath))
      .map((item) => item._id);
    if (ids.length) {
      await Notification.updateMany({ _id: { $in: ids }, ...query }, { isRead: true, readAt: new Date() });
      unread.forEach((n) => {
        if (n.recipientUserId) {
          socketManager.emitToUser(String(n.recipientUserId), 'notification:read', { notificationId: n._id });
        }
      });
    }
    return { success: true, modifiedCount: ids.length };
  }

  /**
   * Mark all unread notifications as read for current user context
   */
  static async markAllAsRead(context) {
    const query = { ...(await recipientQuery(context)), isRead: false, isCleared: { $ne: true } };
    await Notification.updateMany(query, { isRead: true, readAt: new Date() });
    const userId = context?.userId || context?.id;
    if (userId) {
      socketManager.emitToUser(String(userId), 'notification:all_read', {});
    }
    return { success: true };
  }

  /**
   * Clear (dismiss) a single notification by ID.
   * Ownership is mandatory. A user must never dismiss another user's alert.
   */
  static async clear(notificationId, context) {
    const ownership = await recipientQuery(context);
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, ...ownership },
      { isCleared: true, clearedAt: new Date(), isRead: true, readAt: new Date() },
      { new: true }
    );
    if (notification && notification.recipientUserId) {
      socketManager.emitToUser(String(notification.recipientUserId), 'notification:cleared', { notificationId: notification._id });
    }
    return notification;
  }

  static async clearAll(context) {
    const query = await recipientQuery(context);
    await Notification.updateMany(
      { ...query, isCleared: { $ne: true } },
      { isCleared: true, clearedAt: new Date(), isRead: true, readAt: new Date() }
    );
    const userId = context?.userId || context?.id;
    if (userId) {
      socketManager.emitToUser(String(userId), 'notification:all_cleared', {});
    }
    return { success: true };
  }

  /**
   * Complete all notifications related to a finished entity or clinical work item
   */
  static async completeEntityTasks({ hospitalId, entityType, entityId, relatedPatientId, targetModule, recipientRole, branchId }) {
    if (!hospitalId && !entityId && !relatedPatientId) return;
    const filter = {
      isCompleted: { $ne: true },
      ...(hospitalId ? { hospitalId } : {}),
      $or: [
        ...(entityId ? [
          { entityId: String(entityId) },
          { relatedTaskId: String(entityId) },
          { relatedRequestId: String(entityId) },
          { 'metadata.appointmentId': String(entityId) },
          { 'metadata.orderId': String(entityId) },
          { 'metadata.taskId': String(entityId) },
          { 'metadata.invoiceId': String(entityId) },
          { 'metadata.prescriptionId': String(entityId) },
          { 'metadata.substitutionId': String(entityId) },
        ] : []),
        ...(relatedPatientId ? [
          {
            relatedPatientId,
            ...(targetModule ? { targetModule } : { targetModule: { $in: ['doctor', 'DOCTOR'] } }),
            ...(recipientRole ? { recipientRole } : {}),
          },
        ] : []),
      ],
    };

    const notifs = await Notification.find(filter).lean().catch(() => []);
    if (notifs.length > 0) {
      const ids = notifs.map((n) => n._id);
      await Notification.updateMany(
        { _id: { $in: ids } },
        { $set: { isCompleted: true, completedAt: new Date(), status: 'COMPLETED', isRead: true, readAt: new Date() } }
      );
      notifs.forEach((n) => {
        if (n.recipientUserId) {
          socketManager.emitToUser(String(n.recipientUserId), 'notification:completed', { notificationId: n._id });
          socketManager.emitToUser(String(n.recipientUserId), 'notification:read', { notificationId: n._id });
        }
      });
    }

    if (branchId) {
      socketManager.emitToBranch(branchId, 'workflow:pending_changed', { entityId, status: 'COMPLETED' });
      socketManager.emitToBranch(branchId, 'notification:cleared', { entityId });
    }
  }
}
