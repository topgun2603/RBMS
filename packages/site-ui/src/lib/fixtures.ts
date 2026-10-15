/** Test fixtures: one valid example of every home section, block and a two-level menu (schema input shape). */
import type { BlockInput, HomeSectionInput, MenuItemInput } from "./content";

const P1 = "0b6f5f36-0000-4000-8000-000000000001";
const P2 = "0b6f5f36-0000-4000-8000-000000000002";
const C1 = "0b6f5f36-0000-4000-8000-0000000000c1";
const C2 = "0b6f5f36-0000-4000-8000-0000000000c2";

export const IDS = { P1, P2, C1, C2 };

export const SECTION_FIXTURES: HomeSectionInput[] = [
  {
    type: "hero",
    id: "s-hero",
    slides: [
      {
        imageUrl: "https://cdn.example.in/hero.jpg",
        mobileImageUrl: "https://cdn.example.in/hero-m.jpg",
        heading: "Festive kurtis",
        subheading: "Handpicked in Trichy",
        cta: { label: "Shop now", href: "/collections/new-arrivals" },
      },
      { imageUrl: "/uploads/second.jpg" },
    ],
  },
  { type: "categories", title: "Shop by category" },
  { type: "categories", id: "s-cats", title: "Picked", categoryIds: [C2, C1] },
  { type: "collection", title: "New arrivals", collectionSlug: "new-arrivals", layout: "grid", limit: 8 },
  { type: "products", title: "Favourites", productIds: [P2, P1] },
  { type: "banner", imageUrl: "https://cdn.example.in/sale.jpg", mobileImageUrl: "https://cdn.example.in/sale-m.jpg", href: "/c/sarees", alt: "Diwali sale" },
  { type: "banner", imageUrl: "https://cdn.example.in/plain.jpg", alt: "" },
  { type: "text", heading: "About us", markdown: "We are a **family** shop.\n\n- Quality\n- Care" },
  { type: "text", markdown: "Only text" },
  {
    type: "image-text",
    imageUrl: "https://cdn.example.in/story.jpg",
    heading: "Our story",
    markdown: "Since 1998",
    cta: { label: "Call us", href: "tel:+919876543210" },
    imageSide: "right",
  },
  { type: "image-text", imageUrl: "https://cdn.example.in/story.jpg", heading: "Plain", markdown: "", imageSide: "left" },
  { type: "testimonials", title: "Happy customers", items: [{ quote: "Lovely!", name: "Priya, Madurai" }] },
  { type: "testimonials", items: [{ quote: "Fast delivery", name: "Lakshmi" }, { quote: "Great", name: "Anu" }] },
  {
    type: "usp",
    items: [
      { icon: "truck", title: "Free shipping", text: "Above ₹999" },
      { icon: "free-shipping", title: "Legacy key", text: "" },
    ],
  },
  { type: "newsletter", heading: "Get offers", text: "Once a week" },
];

export const BLOCK_FIXTURES: BlockInput[] = [
  { type: "heading", level: 2, text: "Hello" },
  { type: "heading", id: "b-h3", level: 3, text: "Small" },
  { type: "paragraph", markdown: "Some **bold** text" },
  { type: "image", url: "https://cdn.example.in/a.jpg", alt: "A saree", caption: "Kanchipuram" },
  { type: "image", url: "https://cdn.example.in/b.jpg", alt: "" },
  { type: "gallery", images: [{ url: "https://cdn.example.in/1.jpg", alt: "One" }, { url: "https://cdn.example.in/2.jpg", alt: "", caption: "Two" }] },
  { type: "button", label: "Shop", href: "/products", style: "secondary" },
  { type: "faq", items: [{ q: "Do you ship abroad?", a: "Not yet." }] },
  { type: "video", youtubeId: "dQw4w9WgXcQ", title: "Our weavers" },
  { type: "video", youtubeId: "dQw4w9WgXcQ" },
  { type: "divider" },
];

export const MENU_FIXTURE: MenuItemInput[] = [
  { label: "Home", type: "url", href: "/" },
  {
    label: "Shop",
    type: "url",
    children: [
      { label: "Sarees", type: "category", ref: "sarees" },
      { label: "New", type: "collection", ref: "new-arrivals" },
    ],
  },
  { label: "About", type: "page", ref: "about" },
  { label: "Blog post", type: "post", ref: "pongal-guide" },
];
