import { stockArtFor } from "@srirealtime/branding/stock-art";
import type { BusinessPack, BusinessType } from "./packs";

/**
 * A new shop's starter home page in the CMS section format (`@srirealtime/cms` homeSectionSchema validates it; see
 * packages/cms/src/starter.test.ts). Each trade gets its own mix: a photo-less hero (the theme's brand block, or a
 * split hero), categories as round pictures or a mosaic, trade sections (today's gold rate, book an appointment, the
 * menu board), the pack's promises, where to find the shop and a newsletter.
 *
 * The starter is published straight away, so nothing in it may claim things about the shop that the owner hasn't said:
 * customer words, menu prices and FAQ answers start `hidden` (ready to edit in the home page editor), and the
 * location section shows the shop's own contact details until the owner types an address.
 */

type Locale = "en" | "ta";
type L = { en: string; ta: string };
const l = (en: string, ta: string): L => ({ en, ta });

/** The section kinds a starter can contain, in the order they appear. */
type Part =
  | "hero"
  | "hero-split"
  | "categories"
  | "category-mosaic"
  | "gold-rates"
  | "appointment"
  | "menu-board"
  | "usp"
  | "testimonials"
  | "faq"
  | "location"
  | "newsletter";

const LAYOUT: Record<BusinessType, Part[]> = {
  fashion: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "newsletter"],
  pharmacy: ["hero", "categories", "usp", "faq", "location", "newsletter"],
  restaurant: ["hero", "menu-board", "categories", "testimonials", "location", "newsletter"],
  cloud_kitchen: ["hero", "menu-board", "categories", "usp", "testimonials", "faq"],
  grocery: ["hero-split", "category-mosaic", "usp", "faq", "location", "newsletter"],
  bakery: ["hero-split", "menu-board", "categories", "testimonials", "location", "newsletter"],
  fresh: ["hero", "category-mosaic", "usp", "faq", "newsletter"],
  electronics: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "location"],
  repair: ["hero", "appointment", "usp", "testimonials", "faq", "location"],
  salon: ["hero-split", "appointment", "categories", "testimonials", "faq", "location"],
  gym: ["hero", "appointment", "usp", "testimonials", "faq", "location"],
  jewellery: ["hero-split", "gold-rates", "category-mosaic", "testimonials", "location", "newsletter"],
  hardware: ["hero", "category-mosaic", "usp", "faq", "location"],
  optical: ["hero-split", "appointment", "category-mosaic", "testimonials", "location"],
  tailoring: ["hero", "appointment", "categories", "testimonials", "faq", "location"],
};

// ------------------------------------------------------------------ trade words

/** Services listed in the "Book an appointment" section (names and usual time; no prices — the owner adds them). */
const SERVICES: Partial<Record<BusinessType, { name: L; duration?: L }[]>> = {
  salon: [
    { name: l("Haircut & styling", "முடி வெட்டு & ஸ்டைலிங்"), duration: l("45 min", "45 நிமி") },
    { name: l("Facial & clean-up", "ஃபேஷியல் & க்ளீன்-அப்"), duration: l("60 min", "60 நிமி") },
    { name: l("Bridal makeup", "மணப்பெண் அலங்காரம்"), duration: l("3 hours", "3 மணி நேரம்") },
  ],
  gym: [
    { name: l("Free trial workout", "இலவச சோதனைப் பயிற்சி"), duration: l("60 min", "60 நிமி") },
    { name: l("Personal training", "தனிப் பயிற்சி"), duration: l("60 min", "60 நிமி") },
    { name: l("Fitness assessment", "உடல்திறன் மதிப்பீடு"), duration: l("30 min", "30 நிமி") },
  ],
  repair: [
    { name: l("Screen replacement", "திரை மாற்றம்"), duration: l("Same day", "அதே நாள்") },
    { name: l("Battery replacement", "பேட்டரி மாற்றம்"), duration: l("1 hour", "1 மணி நேரம்") },
    { name: l("Free check-up", "இலவச பரிசோதனை"), duration: l("15 min", "15 நிமி") },
  ],
  optical: [
    { name: l("Eye test", "கண் பரிசோதனை"), duration: l("20 min", "20 நிமி") },
    { name: l("Frame fitting", "ஃப்ரேம் பொருத்துதல்"), duration: l("15 min", "15 நிமி") },
    { name: l("Contact lens trial", "காண்டாக்ட் லென்ஸ் சோதனை"), duration: l("30 min", "30 நிமி") },
  ],
  tailoring: [
    { name: l("Measurements", "அளவெடுத்தல்"), duration: l("15 min", "15 நிமி") },
    { name: l("Blouse stitching", "ரவிக்கை தையல்"), duration: l("5 days", "5 நாள்") },
    { name: l("Alterations", "ஆல்டரேஷன்"), duration: l("2 days", "2 நாள்") },
  ],
};

