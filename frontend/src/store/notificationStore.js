import { create } from 'zustand';
import { axiosClient } from '../api/axiosClient';
import { useAuthStore } from './authStore';

export const isUnauthorizedForRole = (notif, userRole, additionalRoles = []) => {
  if (!userRole) return false;
  const allRoles = [userRole, ...(Array.isArray(additionalRoles) ? additionalRoles : [])].filter(Boolean);

  const target = (notif.linkedPath || notif.targetRoute || notif.link || '').toLowerCase();
  const mod = (notif.targetModule || '').toLowerCase();
  const type = String(notif.type || notif.notificationType || '').toUpperCase();
  const title = String(notif.title || '').toLowerCase();
  const recipientRole = String(notif.recipientRole || '').toUpperCase();

  // 1. Emergency & global broadcasts: allowed for all hospital staff
  if (type === 'EMERGENCY' || recipientRole === 'ALL' || title.includes('emergency')) {
    return false;
  }

  // 2. Super Admin: Platform SaaS governance ONLY — exclude clinic operational tasks
  if (userRole === 'SUPER_ADMIN') {
    if (['doctor', 'nursing', 'nurse-incharge', 'pharmacy', 'laboratory', 'radiology', 'billing', 'reception', 'ipd', 'opd'].some((m) => target.includes(`/${m}`) || mod === m)) {
      return true;
    }
    if ([
      'WORKFLOW', 'WORKFLOW_ALERT', 'NEW_DATA', 'DEPT_RESPONSE', 'DEPARTMENT_RESPONSE',
      'NURSE_RESPONSE', 'BILLING_UPDATE', 'PRESCRIPTION_ISSUED', 'PATIENT_QUEUED',
      'DIAGNOSTIC_ORDER', 'NURSE_TASKS', 'NURSE_TASK_COMPLETED', 'REPORT_READY',
      'DOCTOR_PATIENT', 'BILLING_WORK', 'LAB_WORK', 'RADIOLOGY_WORK',
    ].includes(type)) {
      return true;
    }
    return false;
  }

  // 3. Clinical Doctor OPD consultation queue and clinical consultations:
  // Strictly requires DOCTOR role. Non-doctors (including Hospital Admin without doctor role) must NEVER receive or see doctor consultation queue tasks.
  const isDoctorClinicalTask = (
    type === 'PATIENT_QUEUED' ||
    type === 'TOKEN_REQUEUED' ||
    type === 'DOCTOR_ACCEPTED_PATIENT' ||
    title.includes('patient in queue') ||
    title.includes('patient re-queued') ||
    (mod === 'doctor' && (target.includes('/doctor/dashboard?tab=live') || title.includes('consultation') || title.includes('queue')))
  );
  if (isDoctorClinicalTask && !allRoles.includes('DOCTOR')) {
    return true;
  }

  // 4. If the user is HOSPITAL_ADMIN:
  // Admins can see all hospital departmental alerts and governance notifications (except Doctor OPD queue which was handled above)
  if (userRole === 'HOSPITAL_ADMIN' || allRoles.includes('HOSPITAL_ADMIN')) {
    return false;
  }

  // 5. Check if at least ONE of user's active roles has access to this notification
  const roleAllowed = allRoles.some((role) => {
    switch (role) {
      case 'DOCTOR':
        return mod === 'doctor' || target.includes('/doctor') || type === 'BILLING_QUERY' || type === 'SUBSTITUTION_REQUEST' || type === 'REPORT_READY' || type === 'DEPT_RESPONSE';
      case 'PHARMACIST':
      case 'PHARMACY_STAFF':
        return mod === 'pharmacy' || target.includes('/pharmacy') || type.includes('PHARMACY') || type.includes('PRESCRIPTION') || title.includes('prescription') || title.includes('dispense');
      case 'CASHIER':
      case 'BILLING_STAFF':
        return mod === 'billing' || mod === 'cashier' || target.includes('/billing') || type.includes('BILL') || type.includes('INVOICE') || type.includes('PAYMENT') || title.includes('bill') || title.includes('invoice') || title.includes('payment');
      case 'LAB_TECH':
      case 'LABORATORY_STAFF':
        return mod === 'laboratory' || target.includes('/laboratory') || type.includes('LAB') || title.includes('lab') || title.includes('blood') || title.includes('urine');
      case 'RADIOLOGIST':
      case 'RADIOLOGY_STAFF':
        return mod === 'radiology' || target.includes('/radiology') || type.includes('RADIOLOGY') || title.includes('radiology') || title.includes('scan') || title.includes('x-ray');
      case 'NURSE':
      case 'NURSE_INCHARGE':
        return mod === 'nursing' || mod === 'nurse-incharge' || target.includes('/nurse') || type.includes('NURSE') || title.includes('nurse') || title.includes('injection') || title.includes('treatment');
      case 'RECEPTIONIST':
      case 'OPD_STAFF':
        return mod === 'reception' || target.includes('/reception') || type.includes('TOKEN') || title.includes('token') || title.includes('patient') || title.includes('registration') || title.includes('payment collected');
      default:
        return false;
    }
  });

  return !roleAllowed;
};

