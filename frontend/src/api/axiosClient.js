import axios from 'axios';

// Rule 12 & 6: Human-friendly meaningful status code messages
const STATUS_MESSAGES = {
  400: 'Invalid request data. Please check your input and try again.',
  401: 'Session expired or unauthorized. Please log in again.',
  403: 'Access denied. You do not have permission to perform this action.',
  404: 'The requested record or resource was not found.',
  409: 'A record with this information already exists.',
  422: 'Validation error. Please verify the submitted data.',
  429: 'Too many requests. Please slow down and wait a moment before retrying.',
  500: 'Internal server error. Please try again shortly or contact support.',
  502: 'Bad gateway. The backend server is restarting or temporarily unavailable.',
  503: 'Service unavailable. The server is temporarily overloaded or under maintenance.',
  504: 'Gateway timeout. The server took too long to process the request.',
};

// Rule 7: Set Timeouts (20 seconds default)
export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Rule 19: Log API Calls (During Development)
if (import.meta.env.DEV) {
  axiosClient.interceptors.request.use((config) => {
    console.debug(`🌐 [API Request] ${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
      data: config.data,
    });
    return config;
  });
}

// Rule 8 & 11: Request Interceptor (Auth Token, Headers, Context)
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

// Rule 11, 12, 16, 18, 19: Response Interceptor
axiosClient.interceptors.response.use(
  (response) => {
    if (import.meta.env.DEV) {
      console.debug(`✅ [API Response] ${response.status} ${response.config?.url}`, response.data);
    }
    return response.data;
  },
  async (error) => {
    const config = error.config || {};
    const status = error.response?.status;

    // Rule 16: Safe retry for idempotent GET requests on network/503/timeout failures
    if (
      config.method === 'get' &&
      !config._isRetry &&
      (error.code === 'ECONNABORTED' || !status || status >= 500)
    ) {
      config._retryCount = (config._retryCount || 0) + 1;
      if (config._retryCount <= 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * config._retryCount));
        return axiosClient(config);
      }
    }

    // A 403 means the authenticated user lacks permission for one resource; it
    // must not destroy a valid session. Only authentication failures (401) log out.
    if (status === 401) {
      localStorage.removeItem('hpmbs_access_token');
      localStorage.removeItem('hpmbs_user');
      localStorage.removeItem('hpmbs_super_admin_context');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    // Meaningful error message mapping (Rule 6, 12, 18)
    let errorMessage =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      (status && STATUS_MESSAGES[status]);

    if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timed out. The server took too long to respond. Please retry.';
    } else if (!errorMessage && !status) {
      errorMessage = 'Unable to connect to server. Please check your internet connection.';
    }

    const errorResponse = error.response?.data || {
      success: false,
      statusCode: status || (error.code === 'ECONNABORTED' ? 408 : 500),
      error: {
        code: error.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR'),
        message: errorMessage,
      },
    };

    if (import.meta.env.DEV) {
      console.warn(`❌ [API Error] ${status || error.code} ${config.url}`, errorMessage);
    }

    return Promise.reject(errorResponse);
  }
);

// Rule 15: In-Memory API Cache to eliminate repeated loading across component navigations
const apiCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes cache for GET requests

export const invalidateApiCache = (pattern) => {
  if (!pattern) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (typeof pattern === 'string' && key.includes(pattern)) {
      apiCache.delete(key);
    } else if (pattern instanceof RegExp && pattern.test(key)) {
      apiCache.delete(key);
    }
  }
};

export const clearApiCache = () => apiCache.clear();

// Rule 13: Cancel Unnecessary Requests (AbortController helper for search / typeahead)
export const createAbortController = () => {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
  };
};

const originalGet = axiosClient.get.bind(axiosClient);
axiosClient.get = async function (url, config = {}) {
  // Never cache blobs, downloads, or when skipCache is requested
  if (
    config?.skipCache ||
    config?.responseType === 'blob' ||
    config?.headers?.['Cache-Control'] === 'no-cache'
  ) {
    return originalGet(url, config);
  }

  const contextHeader = localStorage.getItem('hpmbs_super_admin_context') || '';
  const cacheKey = `GET:${url}:${JSON.stringify(config?.params || {})}:${contextHeader}`;
  const cached = apiCache.get(cacheKey);

  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  const res = await originalGet(url, config);
  apiCache.set(cacheKey, { data: res, timestamp: Date.now() });
  return res;
};

// Auto-invalidate cache on mutations (POST, PUT, PATCH, DELETE) so subsequent GETs fetch fresh data
['post', 'put', 'patch', 'delete'].forEach((method) => {
  const originalMethod = axiosClient[method].bind(axiosClient);
  axiosClient[method] = async function (url, ...args) {
    invalidateApiCache();
    return originalMethod(url, ...args);
  };
});
