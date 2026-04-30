/**
 * Outbound email via Resend (https://resend.com).
 *
 * Uses Resend's REST API directly via `fetch` so we don't pull in a
 * dedicated SDK for one endpoint. When `RESEND_API_KEY` is unset (e.g.
 * local dev or CI), `sendEmail` falls back to logging the payload to
 * stdout — handy for working on flows without a real provider account.
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
    throw new Error(
      `Resend send failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`,
    );
  }

  let data: { id?: string } = {};
  try {
    data = (await res.json()) as { id?: string };
  } catch {
    // Provider returned 2xx without a JSON body — treat as delivered.
  }
  return { id: data.id ?? null, delivered: true };
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
