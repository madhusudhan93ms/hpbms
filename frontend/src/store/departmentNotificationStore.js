import { create } from 'zustand';
import { axiosClient } from '../api/axiosClient';
import { useNotificationStore } from './notificationStore';

const cleanPathCache = new Map();
// Strips protocol, host, and tenant prefix (e.g. /test-hospital-1/)
export const cleanPath = (raw) => {
  if (!raw) return '';
  const cached = cleanPathCache.get(raw);
  if (cached !== undefined) return cached;
  let p = raw.trim();
  // Strip protocol and host if present
  try {
    if (p.startsWith('http://') || p.startsWith('https://')) {
      const url = new URL(p);
      p = url.pathname + url.search;
    }
  } catch {}

  // Strip tenant prefix: /tenant-name/(doctor|reception|nursing|nurse-incharge|admin|hospital-admin|billing|pharmacy|laboratory|radiology|emergency)
  // Ensure the section name is bounded by '/', '?', or end of string so '/admin/doctors-management' doesn't match 'doctor'
  p = p.replace(/^\/[^/]+(?=\/(?:doctor|reception|nursing|nurse-incharge|admin|hospital-admin|billing|pharmacy|laboratory|radiology|emergency)(?:\/|$|\?))/, '');
  if (cleanPathCache.size > 500) cleanPathCache.clear();
  cleanPathCache.set(raw, p);
  return p;
};

export const isSubPath = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