const APPOINTMENT: Partial<Record<BusinessType, { heading: L; text: L }>> = {
  salon: { heading: l("Book your appointment", "உங்கள் நேரத்தை முன்பதிவு செய்யுங்கள்"), text: l("Pick a service and a time that suits you. No waiting at the counter.", "சேவையையும் உங்களுக்கு ஏற்ற நேரத்தையும் தேர்ந்தெடுங்கள். கவுண்டரில் காத்திருக்க வேண்டாம்.") },
  gym: { heading: l("Start with a free trial", "இலவச சோதனையுடன் தொடங்குங்கள்"), text: l("Book a slot, meet a trainer and see the gym before you join.", "நேரத்தை முன்பதிவு செய்து, பயிற்சியாளரைச் சந்தித்து, சேரும் முன் ஜிம்மைப் பாருங்கள்.") },
  repair: { heading: l("Book a repair", "பழுது நீக்க முன்பதிவு"), text: l("Tell us what's wrong and pick a time. Track your job online.", "என்ன கோளாறு என்று சொல்லி நேரத்தைத் தேர்ந்தெடுங்கள். உங்கள் வேலையை ஆன்லைனில் பாருங்கள்.") },
  optical: { heading: l("Book an eye test", "கண் பரிசோதனைக்கு முன்பதிவு"), text: l("Get your eyes checked and try frames, at a time that suits you.", "உங்களுக்கு ஏற்ற நேரத்தில் கண் பரிசோதனை செய்து ஃப்ரேம்களை அணிந்து பாருங்கள்.") },
  tailoring: { heading: l("Book a fitting", "அளவெடுக்க முன்பதிவு"), text: l("Come in for measurements, or book a pick-up of your fabric.", "அளவெடுக்க வாருங்கள், அல்லது உங்கள் துணியை எடுத்துச் செல்ல முன்பதிவு செய்யுங்கள்.") },
};

type Dish = { name: L; price: number; diet?: "veg" | "nonveg" | "egg" };
/** Sample menu (hidden until the owner puts in their own dishes and prices). Prices in paise. */
const MENU: Partial<Record<BusinessType, { name: L; items: Dish[] }[]>> = {
  restaurant: [
    {
      name: l("Tiffin", "டிஃபன்"),
      items: [
        { name: l("Idli (2 pcs)", "இட்லி (2)"), price: 4500, diet: "veg" },
        { name: l("Masala dosa", "மசாலா தோசை"), price: 9000, diet: "veg" },
        { name: l("Ven pongal", "வெண் பொங்கல்"), price: 7000, diet: "veg" },
      ],
    },
    {
      name: l("Meals", "சாப்பாடு"),
      items: [
        { name: l("South Indian meals", "தென்னிந்திய சாப்பாடு"), price: 18000, diet: "veg" },
        { name: l("Chicken biryani", "சிக்கன் பிரியாணி"), price: 22000, diet: "nonveg" },
        { name: l("Egg curry", "முட்டைக் குழம்பு"), price: 12000, diet: "egg" },
      ],
    },
    { name: l("Drinks", "பானங்கள்"), items: [{ name: l("Filter coffee", "ஃபில்டர் காபி"), price: 3000, diet: "veg" }] },
  ],
  bakery: [
    {
      name: l("Cakes", "கேக்குகள்"),
      items: [
        { name: l("Black forest (½ kg)", "பிளாக் ஃபாரஸ்ட் (½ கி)"), price: 45000, diet: "egg" },
        { name: l("Eggless pineapple (½ kg)", "முட்டையில்லா அன்னாசி (½ கி)"), price: 40000, diet: "veg" },
      ],
    },
    {
      name: l("Snacks", "சிற்றுண்டி"),
      items: [
        { name: l("Veg puff", "வெஜ் பஃப்"), price: 2500, diet: "veg" },
        { name: l("Chicken puff", "சிக்கன் பஃப்"), price: 3500, diet: "nonveg" },
      ],
    },
  ],
};
MENU.cloud_kitchen = MENU.restaurant;

