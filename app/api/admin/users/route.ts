/**
 * Admin users collection.
 *
 *   GET /api/admin/users
 *     Paginated list across every user. Admin-only.
 *
 *     Query parameters (all optional):
 *       - role           all (default) | user | admin
 *       - status         all (default) | active | disabled
 *       - q              Free-text search. Matches the user id (full or
 *                        partial UUID), email, or name. Case-insensitive.
 *       - page           1-indexed page number (default 1).
 *       - pageSize       Items per page (default 25, max 100).
 *
 *     Response: `{ items, page, pageSize, total, totalPages, hasMore }`.
 *
 * Authn / authz:
 *   - 401 when no session.
 *   - 403 when the session belongs to a non-admin user.
 */
import { NextResponse } from "next/server";

import {
  AuthRequiredError,
  ForbiddenError,
  requireAdmin,
} from "@/lib/server/auth";
import {
  ADMIN_USERS_DEFAULT_PAGE_SIZE,
  ADMIN_USERS_MAX_PAGE_SIZE,
  ADMIN_USER_ROLE_FILTERS,
  ADMIN_USER_STATUS_FILTERS,
  listAdminUsers,
  parseAdminUserRoleFilter,
  parseAdminUserStatusFilter,
} from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function unauthorized() {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function forbidden() {
  return errorResponse(403, {
    error: "Admin role required",
    code: "forbidden",
  });
}

function parseInteger(
  raw: string | null,
  field: string,
  min: number,
  max: number,
): { ok: true; value: number | undefined } | { ok: false; error: ErrorBody } {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  if (!/^-?\d+$/.test(raw)) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be an integer`,
        code: "validation_failed",
        fieldErrors: { [field]: ["Expected an integer"] },
      },
    };
  }
  const parsed = parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    return {
      ok: false,
      error: {
        error: `\`${field}\` must be between ${min} and ${max}`,
        code: "validation_failed",
        fieldErrors: { [field]: [`Out of range (${min}-${max})`] },
      },
    };
  }
  return { ok: true, value: parsed };
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    if (err instanceof ForbiddenError) return forbidden();
    throw err;
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const roleFilter = parseAdminUserRoleFilter(params.get("role"));
  if (roleFilter === null) {
    return errorResponse(400, {
      error: `\`role\` must be one of: ${ADMIN_USER_ROLE_FILTERS.join(", ")}`,
      code: "validation_failed",
      fieldErrors: { role: ["Invalid role"] },
    });
  }

  const statusFilter = parseAdminUserStatusFilter(params.get("status"));
  if (statusFilter === null) {
    return errorResponse(400, {
      error: `\`status\` must be one of: ${ADMIN_USER_STATUS_FILTERS.join(", ")}`,
      code: "validation_failed",
      fieldErrors: { status: ["Invalid status"] },
    });
  }

  const pageParsed = parseInteger(params.get("page"), "page", 1, 1_000_000);
  if (!pageParsed.ok) return errorResponse(400, pageParsed.error);

  const pageSizeParsed = parseInteger(
    params.get("pageSize"),
    "pageSize",
    1,
    ADMIN_USERS_MAX_PAGE_SIZE,
  );
  if (!pageSizeParsed.ok) return errorResponse(400, pageSizeParsed.error);

  const q = params.get("q") ?? undefined;

  try {
    const result = await listAdminUsers({
      role: roleFilter,
      status: statusFilter,
      page: pageParsed.value ?? 1,
      pageSize: pageSizeParsed.value ?? ADMIN_USERS_DEFAULT_PAGE_SIZE,
      q: q && q.trim().length > 0 ? q.trim() : undefined,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/users] failed", err);
    return errorResponse(500, {
      error: "Failed to list users",
      code: "internal_error",
    });
  }
}
