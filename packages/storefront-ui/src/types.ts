/**
 * Shapes of the public / shopper API the store reads (docs/commerce-batch2.md). Mirrors the server packages without
 * importing them (they carry Fastify/Drizzle). Money is integer paise; dates arrive as ISO strings.
 */

export interface List<T> {
  items: T[];
  total: number;
}

// ------------------------------------------------------------------ shop

export interface StoreConfig {
  shop: {
    name: string;
    logoUrl: string | null;
    css: string;
    contactPhone: string;
    contactEmail: string;
    social: { instagram?: string; facebook?: string; youtube?: string; whatsapp?: string };
  };
  open: boolean;
  closedMessage: string;
  codEnabled: boolean;
  codMaxAmount: number;
  minOrderValue: number;
  guestCheckout: false;
  policies: { shipping?: string; returns?: string; privacy?: string; terms?: string };
}

export interface Branding {
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  tokens?: { colors?: { primary?: string } };
  css: string;
}

export interface MenuItem {
  label: string;
  type: string;
  href: string | null;
  children?: MenuItem[];
}

export interface Menus {
  header: MenuItem[];
  footer: MenuItem[];
}

// ------------------------------------------------------------------ catalogue

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  /** Extra photos when the API sends them (cards cross-fade to the second one on hover). */
  images?: string[] | null;
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  variantCount: number;
  taxInclusive: boolean;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sort: number;
  seo: Seo | null;
}

export interface Seo {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  noindex?: boolean | null;
}

export interface Variant {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  optionValues: Record<string, string>;
  price: number;
  mrp: number | null;
  weightGrams: number | null;
  position: number;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  hsn: string | null;
  gstRate: number;
  unit: string;
  taxInclusive: boolean;
  tags: string[];
  attributes: Record<string, string>;
  options: { name: string; values: string[] }[];
  images: { url: string; alt?: string }[];
  seo: Seo | null;
  priceMin: number;
  priceMax: number;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}

export interface Facets {
  categories: { id: string; name: string; count: number }[];
  price: { min: number; max: number };
  attributes: Record<string, { value: string; count: number }[]>;
  options: Record<string, { value: string; count: number }[]>;
}

export interface SearchResult extends List<ProductSummary> {
  facets: Facets;
}

export interface Suggestions {
  products: { name: string; slug: string; image: string | null; priceMin: number }[];
  categories: { name: string; slug: string }[];
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  type: "manual" | "rule";
  seo: Seo | null;
}

export interface CollectionPage extends List<ProductSummary> {
  collection: Collection;
}

export interface Availability {
  itemId: string;
  inStock: boolean;
  lowStock: boolean;
}

// ------------------------------------------------------------------ reviews

export interface Review {
  id: string;
  productId: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  verified: boolean;
  helpfulCount: number;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  status?: string;
}

export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<string, number>;
}

export interface ReviewList extends List<Review> {
  summary: ReviewSummary;
}

export interface Rating {
  productId: string;
  average: number;
  count: number;
}

// ------------------------------------------------------------------ cms

export interface Cta {
  label: string;
  href: string;
}

export type HomeSection =
  | { type: "hero"; id?: string; slides: { imageUrl: string | null; mobileImageUrl?: string; heading?: string; subheading?: string; cta?: Cta }[] }
  | { type: "categories"; id?: string; title: string; categories: { id: string; name: string; slug: string; image: string | null }[] }
  | { type: "collection"; id?: string; title: string; layout: "carousel" | "grid"; collection: { name: string; slug: string }; products: ProductSummary[] }
  | { type: "products"; id?: string; title: string; href?: string; products: ProductSummary[] }
  | { type: "banner"; id?: string; imageUrl: string; mobileImageUrl?: string; href?: string; alt: string }
  | { type: "text"; id?: string; heading?: string; markdown: string }
  | { type: "image-text"; id?: string; imageUrl: string; heading: string; markdown: string; cta?: Cta; imageSide: "left" | "right" }
  | { type: "testimonials"; id?: string; title?: string; items: { quote: string; name: string }[] }
  | { type: "usp"; id?: string; items: { icon: string; title: string; text: string }[] }
  | { type: "newsletter"; id?: string; heading: string; text: string };

export interface PublicHome {
  sections: HomeSection[];
  seo: Seo | null;
  isDefault: boolean;
  publishedAt: string | null;
}

