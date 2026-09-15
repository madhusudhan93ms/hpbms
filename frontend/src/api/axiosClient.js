import axios from 'axios';

export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

axiosClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('hpmbs_access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const isAuthProfileOrLogout = config.url?.includes('/auth/me') || config.url?.includes('/auth/logout');
    const isGlobalSaasRoute = config.url?.startsWith('/saas/hospitals/stats') ||
      config.url?.startsWith('/saas/hospitals/pending') ||
      config.url?.startsWith('/saas/platform') ||
      config.url?.startsWith('/saas/plans') ||
      config.url === '/saas/hospitals';

    if (!isAuthProfileOrLogout && !isGlobalSaasRoute) {
      // 1. Super Admin selected hospital context
      try {
        const stored = localStorage.getItem('hpmbs_super_admin_context');
        if (stored) {
          const parsed = JSON.parse(stored);
          const hospitalId = parsed?.state?.selectedHospitalId;
          if (hospitalId) {
            config.headers['X-Hospital-Context'] = hospitalId;
          }
        }
      } catch {
        // ignore parse errors
      }

      // 2. User's own hospital context fallback
      try {
        const storedUser = localStorage.getItem('hpmbs_user');
        if (storedUser && !config.headers['X-Hospital-Context']) {
          const userObj = JSON.parse(storedUser);
          const uHId = userObj?.hospitalId?._id || userObj?.hospitalId;
          if (uHId) {
            config.headers['X-Hospital-Context'] = String(uHId);
          }
        }
      } catch {
        // ignore parse errors
      }

      // 3. URL tenant domain fallback (e.g. /test-hospital-1/...)
      if (typeof window !== 'undefined' && window.location?.pathname) {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const reservedSlugs = [
          'login', 'admin', 'doctor', 'nurse', 'nursing', 'nurse-incharge',
          'reception', 'pharmacy', 'laboratory', 'radiology', 'billing',
          'patient', 'guardian', 'emergency', 'register-hospital', 'verify-email',
          'forgot-password', 'reset-password', '403', '404',
          'superadmin', 'super-admin', 'platform'
        ];
        if (pathParts.length > 0 && !reservedSlugs.includes(pathParts[0].toLowerCase())) {
          config.headers['X-Hospital-Slug'] = pathParts[0];
          if (!config.headers['X-Hospital-Context']) {
            config.headers['X-Hospital-Context'] = pathParts[0];
          }
        }
      }

      // 4. Active Branch Context
      const activeBranchId = localStorage.getItem('hpmbs_active_branch_id');
      if (activeBranchId) {
        config.headers['X-Branch-Id'] = activeBranchId;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // A 403 means the authenticated user lacks permission for one resource; it
    // must not destroy a valid session. Only authentication failures log out.
    if (error.response?.status === 401) {
      localStorage.removeItem('hpmbs_access_token');
      localStorage.removeItem('hpmbs_user');
      localStorage.removeItem('hpmbs_super_admin_context');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    const errorResponse = error.response?.data || {
      success: false,
      statusCode: error.response?.status || 500,
      error: {
        code: 'NETWORK_ERROR',
        message: error.message || 'Server connection failed',
      },
    };
    return Promise.reject(errorResponse);
  }
);
