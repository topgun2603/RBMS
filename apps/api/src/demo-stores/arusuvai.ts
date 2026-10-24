import { CAT, menuProducts, rs } from "./arusuvai-menu";
import { PHOTOS } from "./arusuvai-photos";
import { setupArusuvai } from "./arusuvai-setup";
import type { DemoStore } from "./types";

/**
 * Arusuvai Unavagam (அறுசுவை உணவகம்), KK Nagar, Madurai (arusuvai.localhost:3003): the rebuilt restaurant demo shop (it
 * replaced the half-baked `annapoorna`, which was wiped with the owner's approval). A full-service family restaurant on the
 * restaurant app (RS), trade `restaurant`: three dining rooms with 17 tables and a QR code on each (scan, order, the KOT
 * goes to the kitchen), kitchen stations for the kitchen, the tandoor and the beverage counter, a family hall for
 * functions, and an online store for take-away and delivery nearby. Arusuvai (அறுசுவை) is Tamil for "the six tastes".
 * The look is `banana-leaf` (a pale leaf-green page, pomegranate-red buttons, Catamaran over Mukta Malar, standard page
 * with a phone tab bar). The home is built for a dining room, not a delivery app: a hero, a "scan at your table" block
 * with the three steps, a meals-of-the-day board and a daily lunch-window flash sale (11:30 am to 3:30 pm), a category
 * shelf to browse the menu, a sticky story of the Chettinad kitchen, the kitchen team, a family-hall enquiry, a gallery,
 * a review, corporate customers, FAQs, the address and a newsletter.
 *
 * The menu (60 dishes, about 95 orderable portions) is plain data in arusuvai-menu.ts, shared with the history simulator's
 * `restaurant` profile; names are generic (no brands) and prices are typical Madurai dine-in prices in 2026, GST included.
 * Address, phone, GSTIN (valid check digit) and the FSSAI number are placeholders like the other demo shops. The staff
 * (a manager, a cashier, two captains, a head cook and a tandoor master) are set up in arusuvai-setup.ts.
 *
 * GST: restaurant service (SAC 996331) from a stand-alone restaurant: 5% (CGST 2.5% + SGST 2.5%) without input tax credit.
 * The 3rd September 2025 GST Council meeting and CGST notification 15/2025-Central Tax (Rate) of 17 Sept 2025, in force from
 * 22 Sept 2025, rationalised hotel-room and many goods rates but left standalone restaurant service at 5% without ITC
 * (Sr. No. 7(ii) of 11/2017-Central Tax (Rate)); the 18%-with-ITC option exists only for "specified premises" (hotel
 * stays above Rs 7,500 a night), which a stand-alone restaurant cannot choose. Take-away and door delivery of the
 * restaurant's own food are the same service at 5%; orders that come through a food-delivery platform are taxed under
 * section 9(5) (the platform pays the tax). The family hall is let only together with the food (a "party order" at 5%),
 * never on its own: renting out the hall alone would be a separate service at 18%. Sources: busy.in "New GST for
 * Restaurants in India" and Petpooja's "new GST rates on food" (secondary summaries of the 22 Sept 2025 changes).
 */

const PHONE = "+919876500040";
const WHATSAPP = "919876500040";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const HALL_TEXT = "Hello Arusuvai, I would like to book the family hall. Date and time: … Number of guests: … Occasion: … Veg / non-veg menu: …";

const HOURS = [
  { label: "Tiffin", value: "7:00 am - 11:00 am, 4:30 pm - 10:30 pm" },
  { label: "Meals", value: "11:30 am - 3:30 pm" },
  { label: "Tandoor and biryani", value: "12:00 noon - 10:30 pm" },
];
const HOURS_TA = [
  { label: "டிபன்", value: "காலை 7:00 - 11:00, மாலை 4:30 - இரவு 10:30" },
  { label: "மீல்ஸ்", value: "மதியம் 11:30 - 3:30" },
  { label: "தந்தூர், பிரியாணி", value: "மதியம் 12:00 - இரவு 10:30" },
];

const FAQ = [
  {
    q: "How does ordering at the table work?",
    a: "Scan the **QR code on your table** with your phone camera. The menu opens in English or Tamil: pick your dishes, tap **Send to kitchen** and the order goes straight to the kitchen and tandoor. You can add more rounds any time. A captain brings the food and the bill comes to the table; pay at the counter or by UPI.",
  },
  {
    q: "What are the meals timings and how much is the meal?",
    a: "Meals are served on a banana leaf from **11:30 am to 3:30 pm** every day. **Unlimited Veg Meals** is Rs 190, **Mini Meals** Rs 130, chicken meals Rs 260, mutton meals Rs 340 and fish meals Rs 300. Between 11:30 and 3:30 the online store shows the lunch offers.",
  },
  {
    q: "Can I book the family hall for a function?",
    a: "Yes. The **family hall seats up to 60** (tables of 8, 10 and 12, AC) for birthdays, naming ceremonies, small engagements and office lunches. Send the date, count and menu on WhatsApp or use the enquiry form on the home page; we confirm within a day. The hall is let with the food (party orders start at 20 guests).",
  },
  {
    q: "Do you deliver, and can I order take-away online?",
    a: "Yes. Take-away is ready in 20 minutes. We deliver within about 5 km of KK Nagar (Anna Nagar, Thirunagar, Tamukkam, Bypass Road) in 30 to 45 minutes. Biryani and parotta travel best; the tandoor items are best eaten at the table.",
  },
  {
    q: "Is the food vegetarian-safe? Which dishes are veg?",
    a: "Tiffin, meals, the thali and many gravies are **pure vegetarian** and cooked on separate burners with separate ladles, but it is one kitchen. Every dish is marked **green (veg), brown (egg) or red (non-veg)** on the menu and on your order.",
  },
  {
    q: "Do you give GST bills for offices and caterers?",
    a: "Yes. Offices, hospitals, colleges and caterers can have **monthly accounts** with a GST invoice for every order (bulk meals, trays, feasts). Prices include GST at 5%. Ask the cashier or WhatsApp us your GSTIN.",
  },
];

