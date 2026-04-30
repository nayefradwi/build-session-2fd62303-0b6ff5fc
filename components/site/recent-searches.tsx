"use client";

import * as React from "react";
import Link from "next/link";
import { Clock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  RECENT_SEARCHES_EVENT,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "@/lib/client/recent-searches";

interface RecentSearchesProps {
  /**
   * Heading copy. Defaults to "Recent searches" but the search page
   * sometimes wants a slightly different framing (e.g. "Try one of
   * your recent searches").
   */
  title?: string;
  className?: string;
}

/**
 * Renders the user's recent searches (read from localStorage) as a
 * row of chip-style links to `/search?q=<term>`.
 *
 * The list is loaded after mount to avoid hydration mismatch — the
 * server has no way to know what's in the user's localStorage. Until
 * the effect runs we render `null` so there's no layout flash, then
 * the chips appear with a normal CSS transition.
 */
export function RecentSearches({
  title = "Recent searches",
  className,
}: RecentSearchesProps) {
  const [items, setItems] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    setItems(getRecentSearches());

    function refresh() {
      setItems(getRecentSearches());
    }

    // Same-tab updates dispatched by `pushRecentSearch`/`clearRecentSearches`.
    window.addEventListener(RECENT_SEARCHES_EVENT, refresh);
    // Cross-tab updates: the native `storage` event fires whenever any
    // other tab on the same origin writes to localStorage.
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(RECENT_SEARCHES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (items === null || items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={title}
      className={className}
      data-testid="recent-searches"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            clearRecentSearches();
            setItems([]);
          }}
        >
          Clear all
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((term) => (
          <li key={term} className="group">
            <div className="flex items-stretch overflow-hidden rounded-full border bg-card text-sm shadow-sm transition hover:bg-accent">
              <Link
                href={`/search?q=${encodeURIComponent(term)}`}
                className="px-3 py-1.5 text-foreground hover:text-foreground"
              >
                {term}
              </Link>
              <button
                type="button"
                aria-label={`Remove ${term} from recent searches`}
                onClick={() => {
                  removeRecentSearch(term);
                  setItems((current) =>
                    current ? current.filter((value) => value !== term) : current,
                  );
                }}
                className="flex items-center border-l px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
