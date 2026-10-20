import { PAGINATION } from '../config/constants.js';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string; [key: string]: unknown };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
  meta: { requestId: string };
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function ok<T>(data: T, requestId: string, extraMeta?: Record<string, unknown>): ApiSuccess<T> {
  return {
    success: true,
    data,
    meta: { requestId, ...extraMeta },
  };
}

export function parsePageParams(query: { page?: unknown; pageSize?: unknown }): PageParams {
  const rawPage = Number(query.page ?? PAGINATION.defaultPage);
  const rawPageSize = Number(query.pageSize ?? PAGINATION.defaultPageSize);

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : PAGINATION.defaultPage;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(Math.floor(rawPageSize), PAGINATION.maxPageSize)
      : PAGINATION.defaultPageSize;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPagination(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}
