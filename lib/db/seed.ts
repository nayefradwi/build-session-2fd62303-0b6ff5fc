/**
 * Catalog seed script.
 *
 * Populates the `categories`, `products`, and `product_images` tables
 * with a deterministic, ~100-SKU sample so the storefront can be
 * developed and demoed without a manual data-entry pass.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx lib/db/seed.ts
 *
 * The script is idempotent on slug/SKU collisions: re-running it will
 * skip rows that already exist (ON CONFLICT DO NOTHING) so it is safe
 * to invoke against a partially-seeded database.
 */
import { sql } from "drizzle-orm";

import { db } from "./index";
import {
  categories,
  productImages,
  products,
  type NewCategory,
  type NewProduct,
  type NewProductImage,
} from "./schema";

interface CategorySeed {
  slug: string;
  name: string;
  description: string;
  parentSlug?: string;
}

const CATEGORIES: CategorySeed[] = [
  {
    slug: "apparel",
    name: "Apparel",
    description: "Clothing and accessories for every season.",
  },
  {
    slug: "tops",
    name: "Tops",
    description: "Tees, shirts, sweaters, and hoodies.",
    parentSlug: "apparel",
  },
  {
    slug: "bottoms",
    name: "Bottoms",
    description: "Pants, jeans, and shorts.",
    parentSlug: "apparel",
  },
  {
    slug: "outerwear",
    name: "Outerwear",
    description: "Jackets, coats, and weather layers.",
    parentSlug: "apparel",
  },
  {
    slug: "footwear",
    name: "Footwear",
    description: "Shoes, sneakers, and boots.",
  },
  {
    slug: "accessories",
    name: "Accessories",
    description: "Bags, hats, belts, and small goods.",
  },
  {
    slug: "home",
    name: "Home",
    description: "Goods for the home and workspace.",
  },
];

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const SHOE_SIZES = ["7", "8", "9", "10", "11", "12"] as const;
const ONE_SIZE = ["One Size"] as const;
const MATERIALS = [
  "Cotton",
  "Linen",
  "Wool",
  "Leather",
  "Denim",
  "Polyester",
  "Recycled Polyester",
  "Cashmere",
  "Canvas",
  "Suede",
] as const;
const COLORS = [
  "Black",
  "White",
  "Charcoal",
  "Heather Grey",
  "Navy",
  "Olive",
  "Sand",
  "Burgundy",
  "Rust",
  "Cream",
  "Forest",
  "Cobalt",
] as const;

interface ProductTemplate {
  baseName: string;
  categorySlug: string;
  sizes: readonly string[];
  basePriceCents: number;
  priceJitterCents: number;
  description: (color: string, material: string) => string;
}

