"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";

/**
 * Sort options surfaced to the catalog UI. Values map 1:1 to
 * `SortOption` in `lib/server/products.ts` so the URL contract is
 * shared across the toolbar, the page loader, and the API.
 *
 * `relevance` is intentionally NOT in this base list — it's only
 * meaningful when a search query is present, so we splice it in at
 * render time on the search/filter views.
 */
const BASE_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
];

const RELEVANCE_OPTION = {
  value: "relevance",
  label: "Most relevant",
} as const;

interface ProductSortProps {
  /** Page path the dropdown should route to (carries every other param). */
  basePath: string;
  className?: string;
  /** Optional id forwarded to the trigger button (so external <Label> can target it). */
  buttonId?: string;
}

/**
 * Catalog default sort:
 * - When the user has typed a search query, FTS relevance wins.
 * - Otherwise, "Newest" — what `listProducts` falls back to as well.
 *
 * Mirrors the server-side default in `app/(site)/products/page.tsx` and
 * `app/(site)/search/page.tsx` so the indicator never lies about which
 * order results are actually rendered in.
 */
function getDefaultSort(hasQuery: boolean): string {
  return hasQuery ? "relevance" : "newest";
}

/**
 * Sort dropdown for the products / search listings.
 *
 * URL is the source of truth (`?sort=`) so the choice persists across
 * refresh, share, and Back/Forward navigation, and it composes with
 * every other listing param (filters, search query, featured flag,
 * pagination). On change we reset `page` so the user lands on page 1
 * of the freshly ordered result set.
 *
 * Visual notes:
 *   - The currently-selected option shows a check icon.
 *   - The "default" option (Newest / Most relevant depending on query)
 *     is badged so users can see what "no choice" would land on.
 *   - When the active sort IS the default, the trigger button shows a
 *     small "Default" badge inline.
 */
export function ProductSort({
  basePath,
  className,
  buttonId = "product-sort-button",
}: ProductSortProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasQuery = (searchParams.get("q") ?? "").trim().length > 0;
  const defaultValue = getDefaultSort(hasQuery);

  const options = React.useMemo(
    () =>
      hasQuery
        ? [RELEVANCE_OPTION, ...BASE_SORT_OPTIONS]
        : [...BASE_SORT_OPTIONS],
    [hasQuery],
  );

  // Resolve the active value: explicit URL value if it's a known
  // option, otherwise the contextual default. We don't surface
  // `relevance` selection if the search query has been cleared.
  const urlValue = searchParams.get("sort");
  const currentValue =
    urlValue && options.some((o) => o.value === urlValue)
      ? urlValue
      : defaultValue;
  const currentOption =
    options.find((o) => o.value === currentValue) ?? options[0];
  const isDefault = currentValue === defaultValue;

  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape closes the popover. Only wire listeners
  // while the popover is open to avoid leaking handlers.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const buildHref = React.useCallback(
    (nextSort: string): string => {
      const params = new URLSearchParams(searchParams.toString());
      // Always reset pagination — the result order has changed.
      params.delete("page");
      // Keep URLs clean: omit `sort` when picking the contextual default.
      if (nextSort === defaultValue) {
        params.delete("sort");
      } else {
        params.set("sort", nextSort);
      }
      const qs = params.toString();
      return qs.length > 0 ? `${basePath}?${qs}` : basePath;
    },
    [basePath, defaultValue, searchParams],
  );

  const handleSelect = React.useCallback(
    (value: string) => {
      setOpen(false);
      router.push(buildHref(value), { scroll: false });
    },
    [buildHref, router],
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        id={buttonId}
        type="button"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort: ${currentOption.label}${
          isDefault ? " (default)" : ""
        }`}
        className="h-10 w-full min-w-[14rem] justify-between gap-2 px-3 text-sm font-normal"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">Sort:</span>
          <span className="truncate text-foreground">
            {currentOption.label}
          </span>
          {isDefault ? (
            <Badge
              variant="secondary"
              className="rounded-full px-1.5 py-0 text-[10px] font-medium leading-4"
            >
              Default
            </Badge>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </Button>

      {open && (
        <ul
          role="listbox"
          aria-label="Sort options"
          aria-activedescendant={`product-sort-option-${currentValue}`}
          className="absolute right-0 z-30 mt-1 w-full min-w-[14rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((option) => {
            const selected = option.value === currentValue;
            const optionIsDefault = option.value === defaultValue;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  id={`product-sort-option-${option.value}`}
                  aria-selected={selected}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                    "focus:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground",
                    selected
                      ? "bg-accent/60 text-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{option.label}</span>
                  </span>
                  {optionIsDefault ? (
                    <Badge
                      variant="secondary"
                      className="rounded-full px-1.5 py-0 text-[10px] font-medium leading-4"
                    >
                      Default
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
