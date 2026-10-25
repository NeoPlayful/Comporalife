export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    params?: Record<string, unknown>;
  };
  meta?: { requestId: string; [key: string]: unknown };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly params?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
    params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.params = params;
  }
}

let refreshPromise: Promise<string | null> | null = null;

/** 另一标签页可能刚完成轮换，短暂等待后重试可读到新 Cookie */
const REFRESH_RETRY_DELAY_MS = 150;

/** access token 保存在内存中，由登录流程注入，避免落盘到 localStorage */
let accessTokenGetter: () => string | null = () => null;
let onTokenRefreshed: (token: string) => void = () => {};
let onAuthLost: () => void = () => {};

export function configureAuthBridge(options: {
  getAccessToken: () => string | null;
  onRefreshed: (token: string) => void;
  onAuthLost: () => void;
}) {
  accessTokenGetter = options.getAccessToken;
  onTokenRefreshed = options.onRefreshed;
  onAuthLost = options.onAuthLost;
}

async function refreshSession(): Promise<string | null> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ApiEnvelope<{ accessToken: string }>;
  return payload.data?.accessToken ?? null;
}

/**
 * 并发请求同时 401 时只触发一次刷新，其余请求复用同一结果。
 * 首次失败后重试一次：轮换是单次有效的，另一标签页可能已用掉旧令牌。
 */
function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      let token = await refreshSession();
      if (!token) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
        token = await refreshSession();
      }
      return token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** 供会话恢复流程复用：拿到新令牌后同步到认证状态 */
export async function refreshAccessToken(): Promise<string | null> {
  const token = await refreshOnce();
  if (token) onTokenRefreshed(token);
  return token;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 内部使用：避免刷新后再次递归刷新 */
  skipRefresh?: boolean;
  /** 显式指定访问令牌，用于会话恢复阶段 store 尚未写入的场景 */
  token?: string | null;
}

/** 这些接口本身负责建立或刷新会话，401 时不触发自动刷新 */
const AUTH_ENDPOINTS_WITHOUT_REFRESH = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

function shouldAutoRefresh(path: string): boolean {
  return !AUTH_ENDPOINTS_WITHOUT_REFRESH.some((endpoint) => path.startsWith(endpoint));
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 列表接口的完整结果：分页信息与数据一起返回，避免调用方猜「还有没有下一页」 */
export interface PagedResult<T> {
  data: T;
  pagination: PaginationMeta | null;
}

async function requestFull<T>(path: string, options: RequestOptions = {}): Promise<PagedResult<T>> {
  const { body, skipRefresh = false, headers, token: explicitToken, ...rest } = options;

  const token = explicitToken !== undefined ? explicitToken : accessTokenGetter();

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && !skipRefresh && shouldAutoRefresh(path)) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      onTokenRefreshed(refreshed);
      return requestFull<T>(path, { ...options, skipRefresh: true });
    }
    onAuthLost();
    throw new ApiError(401, 'UNAUTHORIZED', '会话已失效，请重新登录');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'SYSTEM_ERROR', `请求失败（${response.status}）`);
    }
    return { data: undefined as T, pagination: null };
  }

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || payload.success === false) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'SYSTEM_ERROR',
      payload.error?.message ?? '请求失败',
      payload.error?.details,
      payload.meta?.requestId,
      payload.error?.params,
    );
  }

  const pagination = payload.meta?.pagination as PaginationMeta | undefined;
  return { data: payload.data as T, pagination: pagination ?? null };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await requestFull<T>(path, options);
  return data;
}

/**
 * multipart 上传：不设置 Content-Type，交给浏览器生成 boundary。
 * 错误与令牌刷新逻辑与 JSON 请求保持一致。
 */
async function requestMultipart<T>(path: string, form: FormData, options: RequestOptions = {}): Promise<T> {
  const { skipRefresh = false, headers, ...rest } = options;
  const token = accessTokenGetter();

  const response = await fetch(path, {
    ...rest,
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: form,
  });

  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      onTokenRefreshed(refreshed);
      return requestMultipart<T>(path, form, { ...options, skipRefresh: true });
    }
    onAuthLost();
    throw new ApiError(401, 'UNAUTHORIZED', '会话已失效，请重新登录');
  }

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || payload.success === false) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'SYSTEM_ERROR',
      payload.error?.message ?? '请求失败',
      payload.error?.details,
      payload.meta?.requestId,
      payload.error?.params,
    );
  }

  return payload.data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  /** 列表接口：同时拿到数据与服务端分页信息 */
  getPaged: <T>(path: string, options?: RequestOptions) =>
    requestFull<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, options?: RequestOptions) => requestMultipart<T>(path, form, options),
};
