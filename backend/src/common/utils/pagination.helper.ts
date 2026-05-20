export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Computes the Prisma `skip` value from page and limit. */
export function calcSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Extracts and clamps page/limit from raw query params.
 * Use when bounds validation is needed (e.g. public/external endpoints).
 */
export function parsePagination(
  params: { page?: number; limit?: number },
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; skip: number } {
  const { defaultLimit = 20, maxLimit = 100 } = options;
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(maxLimit, Math.max(1, params.limit ?? defaultLimit));
  return { page, limit, skip: calcSkip(page, limit) };
}

/** Builds the standard `meta` object returned in paginated responses. */
export function buildMeta(total: number, page: number, limit: number): PaginationMeta {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
