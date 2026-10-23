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
    /** The shop's trade (@srirealtime/verticals pack id). Older APIs leave it out. */
    businessType?: string;
    /** Theme variants (header, hero, card, imageRatio, … see StoreThemeView). */
    theme?: Record<string, string>;
    /** Font families the shop's CSS uses (loaded from Google Fonts). */
    fonts?: string[];
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

/** The booking side of a service item (catalogue `service`). */
export interface ServiceInfo {
  /** Bookings service id (`/book?service=<id>`); null when the item isn't an appointment service. */
  serviceId: string | null;
  durationMin: number | null;
  /** Can be booked online now; false = enquire (WhatsApp / call). */
  bookable: boolean;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  /** Extra photos when the API sends them (cards cross-fade to the second one on hover). */
  images?: string[] | null;
  /** When the product was added (cards show "New" for a few weeks). Older APIs leave it out. */
  createdAt?: string;
  /** Variant ids, for the cards' stock badges (one availability call per grid). Older APIs leave it out. */
  variantIds?: string[];
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  variantCount: number;
  taxInclusive: boolean;
  /** "service" for things the shop does (bookable or by enquiry); older APIs leave it out (= product). */
  kind?: "product" | "service";
  service?: ServiceInfo | null;
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
  /** Marketplace seller owning the product (null = the shop's own). */
  vendorId?: string | null;
  priceMin: number;
  priceMax: number;
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
  /** "service": shown with "Book now" / "Enquire" instead of the cart (older APIs leave it out = product). */
  kind?: "product" | "service";
  service?: ServiceInfo | null;
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
  /** Staff-entered reviews may name the reviewer's town. */
  authorCity?: string | null;
  /** "customer" (written on this store) or where the shop got it: "in_store", "imported" (+ platform), "invited". */
  source?: "customer" | "in_store" | "imported" | "invited";
  sourcePlatform?: "google" | "amazon" | "flipkart" | "meesho" | "instagram" | "other" | null;
  sourceUrl?: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  /** Only a delivered order of the product makes a review verified (shopper's own, or linked by the shop). */
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

/** `GET /reviews/public/summary`: the whole shop's rating and its latest approved reviews. */
export interface ShopReviewSummary extends ReviewSummary {
  items: Review[];
}

// ------------------------------------------------------------------ recommendations

/** `GET /catalog/public/recommendations`. `source` = "orders" when paid orders shaped the list. */
export interface Recommendations {
  kind: "product" | "cart" | "home" | "bestsellers" | "sale";
  items: ProductSummary[];
  /** kind=product: bought in the same orders (empty while the shop has no order history). */
  boughtTogether: ProductSummary[];
  source: "orders" | "catalogue";
}

// ------------------------------------------------------------------ cms

export interface Cta {
  label: string;
  href: string;
}

/** A home section's optional look (cms `sectionStyleSchema`); anything left out = the theme's default. */
export interface SectionStyle {
  background?: "none" | "brand" | "muted" | "dark" | "image" | "gradient";
  imageUrl?: string;
  /** Darkening over a background image, 0–90 %. */
  overlay?: number;
  padding?: "compact" | "normal" | "spacious";
  width?: "contained" | "full";
  align?: "start" | "center";
  animation?: "none" | "fade" | "rise";
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
}

type CategoryRef = { id: string; name: string; slug: string; image: string | null };
export type Diet = "veg" | "nonveg" | "egg";

type Sections =
  | { type: "hero"; slides: { imageUrl: string | null; mobileImageUrl?: string; heading?: string; subheading?: string; cta?: Cta }[] }
  | {
      type: "categories";
      title: string;
      /** Older APIs leave these out (= circles, no counts). */
      layout?: CategoryLayout;
      showCounts?: boolean;
      /** Tiles per row on desktop (grid layouts, slider); omitted = auto. */
      columns?: CategoryColumns;
      categories: CategoryRef[];
    }
  | { type: "collection"; title: string; layout: "carousel" | "grid"; collection: { name: string; slug: string }; products: ProductSummary[] }
  | { type: "products"; title: string; href?: string; products: ProductSummary[] }
  | { type: "banner"; imageUrl: string; mobileImageUrl?: string; href?: string; alt: string }
  | { type: "text"; heading?: string; markdown: string }
  | { type: "image-text"; imageUrl: string; heading: string; markdown: string; cta?: Cta; imageSide: "left" | "right" }
  | {
      type: "testimonials";
      title?: string;
      /** Older APIs leave it out (= carousel). */
      layout?: "carousel" | "cards" | "single";
      items: { quote: string; name: string; role?: string; rating?: number; photoUrl?: string }[];
    }
  | { type: "usp"; title?: string; text?: string; layout?: "cards" | "inline" | "centered" | "split"; items: { icon: string; title: string; text: string }[] }
  | { type: "newsletter"; heading: string; text: string; layout?: "band" | "split" | "card" | "inline"; imageUrl?: string }
  | { type: "hero-split"; imageUrl: string | null; imageSide: "left" | "right"; eyebrow?: string; heading: string; text?: string; cta?: Cta; cta2?: Cta }
  | { type: "hero-video"; videoUrl: string; posterUrl?: string; overlay: number; heading: string; text?: string; cta?: Cta }
  | { type: "offer"; eyebrow?: string; heading: string; text?: string; code?: string; endsAt?: string; cta?: Cta }
  | { type: "gallery"; title?: string; layout: "grid" | "masonry" | "carousel"; images: { url: string; alt: string; caption?: string; href?: string }[] }
  | { type: "logos"; title?: string; grayscale: boolean; items: { imageUrl?: string | null; name: string; href?: string }[] }
  | { type: "category-mosaic"; title: string; categories: CategoryRef[] }
  | { type: "faq"; title?: string; items: { q: string; a: string }[] }
  | { type: "location"; title?: string; address?: string; hours: { label: string; value: string }[]; phone?: string; whatsapp?: string; coords?: string; mapLink?: string }
  | { type: "menu-board"; title?: string; groups: { name: string; items: { name: string; description?: string; price?: number; diet?: Diet }[] }[]; cta?: Cta }
  | { type: "appointment"; heading: string; text?: string; services: { name: string; duration?: string; price?: number }[]; cta?: Cta }
  | { type: "before-after"; title?: string; text?: string; beforeUrl: string; afterUrl: string; beforeLabel?: string; afterLabel?: string }
  | { type: "gold-rates"; title?: string; text?: string; showSilver: boolean }
  | { type: "instagram"; title?: string; handle: string; images: { url: string; alt: string; href?: string }[] }
  | { type: "product-tabs"; title: string; layout: ShelfLayout; limit: number; tabs: { label?: string; source: ProductTabSource; collectionSlug?: string }[] }
  | { type: "deal"; title?: string; text?: string; endsAt?: string; product: ProductSummary }
  | { type: "shop-the-look"; title?: string; text?: string; imageUrl: string; alt: string; hotspots: { x: number; y: number; product: ProductSummary }[] }
  | { type: "bestsellers"; title: string; layout: ShelfLayout; limit: number }
  | { type: "recently-viewed"; title?: string }
  | { type: "recommended"; title: string; layout: ShelfLayout; limit: number }
  | { type: "stats"; title?: string; text?: string; items: { value: number; prefix?: string; suffix?: string; label: string }[] }
  | { type: "timeline"; title?: string; text?: string; items: { when: string; title: string; text: string; imageUrl?: string }[] }
  | {
      type: "team";
      title?: string;
      text?: string;
      members: { name: string; role?: string; photoUrl?: string; bio?: string; instagram?: string; facebook?: string; linkedin?: string; website?: string }[];
    }
  | {
      type: "pricing-table";
      title?: string;
      text?: string;
      plans: { name: string; price?: number; period?: string; description?: string; features: string[]; highlight: boolean; badge?: string; cta?: Cta }[];
    }
  | { type: "blog-posts"; title?: string; limit: number; tag?: string }
  | { type: "reviews-summary"; title?: string; limit: number };

export type CategoryLayout =
  | "circles"
  | "cards"
  | "slider"
  | "icon-list"
  | "big-grid"
  | "rounded-squares"
  | "story-rings"
  | "pills"
  | "tiles"
  | "banner-row"
  | "bento"
  | "minimal-list";
export type CategoryColumns = "auto" | "3" | "4" | "5" | "6";
export type ShelfLayout = "grid" | "carousel";
export type ProductTabSource = "new" | "bestsellers" | "sale" | "collection";

export type HomeSection = Sections & { id?: string; style?: SectionStyle };
export type HomeSectionOf<T extends HomeSection["type"]> = Extract<Sections, { type: T }> & { id?: string; style?: SectionStyle };

/** `GET /jewellery/public/rates`: today's rate board (paise per gram). */
export interface PublicMetalRates {
  date: string | null;
  setToday: boolean;
  rates: { metal: "gold" | "silver" | "platinum"; purity: string; ratePerGram: number; date: string | null }[];
}

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
  /** Paise off this line by automatic offers (as charged). */
  offerDiscount?: number;
  /** Ids of `PricedCart.offers` behind `offerDiscount`. */
  offerIds?: string[];
}

