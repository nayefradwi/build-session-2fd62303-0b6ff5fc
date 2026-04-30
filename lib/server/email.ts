/**
 * Outbound email via Resend (https://resend.com).
 *
 * Uses Resend's REST API directly via `fetch` so we don't pull in a
 * dedicated SDK for one endpoint. When `RESEND_API_KEY` is unset (e.g.
 * local dev or CI), `sendEmail` falls back to logging the payload to
 * stdout — handy for working on flows without a real provider account.
 *
 * Dispatch helpers:
 *   - `sendEmail(input)`            single-attempt send. Throws on non-2xx.
 *   - `sendEmailWithRetry(input)`   retries transient failures (5xx +
 *                                    429 + network errors) with capped
 *                                    exponential backoff. Logs each
 *                                    attempt and the final outcome with
 *                                    a structured tag so they're greppable
 *                                    in production logs.
 *
 * Templates:
 *   - `renderPasswordResetEmail`    /api/auth/password-reset/request
 *   - `renderOrderConfirmationEmail` POST /api/orders success
 */
import { env } from "@/lib/server/env";

const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  /** Provider message id when dispatched, or `null` for the dev log fallback. */
  id: string | null;
  /** True when the message was handed to a real provider. */
  delivered: boolean;
}

/**
 * Dispatch a transactional email. Throws on a non-2xx provider response;
 * callers in route handlers should catch and convert to a 500 if needed.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const from = input.from ?? env.EMAIL_FROM;
  const payload = {
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
  };

  if (!env.RESEND_API_KEY) {
    // Dev-friendly fallback. Surface the message in the server log so a
    // developer can copy the password-reset link out of the console while
    // working without provider credentials.
    // eslint-disable-next-line no-console
    console.log(
      "[email:dev] No RESEND_API_KEY set — logging email instead of sending.",
      JSON.stringify(payload, null, 2),
    );
    return { id: null, delivered: false };
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Resend send failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`,
    ) as Error & { status?: number; transient?: boolean };
    err.status = res.status;
    // 429 (rate limit) and 5xx are worth retrying; 4xx other than 429
    // generally indicates a permanent issue (bad payload, unverified
    // sender, etc.) and retrying just wastes quota.
    err.transient = res.status === 429 || res.status >= 500;
    throw err;
  }

  let data: { id?: string } = {};
  try {
    data = (await res.json()) as { id?: string };
  } catch {
    // Provider returned 2xx without a JSON body — treat as delivered.
  }
  return { id: data.id ?? null, delivered: true };
}

export interface RetryOptions {
  /** Total number of attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  baseDelayMs?: number;
  /** Cap for the per-attempt delay. Default 4_000. */
  maxDelayMs?: number;
  /**
   * Optional structured tag mixed into log lines so you can grep all the
   * attempts that belong to a single business event (e.g. order id).
   */
  context?: Record<string, unknown>;
}

/** Sleep helper used by the retry loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Decide whether `err` is worth retrying. Network errors are transient by default. */
function isTransient(err: unknown): boolean {
  if (!err) return false;
  const e = err as { transient?: boolean; name?: string; code?: string };
  if (typeof e.transient === "boolean") return e.transient;
  // `fetch` rejects with TypeError on network failures — treat as transient.
  if (e.name === "TypeError") return true;
  // Node fetch surfaces undici codes for timeouts / aborted sockets.
  if (e.code && /TIMEOUT|RESET|ABORT|ECONN|EAI_AGAIN/i.test(e.code)) return true;
  return false;
}

/**
 * Wrap `sendEmail` with retry + structured logging. Each attempt logs a
 * single line tagged `[email:send]` so failures are easy to find in
 * production logs. Non-transient failures (4xx other than 429) abort
 * immediately so we don't waste provider quota on guaranteed-bad payloads.
 */