const normalize = (notification) => ({
  ...notification,
  id: notification._id || notification.id,
  linkedPath: notification.targetRoute || notification.link || '',
  timestamp: notification.createdAt ? new Date(notification.createdAt) : new Date(),
  completedAt: notification.completedAt ? new Date(notification.completedAt) : null,
  patientName: notification.metadata?.patientName || 'Patient',
  uhid: notification.metadata?.uhid || 'N/A',
  priority: notification.priority || 'NORMAL',
  isCompleted: Boolean(notification.isCompleted),
});

let inFlightFetch = null;
let inFlightView = null;

/** Persisted task notifications and separate activity history */
export const useNotificationStore = create((set, get) => ({
  notifications: [],
  historyNotifications: [],
  unreadCount: 0,
  activeCount: 0,
  historyCount: 0,
  activeTab: 'ACTIVE',
  isLoading: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  fetchNotifications: async (view = 'active') => {
    if (inFlightFetch && inFlightView === view) {
      return inFlightFetch;
    }
    inFlightView = view;
    inFlightFetch = (async () => {
      try {
        const result = await axiosClient.get(`/notifications?view=${encodeURIComponent(view)}`);
        const data = result?.data || result || {};
        const user = useAuthStore.getState().user;
        const userRole = user?.role;
        const additionalRoles = user?.additionalRoles || [];
        const allItems = (data.notifications || []).map(normalize);
        const items = allItems.filter(
          (n) => !isUnauthorizedForRole(n, userRole, additionalRoles)
        );
        const unread = items.filter((n) => !n.isRead && !n.isCompleted).length;

        if (view === 'history') {
          set({
            historyNotifications: items,
            historyCount: items.length,
            unreadCount: unread,
            isLoading: false,
          });
        } else {
          set({
            notifications: items,
            activeCount: items.length,
            historyCount: data.historyCount !== undefined ? data.historyCount : get().historyCount,
            unreadCount: unread,
            isLoading: false,
          });
        }
      } catch (error) {
        const isNetworkError = error?.code === 'ERR_NETWORK' || error?.message?.includes('Network Error') || !error?.response;
        if (!isNetworkError) {
          console.error('Failed to load notifications:', error);
        }
        set({ isLoading: false });
      } finally {
        inFlightFetch = null;
        inFlightView = null;
      }
    })();
    return inFlightFetch;
  },

  fetchHistory: async () => get().fetchNotifications('history'),

  fetchInitialNotifications: async () => {
    await Promise.all([
      get().fetchNotifications('active'),
      get().fetchNotifications('history'),
    ]);
  },

  addNotification: (payload) => {
    if (payload && (payload.title || payload.message)) {
      const user = useAuthStore.getState().user;
      const userRole = user?.role;
      const additionalRoles = user?.additionalRoles || [];
      const normalized = normalize(payload);
      if (isUnauthorizedForRole(normalized, userRole, additionalRoles)) {
        return;
      }
      set((state) => {
        const exists = state.notifications.some((n) => n.id === normalized.id);
        if (exists) return state;
        return {
          notifications: [normalized, ...state.notifications],
          activeCount: state.activeCount + 1,
          unreadCount: state.unreadCount + (normalized.isRead ? 0 : 1),
        };
      });
    }
    get().fetchNotifications('active');
  },

  markAsRead: async (id) => {
    const item = get().notifications.find((n) => n.id === id);
    if (item && !item.isRead) {
      set((state) => ({
        notifications: state.notifications.map((n) => n.id === id ? { ...n, isRead: true } : n),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
    }
    try {
      await axiosClient.patch(`/notifications/${encodeURIComponent(id)}/read`);
    } catch (error) {
      await get().fetchNotifications(get().activeTab === 'HISTORY' ? 'history' : 'active');
    }
  },

  markAsCompleted: async (id) => {
    const completedItem = get().notifications.find((n) => n.id === id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      historyNotifications: completedItem
        ? [{ ...completedItem, isCompleted: true, isRead: true, completedAt: new Date() }, ...state.historyNotifications]
        : state.historyNotifications,
      activeCount: Math.max(0, state.activeCount - 1),
      historyCount: state.historyCount + 1,
      unreadCount: Math.max(0, state.unreadCount - (completedItem && !completedItem.isRead ? 1 : 0)),
    }));
    try {
      await axiosClient.patch(`/notifications/${encodeURIComponent(id)}/complete`);
    } catch (error) {
      console.error('Failed to complete notification task:', error);
      await get().fetchInitialNotifications();
    }
  },

  resolveEntityNotification: async (entityOrTaskId) => {
    if (!entityOrTaskId) return;
    const targetStr = String(entityOrTaskId);
    const matching = get().notifications.filter((n) =>
      String(n.id) === targetStr ||
      String(n.entityId) === targetStr ||
      String(n.relatedTaskId) === targetStr ||
      String(n.metadata?.taskId) === targetStr ||
      String(n.metadata?.orderId) === targetStr ||
      String(n.metadata?.invoiceId) === targetStr ||
      String(n.metadata?.appointmentId) === targetStr ||
      (n.targetRoute && n.targetRoute.includes(targetStr)) ||
      (n.link && n.link.includes(targetStr))
    );
    if (matching.length > 0) {
      const ids = new Set(matching.map((m) => m.id));
      const unreadRemoved = matching.filter((m) => !m.isRead).length;
      set((state) => ({
        notifications: state.notifications.filter((n) => !ids.has(n.id)),
        activeCount: Math.max(0, state.activeCount - matching.length),
        unreadCount: Math.max(0, state.unreadCount - unreadRemoved),
      }));
      for (const m of matching) {
        try {
          await axiosClient.patch(`/notifications/${encodeURIComponent(m.id)}/complete`);
        } catch {}
      }
    }
    get().fetchNotifications('active');
  },

  markRouteAsRead: async (routePath) => {
    if (!routePath) return;
    const clean = String(routePath).split('?')[0];
    set((state) => {
      let readDeduction = 0;
      const updated = state.notifications.map((n) => {
        const link = n.linkedPath || n.targetRoute || n.link || '';
        if (!n.isRead && link.includes(clean)) {
          readDeduction += 1;
          return { ...n, isRead: true };
        }
        return n;
      });
      return {
        notifications: updated,
        unreadCount: Math.max(0, state.unreadCount - readDeduction),
      };
    });
    try {
      await axiosClient.post('/notifications/read-route', { route: routePath });
    } catch {
      // ignore
    }
  },

  resolveRouteNotifications: async (routePath) => {
    if (!routePath) return;
    const clean = String(routePath).split('?')[0];
    const matching = get().notifications.filter((n) => {
      const link = n.linkedPath || n.targetRoute || n.link || '';
      return link.includes(clean);
    });
    if (matching.length > 0) {
      const ids = new Set(matching.map((m) => m.id));
      const unreadRemoved = matching.filter((m) => !m.isRead).length;
      set((state) => ({
        notifications: state.notifications.filter((n) => !ids.has(n.id)),
        historyNotifications: [
          ...matching.map((m) => ({ ...m, isCompleted: true, isRead: true, completedAt: new Date() })),
          ...state.historyNotifications,
        ],
        activeCount: Math.max(0, state.activeCount - matching.length),
        historyCount: state.historyCount + matching.length,
        unreadCount: Math.max(0, state.unreadCount - unreadRemoved),
      }));
      for (const m of matching) {
        try {
          await axiosClient.patch(`/notifications/${encodeURIComponent(m.id)}/complete`);
        } catch {}
      }
    }
  },

  markAllAsRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
    try {
      await axiosClient.post('/notifications/read-all');
    } catch (error) {
      await get().fetchNotifications('active');
    }
  },

  clearNotification: async (id) => {
    const isHistory = get().activeTab === 'HISTORY';
    set((state) => {
      const removed = (isHistory ? state.historyNotifications : state.notifications).find((n) => n.id === id);
      return {
        notifications: isHistory ? state.notifications : state.notifications.filter((n) => n.id !== id),
        historyNotifications: isHistory ? state.historyNotifications.filter((n) => n.id !== id) : state.historyNotifications,
        activeCount: isHistory ? state.activeCount : Math.max(0, state.activeCount - 1),
        historyCount: isHistory ? Math.max(0, state.historyCount - 1) : state.historyCount,
        unreadCount: Math.max(0, state.unreadCount - (removed && !removed.isRead ? 1 : 0)),
      };
    });
    try {
      await axiosClient.delete(`/notifications/${encodeURIComponent(id)}`);
    } catch (error) {
      console.error('Failed to clear notification:', error);
      await get().fetchNotifications(isHistory ? 'history' : 'active');
    }
  },

  clearAllNotifications: async () => {
    const isHistory = get().activeTab === 'HISTORY';
    if (isHistory) {
      set({ historyNotifications: [], historyCount: 0 });
    } else {
      set({ notifications: [], activeCount: 0, unreadCount: 0 });
    }
    try {
      await axiosClient.delete('/notifications/clear-all');
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      await get().fetchNotifications(isHistory ? 'history' : 'active');
    }
  },
}));
