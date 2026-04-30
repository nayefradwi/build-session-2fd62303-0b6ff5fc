import Link from "next/link";
import { ArrowRight, Sparkles, Tag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductGrid } from "@/components/products/product-grid";
import { listProducts } from "@/lib/server/products";
import { getCurrentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Homepage — hero + two merchandised product strips.
 *
 * Data is fetched server-side via the shared `listProducts` helper
 * (the same function the GET /api/products handler uses), so the
 * homepage doesn't pay a client roundtrip and stays SEO-friendly.
 *
 * If either strip's query fails (database hiccup, etc.), we render
 * the rest of the page with an inline notice rather than blowing up
 * the whole route — the storefront should still feel usable.
 */
export default async function HomePage() {
  const [user, featured, newArrivals] = await Promise.all([
    getCurrentUser(),
    listProducts({ page: 1, pageSize: 8, sort: "popularity", isFeatured: true })
      .catch((err) => {
        console.error("[home] failed to load featured products", err);
        return null;
      }),
    listProducts({ page: 1, pageSize: 8, sort: "newest", isNew: true }).catch(
      (err) => {
        console.error("[home] failed to load new arrivals", err);
        return null;
      },
    ),
  ]);

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-12 sm:py-16 md:flex-row md:items-center md:justify-between md:py-20">
          <div className="max-w-2xl space-y-4">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              {user
                ? `Welcome back${user.name ? `, ${user.name.split(" ")[0]}` : ""}.`
                : "Discover thoughtfully made goods."}
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg">
              Browse our curated catalog of apparel, footwear, and home goods —
              with new arrivals dropping every week.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/products">
                  Shop all products
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {!user && (
                <Button asChild size="lg" variant="outline">
                  <Link href="/register">Create an account</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Featured */}
      <Section
        title="Featured"
        subtitle="Handpicked staples our customers keep coming back to."
        icon={<Sparkles className="h-5 w-5" />}
        href="/products?featured=true"
        cta="See all featured"
      >
        {featured == null ? (
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load featured products right now.
          </p>
        ) : (
          <ProductGrid
            products={featured.items}
            emptyMessage="No featured products yet — check back soon."
          />
        )}
      </Section>

      {/* New arrivals */}
      <Section
        title="New arrivals"
        subtitle="Fresh drops, just added to the catalog."
        icon={<Tag className="h-5 w-5" />}
        href="/products?new=true&sort=newest"
        cta="See all new"
      >
        {newArrivals == null ? (
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load new arrivals right now.
          </p>
        ) : (
          <ProductGrid
            products={newArrivals.items}
            emptyMessage="Nothing new yet — check back soon."
          />
        )}
      </Section>
    </main>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  href: string;
  cta: string;
  children: React.ReactNode;
}

/**
 * Local helper for the homepage's repeated "header + grid + CTA"
 * sections. Kept inline because it isn't reused outside this file.
 */
function Section({ title, subtitle, icon, href, cta, children }: SectionProps) {
  return (
    <section className="border-b last:border-b-0">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              {icon}
              <span className="text-xs font-semibold uppercase tracking-wide">
                {title}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Button asChild variant="ghost" className="self-start sm:self-end">
            <Link href={href}>
              {cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        {children}
      </div>
    </section>
  );
}
