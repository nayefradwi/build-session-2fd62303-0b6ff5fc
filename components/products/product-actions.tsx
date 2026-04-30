"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart, Loader2, Minus, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignInPromptDialog } from "@/components/products/sign-in-prompt-dialog";
import { cn } from "@/lib/client/utils";

/**
 * Per-line cap mirrored from `lib/server/cart`. Kept inline here so this
 * client component doesn't pull a server-only module.
 */
const MAX_QUANTITY_PER_LINE = 99;

interface ProductActionsProps {
  productId: string;
  productName: string;
  productSlug: string;
  /** Live stock from the API. 0 disables Add to Cart entirely. */
  stock: number;
  /** True when the visitor has a session cookie. Decided server-side. */
  isAuthenticated: boolean;
  className?: string;
}

interface CartErrorBody {
  error?: string;
  code?: string;
  details?: { available?: number; requested?: number; max?: number };
}

interface WishlistResponse {
  alreadyExists?: boolean;
}

interface WishlistErrorBody {
  error?: string;
  code?: string;
}

type Pending = "cart" | "wishlist" | null;

/**
 * Bundle of "add to cart" + "add to wishlist" controls for the PDP.
 *
 * Behaviour:
 *   - Signed-in shoppers: clicks call the cart/wishlist APIs directly.
 *     Quantity is bounded by `stock` and the per-line cap from the
 *     backend (`MAX_QUANTITY_PER_LINE`).
 *   - Signed-out shoppers: any click opens the sign-in prompt modal
 *     (delegating to /login?next= and /register?next=) instead of
 *     hitting the API. The modal copy is action-specific so the user
 *     understands what's gated.
 *
 * The cart endpoint already enforces stock and per-line caps; we still
 * mirror the cap in the UI so the +/- buttons can disable cleanly
 * before a network round-trip.
 */
export function ProductActions({
  productId,
  productName,
  productSlug,
  stock,
  isAuthenticated,
  className,
}: ProductActionsProps) {
  const router = useRouter();
  const outOfStock = stock <= 0;
  const cap = Math.max(1, Math.min(stock, MAX_QUANTITY_PER_LINE));

  const [quantity, setQuantity] = React.useState<number>(outOfStock ? 1 : 1);
  const [pending, setPending] = React.useState<Pending>(null);
  const [promptKind, setPromptKind] = React.useState<
    "cart" | "wishlist" | null
  >(null);

  // Bring the quantity back inside the cap if the live stock shrinks.
  React.useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), cap));
  }, [cap]);

  const next = `/products/${productSlug}`;

  const decrement = () => setQuantity((q) => Math.max(1, q - 1));
  const increment = () => setQuantity((q) => Math.min(cap, q + 1));

  const onQuantityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    if (raw === "") return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setQuantity(Math.min(cap, Math.max(1, parsed)));
  };

  const handleAddToCart = async () => {
    if (outOfStock || pending) return;
    if (!isAuthenticated) {
      setPromptKind("cart");
      return;
    }
    setPending("cart");
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity, mode: "increment" }),
      });
      if (!res.ok) {
        let body: CartErrorBody = {};
        try {
          body = (await res.json()) as CartErrorBody;
        } catch {
          // ignore — fallthrough to generic toast
        }
        if (res.status === 401) {
          // Cookie expired between page load and click.
          setPromptKind("cart");
          return;
        }
        if (res.status === 409 && body.code === "exceeds_stock") {
          toast.error("Not enough stock", {
            description: body.details?.available
              ? `Only ${body.details.available} left in stock.`
              : "We don't have that many in stock right now.",
          });
          return;
        }
        if (res.status === 409 && body.code === "out_of_stock") {
          toast.error("Out of stock", {
            description: "This item is currently unavailable.",
          });
          return;
        }
        if (res.status === 400 && body.code === "exceeds_max_quantity") {
          toast.error("Quantity too high", {
            description: `Maximum is ${
              body.details?.max ?? MAX_QUANTITY_PER_LINE
            } per item.`,
          });
          return;
        }
        toast.error("Couldn't add to cart", {
          description: body.error ?? "Please try again in a moment.",
        });
        return;
      }
      toast.success("Added to cart", {
        description:
          quantity === 1
            ? `${productName} is now in your cart.`
            : `${quantity} × ${productName} added to your cart.`,
      });
      // Header / cart count surfaces are server-rendered, so refresh.
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(null);
    }
  };

  const handleAddToWishlist = async () => {
    if (pending) return;
    if (!isAuthenticated) {
      setPromptKind("wishlist");
      return;
    }
    setPending("wishlist");
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setPromptKind("wishlist");
          return;
        }
        let body: WishlistErrorBody = {};
        try {
          body = (await res.json()) as WishlistErrorBody;
        } catch {
          // ignore
        }
        toast.error("Couldn't add to wishlist", {
          description: body.error ?? "Please try again in a moment.",
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as WishlistResponse;
      if (body.alreadyExists) {
        toast.info("Already in your wishlist", {
          description: `${productName} is already saved to your wishlist.`,
        });
      } else {
        toast.success("Added to wishlist", {
          description: `${productName} saved to your wishlist.`,
        });
      }
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={cn("space-y-4", className)} data-testid="product-actions">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="pdp-quantity" className="text-sm font-medium">
            Qty
          </Label>
          <div className="inline-flex items-center rounded-md border bg-background">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={decrement}
              disabled={outOfStock || quantity <= 1 || pending !== null}
              className="flex h-10 w-10 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <Input
              id="pdp-quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={cap}
              value={quantity}
              onChange={onQuantityChange}
              disabled={outOfStock || pending !== null}
              className="h-10 w-14 border-0 px-0 text-center focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={increment}
              disabled={outOfStock || quantity >= cap || pending !== null}
              className="flex h-10 w-10 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        {!outOfStock && stock <= 5 && (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Only {stock} left
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="lg"
          onClick={handleAddToCart}
          disabled={outOfStock || pending === "cart"}
          className="flex-1"
          data-testid="pdp-add-to-cart"
        >
          {pending === "cart" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          {outOfStock ? "Out of stock" : "Add to cart"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={handleAddToWishlist}
          disabled={pending === "wishlist"}
          className="flex-1 sm:flex-none"
          data-testid="pdp-add-to-wishlist"
        >
          {pending === "wishlist" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          Wishlist
        </Button>
      </div>

      <SignInPromptDialog
        open={promptKind !== null}
        onOpenChange={(o) => {
          if (!o) setPromptKind(null);
        }}
        next={next}
        title={
          promptKind === "wishlist"
            ? "Sign in to save to your wishlist"
            : "Sign in to add to your cart"
        }
        description={
          promptKind === "wishlist"
            ? "Create an account or sign in to save items for later — they'll be waiting on every device."
            : "Create an account or sign in to add this item to your cart and check out securely."
        }
      />
    </div>
  );
}
