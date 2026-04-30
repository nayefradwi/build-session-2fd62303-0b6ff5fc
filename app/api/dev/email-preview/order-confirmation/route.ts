/**
 * Dev preview for the order-confirmation email template.
 *
 *   GET /api/dev/email-preview/order-confirmation
 *     Returns the rendered HTML body with sample data so a developer
 *     can iterate on the template in their browser without placing a
 *     real order.
 *
 *   GET /api/dev/email-preview/order-confirmation?format=text
 *     Returns the plain-text variant (text/plain).
 *
 *   GET /api/dev/email-preview/order-confirmation?format=json
 *     Returns `{ subject, html, text, input }` for easy snapshotting.
 *
 * Disabled in production (`env.IS_PROD === true`). Returns 404 there to
 * avoid surfacing the existence of the endpoint at all. There's no auth
 * requirement in dev because the surface is public-anyway sample data.
 */
import { NextResponse } from "next/server";

import {
  renderOrderConfirmationEmail,
  type OrderConfirmationEmailInput,
} from "@/lib/server/email";
import { env } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sample order used to seed the preview. Mirrors `PublicOrderSummary` keys we render. */
function sampleInput(): OrderConfirmationEmailInput {
  return {
    recipientName: "Alex Doe",
    orderId: "1f3d2a40-9bdc-4e52-9c1a-3a2c9b94c111",
    createdAt: new Date().toISOString(),
    status: "pending",
    currency: "USD",
    itemCount: 3,
    subtotalCents: 13_497,
    shippingCents: 599,
    discountCents: 1_500,
    totalCents: 12_596,
    discountCode: "SUMMER10",
    items: [
      {
        name: "Selvedge Denim Jacket",
        sku: "DENIM-JCK-LRG-IND",
        size: "L",
        material: "Cotton",
        color: "Indigo",
        quantity: 1,
        unitPriceCents: 8_999,
        lineTotalCents: 8_999,
        imageUrl: null,
      },
      {
        name: "Heavyweight Cotton Tee",
        sku: "TEE-HW-MED-BLK",
        size: "M",
        material: "Cotton",
        color: "Black",
        quantity: 2,
        unitPriceCents: 2_249,
        lineTotalCents: 4_498,
        imageUrl: null,
      },
    ],
    shippingAddress: {
      recipient: "Alex Doe",
      line1: "742 Evergreen Terrace",
      line2: "Apt 3B",
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
      country: "US",
      phone: "+1 555-0100",
    },
    orderUrl: `${env.APP_URL.replace(/\/$/, "")}/account/orders/1f3d2a40-9bdc-4e52-9c1a-3a2c9b94c111`,
  };
}

export async function GET(req: Request) {
  if (env.IS_PROD) {
    return NextResponse.json(
      { error: "Not found", code: "not_found" },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "html").toLowerCase();
  const input = sampleInput();
  const rendered = renderOrderConfirmationEmail(input);

  if (format === "json") {
    return NextResponse.json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      input,
    });
  }

  if (format === "text" || format === "txt") {
    return new NextResponse(rendered.text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse(rendered.html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
