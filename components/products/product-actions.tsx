"use client";

import * as React from "react";
import { Check, Loader2, Minus, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SignInPromptDialog } from "@/components/products/sign-in-prompt-dialog";
import { WishlistButton } from "@/components/products/wishlist-button";
import { useCart } from "@/lib/client/cart-store";
import { cn } from "@/lib/client/utils";

/**
 * Per-line cap mirrored from `lib/server/cart`. Kept inline here so this
 * client component doesn't pull a server-only module.
 */
const MAX_QUANTITY_PER_LINE = 99;

/**
 * How long the inline "Added to cart" confirmation stays visible. The
 * toast is shown alongside it; the inline copy gives the shopper a
 * persistent, in-place cue that doesn't require them to look away from
 * the action area.
 */
const INLINE_CONFIRMATION_MS = 3500;

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

interface CartItemBody {
  quantity?: number;
}

interface CartSummaryBody {
  itemCount?: number;
}

interface CartSuccessBody {
  item?: CartItemBody | null;
  summary?: CartSummaryBody;
}

/**
 * Bundle of "add to cart" + wishlist toggle controls for the PDP.
 *
 * Behaviour:
 *   - Signed-in shoppers: the cart button calls /api/cart, then nudges
 *     the shared cart store so the header badge updates instantly. An
 *     inline "Added to cart" confirmation appears beneath the button
 *     in addition to the success toast.
 *   - Signed-out shoppers: clicks open a sign-in prompt instead of
 *     hitting the API. The wishlist sub-component owns its own prompt
 *     copy; the cart prompt below is specific to checkout.
 *   - Out-of-stock products: the Add to Cart button is disabled and a
 *     tooltip explains why on hover/focus. The quantity stepper is also
 *     disabled.
 */
export function ProductActions({
  productId,
  productName,
  productSlug,
  stock,
  isAuthenticated,
  className,
}: ProductActionsProps) {
  const cart = useCart();
  const outOfStock = stock <= 0;
  const cap = Math.max(1, Math.min(stock, MAX_QUANTITY_PER_LINE));

  const [quantity, setQuantity] = React.useState<number>(1);
  const [pending, setPending] = React.useState(false);
  const [cartPromptOpen, setCartPromptOpen] = React.useState(false);
  // Persistent in-place confirmation (cleared after a few seconds). The
  // toast also fires, but the inline message gives sighted users a cue
  // that doesn't fly off screen.
  const [confirmation, setConfirmation] = React.useState<string | null>(null);
  const confirmationTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Bring the quantity back inside the cap if the live stock shrinks.
  React.useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), cap));
  }, [cap]);

  // Make sure we don't try to setState after unmount when the inline
  // confirmation timer fires.
  React.useEffect(() => {
    return () => {
      if (confirmationTimer.current) {
        clearTimeout(confirmationTimer.current);
        confirmationTimer.current = null;
      }
    };
  }, []);

  const showInlineConfirmation = React.useCallback((message: string) => {
    setConfirmation(message);
    if (confirmationTimer.current) {
      clearTimeout(confirmationTimer.current);
    }
    confirmationTimer.current = setTimeout(() => {
      setConfirmation(null);
      confirmationTimer.current = null;
    }, INLINE_CONFIRMATION_MS);
  }, []);

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
      setCartPromptOpen(true);
      return;
    }
    setPending(true);
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
          setCartPromptOpen(true);
          return;
        }
        if (res.status === 409 && body.code === "exceeds_stock") {
          toast.error("Not enough stock", {
            description: body.details?.available
              ? `Only ${body.details.available} left in stock.`
              : "We don't have that many in stock right now.",
          });
          // The cart's authoritative count may have drifted; reconcile.
          void cart.refresh();
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
      // Success — surface a toast, persist an inline confirmation, and
      // bump the header badge. We use the server's `summary.itemCount`
      // when present (authoritative) and otherwise fall back to an
      // optimistic increment of the quantity we just sent.
      let body: CartSuccessBody = {};
      try {
        body = (await res.json()) as CartSuccessBody;
      } catch {
        // The route should always return JSON; ignore parse errors.
      }
      if (typeof body.summary?.itemCount === "number") {
        cart.setCount(body.summary.itemCount);
      } else {
        cart.incrementCount(quantity);
      }
      const description =
        quantity === 1
          ? `${productName} is now in your cart.`
          : `${quantity} × ${productName} added to your cart.`;
      toast.success("Added to cart", { description });
      showInlineConfirmation(
        quantity === 1
          ? "Added to your cart."
          : `Added ${quantity} to your cart.`,
      );
      // Reconcile against the server in the background to make sure the
      // badge stays consistent if the response shape ever changes or a
      // concurrent cart edit happened in another tab.
      void cart.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(false);
    }
  };

  const cartButtonLabel = outOfStock
    ? "Out of stock"
    : pending
    ? "Adding…"
    : "Add to cart";

  // The Tooltip ergonomically only makes sense when the button is
  // disabled-because-out-of-stock; when the button is interactive we
  // render a plain button to keep keyboard / pointer behaviour
  // straightforward.
  const cartButton = (
    <Button
      type="button"
      size="lg"
      onClick={handleAddToCart}
      disabled={outOfStock || pending}
      className="flex-1"
      data-testid="pdp-add-to-cart"
      data-out-of-stock={outOfStock ? "true" : "false"}
      aria-disabled={outOfStock || pending}
      aria-describedby={outOfStock ? "pdp-add-to-cart-oos" : undefined}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
      )}
      {cartButtonLabel}
    </Button>
  );

  return (
    <TooltipProvider delayDuration={150}>
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
                disabled={outOfStock || quantity <= 1 || pending}
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
                disabled={outOfStock || pending}
                className="h-10 w-14 border-0 px-0 text-center focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={increment}
                disabled={outOfStock || quantity >= cap || pending}
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
          {outOfStock ? (
            <Tooltip>
              {/*
                Wrap the disabled button in a span so the tooltip still
                receives pointer/focus events — disabled <button> elements
                don't fire mouse events in some browsers, which would
                otherwise hide the explanation.
              */}
              <TooltipTrigger asChild>
                <span tabIndex={0} className="flex flex-1">
                  {cartButton}
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                role="tooltip"
                id="pdp-add-to-cart-oos"
                data-testid="pdp-add-to-cart-tooltip"
              >
                This item is out of stock right now.
              </TooltipContent>
            </Tooltip>
          ) : (
            cartButton
          )}
          <WishlistButton
            variant="pdp"
            productId={productId}
            productName={productName}
            productSlug={productSlug}
          />
        </div>

        {/* aria-live so assistive tech announces the confirmation; the
            container is always rendered (even when empty) so the layout
            doesn't shift when the message appears. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="min-h-[1.25rem] text-sm"
          data-testid="pdp-add-to-cart-confirmation"
        >
          {confirmation && (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4" aria-hidden="true" />
              {confirmation}
            </span>
          )}
        </div>

        <SignInPromptDialog
          open={cartPromptOpen}
          onOpenChange={setCartPromptOpen}
          next={next}
          title="Sign in to add to your cart"
          description="Create an account or sign in to add this item to your cart and check out securely."
        />
      </div>
    </TooltipProvider>
  );
}
