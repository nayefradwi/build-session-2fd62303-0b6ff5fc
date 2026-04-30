"use client";

import * as React from "react";

import { cn } from "@/lib/client/utils";
import { Badge } from "@/components/ui/badge";

export interface ProductGalleryImage {
  id: string;
  url: string;
  alt: string | null;
  position: number;
}

interface ProductGalleryProps {
  /** Full image gallery for the product, ordered by position. */
  images: ReadonlyArray<ProductGalleryImage>;
  /** Used for the alt-text fallback when an image has no `alt` of its own. */
  productName: string;
  /** Optional badges layered over the active image (e.g. "New", "Out of stock"). */
  topLeftBadges?: React.ReactNode;
  topRightBadges?: React.ReactNode;
  className?: string;
}

/**
 * PDP image gallery with a primary image and a thumbnail strip. Click /
 * keyboard-arrow on a thumbnail to switch the main image; the thumbnails
 * keep focus rings so the gallery is fully keyboard navigable.
 *
 * Plain `<img>` elements on purpose — keeps us out of `next/image`
 * configuration (the catalog uses `picsum.photos` URLs and we want this
 * to work without a `next.config` patch in either territory).
 *
 * Layout:
 *   - Mobile/Tablet: thumbnails wrap below the main image
 *   - Desktop (md+): thumbnails sit in a vertical rail to the left
 */
export function ProductGallery({
  images,
  productName,
  topLeftBadges,
  topRightBadges,
  className,
}: ProductGalleryProps) {
  const safeImages = React.useMemo(() => images.slice(), [images]);
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Keep activeIndex valid if `images` changes (e.g. SSR → CSR mismatch fix).
  React.useEffect(() => {
    if (activeIndex >= safeImages.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, safeImages.length]);

  const active = safeImages[activeIndex] ?? null;

  if (safeImages.length === 0) {
    return (
      <div
        className={cn(
          "relative flex aspect-[4/5] w-full items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        No image available
      </div>
    );
  }

  const handleThumbKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((index + 1) % safeImages.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((index - 1 + safeImages.length) % safeImages.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(safeImages.length - 1);
    }
  };

  return (
    <div className={cn("flex flex-col gap-3 md:flex-row", className)}>
      {/* Main image column */}
      <div className="order-1 flex-1 md:order-2">
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg border bg-muted">
          {active && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={active.id}
              src={active.url}
              alt={active.alt ?? productName}
              className="h-full w-full object-cover"
            />
          )}

          {topLeftBadges && (
            <div className="absolute left-3 top-3 flex flex-wrap gap-1">
              {topLeftBadges}
            </div>
          )}
          {topRightBadges && (
            <div className="absolute right-3 top-3 flex flex-wrap gap-1">
              {topRightBadges}
            </div>
          )}

          {safeImages.length > 1 && (
            <Badge
              variant="outline"
              className="absolute bottom-3 right-3 bg-background/90 backdrop-blur"
            >
              {activeIndex + 1} / {safeImages.length}
            </Badge>
          )}
        </div>
      </div>

      {/* Thumbnail rail — vertical on desktop, horizontal scroll on mobile. */}
      {safeImages.length > 1 && (
        <ul
          role="listbox"
          aria-label={`${productName} images`}
          className={cn(
            "order-2 flex flex-row gap-2 overflow-x-auto md:order-1 md:max-h-[600px] md:flex-col md:overflow-y-auto md:overflow-x-visible",
          )}
        >
          {safeImages.map((img, idx) => {
            const isActive = idx === activeIndex;
            return (
              <li key={img.id} className="shrink-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(event) => handleThumbKey(event, idx)}
                  onClick={() => setActiveIndex(idx)}
                  className={cn(
                    "block h-16 w-16 overflow-hidden rounded-md border bg-muted ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-20 md:w-20",
                    isActive
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-input hover:border-foreground/50",
                  )}
                  aria-label={`Show image ${idx + 1} of ${safeImages.length}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? `${productName} – view ${idx + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
