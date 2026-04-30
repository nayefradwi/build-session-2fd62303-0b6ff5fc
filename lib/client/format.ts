/**
 * Display-formatting helpers shared across product and order surfaces.
 *
 * These helpers are deliberately client-safe (no `next/headers`, no
 * server-only imports) so they can be used inside both server and
 * client components.
 */

/**
 * Format a cents-denominated price as a currency string. Uses
 * `Intl.NumberFormat` so locale-appropriate separators / symbols come
 * for free.
 *
 * Falls back to plain "$X.XX" formatting if the platform doesn't
 * recognise the supplied currency (extremely unlikely on modern
 * Node / V8).
 */
export function formatPrice(
  cents: number,
  currency: string = "USD",
  locale: string = "en-US",
): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/**
 * Round a rating to one decimal place for display ("4.7"). Falls back
 * to "0.0" for missing / NaN inputs.
 */
export function formatRating(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating)) return "0.0";
  return rating.toFixed(1);
}

/**
 * Compose a compact "rating · count" string used as the secondary
 * label below a product's price ("4.7 (128)").
 */
export function formatRatingWithCount(
  rating: number | null | undefined,
  count: number | null | undefined,
): string {
  return `${formatRating(rating)} (${count ?? 0})`;
}