// ------------------------------------------------------------------ automatic offers and bundles

export type OfferKind = "bxgy" | "tiered" | "free_gift" | "bundle";

/** Kind-specific numbers (paise for money), as the API stores them. */
export type OfferConfig =
  | { buyQty: number; getQty: number; getPercent: number; maxApplications?: number | null }
  | { basis: "qty" | "amount"; tiers: { min: number; type: "percent" | "flat"; value: number }[] }
  | { minAmount: number; giftProductId: string; giftVariantId: string; giftQty: number }
  | { items: { productId: string; variantId: string | null; qty: number }[]; priceType: "fixed" | "percent"; value: number };

/** An offer badge on a product page (GET /store/promotions). */
export interface OfferBadge {
  id: string;
  kind: OfferKind | string;
  name: string;
  /** English fallback ("Buy 2 get 1 free"). */
  label: string;
  description: string | null;
  config: OfferConfig | Record<string, unknown>;
  endsAt: string | null;
}

export interface CartOffer {
  id: string;
  kind: OfferKind | string;
  name: string;
  label: string;
  discount: number;
  applications: number;
}

export type OfferReward =
  | { type: "units"; qty: number; percent: number }
  | { type: "percent"; value: number }
  | { type: "flat"; value: number }
  | { type: "gift"; productId: string; variantId: string; qty: number }
  | { type: "bundle" };

