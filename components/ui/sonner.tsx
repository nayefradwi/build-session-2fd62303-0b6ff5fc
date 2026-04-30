"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

/**
 * Thin wrapper around sonner's `<Toaster />` so the root layout can
 * mount a single instance without leaking the dependency surface.
 */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="light"
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