const MENU_TITLE: L = l("Today's menu", "இன்றைய மெனு");

/** FAQ questions per trade with draft answers (hidden until the owner checks them). */
const FAQ: Partial<Record<BusinessType, { q: L; a: L }[]>> = {
  fashion: [
    { q: l("How do I find my size?", "என் அளவை எப்படி அறிவது?"), a: l("Each product has a size guide. Between two sizes? Pick the larger one.", "ஒவ்வொரு பொருளிலும் அளவு வழிகாட்டி உள்ளது. இரண்டு அளவுகளுக்கு இடையிலா? பெரியதைத் தேர்ந்தெடுங்கள்.") },
    { q: l("Can I return or exchange?", "திருப்பி அல்லது மாற்றிக் கொள்ளலாமா?"), a: l("Yes, unused items within 7 days. See our returns policy.", "ஆம், பயன்படுத்தாதவை 7 நாட்களுக்குள். எங்கள் திருப்பக் கொள்கையைப் பாருங்கள்.") },
    { q: l("Do you offer cash on delivery?", "டெலிவரியில் பணம் செலுத்தலாமா?"), a: l("Yes, pay when your order arrives.", "ஆம், ஆர்டர் வந்ததும் செலுத்துங்கள்.") },
  ],
  pharmacy: [
    { q: l("How do I order prescription medicines?", "மருந்துச் சீட்டு மருந்துகளை எப்படி ஆர்டர் செய்வது?"), a: l("Add the medicines and upload a photo of your prescription at checkout. Our pharmacist checks it before packing.", "மருந்துகளைச் சேர்த்து, செக்அவுட்டில் மருந்துச் சீட்டின் படத்தைப் பதிவேற்றுங்கள். பேக் செய்யும் முன் எங்கள் மருந்தாளர் சரிபார்ப்பார்.") },
    { q: l("How fast is delivery?", "டெலிவரி எவ்வளவு விரைவில்?"), a: l("Usually the same day in town.", "பொதுவாக ஊருக்குள் அதே நாளில்.") },
    { q: l("Are the medicines genuine?", "மருந்துகள் அசலானவையா?"), a: l("Yes, from authorised distributors only, stored as required.", "ஆம், அங்கீகரிக்கப்பட்ட விநியோகஸ்தர்களிடமிருந்து மட்டும், முறைப்படி சேமிக்கப்படுகின்றன.") },
  ],
  cloud_kitchen: [
    { q: l("Where do you deliver?", "எங்கே டெலிவரி செய்கிறீர்கள்?"), a: l("Within a few kilometres of our kitchen. Enter your pincode at checkout.", "எங்கள் சமையலறையிலிருந்து சில கி.மீ. தூரம் வரை. செக்அவுட்டில் பின்கோடை உள்ளிடுங்கள்.") },
    { q: l("Can I order in advance?", "முன்கூட்டியே ஆர்டர் செய்யலாமா?"), a: l("Yes, for parties and bulk orders call us a day ahead.", "ஆம், விருந்து மற்றும் மொத்த ஆர்டர்களுக்கு ஒரு நாள் முன் அழையுங்கள்.") },
  ],
  grocery: [
    { q: l("Is there a minimum order?", "குறைந்தபட்ச ஆர்டர் உண்டா?"), a: l("No minimum. Free delivery on bigger orders.", "குறைந்தபட்சம் இல்லை. பெரிய ஆர்டர்களுக்கு இலவச டெலிவரி.") },
    { q: l("How are loose items weighed?", "தளர்வான பொருட்கள் எப்படி எடை போடப்படுகின்றன?"), a: l("On a stamped electronic scale; you pay for the exact weight.", "முத்திரையிட்ட மின்னணு எடைக் கருவியில்; சரியான எடைக்கு மட்டும் செலுத்துங்கள்.") },
  ],
  fresh: [
    { q: l("When is it harvested / caught?", "எப்போது அறுவடை / பிடிக்கப்பட்டது?"), a: l("Every morning. What's not fresh, we don't sell.", "ஒவ்வொரு காலையும். புதியதல்லாததை நாங்கள் விற்பதில்லை.") },
    { q: l("Do you clean and cut?", "சுத்தம் செய்து வெட்டித் தருவீர்களா?"), a: l("Yes, tell us how you'd like it in the order note.", "ஆம், ஆர்டர் குறிப்பில் எப்படி வேண்டும் என்று சொல்லுங்கள்.") },
  ],
  electronics: [
    { q: l("Is there a warranty?", "உத்தரவாதம் உண்டா?"), a: l("Yes, the brand warranty. Your serial number is on the bill.", "ஆம், நிறுவன உத்தரவாதம். வரிசை எண் பில்லில் இருக்கும்.") },
    { q: l("Can I pay in EMI?", "தவணையில் செலுத்தலாமா?"), a: l("Ask us in the shop about card EMI offers.", "கார்டு தவணைச் சலுகைகளைப் பற்றிக் கடையில் கேளுங்கள்.") },
  ],
  repair: [
    { q: l("How long does a repair take?", "பழுது நீக்க எவ்வளவு நேரம்?"), a: l("Most repairs are done the same day. We tell you before we start.", "பெரும்பாலானவை அதே நாளில். தொடங்கும் முன் சொல்வோம்.") },
    { q: l("Is my data safe?", "என் தரவு பாதுகாப்பானதா?"), a: l("We don't open your files. Back up before you hand over the phone.", "உங்கள் கோப்புகளைத் திறப்பதில்லை. கொடுக்கும் முன் பேக்கப் எடுங்கள்.") },
  ],
  salon: [
    { q: l("Do I need an appointment?", "முன்பதிவு தேவையா?"), a: l("Walk-ins are welcome, but booking means no waiting.", "நேரில் வரலாம், ஆனால் முன்பதிவு செய்தால் காத்திருக்க வேண்டாம்.") },
    { q: l("Which products do you use?", "எந்தப் பொருட்களைப் பயன்படுத்துகிறீர்கள்?"), a: l("Professional, skin-tested brands. Ask us about allergies.", "தொழில்முறை, தோல் சோதனை செய்த பிராண்டுகள். ஒவ்வாமை பற்றிக் கேளுங்கள்.") },
  ],
  gym: [
    { q: l("Can I try before I join?", "சேரும் முன் முயற்சிக்கலாமா?"), a: l("Yes, book a free trial workout.", "ஆம், இலவச சோதனைப் பயிற்சியை முன்பதிவு செய்யுங்கள்.") },
    { q: l("What are the timings?", "நேரங்கள் என்ன?"), a: l("Morning and evening batches every day; see the hours below.", "தினமும் காலை மற்றும் மாலை பிரிவுகள்; கீழே நேரங்களைப் பாருங்கள்.") },
    { q: l("Do you have trainers for women?", "பெண்களுக்குப் பயிற்சியாளர் உண்டா?"), a: l("Yes, ask for a women's batch when you book.", "ஆம், முன்பதிவு செய்யும்போது பெண்கள் பிரிவைக் கேளுங்கள்.") },
  ],
  hardware: [
    { q: l("Do you deliver to site?", "கட்டுமான இடத்திற்கு டெலிவரி உண்டா?"), a: l("Yes, for bulk orders within town.", "ஆம், ஊருக்குள் மொத்த ஆர்டர்களுக்கு.") },
    { q: l("Can I get a GST bill?", "GST பில் கிடைக்குமா?"), a: l("Yes, add your GSTIN at checkout.", "ஆம், செக்அவுட்டில் உங்கள் GSTIN-ஐச் சேர்க்கவும்.") },
  ],
  tailoring: [
    { q: l("How long does stitching take?", "தைக்க எவ்வளவு நாள்?"), a: l("Usually 5 days; festival season may take longer.", "பொதுவாக 5 நாள்; பண்டிகைக் காலத்தில் அதிகமாகலாம்.") },
    { q: l("Can I send my own fabric?", "என் துணியைக் கொடுக்கலாமா?"), a: l("Yes, bring it in or book a pick-up.", "ஆம், கொண்டு வாருங்கள் அல்லது எடுத்துச் செல்ல முன்பதிவு செய்யுங்கள்.") },
  ],
};

