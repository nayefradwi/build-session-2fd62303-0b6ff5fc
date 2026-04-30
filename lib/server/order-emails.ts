/**
 * Order-related transactional email orchestration.
 *
 * `lib/server/email.ts` provides the low-level dispatcher and the pure
 * template renderer; this module knows about our domain types
 * (`PublicOrderSummary` from the order helper) and converts them to the
 * neutral `OrderConfirmationEmailInput` shape the renderer expects.
 *
 * The send is wrapped with retry + structured logging via
 * `sendEmailWithRetry`. Email failures must NEVER fail the underlying
 * checkout — callers in route handlers should `await
 * sendOrderConfirmationEmail()` and treat the boolean result as best-effort.
 */
import {
  renderOrderConfirmationEmail,
  sendEmailWithRetry,
  shortOrderNumber,
  type OrderConfirmationEmailInput,
  type RenderedEmail,
} from "@/lib/server/email";
import { env } from "@/lib/server/env";
import type { PublicOrderSummary } from "@/lib/server/orders";

export interface SendOrderConfirmationInput {
  /** The public order payload returned by `createOrderFromCart()`. */
  order: PublicOrderSummary;
  /** Email address to deliver to (typically the buying user's email). */
  recipientEmail: string;
  /** Optional display name used in the greeting. */
  recipientName?: string | null;
}

export interface SendOrderConfirmationResult {
  /** True when the dispatcher accepted the message (or dev-logged it). */
  ok: boolean;
  /** Provider message id when delivered, null otherwise. */
  messageId: string | null;
  /** Error message captured when ok=false. */
  error?: string;
}

/** Build the absolute URL the email's "View order" CTA points at. */
function buildOrderUrl(orderId: string): string {
  const base = env.APP_URL.replace(/\/$/, "");
  return `${base}/account/orders/${encodeURIComponent(orderId)}`;
}

/** Translate the public order summary into the renderer's neutral input shape. */
export function buildOrderConfirmationInput(
  order: PublicOrderSummary,
  recipientName?: string | null,
): OrderConfirmationEmailInput {
  return {
    recipientName: recipientName ?? null,
    orderId: order.id,
    orderNumber: shortOrderNumber(order.id),
    createdAt: order.createdAt,
    status: order.status,
    currency: order.currency,
    itemCount: order.itemCount,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    discountCode: order.discountCode,
    items: order.items.map((it) => ({
      name: it.name,
      sku: it.sku,
      size: it.size,
      material: it.material,
      color: it.color,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      lineTotalCents: it.lineTotalCents,
      imageUrl: it.imageUrl,
    })),
    shippingAddress: {
      recipient: order.shippingAddress.recipient,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      phone: order.shippingAddress.phone,
    },
    orderUrl: buildOrderUrl(order.id),
  };
}

/** Render the order confirmation email without dispatching (used by the dev preview). */
export function renderOrderConfirmationForOrder(
  order: PublicOrderSummary,
  recipientName?: string | null,
): RenderedEmail {
  return renderOrderConfirmationEmail(
    buildOrderConfirmationInput(order, recipientName),
  );
}

/**
 * Render and dispatch an order confirmation email. Retries transient
 * failures up to 3 times via `sendEmailWithRetry`; logs the outcome with
 * `[order-confirmation]` so it's easy to grep in production logs.
 *
 * Returns a result object — never throws. Callers should treat email
 * failures as best-effort.
 */
export async function sendOrderConfirmationEmail(
  input: SendOrderConfirmationInput,
): Promise<SendOrderConfirmationResult> {
  const orderNumber = shortOrderNumber(input.order.id);
  try {
    const rendered = renderOrderConfirmationForOrder(
      input.order,
      input.recipientName,
    );
    const result = await sendEmailWithRetry(
      {
        to: input.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      {
        maxAttempts: 3,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
        context: { kind: "order-confirmation", orderId: input.order.id, orderNumber },
      },
    );
    // eslint-disable-next-line no-console
    console.log(
      "[order-confirmation] dispatch ok",
      JSON.stringify({
        orderId: input.order.id,
        orderNumber,
        delivered: result.delivered,
        messageId: result.id,
        recipient: input.recipientEmail,
      }),
    );
    return { ok: true, messageId: result.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      "[order-confirmation] dispatch failed",
      JSON.stringify({
        orderId: input.order.id,
        orderNumber,
        recipient: input.recipientEmail,
        error: message.slice(0, 500),
      }),
    );
    return { ok: false, messageId: null, error: message };
  }
}
