import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useSocket } from '../../providers/SocketProvider';
import { useDepartmentNotificationStore, pathMatches } from '../../store/departmentNotificationStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useEmergencyStore } from '../../store/emergencyStore';
import { getDefaultWorkRoute, useWorkspaceModeStore } from '../../store/workspaceModeStore';
import { axiosClient } from '../../api/axiosClient';
import { ROLE_NAVIGATION, ROLE_NAMES } from '../../utils/constants';
import { getEffectiveUserRoles } from '../auth/TenantRouteGuard';
import * as Icons from 'lucide-react';

let savedSidebarScrollTop = 0;

export const WORK_MODE_NAVIGATION = [
  // Clinical Workstation
  { title: 'Clinical EMR Desk', path: '/doctor/dashboard', icon: 'Stethoscope', module: 'doctorConsultation', category: 'Clinical Workstation', requiredRoles: ['DOCTOR'] },
  { title: 'Follow-Up Visits', path: '/doctor/dashboard?tab=FOLLOW_UPS', icon: 'Calendar', module: 'doctorConsultation', category: 'Clinical Workstation', requiredRoles: ['DOCTOR'] },
  { title: 'Completed Visits', path: '/doctor/dashboard?tab=COMPLETED', icon: 'CheckCircle2', module: 'doctorConsultation', category: 'Clinical Workstation', requiredRoles: ['DOCTOR'] },
  { title: 'Dept Responses', path: '/doctor/dashboard?tab=DEPT_RESPONSES', icon: 'FileCheck2', module: 'doctorConsultation', category: 'Clinical Workstation', requiredRoles: ['DOCTOR'] },

  // Front Desk & Billing
  { title: 'Reception Desk', path: '/reception/registered-patients', icon: 'LayoutDashboard', module: 'appointments', category: 'Front Desk & Billing', requiredRoles: ['RECEPTIONIST', 'OPD_STAFF'] },
  { title: 'Follow-Up Visits', path: '/reception/registered-patients?tab=FOLLOW_UPS', icon: 'Calendar', module: 'appointments', category: 'Front Desk & Billing', requiredRoles: ['RECEPTIONIST', 'OPD_STAFF'] },
  { title: 'Central Billing Desk', path: '/billing/dashboard', icon: 'CreditCard', module: 'billing', category: 'Front Desk & Billing', requiredRoles: ['CASHIER', 'BILLING_STAFF'] },
  { title: 'Receipts & Payments', path: '/billing/dashboard?tab=RECEIPTS', icon: 'Receipt', module: 'billing', category: 'Front Desk & Billing', requiredRoles: ['CASHIER', 'BILLING_STAFF'] },

  // Inpatient & Ward
  { title: 'IPD Requisitions', path: '/nurse-incharge/dashboard?tab=REQUISITIONS', icon: 'BedDouble', module: 'nursing', category: 'Inpatient & Ward', requiredRoles: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'DOCTOR'] },
  { title: 'Admitted Inpatients', path: '/nurse-incharge/dashboard?tab=ADMITTED', icon: 'UserCheck', module: 'nursing', category: 'Inpatient & Ward', requiredRoles: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'DOCTOR'] },
  { title: 'Ward Bed Matrix', path: '/admin/bed-matrix', icon: 'LayoutGrid', module: 'ipd', category: 'Inpatient & Ward', requiredRoles: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'DOCTOR'] },
  { title: 'Patient Requests', path: '/nurse-incharge/dashboard?tab=REQUESTS', icon: 'Activity', module: 'nursing', category: 'Inpatient & Ward', requiredRoles: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'DOCTOR'] },
  { title: 'Medication & Tasks', path: '/nurse-incharge/dashboard?tab=TASKS', icon: 'Stethoscope', module: 'nursing', category: 'Inpatient & Ward', requiredRoles: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'DOCTOR'] },

  // Support & Diagnostics
  { title: 'Pharmacy Desk', path: '/pharmacy/dashboard', icon: 'Pill', module: 'pharmacy', category: 'Support & Diagnostics', requiredRoles: ['PHARMACIST', 'PHARMACY_STAFF'] },
  { title: 'Pharmacy Stock & Prediction', path: '/pharmacy/stock', icon: 'Boxes', module: 'pharmacy', category: 'Support & Diagnostics', requiredRoles: ['PHARMACIST', 'PHARMACY_STAFF'] },
  { title: 'Laboratory Desk', path: '/laboratory/dashboard', icon: 'TestTube', module: 'laboratory', category: 'Support & Diagnostics', requiredRoles: ['LAB_TECH', 'LABORATORY_STAFF'] },
  { title: 'Radiology Desk', path: '/radiology/dashboard', icon: 'Scan', module: 'radiology', category: 'Support & Diagnostics', requiredRoles: ['RADIOLOGIST', 'RADIOLOGY_STAFF'] },

  // Live Tracking & Audit
  { title: 'Live Data Tracker', path: '/workflow/tracker', icon: 'GitBranch', module: 'workflowTracker', category: 'Live Tracking & Audit', requiredRoles: ['*'] },

  // Emergency
  { title: 'Emergency Console', path: '/emergency', icon: 'ShieldAlert', module: 'emergency', category: 'Emergency Services', requiredRoles: ['*'] },

  // Clinic Operations
  { title: 'Inventory Desk', path: '/inventory/dashboard', icon: 'Boxes', module: 'inventory', category: 'Clinic Operations', requiredRoles: ['INVENTORY_MANAGER'] },
  { title: 'HR Desk', path: '/hr/dashboard', icon: 'UserCheck', module: 'hr', category: 'Clinic Operations', requiredRoles: ['HR_MANAGER'] },
];