const FAQ_TA = [
  {
    q: "மேசையில் இருந்தே ஆர்டர் செய்வது எப்படி?",
    a: "உங்கள் மேசையில் உள்ள **QR குறியீட்டை** போன் கேமராவால் ஸ்கேன் செய்யுங்கள். மெனு ஆங்கிலம் அல்லது தமிழில் திறக்கும்: உணவுகளைத் தேர்ந்து **சமையலறைக்கு அனுப்பு** என்பதைத் தட்டுங்கள்; ஆர்டர் நேரடியாக சமையலறைக்கும் தந்தூருக்கும் போகும். எப்போது வேண்டுமானாலும் மேலும் சேர்க்கலாம். கேப்டன் உணவைக் கொண்டு வருவார்; பில் மேசைக்கே வரும்; கவுண்டரில் அல்லது UPI-யில் செலுத்தலாம்.",
  },
  {
    q: "மீல்ஸ் நேரம் என்ன, விலை என்ன?",
    a: "மீல்ஸ் தினமும் **காலை 11:30 முதல் மதியம் 3:30 வரை** வாழை இலையில் பரிமாறப்படும். **அன்லிமிடெட் வெஜ் மீல்ஸ்** ரூ 190, **மினி மீல்ஸ்** ரூ 130, சிக்கன் மீல்ஸ் ரூ 260, மட்டன் மீல்ஸ் ரூ 340, மீன் மீல்ஸ் ரூ 300. 11:30 முதல் 3:30 வரை ஆன்லைன் கடையில் மதிய நேரச் சலுகைகள் தெரியும்.",
  },
  {
    q: "விழாவுக்கு ஃபேமிலி ஹாலை முன்பதிவு செய்யலாமா?",
    a: "ஆம். **ஃபேமிலி ஹாலில் 60 பேர் வரை** (8, 10, 12 பேர் மேசைகள், குளிரூட்டப்பட்டது) பிறந்தநாள், பெயர் சூட்டு விழா, சிறிய நிச்சயதார்த்தம், அலுவலக மதிய உணவுக்கு அமரலாம். தேதி, எண்ணிக்கை, மெனுவை வாட்ஸ்அப்பில் அனுப்புங்கள் அல்லது முகப்புப் பக்கப் படிவத்தைப் பயன்படுத்துங்கள்; ஒரு நாளில் உறுதி செய்வோம். ஹால் உணவுடன் மட்டுமே வழங்கப்படும் (பார்ட்டி ஆர்டர் 20 பேரிலிருந்து).",
  },
  {
    q: "டெலிவரி உண்டா? ஆன்லைனில் பார்சல் ஆர்டர் செய்யலாமா?",
    a: "ஆம். பார்சல் 20 நிமிடத்தில் தயார். கே.கே. நகரிலிருந்து சுமார் 5 கிமீ-க்குள் (அண்ணா நகர், திருநகர், தமுக்கம், பைபாஸ் ரோடு) 30 முதல் 45 நிமிடத்தில் டெலிவரி செய்கிறோம். பிரியாணி, பரோட்டா பயணத்துக்கு ஏற்றவை; தந்தூர் உணவுகளை மேசையில் சாப்பிடுவது சிறந்தது.",
  },
  {
    q: "சைவ உணவு பாதுகாப்பானதா? எவை சைவம்?",
    a: "டிபன், மீல்ஸ், தாலி, பல கிரேவிகள் **முழுச் சைவம்**; தனி அடுப்பிலும் தனி கரண்டிகளிலும் சமைக்கிறோம்; ஆனால் இது ஒரே சமையலறை. ஒவ்வொரு உணவும் மெனுவிலும் உங்கள் ஆர்டரிலும் **பச்சை (சைவம்), பழுப்பு (முட்டை), சிவப்பு (அசைவம்)** எனக் குறிக்கப்பட்டிருக்கும்.",
  },
  {
    q: "அலுவலகங்களுக்கும் கேட்டரர்களுக்கும் GST பில் தருவீர்களா?",
    a: "ஆம். அலுவலகங்கள், மருத்துவமனைகள், கல்லூரிகள், கேட்டரர்களுக்கு **மாதக் கணக்கு** வசதி உண்டு; ஒவ்வொரு ஆர்டருக்கும் GST இன்வாய்ஸ் (மொத்த மீல்ஸ், ட்ரேக்கள், ஃபீஸ்ட்). விலையில் 5% GST சேர்ந்தது. கேஷியரிடம் கேளுங்கள் அல்லது உங்கள் GSTIN-ஐ வாட்ஸ்அப்பில் அனுப்புங்கள்.",
  },
];

/** Plain-valued translation helper: no undefined fields (translations are plain values). */
const person = (name: string, role: string, bio: string): Record<string, string> => ({ name, role, bio });

