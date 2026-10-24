import { AC, HOME, LAPTOP, PARTS, PHONE_POWER, PHONE_SCREEN, PICKUP, PLANS, PRODUCTS, TV, WATER } from "./quickfix-products";
import type { DemoStore } from "./types";

/**
 * QuickFix Mobile Care, Gandhipuram, Coimbatore (quickfix.localhost:3003; admin and counter quickfix.localhost:3008).
 * The services app (SV) with the `repair` trade and the "repair-bench" look (theme-presets-quickfix.ts): a repair-first
 * service desk for phones, laptops, TVs, ACs and washing machines, with job cards (intake, estimate, customer approval,
 * parts and labour, advance, bill, tracking at /job/<code>), serial-tracked parts with warranty, annual care plans and
 * pickups. It sells repairs by problem (the finder asks what is broken), unlike Kaipesi (#13), which is an accessories
 * counter with a repair corner. Page layout: category rail without the bottom tab bar (every one of the 8 rail / sidebar /
 * magazine / standard x tabs / off combinations was already taken; rail + off is shared with Malligai only, a flower
 * shop). Names are generic, no brands. Address, phone, GSTIN and the BIS R-numbers are demo placeholders.
 *
 * GST (verified against the SAC list for heading 9987, "maintenance, repair and installation (except construction)
 * services", https://busy.in/sac-code-9987 and https://mybillbook.in/s/sac-code/maintenance-services-sac-code-9987/, 18%
 * in the GST rate schedule, notification 11/2017-Central Tax (Rate) as amended; unchanged by the 22 Sept 2025 rate
 * rationalisation, CGST notification 9/2025-Central Tax (Rate), which folded 12% and 28% goods into 5% and 18%):
 * - phones and tablets: 998716 maintenance and repair of telecommunication equipment and apparatus (the older demo
 *   labour items of this shop use 998713, computers; both 18%);
 * - laptops, desktops, data work: 998713 maintenance and repair of computers and peripheral equipment;
 * - TVs, ACs, washing machines, fridges, RO: 998715 maintenance and repair of (electrical) household appliances;
 * - a repair with parts is a composite supply taxed as the repair (18%); plans (AMC) are the same SAC as what they cover.
 * Parts, by HSN, all 18% (residual schedule of 9/2025): lithium batteries 8507 60 00; flat-panel display modules 8524
 * (92 for OLED with drivers); data-storage SSDs 8523 51; memory modules 8473 30; laptop adapters 8504 40 30; TV
 * backlight and other TV parts 8529 90; capacitors 8532; washing machine parts 8450 90; phone connectors and flex 8517 79.
 * Uncertain, check before invoicing for real: the exact SAC sub-code for pickup and drop (billed here as part of the
 * repair, 998716), data recovery (998713 here; may be 998319 / 9983 IT services, also 18%), the 8524 sub-heading of a
 * phone display with touch, and 998715 versus 998719 for installation of appliances.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500007";
const WHATSAPP = "919876500007";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const HOURS = [
  { label: "Mon – Sat", value: "9:30 am – 8:30 pm" },
  { label: "Sunday", value: "10:00 am – 2:00 pm (counter only)" },
];
const HOURS_TA = [{ label: "திங்கள் – சனி", value: "காலை 9:30 – இரவு 8:30" }, { label: "ஞாயிறு", value: "காலை 10:00 – மதியம் 2:00 (கவுண்டர் மட்டும்)" }];

const FAQ = [
  { q: "Do I pay if you can't fix it?", a: "No. Diagnosis is ₹199–₹399 and is **adjusted in the repair bill** if you go ahead. If we can't fix it, or you decline the estimate, you pay only that diagnosis fee. Water-damaged phones and laptops are quoted after the diagnosis: *no fix, no fee*." },
  { q: "Will you change my part without asking?", a: "Never. Every job gets an estimate with parts and labour; you approve it **on the tracking page, on a call or in person** before we start. Extra work found on the bench comes back to you for approval first." },
  { q: "Original or compatible screen: which one?", a: "Original has the best brightness and colour and lasts the life of the phone (6-month warranty). Compatible is about half the price, a little less bright, with 3 months' warranty. If only the glass is cracked and the picture is perfect, touch-glass replacement keeps your own display. See the comparison above." },
  { q: "What warranty do I get?", a: "Screens 3 to 6 months, batteries 6 months, charging ports 3 months, laptop SSDs 3 years, memory for life: the warranty is on the part and the work, starts from the bill date, and the part's **serial number is printed on your bill**. Bring the bill and we repair or replace it free." },
  { q: "How do I see where my repair is?", a: "Open **Track my repair** and type the job number from your receipt (JC-0123) and the last 4 digits of your phone. You see each step, the estimate, when it will be ready, and can approve or decline the estimate online." },
  { q: "Do you come home?", a: "Yes for TVs, ACs, washing machines, fridges and RO purifiers within Coimbatore city (₹299 doorstep visit, adjusted in the repair), and we pick up phones and laptops within 10 km of Gandhipuram (₹149–₹249, free on repairs of ₹1,500 and above)." },
];
const FAQ_TA = [
  { q: "சரிசெய்ய முடியாவிட்டால் பணம் கொடுக்க வேண்டுமா?", a: "இல்லை. பரிசோதனைக் கட்டணம் ₹199–₹399; பழுதுபார்க்க ஒப்புக்கொண்டால் அது **பழுது பில்லில் கழிக்கப்படும்**. சரிசெய்ய முடியாவிட்டாலோ மதிப்பீட்டை நீங்கள் மறுத்தாலோ பரிசோதனைக் கட்டணம் மட்டுமே. தண்ணீரில் விழுந்த போன், லேப்டாப்புக்கு பரிசோதனைக்குப் பின் விலை சொல்வோம்: *சரியாகாவிட்டால் கட்டணம் இல்லை*." },
  { q: "கேட்காமல் பாகத்தை மாற்றுவீர்களா?", a: "ஒருபோதும் இல்லை. ஒவ்வொரு வேலைக்கும் பாகம், கூலியுடன் மதிப்பீடு தருவோம்; தொடங்கும் முன் **டிராக்கிங் பக்கத்திலோ, அழைப்பிலோ, நேரிலோ** ஒப்புதல் அளியுங்கள். பழுதுபார்க்கும்போது கூடுதல் வேலை தெரிந்தால் முதலில் உங்கள் ஒப்புதல் கேட்போம்." },
  { q: "ஒரிஜினல் ஸ்கிரீனா, காம்பாட்டிபிளா: எது?", a: "ஒரிஜினல் மிக நல்ல பிரகாசம், நிறம் தரும்; போனின் வாழ்நாள் முழுதும் நிற்கும் (6 மாத வாரண்டி). காம்பாட்டிபிள் பாதி விலை, சற்று குறைந்த பிரகாசம், 3 மாத வாரண்டி. வெளிக் கண்ணாடி மட்டும் உடைந்து படம் தெளிவாக இருந்தால் டச்-கிளாஸ் மாற்றம் உங்கள் சொந்த டிஸ்பிளேயை வைத்துக்கொள்ளும். மேலே உள்ள ஒப்பீட்டைப் பாருங்கள்." },
  { q: "வாரண்டி எவ்வளவு?", a: "ஸ்கிரீன் 3 முதல் 6 மாதம், பேட்டரி 6 மாதம், சார்ஜிங் போர்ட் 3 மாதம், லேப்டாப் SSD 3 ஆண்டு, மெமரி வாழ்நாள்: வாரண்டி பாகத்துக்கும் வேலைக்கும் உண்டு, பில் தேதியிலிருந்து தொடங்கும்; பாகத்தின் **சீரியல் எண் பில்லில் அச்சிடப்படும்**. பில்லுடன் வாருங்கள், இலவசமாகச் சரிசெய்வோம் அல்லது மாற்றுவோம்." },
  { q: "என் பழுது எங்கே இருக்கிறது என்று எப்படிப் பார்ப்பது?", a: "**என் பழுதைக் கண்காணி** பக்கத்தில் ரசீதில் உள்ள வேலை எண்ணையும் (JC-0123) உங்கள் போனின் கடைசி 4 இலக்கங்களையும் இடுங்கள். ஒவ்வொரு படி, மதிப்பீடு, எப்போது தயார் என்பதைப் பார்க்கலாம்; மதிப்பீட்டை ஆன்லைனிலேயே ஒப்புக்கொள்ளலாம் அல்லது மறுக்கலாம்." },
  { q: "வீட்டுக்கு வருவீர்களா?", a: "ஆம். கோயம்புத்தூர் நகருக்குள் டிவி, ஏசி, வாஷிங் மெஷின், ஃப்ரிட்ஜ், RO-வுக்கு (₹299 வீட்டு வருகை, பழுதில் கழிக்கப்படும்); காந்திபுரத்திலிருந்து 10 கி.மீ-க்குள் போன், லேப்டாப் எடுத்துச் செல்வோம் (₹149–₹249, ₹1,500-க்கு மேல் பழுதுக்கு இலவசம்)." },
];

const COMPARE_ROWS = [
  { label: "What is new", values: ["Only the outer glass, bonded on your own display", "A new A-grade compatible display", "A new maker-grade display"] },
  { label: "Picture", values: ["Exactly as before (your own panel)", "Good, a little less bright", "Brightest, true colours"] },
  { label: "Time at the bench", values: ["2 to 3 hours", "About 45 minutes", "About 60 minutes"] },
  { label: "Warranty", values: ["30 days", "3 months", "6 months"] },
  { label: "Best when", values: ["The picture is perfect, glass cracked", "Phone is 2 to 3 years old", "You keep the phone for years"] },
];
const COMPARE_ROWS_TA = [
  { label: "புதிதாக என்ன", values: ["வெளிக் கண்ணாடி மட்டும், உங்கள் டிஸ்பிளேயில் ஒட்டப்படும்", "புதிய A-கிரேடு காம்பாட்டிபிள் டிஸ்பிளே", "புதிய மேக்கர்-கிரேடு டிஸ்பிளே"] },
  { label: "படம்", values: ["முன்பு போலவே (உங்கள் சொந்த பேனல்)", "நன்று, சற்று குறைந்த பிரகாசம்", "அதிகப் பிரகாசம், உண்மை நிறங்கள்"] },
  { label: "பெஞ்சில் நேரம்", values: ["2 முதல் 3 மணி", "சுமார் 45 நிமிடம்", "சுமார் 60 நிமிடம்"] },
  { label: "வாரண்டி", values: ["30 நாள்", "3 மாதம்", "6 மாதம்"] },
  { label: "எப்போது சிறந்தது", values: ["படம் தெளிவு, கண்ணாடி மட்டும் உடைந்தது", "போன் 2, 3 வருடம் பழையது", "போனை பல ஆண்டு வைத்திருப்பீர்கள்"] },
];

const PHOTOS: DemoStore["photos"] = {
  288479: { by: "energepic.com", alt: "Close-up of a smartphone with a cracked screen" },
  6755075: { by: "Tima Miroshnichenko", alt: "Hand using a screwdriver inside an opened phone" },
  13625784: { by: "Pictjoe", alt: "Technician repairing a phone display under a desk lamp" },
  6755056: { by: "Tima Miroshnichenko", alt: "Technician repairing a phone with a microscope in a lab" },
  719399: { by: "Tyler Lastovich", alt: "A smartphone showing its internal battery and components" },
  6755053: { by: "Tima Miroshnichenko", alt: "Hands repairing a smartphone circuit board with tools" },
  8481934: { by: "Sergey Meshkov", alt: "A smartphone underwater with bubbles" },
  1826060: { by: "Vanderlei Longo", alt: "A hand holding a phone with raindrops on the screen" },
  6755048: { by: "Tima Miroshnichenko", alt: "A microscope on an electronics repair bench" },
  28666524: { by: "Andrey Matveev", alt: "Two NVMe solid-state drives on a grey surface" },
  4705618: { by: "cottonbro studio", alt: "Hands installing memory into an open laptop" },
  1122528: { by: "freestocks.org", alt: "Backlit laptop keyboard keys in the dark" },
  7639370: { by: "IT services EU", alt: "Technician repairing a laptop motherboard with a screwdriver" },
  2136243: { by: "Quang Nguyen Vinh", alt: "Technician testing a laptop board with a multimeter" },
  4065748: { by: "Castorly Stock", alt: "Backlit laptop keyboard keys with blue light" },
  10558598: { by: "Elias Gamez", alt: "Technician assembling a laptop's internal components" },
  6487969: { by: "Max Vakhtbovych", alt: "Wall-mounted TV in a living room with wooden panelling" },
  9241769: { by: "Mikhail Nilov", alt: "Hands using a screwdriver on a circuit board" },
  5463580: { by: "José Andrés Pacheco Cortes", alt: "Technician checking an air conditioner coil with a leak detector" },
  6471912: { by: "José Andrés Pacheco Cortes", alt: "Technician reading a refrigerant manifold gauge" },
  4700389: { by: "Ekaterina Belinskaya", alt: "A front-load washing machine with an out-of-service note" },
  7282376: { by: "Sarah Chai", alt: "A front-load washing machine drum being loaded" },
  32391499: { by: "Bulat843", alt: "Technicians repairing a freezer in a workshop" },
  3823190: { by: "Andrea Piacquadio", alt: "Technician with a tablet in an industrial workshop" },
  12741844: { by: "Quang Nguyen Vinh", alt: "Technician repairing electronic components at a busy workbench" },
};

const SCREEN_OPT = "Phone screen replacement, original panel";
const SCREEN_CMP = "Phone screen replacement, compatible panel";
const SCREEN_GLASS = "Phone touch-glass only replacement";

export const QUICKFIX: DemoStore = {
  shop: {
    slug: "quickfix",
    appId: "SV",
    businessType: "repair",
    planId: "pro",
    name: "QuickFix Mobile Care",
    primary: "#5b21b6",
    billing: {
      legalName: "QuickFix Mobile Care",
      gstin: "33AAQFQ1357R1ZI",
      address: "3, Gandhipuram 100 Feet Road",
      city: "Coimbatore",
      pincode: "641012",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "QF",
      upiId: "quickfix@okaxis",
    },
    // The counter's billing items (kept off the online store); the shop already has these from `pnpm seed`.
    items: [
      { name: "Screen replacement (labour)", hsn: "998713", unit: "service", rate: 50_000, gstRate: 18 },
      { name: "Battery replacement (labour)", hsn: "998713", unit: "service", rate: 30_000, gstRate: 18 },
      { name: "Display unit (OEM)", hsn: "8517", unit: "pcs", rate: 450_000, gstRate: 18 },
      { name: "Battery 5000 mAh", hsn: "8507", unit: "pcs", rate: 150_000, gstRate: 18 },
    ],
  },
  preset: "repair-bench",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 500_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "care@quickfix.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/quickfix.coimbatore", youtube: "https://youtube.com/@quickfixcbe" },
    policies: {
      shipping:
        "**Pickup and drop** within 10 km of Gandhipuram, Coimbatore: ₹149 for phones and tablets, ₹249 for laptops and small appliances, free on repairs of ₹1,500 and above. Slots 9 am to 6 pm, Monday to Saturday.\n\n**Doorstep visits** (TV, AC, washing machine, fridge, RO) within Coimbatore city: ₹299, adjusted in the repair. A technician arrives within 4 hours before 6 pm, next morning after.\n\n**Spare parts** are delivered in Coimbatore the same day and in Tamil Nadu in 2 to 4 days by courier.",
      returns:
        "**Repairs are guaranteed:** the warranty on each service page (30 days to 6 months, 3 years on SSDs) covers the part and the work. If the same fault returns, bring the bill (or the job number) and we fix it free, or refund the repair if we can't. **Estimates:** you can decline an estimate and pay only the diagnosis fee. **Parts:** unused parts are exchanged within 7 days.",
      privacy:
        "We use your name, phone and address only to repair your device, send your GST bill and honour your warranty. We never open your photos, chats or apps; we ask for the passcode only to test the device after the repair, and do not store it. Data we copy for a backup is deleted from our bench after you collect it.",
      terms:
        "Prices include 18% GST. Repairs with parts are one supply taxed at 18% (SAC 9987); spare parts are taxed by their HSN. Estimates are valid for 7 days. Devices not collected within 30 days of the ready message are charged ₹50 a day storage and, after 90 days, may be recycled after notice. Water-damaged and unlocked or tampered devices are repaired without a guarantee of recovery.",
    },
    businessType: "repair",
  },
  zones: [
    {
      name: "Coimbatore",
      pincodePrefixes: ["641"],
      rate: { name: "Our rider (same day)", type: "free_above", amount: 4_900, freeAbove: 99_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 7_900, freeAbove: 199_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
  ],
  categories: [
    { name: PHONE_SCREEN, description: "Original, compatible and glass-only screen replacement by screen size, and back glass. Most done in under an hour.", photo: 288479 },
    { name: PHONE_POWER, description: "Battery replacement, charging port repair, dead-phone diagnosis and speaker, mic and camera repair.", photo: 719399 },
    { name: WATER, description: "Ultrasonic cleaning and board repair after liquid damage, data backup, transfer and recovery.", photo: 8481934 },
    { name: LAPTOP, description: "SSD and RAM upgrades, Windows reinstall, overheating, screens, keyboards, batteries and board repair.", photo: 7639370 },
    { name: TV, description: "Backlight, power and main board repair, home diagnosis and wall mounting.", photo: 6487969 },
    { name: AC, description: "General service, jet-wash, gas top-up, diagnosis and installation for split ACs, at your home.", photo: 6471912 },
    { name: HOME, description: "Washing machine, fridge and RO water purifier repair at home: bearings, boards, gas and filters.", photo: 7282376 },
    { name: PARTS, description: "Batteries, displays, SSDs, memory, chargers and appliance parts on the shelf; serial-tracked with warranty.", photo: 4705618 },
    { name: PLANS, description: "Annual care plans for a phone, an AC, a laptop or a small office: scheduled services and priority repairs.", photo: 3823190 },
    { name: PICKUP, description: "Pickup and drop, express two-hour diagnosis and doorstep technician visits.", photo: 13625784 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "All repairs and parts", slug: "all-repairs", description: "Every service and part, A to Z.", rule: { sort: "name" } },
    { name: "Most booked", slug: "bestsellers", description: "The repairs Coimbatore books every day.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Phone repairs", slug: "phone-repairs", description: "Screens, batteries, charging ports and water damage for phones.", rule: { tag: "dev-phone", sort: "price-asc" } },
    { name: "Laptop and PC repairs", slug: "laptop-repairs", description: "Upgrades, reinstalls, screens and board repair for laptops and desktops.", rule: { tag: "dev-laptop", sort: "price-asc" } },
    { name: "We come to you", slug: "home-visit", description: "TV, AC, washing machine, fridge and RO repairs at your door.", rule: { tag: "home-visit", sort: "price-asc" } },
    { name: "Spare parts counter", slug: "spare-parts", description: "Parts on the shelf, for fitting by us or by other technicians.", rule: { category: PARTS, sort: "price-asc" } },
    { name: "Warranty parts with serial numbers", slug: "serial-parts", description: "SSDs, memory and batteries tracked by serial number, with warranty from the bill date.", rule: { tag: "serial", sort: "price-asc" } },
    { name: "Care plans", slug: "care-plans", description: "Annual care plans and AMC.", rule: { category: PLANS, sort: "price-asc" } },
    { name: "Under ₹500", slug: "under-500", description: "Diagnoses, visits, charging-port flex and small parts under ₹500.", rule: { tag: "under-500", sort: "price-asc" } },
  ],
  coupons: [
    { code: "FIRSTFIX", description: "₹100 off your first repair above ₹999", type: "flat", value: 10_000, minOrder: 99_900, firstOrderOnly: true, perCustomerLimit: 1, channels: ["store"] },
    { code: "CAREPLAN10", description: "10% off any care plan (up to ₹300)", type: "percent", value: 10, minOrder: 90_000, maxDiscount: 30_000, channels: ["store", "manual"] },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "QuickFix Mobile Care, repairs in Coimbatore",
      description:
        "Phone, laptop, TV, AC and washing machine repair in Coimbatore: tell us what's broken, get a fixed estimate you approve online, track the job, and get a 3-month to 3-year warranty with serial numbers on the bill. Pickup and drop, doorstep visits, care plans.",
      imageUrl: photo(12741844),
    },
    sections: [
      {
        type: "hero",
        id: "qf-hero",
        slides: [
          {
            imageUrl: photo(12741844),
            heading: "Broken today. Fixed by evening.",
            subheading: "Phones, laptops, TVs, ACs and washing machines. A fixed estimate you approve online, a tracking link, and a warranty with the serial number on your bill.",
            cta: { label: "Book a pickup", href: "/book" },
          },
        ],
      },
      {
        type: "finder",
        id: "qf-finder",
        title: "What's broken?",
        text: "Two taps: the device, then what's wrong. We show the repairs that fix it, with fixed prices.",
        layout: "wizard",
        results: "inline",
        limit: 6,
        imageUrl: photo(6755075, "tile"),
        cta: { label: "Not sure? Describe it on WhatsApp", href: waLink("Hello QuickFix, my device is not working. Device: … Problem: …") },
        questions: [
          {
            label: "Which device?",
            options: [
              { label: "Phone or tablet", tag: "dev-phone" },
              { label: "Laptop or desktop", tag: "dev-laptop" },
              { label: "Television", tag: "dev-tv" },
              { label: "Air conditioner", tag: "dev-ac" },
              { label: "Washing machine, fridge or RO", tag: "dev-appliance" },
            ],
          },
          {
            label: "What's wrong?",
            options: [
              { label: "Cracked or dead screen", tag: "issue-screen" },
              { label: "Battery drains fast", tag: "issue-battery" },
              { label: "Won't charge or switch on", tag: "issue-power" },
              { label: "Water or liquid damage", tag: "issue-water" },
              { label: "Slow or hangs", tag: "issue-slow" },
              { label: "Not cooling or too hot", tag: "issue-cool" },
              { label: "Noise or vibration", tag: "issue-noise" },
              { label: "Something else", tag: "issue-other" },
            ],
          },
        ],
      },
      {
        type: "tiles",
        id: "qf-devices",
        title: "Repairs by device",
        text: "Pick your device and see every repair, with the time it takes and the warranty.",
        layout: "row",
        showCounts: true,
        items: [
          { label: "Phones and tablets", note: "Screen, battery, charging port, water damage", imageUrl: photo(288479, "tile"), collectionSlug: "phone-repairs" },
          { label: "Laptops and desktops", note: "SSD, RAM, Windows, screen, keyboard", imageUrl: photo(7639370, "tile"), collectionSlug: "laptop-repairs" },
          { label: "TVs", note: "Backlight, boards, wall mounting", imageUrl: photo(6487969, "tile"), href: "/c/tv-repair" },
          { label: "Air conditioners", note: "Service, jet-wash, gas, installation", imageUrl: photo(6471912, "tile"), href: "/c/ac-service" },
          { label: "Washing machines and fridges", note: "Bearings, boards, gas, RO", imageUrl: photo(7282376, "tile"), href: "/c/washing-machine-and-fridge" },
        ],
      },
      {
        type: "stats",
        id: "qf-stats",
        title: "On the bench since 2014",
        items: [
          { value: 18000, suffix: "+", label: "devices repaired" },
          { value: 45, suffix: " min", label: "typical phone screen" },
          { value: 6, suffix: " months", label: "warranty on batteries and original screens" },
          { value: 4.8, suffix: " / 5", label: "average rating" },
        ],
      },
      {
        type: "comparison",
        id: "qf-compare",
        title: "Cracked phone screen: which repair?",
        text: "Three honest options, from keeping your own display to a brand-new original one. Prices shown are for a 6.2 to 6.5-inch screen; the product page has all sizes.",
        productIds: [product(SCREEN_GLASS), product(SCREEN_CMP), product(SCREEN_OPT)],
        highlightId: product(SCREEN_CMP),
        highlightLabel: "Most booked",
        showRating: false,
        rows: COMPARE_ROWS,
      },
      {
        type: "timeline",
        id: "qf-process",
        title: "How your repair moves",
        text: "Every step shows on your tracking page, and we message you at each one that matters.",
        items: [
          { when: "Step 1", title: "Received", text: "We note the device, the fault, what came with it and its condition, and give you a job number (JC-0123)." },
          { when: "Step 2", title: "Diagnosed", text: "A technician tests it, usually within 2 hours, and writes the fault down." },
          { when: "Step 3", title: "You approve", text: "You get an estimate with parts and labour. Approve or decline on the tracking page, on a call or in person." },
          { when: "Step 4", title: "In progress", text: "The repair is done on the bench with the approved part; extra work always comes back for approval." },
          { when: "Step 5", title: "Ready", text: "Tested, cleaned and messaged to you, with the balance after any advance." },
          { when: "Step 6", title: "Delivered", text: "You collect it (or we drop it) and get a GST bill with serial numbers and warranty dates." },
        ],
      },
      {
        type: "image-text",
        id: "qf-track",
        style: { background: "brand" },
        imageUrl: photo(6755048, "tile"),
        imageSide: "right",
        heading: "Track your repair",
        markdown: "Type the **job number** from your receipt and the **last 4 digits** of your phone. You see where it is, the estimate, when it will be ready, and can approve the estimate from your phone.",
        cta: { label: "Track my repair", href: "/track-repair" },
      },
      {
        type: "appointment",
        id: "qf-pickup",
        heading: "Book a pickup or a visit",
        text: "We collect phones and laptops from your door and visit homes for TVs, ACs and washing machines. Pick a slot, we do the rest.",
        services: [
          { name: "Pickup and drop, phone or tablet", duration: "within 10 km", price: rs(149) },
          { name: "Pickup and drop, laptop", duration: "within 10 km", price: rs(249) },
          { name: "Doorstep technician visit", duration: "within 4 hours", price: rs(299) },
          { name: "Express diagnosis in the shop", duration: "2 hours", price: rs(199) },
        ],
        cta: { label: "Book a slot", href: "/book" },
      },
      {
        type: "pricing-table",
        id: "qf-plans",
        title: "Care plans for a year",
        text: "Pay once, get services on a schedule and priority at the bench. Starts from the bill date; we call you when a service is due.",
        plans: [
          {
            name: "Phone care",
            price: rs(999),
            period: "per year",
            description: "One phone",
            features: ["Half-price compatible screen, once", "Battery health check every quarter", "Free charging-port cleaning", "Priority at the bench"],
            cta: { label: "Get Phone care", href: "/c/service-plans" },
          },
          {
            name: "AC care",
            price: rs(1999),
            period: "per year",
            description: "One split AC up to 1.5 ton",
            features: ["2 general services", "1 jet-wash service", "Free diagnosis visits", "10% off gas and parts"],
            highlight: true,
            badge: "Most popular",
            cta: { label: "Get AC care", href: "/c/service-plans" },
          },
          {
            name: "Shop and office AMC",
            price: rs(8999),
            period: "per year",
            description: "Up to 5 devices",
            features: ["4 scheduled visits", "Phone and WhatsApp support", "Standby device while yours is repaired", "GST bill for your records"],
            cta: { label: "Ask about AMC", href: waLink("Hello QuickFix, I'd like an AMC quote for my shop / office. Devices: …") },
          },
        ],
      },
      {
        type: "collection",
        id: "qf-parts",
        title: "Parts on the shelf",
        collectionSlug: "spare-parts",
        layout: "carousel",
        limit: 12,
      },
      {
        type: "testimonials",
        id: "qf-voices",
        title: "From the counter",
        layout: "cards",
        items: [
          { quote: "Screen cracked on Friday evening; the estimate came on my phone the same night, I approved it from the bus, and it was ready Saturday noon.", name: "Karthik R.", role: "Gandhipuram", rating: 5 },
          { quote: "They found my laptop only needed an SSD and cloned everything. It starts in 12 seconds now, and the serial number is on the bill.", name: "Meenakshi S.", role: "R.S. Puram", rating: 5 },
          { quote: "The AC technician came within three hours, showed the gas reading and charged only what he quoted. We now have the care plan.", name: "Ibrahim K.", role: "Saibaba Colony", rating: 5 },
        ],
      },
      { type: "faq", id: "qf-faq", title: "Before you book", items: FAQ },
      {
        type: "location",
        id: "qf-visit",
        title: "Find the bench",
        address: "3, Gandhipuram 100 Feet Road, Coimbatore 641012",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "11.0183, 76.9725",
      },
    ],
    translations: {
      ta: {
        "qf-hero": {
          slides: [
            {
              heading: "இன்று பழுது, மாலைக்குள் சரி.",
              subheading: "போன், லேப்டாப், டிவி, ஏசி, வாஷிங் மெஷின். ஆன்லைனில் ஒப்புக்கொள்ளும் நிலையான மதிப்பீடு, டிராக்கிங் இணைப்பு, சீரியல் எண்ணுடன் பில்லில் வாரண்டி.",
              cta: { label: "பிக்-அப் முன்பதிவு" },
            },
          ],
        },
        "qf-finder": {
          title: "என்ன பழுதாகியுள்ளது?",
          text: "இரண்டு தட்டல்கள்: சாதனம், பின் என்ன பிரச்சினை. சரிசெய்யும் பழுதுகளை நிலையான விலையுடன் காட்டுவோம்.",
          cta: { label: "உறுதியில்லையா? வாட்ஸ்அப்பில் சொல்லுங்கள்" },
          questions: [
            { label: "எந்தச் சாதனம்?", options: [{ label: "போன் அல்லது டேப்லெட்" }, { label: "லேப்டாப் அல்லது டெஸ்க்டாப்" }, { label: "டிவி" }, { label: "ஏர் கண்டிஷனர்" }, { label: "வாஷிங் மெஷின், ஃப்ரிட்ஜ் அல்லது RO" }] },
            {
              label: "என்ன பிரச்சினை?",
              options: [{ label: "உடைந்த அல்லது இயங்காத திரை" }, { label: "பேட்டரி சீக்கிரம் தீர்கிறது" }, { label: "சார்ஜ் ஆகவில்லை / ஆன் ஆகவில்லை" }, { label: "தண்ணீர் அல்லது திரவ சேதம்" }, { label: "மெதுவாக, ஹேங் ஆகிறது" }, { label: "குளிரவில்லை அல்லது சூடாகிறது" }, { label: "சத்தம் அல்லது அதிர்வு" }, { label: "வேறு ஏதாவது" }],
            },
          ],
        },
        "qf-devices": {
          title: "சாதனம் வாரியாகப் பழுதுகள்",
          text: "உங்கள் சாதனத்தைத் தேர்ந்தெடுத்து எல்லாப் பழுதுகளையும், எடுக்கும் நேரம், வாரண்டியுடன் பாருங்கள்.",
          items: [
            { label: "போன், டேப்லெட்", note: "திரை, பேட்டரி, சார்ஜிங் போர்ட், தண்ணீர் சேதம்" },
            { label: "லேப்டாப், டெஸ்க்டாப்", note: "SSD, RAM, விண்டோஸ், திரை, கீபோர்டு" },
            { label: "டிவி", note: "பேக்லைட், போர்டுகள், சுவரில் பொருத்துதல்" },
            { label: "ஏர் கண்டிஷனர்", note: "சர்வீஸ், ஜெட்-வாஷ், கேஸ், பொருத்துதல்" },
            { label: "வாஷிங் மெஷின், ஃப்ரிட்ஜ்", note: "பேரிங், போர்டு, கேஸ், RO" },
          ],
        },
        "qf-stats": {
          title: "2014 முதல் பெஞ்சில்",
          items: [{ label: "சாதனங்கள் பழுதுபார்க்கப்பட்டன" }, { label: "வழக்கமான போன் திரை" }, { label: "பேட்டரி, ஒரிஜினல் திரைக்கு வாரண்டி" }, { label: "சராசரி மதிப்பீடு" }],
        },
        "qf-compare": {
          title: "போன் திரை உடைந்தது: எந்தப் பழுது?",
          text: "உங்கள் சொந்த டிஸ்பிளேயை வைத்துக்கொள்வதிலிருந்து புத்தம் புதிய ஒரிஜினல் வரை மூன்று நேர்மையான வழிகள். காட்டும் விலை 6.2 முதல் 6.5 அங்குலத் திரைக்கு; பொருள் பக்கத்தில் எல்லா அளவுகளும் உள்ளன.",
          highlightLabel: "அதிகம் முன்பதிவு",
          rows: COMPARE_ROWS_TA,
        },
        "qf-process": {
          title: "உங்கள் பழுது எப்படி நகர்கிறது",
          text: "ஒவ்வொரு படியும் டிராக்கிங் பக்கத்தில் தெரியும்; முக்கியமான ஒவ்வொன்றிலும் உங்களுக்குச் செய்தி அனுப்புவோம்.",
          items: [
            { when: "படி 1", title: "பெறப்பட்டது", text: "சாதனம், பழுது, உடன் வந்தவை, நிலை ஆகியவற்றைக் குறித்து வேலை எண் (JC-0123) தருவோம்." },
            { when: "படி 2", title: "கண்டறியப்பட்டது", text: "டெக்னீஷியன் சோதித்து, பொதுவாக 2 மணிக்குள், பழுதை எழுதுவார்." },
            { when: "படி 3", title: "நீங்கள் ஒப்புதல்", text: "பாகம், கூலியுடன் மதிப்பீடு வரும். டிராக்கிங் பக்கத்திலோ, அழைப்பிலோ, நேரிலோ ஒப்புக்கொள்ளுங்கள் அல்லது மறுங்கள்." },
            { when: "படி 4", title: "நடைபெறுகிறது", text: "ஒப்புக்கொண்ட பாகத்துடன் பெஞ்சில் பழுது நடக்கும்; கூடுதல் வேலை எப்போதும் ஒப்புதலுக்கு வரும்." },
            { when: "படி 5", title: "தயார்", text: "சோதித்து, சுத்தம் செய்து, முன்பணம் போக மீதித் தொகையுடன் உங்களுக்குத் தெரிவிப்போம்." },
            { when: "படி 6", title: "ஒப்படைப்பு", text: "நீங்கள் எடுத்துக்கொள்ளலாம் (அல்லது நாங்கள் கொண்டு வருவோம்); சீரியல் எண், வாரண்டி தேதியுடன் GST பில் கிடைக்கும்." },
          ],
        },
        "qf-track": {
          heading: "உங்கள் பழுதைக் கண்காணியுங்கள்",
          markdown: "ரசீதில் உள்ள **வேலை எண்ணையும்** உங்கள் போனின் **கடைசி 4 இலக்கங்களையும்** இடுங்கள். அது எங்கே இருக்கிறது, மதிப்பீடு, எப்போது தயார் என்பதைப் பார்க்கலாம்; மதிப்பீட்டை உங்கள் போனிலேயே ஒப்புக்கொள்ளலாம்.",
          cta: { label: "என் பழுதைக் கண்காணி" },
        },
        "qf-pickup": {
          heading: "பிக்-அப் அல்லது வருகை முன்பதிவு",
          text: "போன், லேப்டாப்பை உங்கள் வாசலிலிருந்து எடுத்துச் செல்கிறோம்; டிவி, ஏசி, வாஷிங் மெஷினுக்கு வீட்டுக்கு வருகிறோம். நேரத்தைத் தேர்ந்தெடுங்கள், மீதியை நாங்கள் பார்த்துக்கொள்கிறோம்.",
          services: [{ name: "பிக்-அப் & டிராப், போன் அல்லது டேப்லெட்", duration: "10 கி.மீ-க்குள்" }, { name: "பிக்-அப் & டிராப், லேப்டாப்", duration: "10 கி.மீ-க்குள்" }, { name: "வீட்டுக்கு டெக்னீஷியன் வருகை", duration: "4 மணிக்குள்" }, { name: "கடையில் விரைவுப் பரிசோதனை", duration: "2 மணி" }],
          cta: { label: "நேரம் முன்பதிவு" },
        },
        "qf-plans": {
          title: "ஒரு வருடக் கவனிப்புத் திட்டங்கள்",
          text: "ஒருமுறை செலுத்துங்கள்; அட்டவணைப்படி சர்வீஸ், பெஞ்சில் முன்னுரிமை. பில் தேதியிலிருந்து தொடங்கும்; சர்வீஸ் நேரம் வந்ததும் அழைப்போம்.",
          plans: ([
            { name: "போன் கேர்", period: "ஆண்டுக்கு", description: "ஒரு போன்", features: ["காம்பாட்டிபிள் திரை பாதி விலையில், ஒருமுறை", "ஒவ்வொரு காலாண்டும் பேட்டரி சோதனை", "சார்ஜிங் போர்ட் சுத்தம் இலவசம்", "பெஞ்சில் முன்னுரிமை"], cta: { label: "போன் கேர் பெறுங்கள்" } },
            { name: "ஏசி கேர்", period: "ஆண்டுக்கு", description: "1.5 டன் வரை ஒரு ஸ்பிளிட் ஏசி", features: ["2 பொது சர்வீஸ்", "1 ஜெட்-வாஷ் சர்வீஸ்", "இலவச பரிசோதனை வருகைகள்", "கேஸ், பாகங்களில் 10% தள்ளுபடி"], badge: "அதிகம் விரும்பப்படுவது", cta: { label: "ஏசி கேர் பெறுங்கள்" } },
            { name: "கடை, அலுவலக AMC", period: "ஆண்டுக்கு", description: "5 சாதனங்கள் வரை", features: ["4 திட்டமிட்ட வருகைகள்", "போன், வாட்ஸ்அப் ஆதரவு", "உங்களுடையது பழுதில் இருக்கும்போது மாற்றுச் சாதனம்", "உங்கள் கணக்குக்கு GST பில்"], cta: { label: "AMC பற்றிக் கேளுங்கள்" } },
          ] as Record<string, unknown>[]) as never,
        },
        "qf-parts": { title: "அலமாரியில் உள்ள பாகங்கள்" },
        "qf-voices": {
          title: "கவுண்டரிலிருந்து",
          items: [
            { quote: "வெள்ளி மாலை திரை உடைந்தது; அதே இரவு மதிப்பீடு என் போனுக்கு வந்தது, பேருந்திலிருந்தே ஒப்புக்கொண்டேன், சனி மதியம் தயார்.", role: "காந்திபுரம்" },
            { quote: "என் லேப்டாப்புக்கு SSD மட்டும் போதும் என்று கண்டுபிடித்து எல்லாவற்றையும் க்ளோன் செய்தார்கள். இப்போது 12 விநாடியில் தொடங்குகிறது; சீரியல் எண் பில்லில் உள்ளது.", role: "ஆர்.எஸ். புரம்" },
            { quote: "ஏசி டெக்னீஷியன் மூன்று மணிக்குள் வந்து கேஸ் அளவைக் காட்டி, சொன்ன தொகையையே வாங்கினார். இப்போது கேர் பிளான் எடுத்துள்ளோம்.", role: "சாய்பாபா காலனி" },
          ],
        },
        "qf-faq": { title: "முன்பதிவுக்கு முன்", items: FAQ_TA },
        "qf-visit": {
          title: "பெஞ்சைக் கண்டுபிடியுங்கள்",
          address: "3, காந்திபுரம் 100 அடி சாலை, கோயம்புத்தூர் 641012",
          hours: HOURS_TA,
        },
      },
    },
  }),
  pages: [
    {
      slug: "how-repairs-work",
      title: "How repairs work, estimates and warranty",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "From the counter to your hand" },
        {
          type: "paragraph",
          markdown:
            "Every device gets a **job card**: the fault in your words, what came with it, its condition, and a job number like JC-0123 on your receipt. A technician diagnoses it, usually within two hours, and writes an **estimate with parts and labour**. You approve or decline it on your tracking page, on a call, or in person; nothing is replaced before that. If the bench finds extra work, it comes back to you for approval.",
        },
        { type: "image", url: photo(6755048, "tile"), alt: "A technician at a microscope repair bench" },
        { type: "heading", level: 2, text: "Estimates, advances and bills" },
        {
          type: "paragraph",
          markdown:
            "For bigger jobs we take an **advance** (about a quarter) which is shown on the final **GST bill** as already paid. The bill lists every part with its **serial number** (SSDs, memory, batteries), so your warranty is traceable. Diagnosis fees are adjusted in the repair; decline the estimate and you pay only the diagnosis.",
        },
        { type: "heading", level: 2, text: "Warranty" },
        {
          type: "paragraph",
          markdown:
            "| Repair | Warranty |\n|---|---|\n| Original screen, battery | 6 months |\n| Compatible screen, charging port, keyboard | 3 months |\n| Touch glass, back glass, board repair, service visits | 30 days |\n| Laptop SSD | 3 years (serial on the bill) |\n| Laptop memory | Lifetime (serial on the bill) |\n\nWarranty covers the part and the work and starts from the bill date. It doesn't cover new damage (drops, liquid) or tampering.",
        },
        { type: "button", label: "Track my repair", href: "/track-repair", style: "primary" },
        { type: "button", label: "Check a warranty", href: "/warranty", style: "secondary" },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "QuickFix, Gandhipuram, since 2014" },
        {
          type: "paragraph",
          markdown:
            "QuickFix began as a one-table phone repair counter on the 100 Feet Road and now has a bench for phones, a laptop and TV lab, and technicians who visit homes for ACs, washing machines and fridges across Coimbatore. We keep our promises simple: a fixed estimate, your approval before we start, a tracking link, and a warranty with the part's serial number on the bill.",
        },
        { type: "image", url: photo(12741844, "tile"), alt: "A technician at a busy electronics workbench" },
        { type: "paragraph", markdown: "Open Monday to Saturday 9:30 am – 8:30 pm, Sunday 10 am – 2 pm (counter only). Call or WhatsApp **+91 98765 00007**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our customers or staff, and the devices shown are stand-ins for the repairs named.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Phones", type: "category", ref: "phone-screen-replacement" },
      { label: "Laptops", type: "category", ref: "laptop-and-desktop" },
      { label: "TV & AC", type: "category", ref: "ac-service" },
      { label: "Plans", type: "category", ref: "service-plans" },
      { label: "Track my repair", type: "url", href: "/track-repair" },
      { label: "How repairs work", type: "page", ref: "how-repairs-work" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track my repair", type: "url", href: "/track-repair" },
          { label: "Check a warranty", type: "url", href: "/warranty" },
          { label: "How repairs work", type: "page", ref: "how-repairs-work" },
          { label: "Book a pickup", type: "url", href: "/book" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Repairs",
        type: "url",
        children: [
          { label: "Phone repairs", type: "collection", ref: "phone-repairs" },
          { label: "Laptop and PC repairs", type: "collection", ref: "laptop-repairs" },
          { label: "We come to you", type: "collection", ref: "home-visit" },
          { label: "Spare parts counter", type: "collection", ref: "spare-parts" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
