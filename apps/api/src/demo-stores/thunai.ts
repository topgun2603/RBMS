import type { Logger } from "pino";
import type { Kit } from "../kit";
import { PHOTOS } from "./thunai-photos";
import { AID, AYU, BABY, DEV, DIA, MED, PERS, PRODUCTS, RX, VIT } from "./thunai-products";
import type { DemoStore } from "./types";

/**
 * Thunai Pharmacy & Wellness, Fairlands, Salem (thunai.localhost:3003; counter, medicines and admin
 * thunai.localhost:3006). Store #22: the pharmacy app (PH) with the `pharmacy` trade and the "saline-blue" look
 * (theme-presets-thunai.ts). It replaces the earlier half-built demo shop `medplus` ("MedPlus" is a real pharmacy
 * chain's name; Thunai means "companion" in Tamil and is made up for this demo, address, phone, GSTIN, drug licence and
 * pharmacist registration are placeholders). A neighbourhood pharmacy and wellness store: OTC and prescription
 * medicines, diabetes care, vitamins, baby care, personal care, siddha / ayurveda, first aid and home-check devices,
 * with batches and expiry, prescriptions and the Schedule H1 register behind the counter (`@rbms/medicines`).
 *
 * Page layout: rail + phone tabs (the trade's repeat-shopper layout). The home has no hero and a structure of its own:
 * what-do-you-need finder (need, who, form) -> shop-by-need tiles -> "have a prescription?" block -> how a prescription
 * order works (timeline) -> home BP monitors compared -> home glucometers compared -> monthly medicine box (pricing
 * table) -> the rainy-season shelf -> the pharmacist team -> FAQ -> promises -> timings and night service -> a
 * "consult your doctor" note. There is no prescription upload on the storefront: the block opens a WhatsApp message to
 * the pharmacist (or the counter), who checks it and the order is billed and recorded in the pharmacy app.
 *
 * Catalogue: 91 items (thunai-products.ts), 82 online: the nine Schedule H1 medicines (antibiotics, alprazolam,
 * clonazepam, tramadol, pregabalin) are counter-only, kept off the online store by `setup` below. Names, packs, HSN,
 * GST rates, MRPs, schedules and compositions come from the pharmacy history profile (demo-history/profiles.ts), so
 * `seed:history thunai --profile pharmacy` sells exactly this catalogue.
 *
 * GST (checked 24 Oct 2026; medicines at 5% since the 56th GST Council meeting of 3 Sept 2025):
 * - Medicaments of heading 3004, including ayurvedic, siddha and unani medicines (3003 / 3004), insulin, and the
 *   bandages and cotton of 3005: 5% (2.5% CGST + 2.5% SGST), cut from 12% with effect from 22 Sept 2025 by
 *   Notification No. 9/2025-Central Tax (Rate) dated 17.09.2025 (and the matching IGST / UTGST notifications); 33
 *   life-saving medicines moved from 5% to nil. Diagnostic kits and reagents (3822: glucose test strips), medical devices
 *   of 9018 (BP monitors, pulse oximeters, nebulisers) and clinical thermometers (9025) also moved to 5%. Toothpaste
 *   (3306), shampoo (3305), soap and sanitary-pad-adjacent hygiene goods followed to 5% in the same notification.
 * - Sanitary napkins (9619) are exempt (nil), unchanged. Baby diapers (9619) 5%. Skin lotions and creams (3304), sanitizer
 *   (3808), feeding bottles (3924), protein supplements (2106) and glucose powder (1702) stay at 18%.
 * Sources: https://www.cbic.gov.in (Notification 9/2025-CT(R), 17 Sept 2025) and the CBIC GST rate-change FAQ of
 * September 2025. Uncertain, check with a CA before invoicing for real: the HSN and rate of glucose meters (9027, 5% here),
 * of food-supplement capsules sold as medicines (3004 vs 2106 90, 18%), and of multivitamins when sold as a supplement.
 */

const PHONE = "+919876500084";
const WHATSAPP = "919876500084";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
const RX_MESSAGE = "Hello Thunai Pharmacy, I am sending my prescription (photo attached). Name: … Delivery address and pincode: … Phone: …";

const ADDRESS = "14, Fairlands Main Road, Salem 636016";
const ADDRESS_TA = "14, ஃபேர்லேண்ட்ஸ் மெயின் ரோடு, சேலம் 636016";
const HOURS = [
  { label: "Every day", value: "8:00 am – 10:30 pm" },
  { label: "Urgent, after 10:30 pm", value: "Call the pharmacist on duty" },
  { label: "Delivery in Salem", value: "Confirmed by 7 pm: same day" },
];
const HOURS_TA = [
  { label: "தினமும்", value: "காலை 8:00 – இரவு 10:30" },
  { label: "அவசரம், இரவு 10:30க்குப் பின்", value: "பணியில் உள்ள மருந்தாளரை அழைக்கவும்" },
  { label: "சேலத்தில் டெலிவரி", value: "மாலை 7க்குள் உறுதி: அதே நாள்" },
];

