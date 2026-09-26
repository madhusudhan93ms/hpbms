import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getEffectiveUserRoles } from '../components/auth/TenantRouteGuard';

const checkModulePermission = (permissions, currentModule) => {
  if (!permissions) return false;
  if (permissions['*']?.includes('*') || permissions['*']?.includes('view')) return true;

  const aliases = {
    doctor: ['doctor', 'doctorConsultation', 'emr'],
    reception: ['reception', 'patientRegistration', 'patients', 'tokens', 'appointments'],
    nursing: ['nursing'],
    ipd: ['ipd', 'nursing', 'beds'],
    laboratory: ['laboratory', 'diagnostics'],
    radiology: ['radiology', 'diagnostics'],
    pharmacy: ['pharmacy'],
    billing: ['billing'],
    inventory: ['inventory'],
    hr: ['hr'],
    emergency: ['emergency'],
    patients: ['patients', 'patientRegistration'],
    appointments: ['appointments'],
  }[currentModule] || [currentModule];

  for (const mod of aliases) {
    const values = permissions[mod];
    if (Array.isArray(values) && (values.includes('*') || values.includes('view'))) {
      return true;
    }
    if (typeof values === 'object' && values !== null && (values.view === true || values['*'] === true)) {
      return true;
    }
  }

  return false;
};

export const ProtectedRoute = ({ allowedRoles = [] }) => {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading && !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold text-slate-700">Verifying session security...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !user) {
    return <Navigate to="/login" replace />;
  }

  const isAdminRoute = location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/hospital-admin') ||
    /^\/[^/]+\/admin(\/|$)/.test(location.pathname);

  const routeModules = [
    ['/doctor/', 'doctor'], ['/reception/', 'reception'], ['/nursing/', 'nursing'],
    ['/nurse-incharge/', 'ipd'], ['/laboratory/', 'laboratory'], ['/radiology/', 'radiology'],
    ['/pharmacy/', 'pharmacy'], ['/billing/', 'billing'], ['/inventory/', 'inventory'],
    ['/hr/', 'hr'], ['/emergency', 'emergency'], ['/patients', 'patients'], ['/appointments', 'appointments'],
  ];
  const currentModule = !isAdminRoute ? routeModules.find(([prefix]) => location.pathname.includes(prefix))?.[1] : null;

  const userRoles = getEffectiveUserRoles(user);
  const additionalRoles = userRoles.filter((r) => r !== user?.role);
  const operationalAllowedRoles = allowedRoles.filter((role) => !['HOSPITAL_ADMIN', 'SUPER_ADMIN'].includes(role));

  const isSuperAdmin = userRoles.includes('SUPER_ADMIN');
  const isSuperAdminAllowed = allowedRoles.length === 0 || allowedRoles.includes('SUPER_ADMIN');

  if (isSuperAdmin) {
    if (isSuperAdminAllowed) {
      return <Outlet />;
    }
    return <Navigate to="/403" replace />;
  }

  if (currentModule && user?.role === 'HOSPITAL_ADMIN' && !operationalAllowedRoles.some((role) => additionalRoles.includes(role))) {
    return <Navigate to="/403" replace />;
  }

  const hasRoleMatch = allowedRoles.length === 0 ||
    allowedRoles.some((role) => userRoles.includes(role));

  const hasPerm = currentModule ? checkModulePermission(user?.permissions, currentModule) : false;

  if (allowedRoles.length > 0 && user && !hasRoleMatch && !hasPerm) {
    if (userRoles.includes('HOSPITAL_ADMIN') && location.pathname.startsWith('/admin')) {
      const target = user.hospitalDomain ? `/${user.hospitalDomain}/admin/dashboard` : '/hospital-admin/dashboard';
      return <Navigate to={target} replace />;
    }
    return <Navigate to="/403" replace />;
  }

  if (currentModule && userRoles.includes('HOSPITAL_ADMIN') && user.enabledModules?.[currentModule] === false) {
    return <Navigate to="/403" replace />;
  }

  if (currentModule && !userRoles.includes('HOSPITAL_ADMIN')) {
    const allowed = checkModulePermission(user?.permissions, currentModule);
    if (!allowed) return <Navigate to="/403" replace />;
  }

  return <Outlet />;
};