export const pathMatches = (taskPath, navPath, metadata = {}) => {
  if (!navPath) return false;

  const targetPath = cleanPath(taskPath || metadata.targetRoute || metadata.link || metadata.linkedPath || '');
  const baseNav = cleanPath(navPath);
  const [tPath, tQueryStr = ''] = targetPath.split('?');
  const [nPath, nQueryStr = ''] = baseNav.split('?');
  const tParams = new URLSearchParams(tQueryStr.toLowerCase());
  const nParams = new URLSearchParams(nQueryStr.toLowerCase());
  const tTab = (tParams.get('tab') || '').toUpperCase();
  const nTab = (nParams.get('tab') || '').toUpperCase();

  // If no target path exists, check targetModule
  if (!targetPath && metadata.targetModule) {
    const mod = (metadata.targetModule || '').toLowerCase();
    if (mod === 'doctor' && isSubPath(baseNav, '/doctor') && (!nTab || nTab === 'LIVE' || nTab === 'OVERVIEW')) return true;
    if (mod === 'nursing' && (isSubPath(baseNav, '/nurse-incharge') || isSubPath(baseNav, '/nursing')) && (!nTab || nTab === 'TASKS')) return true;
    if (mod === 'billing' && isSubPath(baseNav, '/billing') && !nTab) return true;
    if (mod === 'pharmacy' && isSubPath(baseNav, '/pharmacy') && !nTab) return true;
    if (mod === 'laboratory' && isSubPath(baseNav, '/laboratory') && !nTab) return true;
    if (mod === 'radiology' && isSubPath(baseNav, '/radiology') && !nTab) return true;
    if (mod === 'reception' && isSubPath(baseNav, '/reception') && !nTab) return true;
  }

  if (!targetPath) return false;

  // Admin Management Views: Only match exact admin routes or explicit admin notifications
  // Admin management views (like /admin/doctors-management, /admin/staff, etc.) should NEVER match clinical patient workflow tasks
  if (isSubPath(nPath, '/admin') || isSubPath(nPath, '/hospital-admin')) {
    if (nPath.includes('/bed-matrix')) return tPath.includes('/admin/bed-matrix') || tPath.includes('/beds');
    return tPath === nPath;
  }

  // 1. Doctor Routes (Work Mode)
  const isDoctorTask = tPath.startsWith('/doctor');
  const isDoctorNav = nPath.startsWith('/doctor');
  if (isDoctorTask && isDoctorNav) {
    const isDeptResponse = Boolean(
      tTab === 'DEPT_RESPONSES' ||
      tTab === 'SENT_DEPARTMENTS' ||
      metadata.notificationType === 'DEPARTMENT_RESPONSE' ||
      metadata.notificationType === 'DEPT_RESPONSE' ||
      metadata.notificationType === 'NURSE_RESPONSE' ||
      metadata.notificationType === 'SUBSTITUTION_REQUEST' ||
      metadata.notificationType === 'BILLING_QUERY' ||
      metadata.notificationType === 'DOCTOR_REQUEST' ||
      metadata.type === 'BILLING_QUERY' ||
      metadata.type === 'DEPT_RESPONSE' ||
      metadata.type === 'DEPARTMENT_RESPONSE' ||
      metadata.type === 'NURSE_RESPONSE' ||
      metadata.type === 'NURSE_TASK_COMPLETED' ||
      metadata.type === 'REPORT_READY' ||
      metadata.type === 'SUBSTITUTION_REQUEST' ||
      metadata.type === 'DOCTOR_REQUEST' ||
      metadata.actionType === 'REVIEW_BILLING_QUERY' ||
      metadata.event === 'billing:returned_to_doctor' ||
      metadata.event === 'nurse:request_completed' ||
      metadata.event === 'diagnostics:report_ready' ||
      metadata.event === 'pharmacy:substitution_requested'
    );

    if (nTab === 'DEPT_RESPONSES') {
      return isDeptResponse;
    }
    if (nTab === 'FOLLOW_UPS') return tTab === 'FOLLOW_UPS';
    if (nTab === 'COMPLETED') return tTab === 'COMPLETED';
    if (!nTab || nTab === 'OVERVIEW' || nTab === 'LIVE') {
      if (isDeptResponse) return false;
      return !tTab || tTab === 'OVERVIEW' || tTab === 'LIVE' || tTab === 'QUEUE';
    }
    return tTab === nTab;
  }

  // 2. Nursing Routes (Work Mode)
  const isNursingTask = tPath.startsWith('/nurse-incharge') || tPath.startsWith('/nursing');
  const isNursingNav = nPath.startsWith('/nurse-incharge') || nPath.startsWith('/nursing');
  if (isNursingTask && isNursingNav) {
    if (nTab === 'TASKS') {
      return !tTab || tTab === 'TASKS' || metadata.targetModule === 'nursing' || metadata.type === 'NEW_NURSE_TASKS' || metadata.notificationType === 'NEW_DATA';
    }
    if (nTab === 'REQUISITIONS') return tTab === 'REQUISITIONS' || metadata.type === 'ADMISSION_REQUISITION';
    if (nTab === 'ADMITTED') return tTab === 'ADMITTED';
    if (nTab === 'REQUESTS') return tTab === 'REQUESTS';
    return true;
  }

  // 3. Reception Routes (Work Mode)
  const isReceptionTask = tPath.startsWith('/reception');
  const isReceptionNav = nPath.startsWith('/reception');
  if (isReceptionTask && isReceptionNav) {
    if (nTab === 'FOLLOW_UPS') return tTab === 'FOLLOW_UPS';
    if (nTab === 'ALL') return tTab === 'ALL';
    if (nPath.includes('/tokens')) return tPath.includes('/tokens') || tPath.includes('/queue');
    if (!nTab) return !tTab || tTab === 'DASHBOARD' || tTab === 'REGISTERED';
    return true;
  }

  // 4. Billing Desk (Work Mode)
  const isBillingTask = tPath.startsWith('/billing');
  const isBillingNav = nPath.startsWith('/billing');
  if (isBillingTask && isBillingNav) {
    if (nTab === 'RECEIPTS') return tTab === 'RECEIPTS' || tPath.includes('/receipts');
    if (!nTab) return !tTab || tTab === 'DASHBOARD';
    return true;
  }

  // 5. Pharmacy (Work Mode)
  const isPharmacyTask = tPath.startsWith('/pharmacy');
  const isPharmacyNav = nPath.startsWith('/pharmacy');
  if (isPharmacyTask && isPharmacyNav) {
    return true;
  }

  // 6. Diagnostics (Lab / Radiology)
  if (nPath.startsWith('/laboratory') && tPath.startsWith('/laboratory')) {
    if (nTab === 'RESULTS' || nTab === 'REPORTS') return tTab === 'RESULTS' || tTab === 'REPORTS';
    if (!nTab) return !tTab || tTab === 'ACTIVE' || tTab === 'QUEUE';
    return tTab === nTab;
  }
  if (nPath.startsWith('/radiology') && tPath.startsWith('/radiology')) {
    if (nTab === 'DICOM') return tTab === 'DICOM';
    if (nTab === 'REPORTS') return tTab === 'REPORTS';
    if (!nTab || nTab === 'ACTIVE') return !tTab || tTab === 'ACTIVE' || tTab === 'QUEUE';
    return tTab === nTab;
  }
  if (nPath.startsWith('/emergency') && tPath.startsWith('/emergency')) return true;

  if (tPath !== nPath) return false;
  if (!nTab) return true;
  return tTab === nTab;
};