// Canonical workflow path resolution mapping for live navigation notifications
// Resolves data.targetRoute || data.linkedPath || data.payload?.linkedPath || workflowPaths
export const WORKFLOW_PATHS = {
  PATIENT_CARE_REQUEST_RAISED: '/nurse-incharge/dashboard?tab=REQUESTS',
};

const ALL_MODULE_NAVIGATION = [
  { title: 'Live Data Tracker', path: '/workflow/tracker', icon: 'GitBranch', module: 'workflowTracker' },
  { title: 'Reception Desk', path: '/reception/dashboard', icon: 'LayoutDashboard', module: 'appointments' },
  { title: 'Clinical EMR Desk', path: '/doctor/dashboard', icon: 'Stethoscope', module: 'doctorConsultation' },
  { title: 'IPD Requisitions', path: '/nurse-incharge/dashboard?tab=REQUISITIONS', icon: 'BedDouble', module: 'nursing' },
  { title: 'Admitted Inpatients', path: '/nurse-incharge/dashboard?tab=ADMITTED', icon: 'UserCheck', module: 'nursing' },
  { title: 'Ward Bed Matrix', path: '/admin/bed-matrix', icon: 'LayoutGrid', module: 'ipd' },
  { title: 'Patient Requests', path: '/nurse-incharge/dashboard?tab=REQUESTS', icon: 'Activity', module: 'nursing' },
  { title: 'Medication & Tasks', path: '/nurse-incharge/dashboard?tab=TASKS', icon: 'Stethoscope', module: 'nursing' },
  { title: 'Laboratory Desk', path: '/laboratory/dashboard', icon: 'TestTube', module: 'laboratory' },
  { title: 'Radiology Desk', path: '/radiology/dashboard', icon: 'Scan', module: 'radiology' },
  { title: 'Pharmacy Desk', path: '/pharmacy/dashboard', icon: 'Pill', module: 'pharmacy' },
  { title: 'Pharmacy Stock & Prediction', path: '/pharmacy/stock', icon: 'Boxes', module: 'pharmacy' },
  { title: 'Central Billing Desk', path: '/billing/dashboard', icon: 'CreditCard', module: 'billing' },
  { title: 'Receipts & Payments', path: '/billing/dashboard?tab=RECEIPTS', icon: 'Receipt', module: 'billing' },
  { title: 'Emergency Console', path: '/emergency', icon: 'ShieldAlert', module: 'emergency' },
  { title: 'Inventory Desk', path: '/inventory/dashboard', icon: 'Boxes', module: 'inventory' },
  { title: 'HR Desk', path: '/hr/dashboard', icon: 'UserCheck', module: 'hr' },
];

