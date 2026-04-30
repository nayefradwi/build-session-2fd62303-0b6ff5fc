"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SignInPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Headline copy — defaults to a generic call to sign in. */
  title?: string;
  /** Sub-copy that explains why the visitor is being prompted. */
  description?: string;
  /**
   * Path the user should land back on after authenticating. Embedded as
   * `?next=` in the sign-in / register links so the round-trip drops the
   * shopper back where they were.
   */
  next: string;
}

/**
 * Auth-gated action prompt used by the PDP for guests.
 *
 * The Add to Cart and Add to Wishlist buttons trigger this dialog when
 * the visitor isn't signed in. Both /login and /register read `?next=`
 * from the URL and redirect after a successful flow, so we wire that
 * here.
 */
export function SignInPromptDialog({
  open,
  onOpenChange,
  title = "Sign in to continue",
  description = "Create an account or sign in to add this item.",
  next,
}: SignInPromptDialogProps) {
  const encoded = encodeURIComponent(next || "/");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button asChild variant="outline">
            <Link href={`/register?next=${encoded}`}>Create account</Link>
          </Button>
          <Button asChild>
            <Link href={`/login?next=${encoded}`}>Sign in</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
