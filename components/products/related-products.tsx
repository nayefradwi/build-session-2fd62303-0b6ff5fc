"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/products/product-card";
import { cn } from "@/lib/client/utils";
import type { ProductCardData } from "@/lib/client/product-types";

interface RelatedProductsProps {
  products: ReadonlyArray<ProductCardData>;
  className?: string;
}

/**
 * Horizontal "you may also like" carousel rendered at the bottom of the
 * PDP. Uses native overflow-x scrolling with snap points so it works on
 * touch and with the keyboard, then layers in `<<` / `>>` chevrons on
 * desktop for mouse users.
 *
 * Renders nothing if there are no related products.
 */
export function RelatedProducts({ products, className }: RelatedProductsProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const scrollByCard = (direction: -1 | 1) => {
    const node = scrollRef.current;
    if (!node) return;
    // Try to advance roughly one card width — fall back to the
    // container width if the first card hasn't laid out yet.
    const firstCard = node.firstElementChild as HTMLElement | null;
    const step = firstCard
      ? firstCard.getBoundingClientRect().width + 16
      : node.clientWidth * 0.8;
    node.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  if (products.length === 0) return null;

  return (
    <section className={cn("space-y-4", className)} aria-label="Related products">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            You might also like
          </p>
          <h2 className="text-2xl font-bold tracking-tight">Related products</h2>
        </div>
        <div className="hidden gap-2 md:flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Scroll related products left"
            onClick={() => scrollByCard(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Scroll related products right"
            onClick={() => scrollByCard(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 scroll-smooth [scrollbar-width:thin]"
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[60%] shrink-0 snap-start sm:w-[40%] md:w-[30%] lg:w-[22%]"
          >
            <ProductCard product={product} showMerchBadges />
          </div>
        ))}
      </div>
    </section>
  );
}