/** Draft customer words (hidden until the owner replaces them with real ones). */
const QUOTES: L[] = [
  l("Lovely service and quick delivery. Will order again!", "அருமையான சேவை, விரைவான டெலிவரி. மீண்டும் ஆர்டர் செய்வேன்!"),
  l("Friendly people and honest prices.", "அன்பான ஊழியர்கள், நேர்மையான விலை."),
];

const HOURS: Partial<Record<BusinessType, { label: L; value: L }[]>> = {
  restaurant: [{ label: l("Every day", "தினமும்"), value: l("7:00 am – 10:30 pm", "காலை 7:00 – இரவு 10:30") }],
  bakery: [{ label: l("Every day", "தினமும்"), value: l("8:00 am – 10:00 pm", "காலை 8:00 – இரவு 10:00") }],
  gym: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("5:00 am – 10:00 pm", "காலை 5:00 – இரவு 10:00") },
    { label: l("Sunday", "ஞாயிறு"), value: l("6:00 am – 12:00 noon", "காலை 6:00 – மதியம் 12:00") },
  ],
};
const DEFAULT_HOURS = [
  { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("9:30 am – 9:00 pm", "காலை 9:30 – இரவு 9:00") },
  { label: l("Sunday", "ஞாயிறு"), value: l("10:00 am – 2:00 pm", "காலை 10:00 – மதியம் 2:00") },
];

