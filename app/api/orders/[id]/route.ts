/**
 * Order detail route.
 *
 *   GET /api/orders/{id}
 *     Return the full order detail (header + every snapshotted line item)
 *     for the authenticated user. Ownership is enforced inside
 *     `getOrderForUser` — the lookup `WHERE` clause matches both
 *     `orders.id` and `orders.user_id`, so a malicious caller who guesses
 *     a UUID belonging to another user still gets a 404.
 *
 *     Responses:
 *       - 200 `{ order: PublicOrderSummary }` on success.
 *       - 401 if no session.
 *       - 404 if the id is malformed, unknown, or belongs to someone else.
 *       - 500 on an unexpected DB failure.
 */
import { NextResponse } from "next/server";

import { AuthRequiredError, requireUser } from "@/lib/server/auth";
import { getOrderForUser } from "@/lib/server/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorBody {
  error: string;
  code: string;
}

function errorResponse(
  status: number,
  body: ErrorBody,
): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status });
}

function unauthorized(): NextResponse<ErrorBody> {
  return errorResponse(401, {
    error: "Authentication required",
    code: "unauthenticated",
  });
}

function notFound(): NextResponse<ErrorBody> {
  return errorResponse(404, {
    error: "Order not found",
    code: "not_found",
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof AuthRequiredError) return unauthorized();
    throw err;
  }

  const { id } = await ctx.params;
  // Treat a malformed id the same as a miss to avoid leaking the
  // "valid uuid but not yours" vs "garbage uuid" distinction.
  if (!id || !UUID_RE.test(id)) return notFound();

  try {
    const order = await getOrderForUser(user.id, id);
    if (!order) return notFound();
    return NextResponse.json({ order }, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/orders/${id}] failed`, err);
    return errorResponse(500, {
      error: "Failed to load order",
      code: "internal_error",
    });
  }
}
