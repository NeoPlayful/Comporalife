export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { requestId: string; [key: string]: unknown };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let refreshPromise: Promise<boolean> | null = null;

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

async function refreshSession(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) return false;

  const payload = (await response.json()) as ApiEnvelope<{ accessToken: string }>;
  const token = payload.data?.accessToken;
  if (!token) return false;

  onTokenRefreshed(token);
  return true;
}

/** 并发请求同时 401 时只触发一次刷新，其余请求复用同一结果 */
function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** 内部使用：避免刷新后再次递归刷新 */
  skipRefresh?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh = false, headers, ...rest } = options;

  const token = accessTokenGetter();

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

  if (response.status === 401 && !skipRefresh && !path.includes('/auth/')) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
    onAuthLost();
    throw new ApiError(401, 'UNAUTHORIZED', '会话已失效，请重新登录');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'SYSTEM_ERROR', `请求失败（${response.status}）`);
    }
    return undefined as T;
  }

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || payload.success === false) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'SYSTEM_ERROR',
      payload.error?.message ?? '请求失败',
      payload.error?.details,
      payload.meta?.requestId,
    );
  }

  return payload.data as T;
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
    if (refreshed) return requestMultipart<T>(path, form, { ...options, skipRefresh: true });
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
    );
  }

  return payload.data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, options?: RequestOptions) => requestMultipart<T>(path, form, options),
};
