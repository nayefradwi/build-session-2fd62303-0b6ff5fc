"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";
import { formatPrice } from "@/lib/client/format";
import {
  applyFiltersToParams,
  countActiveFilters,
  emptyFilters,
  parseProductFilters,
  type ParsedProductFilters,
} from "@/lib/client/product-filter-options";

interface ProductFilterChipsProps {
  basePath: string;
  /** Total result count, displayed alongside the chips. */
  total: number;
  className?: string;
}

interface ChipDescriptor {
  /** Human-readable label rendered inside the chip. */
  label: string;
  /** Stable key for React. */
  key: string;
  /** Filters object to apply when the user clicks the X on this chip. */
  remove: ParsedProductFilters;
}

/**
 * Build the list of chips that represent every currently active filter
 * value. Each chip carries the *next* filter state (with that one
 * value removed) so the click handler can push it directly without
 * re-parsing.
 */
function buildChips(filters: ParsedProductFilters): ChipDescriptor[] {
  const chips: ChipDescriptor[] = [];

  if (filters.priceMinCents != null) {
    chips.push({
      label: `Min ${formatPrice(filters.priceMinCents)}`,
      key: `priceMin:${filters.priceMinCents}`,
      remove: { ...filters, priceMinCents: null },
    });
  }
  if (filters.priceMaxCents != null) {
    chips.push({
      label: `Max ${formatPrice(filters.priceMaxCents)}`,
      key: `priceMax:${filters.priceMaxCents}`,
      remove: { ...filters, priceMaxCents: null },
    });
  }
  for (const size of filters.sizes) {
    chips.push({
      label: `Size: ${size}`,
      key: `size:${size}`,
      remove: { ...filters, sizes: filters.sizes.filter((v) => v !== size) },
    });
  }
  for (const material of filters.materials) {
    chips.push({
      label: `Material: ${material}`,
      key: `material:${material}`,
      remove: {
        ...filters,
        materials: filters.materials.filter((v) => v !== material),
      },
    });
  }
  for (const color of filters.colors) {
    chips.push({
      label: `Color: ${color}`,
      key: `color:${color}`,
      remove: { ...filters, colors: filters.colors.filter((v) => v !== color) },
    });
  }
  if (filters.inStockOnly) {
    chips.push({
      label: "In stock only",
      key: "inStockOnly",
      remove: { ...filters, inStockOnly: false },
    });
  }
  return chips;
}

/**
 * Renders the row of "active filter" chips above the listing grid,
 * along with the result count and a clear-all reset.
 *
 * Each chip removes a single filter value when its X is clicked. The
 * "Clear all" button strips every managed filter param at once.
 *
 * Always renders the result count even when no filters are active so
 * the listing's headline doesn't have to bear that burden alone.
 */
export function ProductFilterChips({
  basePath,
  total,
  className,
}: ProductFilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = React.useMemo(
    () => parseProductFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const chips = React.useMemo(() => buildChips(filters), [filters]);
  const activeCount = countActiveFilters(filters);

  const pushFilters = React.useCallback(
    (next: ParsedProductFilters) => {
      const params = applyFiltersToParams(
        new URLSearchParams(searchParams.toString()),
        next,
      );
      const qs = params.toString();
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath, {
        scroll: false,
      });
    },
    [basePath, router, searchParams],
  );

  const onClearAll = React.useCallback(() => {
    pushFilters(emptyFilters());
  }, [pushFilters]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 text-sm",
        className,
      )}
      aria-label="Active filters and result count"
    >
      <span
        className="text-muted-foreground"
        aria-live="polite"
        aria-atomic="true"
      >
        {total.toLocaleString()} {total === 1 ? "result" : "results"}
      </span>

      {chips.length > 0 && (
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
      )}

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => pushFilters(chip.remove)}
          className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`Remove filter ${chip.label}`}
        >
          <span>{chip.label}</span>
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ))}

      {activeCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="ml-auto h-7 px-2 text-xs"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