export interface CartProductRef {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  price: number;
  /** One-tap add (single variant), else null. */
  variantId: string | null;
}

export interface CartNudge {
  offerId: string;
  kind: OfferKind | string;
  name: string;
  label: string;
  addQty?: number;
  addAmount?: number;
  reward: OfferReward;
  /** "all" = anything in the shop counts towards it. */
  scope?: string;
  productIds?: string[];
  products?: CartProductRef[];
}

export interface CartGift {
  offerId: string;
  name: string;
  productId: string;
  variantId: string;
  qty: number;
  unlocked: boolean;
  inCart: boolean;
  remaining: number;
  product?: CartProductRef | null;
}

export interface CartFreeShipping {
  threshold: number | null;
  remaining: number;
  unlocked: boolean;
  scope: "zone" | "shop";
}

export interface BundleItem {
  productId: string;
  variantId: string | null;
  qty: number;
  name: string;
  slug: string;
  image: string | null;
  variantTitle: string;
  price: number;
  options: { variantId: string; title: string; price: number }[];
  /** The product's option names ("Size", "Size / Colour") — labels the pick; "" / missing → generic "Option". */
  optionLabel?: string;
  available: boolean;
}

/** A combo (GET /store/bundles, /store/promotions). */
export interface BundleView {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  label: string;
  priceType: "fixed" | "percent";
  value: number;
  endsAt: string | null;
  items: BundleItem[];
  regular: number;
  price: number;
  save: number;
  available: boolean;
}

export interface Promotions {
  offers: OfferBadge[];
  bundles: BundleView[];
}

export interface PricedCart {
  token: string;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  /** Coupon discount (offers are in `offerDiscount`). */
  discount: number;
  coupon: { code: string; valid: boolean; reason?: string; freeShipping: boolean } | null;
  /** Automatic offers' discount (older APIs: absent). */
  offerDiscount?: number;
  offers?: CartOffer[];
  nudges?: CartNudge[];
  gifts?: CartGift[];
  freeShipping?: CartFreeShipping | null;
  pincode: string | null;
  delivery: DeliveryQuote | null;
  /** subtotal − offers − coupon. */
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
  /** Loyalty points redeemed on the order (pre-tax discount); absent when none. */
  loyalty?: { points: number; discount: number };
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
  totals: { subtotal: number; discount: number; shipping: number; codFee: number; total: number; loyalty?: { points: number; discount: number } };
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
  /** The shop's WhatsApp number or link (services' "Enquire on WhatsApp"). */
  whatsapp?: string | null;
  /** Initial cart token from the `sr_cart` cookie. */
  cartToken: string | null;
  /** Item count rendered on the server (so the badge doesn't flash). */
  cartCount: number;
  /** Feature keys on for this shop (GET /v1/features `enabled`); empty when the call failed. */
  features: string[];
  /** The shop's trade (pack id): wording, size guide. */
  businessType: string;
  /** Theme variants (see StoreConfig.shop.theme), with defaults filled in. */
  theme: StoreThemeView;
}

