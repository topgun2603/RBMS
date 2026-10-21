import { z } from "zod";
import { formatAuthorName, MAX_PHOTOS, photoUrlSchema } from "./logic";
import { REVIEW_PLATFORMS, STAFF_REVIEW_SOURCES, type ReviewPlatform, type StaffReviewSource } from "./schema";

/**
 * Staff-entered reviews: one added by hand (feedback given at the counter, copied from Google, a reply to the shop's
 * review request) and CSV imports. Honesty rules (also in the service):
 *  - the source is always recorded and shown publicly ("Shared in store", "From Google");
 *  - a staff-entered review is "verified purchase" only when it is linked to a delivered order that contains the
 *    product (checked by the service), never on staff's say-so; CSV imports are never verified;
 *  - the date can be in the past (when the customer gave it) but not in the future.
 */

// ------------------------------------------------------------------ dates

const IST_MS = 330 * 60_000;
/** "YYYY-MM-DD" of a moment, in IST. */
export const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const EARLIEST = Date.UTC(2000, 0, 1);

/**
 * A review date: "2026-03-14", "14/03/2026", "14-03-2026", "14.03.2026" (day first, as in India) or an ISO date-time.
 * Date-only values become noon IST (or now, when that is today and noon hasn't come). Null when it can't be read;
 * "future" / "too old" as errors.
 */
export function parseReviewDate(raw: string, now: Date): { ok: true; date: Date } | { ok: false; error: "invalid" | "future" | "tooOld" } {
  const s = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  let iso: RegExpMatchArray | null;
  if ((iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if ((iso = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return { ok: false, error: "invalid" };
    const t = Date.parse(s);
    if (Number.isNaN(t)) return { ok: false, error: "invalid" };
    if (t > now.getTime() + 60_000) return { ok: false, error: "future" };
    if (t < EARLIEST) return { ok: false, error: "tooOld" };
    return { ok: true, date: new Date(t) };
  }
  const noon = Date.UTC(y, m - 1, d, 12) - IST_MS;
  const check = new Date(noon + IST_MS);
  if (m < 1 || m > 12 || d < 1 || check.getUTCDate() !== d || check.getUTCMonth() !== m - 1) return { ok: false, error: "invalid" };
  const day = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const today = istDay(now);
  if (day > today) return { ok: false, error: "future" };
  if (noon < EARLIEST) return { ok: false, error: "tooOld" };
  return { ok: true, date: new Date(Math.min(noon, now.getTime())) };
}

const DATE_MESSAGES = { invalid: "Use a date like 2026-03-14 or 14/03/2026", future: "The date can't be in the future", tooOld: "The date is too old" } as const;

// ------------------------------------------------------------------ one review

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

export const STAFF_REVIEW_STATUSES = ["approved", "pending"] as const;
export type StaffReviewStatus = (typeof STAFF_REVIEW_STATUSES)[number];

/** `POST /v1/reviews` (staff): a review someone gave the shop, entered by staff. */
export const staffReviewInputSchema = z
  .object({
    productId: z.string().uuid("Pick a product"),
    rating: z.number().int("Rate 1 to 5 stars").min(1, "Rate 1 to 5 stars").max(5, "Rate 1 to 5 stars"),
    title: opt(z.string().trim().max(120)),
    body: opt(z.string().trim().max(5000)),
    /** The reviewer's name as they gave it; shown as "First L." like every review. */
    authorName: z.string().trim().min(1, "Add the reviewer's name").max(80),
    city: opt(z.string().trim().max(60)),
    /** When the customer gave the review (defaults to now). */
    date: opt(z.string().trim().max(40)),
    photos: z
      .array(photoUrlSchema)
      .max(MAX_PHOTOS, `At most ${MAX_PHOTOS} photos`)
      .transform((list) => [...new Set(list)])
      .default([]),
    source: z.enum(STAFF_REVIEW_SOURCES, { message: "Choose where the review came from" }),
    platform: opt(z.enum(REVIEW_PLATFORMS)),
    sourceUrl: opt(photoUrlSchema),
    /** Links a delivered order of this product: the only way a staff-entered review is "verified purchase". */
    orderNumber: opt(z.string().trim().max(40)),
    /** Staff reviews are published right away unless held for a second look. */
    status: z.enum(STAFF_REVIEW_STATUSES).default("approved"),
  })
  .superRefine((v, ctx) => {
    if (v.source === "imported" && !v.platform) ctx.addIssue({ code: "custom", path: ["platform"], message: "Choose the platform it was imported from" });
    if (v.source !== "imported" && v.platform) ctx.addIssue({ code: "custom", path: ["platform"], message: "Only imported reviews have a platform" });
    if (v.source !== "imported" && v.sourceUrl) ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Only imported reviews have a source link" });
  });
export type StaffReviewInput = z.input<typeof staffReviewInputSchema>;
export type StaffReviewValues = z.output<typeof staffReviewInputSchema>;

/** The linked order as the orders port found it. */
export interface LinkedOrder {
  orderId: string;
  delivered: boolean;
  hasProduct: boolean;
}

/**
 * Whether an order number makes the review verified: only a delivered order that contains the product. Returns the
 * error to show otherwise. No order number → not verified (and no error).
 */
export function verifyLinkedOrder(orderNumber: string | null | undefined, order: LinkedOrder | null): { verified: boolean; orderId: string | null; error?: string } {
  if (!orderNumber) return { verified: false, orderId: null };
  if (!order) return { verified: false, orderId: null, error: `No order ${orderNumber} in this shop` };
  if (!order.hasProduct) return { verified: false, orderId: null, error: `Order ${orderNumber} doesn't include this product` };
  if (!order.delivered) return { verified: false, orderId: null, error: `Order ${orderNumber} isn't delivered yet` };
  return { verified: true, orderId: order.orderId };
}

export { DATE_MESSAGES };

// ------------------------------------------------------------------ CSV

export const MAX_IMPORT_ROWS = 2000;
/** Upload size cap for the CSV text (2,000 long reviews with photo links fit). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** Minimal RFC 4180 parser: BOM, CRLF/LF, quoted fields with commas, quotes and newlines; ";" or tab when the header uses it. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const nl = text.search(/\r|\n/);
  const head = nl < 0 ? text : text.slice(0, nl);
  const count = (c: string) => head.split(c).length - 1;
  const d = count("\t") > count(",") && count("\t") > count(";") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const end = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") (quoted = true), (field = "");
    else if (ch === d) row.push(field), (field = "");
    else if (ch === "\r" || ch === "\n") {
      end();
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else field += ch;
  }
  if (quoted) throw new Error("A quoted field is never closed");
  if (field !== "" || row.length) end();
  return rows;
}

/** CSV columns (header names are matched case-insensitively, with these aliases). */
export const REVIEW_CSV_COLUMNS = {
  product: ["product", "sku", "slug", "product_sku", "product_slug", "handle"],
  rating: ["rating", "stars", "star", "score"],
  title: ["title", "headline", "summary"],
  text: ["text", "body", "review", "comment", "review_text"],
  name: ["name", "author", "reviewer", "customer", "author_name"],
  city: ["city", "town", "location", "place"],
  date: ["date", "review_date", "created", "created_at"],
  source: ["source", "from", "platform"],
  sourceUrl: ["source_url", "url", "link", "source_link"],
  photos: ["photos", "photo", "photo_urls", "images", "image_urls"],
} as const;
type Column = keyof typeof REVIEW_CSV_COLUMNS;

export const REVIEW_CSV_TEMPLATE =
  "sku,rating,title,text,name,city,date,source,source_url,photos\n" +
  'SAREE-001,5,Lovely colour,"Soft cotton, colour same as the photo.",Priya Sharma,Madurai,2026-03-14,in_store,,\n' +
  "SAREE-002,4,Good fit,Stitching is neat. Delivery took 4 days.,K. Murugan,Salem,14/02/2026,google,https://maps.app.goo.gl/example,\n";

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Header row → column index per field; `missing` lists required columns not found. */
export function mapHeader(header: string[]): { index: Partial<Record<Column, number>>; missing: Column[] } {
  const index: Partial<Record<Column, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [col, aliases] of Object.entries(REVIEW_CSV_COLUMNS) as [Column, readonly string[]][]) {
      if (index[col] === undefined && aliases.includes(n)) index[col] = i;
    }
  });
  const missing = (["product", "rating", "name"] as const).filter((c) => index[c] === undefined);
  return { index, missing: [...missing] };
}

