import { ALTER, BLOUSES, EMB, FABRIC, FALLS, KIDS, PRODUCTS, SALWAR, SHIRTS, UNI, VISITS } from "./thaiyal-products";
import type { DemoStore } from "./types";

/**
 * Thaiyal Tailors & Boutique, West Masi Street, Madurai (thaiyal.localhost:3003; admin and counter thaiyal.localhost:3008).
 * Store #20: the services app (SV) with the `tailoring` trade and the "madder-thread" look (theme-presets-thaiyal.ts):
 * a family tailoring shop that stitches blouses (simple, princess cut, designer, bridal with aari work), salwars and
 * churidars, kids' pavadai and frocks, men's shirts and pants, school uniforms in bulk, does alterations, falls and
 * pico, and hand embroidery. Garment job cards (measurements, trial date, advance, bill on delivery, tracking at
 * /job/<code>) and fitting appointments run on the services engines. Page layout: sidebar + phone tabs (only Porunai
 * shares it). Home: finder (garment, style, occasion) -> categories -> "your blouse in 5 steps" timeline -> shop the
 * look -> uniform pricing table -> team -> measurement appointment, with a festival deadline offer on top. Names are
 * generic, no brands. Address, phone, GSTIN are demo placeholders.
 *
 * GST (checked 23 Oct 2026):
 * - Stitching, alterations, falls and pico, embroidery and aari / maggam work done on the customer's own cloth are
 *   job work on textile and textile products (Chapter 50-63 goods), SAC 998821 "textile manufacturing services" under
 *   heading 9988 (manufacturing services on physical inputs owned by others): 5% (2.5% CGST + 2.5% SGST), the textile
 *   job work entry of notification 11/2017-Central Tax (Rate), item 26 (id) onwards, unchanged by the 22 Sept 2025
 *   rate rationalisation (CGST notification 9/2025-Central Tax (Rate)). Sources: https://taxguru.in/goods-and-service-tax/job-work-gst-rates-differently-decoded.html
 *   and https://busy.in/sac-code-998821/ (the latter lists 18% as the standard rate for the SAC; the 5% is the specific
 *   concession for textile job work).
 * - Cloth, lining and thread sold from the shelf are goods at 5%: cotton 5208 / 5209, silk and silk-cotton 5007, sewing
 *   and embroidery thread 5401. Where the shop supplies the cloth as well, the garment is a supply of goods (apparel
 *   price bands, docs/verticals.md): the demo sells stitching and cloth separately to keep the bills simple.
 * Uncertain, check before invoicing for real: whether a stitch-only order for a registered business (a school) is
 * covered by the 5% job-work entry when the school supplies the cloth (yes under the entry; if the shop supplies it
 * too it is a composite supply of goods); the thread HSN (5401 vs 5508 for staple fibre).
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500068";
const WHATSAPP = "919876500068";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const HOURS = [
  { label: "Mon – Sat", value: "9:30 am – 8:30 pm" },
  { label: "Sunday", value: "10:00 am – 2:00 pm (all day till Deepavali)" },
];
const HOURS_TA = [
  { label: "திங்கள் – சனி", value: "காலை 9:30 – இரவு 8:30" },
  { label: "ஞாயிறு", value: "காலை 10:00 – மதியம் 2:00 (தீபாவளி வரை நாள் முழுதும்)" },
];

const FAQ = [
  { q: "How early should I order for a function or Deepavali?", a: "A simple blouse takes **3 days**, a designer one **6**, a bridal blouse with aari work **3 to 4 weeks**. For Deepavali (8 November 2026) we stop taking new stitching orders on **31 October**; alterations, falls and pico are taken until 5 November. Come early: the last week is a queue." },
  { q: "What if it doesn't fit?", a: "Every garment has a **free trial** (blouses, pavadai, suits) and a **free first alteration within 7 days** of delivery. We leave inside margins, so a blouse can be let out an inch later. If we cut it wrongly, we re-stitch it free." },
  { q: "Do I bring the fabric?", a: "Yes, or buy it from our fabric shelf (cotton, silk-cotton, lining, uniform cloth, 5% GST). Tell us the garment and we tell you the length: a blouse takes 1 metre, a churidar set 4.5 metres, an anarkali 3 to 5." },
  { q: "How do I follow my order?", a: "Open **Track my order** and type the job number on your slip (JC-0123) and the last 4 digits of your phone. You see the cutting, stitching, trial and ready dates, and we message you when it is ready." },
  { q: "Can you stitch school uniforms for a whole school?", a: "Yes. We stitch from 10 sets to 1,000+, by size slab, with a size list and one free alteration round. Registered schools get a **GST bill with 30 days' credit** and part-payments. Ask for a quote on WhatsApp with the strength and the cloth." },
  { q: "Do you come home for measurements?", a: "Yes, within Madurai city (₹199, adjusted in the stitching bill) for brides, the elderly and families ordering for several people. We also pick up and return your fabric for ₹80." },
];
const FAQ_TA = [
  { q: "விழாவுக்கு அல்லது தீபாவளிக்கு எவ்வளவு முன்பே ஆர்டர் செய்ய வேண்டும்?", a: "எளிய பிளவுஸ் **3 நாள்**, டிசைனர் **6 நாள்**, ஆரி வேலை உள்ள மணமகள் பிளவுஸ் **3 முதல் 4 வாரம்**. தீபாவளிக்கு (8 நவம்பர் 2026) புதிய தையல் ஆர்டர்களை **31 அக்டோபருடன்** நிறுத்துவோம்; மாற்றம், ஃபால், பிகோ 5 நவம்பர் வரை. சீக்கிரம் வாருங்கள்: கடைசி வாரம் வரிசை நீளும்." },
  { q: "அளவு சரியில்லாவிட்டால்?", a: "ஒவ்வொரு உடைக்கும் **இலவச ட்ரயல்** (பிளவுஸ், பாவாடை, சூட்) உண்டு; டெலிவரிக்குப் பின் **7 நாளுக்குள் முதல் மாற்றம் இலவசம்**. உள்ளே மார்ஜின் விடுவதால் பிளவுஸை பின்னர் ஒரு அங்குலம் விரிக்கலாம். நாங்கள் தவறாக வெட்டினால் இலவசமாக மீண்டும் தைப்போம்." },
  { q: "துணியை நான் கொண்டு வர வேண்டுமா?", a: "ஆம்; அல்லது எங்கள் துணி அலமாரியில் வாங்கலாம் (காட்டன், சில்க்-காட்டன், லைனிங், சீருடைத் துணி, 5% GST). உடையைச் சொல்லுங்கள், நீளத்தைச் சொல்வோம்: பிளவுஸுக்கு 1 மீட்டர், சுடிதார் செட்டுக்கு 4.5 மீட்டர், அனார்கலிக்கு 3 முதல் 5." },
  { q: "என் ஆர்டரை எப்படிப் பின்தொடர்வது?", a: "**என் ஆர்டரைக் கண்காணி** பக்கத்தில் சீட்டில் உள்ள வேலை எண்ணையும் (JC-0123) உங்கள் போனின் கடைசி 4 இலக்கங்களையும் இடுங்கள். வெட்டுதல், தையல், ட்ரயல், தயார் தேதிகளைப் பார்க்கலாம்; தயாரானதும் செய்தி அனுப்புவோம்." },
  { q: "முழுப் பள்ளிக்கும் சீருடை தைப்பீர்களா?", a: "ஆம். 10 செட் முதல் 1,000+ வரை, அளவு வரிசைப்படி, அளவுப் பட்டியலுடன், ஒரு இலவச மாற்றச் சுற்றுடன். பதிவு பெற்ற பள்ளிகளுக்கு **GST பில், 30 நாள் கடன்**, பகுதிப் பணம் உண்டு. எண்ணிக்கை, துணியுடன் வாட்ஸ்அப்பில் விலை கேளுங்கள்." },
  { q: "அளவெடுக்க வீட்டுக்கு வருவீர்களா?", a: "ஆம், மதுரை நகருக்குள் (₹199, தையல் பில்லில் கழிக்கப்படும்) மணமகள்கள், முதியவர்கள், பலருக்கு ஆர்டர் செய்யும் குடும்பங்களுக்கு. உங்கள் துணியை எடுத்து வந்து திருப்பித் தருவோம் (₹80)." },
];

const PHOTOS: DemoStore["photos"] = {
  13206031: { by: "Swastik Arora", alt: "A tailor sewing colourful fabric on an industrial sewing machine" },
  9983579: { by: "Дмитрий Пропадалин", alt: "Hands sewing fabric on a sewing machine in warm light" },
  27893063: { by: "HONG SON", alt: "An industrial sewing machine stitching bright red fabric" },
  9496723: { by: "Kuldeep Pimple", alt: "Back view of a woman in a green saree blouse with an ornate hairstyle" },
  37439026: { by: "Akshay Patil", alt: "A bride in a velvet saree blouse with intricate embroidery" },
  38995453: { by: "Prasun Barma", alt: "A woman in a sari with a green lace-up back blouse" },
  31945332: { by: "upender photography", alt: "A woman in a gold embroidered blouse with jewellery" },
  39204039: { by: "AA's Photography", alt: "A woman in a black saree with a cut-out back blouse" },
  9339396: { by: "Muhammad Khawar Nazir", alt: "Hands embroidering a pattern on yellow fabric on a frame" },
  31935139: { by: "Mr Abrar visuals", alt: "An artisan's hand embroidering beads and stones on fabric" },
  36045982: { by: "the Amritdev", alt: "A young girl in a purple tiered frock outdoors" },
  36893900: { by: "aksinfo7 universe", alt: "A young girl in a pink frock outdoors" },
  35745597: { by: "Ahmet Kurt", alt: "Two schoolchildren in white shirts and navy bottoms with books" },
  35107586: { by: "gsregvrd", alt: "Three children in school uniforms outside near greenery" },
  20382095: { by: "Muneeb Malhotra", alt: "A woman in a turquoise salwar kameez with a dupatta" },
  20690511: { by: "Muneeb Malhotra", alt: "A woman in a floral salwar kameez with a red dupatta" },
  20777176: { by: "Muneeb Malhotra", alt: "A woman in an orange kameez with a dupatta" },
  20407198: { by: "Muneeb Malhotra", alt: "A woman in a mint kameez with a dupatta seen from the side" },
  6765649: { by: "Tima Miroshnichenko", alt: "A tailor measuring a young man's chest" },
  6766241: { by: "Tima Miroshnichenko", alt: "A tailor adjusting a jacket sleeve in a studio" },
  4622406: { by: "cottonbro studio", alt: "A person holding a measuring tape in a sewing studio" },
  5504775: { by: "Mike van Schoonderwalt", alt: "Rolled fabrics in many colours" },
  18359545: { by: "Muhammed zeya", alt: "A heap of rolled fabrics in assorted colours" },
  3984876: { by: "Gustavo Fring", alt: "Spools of sewing thread in bright colours" },
  9850069: { by: "Ron Lach", alt: "A sewing machine stitching red fabric" },
  29172765: { by: "Kevin Shervin Mascarenhas", alt: "A woman in a black printed saree seen from behind" },
  36994691: { by: "Michael Takahashi", alt: "A woman in a Kerala saree and a blue blouse walking outdoors" },
  6461121: { by: "Pavel Danilyuk", alt: "A tailor cutting black fabric at a worktable with a sewing machine" },
  4614250: { by: "cottonbro studio", alt: "A sewing machine with a measuring tape hanging over it" },
  3143082: { by: "Marta Longas", alt: "A yellow measuring tape coiled on white" },
  2564890: { by: "Suzy Hazelwood", alt: "Spools of yellow thread and a needle on white" },
  7776107: { by: "Cottonbro studio", alt: "Hands adjusting the thread on a sewing machine" },
};

export const THAIYAL: DemoStore = {
  shop: {
    slug: "thaiyal",
    appId: "SV",
    businessType: "tailoring",
    planId: "pro",
    name: "Thaiyal Tailors & Boutique",
    primary: "#7d2a3f",
    billing: {
      legalName: "Thaiyal Tailors & Boutique",
      gstin: "33AAVFT4826R1Z6",
      address: "27, West Masi Street, near the temple tower",
      city: "Madurai",
      pincode: "625001",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TH",
      upiId: "thaiyal@okaxis",
    },
    // The counter's billing items (kept off the online store).
    items: [
      { name: "Blouse stitching (counter)", hsn: "998821", unit: "service", rate: 38_095, gstRate: 5 },
      { name: "Alteration (counter)", hsn: "998821", unit: "service", rate: 11_429, gstRate: 5 },
      { name: "Saree fall and pico (counter)", hsn: "998821", unit: "service", rate: 11_429, gstRate: 5 },
    ],
  },
  preset: "madder-thread",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 300_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "orders@thaiyal.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/thaiyal.madurai", youtube: "https://youtube.com/@thaiyalmadurai" },
    policies: {
      shipping:
        "**Fabric pickup and delivery** within Madurai city: ₹80 for the round trip, 9 am to 6 pm, Monday to Saturday. **Home measurement visits** within Madurai city: ₹199, adjusted in the stitching bill. Stitched garments are returned by our rider in the city and by courier across Tamil Nadu in 2 to 4 days (₹79).",
      returns:
        "**Fit guarantee:** every garment has a free trial and one free alteration within 7 days of delivery. If we cut or stitch it wrongly we re-stitch it free; if it cannot be made right we refund the stitching. **Fabric** bought from our shelf can be exchanged within 7 days if uncut. Garments stitched to your measurements, with embroidery work started, are not refundable once the work has begun.",
      privacy:
        "We use your name, phone and measurements only to stitch your order, send your GST bill and keep your measurements for next time. We never share them; ask us to delete them any time.",
      terms:
        "Prices include 5% GST (stitching, alterations, embroidery: SAC 998821 textile job work; cloth, lining and thread: goods at 5%). Delivery dates run from the day we have your fabric and measurements. Heavy aari and bridal work need an advance of 30%. Garments not collected within 30 days of the ready message are charged ₹20 a day storage.",
    },
    businessType: "tailoring",
  },
  zones: [
    {
      name: "Madurai",
      pincodePrefixes: ["625"],
      rate: { name: "Our rider (next day)", type: "free_above", amount: 4_000, freeAbove: 99_900, etaMinDays: 1, etaMaxDays: 2, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 7_900, freeAbove: 199_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
  ],
  categories: [
    { name: BLOUSES, description: "Simple, princess cut, designer and bridal blouses, cut to your measurements, with lining, padding, piping and latkans.", photo: 9496723 },
    { name: SALWAR, description: "Churidar sets, salwar kameez, Anarkali dresses, kurtis, bottoms and langa voni, stitched to your measurements.", photo: 20690511 },
    { name: KIDS, description: "Pattu pavadai, party frocks, boys' shirt sets and kurta pyjamas with room to grow.", photo: 36045982 },
    { name: SHIRTS, description: "Men's shirts, pants, kurta sets, waistcoats and suits, with a trial.", photo: 6766241 },
    { name: UNI, description: "School uniforms stitched in bulk by size slab, GST bills and credit for schools.", photo: 35745597 },
    { name: EMB, description: "Aari and maggam hand work, machine embroidery for names and logos.", photo: 9339396 },
    { name: ALTER, description: "Hemming, fit changes, blouse and salwar alterations, many while you wait.", photo: 9983579 },
    { name: FALLS, description: "Saree fall and pico, kuchu tassels, dupatta hems and lace.", photo: 2564890 },
    { name: FABRIC, description: "Blouse cloth, silk-cotton, lining, uniform cloth and aari kits from the shelf.", photo: 5504775 },
    { name: VISITS, description: "Measurement consultations, home measurement visits and fabric pickup.", photo: 3143082 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "All stitching and services", slug: "all-stitching", description: "Every service and fabric, A to Z.", rule: { sort: "name" } },
    { name: "Most booked", slug: "bestsellers", description: "What Madurai orders every week.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Blouse styles", slug: "blouse-styles", description: "Simple, princess cut, designer, bridal and hand-worked blouses.", rule: { tag: "g-blouse", sort: "price-asc" } },
    { name: "Wedding and bridal", slug: "bridal", description: "Bridal blouses, langa voni and the work that goes on them.", rule: { tag: "bridal", sort: "price-desc" } },
    { name: "Ready in two days or less", slug: "rush", description: "Quick stitching and while-you-wait alterations for the last-week rush.", rule: { tag: "rush", sort: "price-asc" } },
    { name: "School uniforms in bulk", slug: "uniforms", description: "Per-set prices by order size, GST bills and credit for schools.", rule: { tag: "bulk", sort: "price-asc" } },
    { name: "Alterations and finishing", slug: "alterations", description: "Hemming, fit changes, falls, pico and hems.", rule: { tag: "g-alter", sort: "price-asc" } },
    { name: "Fabric and thread", slug: "fabric", description: "Cloth, lining and aari kits for your stitching order.", rule: { tag: "fabric", sort: "price-asc" } },
    { name: "Add-ons", slug: "add-ons", description: "Lining, padding, piping and latkans to add to an order.", rule: { tag: "addon", sort: "price-asc" } },
    { name: "Under ₹500", slug: "under-500", description: "Quick stitching, alterations and finishing under ₹500.", rule: { tag: "under-500", sort: "price-asc" } },
  ],
  coupons: [
    { code: "DEEPAVALI50", description: "₹50 off a stitching order above ₹799 booked by 31 October", type: "flat", value: 5_000, minOrder: 79_900, perCustomerLimit: 1, channels: ["store", "manual"] },
    { code: "FIRSTFIT", description: "₹100 off your first order above ₹999", type: "flat", value: 10_000, minOrder: 99_900, firstOrderOnly: true, perCustomerLimit: 1, channels: ["store"] },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "Thaiyal Tailors & Boutique, Madurai",
      description:
        "Blouses, salwars, kids' pavadai, school uniforms and alterations stitched to your measurements in Madurai: tell us the garment, the style and the occasion, book a measurement visit, track your order, and get a free trial and a free first alteration.",
      imageUrl: photo(13206031),
    },
    sections: [
      {
        type: "hero",
        id: "th-hero",
        slides: [
          {
            imageUrl: photo(13206031, "wide"),
            heading: "Stitched to the inch. Delivered by the day we say.",
            subheading: "Blouses, salwars, pavadai, uniforms and alterations from a Madurai tailoring family. A free trial and a free first alteration on every garment.",
            cta: { label: "Book measurements", href: "/book" },
          },
          {
            imageUrl: photo(9496723, "wide"),
            heading: "The blouse that makes the saree.",
            subheading: "Princess cuts, back-neck designs and bridal aari work, lined, padded and fitted on you.",
            cta: { label: "See blouse styles", href: "/collections/blouse-styles" },
          },
        ],
      },
      {
        type: "offer",
        id: "th-deepavali",
        eyebrow: "Deepavali orders",
        heading: "Deepavali orders close on 31 October",
        text: "Order a blouse, pavadai or kurta by 31 October and it is ready by 6 November, two days before Deepavali (8 November). Alterations, falls and pico are taken until 5 November. We open all day on Sundays till then.",
        code: "DEEPAVALI50",
        endsAt: "2026-10-31T18:00:00+05:30",
        cta: { label: "Book measurements", href: "/book" },
      },
      {
        type: "finder",
        id: "th-finder",
        title: "What shall we stitch?",
        text: "Three taps: the garment, the style and the occasion. We show the services that fit, with prices and delivery times.",
        layout: "wizard",
        results: "inline",
        limit: 6,
        imageUrl: photo(4622406, "tile"),
        cta: { label: "Not sure? Send us a photo on WhatsApp", href: waLink("Hello Thaiyal, I would like to stitch: … (photo attached). Occasion: … Needed by: …") },
        questions: [
          {
            label: "Which garment?",
            options: [
              { label: "Blouse", tag: "g-blouse" },
              { label: "Salwar, churidar or kurti", tag: "g-salwar" },
              { label: "Kids' wear", tag: "g-kids" },
              { label: "Men's shirt, pant or kurta", tag: "g-men" },
              { label: "School uniform", tag: "g-uniform" },
              { label: "Alteration or saree fall", tag: "g-alter" },
            ],
          },
          {
            label: "What style?",
            options: [
              { label: "Simple and quick", tag: "s-simple" },
              { label: "Designer finish", tag: "s-designer" },
              { label: "Hand embroidery", tag: "s-handwork" },
            ],
          },
          {
            label: "For which occasion?",
            options: [
              { label: "Daily wear", tag: "o-daily" },
              { label: "Festival or function", tag: "o-festive" },
              { label: "Wedding", tag: "o-wedding" },
              { label: "School or office", tag: "o-school" },
            ],
          },
        ],
      },
      {
        type: "categories",
        id: "th-categories",
        title: "What we stitch",
        layout: "cards",
        showCounts: true,
        columns: "5",
      },
      {
        type: "timeline",
        id: "th-steps",
        title: "Your blouse in 5 steps",
        text: "Every step is dated on your job card, and you can follow it on your phone.",
        items: [
          { when: "Step 1", title: "Measure", text: "Our master tailor takes 9 to 13 measurements, notes your style and gives you a job number (JC-0123) and a delivery date.", imageUrl: photo(3143082, "tile") },
          { when: "Step 2", title: "Cut", text: "The cloth is cut on the table, with margins inside the seams so it can be let out later, and the lining is cut to match.", imageUrl: photo(6461121, "tile") },
          { when: "Step 3", title: "Stitch", text: "Stitched by a tailor who knows your style: darts, neck, sleeves and finishing, with any aari work done on the frame.", imageUrl: photo(27893063, "tile") },
          { when: "Step 4", title: "Trial", text: "You try it on. We mark what to take in or let out, and fix it the same day for simple changes.", imageUrl: photo(9983579, "tile") },
          { when: "Step 5", title: "Deliver", text: "Pressed, tagged and billed with GST. The advance is shown as already paid, and a free alteration is yours for 7 days.", imageUrl: photo(38995453, "tile") },
        ],
      },
      {
        type: "shop-the-look",
        id: "th-look",
        title: "Shop the blouse",
        text: "A lace-up designer blouse in silk-cotton, lined and padded. Tap a dot to see what goes into it.",
        imageUrl: photo(38995453, "wide"),
        alt: "A green lace-up back blouse worn with a cream saree",
        hotspots: [
          { x: 48, y: 52, productId: product("Designer blouse stitching") },
          { x: 62, y: 26, productId: product("Silk-cotton blouse cloth, 1 metre") },
          { x: 38, y: 66, productId: product("Add-on: cotton lining") },
          { x: 70, y: 56, productId: product("Add-on: piping and latkans") },
        ],
      },
      {
        type: "pricing-table",
        id: "th-uniforms",
        title: "School uniforms, priced per set",
        text: "Stitched in your school's cloth, by size slab, with a size list and one free alteration round. Registered schools get a GST bill, part-payment and 30 days' credit.",
        plans: [
          {
            name: "10 to 24 sets",
            price: rs(460),
            period: "per set",
            description: "Classes, hostels, small schools",
            features: ["Shirt with pant or skirt", "Delivery in 10 days", "Size list and labels", "One free alteration round"],
            cta: { label: "Order uniforms", href: "/c/school-uniforms" },
          },
          {
            name: "25 to 99 sets",
            price: rs(410),
            period: "per set",
            description: "A school year's batch",
            features: ["Shirt with pant or skirt", "Delivery in 14 days", "Bundles by class", "One free alteration round", "GST bill, 30 days' credit"],
            highlight: true,
            badge: "Most schools",
            cta: { label: "Order uniforms", href: "/c/school-uniforms" },
          },
          {
            name: "100 sets and above",
            price: rs(370),
            period: "per set",
            description: "Whole classes, matric schools",
            features: ["Shirt with pant or skirt", "Delivery in 18 days", "Bundles by class and house colours", "Free logo digitising", "GST bill, 30 days' credit"],
            cta: { label: "Order uniforms", href: "/c/school-uniforms" },
          },
          {
            name: "500 sets and above",
            price: rs(340),
            period: "per set, from",
            description: "Trusts and chains of schools",
            features: ["Final price on the cloth and the sizes", "Staggered delivery by class", "A dedicated tailor-in-charge"],
            cta: { label: "Ask for a quote", href: waLink("Hello Thaiyal, I'd like a school uniform quote. School: … Strength: … Cloth: …") },
          },
        ],
      },
      {
        type: "team",
        id: "th-team",
        title: "Who will stitch your order",
        text: "Five people, one workroom behind the shop. You'll meet them at the trial.",
        members: [
          { name: "Rajeswari Sundaram", role: "Master tailor and manager", bio: "Thirty years on the cutting table. Takes every measurement herself and signs off every blouse." },
          { name: "Selvi Murugesan", role: "Tailor, blouses and salwars", bio: "Princess cuts, back-neck designs and Anarkalis. Fits the trial." },
          { name: "Ganesan Pandian", role: "Tailor, men's wear and uniforms", bio: "Shirts, pants, suits and the school bulk orders." },
          { name: "Thenmozhi Velu", role: "Aari and maggam artist", bio: "Hand embroidery on the frame, from a neckline to a full bridal back." },
          { name: "Pushpa Karthikeyan", role: "Front desk and orders", bio: "Your job card, your advance, and the call when it is ready." },
        ],
      },
      {
        type: "appointment",
        id: "th-measure",
        heading: "Book your measurements",
        text: "Come in for measurements at the shop, or have a tailor visit your home. The fee is adjusted in your stitching bill.",
        services: [
          { name: "Measurement and style consultation, at the shop", duration: "15 to 30 minutes", price: rs(99) },
          { name: "Home measurement visit, Madurai city", duration: "30 to 45 minutes", price: rs(199) },
          { name: "Fabric pickup and delivery", duration: "9 am to 6 pm", price: rs(80) },
        ],
        cta: { label: "Book a slot", href: "/book" },
      },
      {
        type: "gallery",
        id: "th-gallery",
        title: "From the workroom",
        layout: "masonry",
        images: [
          { url: photo(9339396, "tile"), alt: "Hands embroidering on the aari frame", caption: "Aari work on yellow cloth" },
          { url: photo(31945332, "tile"), alt: "A gold embroidered blouse", caption: "Gold zari blouse" },
          { url: photo(36045982, "tile"), alt: "A purple tiered frock", caption: "Party frock, 4 to 7 years" },
          { url: photo(31935139, "tile"), alt: "Beads and stones sewn by hand", caption: "Maggam stonework" },
          { url: photo(37439026, "tile"), alt: "A velvet bridal blouse", caption: "Bridal blouse, three fittings" },
          { url: photo(6461121, "tile"), alt: "Cutting cloth on the table", caption: "Cutting day" },
        ],
      },
      {
        type: "usp",
        id: "th-promises",
        layout: "inline",
        items: [
          { icon: "check", title: "Free trial", text: "On every blouse, pavadai and suit" },
          { icon: "clock", title: "Delivered on the day", text: "Or the stitching is free" },
          { icon: "heart", title: "Free first alteration", text: "Within 7 days" },
        ],
      },
      {
        type: "testimonials",
        id: "th-voices",
        title: "From the trial room",
        layout: "single",
        items: [
          { quote: "My daughter's wedding blouse took three fittings and every one was on time. The aari work on the back was better than the photo I brought.", name: "Meenakshi R.", role: "Bride's mother, Anna Nagar", rating: 5 },
          { quote: "We give our school's whole Class 1 to 5 uniform here. Size list, bundles by class and a GST bill with 30 days' credit: nothing gets lost.", name: "Mrs. Jeyalakshmi", role: "Correspondent, a Madurai matric school", rating: 5 },
          { quote: "I bring last-minute blouse alterations every Deepavali. Done while I wait, no fuss, ₹120.", name: "Kavitha S.", role: "Simmakkal", rating: 5 },
        ],
      },
      { type: "faq", id: "th-faq", title: "Before you book", items: FAQ },
      {
        type: "location",
        id: "th-visit",
        title: "Find the workroom",
        address: "27, West Masi Street, near the temple tower, Madurai 625001",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "9.9195, 78.1193",
      },
    ],
    translations: {
      ta: {
        "th-hero": {
          slides: [
            { heading: "அங்குலம் அங்குலமாகத் தைக்கப்படும். சொன்ன நாளில் டெலிவரி.", subheading: "மதுரைத் தையல் குடும்பத்திலிருந்து பிளவுஸ், சல்வார், பாவாடை, சீருடை, மாற்றங்கள். ஒவ்வொரு உடைக்கும் இலவச ட்ரயல், இலவச முதல் மாற்றம்.", cta: { label: "அளவெடுக்க முன்பதிவு" } },
            { heading: "சேலையை அழகாக்கும் பிளவுஸ்.", subheading: "பிரின்சஸ் கட், பின்கழுத்து டிசைன்கள், மணமகள் ஆரி வேலை: லைனிங், பேடிங்குடன், உங்கள் மேல் பொருத்தி.", cta: { label: "பிளவுஸ் வகைகளைப் பாருங்கள்" } },
          ],
        },
        "th-deepavali": {
          eyebrow: "தீபாவளி ஆர்டர்கள்",
          heading: "தீபாவளி ஆர்டர்கள் 31 அக்டோபரில் முடிகின்றன",
          text: "பிளவுஸ், பாவாடை, குர்தாவை 31 அக்டோபருக்குள் ஆர்டர் செய்தால் தீபாவளிக்கு (8 நவம்பர்) இரண்டு நாள் முன்பு, 6 நவம்பருக்குள் தயார். மாற்றம், ஃபால், பிகோ 5 நவம்பர் வரை. அதுவரை ஞாயிறுகளிலும் நாள் முழுதும் திறந்திருப்போம்.",
          cta: { label: "அளவெடுக்க முன்பதிவு" },
        },
        "th-finder": {
          title: "என்ன தைக்கலாம்?",
          text: "மூன்று தட்டல்கள்: உடை, பாணி, நிகழ்வு. பொருந்தும் சேவைகளை விலை, டெலிவரி நேரத்துடன் காட்டுவோம்.",
          cta: { label: "உறுதியில்லையா? வாட்ஸ்அப்பில் படம் அனுப்புங்கள்" },
          questions: [
            { label: "எந்த உடை?", options: [{ label: "பிளவுஸ்" }, { label: "சல்வார், சுடிதார், குர்தி" }, { label: "குழந்தைகள் உடை" }, { label: "ஆண்கள் சட்டை, பேன்ட், குர்தா" }, { label: "பள்ளிச் சீருடை" }, { label: "மாற்றம் அல்லது சேலை ஃபால்" }] },
            { label: "என்ன பாணி?", options: [{ label: "எளிமை, விரைவு" }, { label: "டிசைனர் முடிப்பு" }, { label: "கை எம்பிராய்டரி" }] },
            { label: "எந்த நிகழ்வுக்கு?", options: [{ label: "தினசரி அணிவு" }, { label: "பண்டிகை, விழா" }, { label: "திருமணம்" }, { label: "பள்ளி, அலுவலகம்" }] },
          ],
        },
        "th-categories": { title: "நாங்கள் தைப்பவை" },
        "th-steps": {
          title: "உங்கள் பிளவுஸ் 5 படிகளில்",
          text: "ஒவ்வொரு படியும் உங்கள் வேலை அட்டையில் தேதியுடன் இருக்கும்; போனிலேயே பின்தொடரலாம்.",
          items: [
            { when: "படி 1", title: "அளவெடுத்தல்", text: "எங்கள் மாஸ்டர் டெய்லர் 9 முதல் 13 அளவுகள் எடுத்து, உங்கள் பாணியைக் குறித்து, வேலை எண்ணும் (JC-0123) டெலிவரி தேதியும் தருவார்." },
            { when: "படி 2", title: "வெட்டுதல்", text: "மேசையில் துணி வெட்டப்படும்; பின்னர் விரிக்க தையலுக்குள் மார்ஜின் விடப்படும்; லைனிங்கும் பொருத்தி வெட்டப்படும்." },
            { when: "படி 3", title: "தையல்", text: "உங்கள் பாணி தெரிந்த தையல்காரர் தைப்பார்: டார்ட், கழுத்து, கை, முடிப்பு; ஆரி வேலை ஃப்ரேமில்." },
            { when: "படி 4", title: "ட்ரயல்", text: "நீங்கள் போட்டுப் பார்ப்பீர்கள். எதை உள்ளே எடுக்க, வெளியே விட என்று குறித்து, எளிய மாற்றங்களை அன்றே செய்வோம்." },
            { when: "படி 5", title: "டெலிவரி", text: "அயர்ன் செய்து, டேக் போட்டு, GST பில்லுடன். முன்பணம் செலுத்தியதாகக் காட்டப்படும்; 7 நாள் இலவச மாற்றம் உங்களுக்கு." },
          ],
        },
        "th-look": { title: "இந்த பிளவுஸை வாங்குங்கள்", text: "சில்க்-காட்டனில் லேஸ்-அப் டிசைனர் பிளவுஸ், லைனிங், பேடிங்குடன். புள்ளியைத் தட்டினால் என்ன சேர்கிறது என்று பாருங்கள்.", alt: "கிரீம் சேலையுடன் பச்சை லேஸ்-அப் முதுகு பிளவுஸ்" },
        "th-uniforms": {
          title: "பள்ளிச் சீருடை, ஒரு செட்டுக்கு விலை",
          text: "உங்கள் பள்ளியின் துணியில், அளவு வரிசைப்படி, அளவுப் பட்டியல், ஒரு இலவச மாற்றச் சுற்றுடன். பதிவு பெற்ற பள்ளிகளுக்கு GST பில், பகுதிப் பணம், 30 நாள் கடன்.",
          plans: ([
            { name: "10 முதல் 24 செட்", period: "ஒரு செட்டுக்கு", description: "வகுப்புகள், விடுதிகள், சிறிய பள்ளிகள்", features: ["சட்டையுடன் பேன்ட் அல்லது ஸ்கர்ட்", "10 நாளில் டெலிவரி", "அளவுப் பட்டியல், லேபிள்", "ஒரு இலவச மாற்றச் சுற்று"], cta: { label: "சீருடை ஆர்டர்" } },
            { name: "25 முதல் 99 செட்", period: "ஒரு செட்டுக்கு", description: "ஒரு கல்வியாண்டின் தொகுப்பு", features: ["சட்டையுடன் பேன்ட் அல்லது ஸ்கர்ட்", "14 நாளில் டெலிவரி", "வகுப்பு வாரியாகக் கட்டுகள்", "ஒரு இலவச மாற்றச் சுற்று", "GST பில், 30 நாள் கடன்"], badge: "பெரும்பாலான பள்ளிகள்", cta: { label: "சீருடை ஆர்டர்" } },
            { name: "100 செட், அதற்கு மேல்", period: "ஒரு செட்டுக்கு", description: "முழு வகுப்புகள், மெட்ரிக் பள்ளிகள்", features: ["சட்டையுடன் பேன்ட் அல்லது ஸ்கர்ட்", "18 நாளில் டெலிவரி", "வகுப்பு, ஹவுஸ் வண்ணம் வாரியாகக் கட்டுகள்", "லோகோ டிஜிட்டைசிங் இலவசம்", "GST பில், 30 நாள் கடன்"], cta: { label: "சீருடை ஆர்டர்" } },
            { name: "500 செட், அதற்கு மேல்", period: "ஒரு செட்டுக்கு, முதல்", description: "அறக்கட்டளைகள், பள்ளிக் குழுமங்கள்", features: ["துணி, அளவுகளைப் பொறுத்து இறுதி விலை", "வகுப்பு வாரியாகத் தவணை டெலிவரி", "பொறுப்புத் தையல்காரர் ஒருவர்"], cta: { label: "விலை கேளுங்கள்" } },
          ] as Record<string, unknown>[]) as never,
        },
        "th-team": {
          title: "உங்கள் ஆர்டரை யார் தைப்பார்கள்",
          text: "ஐந்து பேர், கடைக்குப் பின்னால் ஒரே பணிக்கூடம். ட்ரயலில் சந்திப்பீர்கள்.",
          members: [
            { role: "மாஸ்டர் டெய்லர், மேலாளர்", bio: "வெட்டு மேசையில் முப்பது ஆண்டுகள். ஒவ்வொரு அளவையும் தானே எடுத்து, ஒவ்வொரு பிளவுஸையும் ஒப்புதல் அளிப்பவர்." },
            { role: "தையல்காரர், பிளவுஸ், சல்வார்", bio: "பிரின்சஸ் கட், பின்கழுத்து டிசைன், அனார்கலி. ட்ரயலில் பொருத்துபவர்." },
            { role: "தையல்காரர், ஆண்கள் உடை, சீருடை", bio: "சட்டை, பேன்ட், சூட், பள்ளிக்கான மொத்த ஆர்டர்கள்." },
            { role: "ஆரி, மாக்கம் கலைஞர்", bio: "ஃப்ரேமில் கை எம்பிராய்டரி: கழுத்துப் பகுதி முதல் முழு மணமகள் முதுகு வரை." },
            { role: "வரவேற்பு, ஆர்டர்கள்", bio: "உங்கள் வேலை அட்டை, முன்பணம், தயாரானதும் அழைப்பு." },
          ],
        },
        "th-measure": {
          heading: "அளவெடுக்க முன்பதிவு",
          text: "கடையில் அளவெடுக்க வாருங்கள், அல்லது தையல்காரர் உங்கள் வீட்டுக்கு வருவார். கட்டணம் தையல் பில்லில் கழிக்கப்படும்.",
          services: [{ name: "கடையில் அளவெடுப்பு, டிசைன் ஆலோசனை", duration: "15 முதல் 30 நிமிடம்" }, { name: "வீட்டு அளவெடுப்பு வருகை, மதுரை நகரம்", duration: "30 முதல் 45 நிமிடம்" }, { name: "துணி எடுத்தல், திருப்பித் தருதல்", duration: "காலை 9 – மாலை 6" }],
          cta: { label: "நேரம் முன்பதிவு" },
        },
        "th-gallery": {
          title: "பணிக்கூடத்திலிருந்து",
          images: [
            { alt: "ஆரி ஃப்ரேமில் எம்பிராய்டரி செய்யும் கைகள்", caption: "மஞ்சள் துணியில் ஆரி வேலை" },
            { alt: "தங்க ஜரி எம்பிராய்டரி பிளவுஸ்", caption: "தங்க ஜரி பிளவுஸ்" },
            { alt: "ஊதா அடுக்கு ஃப்ராக்", caption: "பார்ட்டி ஃப்ராக், 4 முதல் 7 வயது" },
            { alt: "கையால் தைத்த மணிகள், கற்கள்", caption: "மாக்கம் கல் வேலை" },
            { alt: "வெல்வெட் மணமகள் பிளவுஸ்", caption: "மணமகள் பிளவுஸ், மூன்று ட்ரயல்" },
            { alt: "மேசையில் துணி வெட்டுதல்", caption: "வெட்டும் நாள்" },
          ],
        },
        "th-promises": {
          items: [{ title: "இலவச ட்ரயல்", text: "ஒவ்வொரு பிளவுஸ், பாவாடை, சூட்டுக்கும்" }, { title: "சொன்ன நாளில் டெலிவரி", text: "இல்லையேல் தையல் இலவசம்" }, { title: "இலவச முதல் மாற்றம்", text: "7 நாளுக்குள்" }],
        },
        "th-voices": {
          title: "ட்ரயல் அறையிலிருந்து",
          items: [
            { quote: "என் மகளின் திருமண பிளவுஸுக்கு மூன்று ட்ரயல்; ஒவ்வொன்றும் சொன்ன நேரத்தில். முதுகில் ஆரி வேலை நான் கொண்டு வந்த படத்தை விட அழகு.", role: "மணமகளின் தாய், அண்ணா நகர்" },
            { quote: "எங்கள் பள்ளியின் 1 முதல் 5 வகுப்புச் சீருடை முழுவதும் இங்கே. அளவுப் பட்டியல், வகுப்பு வாரியாகக் கட்டு, 30 நாள் கடனுடன் GST பில்: எதுவும் தொலையாது.", role: "தாளாளர், மதுரை மெட்ரிக் பள்ளி" },
            { quote: "ஒவ்வொரு தீபாவளிக்கும் கடைசி நேர பிளவுஸ் மாற்றம் கொண்டு வருவேன். காத்திருக்கும்போதே முடிந்தது, ₹120, சிரமமில்லை.", role: "சிம்மக்கல்" },
          ],
        },
        "th-faq": { title: "முன்பதிவுக்கு முன்", items: FAQ_TA },
        "th-visit": {
          title: "பணிக்கூடத்தைக் கண்டுபிடியுங்கள்",
          address: "27, மேற்கு மாசி வீதி, கோபுரம் அருகில், மதுரை 625001",
          hours: HOURS_TA,
        },
      },
    },
  }),
  pages: [
    {
      slug: "how-we-stitch",
      title: "How we stitch: measurements, trial and delivery",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "From your fabric to your wardrobe" },
        {
          type: "paragraph",
          markdown:
            "Every order gets a **job card**: your measurements (9 to 13 for a blouse), the style you chose, whether we hold your fabric, an advance if the work is big, a **trial date** and a **delivery date**, with a job number like JC-0123 on your slip. You follow it on your phone: cutting, stitching, trial, ready.",
        },
        { type: "image", url: photo(3143082, "tile"), alt: "A yellow measuring tape coiled on white" },
        { type: "heading", level: 2, text: "Delivery times" },
        {
          type: "paragraph",
          markdown:
            "| Garment | Time | Trial |\n|---|---|---|\n| Alterations, falls and pico | Same day to 2 days | Try-on |\n| Simple blouse, kurti, bottoms | 2 to 4 days | Optional |\n| Churidar set, salwar kameez, men's shirt | 4 days | Optional |\n| Princess-cut and designer blouse, pavadai, pant | 5 to 6 days | 1 fitting |\n| Anarkali, kurta sets, langa voni | 6 to 8 days | 1 to 2 fittings |\n| Bridal blouse with aari or maggam work | 3 to 4 weeks | 3 fittings |\n| School uniforms | 10 to 18 days | Size round |\n\nDeepavali: new stitching orders close on **31 October**; alterations until 5 November.",
        },
        { type: "heading", level: 2, text: "Price and GST" },
        {
          type: "paragraph",
          markdown:
            "Prices are for stitching and include **5% GST** (SAC 998821, textile job work). Cloth, lining and thread bought from our shelf are billed at 5% as goods. An advance (about a quarter, 30% for bridal work) is shown on the final bill as already paid.",
        },
        { type: "button", label: "Track my order", href: "/track-repair", style: "primary" },
        { type: "button", label: "Book measurements", href: "/book", style: "secondary" },
      ],
    },
    {
      slug: "measurement-guide",
      title: "Measuring a blouse: what we take",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "What we measure" },
        {
          type: "paragraph",
          markdown:
            "For a blouse we take **length, bust, waist, shoulder, armhole, sleeve length, sleeve round, front neck and back neck** (inches). For a salwar we add hip, bottom length, bottom waist and ankle. For a shirt: chest, waist, shoulder, sleeve, cuff and collar. A good measurement is taken over the inner wear you will wear, with the tape snug but not tight.",
        },
        { type: "image", url: photo(4622406, "tile"), alt: "A person holding a measuring tape in a sewing studio" },
        {
          type: "paragraph",
          markdown:
            "If you can't come, send us a blouse that fits you (we measure the seams) or ask for a **home measurement visit** in Madurai city. We keep your measurements on your job card for the next order.",
        },
        { type: "button", label: "Book measurements", href: "/book", style: "primary" },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Thaiyal, West Masi Street, since 1998" },
        {
          type: "paragraph",
          markdown:
            "Thaiyal began as two sewing machines behind the Masi Street shop and is now a workroom of five: a master tailor, two tailors, an aari artist and the front desk. We stitch blouses and salwars for Madurai's families, uniforms for its schools and do the alterations and saree falls that the festival week demands. Our promise is simple: a free trial, a free first alteration and the day we say.",
        },
        { type: "image", url: photo(13206031, "tile"), alt: "A tailor at an industrial sewing machine" },
        { type: "paragraph", markdown: "Open Monday to Saturday 9:30 am – 8:30 pm, Sunday 10 am – 2 pm. Call or WhatsApp **+91 98765 00068**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our customers or staff, and the garments shown are stand-ins for the styles named.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Blouses", type: "category", ref: "blouses" },
      { label: "Salwar & kids", type: "category", ref: "salwar-and-churidar" },
      { label: "Uniforms", type: "category", ref: "school-uniforms" },
      { label: "Alterations", type: "category", ref: "alterations" },
      { label: "Track my order", type: "url", href: "/track-repair" },
      { label: "How we stitch", type: "page", ref: "how-we-stitch" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track my order", type: "url", href: "/track-repair" },
          { label: "How we stitch", type: "page", ref: "how-we-stitch" },
          { label: "Measuring guide", type: "page", ref: "measurement-guide" },
          { label: "Book measurements", type: "url", href: "/book" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Blouse styles", type: "collection", ref: "blouse-styles" },
          { label: "Wedding and bridal", type: "collection", ref: "bridal" },
          { label: "Ready in two days", type: "collection", ref: "rush" },
          { label: "School uniforms", type: "collection", ref: "uniforms" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