export const ARUSUVAI: DemoStore = {
  shop: {
    slug: "arusuvai",
    appId: "RS",
    businessType: "restaurant",
    planId: "pro",
    name: "Arusuvai Unavagam",
    primary: "#9a1f4b",
    billing: {
      legalName: "Arusuvai Foods",
      gstin: "33AAJFA6241K1ZI",
      address: "14, 80 Feet Road, KK Nagar",
      city: "Madurai",
      pincode: "625020",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "AU",
      upiId: "arusuvai@okicici",
    },
    // The counter bills the dishes themselves: no extra billing items.
    items: [],
  },
  preset: "banana-leaf",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 300_000,
    minOrderValue: 19_900,
    deliveryEnabled: true,
    pickupEnabled: true,
    pickupNote: "Take-away is ready in about 20 minutes at the billing counter on the ground floor. Give your name or order number.",
    contactPhone: PHONE,
    contactEmail: "hello@arusuvai.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/arusuvaiunavagam" },
    policies: {
      shipping:
        "**Dining in?** Scan the QR on your table, no app needed.\n\n**Take-away** is ready in 20 minutes at the counter (pay online to skip the queue).\n\n**Delivery** within about 5 km of KK Nagar: Anna Nagar, Thirunagar, Tamukkam, Bypass Road, in 30-45 min (min order Rs 199, fee Rs 30, free above Rs 599). Party orders and the family hall need a day's notice. Open every day, tiffin from 7 am, meals 11:30 am to 3:30 pm, last order 10:15 pm.",
      returns:
        "Food cannot be returned. If a dish arrives wrong, spilt or cold, send a photo on WhatsApp within 30 minutes and we replace it or refund in full. Dine-in guests: tell your captain and we will change the dish.",
      privacy: "We use your name, phone and address only to serve your order, send your GST bill and confirm hall bookings. We do not share them with anyone else.",
      terms:
        "Prices include GST at 5% (restaurant service, no input tax credit). The family hall is let only with a food order (party orders from 20 guests); 50% advance on confirmation, the rest at the end of the function. FSSAI licence: 12345678901234 (placeholder).",
    },
    businessType: "restaurant",
  },
  zones: [
    {
      name: "KK Nagar, Anna Nagar, Thirunagar, Tamukkam (30-40 min)",
      pincodePrefixes: ["62502", "62500"],
      rate: { name: "Delivery in 30-40 min, min order Rs 199", type: "free_above", amount: 3_000, freeAbove: 59_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Madurai city (40-50 min)",
      pincodePrefixes: ["6250", "6251", "6256"],
      rate: { name: "Delivery in 40-50 min, min order Rs 299", type: "free_above", amount: 5_900, freeAbove: 79_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Madurai party orders (a day ahead)",
      pincodePrefixes: ["625"],
      rate: { name: "Scheduled party delivery, order a day ahead", type: "free_above", amount: 14_900, freeAbove: 250_000, etaMinDays: 1, etaMaxDays: 1, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CAT.tiffin, description: "Idli, vada, pongal and a dozen dosas, hot from the tawa from 7 am and again from 4:30 pm.", photo: 5560763 },
    { name: CAT.meals, description: "Unlimited banana-leaf meals, the Arusuvai thali and non-veg meals, every day 11:30 am to 3:30 pm.", photo: 5410418 },
    { name: CAT.biryani, description: "Seeraga samba dum biryani in regular and large portions, and fried rice.", photo: 12392831 },
    { name: CAT.chettinad, description: "Fresh parotta, kothu parotta and Chettinad gravies: pepper chicken, kozhi varuval and mutton chukka.", photo: 9609857 },
    { name: CAT.tandoor, description: "Tandoori chicken, tikkas and breads from the clay oven, from noon.", photo: 9792458 },
    { name: CAT.starters, description: "Chicken 65, fish fry, paneer 65 and chaat for the table.", photo: 17050759 },
    { name: CAT.beverages, description: "Filter coffee, Madurai jigarthanda, rose milk, buttermilk, lassi and fresh juices.", photo: 16128085 },
    { name: CAT.desserts, description: "Payasam, gulab jamun, rava kesari, carrot halwa and falooda.", photo: 31109623 },
    { name: CAT.family, description: "Feasts for four, a tandoor platter for two and party trays for 10 or 20.", photo: 9266190 },
  ],
  products: menuProducts(),
  collections: [
    { name: "New on the menu", slug: "new-in", description: "Fresh on the menu this month.", rule: { sort: "new" } },
    { name: "Meals of the day", slug: "meals-of-the-day", description: "Banana-leaf meals, the thali and the sides that go with them, 11:30 am to 3:30 pm.", rule: { tag: "lunch", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Madurai orders again and again.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Veg menu", slug: "veg", description: "Every vegetarian dish, marked green.", rule: { tag: "veg", sort: "price-asc" } },
    { name: "Non-veg menu", slug: "non-veg", description: "Chicken, mutton and fish dishes, marked red.", rule: { tag: "non-veg", sort: "price-asc" } },
    { name: "Chettinad", slug: "chettinad", description: "Pepper, kalpasi and marathi mokku: the Chettinad kitchen.", rule: { tag: "chettinad", sort: "price-asc" } },
    { name: "Madurai specials", slug: "madurai-specials", description: "Kari dosa, kal dosa and jigarthanda, the way Madurai makes them.", rule: { tag: "madurai", sort: "price-asc" } },
    { name: "Family feasts", slug: "family-feasts", description: "Feasts for four and trays for the table.", rule: { tag: "family", sort: "price-asc" } },
    { name: "Dinner on the tandoor", slug: "tandoor-night", description: "Tandoori chicken, tikkas, naan and biryani for the evening.", rule: { tag: "dinner", sort: "price-asc" } },
    { name: "Spicy", slug: "spicy", description: "For people who like their food hot.", rule: { tag: "spicy", sort: "price-asc" } },
    { name: "Lunch offers", slug: "lunch-offers", description: "Meals priced below the menu card during the lunch window.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    { code: "FIRST50", description: "Rs 50 off your first online order above Rs 399", type: "flat", value: 5_000, minOrder: 39_900, channels: ["store"] },
    { code: "FAMILY10", description: "10% off a family feast or party tray (up to Rs 300)", type: "percent", value: 10, minOrder: 99_900, maxDiscount: 30_000, channels: ["store"] },
    { code: "PARTY5", description: "Party orders: 5% off above Rs 5,000 (up to Rs 1,000)", type: "percent", value: 5, minOrder: 500_000, maxDiscount: 100_000, channels: ["store", "manual"] },
  ],
  home: ({ photo, category }) => ({
    seo: {
      title: "Arusuvai Unavagam, KK Nagar Madurai: meals, Chettinad and tandoor",
      description:
        "Family restaurant in KK Nagar, Madurai: unlimited banana-leaf meals, Chettinad parotta and gravies, dum biryani and tandoor. Order from your table by QR, book the family hall, or order take-away online.",
      imageUrl: photo(31774138),
    },
    sections: [
      {
        type: "hero",
        id: "au-hero",
        slides: [
          {
            imageUrl: photo(31774138),
            heading: "Madurai meals, Chettinad curries and a tandoor that never cools.",
            subheading: "A family restaurant on 80 Feet Road, KK Nagar. Tiffin from 7 am, banana-leaf meals at noon, biryani and tandoor till 10:30 pm.",
            cta: { label: "See the menu", href: "/collections/bestsellers" },
          },
          {
            imageUrl: photo(5410418),
            heading: "Unlimited meals on a banana leaf, every day 11:30 to 3:30.",
            subheading: "Rice, sambar, kuzhambu, rasam, two poriyals, kootu, curd and payasam, with refills until you say stop.",
            cta: { label: "Meals of the day", href: "/collections/meals-of-the-day" },
          },
        ],
      },
      {
        type: "image-text",
        id: "au-qr",
        imageUrl: photo(24499488, "tile"),
        imageSide: "right",
        heading: "Dining in? Scan the QR on your table.",
        markdown:
          "No waiting for the menu, no waving at the captain.\n\n1. **Scan** the code on your table with your phone camera (no app to install).\n2. **Order**: pick dishes in English or Tamil, choose a portion and tap *Send to kitchen*.\n3. **Add more** whenever you like. The kitchen and the tandoor get each round at once, and your captain brings it.\n\nThe bill comes to the table in one tap: pay at the counter or by UPI, with a GST invoice if you need one.",
        cta: { label: "How table ordering works", href: "/pages/dine-in" },
      },
      {
        type: "menu-board",
        id: "au-board",
        title: "Meals of the day, 11:30 am to 3:30 pm",
        groups: [
          {
            name: "On the banana leaf",
            items: [
              { name: "Unlimited Veg Meals", description: "Rice, sambar, kuzhambu, rasam, kootu, 2 poriyals, curd, payasam", price: rs(190), diet: "veg" },
              { name: "Mini Meals", description: "One round with sambar, rasam, poriyal, kootu and curd", price: rs(130), diet: "veg" },
              { name: "Arusuvai Special Thali", description: "Two rice, three curries, parotta, raita and a sweet", price: rs(280), diet: "veg" },
              { name: "Chicken Meals", description: "Chettinad chicken curry with the full meal", price: rs(260), diet: "nonveg" },
              { name: "Mutton Meals", description: "Madurai mutton kuzhambu and chukka", price: rs(340), diet: "nonveg" },
              { name: "Fish Meals", description: "Tamarind fish kuzhambu and a fried fish slice", price: rs(300), diet: "nonveg" },
            ],
          },
          {
            name: "With your meal",
            items: [
              { name: "Butter Milk", description: "Spiced, with curry leaf and ginger", price: rs(40), diet: "veg" },
              { name: "Medu Vada (2 pcs)", description: "Crisp outside, fluffy inside", price: rs(55), diet: "veg" },
              { name: "Semiya Payasam", description: "Warm, with cashew and raisin", price: rs(70), diet: "veg" },
              { name: "Egg Masala", description: "Boiled eggs in onion-tomato masala", price: rs(120), diet: "egg" },
            ],
          },
        ],
        cta: { label: "Order meals for take-away", href: "/collections/meals-of-the-day" },
      },
      {
        type: "flash-sale",
        id: "au-lunch",
        title: "Lunch window offers, 11:30 to 3:30",
        text: "Every day between 11:30 and 3:30 the meals are priced below the menu card. Dine in, take away or order online before it closes.",
        endsAt: "2027-12-31T23:59:00+05:30",
        daily: { from: "11:30", to: "15:30" },
        source: "collection",
        collectionSlug: "lunch-offers",
        layout: "carousel",
        limit: 8,
        cta: { label: "See the lunch offers", href: "/collections/lunch-offers" },
      },
      {
        type: "category-shelf",
        id: "au-shelf",
        title: "Order from the menu",
        showImages: true,
        limit: 8,
      },
      {
        type: "sticky-story",
        id: "au-story",
        title: "Four things we do the slow way",
        imageSide: "left",
        chapters: [
          {
            eyebrow: "01 · The masala",
            heading: "Ground every morning, never from a packet.",
            markdown: "Kalpasi, marathi mokku, fennel, pepper and dried chilli are roasted on the iron kadai at 6 am and ground in the stone grinder. The Chettinad chicken, kozhi varuval and mutton chukka all start from that one masala.",
            imageUrl: photo(8408994, "tile"),
            alt: "Mutton chukka in a steel tray on a wooden board",
            cta: { label: "Chettinad dishes", href: "/collections/chettinad" },
          },
          {
            eyebrow: "02 · The dum",
            heading: "Seeraga samba, sealed and left alone for an hour.",
            markdown: "We use short-grain seeraga samba rice, country chicken or mutton on the bone, mint and whole spices, sealed with dough and cooked on a low flame. Nothing is stirred until the table is ready.",
            imageUrl: photo(12392831, "tile"),
            alt: "South Indian biryani on a banana leaf with sides",
            cta: { label: "Biryani and rice", href: "/c/biryani-and-rice" },
          },
          {
            eyebrow: "03 · The tandoor",
            heading: "A clay oven that is lit at 11 and never switched off.",
            markdown: "Chicken marinates overnight in curd and Kashmiri chilli. Naan is stretched by hand and stuck to the wall of the tandoor. Sheik Abdullah has run our tandoor for twelve years.",
            imageUrl: photo(9792458, "tile"),
            alt: "An Indian spread with tandoori chicken and curries",
            cta: { label: "Tandoor menu", href: "/c/tandoor" },
          },
          {
            eyebrow: "04 · The leaf",
            heading: "Lunch is still served on a banana leaf.",
            markdown: "The leaf is cut fresh each morning, wiped and laid with the salt and pickle first, as it has been since the first Arusuvai in 1998. The refills come until you wave them away.",
            imageUrl: photo(5410418, "tile"),
            alt: "A banana-leaf meal with rice, curries, poriyal and appalam",
            cta: { label: "Meals of the day", href: "/c/meals" },
          },
        ],
      },
      {
        type: "team",
        id: "au-team",
        title: "The people in the kitchen and on the floor",
        text: "The same faces, most of them for more than ten years.",
        members: [
          { name: "Karthikeyan Alagarsamy", role: "Owner and manager", bio: "Third generation. Opens the shutter at 6 am and tastes the sambar before anyone else." },
          { name: "Muniyandi Kalimuthu", role: "Head cook", bio: "Twenty-two years on the Chettinad masala; the reason the kozhi varuval tastes the same every day." },
          { name: "Sheik Abdullah", role: "Tandoor master", bio: "Runs the clay oven: tandoori chicken, tikkas and the naan that comes with them." },
          { name: "Pandiselvam Ramar", role: "Captain", bio: "Knows the regulars' orders and which table wants the extra papad." },
        ],
      },
      {
        type: "appointment",
        id: "au-hall",
        heading: "Family hall and party enquiry",
        text: "An air-conditioned hall for birthdays, naming ceremonies, small engagements and office lunches. Tell us the date and count; we reply within a day with the menu and the quote.",
        services: [
          { name: "Family lunch (up to 40 guests)", duration: "3 hours" },
          { name: "Birthday or naming ceremony (up to 60)", duration: "4 hours" },
          { name: "Office lunch or team dinner (20 to 40)", duration: "2 hours" },
        ],
        cta: { label: "Enquire on WhatsApp", href: waLink(HALL_TEXT) },
      },
      {
        type: "gallery",
        id: "au-gallery",
        title: "A look inside",
        layout: "masonry",
        images: [
          { url: photo(31774138, "tile"), alt: "A rustic open-air restaurant with wooden tables and greenery", caption: "Open pavilion" },
          { url: photo(5560763, "square"), alt: "Dosa with chutneys and sambar on banana leaves", caption: "Ghee roast" },
          { url: photo(24499488, "tile"), alt: "A restaurant interior with elegant furniture and lighting", caption: "AC hall" },
          { url: photo(9609840, "square"), alt: "Chicken biryani in a brass bowl", caption: "Dum biryani" },
          { url: photo(35631350, "tile"), alt: "A restaurant interior with wooden furniture", caption: "Ground floor" },
          { url: photo(8414670, "square"), alt: "Paneer tikka skewers on a white plate", caption: "From the tandoor" },
          { url: photo(10456027, "tile"), alt: "An elegant dining room with globe pendant lights", caption: "Family hall" },
          { url: photo(31109623, "square"), alt: "A bowl of kheer-style payasam with nuts", caption: "Payasam" },
        ],
      },
      {
        type: "testimonials",
        id: "au-reviews",
        title: "From our tables",
        layout: "single",
        items: [
          { quote: "We have lunch here every Sunday. The meals are unlimited, the sambar tastes like my grandmother's, and the captain remembers that my father wants no sugar in the payasam. Scanning the QR for extra vadas is a small thing but very handy.", name: "Revathi S.", role: "Anna Nagar, Madurai", rating: 5 },
          { quote: "Booked the family hall for my daughter's naming ceremony: 45 guests, one WhatsApp message, a clear quote the next morning. The food came hot, on time, and the bill was one GST invoice.", name: "Balamurugan K.", role: "KK Nagar", rating: 5 },
          { quote: "The kozhi varuval and kothu parotta are the reason we drive in from Thirumangalam. Hot, dark and peppery, exactly as it should be.", name: "Anitha R.", role: "Thirumangalam", rating: 5 },
        ],
      },
      {
        type: "logos",
        id: "au-clients",
        title: "Lunch accounts we serve every day",
        grayscale: true,
        items: [{ name: "Vaigai Software Park" }, { name: "Meenakshi Hospital" }, { name: "Pandian Textiles" }, { name: "KK Nagar Engineering College" }, { name: "Alagar Function Caterers" }],
      },
      { type: "faq", id: "au-faq", title: "Table ordering, meals and the family hall", items: FAQ },
      {
        type: "location",
        id: "au-location",
        title: "Find us on 80 Feet Road",
        address: "14, 80 Feet Road, KK Nagar, Madurai 625020. Parking in front and behind. The family hall is on the first floor (lift).",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "9.9371, 78.1457",
      },
      {
        type: "newsletter",
        id: "au-news",
        layout: "inline",
        heading: "The weekend specials, on Friday",
        text: "Mutton kuzhambu Sunday? Fish fry Saturday? One short message every Friday, no spam.",
      },
    ],
    translations: {
      ta: {
        "au-hero": {
          slides: [
            {
              heading: "மதுரை மீல்ஸ், செட்டிநாடு கறிகள், என்றும் சூடான தந்தூர்.",
              subheading: "கே.கே. நகர், 80 அடி சாலையில் ஒரு குடும்ப உணவகம். காலை 7 முதல் டிபன், மதியம் வாழை இலை மீல்ஸ், இரவு 10:30 வரை பிரியாணி, தந்தூர்.",
              cta: { label: "மெனுவைப் பார்" },
            },
            {
              heading: "தினமும் 11:30 முதல் 3:30 வரை வாழை இலையில் அன்லிமிடெட் மீல்ஸ்.",
              subheading: "சாதம், சாம்பார், குழம்பு, ரசம், இரண்டு பொரியல், கூட்டு, தயிர், பாயசம்; போதும் என்று சொல்லும் வரை பரிமாறுவோம்.",
              cta: { label: "இன்றைய மீல்ஸ்" },
            },
          ],
        },
        "au-qr": {
          heading: "உணவகத்தில் அமர்ந்திருக்கிறீர்களா? மேசையில் உள்ள QR-ஐ ஸ்கேன் செய்யுங்கள்.",
          markdown:
            "மெனுவுக்காகக் காத்திருக்க வேண்டாம், கேப்டனை அழைக்கவும் வேண்டாம்.\n\n1. உங்கள் மேசையில் உள்ள குறியீட்டை போன் கேமராவால் **ஸ்கேன்** செய்யுங்கள் (செயலி தேவையில்லை).\n2. **ஆர்டர்**: ஆங்கிலம் அல்லது தமிழில் உணவுகளைத் தேர்ந்து, அளவைத் தேர்ந்து *சமையலறைக்கு அனுப்பு* என்பதைத் தட்டுங்கள்.\n3. எப்போது வேண்டுமானாலும் **மேலும் சேர்க்கலாம்**. ஒவ்வொரு சுற்றும் சமையலறைக்கும் தந்தூருக்கும் உடனே போகும்; கேப்டன் கொண்டு வருவார்.\n\nபில் ஒரு தட்டலில் மேசைக்கு வரும்: கவுண்டரில் அல்லது UPI-யில் செலுத்துங்கள்; தேவைப்பட்டால் GST இன்வாய்ஸும் கிடைக்கும்.",
          cta: { label: "மேசை ஆர்டர் எப்படி வேலை செய்கிறது" },
        },
        "au-board": {
          title: "இன்றைய மீல்ஸ், காலை 11:30 முதல் மதியம் 3:30 வரை",
          groups: [
            {
              name: "வாழை இலையில்",
              items: [
                { name: "அன்லிமிடெட் வெஜ் மீல்ஸ்", description: "சாதம், சாம்பார், குழம்பு, ரசம், கூட்டு, 2 பொரியல், தயிர், பாயசம்" },
                { name: "மினி மீல்ஸ்", description: "ஒரு சுற்று சாம்பார், ரசம், பொரியல், கூட்டு, தயிருடன்" },
                { name: "அறுசுவை ஸ்பெஷல் தாலி", description: "இரண்டு சாதம், மூன்று கறி, பரோட்டா, ரைத்தா, இனிப்பு" },
                { name: "சிக்கன் மீல்ஸ்", description: "முழு மீல்ஸுடன் செட்டிநாடு சிக்கன் கறி" },
                { name: "மட்டன் மீல்ஸ்", description: "மதுரை மட்டன் குழம்பு, சுக்கா" },
                { name: "மீன் மீல்ஸ்", description: "புளி மீன் குழம்பு, ஒரு மீன் வறுவல்" },
              ],
            },
            {
              name: "மீல்ஸுடன்",
              items: [
                { name: "மோர்", description: "கறிவேப்பிலை, இஞ்சியுடன் மசாலா மோர்" },
                { name: "மெது வடை (2)", description: "வெளியே மொறுமொறு, உள்ளே மென்மை" },
                { name: "சேமியா பாயசம்", description: "முந்திரி, திராட்சையுடன் சூடாக" },
                { name: "முட்டை மசாலா", description: "வெங்காய தக்காளி மசாலாவில் வேகவைத்த முட்டை" },
              ],
            },
          ],
          cta: { label: "பார்சலுக்கு மீல்ஸ் ஆர்டர் செய்" },
        },
        "au-lunch": {
          title: "மதிய நேரச் சலுகைகள், 11:30 முதல் 3:30 வரை",
          text: "தினமும் 11:30 முதல் 3:30 வரை மீல்ஸ் மெனு கார்டு விலைக்குக் கீழே கிடைக்கும். அமர்ந்து சாப்பிடலாம், பார்சல் வாங்கலாம் அல்லது நேரம் முடியும் முன் ஆன்லைனில் ஆர்டர் செய்யலாம்.",
          cta: { label: "மதிய சலுகைகளைப் பார்" },
        },
        "au-shelf": { title: "மெனுவிலிருந்து ஆர்டர் செய்யுங்கள்" },
        "au-story": {
          title: "நாங்கள் மெதுவாகச் செய்யும் நான்கு விஷயங்கள்",
          chapters: [
            {
              eyebrow: "01 · மசாலா",
              heading: "தினமும் காலையில் அரைத்தது, பாக்கெட்டில் வாங்கியதல்ல.",
              markdown: "கல்பாசி, மராட்டி மொக்கு, சோம்பு, மிளகு, காய்ந்த மிளகாய் காலை 6 மணிக்கு இரும்புக் கடாயில் வறுத்து கல் உரலில் அரைக்கப்படுகின்றன. செட்டிநாடு சிக்கன், கோழி வறுவல், மட்டன் சுக்கா எல்லாம் இந்த ஒரே மசாலாவில் தொடங்குகின்றன.",
              cta: { label: "செட்டிநாடு உணவுகள்" },
            },
            {
              eyebrow: "02 · தம்",
              heading: "சீரகச் சம்பா, மூடி ஒரு மணி நேரம் தொடாமல்.",
              markdown: "குட்டை அரிசி சீரகச் சம்பா, நாட்டுக்கோழி அல்லது எலும்புடன் மட்டன், புதினா, முழு மசாலாக்களை மாவால் மூடி மெல்லிய தீயில் சமைக்கிறோம். மேசை தயாராகும் வரை எதையும் கிளறுவதில்லை.",
              cta: { label: "பிரியாணி, சாதம்" },
            },
            {
              eyebrow: "03 · தந்தூர்",
              heading: "காலை 11-க்கு ஏற்றி, அணைக்கப்படாத களிமண் அடுப்பு.",
              markdown: "சிக்கன் இரவு முழுவதும் தயிர், காஷ்மீரி மிளகாயில் ஊறும். நான் கையால் விரித்து தந்தூர் சுவரில் ஒட்டப்படும். ஷேக் அப்துல்லா பன்னிரண்டு ஆண்டுகளாக எங்கள் தந்தூரை நடத்துகிறார்.",
              cta: { label: "தந்தூர் மெனு" },
            },
            {
              eyebrow: "04 · இலை",
              heading: "மதிய உணவு இன்னும் வாழை இலையில்தான்.",
              markdown: "1998-இல் முதல் அறுசுவை தொடங்கியதிலிருந்து போலவே, இலை தினமும் காலை புதிதாக வெட்டி, துடைத்து, உப்பு, ஊறுகாயை முதலில் வைத்துப் பரிமாறுகிறோம். நீங்கள் கை காட்டும் வரை பரிமாறுவோம்.",
              cta: { label: "இன்றைய மீல்ஸ்" },
            },
          ],
        },
        "au-team": {
          title: "சமையலறையிலும் உணவறையிலும் இருப்பவர்கள்",
          text: "அதே முகங்கள்; பலர் பத்து ஆண்டுகளுக்கு மேலாக.",
          members: [
            person("கார்த்திகேயன் அழகர்சாமி", "உரிமையாளர், மேலாளர்", "மூன்றாம் தலைமுறை. காலை 6 மணிக்குக் கடையைத் திறந்து, யாருக்கும் முன்பு சாம்பாரை ருசிப்பவர்."),
            person("முனியாண்டி காளிமுத்து", "தலைமைச் சமையல்காரர்", "இருபத்திரண்டு ஆண்டுகளாக செட்டிநாடு மசாலாவில்; கோழி வறுவல் தினமும் ஒரே சுவையாக இருப்பதற்குக் காரணம்."),
            person("ஷேக் அப்துல்லா", "தந்தூர் மாஸ்டர்", "களிமண் அடுப்பை நடத்துபவர்: தந்தூரி சிக்கன், டிக்கா, அவற்றுடன் வரும் நான்."),
            person("பாண்டிச்செல்வம் ராமர்", "கேப்டன்", "வழக்கமாக வருபவர்களின் ஆர்டர் தெரியும்; எந்த மேசைக்கு கூடுதல் அப்பளம் வேண்டும் என்பதும்."),
          ],
        },
        "au-hall": {
          heading: "ஃபேமிலி ஹால், பார்ட்டி விசாரணை",
          text: "பிறந்தநாள், பெயர் சூட்டு விழா, சிறிய நிச்சயதார்த்தம், அலுவலக மதிய உணவுக்கான குளிரூட்டப்பட்ட ஹால். தேதி, எண்ணிக்கையைச் சொல்லுங்கள்; ஒரு நாளில் மெனுவுடன் விலைப்பட்டியல் அனுப்புவோம்.",
          services: [
            { name: "குடும்ப மதிய விருந்து (40 பேர் வரை)", duration: "3 மணி நேரம்" },
            { name: "பிறந்தநாள் அல்லது பெயர் சூட்டு விழா (60 பேர் வரை)", duration: "4 மணி நேரம்" },
            { name: "அலுவலக மதிய உணவு அல்லது குழு இரவு உணவு (20 முதல் 40)", duration: "2 மணி நேரம்" },
          ],
          cta: { label: "வாட்ஸ்அப்பில் விசாரி" },
        },
        "au-gallery": {
          title: "உள்ளே ஒரு பார்வை",
          images: [
            { alt: "ஓட்டுக் கூரையும் தோட்டமும் கொண்ட திறந்த உணவு மண்டபம்", caption: "திறந்த மண்டபம்" },
            { alt: "சட்னிகளுடன் தட்டில் நீளமான மொறுமொறு நெய் ரோஸ்ட் தோசைகள்", caption: "நெய் ரோஸ்ட்" },
            { alt: "சட்டமிட்ட ஓவியங்கள், பித்தளை விளக்குகளின் கீழ் உணவு மேசைகள்", caption: "ஏசி ஹால்" },
            { alt: "பித்தளைக் கிண்ணத்தில் சிக்கன் பிரியாணி", caption: "தம் பிரியாணி" },
            { alt: "ஜன்னல் அருகே வரிசையாக அமைக்கப்பட்ட மேசைகள்", caption: "தரைத் தளம்" },
            { alt: "வெள்ளைத் தட்டில் பன்னீர் டிக்கா குச்சிகள்", caption: "தந்தூரிலிருந்து" },
            { alt: "மரத் திரைகளும் தொங்கும் விளக்குகளும் கொண்ட உணவகம்", caption: "ஃபேமிலி ஹால்" },
            { alt: "கிண்ணத்தில் சேமியா பாயசம்", caption: "பாயசம்" },
          ],
        },
        "au-reviews": {
          title: "எங்கள் மேசைகளிலிருந்து",
          items: [
            { quote: "ஒவ்வொரு ஞாயிறும் இங்கேதான் மதிய உணவு. மீல்ஸ் அன்லிமிடெட், சாம்பார் என் பாட்டி செய்தது போல; என் அப்பாவுக்குப் பாயசத்தில் சர்க்கரை வேண்டாம் என்று கேப்டனுக்கு நினைவிருக்கிறது. கூடுதல் வடைக்கு QR ஸ்கேன் செய்வது சிறிய விஷயம், ஆனால் மிகவும் வசதி.", name: "ரேவதி எஸ்.", role: "அண்ணா நகர், மதுரை" },
            { quote: "மகளின் பெயர் சூட்டு விழாவுக்கு ஃபேமிலி ஹால் முன்பதிவு செய்தேன்: 45 பேர், ஒரே வாட்ஸ்அப் செய்தி, மறுநாள் காலை தெளிவான விலைப்பட்டியல். உணவு சூடாக, சரியான நேரத்தில் வந்தது; பில் ஒரே GST இன்வாய்ஸ்.", name: "பாலமுருகன் கே.", role: "கே.கே. நகர்" },
            { quote: "கோழி வறுவலும் கொத்து பரோட்டாவும்தான் திருமங்கலத்திலிருந்து நாங்கள் வருவதற்குக் காரணம். சூடாக, கருமையாக, மிளகு மணத்துடன், இருக்க வேண்டியபடியே.", name: "அனிதா ஆர்.", role: "திருமங்கலம்" },
          ],
        },
        "au-clients": {
          title: "தினமும் மதிய உணவு வழங்கும் நிறுவனங்கள்",
          items: [{ name: "வைகை சாஃப்ட்வேர் பார்க்" }, { name: "மீனாட்சி மருத்துவமனை" }, { name: "பாண்டியன் டெக்ஸ்டைல்ஸ்" }, { name: "கே.கே. நகர் பொறியியல் கல்லூரி" }, { name: "அழகர் விருந்து கேட்டரர்ஸ்" }],
        },
        "au-faq": { title: "மேசை ஆர்டர், மீல்ஸ், ஃபேமிலி ஹால்", items: FAQ_TA },
        "au-location": {
          title: "80 அடி சாலையில் எங்களைக் காணுங்கள்",
          address: "14, 80 அடி சாலை, கே.கே. நகர், மதுரை 625020. முன்புறமும் பின்புறமும் வாகன நிறுத்தம். ஃபேமிலி ஹால் முதல் தளத்தில் (லிஃப்ட் உண்டு).",
          hours: HOURS_TA,
        },
        "au-news": {
          heading: "வார இறுதிச் சிறப்புகள், வெள்ளிக்கிழமையே",
          text: "ஞாயிறு மட்டன் குழம்பா? சனிக்கிழமை மீன் வறுவலா? ஒவ்வொரு வெள்ளியும் ஒரு குறுஞ்செய்தி, தொல்லை இல்லை.",
        },
      },
    },
  }),
  pages: [
    {
      slug: "about",
      title: "Our story",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Arusuvai Unavagam, KK Nagar, Madurai" },
        {
          type: "paragraph",
          markdown:
            "Arusuvai (அறுசுவை) means **the six tastes**: sweet, sour, salt, bitter, pungent and astringent, which a Tamil meal is meant to carry in one sitting. We opened in **1998** as a 12-table mess on Pykara Road and moved to 80 Feet Road, KK Nagar, in 2011, with three dining rooms, a tandoor and a family hall.\n\nWe still serve lunch on a banana leaf, still grind the Chettinad masala every morning and still run a small monthly account for the offices and hospitals nearby.",
        },
        { type: "image", url: photo(24499488, "tile"), alt: "A restaurant interior with elegant furniture and lighting" },
        { type: "paragraph", markdown: "Open every day, tiffin from 7 am, meals 11:30 am to 3:30 pm, last order 10:15 pm. Call or WhatsApp **+91 98765 00040**." },
      ],
    },
    {
      slug: "dine-in",
      title: "Ordering at your table",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Scan, order, relax" },
        {
          type: "paragraph",
          markdown:
            "Every one of our 17 tables has a QR code. Scan it with your phone camera (no app) and the menu opens in English or Tamil, already on **your table**.\n\n1. Pick dishes and portions (half or full, regular or large).\n2. Tap **Send to kitchen**. Tandoor dishes go to the tandoor, drinks to the beverage counter and the rest to the kitchen, each on its own ticket.\n3. Add another round whenever you like; your captain brings each one.\n4. Ask for the bill at the table. Pay at the counter or by UPI; a GST invoice is printed for every bill.",
        },
        { type: "image", url: photo(35631350, "tile"), alt: "A restaurant interior with wooden furniture" },
        {
          type: "paragraph",
          markdown: "**Tables:** ground floor T1 to T8 (2 and 4 seats), AC hall A1 to A6 (4 and 6 seats), family hall F1 to F3 (8, 10 and 12 seats).",
        },
      ],
    },
    {
      slug: "family-hall",
      title: "Family hall and party orders",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "An AC hall for up to 60 guests" },
        {
          type: "paragraph",
          markdown:
            "| Menu | Price per guest | Minimum |\n|---|---|---|\n| Veg banana-leaf meals | Rs 220 | 20 guests |\n| Veg biryani, starters and payasam | Rs 300 | 20 guests |\n| Chicken biryani lunch with chicken 65 | Rs 360 | 20 guests |\n| Non-veg feast (biryani, Chettinad, tandoor, sweet) | Rs 480 | 20 guests |\n\nPrices include 5% GST. The hall is let with the food: there is no separate hall charge on parties of 30 or more. Smaller groups of 20 to 29 pay a Rs 3,000 hall charge (billed with the food).",
        },
        { type: "image", url: photo(10456027, "tile"), alt: "An elegant dining room with globe pendant lights" },
        { type: "heading", level: 3, text: "How to book" },
        {
          type: "paragraph",
          markdown:
            "1. Send the date, time, count and occasion on WhatsApp or use the enquiry on the home page.\n2. We reply within a day with a menu and a quote.\n3. Pay **50% advance** to confirm; the rest at the end of the function by UPI or cash.\n4. Take-home trays are packed in sealed containers: ask for a **Party Tray** for 10 or 20.",
        },
        { type: "button", label: "Enquire about the family hall", href: waLink(HALL_TEXT), style: "primary" },
      ],
    },
    {
      slug: "hygiene",
      title: "Hygiene and FSSAI",
      blocks: () => [
        { type: "heading", level: 2, text: "How we keep the kitchen clean" },
        {
          type: "paragraph",
          markdown:
            "- **FSSAI licence:** 12345678901234 (placeholder for this demo), displayed at the counter.\n- **Staff:** a food-handler medical check every year, caps and aprons on the line, hand-wash stations at the kitchen door.\n- **Veg and non-veg:** separate burners, ladles and boards; one kitchen, so not a pure-veg kitchen.\n- **Oil:** changed daily on the fry station and never reused for the second day.\n- **Water:** RO-filtered for cooking and drinking.",
        },
        { type: "paragraph", markdown: "Found something wrong with your food? Tell your captain, or message us on WhatsApp within 30 minutes with a photo." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). They illustrate similar dishes and rooms and are not photographs of our own food.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Tiffin", type: "category", ref: "tiffin" },
      { label: "Meals", type: "category", ref: "meals" },
      { label: "Biryani & rice", type: "category", ref: "biryani-and-rice" },
      { label: "Chettinad", type: "category", ref: "parotta-and-chettinad" },
      { label: "Tandoor", type: "category", ref: "tandoor" },
      {
        label: "More",
        type: "category",
        ref: "starters-and-chaat",
        children: [
          { label: "Beverages", type: "category", ref: "beverages" },
          { label: "Desserts", type: "category", ref: "desserts" },
          { label: "Family & party", type: "category", ref: "family-and-party" },
        ],
      },
      { label: "Family hall", type: "page", ref: "family-hall" },
    ],
    footer: [
      {
        label: "Order",
        type: "url",
        children: [
          { label: "Meals of the day", type: "collection", ref: "meals-of-the-day" },
          { label: "Madurai specials", type: "collection", ref: "madurai-specials" },
          { label: "Family feasts", type: "collection", ref: "family-feasts" },
          { label: "Track your order", type: "url", href: "/track" },
        ],
      },
      {
        label: "Restaurant",
        type: "url",
        children: [
          { label: "Our story", type: "page", ref: "about" },
          { label: "Ordering at your table", type: "page", ref: "dine-in" },
          { label: "Hygiene and FSSAI", type: "page", ref: "hygiene" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  setup: setupArusuvai,
};