const W = {
  stayInTouch: l("Stay in touch", "தொடர்பில் இருங்கள்"),
  lovedBy: l("What our customers say", "எங்கள் வாடிக்கையாளர்கள் சொல்வது"),
  customer: l("Happy customer", "மகிழ்ந்த வாடிக்கையாளர்"),
  faq: l("Questions & answers", "கேள்விகளும் பதில்களும்"),
  visit: l("Visit us", "எங்களை நேரில் சந்திக்க"),
  book: l("Book now", "முன்பதிவு செய்க"),
  viewAll: l("See everything", "அனைத்தையும் பாருங்கள்"),
  bookOrShop: l("Book a visit", "வருகையை முன்பதிவு செய்க"),
  goldTitle: l("Today's gold rate", "இன்றைய தங்க விலை"),
  goldText: l("Rates per gram, updated every morning. Making charges as per design.", "கிராம் ஒன்றுக்கான விலை, ஒவ்வொரு காலையும் புதுப்பிக்கப்படும். செய்கூலி வடிவமைப்பைப் பொறுத்து."),
  welcome: l("Welcome", "வரவேற்கிறோம்"),
  fullMenu: l("See the full menu", "முழு மெனுவைப் பாருங்கள்"),
};

/** The starter home for a pack, in English or Tamil. */
export function starterHome(pack: BusinessPack, shopName: string, locale: Locale = "en") {
  const c = pack.copy[locale];
  const t = (x: L) => x[locale];
  const id = (k: string) => `starter-${k}`;
  const ctaHref = pack.ctaHref ?? "/search";
  const heading = shopName ? `${shopName}: ${c.heroHeading}` : c.heroHeading;
  const booking = ctaHref === "/book";

  const build = (part: Part) => {
    switch (part) {
      case "hero":
        // Stock artwork for the trade (drawn in its theme colours) until the owner adds photos; the tall picture on phones.
        return {
          type: "hero" as const,
          id: id("hero"),
          slides: [{ imageUrl: stockArtFor(pack.id, "hero-1"), mobileImageUrl: stockArtFor(pack.id, "split-1"), heading, subheading: c.heroSubheading, cta: { label: c.cta, href: ctaHref } }] };
      case "hero-split":
        return {
          type: "hero-split" as const,
          id: id("hero-split"),
          imageUrl: stockArtFor(pack.id, "split-1"),
          imageSide: "right" as const,
          eyebrow: (shopName || t(W.welcome)).slice(0, 60),
          heading: c.heroHeading,
          text: c.heroSubheading,
          cta: { label: c.cta, href: ctaHref },
          cta2: booking ? { label: t(W.viewAll), href: "/search" } : { label: c.newItems, href: "/products" },
        };
      case "categories":
        return { type: "categories" as const, id: id("categories"), title: c.categoriesTitle };
      case "category-mosaic":
        return { type: "category-mosaic" as const, id: id("mosaic"), title: c.categoriesTitle, style: { animation: "rise" as const } };
      case "gold-rates":
        return { type: "gold-rates" as const, id: id("gold-rates"), title: t(W.goldTitle), text: t(W.goldText), showSilver: true, style: { background: "muted" as const, align: "center" as const } };
      case "appointment": {
        const a = APPOINTMENT[pack.id];
        return {
          type: "appointment" as const,
          id: id("appointment"),
          heading: a ? t(a.heading) : c.cta,
          ...(a ? { text: t(a.text) } : {}),
          services: (SERVICES[pack.id] ?? []).map((s) => ({ name: t(s.name), ...(s.duration ? { duration: t(s.duration) } : {}) })),
          cta: { label: t(W.book), href: "/book" },
          style: { background: "brand" as const },
        };
      }
      case "menu-board":
        return {
          type: "menu-board" as const,
          id: id("menu"),
          hidden: true,
          title: t(MENU_TITLE),
          groups: (MENU[pack.id] ?? []).map((g) => ({ name: t(g.name), items: g.items.map((d) => ({ name: t(d.name), price: d.price, ...(d.diet ? { diet: d.diet } : {}) })) })),
          cta: { label: t(W.fullMenu), href: "/products" },
        };
      case "usp":
        return { type: "usp" as const, id: id("usp"), items: pack.usps.map((u) => ({ icon: u.icon, title: u.title[locale], text: u.text[locale] })) };
      case "testimonials":
        return {
          type: "testimonials" as const,
          id: id("testimonials"),
          hidden: true,
          title: t(W.lovedBy),
          layout: "cards" as const,
          items: QUOTES.map((q) => ({ quote: t(q), name: t(W.customer), rating: 5 })),
          style: { background: "muted" as const },
        };
      case "faq":
        return { type: "faq" as const, id: id("faq"), hidden: true, title: t(W.faq), items: (FAQ[pack.id] ?? []).map((f) => ({ q: t(f.q), a: t(f.a) })) };
      case "location":
        return {
          type: "location" as const,
          id: id("location"),
          title: t(W.visit),
          hours: (HOURS[pack.id] ?? DEFAULT_HOURS).map((h) => ({ label: t(h.label), value: t(h.value) })),
        };
      case "newsletter":
        return { type: "newsletter" as const, id: id("newsletter"), heading: t(W.stayInTouch), text: c.newsletter };
    }
  };

  return LAYOUT[pack.id]
    .filter((p) => (p === "faq" ? (FAQ[pack.id]?.length ?? 0) > 0 : p === "menu-board" ? (MENU[pack.id]?.length ?? 0) > 0 : true))
    .map(build);
}
