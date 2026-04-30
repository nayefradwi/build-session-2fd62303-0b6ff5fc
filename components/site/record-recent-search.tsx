"use client";

import * as React from "react";

import { pushRecentSearch } from "@/lib/client/recent-searches";

interface RecordRecentSearchProps {
  /** The query the user actually executed. Empty values are ignored. */
  query: string;
  /**
   * Whether the search returned at least one result. We only push to
   * recents when there was a hit so the list doesn't fill with typos
   * the user immediately corrected.
   */
  hadResults: boolean;
}

/**
 * Side-effect-only component: when the search page renders with a
 * query that produced results, push that query into the localStorage
 * recents list. Lets recents pick up direct URL hits (links shared,
 * bookmarks, etc.) — not just header submits.
 */
export function RecordRecentSearch({ query, hadResults }: RecordRecentSearchProps) {
  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || !hadResults) return;
    pushRecentSearch(trimmed);
  }, [query, hadResults]);
  return null;
}