/** The storefront's theme variants (mirrors @srirealtime/branding StoreTheme). */
export interface StoreThemeView {
  header: "classic" | "centered" | "minimal" | "bold" | "split";
  hero: "slider" | "split" | "full" | "compact";
  card: "standard" | "minimal" | "framed" | "overlay" | "boxed" | "editorial";
  imageRatio: "portrait" | "square" | "landscape";
  buttons: "rounded" | "pill" | "square";
  density: "comfortable" | "compact";
  sections: "plain" | "tinted" | "boxed";
  motif: "none" | "kolam" | "dots" | "waves" | "grid";
  headings: "display" | "uppercase" | "underline";
  headerStyle: "glass" | "solid" | "transparent";
  sticky: "always" | "scroll-up" | "never";
  megaMenu: "images" | "columns" | "off";
  announcement: "dismissible" | "bar" | "ticker";
  footer: "columns" | "centered" | "newsletter" | "minimal";
  cardHover: "rich" | "zoom" | "swap" | "lift" | "none";
  cardButton: "hover" | "always" | "none";
  productLayout: "thumbs-side" | "thumbs-below" | "grid" | "slider";
  productDetails: "accordion" | "tabs" | "open";
  stickyBuy: "on" | "off";
  productTrust: "on" | "off";
  related: "rail" | "grid" | "off";
  listingFilters: "sidebar" | "top-bar" | "drawer";
  listingColumns: "2" | "3" | "4" | "5";
  listingView: "grid" | "list";
  listingPaging: "pages" | "load-more" | "infinite";
  categoryHeader: "simple" | "banner" | "none";
  subcategories: "chips" | "off";
  compare: "on" | "off";
}

// ------------------------------------------------------------------ batch 4: chat, help centre, sellers, loyalty

export interface ChatAttachment {
  url: string;
  type: "image" | "file";
  name?: string;
  mime?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: ChatAttachment[];
  replyTo: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** `<ms>_<id>` order key; the SSE event id. */
  cursor: string;
  /** Client-only: sending / failed optimistic message. */
  pending?: "sending" | "failed";
}

export interface ChatParticipant {
  userId: string;
  kind: "staff" | "shopper" | "vendor";
  name: string | null;
  lastReadAt: string | null;
  joinedAt: string;
}

export interface ChatConversation {
  id: string;
  type: "direct" | "support" | "order" | "group";
  subjectType: string | null;
  subjectId: string | null;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdBy: string;
  createdAt: string;
  joined: boolean;
  muted: boolean;
  lastReadAt: string | null;
  unread: number;
  participants: ChatParticipant[];
}

export interface ChatConversationList extends List<ChatConversation> {
  unreadTotal: number;
}

export interface ChatMessagePage {
  items: ChatMessage[];
  nextCursor: string | null;
}

/** What a page hands the chat widget when it opens it ("Chat about this order"). */
export interface ChatOrderContext {
  /** Order uuid (account order detail) → an order conversation; without it a support chat mentioning the number. */
  id?: string;
  number: string;
  status?: string;
  total?: number;
  image?: string | null;
  itemCount?: number;
}

export interface FaqCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort: number;
}

export interface FaqArticleSummary {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  excerpt: string;
}

export interface FaqGroup {
  category: FaqCategory | null;
  articles: FaqArticleSummary[];
}

export interface FaqArticle {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  body: string;
  helpfulYes: number;
  helpfulNo: number;
  sort: number;
  seo: { title?: string; description?: string; noindex?: boolean } | null;
  publishedAt: string | null;
  updatedAt: string;
}

export type TicketStatus = "open" | "pending" | "resolved" | "closed";

export interface PublicTicket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  channel: string;
  related: { type: "order" | "invoice"; id: string } | null;
  mergedInto: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicTicketMessage {
  id: string;
  from: "requester" | "staff";
  body: string;
  attachments: string[];
  createdAt: string;
}

export interface PublicThread {
  ticket: PublicTicket;
  items: PublicTicketMessage[];
}

export interface SellerCard {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface SellerLookup {
  items: SellerCard[];
  products: Record<string, string>;
}

export interface SellerProduct {
  id: string;
  name: string;
  slug: string;
  status: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
}

export interface SellerPage extends SellerCard {
  description: string | null;
  productCount: number | null;
  products: List<SellerProduct>;
}

export interface LoyaltyTier {
  name: string;
  minSpend: number;
  multiplier: number;
}

export interface LoyaltyMember {
  id: string;
  memberKey: string;
  name: string | null;
  pointsBalance: number;
  pointsValue: number;
  lifetimeSpend: number;
  tier: string;
  joinedAt: string;
  lastActivityAt: string | null;
}

export interface LoyaltyEntry {
  id: string;
  type: "earn" | "redeem" | "expire" | "adjust" | "reverse";
  points: number;
  amountPaise: number;
  remaining: number;
  refType: "invoice" | "order" | "manual" | "lot";
  refId: string;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface LoyaltyMe {
  enrolled: boolean;
  member: LoyaltyMember | null;
  pointValuePaise: number;
  nextTier: { tier: LoyaltyTier; spendNeeded: number } | null;
  expiringSoon: { expiresAt: string; points: number }[];
  history: LoyaltyEntry[];
}

export type RedeemReason = "no_points" | "below_min" | "order_too_small" | "disabled";

export interface LoyaltyQuote {
  balance: number;
  maxPoints: number;
  maxDiscount: number;
  minRedeemPoints: number;
  pointValuePaise: number;
  canRedeem: boolean;
  reason: RedeemReason | null;
  member: LoyaltyMember | null;
  earnPreview: number;
}