const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    baseName: "Heritage Crewneck Tee",
    categorySlug: "tops",
    sizes: SIZES,
    basePriceCents: 3200,
    priceJitterCents: 600,
    description: (c, m) =>
      `A garment-dyed ${c.toLowerCase()} crewneck tee cut from heavyweight ${m.toLowerCase()}. Reinforced shoulder seams, ribbed collar, true-to-size fit.`,
  },
  {
    baseName: "Field Oxford Shirt",
    categorySlug: "tops",
    sizes: SIZES,
    basePriceCents: 8800,
    priceJitterCents: 1200,
    description: (c, m) =>
      `A long-sleeve oxford in ${c.toLowerCase()} ${m.toLowerCase()}, finished with a button-down collar and locker loop. Pairs equally well under a blazer or worn open over a tee.`,
  },
  {
    baseName: "Lofted Knit Pullover",
    categorySlug: "tops",
    sizes: SIZES,
    basePriceCents: 14500,
    priceJitterCents: 2500,
    description: (c, m) =>
      `Cosy ${m.toLowerCase()} pullover in ${c.toLowerCase()}. Drop-shoulder cut, ribbed cuffs, generous body that layers easily over an oxford.`,
  },
  {
    baseName: "Workshop Hoodie",
    categorySlug: "tops",
    sizes: SIZES,
    basePriceCents: 9800,
    priceJitterCents: 1500,
    description: (c, m) =>
      `Brushed-back ${m.toLowerCase()} hoodie in ${c.toLowerCase()}. Kangaroo pocket, lined hood, set-in sleeves for a clean drape.`,
  },
  {
    baseName: "Standard Selvedge Jean",
    categorySlug: "bottoms",
    sizes: SIZES,
    basePriceCents: 13800,
    priceJitterCents: 2200,
    description: (c) =>
      `Mid-rise straight-leg jean in a ${c.toLowerCase()} 13-oz selvedge denim. Sanforised, vintage-inspired hardware, classic five-pocket build.`,
  },
  {
    baseName: "Daily Chino",
    categorySlug: "bottoms",
    sizes: SIZES,
    basePriceCents: 8400,
    priceJitterCents: 1500,
    description: (c, m) =>
      `Tapered ${m.toLowerCase()} chino in ${c.toLowerCase()}. Hidden side seams, button fly, slight stretch for all-day comfort.`,
  },
  {
    baseName: "Trail Cargo Short",
    categorySlug: "bottoms",
    sizes: SIZES,
    basePriceCents: 6200,
    priceJitterCents: 900,
    description: (c, m) =>
      `Above-the-knee cargo short in ripstop ${m.toLowerCase()}, ${c.toLowerCase()}. Two utility pockets, drawstring waist, packs flat for travel.`,
  },
  {
    baseName: "All-Weather Trench",
    categorySlug: "outerwear",
    sizes: SIZES,
    basePriceCents: 24000,
    priceJitterCents: 4000,
    description: (c, m) =>
      `Mid-length ${c.toLowerCase()} trench in water-repellent ${m.toLowerCase()}. Storm flap, throat tab, raglan sleeves, removable belt.`,
  },
  {
    baseName: "Down Alpine Parka",
    categorySlug: "outerwear",
    sizes: SIZES,
    basePriceCents: 32000,
    priceJitterCents: 6000,
    description: (c, m) =>
      `Responsibly-sourced 700-fill down parka with a ${m.toLowerCase()} shell in ${c.toLowerCase()}. Two-way zip, snow skirt, helmet-compatible hood.`,
  },
  {
    baseName: "Court Low Sneaker",
    categorySlug: "footwear",
    sizes: SHOE_SIZES,
    basePriceCents: 11000,
    priceJitterCents: 2000,
    description: (c, m) =>
      `Low-profile court sneaker in ${c.toLowerCase()} ${m.toLowerCase()} with a vulcanised rubber outsole and cushioned EVA insole.`,
  },
  {
    baseName: "Trailhead Hiker",
    categorySlug: "footwear",
    sizes: SHOE_SIZES,
    basePriceCents: 18500,
    priceJitterCents: 3500,
    description: (c, m) =>
      `Mid-cut hiker in waterproof ${m.toLowerCase()}, ${c.toLowerCase()}. Lugged outsole grips loose terrain; padded collar locks the heel in.`,
  },
  {
    baseName: "Roll-Top Daypack",
    categorySlug: "accessories",
    sizes: ONE_SIZE,
    basePriceCents: 12500,
    priceJitterCents: 1800,
    description: (c, m) =>
      `Roll-top daypack in ${c.toLowerCase()} ${m.toLowerCase()}. Padded laptop sleeve, internal organiser, weatherproof YKK zippers.`,
  },
  {
    baseName: "Wide-Brim Felt Hat",
    categorySlug: "accessories",
    sizes: ONE_SIZE,
    basePriceCents: 7800,
    priceJitterCents: 1000,
    description: (c, m) =>
      `Wide-brim hat in ${m.toLowerCase()}, ${c.toLowerCase()}. Grosgrain band, internal sweatband, packable crown.`,
  },
  {
    baseName: "Studio Throw Blanket",
    categorySlug: "home",
    sizes: ONE_SIZE,
    basePriceCents: 9800,
    priceJitterCents: 1200,
    description: (c, m) =>
      `Heirloom-weight ${m.toLowerCase()} throw in ${c.toLowerCase()}, with hand-tied fringe. 50" × 70" — sized for sofa or bed.`,
  },
  {
    baseName: "Stoneware Mug Set",
    categorySlug: "home",
    sizes: ONE_SIZE,
    basePriceCents: 4400,
    priceJitterCents: 600,
    description: (c) =>
      `Set of four reactive-glaze stoneware mugs, ${c.toLowerCase()}. 12 oz capacity, dishwasher safe.`,
  },
];

