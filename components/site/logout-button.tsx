"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface LogoutButtonProps {
  className?: string;
}

/**
 * Client-side logout trigger. POSTs to `/api/auth/logout`, which
 * revokes the DB-backed session and clears the httpOnly cookie. After
 * the cookie is gone we `router.refresh()` so the server-rendered
 * header reflects the signed-out state, then push to `/`.
 *
 * Because the cookie is shared across tabs of the same origin, signing
 * out in one tab will sign every other tab out on its next request.
 */
export function LogoutButton({ className }: LogoutButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        // The endpoint is idempotent and always returns 200, but be
        // defensive in case of network shenanigans.
        toast.error("Sign out failed", {
          description: "Please try again.",
        });
        return;
      }
      toast.success("Signed out");
      router.replace("/");
      router.refresh();
    } catch {
      toast.error("Network error", {
        description: "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={pending}
      className={className}
      aria-label="Sign out"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      <span>Sign out</span>
    </Button>
  );
}