/**
 * Department and workflow notification store.
 */
export const useDepartmentNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  byPath: {},
  navCountOverrides: {},
  isLoading: false,

  fetchPendingWork: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const response = await axiosClient.get('/workflow/pending');
      const snapshot = response?.data || response || { total: 0, byPath: {}, tasks: [] };
      const tasks = (snapshot.tasks || []).map((item) => ({
        ...item,
        patientName: item.patientName || 'Patient',
        uhid: item.uhid || 'N/A',
        timestamp: item.createdAt ? new Date(item.createdAt) : new Date(),
        isPending: true,
        isRead: false,
      }));
      set({ notifications: tasks, unreadCount: Number(snapshot.total) || 0, byPath: snapshot.byPath || {} });
    } catch (error) {
      // Quietly handle transient server or network hiccups during background polling
    } finally {
      set({ isLoading: false });
    }
  },

  fetchInitialNotifications: async () => get().fetchPendingWork(),
  refreshPendingWork: async () => get().fetchPendingWork(),
  addNotification: () => get().fetchPendingWork(),
  resolvePending: (resourceId) => {
    if (!resourceId) {
      get().fetchPendingWork();
      return;
    }
    const resStr = String(resourceId);
    set((state) => {
      const remaining = state.notifications.filter((n) => (
        String(n.resourceId || '') !== resStr &&
        String(n.id || '') !== resStr &&
        String(n._id || '') !== resStr &&
        String(n.entityId || '') !== resStr &&
        String(n.relatedTaskId || '') !== resStr &&
        String(n.metadata?.taskId || '') !== resStr &&
        String(n.metadata?.entityId || '') !== resStr &&
        String(n.appointmentId || '') !== resStr &&
        String(n.patientId || '') !== resStr &&
        !String(n.linkedPath || '').includes(resStr)
      ));
      return {
        notifications: remaining,
        unreadCount: Math.max(0, remaining.length),
      };
    });
    get().fetchPendingWork();
  },

  markAsRead: () => get().fetchPendingWork(),
  markAllAsRead: () => get().fetchPendingWork(),
  markAsReadForNav: () => {},

  setNavCount: (navPath, count) => set((state) => {
    const cleaned = cleanPath(navPath);
    const parsedCount = Math.max(0, Number(count) || 0);
    return {
      navCountOverrides: {
        ...state.navCountOverrides,
        [navPath]: parsedCount,
        ...(cleaned ? { [cleaned]: parsedCount } : {}),
      },
    };
  }),

  getUnreadCountForNav: (navPath) => {
    const cleaned = cleanPath(navPath);
    const override = get().navCountOverrides[navPath] !== undefined
      ? get().navCountOverrides[navPath]
      : get().navCountOverrides[cleaned];
    if (override !== undefined) return override;

    // Admin management roster views never show clinical queue counts
    if (isSubPath(cleaned, '/admin') || isSubPath(cleaned, '/hospital-admin')) {
      if (!cleaned.includes('/bed-matrix') && !cleaned.includes('/emergency')) {
        // Direct exact match only for admin tasks (e.g. pending approvals)
        const matchingAdminTasks = get().notifications.filter((item) => {
          const itemPath = cleanPath(item.linkedPath || item.targetRoute || item.link || '');
          return itemPath === cleaned;
        }).length;
        return matchingAdminTasks;
      }
    }

    // 1. Check matching pending tasks from /workflow/pending (active queue tasks)
    const matchingPendingCount = get().notifications.filter((item) => pathMatches(item.linkedPath, navPath, item)).length;
    if (matchingPendingCount > 0) return matchingPendingCount;

    // 2. Direct path mapping from workflow pending snapshot
    if (get().byPath[navPath] !== undefined) return get().byPath[navPath];
    if (cleaned && get().byPath[cleaned] !== undefined) return get().byPath[cleaned];

    // 3. Fallback: Check active unread notifications from notificationStore
    try {
      const bellNotifs = useNotificationStore.getState().notifications || [];
      const unreadBellMatching = bellNotifs.filter((item) => !item.isRead && !item.isCompleted && !item.isCleared && pathMatches(item.linkedPath || item.targetRoute || item.link, navPath, item)).length;
      if (unreadBellMatching > 0) return unreadBellMatching;
    } catch {}

    return 0;
  },
}));
