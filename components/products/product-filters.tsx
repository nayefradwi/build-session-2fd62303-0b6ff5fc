"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/client/utils";
import {
  COLOR_OPTIONS,
  MATERIAL_OPTIONS,
  PRICE_RANGE_DEFAULT_MAX_CENTS,
  PRICE_RANGE_DEFAULT_MIN_CENTS,
  PRICE_RANGE_STEP_CENTS,
  SIZE_GROUPS,
  applyFiltersToParams,
  countActiveFilters,
  emptyFilters,
  parseProductFilters,
  type ParsedProductFilters,
} from "@/lib/client/product-filter-options";

interface ProductFiltersProps {
  /** Base path the panel routes to on apply. */
  basePath: string;
  className?: string;
}

/**
 * Flip a value into / out of a string array, returning a fresh array.
 * Used by every multi-select facet (size / material / color).
 */
function toggleValue(current: readonly string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

function centsToDollars(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(0);
}

function dollarsToCents(input: string): number | null {
  if (input.trim().length === 0) return null;
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

interface PanelProps {
  draft: ParsedProductFilters;
  setDraft: React.Dispatch<React.SetStateAction<ParsedProductFilters>>;
}

function PriceRangeSection({ draft, setDraft }: PanelProps) {
  // Slider state mirrors the cents-denominated draft. We coerce nulls
  // to the default bounds so the handle still has a position when the
  // filter is "off" — the user can drag away from the bound and we
  // commit the new value.
  const minCents = draft.priceMinCents ?? PRICE_RANGE_DEFAULT_MIN_CENTS;
  const maxCents = draft.priceMaxCents ?? PRICE_RANGE_DEFAULT_MAX_CENTS;

  const onMinSlider = (value: number) => {
    // Don't let min cross max.
    const clampedMax = Math.max(value, maxCents);
    setDraft((prev) => ({
      ...prev,
      priceMinCents:
        value <= PRICE_RANGE_DEFAULT_MIN_CENTS ? null : value,
      priceMaxCents:
        clampedMax >= PRICE_RANGE_DEFAULT_MAX_CENTS ? null : clampedMax,
    }));
  };

  const onMaxSlider = (value: number) => {
    const clampedMin = Math.min(value, minCents);
    setDraft((prev) => ({
      ...prev,
      priceMaxCents:
        value >= PRICE_RANGE_DEFAULT_MAX_CENTS ? null : value,
      priceMinCents:
        clampedMin <= PRICE_RANGE_DEFAULT_MIN_CENTS ? null : clampedMin,
    }));
  };

  const onMinInput = (raw: string) => {
    const cents = dollarsToCents(raw);
    setDraft((prev) => ({ ...prev, priceMinCents: cents }));
  };
  const onMaxInput = (raw: string) => {
    const cents = dollarsToCents(raw);
    setDraft((prev) => ({ ...prev, priceMaxCents: cents }));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Price</legend>
      <div className="space-y-2">
        {/* Two stacked sliders give a min + max range without needing
            a third-party dual-thumb component. They're visually
            connected by the active range bar drawn between them. */}
        <div className="relative pt-1">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
            style={{
              left: `${(minCents / PRICE_RANGE_DEFAULT_MAX_CENTS) * 100}%`,
              right: `${100 - (maxCents / PRICE_RANGE_DEFAULT_MAX_CENTS) * 100}%`,
            }}
          />
          <input
            type="range"
            min={PRICE_RANGE_DEFAULT_MIN_CENTS}
            max={PRICE_RANGE_DEFAULT_MAX_CENTS}
            step={PRICE_RANGE_STEP_CENTS}
            value={minCents}
            onChange={(e) => onMinSlider(Number(e.target.value))}
            aria-label="Minimum price"
            className="pointer-events-auto relative z-10 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background"
          />
          <input
            type="range"
            min={PRICE_RANGE_DEFAULT_MIN_CENTS}
            max={PRICE_RANGE_DEFAULT_MAX_CENTS}
            step={PRICE_RANGE_STEP_CENTS}
            value={maxCents}
            onChange={(e) => onMaxSlider(Number(e.target.value))}
            aria-label="Maximum price"
            className="pointer-events-auto relative z-20 -mt-5 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="price-min" className="text-xs">
              Min ($)
            </Label>
            <Input
              id="price-min"
              type="number"
              inputMode="decimal"
              min={0}
              step={5}
              placeholder="0"
              value={centsToDollars(draft.priceMinCents)}
              onChange={(e) => onMinInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price-max" className="text-xs">
              Max ($)
            </Label>
            <Input
              id="price-max"
              type="number"
              inputMode="decimal"
              min={0}
              step={5}
              placeholder="500+"
              value={centsToDollars(draft.priceMaxCents)}
              onChange={(e) => onMaxInput(e.target.value)}
            />
          </div>
        </div>
      </div>
    </fieldset>
  );
}

function SizeSection({ draft, setDraft }: PanelProps) {
  const onToggle = (size: string) => {
    setDraft((prev) => ({ ...prev, sizes: toggleValue(prev.sizes, size) }));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Size</legend>
      <div className="space-y-3">
        {SIZE_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {group.options.map((size) => {
                const checked = draft.sizes.includes(size);
                return (
                  <label
                    key={size}
                    className={cn(
                      "inline-flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                      "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => onToggle(size)}
                      aria-label={`Size ${size}`}
                    />
                    {size}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function MaterialSection({ draft, setDraft }: PanelProps) {
  const onToggle = (material: string) => {
    setDraft((prev) => ({
      ...prev,
      materials: toggleValue(prev.materials, material),
    }));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Material</legend>
      <ul className="space-y-1.5">
        {MATERIAL_OPTIONS.map((material) => {
          const checked = draft.materials.includes(material);
          return (
            <li key={material}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  checked={checked}
                  onChange={() => onToggle(material)}
                />
                <span>{material}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function ColorSection({ draft, setDraft }: PanelProps) {
  const onToggle = (color: string) => {
    setDraft((prev) => ({
      ...prev,
      colors: toggleValue(prev.colors, color),
    }));
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Color</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {COLOR_OPTIONS.map((color) => {
          const checked = draft.colors.includes(color.name);
          return (
            <label
              key={color.name}
              title={color.name}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                checked
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-input bg-background text-foreground hover:bg-accent",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onToggle(color.name)}
                aria-label={`Color ${color.name}`}
              />
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: color.swatch }}
              />
              <span className="truncate">{color.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function InStockSection({ draft, setDraft }: PanelProps) {
  const onChange = (checked: boolean) => {
    setDraft((prev) => ({ ...prev, inStockOnly: checked }));
  };
  return (
    <fieldset>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm font-medium">
        <span>In stock only</span>
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
          checked={draft.inStockOnly}
          onChange={(e) => onChange(e.target.checked)}
          aria-label="Only show in-stock products"
        />
      </label>
    </fieldset>
  );
}

interface FilterPanelBodyProps extends PanelProps {
  onApply: () => void;
  onClear: () => void;
  /** Whether to render the apply/clear buttons inline (desktop) or as a sticky drawer footer (mobile). */
  variant: "sidebar" | "drawer";
}

function FilterPanelBody({
  draft,
  setDraft,
  onApply,
  onClear,
  variant,
}: FilterPanelBodyProps) {
  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-6",
          variant === "drawer" && "pb-4",
        )}
      >
        <PriceRangeSection draft={draft} setDraft={setDraft} />
        <hr className="border-border" />
        <SizeSection draft={draft} setDraft={setDraft} />
        <hr className="border-border" />
        <MaterialSection draft={draft} setDraft={setDraft} />
        <hr className="border-border" />
        <ColorSection draft={draft} setDraft={setDraft} />
        <hr className="border-border" />
        <InStockSection draft={draft} setDraft={setDraft} />
      </div>

      <div
        className={cn(
          "flex gap-2",
          variant === "sidebar" && "mt-6",
          variant === "drawer" &&
            "sticky bottom-0 -mx-4 mt-4 border-t bg-background px-4 py-3",
        )}
      >
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onClear}
        >
          Clear all
        </Button>
        <Button type="button" className="flex-1" onClick={onApply}>
          Apply
        </Button>
      </div>
    </>
  );
}

/**
 * Faceted filter panel for the /products listing.
 *
 * Architecture:
 *   - The URL is the source of truth (so refresh, share, and the
 *     SSR'd grid always agree).
 *   - We mirror the parsed URL into a "draft" state when the panel
 *     mounts (and whenever the URL changes via Back/Forward).
 *   - "Apply" pushes the draft to the URL, which re-renders the page
 *     and re-runs `listProducts` server-side; "Clear all" pushes an
 *     empty filter set.
 *   - Mobile (<lg): a "Filters" trigger button opens a slide-in
 *     drawer over the page; tapping the backdrop or pressing Escape
 *     closes it.
 *   - Desktop (lg+): the same body renders as a left-rail sidebar.
 *
 * The panel does NOT touch other query params (q, sort, featured,
 * new) — those are managed by the toolbar and pagination.
 */
export function ProductFilters({ basePath, className }: ProductFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Parse URL into a stable structure.
  const urlFilters = React.useMemo(
    () => parseProductFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [draft, setDraft] = React.useState<ParsedProductFilters>(urlFilters);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Whenever the URL changes (Back/Forward, chip removal, clear-all),
  // reset the drafted filter state to match. We compare a serialized
  // form so we don't fight user edits while the drawer is open and the
  // URL hasn't actually changed.
  const urlKey = React.useMemo(
    () => JSON.stringify(urlFilters),
    [urlFilters],
  );
  const lastUrlKey = React.useRef(urlKey);
  React.useEffect(() => {
    if (lastUrlKey.current !== urlKey) {
      setDraft(urlFilters);
      lastUrlKey.current = urlKey;
    }
  }, [urlKey, urlFilters]);

  // Lock body scroll while the drawer is open and wire up Escape-to-close.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const activeCount = React.useMemo(
    () => countActiveFilters(urlFilters),
    [urlFilters],
  );

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

  const onApply = React.useCallback(() => {
    pushFilters(draft);
    setDrawerOpen(false);
  }, [draft, pushFilters]);

  const onClear = React.useCallback(() => {
    const cleared = emptyFilters();
    setDraft(cleared);
    pushFilters(cleared);
    setDrawerOpen(false);
  }, [pushFilters]);

  return (
    <>
      {/* Mobile trigger row — visible below the lg breakpoint. */}
      <div className={cn("lg:hidden", className)}>
        <Button
          type="button"
          variant="outline"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls="product-filters-drawer"
          className="w-full justify-between"
        >
          <span className="inline-flex items-center gap-2">
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filters
          </span>
          {activeCount > 0 ? (
            <Badge variant="secondary" className="rounded-full">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </div>

      {/* Desktop sidebar — always rendered at lg+. */}
      <aside
        aria-label="Product filters"
        className={cn(
          "hidden lg:block",
          "rounded-lg border bg-card p-4",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Filters</h2>
          {activeCount > 0 ? (
            <Badge variant="secondary" className="rounded-full">
              {activeCount} active
            </Badge>
          ) : null}
        </div>
        <FilterPanelBody
          draft={draft}
          setDraft={setDraft}
          onApply={onApply}
          onClear={onClear}
          variant="sidebar"
        />
      </aside>

      {/* Mobile drawer — overlay + slide-in panel. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          id="product-filters-drawer"
        >
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div className="relative ml-auto flex h-full w-full max-w-sm flex-col bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Filters</h2>
                {activeCount > 0 ? (
                  <Badge variant="secondary" className="rounded-full">
                    {activeCount}
                  </Badge>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <FilterPanelBody
                draft={draft}
                setDraft={setDraft}
                onApply={onApply}
                onClear={onClear}
                variant="drawer"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
