"use client";

import * as React from "react";
import { Printer } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";

interface PrintButtonProps
  extends Omit<ButtonProps, "onClick" | "children" | "type"> {
  /** Override the default "Print" label. */
  label?: string;
}

/**
 * Tiny client wrapper around `<Button>` that fires `window.print()`.
 *
 * Lives next to the order detail view so a shopper / customer-support
 * agent can produce a paper-friendly receipt straight from the browser.
 * The print stylesheet (in `globals.css`) hides everything outside the
 * `data-print-area` block so the printed page is just the order
 * receipt — header chrome, sidebar nav, and action buttons drop away.
 */
export function PrintButton({
  label = "Print",
  variant = "outline",
  size = "sm",
  className,
  ...rest
}: PrintButtonProps) {
  const handleClick = React.useCallback(() => {
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
  }, []);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      className={className}
      data-testid="order-print-button"
      {...rest}
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