export type Block =
  | { type: "heading"; id?: string; level: 2 | 3; text: string }
  | { type: "paragraph"; id?: string; markdown: string }
  | { type: "image"; id?: string; url: string; alt: string; caption?: string }
  | { type: "gallery"; id?: string; images: { url: string; alt: string; caption?: string }[] }
  | { type: "button"; id?: string; label: string; href: string; style: "primary" | "secondary" }
  | { type: "faq"; id?: string; items: { q: string; a: string }[] }
  | { type: "video"; id?: string; youtubeId: string; title?: string }
  | { type: "divider"; id?: string };

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
  seo: Seo | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  tags: string[];
  authorName: string | null;
  publishedAt: string | null;
}

export interface Post extends PostSummary {
  blocks: Block[];
  seo: Seo | null;
  updatedAt: string;
}

// ------------------------------------------------------------------ cart + checkout

export interface DeliveryOption {
  id: string;
  name: string;
  amount: number;
  etaDays: [number, number];
  codAllowed: boolean;
  codFee: number;
  /** Paise; shipping is free at or above this subtotal (when the API exposes the rate's threshold). */
  freeAbove?: number | null;
}

export interface DeliveryQuote {
  serviceable: boolean;
  options: DeliveryOption[];
}

export type LineProblem = "unavailable" | "price_changed" | "qty_reduced";

export interface CartLine {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  variantTitle: string;
  image: string | null;
  price: number;
  mrp: number | null;
  qty: number;
  lineTotal: number;
  available: boolean;
  maxQty: number;
  problem?: LineProblem;
}

export interface PricedCart {
  token: string;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  coupon: { code: string; valid: boolean; reason?: string; freeShipping: boolean } | null;
  pincode: string | null;
  delivery: DeliveryQuote | null;
  total: number;
  taxExtra?: number;
  weightGrams?: number;
  warnings: string[];
}

export interface PincodeInfo {
  pincode: string;
  city: string;
  district: string | null;
  state: string;
  stateCode: string;
  approximate?: boolean;
}

export interface CheckoutResult {
  order: { id: string; number: string; total: number; status: string; paymentStatus: string };
  accessToken: string;
  payment: { kind: "order"; ref: string } | null;
}

export interface PaymentCheckout {
  orderId: string;
  provider: "razorpay" | "mock";
  keyId?: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; contact: string; email: string };
}

// ------------------------------------------------------------------ shopper

export interface AuthUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface StoreCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  marketingOptIn: boolean;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  createdAt: string;
}

export interface Me {
  customer: StoreCustomer;
  counts: { orders: number; wishlist: number };
}

export interface Address {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  district: string | null;
  stateCode: string;
  pincode: string;
  isDefault: boolean;
}

export type AddressInput = Omit<Address, "id" | "isDefault">;

export interface WishlistItem {
  productId: string;
  name: string;
  slug: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  available: boolean;
  addedAt: string;
}

export interface OrderSummary {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  total: number;
  placedAt: string;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  shippingWaived?: number;
  codFee?: number;
  roundOff?: number;
  total: number;
}

export interface Order {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  accessToken: string;
  couponCode: string | null;
  cancelReason: string | null;
  customerNote: string | null;
  shippingAddress: { city: string; pincode: string; stateCode: string; name?: string; line1?: string } | null;
  lines: { variantId: string; productId: string; name: string; image: string | null; qty: number; unit: string; price: number; total: number }[];
  totals: OrderTotals;
  fulfillment: { carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null };
  events: { type: string; fromStatus: string | null; toStatus: string | null; message: string | null; createdAt: string }[];
  placedAt: string;
}

export interface Tracking {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  placedAt: string;
  timeline: { type: string; status: string | null; message: string | null; at: string }[];
  lines: { name: string; image: string | null; qty: number; unit: string; price: number; total: number }[];
  totals: { subtotal: number; discount: number; shipping: number; codFee: number; total: number };
  fulfillment: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null };
  shipTo: { city: string; pincode: string } | null;
  cancelReason: string | null;
}

// ------------------------------------------------------------------ store context (server → client)

/** What the server hands every client component through <StoreProvider>. */
export interface StoreShell {
  name: string;
  logoUrl: string | null;
  open: boolean;
  closedMessage: string;
  codEnabled: boolean;
  codMaxAmount: number;
  minOrderValue: number;
  contactPhone: string;
  contactEmail: string;
  /** Initial cart token from the `sr_cart` cookie. */
  cartToken: string | null;
  /** Item count rendered on the server (so the badge doesn't flash). */
  cartCount: number;
}