/**
 * Lightweight deterministic PRNG. We avoid Math.random() so successive
 * runs of the seed produce a stable catalog (helpful for screenshots
 * and integration tests).
 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function seedCategories(): Promise<Map<string, string>> {
  const slugToId = new Map<string, string>();

  // Two passes so children can resolve their parent_id.
  const topLevel: NewCategory[] = CATEGORIES.filter(
    (c) => !c.parentSlug,
  ).map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
  }));

  const insertedTop = await db
    .insert(categories)
    .values(topLevel)
    .onConflictDoNothing({ target: categories.slug })
    .returning({ id: categories.id, slug: categories.slug });
  for (const row of insertedTop) slugToId.set(row.slug, row.id);

  // Backfill ids for any rows that already existed.
  const existingTop = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  for (const row of existingTop) slugToId.set(row.slug, row.id);

  const children = CATEGORIES.filter((c) => c.parentSlug).map((c) => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    parentId: slugToId.get(c.parentSlug!) ?? null,
  })) as NewCategory[];

  if (children.length > 0) {
    await db
      .insert(categories)
      .values(children)
      .onConflictDoNothing({ target: categories.slug });

    const refreshed = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories);
    for (const row of refreshed) slugToId.set(row.slug, row.id);
  }

  return slugToId;
}

async function seedProducts(slugToCategoryId: Map<string, string>) {
  const rng = makeRng(20240601);
  const productsToInsert: NewProduct[] = [];
  const skuSet = new Set<string>();
  const slugSet = new Set<string>();

  // Aim for ~100 SKUs by repeating each template across a colour
  // palette. Each template contributes 7 SKUs → 15 templates × 7 ≈ 105.
  const colorsPerTemplate = 7;

  let productIndex = 0;
  for (const tmpl of PRODUCT_TEMPLATES) {
    const categoryId = slugToCategoryId.get(tmpl.categorySlug);
    if (!categoryId) continue;
    const colours = shuffled(rng, COLORS).slice(0, colorsPerTemplate);

    for (const color of colours) {
      const material = pick(rng, MATERIALS);
      const size = pick(rng, tmpl.sizes);
      const name = `${tmpl.baseName} – ${color}`;
      let slug = slugify(`${tmpl.baseName}-${color}-${size}`);
      let sku = `${slugify(tmpl.baseName)
        .toUpperCase()
        .replace(/-/g, "")
        .slice(0, 8)}-${color.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "XXX"}-${size.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`;

      // Disambiguate any accidental collisions across colour/size loops.
      let bump = 0;
      while (slugSet.has(slug)) {
        bump += 1;
        slug = `${slugify(`${tmpl.baseName}-${color}-${size}`)}-${bump}`;
      }
      slugSet.add(slug);
      bump = 0;
      while (skuSet.has(sku)) {
        bump += 1;
        sku = `${sku}-${bump}`;
      }
      skuSet.add(sku);

      const jitter = Math.floor(rng() * tmpl.priceJitterCents);
      const priceCents = tmpl.basePriceCents + jitter;
      const onSale = rng() < 0.25;
      const compareAtPriceCents = onSale
        ? priceCents + 1000 + Math.floor(rng() * 4000)
        : null;

      const stock = Math.floor(rng() * 60); // 0..59 — some SKUs are OOS
      const isFeatured = rng() < 0.15;
      const isNew = rng() < 0.25;
      const ratingAverage = (3.6 + rng() * 1.4).toFixed(2); // 3.60..5.00
      const ratingCount = Math.floor(rng() * 250);
      const salesCount = Math.floor(rng() * 1000);

      productsToInsert.push({
        slug,
        sku,
        name,
        description: tmpl.description(color, material),
        categoryId,
        priceCents,
        compareAtPriceCents,
        currency: "USD",
        size,
        material,
        color,
        stock,
        isFeatured,
        isNew,
        ratingAverage,
        ratingCount,
        salesCount,
      });
      productIndex += 1;
    }
  }

  if (productsToInsert.length === 0) return;

  // Bulk insert in chunks; some Postgres deployments cap parameter counts.
  const chunkSize = 50;
  const insertedIdsBySlug = new Map<string, string>();
  for (let i = 0; i < productsToInsert.length; i += chunkSize) {
    const chunk = productsToInsert.slice(i, i + chunkSize);
    const inserted = await db
      .insert(products)
      .values(chunk)
      .onConflictDoNothing({ target: products.slug })
      .returning({ id: products.id, slug: products.slug });
    for (const row of inserted) insertedIdsBySlug.set(row.slug, row.id);
  }

  // Pick up ids for rows that pre-existed (idempotent re-runs).
  const all = await db
    .select({ id: products.id, slug: products.slug })
    .from(products);
  for (const row of all) insertedIdsBySlug.set(row.slug, row.id);

  // Seed two stock photos per product. The URL is opaque — the storefront
  // layer can swap it for a CDN host or a Next/Image loader as needed.
  const imagesToInsert: NewProductImage[] = [];
  for (const p of productsToInsert) {
    const id = insertedIdsBySlug.get(p.slug);
    if (!id) continue;
    const seedKey = encodeURIComponent(p.sku);
    imagesToInsert.push(
      {
        productId: id,
        url: `https://picsum.photos/seed/${seedKey}-1/800/1000`,
        alt: `${p.name} — front view`,
        position: 0,
      },
      {
        productId: id,
        url: `https://picsum.photos/seed/${seedKey}-2/800/1000`,
        alt: `${p.name} — detail view`,
        position: 1,
      },
    );
  }

  for (let i = 0; i < imagesToInsert.length; i += chunkSize * 2) {
    const chunk = imagesToInsert.slice(i, i + chunkSize * 2);
    // Avoid duplicate inserts by skipping when the product already has
    // an image at that position. Approximate via a guard select.
    await db.insert(productImages).values(chunk);
  }

  console.log(`Seeded ${productIndex} products and ${imagesToInsert.length} images.`);
}

function shuffled<T>(rng: () => number, arr: readonly T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

async function main() {
  console.log("Seeding catalog...");

  // If product_images already has any rows we assume the seed has run.
  // Idempotency on `products` is enforced via slug/sku uniqueness, but
  // we don't want to spam image rows on each invocation.
  const existing = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM product_images`,
  );
  // `db.execute` returns either an array-like or a `{ rows }` object
  // depending on the underlying driver. Normalise here.
  const rawRows: Array<Record<string, unknown>> = Array.isArray(existing)
    ? (existing as Array<Record<string, unknown>>)
    : ((existing as { rows: Array<Record<string, unknown>> }).rows ?? []);
  const rawCount = rawRows[0]?.count;
  const count =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string"
        ? parseInt(rawCount, 10)
        : 0;
  if (count > 0) {
    console.log(
      `Found ${count} existing product_images rows — skipping seed. ` +
        "Truncate the table to re-seed.",
    );
    return;
  }

  const slugToCategoryId = await seedCategories();
  await seedProducts(slugToCategoryId);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