const FAQ = [
  { q: "Do I need a prescription?", a: "For **Schedule H** medicines (most antibiotics, blood pressure, sugar, thyroid and acid medicines) **yes**: a valid prescription from a registered doctor. Everyday medicines such as paracetamol, antacids and vitamins are sold without one. **Schedule H1** medicines (some antibiotics and sleep / anxiety / pain medicines) are sold **only at the counter** and recorded in a register; they are not sold online." },
  { q: "How do I send my prescription?", a: "Send a clear photo on **WhatsApp** (+91 98765 00084) or bring it to the shop. The pharmacist reads it, checks each medicine and calls you with the bill. Medicines are packed only after the prescription is seen, and a repeat prescription is accepted until the doctor's stated date." },
  { q: "Can you give me a cheaper medicine with the same salt?", a: "Often yes: the same composition from another maker is usually cheaper. We only change a brand with **your doctor's permission or yours after we explain**, and we tell you what we changed. Ask the pharmacist for the substitutes list." },
  { q: "Are you open at night?", a: "The shop is open **8 am to 10:30 pm every day**, including Sundays and holidays. For an urgent medicine after closing, call the number on this page: the pharmacist on duty tells you what we can do, and delivers within Fairlands for a ₹50 night fee." },
  { q: "Can I return a medicine?", a: "Medicines cannot be taken back once sold. If we gave you the wrong medicine, the pack is damaged or the expiry is within three months of purchase, tell us **within 48 hours** with the strip and the bill and we replace or refund it. Devices (BP monitors, glucometers) have a 7-day exchange for defects and a one-year warranty." },
  { q: "How do you check expiry?", a: "Every pack is received by **batch and expiry**; we sell the **earliest expiry first** and never sell an expired pack. We dispense packs with at least three months of life left. Short-dated stock is returned to the distributor." },
  { q: "Is my prescription private?", a: "Yes. We use it only to dispense your medicine, keep the records the law asks for (such as the Schedule H1 register) and send your bill. We do not share it or use it for marketing." },
  { q: "Is this medical advice?", a: "No. The pharmacist can explain how to take a medicine you have been prescribed, but cannot diagnose. Please **consult your doctor** before you start, change or stop a medicine, and call 108 in an emergency." },
];
const FAQ_TA = [
  { q: "எனக்கு மருந்துச் சீட்டு தேவையா?", a: "**ஷெட்யூல் H** மருந்துகளுக்கு (பெரும்பாலான ஆன்டிபயாடிக், இரத்த அழுத்தம், சர்க்கரை, தைராய்டு, அமில மருந்துகள்) **ஆம்**: பதிவு பெற்ற மருத்துவரின் சரியான மருந்துச் சீட்டு வேண்டும். பாராசிட்டமால், அமில எதிர்ப்பு, வைட்டமின் போன்ற அன்றாட மருந்துகளுக்குத் தேவையில்லை. **ஷெட்யூல் H1** மருந்துகள் (சில ஆன்டிபயாடிக், தூக்கம் / பதற்றம் / வலி மருந்துகள்) **கடைக் கவுண்டரில் மட்டுமே** விற்கப்பட்டு பதிவேட்டில் பதியப்படும்; ஆன்லைனில் விற்கப்படாது." },
  { q: "மருந்துச் சீட்டை எப்படி அனுப்புவது?", a: "தெளிவான படத்தை **வாட்ஸ்அப்பில்** (+91 98765 00084) அனுப்புங்கள், அல்லது கடைக்குக் கொண்டு வாருங்கள். மருந்தாளர் படித்து, ஒவ்வொரு மருந்தையும் சரிபார்த்து, பில்லுடன் அழைப்பார். மருந்துச் சீட்டைப் பார்த்த பின்பே மருந்து பேக் செய்யப்படும்; மருத்துவர் குறிப்பிட்ட தேதி வரை மீண்டும் வாங்கலாம்." },
  { q: "அதே உப்பு உள்ள மலிவான மருந்து தர முடியுமா?", a: "பெரும்பாலும் முடியும்: வேறு தயாரிப்பாளரின் அதே கலவை பொதுவாக மலிவு. **உங்கள் மருத்துவரின் அனுமதியுடன் அல்லது நாங்கள் விளக்கிய பின் உங்கள் சம்மதத்துடன்** மட்டுமே பிராண்டை மாற்றுவோம்; எதை மாற்றினோம் என்றும் சொல்வோம். மாற்று மருந்துப் பட்டியலை மருந்தாளரிடம் கேளுங்கள்." },
  { q: "இரவிலும் திறந்திருக்கிறீர்களா?", a: "கடை **தினமும் காலை 8 முதல் இரவு 10:30 வரை**, ஞாயிறு, விடுமுறை நாட்களிலும் திறந்திருக்கும். கடை மூடிய பின் அவசர மருந்துக்கு இந்தப் பக்கத்தில் உள்ள எண்ணை அழையுங்கள்: பணியில் உள்ள மருந்தாளர் என்ன செய்யலாம் என்று சொல்வார்; ஃபேர்லேண்ட்ஸுக்குள் ₹50 இரவுக் கட்டணத்தில் டெலிவரி செய்வோம்." },
  { q: "மருந்தைத் திருப்பித் தர முடியுமா?", a: "விற்ற மருந்தை திரும்ப எடுக்க இயலாது. தவறான மருந்து கொடுத்திருந்தால், பேக் சேதமாக இருந்தால் அல்லது காலாவதி வாங்கிய தேதியிலிருந்து மூன்று மாதத்துக்குள் இருந்தால், **48 மணி நேரத்துக்குள்** ஸ்ட்ரிப்புடனும் பில்லுடனும் சொல்லுங்கள்; மாற்றித் தருவோம் அல்லது பணம் திருப்புவோம். சாதனங்களுக்கு (பிபி மானிட்டர், குளுக்கோமீட்டர்) குறைபாட்டுக்கு 7 நாள் மாற்றம், ஓராண்டு உத்தரவாதம்." },
  { q: "காலாவதியை எப்படிச் சரிபார்க்கிறீர்கள்?", a: "ஒவ்வொரு பேக்கும் **பேட்ச், காலாவதி** பதிவுடன் வருகிறது; **முதலில் காலாவதியாகும் பேக்கை முதலில்** விற்போம்; காலாவதியான பேக்கை ஒருபோதும் விற்கமாட்டோம். குறைந்தது மூன்று மாதம் ஆயுள் உள்ள பேக்குகளையே தருவோம். குறுகிய காலாவதி இருப்பு விநியோகஸ்தரிடம் திருப்பப்படும்." },
  { q: "என் மருந்துச் சீட்டு ரகசியமாக இருக்குமா?", a: "ஆம். உங்கள் மருந்தைத் தருவதற்கும், சட்டம் கேட்கும் பதிவுகளை (ஷெட்யூல் H1 பதிவேடு போல) வைப்பதற்கும், பில் அனுப்புவதற்கும் மட்டுமே பயன்படுத்துவோம். பகிரவோ விளம்பரத்துக்குப் பயன்படுத்தவோ மாட்டோம்." },
  { q: "இது மருத்துவ ஆலோசனையா?", a: "இல்லை. உங்களுக்கு எழுதித் தரப்பட்ட மருந்தை எப்படி எடுப்பது என்று மருந்தாளர் விளக்குவார்; நோயைக் கண்டறிய முடியாது. மருந்தைத் தொடங்கும் முன், மாற்றும் முன், நிறுத்தும் முன் **உங்கள் மருத்துவரிடம் கலந்தாலோசியுங்கள்**; அவசரத்தில் 108ஐ அழையுங்கள்." },
];