const checkItemPermission = (user, item) => {
  if (!user) return false;
  if (item.path.startsWith('/workflow/') || item.path.startsWith('/emergency')) return true;
  if (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN') {
    if (user.enabledModules && item.module && user.enabledModules[item.module] === false) {
      return false;
    }
    return true;
  }

  // Explicit module check
  const permissions = user.permissions || {};
  if (permissions['*']?.includes('*') || permissions['*']?.includes('view')) return true;

  const targetModule = item.module || ({
    '/doctor/': 'doctorConsultation', '/reception/': 'appointments', '/nursing/': 'nursing',
    '/nurse-incharge/': 'ipd', '/laboratory/': 'laboratory', '/radiology/': 'radiology',
    '/pharmacy/': 'pharmacy', '/billing/': 'billing', '/inventory/': 'inventory', '/hr/': 'hr',
    '/emergency': 'emergency', '/admin/': 'dashboard', '/workflow/': 'workflowTracker',
  })[Object.keys({
    '/doctor/': 1, '/reception/': 1, '/nursing/': 1, '/nurse-incharge/': 1, '/laboratory/': 1, '/radiology/': 1, '/pharmacy/': 1, '/billing/': 1, '/inventory/': 1, '/hr/': 1, '/emergency': 1, '/admin/': 1, '/workflow/': 1,
  }).find((prefix) => item.path.startsWith(prefix))];

  if (!targetModule) return false;

  const aliases = {
    dashboard: ['dashboard'],
    doctor: ['doctor', 'doctorConsultation', 'emr'],
    doctorConsultation: ['doctorConsultation', 'doctor', 'emr'],
    patients: ['patients', 'patientRegistration'],
    patientRegistration: ['patientRegistration', 'patients'],
    appointments: ['appointments', 'reception', 'tokens'],
    tokens: ['tokens', 'appointments', 'reception'],
    reception: ['reception', 'appointments', 'patientRegistration', 'tokens', 'patients'],
    nursing: ['nursing'],
    ipd: ['ipd', 'nursing', 'beds'],
    beds: ['beds', 'ipd'],
    laboratory: ['laboratory', 'diagnostics'],
    radiology: ['radiology', 'diagnostics'],
    pharmacy: ['pharmacy'],
    billing: ['billing'],
    inventory: ['inventory'],
    hr: ['hr'],
    emergency: ['emergency'],
    notifications: ['notifications'],
    reports: ['reports'],
    auditLogs: ['auditLogs'],
    hospitalSettings: ['hospitalSettings'],
  }[targetModule] || [targetModule];

  for (const mod of aliases) {
    const values = permissions[mod];
    if (Array.isArray(values) && values.length > 0) {
      if (values.includes('*') || values.includes('view') || values.some((a) => typeof a === 'string')) {
        return true;
      }
    }
  }

  // Department managers check
  if (user.department && user.role === 'DEPARTMENT_MANAGER') {
    const dept = user.department.toLowerCase();
    if (dept.includes('billing') && ['billing', 'dashboard'].includes(item.module)) return true;
    if (dept.includes('nurse') && ['nursing', 'dashboard'].includes(item.module)) return true;
    if (dept.includes('reception') && ['appointments', 'patientRegistration', 'patients', 'tokens', 'dashboard'].includes(item.module)) return true;
    if (dept.includes('pharma') && ['pharmacy', 'dashboard'].includes(item.module)) return true;
    if (dept.includes('lab') && ['laboratory', 'dashboard'].includes(item.module)) return true;
    if (dept.includes('radio') && ['radiology', 'dashboard'].includes(item.module)) return true;
  }

  // Check specific module permission
  if (item.module && permissions[item.module]) {
    const actions = permissions[item.module];
    return actions.includes('*') || actions.includes('view');
  }

  return false;
};

