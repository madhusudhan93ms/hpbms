import React, { useEffect, useState } from "react";
import { useParams, Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { axiosClient } from "../../api/axiosClient";
import { HospitalNotFoundPage } from "../../pages/HospitalNotFoundPage";

// Cache verified domains in memory so we only hit the API once per session
export const verifiedDomainCache = new Set();
export const notFoundDomainCache = new Set();

export const getEffectiveUserRoles = (user) => {
  if (!user) return [];
  const roles = new Set([
    user.role,
    ...(Array.isArray(user.additionalRoles) ? user.additionalRoles : []),
  ].filter(Boolean));

  // If user is a Hospital Admin and availability is active, expand roles from adminDepartmentAvailability
  if (user.role === 'HOSPITAL_ADMIN' && user.isAvailable !== false && user.adminDepartmentAvailability) {
    const deptMap = {
      DOCTOR: ['DOCTOR'],
      RECEPTIONIST: ['RECEPTIONIST', 'OPD_STAFF'],
      CASHIER: ['CASHIER', 'BILLING_STAFF'],
      PHARMACIST: ['PHARMACIST', 'PHARMACY_STAFF'],
      LAB_TECH: ['LAB_TECH', 'LABORATORY_STAFF'],
      RADIOLOGIST: ['RADIOLOGIST', 'RADIOLOGY_STAFF'],
      NURSE: ['NURSE', 'NURSE_INCHARGE', 'IPD_STAFF'],
      EMERGENCY_STAFF: ['EMERGENCY_STAFF'],
    };
    Object.entries(user.adminDepartmentAvailability).forEach(([dept, isEnabled]) => {
      if (isEnabled && deptMap[dept]) {
        deptMap[dept].forEach((r) => roles.add(r));
      }
    });
  }

  return Array.from(roles);
};

export const TenantRouteGuard = ({ children, allowedRoles = [] }) => {
  const { hospitalDomain } = useParams();
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  // If domain is already cached as verified, skip the API call immediately
  const alreadyVerified = !hospitalDomain || verifiedDomainCache.has(hospitalDomain?.toLowerCase());
  const alreadyNotFound = hospitalDomain && notFoundDomainCache.has(hospitalDomain?.toLowerCase());

  const [domainVerified, setDomainVerified] = useState(alreadyVerified);
  const [domainNotFound, setDomainNotFound] = useState(alreadyNotFound);
  const [verifyingDomain, setVerifyingDomain] = useState(!alreadyVerified && !alreadyNotFound && !!hospitalDomain);

  useEffect(() => {
    if (!hospitalDomain) {
      setVerifyingDomain(false);
      setDomainVerified(true);
      return;
    }

    const domainKey = hospitalDomain.toLowerCase();

    // Already cached — skip API call
    if (verifiedDomainCache.has(domainKey)) {
      setDomainVerified(true);
      setVerifyingDomain(false);
      return;
    }
    if (notFoundDomainCache.has(domainKey)) {
      setDomainNotFound(true);
      setVerifyingDomain(false);
      return;
    }

    let isMounted = true;
    setVerifyingDomain(true);

    axiosClient
      .get(`/saas/hospitals/by-domain/${hospitalDomain}`)
      .then(() => {
        if (!isMounted) return;
        verifiedDomainCache.add(domainKey);
        setDomainVerified(true);
        setDomainNotFound(false);
        setVerifyingDomain(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        const status = err?.response?.status || err?.status;
        if (status === 404 || err?.error?.code === "HOSPITAL_NOT_FOUND") {
          // Only mark as not found on explicit 404
          notFoundDomainCache.add(domainKey);
          setDomainNotFound(true);
        } else {
          // Tenant identity must fail closed. A temporary backend failure must
          // never turn an unverified URL into an authorized hospital context.
          setDomainNotFound(true);
        }
        setVerifyingDomain(false);
      });

    return () => {
      isMounted = false;
    };
  }, [hospitalDomain]);

  if (isLoading || verifyingDomain) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 bg-white px-6 py-4 rounded-2xl shadow-lg border border-slate-200 text-sm font-semibold text-slate-700">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          Verifying Tenant Workspace...
        </div>
      </div>
    );
  }

  if (domainNotFound) {
    return <HospitalNotFoundPage domain={hospitalDomain} />;
  }

  if (!isAuthenticated || !user) {
    const loginTarget = hospitalDomain ? `/${hospitalDomain}/login` : "/login";
    return <Navigate to={loginTarget} state={{ from: location }} replace />;
  }

  // Cross-tenant protection: Check user's hospitalDomain against route hospitalDomain
  const userDomain = user.hospitalDomain || user.hospital?.domain || user.hospital?.subdomain || "";
  const normalizedRouteDomain = hospitalDomain ? hospitalDomain.toLowerCase().trim() : "";
  const normalizedUserDomain = userDomain ? userDomain.toLowerCase().trim() : "";

  if (user.role !== 'SUPER_ADMIN' && normalizedRouteDomain && (!normalizedUserDomain || normalizedRouteDomain !== normalizedUserDomain)) {
    // Cross-tenant access denied! The logged-in user belongs to another hospital (or has no tenant domain)
    // Redirect to the login page of the requested hospital workspace
    const targetLogin = `/${normalizedRouteDomain}/login`;
    return <Navigate to={targetLogin} state={{ from: location, tenantMismatch: true }} replace />;
  }


  // Role validation — check primary role AND any additional roles (including active department availability)
  const userAllRoles = getEffectiveUserRoles(user);
  const additionalRoles = userAllRoles.filter((r) => r !== user.role);
  const operationalPrefixes = ['/doctor/', '/nurse/', '/nursing/', '/nurse-incharge/', '/reception/', '/pharmacy/', '/laboratory/', '/radiology/', '/billing/', '/inventory/', '/hr/'];
  const isOperationalRoute = operationalPrefixes.some((prefix) => location.pathname.includes(prefix));
  const operationalAllowedRoles = allowedRoles.filter((role) => !['HOSPITAL_ADMIN', 'SUPER_ADMIN'].includes(role));
  if (isOperationalRoute && user.role === 'HOSPITAL_ADMIN' && !operationalAllowedRoles.some((role) => additionalRoles.includes(role))) {
    return <Navigate to="/403" replace />;
  }
  if (isOperationalRoute && user.role === 'SUPER_ADMIN') {
    return <Navigate to="/403" replace />;
  }
  if (allowedRoles.length > 0 && !allowedRoles.some((r) => userAllRoles.includes(r))) {
    return <Navigate to="/403" replace />;
  }

  return children ? children : <Outlet />;
};