const NEEDS_NOTE = "Medicines are not ordinary goods. The information on this site is general and is not medical advice: **consult your doctor or pharmacist** before you start, change or stop a medicine, and call **108** in an emergency. Prices are MRP, GST included.";
const NEEDS_NOTE_TA = "மருந்துகள் சாதாரணப் பொருள்கள் அல்ல. இந்தத் தளத்தின் தகவல்கள் பொதுவானவை; மருத்துவ ஆலோசனை அல்ல: மருந்தைத் தொடங்கும் முன், மாற்றும் முன், நிறுத்தும் முன் **உங்கள் மருத்துவர் அல்லது மருந்தாளரிடம் கலந்தாலோசியுங்கள்**; அவசரத்தில் **108**ஐ அழையுங்கள். விலைகள் MRP, GST உட்பட.";

/** Schedule H1 medicines are never sold online (the register and a prescription at the counter). */
const H1_NAMES = PRODUCTS.filter((p) => p.tags?.includes("h1")).map((p) => p.name);

export const THUNAI: DemoStore = {
  shop: {
    slug: "thunai",
    appId: "PH",
    businessType: "pharmacy",
    planId: "pro",
    name: "Thunai Pharmacy & Wellness",
    primary: "#1d5f8a",
    billing: {
      legalName: "Thunai Pharmacy & Wellness",
      gstin: "33AAHFT7281M1ZN",
      address: "14, Fairlands Main Road",
      city: "Salem",
      pincode: "636016",
      stateCode: "33",
      phone: PHONE,
      email: "care@thunai.in",
      invoicePrefix: "TP",
      upiId: "thunai@okaxis",
      terms:
        "Drug Licence (Form 20 / Form 21): TN-SLM-DEMO-20-0000 / TN-SLM-DEMO-21-0000. Registered Pharmacist: Kalaiselvi Murugan, Reg. No. TNPC-DEMO-00000. (Both are DEMO PLACEHOLDERS, not real licence or registration numbers.) Schedule H and H1 drugs are sold only against a valid prescription. Medicines once sold are not taken back, except a wrong or damaged supply reported within 48 hours with the bill. Check the pack and expiry at the counter. Prices are MRP including GST. Subject to Salem jurisdiction.",
    },
    items: [],
  },
  preset: "saline-blue",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 300_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "care@thunai.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/thunai.salem", facebook: "https://facebook.com/thunai.salem" },
    policies: {
      shipping:
        "**Salem city:** same-day delivery for orders confirmed by 7 pm (the pharmacist confirms prescription orders by phone first). ₹30, free above ₹499. Night delivery within Fairlands after 10:30 pm for an urgent medicine: ₹50, call the pharmacist on duty. **Rest of Tamil Nadu:** courier in 2 to 4 days, ₹60, free above ₹999. Insulin and other cold-chain items are collected from the shop or delivered in Salem in a cool bag; they are not couriered. Schedule H1 medicines are not delivered: they are sold only at the counter.",
      returns:
        "Medicines cannot be taken back once sold. If we gave you the wrong medicine, the pack arrives damaged or the expiry is within three months of purchase, tell us within 48 hours with the strip and the bill and we replace or refund it. Devices (BP monitors, glucometers, nebulisers, thermometers) can be exchanged within 7 days for a defect and carry a one-year warranty (demo).",
      privacy:
        "We use your name, phone, address and prescription only to dispense your medicine, keep the records the law requires (the Schedule H1 register, prescriptions) and send your bill and refill reminders. We never share them or use them for advertising. Ask us to stop reminders any time.",
      terms:
        "Drug Licence (Form 20 / Form 21): TN-SLM-DEMO-20-0000 / TN-SLM-DEMO-21-0000. Registered Pharmacist: Kalaiselvi Murugan, Reg. No. TNPC-DEMO-00000 (both are demo placeholders, not real numbers). Schedule H and H1 medicines are sold only against a valid prescription from a registered medical practitioner; orders for them are confirmed by the pharmacist before packing. The information on this site is general and is not medical advice. Prices are MRP including GST.",
    },
    businessType: "pharmacy",
  },
  zones: [
    {
      name: "Salem",
      pincodePrefixes: ["636"],
      rate: { name: "Our rider (same day)", type: "free_above", amount: 3_000, freeAbove: 49_900, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Courier (2–4 days)", type: "free_above", amount: 6_000, freeAbove: 99_900, etaMinDays: 2, etaMaxDays: 4, codAllowed: true, codFee: 3_000 },
    },
  ],
  categories: [
    { name: MED, description: "Everyday medicines for fever, pain, cold, allergy and acidity, and the home medicine box.", photo: 4210615 },
    { name: RX, description: "Medicines that need a doctor's prescription: send a photo on WhatsApp or show it at the counter, and the pharmacist confirms before packing.", photo: 11370618 },
    { name: DIA, description: "Glucometers, test strips and the medicines for living well with diabetes.", photo: 11081349 },
    { name: VIT, description: "Vitamins, minerals, iron, calcium and nutrition powders.", photo: 3850749 },
    { name: BABY, description: "Diapers, lotion and feeding for the first years.", photo: 5889968 },
    { name: PERS, description: "Oral care, hair care, hygiene and sanitary napkins.", photo: 3872898 },
    { name: AYU, description: "Siddha and ayurvedic powders, tonics and oils, from the Tamil household shelf.", photo: 5480057 },
    { name: AID, description: "Antiseptics, dressings, bandages, masks and cotton.", photo: 5673523 },
    { name: DEV, description: "BP monitors, thermometers, pulse oximeters and nebulisers for home checks.", photo: 8670179 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "Everyday essentials", slug: "essentials", description: "What Salem picks up most, A to Z.", rule: { tag: "bestseller", sort: "rating" } },
    { name: "Rainy-season care", slug: "monsoon-care", description: "What homes keep ready through the northeast monsoon: fever, cold, hydration and hygiene.", rule: { tag: "monsoon", sort: "price-asc" } },
    { name: "Diabetes care", slug: "diabetes-care", description: "Glucometers, strips, medicines and insulin.", rule: { tag: "n-diabetes", sort: "price-asc" } },
    { name: "BP and heart", slug: "bp-heart", description: "Home BP monitors and the regular medicines for blood pressure and cholesterol.", rule: { tag: "n-bp", sort: "price-asc" } },
    { name: "Baby and mother", slug: "baby-mother", description: "Diapers, lotion and feeding for the baby.", rule: { tag: "n-baby", sort: "price-asc" } },
    { name: "Women's health", slug: "womens-health", description: "Sanitary napkins, iron and folic acid.", rule: { tag: "n-women", sort: "price-asc" } },
    { name: "Bones and joints", slug: "bones-joints", description: "Gels, sprays, oils, calcium and vitamin D.", rule: { tag: "n-bone", sort: "price-asc" } },
    { name: "Cold and cough", slug: "cold-cough", description: "Syrups, lozenges, tablets and a nebuliser.", rule: { tag: "n-cold", sort: "price-asc" } },
    { name: "Monthly refills", slug: "monthly-refills", description: "The regular medicines people reorder every month.", rule: { tag: "monthly", sort: "name" } },
    { name: "Home health checks", slug: "home-checks", description: "BP monitors, glucometers, thermometers and oximeters.", rule: { tag: "n-device", sort: "price-asc" } },
    { name: "Siddha and ayurveda", slug: "ayurveda", description: "Kudineer, triphala, chyawanprash and herbal oils.", rule: { tag: "n-ayur", sort: "price-asc" } },
    { name: "Under ₹100", slug: "under-100", description: "Everyday packs under ₹100.", rule: { tag: "under-100", sort: "price-asc" } },
  ],
  coupons: [
    { code: "FIRSTORDER", description: "₹50 off your first order above ₹499", type: "flat", value: 5_000, minOrder: 49_900, perCustomerLimit: 1, firstOrderOnly: true, channels: ["store"] },
    { code: "REFILL5", description: "5% off (up to ₹150) on your monthly medicine box, above ₹799", type: "percent", value: 5, maxDiscount: 15_000, minOrder: 79_900, channels: ["store", "manual"] },
  ],
  home: ({ photo, product }) => ({
    seo: {
      title: "Thunai Pharmacy & Wellness, Fairlands, Salem",
      description:
        "A neighbourhood pharmacy in Salem: tell us what you need, send your prescription on WhatsApp, compare home BP monitors and glucometers, and set up a monthly medicine box with refill reminders. Open 8 am to 10:30 pm every day.",
      imageUrl: photo(14797855),
    },
    sections: [
      {
        type: "finder",
        id: "tn-finder",
        title: "What do you need today?",
        text: "Pick a need, who it is for and the form you prefer. We show what fits; if you are unsure, the pharmacist is one message away.",
        layout: "chips",
        results: "inline",
        limit: 8,
        buttonLabel: "Show my list",
        imageUrl: photo(14797855, "tile"),
        cta: { label: "Ask our pharmacist on WhatsApp", href: waLink("Hello Thunai Pharmacy, I need help choosing: …") },
        questions: [
          {
            label: "What do you need?",
            options: [
              { label: "Fever", tag: "n-fever" },
              { label: "Cold and cough", tag: "n-cold" },
              { label: "Stomach and acidity", tag: "n-stomach" },
              { label: "Pain and joints", tag: "n-pain" },
              { label: "Diabetes", tag: "n-diabetes" },
              { label: "BP and heart", tag: "n-bp" },
              { label: "Vitamins and immunity", tag: "n-vitamin" },
              { label: "Baby care", tag: "n-baby" },
            ],
          },
          {
            label: "Who is it for?",
            options: [
              { label: "Baby or child", tag: "a-child" },
              { label: "Adult", tag: "a-adult" },
              { label: "Senior (60+)", tag: "a-senior" },
            ],
          },
          {
            label: "What form?",
            options: [
              { label: "Tablets and capsules", tag: "f-tablet" },
              { label: "Syrups, drops and liquids", tag: "f-liquid" },
              { label: "Creams, gels and oils", tag: "f-topical" },
              { label: "Devices and kits", tag: "f-device" },
              { label: "Care items", tag: "f-care" },
            ],
          },
        ],
      },
      {
        type: "tiles",
        id: "tn-needs",
        title: "Shop by health need",
        text: "Each tile opens the products for that need. Prescription medicines are packed only after the pharmacist sees the prescription.",
        layout: "grid",
        showCounts: true,
        items: [
          { label: "Diabetes", note: "Glucometers, strips, tablets, insulin", collectionSlug: "diabetes-care", imageUrl: photo(11081349, "tile") },
          { label: "BP and heart", note: "Home monitors and regular medicines", collectionSlug: "bp-heart", imageUrl: photo(8670179, "tile") },
          { label: "Baby care", note: "Diapers, lotion, feeding bottle", collectionSlug: "baby-mother", imageUrl: photo(5889968, "tile") },
          { label: "Women's health", note: "Napkins, iron and folic acid", collectionSlug: "womens-health", imageUrl: photo(7692457, "tile") },
          { label: "Bones and joints", note: "Gels, sprays, oils, calcium, vitamin D", collectionSlug: "bones-joints", imageUrl: photo(8167172, "tile") },
          { label: "Cold and cough", note: "Syrups, lozenges, tablets, nebuliser", collectionSlug: "cold-cough", imageUrl: photo(5858861, "tile") },
          { label: "Stomach and acidity", note: "Antacids, ORS, digestive care", tag: "n-stomach", imageUrl: photo(9628806, "tile") },
          { label: "Siddha and ayurveda", note: "Kudineer, triphala, chyawanprash", collectionSlug: "ayurveda", imageUrl: photo(4871294, "tile") },
        ],
      },
      {
        type: "image-text",
        id: "tn-rx",
        imageUrl: photo(11370618, "tile"),
        imageSide: "right",
        heading: "Have a prescription?",
        markdown:
          "Send a clear photo of it on **WhatsApp** and the pharmacist checks every medicine, tells you the bill and packs it: usually within 30 minutes in the day, with delivery in Salem the same day for orders confirmed by 7 pm. Or bring it to the counter.\n\nWe sell **Schedule H** medicines only against a valid prescription from a registered doctor, and **Schedule H1** medicines only at the counter. Your prescription is used to dispense your medicine and nothing else.",
        cta: { label: "Send my prescription on WhatsApp", href: waLink(RX_MESSAGE) },
        style: { background: "muted" },
      },
      {
        type: "timeline",
        id: "tn-steps",
        title: "How a prescription order works",
        text: "Four steps, and the pharmacist is on the phone for each one.",
        items: [
          { when: "Step 1", title: "Send", text: "Send a photo of the prescription on WhatsApp, or bring it in, with your delivery address and phone number." },
          { when: "Step 2", title: "Check", text: "The pharmacist reads it, checks each medicine and the dose, and calls you with the bill. A substitute with the same salt is offered only if your doctor allows it." },
          { when: "Step 3", title: "Pack", text: "You confirm and pay by UPI, card or cash on delivery. Each pack is picked by batch and expiry, earliest expiry first, and packed with your bill." },
          { when: "Step 4", title: "Deliver", text: "Same-day delivery in Salem for orders confirmed by 7 pm. Insulin travels in a cool bag. Your prescription is recorded for the next refill." },
        ],
      },
      {
        type: "comparison",
        id: "tn-bp",
        title: "Check your blood pressure at home",
        text: "Three monitors we stock, side by side. A home reading helps your doctor; it does not replace a check-up.",
        productIds: [product("BP monitor"), product("BP monitor with memory (arm)"), product("Wrist BP monitor")],
        highlightId: product("BP monitor with memory (arm)"),
        highlightLabel: "Best for families",
        showRating: false,
        rows: [
          { label: "Measures at", values: ["Upper arm", "Upper arm", "Wrist"] },
          { label: "Memory", values: ["30 readings", "2 users × 60 readings", "60 readings"] },
          { label: "Display", values: ["Standard", "Extra large", "Compact"] },
          { label: "Best for", values: ["One person at home", "Couples and families", "Travel and a pocket"] },
          { label: "Warranty", values: ["1 year (demo)", "1 year (demo)", "1 year (demo)"] },
        ],
      },
      {
        type: "comparison",
        id: "tn-sugar",
        title: "Check your sugar at home",
        text: "Two glucometer kits, with strips in the box. Test strips are sold separately and must match your meter.",
        productIds: [product("Glucometer with 10 strips"), product("Voice glucometer kit (25 strips)")],
        highlightId: product("Glucometer with 10 strips"),
        highlightLabel: "Most bought",
        showRating: false,
        rows: [
          { label: "Strips in the box", values: ["10", "25"] },
          { label: "Display", values: ["Standard", "Large, with voice"] },
          { label: "Memory", values: ["100 readings", "300 readings"] },
          { label: "Best for", values: ["First-time users", "Weak eyesight"] },
          { label: "Lancing pen", values: ["Included", "Included"] },
        ],
      },
      {
        type: "pricing-table",
        id: "tn-box",
        title: "Monthly medicine box",
        text: "For regular medicines (blood pressure, sugar, thyroid, cholesterol). Give us the prescription once; we remind you before it runs out, pack your month and deliver. You pay for the medicines only, at MRP less the box discount.",
        plans: [
          {
            name: "Refill reminder",
            price: 0,
            period: "free",
            description: "A WhatsApp nudge a week before your strips run out",
            features: ["Reminder on WhatsApp", "Reorder with one reply", "Your prescription kept on file"],
            cta: { label: "Set a reminder", href: waLink("Hello Thunai Pharmacy, please remind me to refill my regular medicines. Name: … Medicines: …") },
          },
          {
            name: "Monthly box",
            price: 0,
            period: "no fee, 5% off",
            description: "Packed and delivered each month",
            features: ["Packed by strip, with the bill", "5% off MRP on regular medicines", "Free delivery in Salem", "Change or stop any month"],
            highlight: true,
            badge: "Most chosen",
            cta: { label: "Start my box", href: waLink("Hello Thunai Pharmacy, I would like a monthly medicine box. Name: … Prescription attached.") },
          },
          {
            name: "Senior care box",
            price: 4_900,
            period: "/ month",
            description: "For parents living on their own",
            features: ["Everything in the monthly box", "A weekly check-in call from the pharmacist", "Packed by day, with a large-print list", "Same-day delivery to the door"],
            cta: { label: "Ask about it", href: waLink("Hello Thunai Pharmacy, I would like to know about the senior care box for my parent. Area: …") },
          },
        ],
      },
      {
        type: "collection",
        id: "tn-monsoon",
        title: "Rainy-season shelf",
        collectionSlug: "monsoon-care",
        layout: "carousel",
        limit: 10,
      },
      {
        type: "team",
        id: "tn-team",
        title: "Who will help you at the counter",
        text: "Four people who know your name and your regular medicines.",
        members: [
          { name: "Kalaiselvi Murugan", role: "Pharmacist in charge (B.Pharm)", bio: "Checks every prescription and every Schedule H1 sale herself. Registration number on the bill (demo)." },
          { name: "Abirami Natarajan", role: "Counter and billing", bio: "Your bill, your refill reminders and the call when your order is packed." },
          { name: "Saravanan Palanisamy", role: "Counter and billing", bio: "Evening counter, UPI and card payments, and the credit accounts of local clinics." },
          { name: "Velmurugan Arumugam", role: "Stock and delivery", bio: "Receives every batch, checks the expiry and takes the orders out in Salem." },
        ],
      },
      { type: "faq", id: "tn-faq", title: "Before you order", items: FAQ },
      {
        type: "usp",
        id: "tn-promises",
        layout: "inline",
        items: [
          { icon: "check", title: "Pharmacist-checked", text: "Every prescription, every time" },
          { icon: "truck", title: "Same-day in Salem", text: "Confirmed by 7 pm" },
          { icon: "shield", title: "Genuine, in date", text: "Batch and expiry on every pack" },
        ],
      },
      {
        type: "location",
        id: "tn-visit",
        title: "Timings and night service",
        address: ADDRESS,
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "11.6738, 78.1447",
      },
      { type: "text", id: "tn-note", heading: "Please read", markdown: NEEDS_NOTE, style: { background: "muted" } },
    ],
    translations: {
      ta: {
        "tn-finder": {
          title: "இன்று உங்களுக்கு என்ன வேண்டும்?",
          text: "தேவை, யாருக்கு, எந்த வடிவம் என்று தேர்ந்தெடுங்கள். பொருந்துவதைக் காட்டுவோம்; உறுதியில்லையா? மருந்தாளர் ஒரு செய்தி தூரத்தில்.",
          buttonLabel: "என் பட்டியலைக் காட்டு",
          cta: { label: "வாட்ஸ்அப்பில் மருந்தாளரிடம் கேளுங்கள்" },
          questions: [
            { label: "என்ன தேவை?", options: [{ label: "காய்ச்சல்" }, { label: "சளி, இருமல்" }, { label: "வயிறு, அமிலத்தன்மை" }, { label: "வலி, மூட்டு" }, { label: "சர்க்கரை நோய்" }, { label: "இரத்த அழுத்தம், இதயம்" }, { label: "வைட்டமின், நோய் எதிர்ப்பு" }, { label: "குழந்தைப் பராமரிப்பு" }] },
            { label: "யாருக்கு?", options: [{ label: "குழந்தை" }, { label: "பெரியவர்" }, { label: "மூத்தவர் (60+)" }] },
            { label: "எந்த வடிவம்?", options: [{ label: "மாத்திரை, கேப்ஸ்யூல்" }, { label: "சிரப், சொட்டு, திரவம்" }, { label: "கிரீம், ஜெல், எண்ணெய்" }, { label: "சாதனங்கள், கிட்" }, { label: "பராமரிப்புப் பொருள்கள்" }] },
          ],
        },
        "tn-needs": {
          title: "உடல்நலத் தேவை வாரியாக",
          text: "ஒவ்வொரு டைலும் அந்தத் தேவைக்கான பொருள்களைத் திறக்கும். மருந்துச் சீட்டு மருந்துகள் மருந்தாளர் சீட்டைப் பார்த்த பின்பே பேக் செய்யப்படும்.",
          items: [
            { label: "சர்க்கரை நோய்", note: "குளுக்கோமீட்டர், ஸ்ட்ரிப், மாத்திரை, இன்சுலின்" },
            { label: "இரத்த அழுத்தம், இதயம்", note: "வீட்டு மானிட்டர், வழக்கமான மருந்துகள்" },
            { label: "குழந்தைப் பராமரிப்பு", note: "டயபர், லோஷன், பால் புட்டி" },
            { label: "பெண்கள் நலம்", note: "நாப்கின், இரும்பு, ஃபோலிக் அமிலம்" },
            { label: "எலும்பு, மூட்டு", note: "ஜெல், ஸ்ப்ரே, எண்ணெய், கால்சியம், வைட்டமின் D" },
            { label: "சளி, இருமல்", note: "சிரப், லோசெஞ்சு, மாத்திரை, நெபுலைசர்" },
            { label: "வயிறு, அமிலத்தன்மை", note: "அமில எதிர்ப்பு, ORS, செரிமானப் பராமரிப்பு" },
            { label: "சித்தா, ஆயுர்வேதம்", note: "கசாயம், திரிபலா, சியவனப்பிராசம்" },
          ],
        },
        "tn-rx": {
          heading: "மருந்துச் சீட்டு உள்ளதா?",
          markdown:
            "தெளிவான படத்தை **வாட்ஸ்அப்பில்** அனுப்புங்கள்; மருந்தாளர் ஒவ்வொரு மருந்தையும் சரிபார்த்து, பில்லைச் சொல்லி, பேக் செய்வார்: பகலில் பொதுவாக 30 நிமிடத்தில்; மாலை 7க்குள் உறுதியான ஆர்டர்களுக்கு சேலத்தில் அதே நாள் டெலிவரி. அல்லது கவுண்டருக்குக் கொண்டு வாருங்கள்.\n\n**ஷெட்யூல் H** மருந்துகளை பதிவு பெற்ற மருத்துவரின் சரியான மருந்துச் சீட்டுடன் மட்டுமே, **ஷெட்யூல் H1** மருந்துகளைக் கவுண்டரில் மட்டுமே விற்கிறோம். உங்கள் மருந்துச் சீட்டு உங்கள் மருந்தைத் தருவதற்கு மட்டுமே பயன்படும்.",
          cta: { label: "என் மருந்துச் சீட்டை வாட்ஸ்அப்பில் அனுப்பு" },
        },
        "tn-steps": {
          title: "மருந்துச் சீட்டு ஆர்டர் எப்படி நடக்கிறது",
          text: "நான்கு படிகள்; ஒவ்வொன்றிலும் மருந்தாளர் போனில் இருப்பார்.",
          items: [
            { when: "படி 1", title: "அனுப்புங்கள்", text: "மருந்துச் சீட்டின் படத்தை வாட்ஸ்அப்பில் அனுப்புங்கள், அல்லது டெலிவரி முகவரி, போன் எண்ணுடன் கொண்டு வாருங்கள்." },
            { when: "படி 2", title: "சரிபார்ப்பு", text: "மருந்தாளர் படித்து, ஒவ்வொரு மருந்தையும் அளவையும் சரிபார்த்து, பில்லுடன் அழைப்பார். உங்கள் மருத்துவர் அனுமதித்தால் மட்டுமே அதே உப்பு உள்ள மாற்று மருந்து தரப்படும்." },
            { when: "படி 3", title: "பேக்கிங்", text: "நீங்கள் உறுதி செய்து UPI, கார்டு அல்லது டெலிவரியில் பணமாகச் செலுத்துங்கள். ஒவ்வொரு பேக்கும் பேட்ச், காலாவதிப்படி, முதலில் காலாவதியாகும் பேக் முதலில் எடுக்கப்பட்டு, பில்லுடன் பேக் செய்யப்படும்." },
            { when: "படி 4", title: "டெலிவரி", text: "மாலை 7க்குள் உறுதியான ஆர்டர்களுக்கு சேலத்தில் அதே நாள் டெலிவரி. இன்சுலின் குளிர்ப் பையில் வரும். அடுத்த முறைக்காக உங்கள் மருந்துச் சீட்டு பதிவில் இருக்கும்." },
          ],
        },
        "tn-bp": {
          title: "வீட்டிலேயே இரத்த அழுத்தத்தைப் பாருங்கள்",
          text: "எங்களிடம் உள்ள மூன்று மானிட்டர்கள் அருகருகே. வீட்டு அளவீடு மருத்துவருக்கு உதவும்; மருத்துவப் பரிசோதனைக்கு மாற்று அல்ல.",
          highlightLabel: "குடும்பங்களுக்கு சிறந்தது",
          rows: [
            { label: "அளவிடும் இடம்", values: ["மேல் கை", "மேல் கை", "மணிக்கட்டு"] },
            { label: "நினைவகம்", values: ["30 அளவீடுகள்", "2 பேர் × 60 அளவீடுகள்", "60 அளவீடுகள்"] },
            { label: "திரை", values: ["சாதாரணம்", "மிகப் பெரியது", "சிறியது"] },
            { label: "யாருக்கு நல்லது", values: ["வீட்டில் ஒருவருக்கு", "தம்பதிகள், குடும்பங்கள்", "பயணம், பாக்கெட்"] },
            { label: "உத்தரவாதம்", values: ["1 ஆண்டு (டெமோ)", "1 ஆண்டு (டெமோ)", "1 ஆண்டு (டெமோ)"] },
          ],
        },
        "tn-sugar": {
          title: "வீட்டிலேயே சர்க்கரையைப் பாருங்கள்",
          text: "பெட்டியில் ஸ்ட்ரிப்புகளுடன் இரண்டு குளுக்கோமீட்டர் கிட்கள். ஸ்ட்ரிப்புகள் தனியாக விற்கப்படும்; உங்கள் மீட்டருக்குப் பொருந்த வேண்டும்.",
          highlightLabel: "அதிகம் வாங்கப்படுவது",
          rows: [
            { label: "பெட்டியில் ஸ்ட்ரிப்", values: ["10", "25"] },
            { label: "திரை", values: ["சாதாரணம்", "பெரியது, குரலுடன்"] },
            { label: "நினைவகம்", values: ["100 அளவீடுகள்", "300 அளவீடுகள்"] },
            { label: "யாருக்கு நல்லது", values: ["முதல் முறை பயன்படுத்துபவர்", "பார்வை குறைந்தவர்"] },
            { label: "லான்சிங் பேனா", values: ["உள்ளது", "உள்ளது"] },
          ],
        },
        "tn-box": {
          title: "மாதாந்திர மருந்துப் பெட்டி",
          text: "வழக்கமான மருந்துகளுக்கு (இரத்த அழுத்தம், சர்க்கரை, தைராய்டு, கொலஸ்ட்ரால்). மருந்துச் சீட்டை ஒருமுறை தாருங்கள்; தீரும் முன் நினைவூட்டி, உங்கள் மாதத்துக்குப் பேக் செய்து டெலிவரி செய்வோம். மருந்துகளுக்கு மட்டும், பெட்டித் தள்ளுபடி போக MRP கட்டணம்.",
          plans: ([
            { name: "நினைவூட்டல்", period: "இலவசம்", description: "ஸ்ட்ரிப் தீர ஒரு வாரம் முன் வாட்ஸ்அப் நினைவூட்டல்", features: ["வாட்ஸ்அப்பில் நினைவூட்டல்", "ஒரே பதிலில் மறுஆர்டர்", "உங்கள் மருந்துச் சீட்டு பதிவில்"], cta: { label: "நினைவூட்டல் அமை" } },
            { name: "மாதாந்திரப் பெட்டி", period: "கட்டணம் இல்லை, 5% தள்ளுபடி", description: "ஒவ்வொரு மாதமும் பேக் செய்து டெலிவரி", features: ["ஸ்ட்ரிப் வாரியாக, பில்லுடன் பேக்", "வழக்கமான மருந்துகளுக்கு MRPயில் 5% தள்ளுபடி", "சேலத்தில் இலவச டெலிவரி", "எந்த மாதமும் மாற்றலாம் அல்லது நிறுத்தலாம்"], badge: "அதிகம் தேர்வாவது", cta: { label: "என் பெட்டியைத் தொடங்கு" } },
            { name: "மூத்தோர் பராமரிப்புப் பெட்டி", period: "/ மாதம்", description: "தனியாக வசிக்கும் பெற்றோருக்கு", features: ["மாதாந்திரப் பெட்டியில் உள்ள அனைத்தும்", "மருந்தாளரின் வாராந்திர நலம் விசாரிப்பு அழைப்பு", "நாள் வாரியாக, பெரிய எழுத்துப் பட்டியலுடன் பேக்", "வீட்டு வாசலுக்கு அதே நாள் டெலிவரி"], cta: { label: "விவரம் கேளுங்கள்" } },
          ] as Record<string, unknown>[]) as never,
        },
        "tn-monsoon": { title: "மழைக்காலத் தட்டு" },
        "tn-team": {
          title: "கவுண்டரில் உங்களுக்கு உதவுபவர்கள்",
          text: "உங்கள் பெயரையும் வழக்கமான மருந்துகளையும் அறிந்த நான்கு பேர்.",
          members: [
            { role: "பொறுப்பு மருந்தாளர் (B.Pharm)", bio: "ஒவ்வொரு மருந்துச் சீட்டையும், ஒவ்வொரு ஷெட்யூல் H1 விற்பனையையும் தானே சரிபார்ப்பவர். பதிவு எண் பில்லில் (டெமோ)." },
            { role: "கவுண்டர், பில்லிங்", bio: "உங்கள் பில், மறுநிரப்பு நினைவூட்டல், ஆர்டர் பேக் ஆனதும் அழைப்பு." },
            { role: "கவுண்டர், பில்லிங்", bio: "மாலைக் கவுண்டர், UPI, கார்டு கட்டணங்கள், உள்ளூர் கிளினிக்குகளின் கடன் கணக்குகள்." },
            { role: "இருப்பு, டெலிவரி", bio: "ஒவ்வொரு பேட்சையும் பெற்று, காலாவதியைச் சரிபார்த்து, சேலத்தில் ஆர்டர்களைக் கொண்டு செல்பவர்." },
          ],
        },
        "tn-faq": { title: "ஆர்டர் செய்யும் முன்", items: FAQ_TA },
        "tn-promises": {
          items: [{ title: "மருந்தாளர் சரிபார்ப்பு", text: "ஒவ்வொரு மருந்துச் சீட்டும், ஒவ்வொரு முறையும்" }, { title: "சேலத்தில் அதே நாள்", text: "மாலை 7க்குள் உறுதியானால்" }, { title: "அசல், காலாவதிக்குள்", text: "ஒவ்வொரு பேக்கிலும் பேட்ச், காலாவதி" }],
        },
        "tn-visit": { title: "நேரமும் இரவுச் சேவையும்", address: ADDRESS_TA, hours: HOURS_TA },
        "tn-note": { heading: "தயவுசெய்து படியுங்கள்", markdown: NEEDS_NOTE_TA },
      },
    },
  }),
  pages: [
    {
      slug: "prescriptions",
      title: "Prescriptions, Schedule H and H1: how we dispense",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "What needs a prescription" },
        {
          type: "paragraph",
          markdown:
            "| Kind | Examples | How we sell it |\n|---|---|---|\n| Everyday medicines | Paracetamol, antacids, ORS, vitamins | No prescription needed |\n| Schedule H | Most antibiotics, blood pressure, sugar, thyroid, acid and steroid medicines | Only against a valid prescription from a registered doctor; the pharmacist confirms before packing |\n| Schedule H1 | Some antibiotics, alprazolam, clonazepam, tramadol, pregabalin | Only at the counter, against a prescription, entered in the H1 register with the patient, doctor and batch; not sold online |\n\nThe pharmacist may refuse a prescription that is unclear, out of date, or that does not look genuine.",
        },
        { type: "image", url: photo(11370618, "tile"), alt: "A clipboard with a prescription and a bottle of tablets on a desk" },
        { type: "heading", level: 2, text: "Sending your prescription" },
        {
          type: "paragraph",
          markdown:
            "Send a clear photo (the whole page, name, date, doctor's name and registration number visible) on WhatsApp to **+91 98765 00084**, or bring it to the shop at 14, Fairlands Main Road, Salem. We call you with the bill; you pay by UPI, card or cash on delivery. Keep the original: we may ask to see it when we deliver.",
        },
        { type: "button", label: "Send my prescription on WhatsApp", href: waLink(RX_MESSAGE), style: "primary" },
      ],
    },
    {
      slug: "monthly-box",
      title: "The monthly medicine box and refill reminders",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "For medicines you take every month" },
        {
          type: "paragraph",
          markdown:
            "If you or your parents take the same tablets every month (blood pressure, sugar, thyroid, cholesterol), the **monthly box** saves the trip. We keep the prescription on file, remind you on WhatsApp a week before the strips run out, pack the month by strip with the bill and deliver it in Salem free. You can change a medicine or stop any month, and the box is **5% off MRP** on regular medicines.",
        },
        { type: "image", url: photo(3873162, "tile"), alt: "A weekly pill organiser filled with tablets and capsules" },
        { type: "heading", level: 2, text: "A repeat prescription" },
        {
          type: "paragraph",
          markdown:
            "A prescription marked to repeat can be filled again until the date or the number of refills the doctor wrote; after that you need a new one. Do not change your dose because a box is on its way: talk to your doctor first.",
        },
        { type: "button", label: "Start my box on WhatsApp", href: waLink("Hello Thunai Pharmacy, I would like a monthly medicine box. Name: … Prescription attached."), style: "primary" },
        { type: "button", label: "See monthly refills", href: "/collections/monthly-refills", style: "secondary" },
      ],
    },
    {
      slug: "about",
      title: "About Thunai",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Thunai, Fairlands, Salem" },
        {
          type: "paragraph",
          markdown:
            "Thunai means *companion*. We are a neighbourhood pharmacy: a pharmacist in charge, two counter staff and a stock keeper who receives every batch and checks the expiry. We fill prescriptions, sell everyday medicines, home-check devices, baby care and siddha and ayurvedic remedies, and supply local clinics and nursing homes on monthly credit.",
        },
        { type: "image", url: photo(14797855, "tile"), alt: "A pharmacist at the shelves of a pharmacy" },
        {
          type: "paragraph",
          markdown: `Open every day, 8 am to 10:30 pm. Call or WhatsApp **+91 98765 00084**. ${ADDRESS}.\n\nDrug Licence (Form 20 / 21): TN-SLM-DEMO-20-0000 / TN-SLM-DEMO-21-0000. Registered Pharmacist: Kalaiselvi Murugan, TNPC-DEMO-00000. These numbers are **demo placeholders**, and so are the shop, the address and the phone number: this store is a demonstration.`,
        },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our customers or staff, and the products shown are stand-ins for the medicines named: check the pack and the composition on the label.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Medicines", type: "category", ref: "medicines" },
      { label: "Prescription", type: "category", ref: "prescription-medicines" },
      { label: "Diabetes", type: "category", ref: "diabetes-care" },
      { label: "Baby care", type: "category", ref: "baby-care" },
      { label: "Devices", type: "category", ref: "devices" },
      { label: "Monthly box", type: "page", ref: "monthly-box" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Send a prescription", type: "page", ref: "prescriptions" },
          { label: "Monthly medicine box", type: "page", ref: "monthly-box" },
          { label: "WhatsApp the pharmacist", type: "url", href: `https://wa.me/${WHATSAPP}` },
          { label: "About us", type: "page", ref: "about" },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "Diabetes care", type: "collection", ref: "diabetes-care" },
          { label: "BP and heart", type: "collection", ref: "bp-heart" },
          { label: "Rainy-season care", type: "collection", ref: "monsoon-care" },
          { label: "Siddha and ayurveda", type: "collection", ref: "ayurveda" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  /** Schedule H1 medicines are sold only at the counter: off the online store (idempotent; the pharmacy app still has them). */
  async setup(kit: Kit, tenant: { id: string; slug: string }, _ownerUserId: string, log: Logger) {
    const svc = kit.catalogue.service;
    for (const name of H1_NAMES) {
      const found = (await svc.listProducts(tenant.id, { q: name, limit: 20 })).items.find((x) => x.name === name);
      if (!found) continue;
      const product = await svc.getProduct(tenant.id, found.id);
      if (!product.channels.includes("store")) continue;
      await svc.updateProduct(tenant.id, found.id, { channels: product.channels.filter((c) => c !== "store") });
      log.info({ slug: tenant.slug, item: name }, "demo store: Schedule H1 medicine kept off the online store");
    }
  },
};