export const Sidebar = ({ isOpen, onClose }) => {
  const user = useAuthStore((state) => state.user);
  const { socket } = useSocket();
  const getUnreadCountForNav = useDepartmentNotificationStore((state) => state.getUnreadCountForNav);
  const fetchPendingWork = useDepartmentNotificationStore((state) => state.fetchPendingWork);
  const deptNotifs = useDepartmentNotificationStore((state) => state.notifications);
  const deptUnreadCount = useDepartmentNotificationStore((state) => state.unreadCount);
  const deptByPath = useDepartmentNotificationStore((state) => state.byPath);
  const bellNotifs = useNotificationStore((state) => state.notifications);
  const bellUnreadCount = useNotificationStore((state) => state.unreadCount);
  const activeCount = useEmergencyStore((state) => state.activeCount);
  const { currentMode, setMode, isDualModeEligible } = useWorkspaceModeStore();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);
  const [unviewedReceiptsCount, setUnviewedReceiptsCount] = useState(0);

  useEffect(() => {
    fetchPendingWork();
    useNotificationStore.getState().fetchNotifications();

    // Dynamically throttle polling interval (30s if socket connected, 20s otherwise)
    const pollTime = socket?.connected ? 30000 : 20000;
    const interval = setInterval(() => {
      // Skip polling if window/document is hidden or offline
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      fetchPendingWork();
      useNotificationStore.getState().fetchNotifications();
    }, pollTime);

    if (!socket) return () => clearInterval(interval);

    let refreshDebounceTimer = null;
    const handleRefresh = () => {
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = setTimeout(() => {
        fetchPendingWork();
        useNotificationStore.getState().fetchNotifications();
      }, 250);
    };

    socket.on('workflow:notification', handleRefresh);
    socket.on('workflow:pending_changed', handleRefresh);
    socket.on('notification:created', handleRefresh);
    socket.on('notification:completed', handleRefresh);
    socket.on('notification:cleared', handleRefresh);
    socket.on('notification:read', handleRefresh);
    socket.on('opd_queue:status_changed', handleRefresh);
    socket.on('patient:registered', handleRefresh);
    socket.on('patient:created', handleRefresh);
    socket.on('token:generated', handleRefresh);
    socket.on('opd_queue:updated', handleRefresh);
    socket.on('admission:requisition_created', handleRefresh);
    socket.on('admission:confirmed', handleRefresh);
    socket.on('nurse_task:created', handleRefresh);
    socket.on('nurse_task:updated', handleRefresh);
    socket.on('request:created', handleRefresh);
    socket.on('investigation:new_request', handleRefresh);
    socket.on('investigation:status_updated', handleRefresh);
    socket.on('diagnostics:report_ready', handleRefresh);
    socket.on('pharmacy:new_prescription', handleRefresh);
    socket.on('prescription:created', handleRefresh);
    socket.on('billing:invoice_created', handleRefresh);
    socket.on('billing:payment_collected', handleRefresh);
    socket.on('emergency:alert', handleRefresh);

    return () => {
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      clearInterval(interval);
      socket.off('workflow:notification', handleRefresh);
      socket.off('workflow:pending_changed', handleRefresh);
      socket.off('notification:created', handleRefresh);
      socket.off('notification:completed', handleRefresh);
      socket.off('notification:cleared', handleRefresh);
      socket.off('notification:read', handleRefresh);
      socket.off('opd_queue:status_changed', handleRefresh);
      socket.off('patient:registered', handleRefresh);
      socket.off('patient:created', handleRefresh);
      socket.off('token:generated', handleRefresh);
      socket.off('opd_queue:updated', handleRefresh);
      socket.off('admission:requisition_created', handleRefresh);
      socket.off('admission:confirmed', handleRefresh);
      socket.off('nurse_task:created', handleRefresh);
      socket.off('nurse_task:updated', handleRefresh);
      socket.off('request:created', handleRefresh);
      socket.off('investigation:new_request', handleRefresh);
      socket.off('investigation:status_updated', handleRefresh);
      socket.off('diagnostics:report_ready', handleRefresh);
      socket.off('pharmacy:new_prescription', handleRefresh);
      socket.off('prescription:created', handleRefresh);
      socket.off('billing:invoice_created', handleRefresh);
      socket.off('billing:payment_collected', handleRefresh);
      socket.off('emergency:alert', handleRefresh);
    };
  }, [socket, fetchPendingWork]);

  const fetchReceiptsCount = useCallback(async () => {
    setUnviewedReceiptsCount(0);
    useDepartmentNotificationStore.getState().setNavCount?.('/billing/dashboard?tab=RECEIPTS', 0);
    useDepartmentNotificationStore.getState().setNavCount?.('/billing/receipts', 0);
  }, []);

  useEffect(() => {
    fetchReceiptsCount();
  }, [fetchReceiptsCount]);

  useEffect(() => {
    if (!user?.role || !['CASHIER', 'BILLING_STAFF', 'HOSPITAL_ADMIN', 'SUPER_ADMIN'].includes(user.role)) return;

    fetchReceiptsCount();

    const interval = setInterval(fetchReceiptsCount, 15000);

    if (!socket) return () => clearInterval(interval);

    socket.on('billing:payment_collected', fetchReceiptsCount);
    socket.on('payment:collected', fetchReceiptsCount);
    socket.on('receipt:created', fetchReceiptsCount);
    socket.on('billing:receipt_created', fetchReceiptsCount);
    socket.on('billing:receipt_deleted', fetchReceiptsCount);
    socket.on('receipt:deleted', fetchReceiptsCount);
    socket.on('billing:invoice_created', fetchReceiptsCount);
    socket.on('billing:invoice_updated', fetchReceiptsCount);
    socket.on('workflow:notification', fetchReceiptsCount);
    socket.on('workflow:pending_changed', fetchReceiptsCount);

    return () => {
      clearInterval(interval);
      socket.off('billing:payment_collected', fetchReceiptsCount);
      socket.off('payment:collected', fetchReceiptsCount);
      socket.off('receipt:created', fetchReceiptsCount);
      socket.off('billing:receipt_created', fetchReceiptsCount);
      socket.off('billing:receipt_deleted', fetchReceiptsCount);
      socket.off('receipt:deleted', fetchReceiptsCount);
      socket.off('billing:invoice_created', fetchReceiptsCount);
      socket.off('billing:invoice_updated', fetchReceiptsCount);
      socket.off('workflow:notification', fetchReceiptsCount);
      socket.off('workflow:pending_changed', fetchReceiptsCount);
    };
  }, [user?.role, user?._id || user?.id, socket, fetchReceiptsCount]);

  const formatTenantPath = (path) => {
    if (!path) return path;
    const targetPath = path;
    if (user?.role === 'SUPER_ADMIN') return targetPath;
    const domainFromPath = location.pathname.split('/')[1];
    const isKnownNonTenant = ['admin', 'hospital-admin', 'doctor', 'reception', 'billing', 'pharmacy', 'laboratory', 'radiology', 'nursing', '403', 'login', 'reset-password'].includes(domainFromPath);
    const domain = user?.hospitalDomain || (!isKnownNonTenant && domainFromPath ? domainFromPath : null);

    if (!domain) {
      if (targetPath.startsWith('/admin')) {
        return targetPath.replace(/^\/admin/, '/hospital-admin');
      }
      return targetPath;
    }
    if (targetPath.startsWith(`/${domain}`)) return targetPath;
    return `/${domain}${targetPath}`;
  };

  const handleSwitchMode = (targetMode) => {
    setMode(targetMode);
    const domainFromPath = location.pathname.split('/')[1];
    const isKnownNonTenant = ['admin', 'hospital-admin', 'doctor', 'reception', 'billing', 'pharmacy', 'laboratory', 'radiology', 'nursing', '403', 'login', 'reset-password'].includes(domainFromPath);
    const domain = user?.hospitalDomain || (!isKnownNonTenant && domainFromPath ? domainFromPath : null);

    if (targetMode === 'WORK') {
      const workRoute = getDefaultWorkRoute(user);
      if (!workRoute) return;
      const target = domain ? `/${domain}${workRoute}` : workRoute;
      navigate(target);
    } else if (targetMode === 'ADMIN') {
      if (user?.role === 'SUPER_ADMIN') {
        navigate('/admin/dashboard');
      } else {
        const target = domain ? `/${domain}/admin/dashboard` : '/hospital-admin/dashboard';
        navigate(target);
      }
    }
  };

  useLayoutEffect(() => {
    const restore = () => {
      if (navRef.current && savedSidebarScrollTop > 0) {
        navRef.current.scrollTop = savedSidebarScrollTop;
      }
    };

    restore();

    const handle1 = requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });

    const timer1 = setTimeout(restore, 20);
    const timer2 = setTimeout(restore, 100);

    return () => {
      cancelAnimationFrame(handle1);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [location.pathname, location.search]);

  const handleNavScroll = (e) => {
    if (e.currentTarget.scrollTop > 0) {
      savedSidebarScrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleLinkClick = () => {
    if (navRef.current && navRef.current.scrollTop > 0) {
      savedSidebarScrollTop = navRef.current.scrollTop;
    }
    if (onClose) onClose();
  };

  const userRoles = getEffectiveUserRoles(user);

  const isGuardianView = location.pathname.includes('/guardian') || user?.role === 'GUARDIAN';
  const isDual = isDualModeEligible(user);

  let menuItems = [];
  if (isGuardianView) {
    menuItems = ROLE_NAVIGATION.GUARDIAN || [];
  } else if (isDual && currentMode === 'ADMIN') {
    const adminNavs = ROLE_NAVIGATION.HOSPITAL_ADMIN || [];
    menuItems = adminNavs.filter((item) => {
      if (user.enabledModules && item.module && user.enabledModules[item.module] === false) {
        return false;
      }
      return true;
    });
  } else if (isDual && currentMode === 'WORK') {
    // Work Mode: All active operational desks for clinical and front-desk workflows
    menuItems = WORK_MODE_NAVIGATION.filter((item) => {
      if (user.enabledModules && item.module && user.enabledModules[item.module] === false) {
        return false;
      }
      if (item.requiredRoles.includes('*')) return true;
      return item.requiredRoles.some((r) => userRoles.includes(r));
    });
  } else if (user?.role === 'HOSPITAL_ADMIN') {
    const adminNavs = ROLE_NAVIGATION.HOSPITAL_ADMIN || [];
    menuItems = adminNavs.filter((item) => {
      if (user.enabledModules && item.module && user.enabledModules[item.module] === false) {
        return false;
      }
      return true;
    });
  } else {
    let rawItems = [];
    userRoles.forEach((roleCode) => {
      const navs = ROLE_NAVIGATION[roleCode] || [];
      rawItems.push(...navs);
    });

    // Only fallback to ALL_MODULE_NAVIGATION for custom roles or when no role navigation is defined
    if (rawItems.length === 0 && !['PATIENT', 'GUARDIAN'].includes(user?.role)) {
      ALL_MODULE_NAVIGATION.forEach((navItem) => {
        if (checkItemPermission(user, navItem)) {
          rawItems.push(navItem);
        }
      });
    }

    const seenPaths = new Set();
    const seenTitles = new Set();
    menuItems = rawItems.filter((item) => {
      if (!item?.path) return false;
      const titleKey = (item.title || item.name || '').trim().toLowerCase();
      if (seenPaths.has(item.path) || seenTitles.has(titleKey)) return false;
      seenPaths.add(item.path);
      if (titleKey) seenTitles.add(titleKey);
      if (user?.enabledModules && item.module && user.enabledModules[item.module] === false) {
        return false;
      }
      return true;
    });
  }

  const isItemActive = (itemPath) => {
    const formatted = formatTenantPath(itemPath);
    const [itemPathname, itemSearch] = formatted.split('?');
    const currentSearch = location.search.replace('?', '');
    if (itemSearch) {
      return location.pathname === itemPathname && currentSearch === itemSearch;
    }
    return (location.pathname === itemPathname || location.pathname === itemPath.split('?')[0]) && !location.search.includes('tab=');
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const primaryRoleName = ROLE_NAMES[user?.role] || user?.role || 'Staff Member';
  const additionalRoleNames = (user?.additionalRoles || []).map((r) => ROLE_NAMES[r] || r).join(', ');

  const CATEGORY_ICONS = {
    'Executive & Setup': 'Building2',
    'Executive & System': 'Building2',
    'Executive & Operations': 'LayoutDashboard',
    'System & Analytics': 'BarChart3',
    'Clinical & Patient Care': 'Stethoscope',
    'Clinical Consultations': 'Stethoscope',
    'Clinical Workstation': 'Stethoscope',
    'Clinic Workflow': 'LayoutDashboard',
    'Front Desk & Billing': 'Receipt',
    'Front Desk Operations': 'LayoutDashboard',
    'Inpatient & Ward': 'BedDouble',
    'Support & Diagnostics': 'TestTube',
    'Diagnostics & Pharmacy': 'TestTube',
    'Pathology & Lab': 'TestTube',
    'Radiology & Imaging': 'Scan',
    'Pharmacy Operations': 'Pill',
    'Stock & Inventory': 'Boxes',
    'Billing & Analytics': 'BarChart3',
    'Billing & Cashier': 'CreditCard',
    'OPD Operations': 'ClipboardList',
    'Emergency Services': 'ShieldAlert',
    'General': 'Layers',
    'General Modules': 'Layers',
    'Workstation Desks': 'Briefcase',
  };

  const groupedCategories = React.useMemo(() => {
    const groups = [];
    const categoryMap = new Map();

    menuItems.forEach((item) => {
      const catName = item.category || (isDual && currentMode === 'WORK' ? 'Workstation Desks' : 'General Modules');
      if (!categoryMap.has(catName)) {
        categoryMap.set(catName, []);
        groups.push({ category: catName, items: categoryMap.get(catName) });
      }
      categoryMap.get(catName).push(item);
    });

    return groups;
  }, [menuItems, isDual, currentMode]);

  const [openCategories, setOpenCategories] = useState({});

  // Auto-expand category containing the active route
  useEffect(() => {
    const activeCategory = groupedCategories.find((group) =>
      group.items.some((item) => isItemActive(item.path))
    );
    if (activeCategory) {
      setOpenCategories((prev) => {
        if (prev[activeCategory.category]) {
          return prev;
        }
        return {
          ...prev,
          [activeCategory.category]: true,
        };
      });
    }
  }, [location.pathname, location.search, groupedCategories]);

  const toggleCategory = (catName) => {
    setOpenCategories((prev) => {
      const currentVal = prev[catName] !== undefined ? prev[catName] : true;
      return {
        ...prev,
        [catName]: !currentVal,
      };
    });
  };

  // Memoized unread counts map for all navigation items to avoid re-evaluating getUnreadCountForNav 3x per item
  const navUnreadCounts = React.useMemo(() => {
    const counts = new Map();
    groupedCategories.forEach((grp) => {
      grp.items.forEach((item) => {
        if (item.path !== '/emergency') {
          counts.set(item.path, getUnreadCountForNav(item.path) || 0);
        }
      });
    });
    return counts;
  }, [groupedCategories, getUnreadCountForNav, deptUnreadCount, deptNotifs, deptByPath, bellUnreadCount, bellNotifs]);

  // Memoized active departments alert list for incoming department work
  const activeDepts = React.useMemo(() => {
    if (isDual && currentMode === 'ADMIN') return [];
    const depts = [];
    const seenKeys = new Set();

    groupedCategories.forEach((grp) => {
      grp.items.forEach((item) => {
        if (item.path === '/emergency') {
          if (activeCount > 0 && !seenKeys.has('/emergency')) {
            seenKeys.add('/emergency');
            depts.push({
              title: 'Emergency Console',
              category: grp.category,
              path: '/emergency',
              count: activeCount,
              isEmergency: true,
            });
          }
          return;
        }

        const count = navUnreadCounts.get(item.path) || 0;
        const fullKey = item.path;
        if (count > 0 && !seenKeys.has(fullKey)) {
          seenKeys.add(fullKey);
          depts.push({
            title: item.title || item.name,
            category: grp.category,
            path: item.path,
            count,
            isEmergency: false,
          });
        }
      });
    });
    return depts;
  }, [isDual, currentMode, groupedCategories, activeCount, navUnreadCounts]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 w-64 h-full max-h-screen bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 shadow-lg lg:shadow-none shrink-0 overflow-hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between gap-3 border-b border-slate-200 flex-shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm border border-slate-200 bg-white">
              <img src="/rwmlogo.jpeg" alt="Logo" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            </div>
            <div className="min-w-0">
              <span className="font-extrabold text-slate-800 text-sm tracking-tight leading-none block">
                HPMBS
              </span>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">
                Healthcare System
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close sidebar"
          >
            <Icons.X size={20} />
          </button>
        </div>

        {/* Quick Department Activity Alert Bar (Highlights exactly which department has incoming data in Work Mode) */}
        {activeDepts.length > 0 && (
          <div className="mx-3 mt-2 p-2.5 rounded-xl bg-gradient-to-r from-amber-50 via-indigo-50/50 to-amber-50/30 border border-amber-200/90 shadow-2xs">
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                  Incoming Dept Data
                </span>
              </div>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[9px] font-black">
                {activeDepts.reduce((acc, d) => acc + d.count, 0)} New
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {activeDepts.map((dept) => (
                <button
                  key={dept.path}
                  type="button"
                  onClick={() => {
                    setOpenCategories((prev) => ({ ...prev, [dept.category]: true }));
                    navigate(formatTenantPath(dept.path));
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 transition-all shadow-2xs ${
                    dept.isEmergency
                      ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
                      : 'bg-white hover:bg-amber-100/60 text-slate-800 border-amber-200 hover:border-amber-300'
                  }`}
                  title={`Click to open ${dept.title} in ${dept.category}`}
                >
                  <span className="truncate max-w-[100px]">{dept.title}</span>
                  <span className={`px-1 rounded-full text-[9px] font-black ${dept.isEmergency ? 'bg-white text-rose-600' : 'bg-amber-500 text-white'}`}>
                    {dept.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Navigation Links with Collapsible Dropdown Accordion */}
        <nav
          ref={navRef}
          onScroll={handleNavScroll}
          className="flex-1 min-h-0 px-3 py-2 space-y-1.5 overflow-y-auto"
          aria-label="Sidebar navigation"
        >
          {groupedCategories.map((group) => {
            const isCategoryOpen = openCategories[group.category] !== false; // open by default
            const CatIcon = Icons[CATEGORY_ICONS[group.category]] || Icons.FolderClosed;
            const isCatActive = group.items.some((it) => isItemActive(it.path));

            const catEmergencyCount = group.items.reduce((acc, it) => acc + (it.path === '/emergency' ? activeCount : 0), 0);
            const catUnreadCount = group.items.reduce((acc, it) => {
              if (it.path === '/emergency') return acc;
              return acc + (navUnreadCounts.get(it.path) || 0);
            }, 0);
            const hasCategoryAlerts = catEmergencyCount > 0 || catUnreadCount > 0;

            return (
              <div key={group.category} className="rounded-xl overflow-hidden transition-all">
                {/* Accordion Category Header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(group.category)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all duration-150 group select-none ${
                    isCatActive
                      ? 'text-indigo-950 font-black bg-indigo-50/80 border border-indigo-100'
                      : hasCategoryAlerts && !isCategoryOpen
                      ? 'text-amber-950 font-black bg-amber-50/80 border border-amber-200 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 font-bold border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CatIcon
                      size={15}
                      className={`shrink-0 transition-colors ${
                        isCatActive
                          ? 'text-indigo-600'
                          : hasCategoryAlerts
                          ? 'text-amber-600'
                          : 'text-slate-400 group-hover:text-slate-600'
                      }`}
                    />
                    <span className="text-[11px] uppercase tracking-wider truncate font-black">
                      {group.category}
                    </span>
                    {hasCategoryAlerts && !isCategoryOpen && (
                      <span className="relative flex h-1.5 w-1.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {catEmergencyCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white animate-pulse shadow-xs">
                        {catEmergencyCount}
                      </span>
                    )}
                    {catUnreadCount > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black text-white shadow-xs ${!isCategoryOpen ? 'bg-amber-500 animate-pulse' : 'bg-indigo-600'}`}>
                        {catUnreadCount}
                      </span>
                    )}
                    {isCategoryOpen ? (
                      <Icons.ChevronDown size={14} className="text-slate-400 group-hover:text-slate-700 transition-transform" />
                    ) : (
                      <Icons.ChevronRight size={14} className="text-slate-400 group-hover:text-slate-700 transition-transform" />
                    )}
                  </div>
                </button>

                {/* Collapsible Sub-Items */}
                {isCategoryOpen && (
                  <div className="mt-1 pl-2.5 space-y-0.5 border-l-2 border-slate-100 ml-3.5 pb-1">
                    {group.items.map((item) => {
                      const IconComponent = Icons[item.icon] || Icons.Circle;
                      const label = item.title || item.name || 'Navigation Item';
                      const active = isItemActive(item.path);
                      const isEmergencyItem = item.path === '/emergency';
                      const navUnreadCount = isEmergencyItem ? 0 : (navUnreadCounts.get(item.path) || 0);
                      const isReceiptsHistory = item.path.includes('tab=RECEIPTS') || item.path.includes('/billing/receipts');

                      const handleNavClick = (e) => {
                        if (isGuardianView && (isEmergencyItem || label === 'Emergency Assistance')) {
                          e.preventDefault();
                          window.dispatchEvent(new CustomEvent('open-emergency-modal'));
                        }
                        handleLinkClick();
                      };

                      return (
                        <Link
                          key={item.path}
                          to={formatTenantPath(item.path)}
                          onClick={handleNavClick}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
                            active
                              ? 'bg-indigo-600 text-white font-bold shadow-xs shadow-indigo-600/20'
                              : isEmergencyItem && activeCount > 0
                              ? 'bg-rose-50 text-rose-700 font-bold border border-rose-200 animate-pulse'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <IconComponent
                              size={15}
                              className={`shrink-0 ${
                                active
                                  ? 'text-white'
                                  : isEmergencyItem && activeCount > 0
                                  ? 'text-rose-600'
                                  : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">{label}</span>
                          </div>

                          {isEmergencyItem && activeCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-600 text-white shadow-xs animate-bounce">
                              {activeCount}
                            </span>
                          )}

                          {isReceiptsHistory && unviewedReceiptsCount > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shadow-xs ${active ? 'bg-white text-indigo-700' : 'bg-amber-500 text-white'}`}>
                              {unviewedReceiptsCount}
                            </span>
                          )}

                          {!isEmergencyItem && !isReceiptsHistory && navUnreadCount > 0 && (
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shadow-xs ${active ? 'bg-white text-indigo-700' : 'bg-rose-600 text-white'}`}>
                              {navUnreadCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 flex-shrink-0 bg-slate-50">
          <p className="text-[11px] text-slate-400 font-medium text-center">
            HPMBS Enterprise OS v2.4.0 &mdash; ISO &amp; HIPAA Compliant
          </p>
        </div>
      </aside>
    </>
  );
};