export async function sendEmailWithRetry(
  input: SendEmailInput,
  options: RetryOptions = {},
): Promise<SendEmailResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 4_000);
  const ctx = { ...(options.context ?? {}), to: input.to, subject: input.subject };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const started = Date.now();
      const result = await sendEmail(input);
      // eslint-disable-next-line no-console
      console.log(
        "[email:send] delivered",
        JSON.stringify({
          ...ctx,
          attempt,
          maxAttempts,
          delivered: result.delivered,
          messageId: result.id,
          durationMs: Date.now() - started,
        }),
      );
      return result;
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        "[email:send] attempt failed",
        JSON.stringify({
          ...ctx,
          attempt,
          maxAttempts,
          transient,
          error: message.slice(0, 500),
        }),
      );

      if (!transient || attempt === maxAttempts) break;

      // Exponential backoff with full jitter to avoid thundering herd
      // when many concurrent sends hit the same provider outage.
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * exp);
      await sleep(delay);
    }
  }

  const finalMessage =
    lastErr instanceof Error ? lastErr.message : String(lastErr);
  // eslint-disable-next-line no-console
  console.error(
    "[email:send] gave up",
    JSON.stringify({
      ...ctx,
      maxAttempts,
      error: finalMessage.slice(0, 500),
    }),
  );
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to send email: ${String(lastErr)}`);
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * Render the password-reset email body. Kept inline so we don't need a
 * templating engine; the styling is plain HTML that renders sanely in
 * every common mail client.
 */
export function renderPasswordResetEmail(input: PasswordResetEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { resetUrl, expiresInMinutes } = input;
  const subject = "Reset your password";
  const text = [
    "We received a request to reset your password.",
    "",
    `Reset link (valid for ${expiresInMinutes} minutes):`,
    resetUrl,
    "",
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  // Inline CSS — most clients strip <style>. Keep it minimal but readable.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;color:#111;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:24px 28px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">Reset your password</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151;">
            We received a request to reset the password for your account. Click the
            button below to choose a new one. This link expires in
            <strong>${expiresInMinutes} minutes</strong>.
          </p>
          <p style="margin:0 0 24px;">
            <a href="${resetUrl}"
               style="display:inline-block;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
              Reset password
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#6b7280;">
            If the button doesn't work, copy and paste this URL into your browser:
          </p>
          <p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#374151;word-break:break-all;">
            ${resetUrl}
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;">
            If you did not request a password reset, you can safely ignore this email.
            Your password will not change.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Order confirmation email rendering.
 *
 * The shape mirrors `PublicOrderSummary` from `lib/server/orders.ts` but
 * is duplicated here to keep this template module free of cross-module
 * dependencies on the order helper (so it stays unit-test-friendly and
 * importable from a dev preview route without dragging the DB layer in).
 */
export interface OrderConfirmationItem {
  name: string;
  sku: string;
  size?: string | null;
  material?: string | null;
  color?: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl?: string | null;
}

export interface OrderConfirmationShippingAddress {
  recipient?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
}

export interface OrderConfirmationEmailInput {
  /** Display recipient name. Falls back to "there" when missing. */
  recipientName?: string | null;
  /** Order id (UUID). Used to derive the short order number. */
  orderId: string;
  /** Optional fully-qualified order number to display. Defaults to a short prefix of `orderId`. */
  orderNumber?: string;
  /** ISO timestamp the order was created. */
  createdAt: string;
  status: string;
  currency: string;
  itemCount: number;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  discountCode?: string | null;
  items: OrderConfirmationItem[];
  shippingAddress: OrderConfirmationShippingAddress;
  /** Optional URL pointing at the user-facing order detail page. */
  orderUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Minimal HTML escape used to sanitise dynamic strings before injection. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strict cents → "$X.XX" using Intl. Server-safe (no client deps). */
function formatMoney(cents: number, currency: string): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/** Compose a short, human-friendly order number from a UUID. */
export function shortOrderNumber(orderId: string): string {
  const compact = orderId.replace(/-/g, "").toUpperCase();
  return compact.slice(0, 8);
}

/** Build a single-line description of the variant axes for an item. */
function variantSummary(item: OrderConfirmationItem): string {
  const parts: string[] = [];
  if (item.size) parts.push(`Size ${item.size}`);
  if (item.color) parts.push(item.color);
  if (item.material) parts.push(item.material);
  return parts.join(" · ");
}

/** Format the shipping address block as an array of lines (used by both html + text). */
function addressLines(addr: OrderConfirmationShippingAddress): string[] {
  const lines: string[] = [];
  if (addr.recipient) lines.push(addr.recipient);
  lines.push(addr.line1);
  if (addr.line2) lines.push(addr.line2);
  const cityLine = [addr.city, addr.state, addr.postalCode]
    .filter((p) => p && String(p).trim().length > 0)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  lines.push(addr.country);
  if (addr.phone) lines.push(`Phone: ${addr.phone}`);
  return lines;
}

/**
 * Render the order-confirmation transactional email. Returns subject +
 * html + text bodies. Pure function — safe to call from a route handler,
 * a background worker, or a dev-preview endpoint.
 */
export function renderOrderConfirmationEmail(
  input: OrderConfirmationEmailInput,
): RenderedEmail {
  const orderNumber =
    input.orderNumber?.trim() || shortOrderNumber(input.orderId);
  const greetingName = input.recipientName?.trim() || "there";
  const currency = input.currency || "USD";
  const subject = `Order confirmation — #${orderNumber}`;

  // ----- Plain text body -----
  const textLines: string[] = [];
  textLines.push(`Hi ${greetingName},`);
  textLines.push("");
  textLines.push(
    "Thanks for your order! We've received it and will let you know when it ships.",
  );
  textLines.push("");
  textLines.push(`Order #${orderNumber}`);
  textLines.push(
    `Placed: ${new Date(input.createdAt).toUTCString()}`,
  );
  textLines.push(`Status: ${input.status}`);
  textLines.push("");
  textLines.push("Items");
  textLines.push("-----");
  for (const item of input.items) {
    const variant = variantSummary(item);
    textLines.push(
      `${item.quantity} × ${item.name}${variant ? ` (${variant})` : ""}`,
    );
    textLines.push(
      `  SKU ${item.sku} · ${formatMoney(item.unitPriceCents, currency)} ea · ${formatMoney(item.lineTotalCents, currency)}`,
    );
  }
  textLines.push("");
  textLines.push(
    `Subtotal: ${formatMoney(input.subtotalCents, currency)} (${input.itemCount} item${input.itemCount === 1 ? "" : "s"})`,
  );
  if (input.discountCents > 0) {
    const codeLabel = input.discountCode ? ` (${input.discountCode})` : "";
    textLines.push(
      `Discount${codeLabel}: -${formatMoney(input.discountCents, currency)}`,
    );
  }
  textLines.push(`Shipping: ${formatMoney(input.shippingCents, currency)}`);
  textLines.push(`Total: ${formatMoney(input.totalCents, currency)}`);
  textLines.push("");
  textLines.push("Ship to");
  textLines.push("-------");
  for (const line of addressLines(input.shippingAddress)) textLines.push(line);
  if (input.orderUrl) {
    textLines.push("");
    textLines.push(`View your order: ${input.orderUrl}`);
  }
  textLines.push("");
  textLines.push("Thanks again,");
  textLines.push("The Team");

  // ----- HTML body -----
  const itemRows = input.items
    .map((item) => {
      const variant = variantSummary(item);
      const meta = [`SKU ${item.sku}`];
      if (variant) meta.push(variant);
      const thumb = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="56" height="56" style="display:block;border-radius:6px;border:1px solid #e5e7eb;object-fit:cover;" />`
        : `<div style="width:56px;height:56px;border-radius:6px;background:#f3f4f6;border:1px solid #e5e7eb;"></div>`;
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:72px;">${thumb}</td>
        <td style="padding:12px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px;line-height:1.4;color:#111;">
          <div style="font-weight:600;">${escapeHtml(item.name)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(meta.join(" · "))}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Qty ${item.quantity} × ${escapeHtml(formatMoney(item.unitPriceCents, currency))}</div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;text-align:right;font-size:14px;color:#111;font-weight:600;white-space:nowrap;">
          ${escapeHtml(formatMoney(item.lineTotalCents, currency))}
        </td>
      </tr>`;
    })
    .join("");

  const discountRow =
    input.discountCents > 0
      ? `<tr>
          <td style="padding:4px 0;font-size:14px;color:#374151;">Discount${
            input.discountCode
              ? ` <span style="color:#6b7280;">(${escapeHtml(input.discountCode)})</span>`
              : ""
          }</td>
          <td style="padding:4px 0;font-size:14px;color:#16a34a;text-align:right;white-space:nowrap;">
            -${escapeHtml(formatMoney(input.discountCents, currency))}
          </td>
        </tr>`
      : "";

  const addressHtml = addressLines(input.shippingAddress)
    .map((line) => escapeHtml(line))
    .join("<br />");

  const ctaButton = input.orderUrl
    ? `<p style="margin:24px 0 0;text-align:center;">
        <a href="${escapeHtml(input.orderUrl)}"
           style="display:inline-block;padding:10px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
          View order
        </a>
      </p>`
    : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;color:#111;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:24px 28px 8px;">
          <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Order #${escapeHtml(orderNumber)}</p>
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;">Thanks for your order, ${escapeHtml(greetingName)}!</h1>
          <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#374151;">
            We've received your order and will email you again when it ships.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7280;">
            Placed ${escapeHtml(new Date(input.createdAt).toUTCString())} · Status: ${escapeHtml(input.status)}
          </p>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 28px 0;">
          <h2 style="margin:16px 0 8px;font-size:14px;line-height:1.3;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">Items</h2>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            ${itemRows}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 28px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:8px;">
            <tr>
              <td style="padding:4px 0;font-size:14px;color:#374151;">Subtotal <span style="color:#6b7280;">(${input.itemCount} item${input.itemCount === 1 ? "" : "s"})</span></td>
              <td style="padding:4px 0;font-size:14px;color:#111;text-align:right;white-space:nowrap;">
                ${escapeHtml(formatMoney(input.subtotalCents, currency))}
              </td>
            </tr>
            ${discountRow}
            <tr>
              <td style="padding:4px 0;font-size:14px;color:#374151;">Shipping</td>
              <td style="padding:4px 0;font-size:14px;color:#111;text-align:right;white-space:nowrap;">
                ${escapeHtml(formatMoney(input.shippingCents, currency))}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0 0;border-top:1px solid #e5e7eb;font-size:15px;color:#111;font-weight:700;">Total</td>
              <td style="padding:8px 0 0;border-top:1px solid #e5e7eb;font-size:15px;color:#111;font-weight:700;text-align:right;white-space:nowrap;">
                ${escapeHtml(formatMoney(input.totalCents, currency))}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 28px 24px;">
          <h2 style="margin:20px 0 8px;font-size:14px;line-height:1.3;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">Shipping to</h2>
          <p style="margin:0;font-size:14px;line-height:1.5;color:#111;">
            ${addressHtml}
          </p>
          ${ctaButton}
        </td>
      </tr>

      <tr>
        <td style="padding:0 28px 24px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;" />
          <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;">
            Questions about your order? Just reply to this email and our team will help out.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text: textLines.join("\n") };
}
