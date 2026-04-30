import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/client/utils";
import { buttonVariants } from "@/components/ui/button";

interface ProductPaginationProps {
  page: number;
  totalPages: number;
  /** Base path the page links should target (e.g. "/products"). */
  basePath: string;
  /**
   * Already-stringified non-page query parameters (e.g. "sort=newest&q=hat").
   * Used to preserve filters/search across pagination links. Pass an
   * empty string when there are none.
   */
  searchString?: string;
  className?: string;
}

/**
 * Build the visible page-window for a "1 … 4 5 6 … 12" style paginator.
 *
 * Always shows the first and last pages, the current page, and one
 * page on either side of current. Gaps are signalled with the literal
 * string "ellipsis" so the renderer can substitute a "…" token.
 */
function buildPageWindow(
  page: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const window = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  const sorted = Array.from(window)
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);

  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i];
    if (i > 0 && value - sorted[i - 1] > 1) {
      out.push("ellipsis");
    }
    out.push(value);
  }
  return out;
}

function pageHref(
  basePath: string,
  page: number,
  searchString: string | undefined,
): string {
  const params = new URLSearchParams(searchString ?? "");
  // Drop any pre-existing `page` so we don't duplicate it.
  params.delete("page");
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs.length > 0 ? `${basePath}?${qs}` : basePath;
}

/**
 * Numbered page navigation under a product grid. Renders nothing when
 * there is at most one page so the listing UI stays clean.
 *
 * Uses plain `<Link>`s so the URL is the source of truth and the page
 * stays bookmarkable / shareable. The grid + filter UIs read the same
 * query params, so navigation back/forward with the browser feels
 * native.
 */
export function ProductPagination({
  page,
  totalPages,
  basePath,
  searchString,
  className,
}: ProductPaginationProps) {
  if (totalPages <= 1) return null;

  const window = buildPageWindow(page, totalPages);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  const linkClass = (active: boolean) =>
    cn(
      buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
      "h-9 min-w-9 px-2",
    );

  const disabledClass = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "h-9 min-w-9 cursor-not-allowed px-2 opacity-50",
  );

  return (
    <nav
      aria-label="Product pagination"
      className={cn(
        "flex flex-wrap items-center justify-center gap-1.5",
        className,
      )}
    >
      {prevDisabled ? (
        <span aria-disabled="true" className={disabledClass}>
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </span>
      ) : (
        <Link
          href={pageHref(basePath, page - 1, searchString)}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-9 min-w-9 px-2",
          )}
          rel="prev"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </Link>
      )}

      {window.map((entry, idx) =>
        entry === "ellipsis" ? (
          <span
            key={`ellipsis-${idx}`}
            className="px-2 text-sm text-muted-foreground"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <Link
            key={entry}
            href={pageHref(basePath, entry, searchString)}
            className={linkClass(entry === page)}
            aria-current={entry === page ? "page" : undefined}
            aria-label={`Page ${entry}`}
          >
            {entry}
          </Link>
        ),
      )}

      {nextDisabled ? (
        <span aria-disabled="true" className={disabledClass}>
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </span>
      ) : (
        <Link
          href={pageHref(basePath, page + 1, searchString)}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-9 min-w-9 px-2",
          )}
          rel="next"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </nav>
  );
}