/** "in_store", "in store", "shop", "imported", "invited", or a platform ("google", "Google reviews", "amazon.in"). */
export function parseSource(raw: string, url: string | null): { source: StaffReviewSource; platform: ReviewPlatform | null } | null {
  const s = norm(raw);
  if (!s) return null;
  if (["in_store", "instore", "store", "shop", "counter", "walk_in"].includes(s)) return { source: "in_store", platform: null };
  if (["invited", "invite", "request", "requested"].includes(s)) return { source: "invited", platform: null };
  const platform = platformOf(s) ?? (s === "imported" || s === "import" ? (url ? platformOf(url) : null) ?? "other" : null);
  return platform ? { source: "imported", platform } : null;
}

/** Platform from a name or a link ("google_reviews", "https://www.amazon.in/…"). */
export function platformOf(s: string): ReviewPlatform | null {
  const v = s.toLowerCase();
  if (/google|goo\.gl|g\.page/.test(v)) return "google";
  if (/amazon|amzn/.test(v)) return "amazon";
  if (/flipkart/.test(v)) return "flipkart";
  if (/meesho/.test(v)) return "meesho";
  if (/instagram|instagr\.am/.test(v)) return "instagram";
  if (v === "other") return "other";
  return null;
}

/** Duplicate key: same product, same shown name, same day, same text (spaces and case ignored). */
export function duplicateKey(productId: string, authorName: string, date: Date, text: string | null): string {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${productId}|${authorName.toLowerCase()}|${istDay(date)}|${t}`;
}

export interface ImportRowValues {
  productId: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string;
  authorCity: string | null;
  date: Date;
  source: StaffReviewSource;
  platform: ReviewPlatform | null;
  sourceUrl: string | null;
  photos: string[];
}

export interface ImportRowResult {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  product: string;
  rating: string;
  name: string;
  errors: string[];
  /** Present when the row can be imported. */
  values?: ImportRowValues;
}

export interface ImportPlan {
  rows: ImportRowResult[];
  /** File-level problem (no header, missing columns, too many rows). */
  error?: string;
  valid: number;
  invalid: number;
}

const cell = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] ?? "").trim());

/**
 * Validates parsed CSV rows. `products` maps a lowercased SKU or slug to the product id; `existing` holds the
 * duplicate keys of reviews already in the shop. Duplicates inside the file are caught too.
 */
export function planImport(table: string[][], ctx: { products: ReadonlyMap<string, string>; existing: ReadonlySet<string>; now: Date }): ImportPlan {
  const [header, ...body] = table;
  if (!header) return { rows: [], error: "The file is empty", valid: 0, invalid: 0 };
  const { index, missing } = mapHeader(header);
  if (missing.length) return { rows: [], error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, valid: 0, invalid: 0 };
  if (body.length === 0) return { rows: [], error: "The file has no review rows", valid: 0, invalid: 0 };
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], error: `At most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} reviews per file (this one has ${body.length.toLocaleString("en-IN")})`, valid: 0, invalid: 0 };
  const seen = new Set<string>();
  const rows = body.map((r, n): ImportRowResult => {
    const errors: string[] = [];
    const product = cell(r, index.product);
    const ratingRaw = cell(r, index.rating);
    const name = cell(r, index.name);
    const productId = product ? ctx.products.get(product.toLowerCase()) : undefined;
    if (!product) errors.push("Product SKU or slug missing");
    else if (!productId) errors.push(`Unknown product "${product}"`);
    const rm = ratingRaw.match(/^([1-5])(?:\.0+)?(?:\s*\/\s*5)?$/);
    const rating = rm ? Number(rm[1]) : NaN;
    if (!rm) errors.push(ratingRaw ? `Rating "${ratingRaw}" must be a whole number from 1 to 5` : "Rating missing");
    if (!name) errors.push("Reviewer name missing");
    else if (name.length > 80) errors.push("Reviewer name is too long");
    const title = cell(r, index.title) || null;
    const text = cell(r, index.text) || null;
    if (title && title.length > 120) errors.push("Title is longer than 120 characters");
    if (text && text.length > 5000) errors.push("Text is longer than 5,000 characters");
    const city = cell(r, index.city) || null;
    if (city && city.length > 60) errors.push("City is too long");
    let date = ctx.now;
    const dateRaw = cell(r, index.date);
    if (dateRaw) {
      const p = parseReviewDate(dateRaw, ctx.now);
      if (p.ok) date = p.date;
      else errors.push(`Date "${dateRaw}": ${DATE_MESSAGES[p.error]}`);
    }
    const urlRaw = cell(r, index.sourceUrl) || null;
    let sourceUrl: string | null = null;
    if (urlRaw) {
      if (photoUrlSchema.safeParse(urlRaw).success) sourceUrl = urlRaw;
      else errors.push("Source link must start with http:// or https://");
    }
    const srcRaw = cell(r, index.source);
    const src = parseSource(srcRaw, sourceUrl);
    if (!src) errors.push(srcRaw ? `Unknown source "${srcRaw}" (use in_store, invited, imported or google, amazon, flipkart, meesho, instagram, other)` : "Source missing (in_store, invited, or the platform it came from)");
    if (src && src.source !== "imported" && sourceUrl) errors.push("Only imported reviews have a source link");
    const photos = [...new Set(cell(r, index.photos).split(/[\s|;]+/).filter(Boolean))];
    if (photos.some((p) => !photoUrlSchema.safeParse(p).success)) errors.push("Photo links must start with http:// or https://");
    if (photos.length > MAX_PHOTOS) errors.push(`At most ${MAX_PHOTOS} photos`);
    const authorName = formatAuthorName(name);
    if (errors.length === 0 && productId) {
      const key = duplicateKey(productId, authorName, date, text);
      if (ctx.existing.has(key)) errors.push("Already in your reviews (same name, date and text)");
      else if (seen.has(key)) errors.push("Repeats an earlier row (same name, date and text)");
      seen.add(key);
    }
    const base = { line: n + 2, product, rating: ratingRaw, name, errors };
    if (errors.length || !productId || !src) return base;
    return {
      ...base,
      values: { productId, rating, title, body: text, authorName, authorCity: city, date, source: src.source, platform: src.platform, sourceUrl, photos },
    };
  });
  const valid = rows.filter((r) => r.values).length;
  return { rows, valid, invalid: rows.length - valid };
}

/** `POST /v1/reviews/import` body. */
export const importInputSchema = z.object({
  csv: z.string().min(1, "Choose a CSV file").max(MAX_IMPORT_BYTES, "The file is too large (4 MB at most)"),
  /** Check only (the default): nothing is saved. */
  dryRun: z.boolean().default(true),
  /** Moderation state of the imported reviews. */
  status: z.enum(STAFF_REVIEW_STATUSES).default("approved"),
});
export type ImportInput = z.input<typeof importInputSchema>;
