/**
 * Signed-token utilities.
 *
 * Uses HMAC-SHA256 over `AUTH_SECRET` to produce compact, URL-safe
 * tokens of the form `<base64url(payload)>.<base64url(signature)>`.
 *
 * These are the building block for any out-of-band token the app needs
 * to sign and verify (CSRF tokens, password-reset tokens, email
 * verification links, etc.). They are intentionally NOT used for the
 * primary session — the session is opaque and DB-backed.
 *
 * The payload is treated as an opaque string; callers can JSON-encode
 * structured data themselves.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/server/env";

const SEPARATOR = ".";

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function hmac(payload: string, secret = env.AUTH_SECRET): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/**
 * Sign an arbitrary string payload. Returns
 * `<base64url(payload)>.<base64url(hmac)>`.
 */
export function signToken(payload: string, secret = env.AUTH_SECRET): string {
  const encodedPayload = b64urlEncode(payload);
  const sig = b64urlEncode(hmac(encodedPayload, secret));
  return `${encodedPayload}${SEPARATOR}${sig}`;
}

/**
 * Verify a token produced by `signToken`. Returns the original payload
 * on success, or `null` on any failure (malformed, bad signature).
 *
 * Uses `timingSafeEqual` so the comparison does not leak information
 * about which byte first differed.
 */
export function verifyToken(
  token: string,
  secret = env.AUTH_SECRET,
): string | null {
  if (typeof token !== "string" || !token.includes(SEPARATOR)) return null;
  const idx = token.indexOf(SEPARATOR);
  const encodedPayload = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);
  if (!encodedPayload || !providedSig) return null;

  const expected = hmac(encodedPayload, secret);
  let provided: Buffer;
  try {
    provided = b64urlDecode(providedSig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  try {
    return b64urlDecode(encodedPayload).toString("utf8");
  } catch {
    return null;
  }
}

export interface SignedJsonOptions {
  /** TTL in seconds. If set, the verifier rejects expired tokens. */
  ttlSeconds?: number;
  secret?: string;
}

/**
 * Convenience: JSON-encode a payload, attach an issued-at timestamp,
 * and sign it.
 */
export function signJson<T>(payload: T, opts: SignedJsonOptions = {}): string {
  const wrapped = JSON.stringify({ p: payload, iat: Math.floor(Date.now() / 1000) });
  return signToken(wrapped, opts.secret);
}

/**
 * Verify and decode a token created by `signJson`. Returns `null` on
 * any signature, decoding, or expiry failure.
 */
export function verifyJson<T = unknown>(
  token: string,
  opts: SignedJsonOptions = {},
): T | null {
  const raw = verifyToken(token, opts.secret);
  if (!raw) return null;
  let parsed: { p: T; iat: number };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed?.iat !== "number") return null;
  if (opts.ttlSeconds && opts.ttlSeconds > 0) {
    const ageSeconds = Math.floor(Date.now() / 1000) - parsed.iat;
    if (ageSeconds > opts.ttlSeconds) return null;
  }
  return parsed.p;
}
