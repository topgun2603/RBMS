import { setupSpa } from "./spa-setup";
import { AYUR, COUPLE, FACIALS, FOOT, MASSAGES, MEMBER, PRODUCTS, SCRUBS, STEAM, VOUCHER } from "./spa-products";
import type { DemoStore } from "./types";

/**
 * Sukham Ayur Spa, R.S. Puram, Coimbatore (sukham.localhost:3003; admin and desk sukham.localhost:3008), store #21.
 * The services app (SV) with the `spa` trade and the "lotus-mist" look (theme-presets-spa.ts): a quiet wellness centre
 * with Ayurvedic therapies (abhyanga, shirodhara, kizhi / potli, udvartana), massages, scrubs and wraps, facials, foot
 * reflexology, couple suites, steam and sauna, three membership plans and gift vouchers. Every therapy duration is a
 * bookable appointment service (online at /book, with a therapist or the first free one); memberships are sold and
 * checked in at the desk. Unlike Glow (the salon, hair and beauty) it sells time and calm, not styling. Page layout:
 * standard without the bottom tab bar (the one of the eight combinations that fits a guest who visits twice a month).
 * Address, phone and GSTIN are demo placeholders (the GSTIN has a valid check digit).
 *
 * GST (verified): "services by way of beauty and physical well-being" (SAC 9997: 999722 beauty treatment, 999723
 * physical well-being incl. spa, steam, sauna, massage, health club) were 18% and from 22 Sept 2025 are 5% **without
 * input tax credit** (Notification 15/2025-Central Tax (Rate) dated 17 Sept 2025, GST Council's 56th meeting), and the
 * rate is not optional. Sources: https://www.businesstoday.in/amp/india/story/gst-rate-cut-salon-visits-gyms-yoga-classes-to-get-cheaper-from-sept-22-says-cbic-494193-2025-09-16
 * and https://www.caclubindia.com/news/cbic-notifies-major-gst-rate-changes-on-services-effective-september-22-2025-25466.asp
 * (secondary sources; the notification text was not read). Used here for every therapy, steam and sauna session, the
 * memberships (a health-club service) and the gift vouchers (billed as the service they buy: whether a voucher is a
 * supply at sale or at redemption is uncertain, check before invoicing for real). Ayurvedic treatment given by a
 * clinical establishment for a diagnosed illness is exempt (heading 9993), which a wellness spa is not. The older
 * demo shops (Glow, IronFit) still list 18% items; this shop follows the new rate.
 */

const PHONE = "+919876500027";
const WHATSAPP = "919876500027";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
const rs = (rupees: number) => Math.round(rupees * 100);

const HOURS = [{ label: "Every day", value: "9:30 am – 8:30 pm (last booking 7:30 pm)" }];
const HOURS_TA = [{ label: "தினமும்", value: "காலை 9:30 – இரவு 8:30 (கடைசி முன்பதிவு இரவு 7:30)" }];

const FAQ = [
  { q: "I have never had a massage. What should I book?", a: "A **60-minute Swedish massage** or an **abhyanga**. Both are light to medium pressure, nothing awkward: you undress to your comfort and are covered with a towel throughout, and only the part being worked on is uncovered. Tell your therapist about any pain, injury or oil you dislike before you start." },
  { q: "Are Ayurvedic therapies medical treatment?", a: "No. These are traditional wellness therapies for relaxation and general comfort, not treatment for a disease. If you have a condition (high blood pressure, a recent surgery, a skin disease, a disc problem), tell us when you book. Some therapies are not suitable and we will say so." },
  { q: "Can I choose my therapist?", a: "Yes. On the booking page pick a therapist or leave it on **anyone**, and we assign the first free one. Ask for a male or female therapist on the notes line and we will keep to it." },
  { q: "What if I need to change or cancel?", a: "You can cancel or look at your booking from the link we send, up to **2 hours** before. For a late change call or WhatsApp us; we move it free if we can. Missing a booking without a word is charged 50% for therapies of 90 minutes or more." },
  { q: "How do memberships work?", a: "A membership is a pack of sessions with a validity: 4 in 30 days, 12 in 90 or 48 in 365. Sessions are checked in at the front desk by your phone number, once a day. Quarterly and annual members can **freeze** the plan (7 and 30 days) for travel or illness, and the end date moves." },
  { q: "Do gift vouchers expire?", a: "They are valid for 12 months from the day of purchase, on any therapy, steam or package, and can be used in parts. We send the code on WhatsApp or e-mail the same day, with a message of your choice." },
  { q: "Is GST included?", a: "Yes. Every price on the site includes **5% GST** (beauty and physical well-being services, without input tax credit), and your bill shows the SAC code." },
];
const FAQ_TA = [
  { q: "நான் இதுவரை மசாஜ் செய்ததில்லை. எதை முன்பதிவு செய்வது?", a: "**60 நிமிட ஸ்வீடிஷ் மசாஜ்** அல்லது **அப்யங்கா**. இரண்டும் மெல்லிய முதல் நடுத்தர அழுத்தம்தான்; சங்கடம் இல்லை. உங்கள் வசதிப்படி ஆடை நீக்கலாம்; துண்டால் எப்போதும் மூடப்பட்டிருப்பீர்கள், மசாஜ் செய்யும் பகுதி மட்டுமே திறந்திருக்கும். தொடங்கும் முன் வலி, காயம், பிடிக்காத எண்ணெய் பற்றி சிகிச்சையாளரிடம் சொல்லுங்கள்." },
  { q: "ஆயுர்வேத சிகிச்சைகள் மருத்துவ சிகிச்சையா?", a: "இல்லை. இவை ஓய்வுக்கும் பொது நலத்துக்குமான பாரம்பரிய நல்வாழ்வு சிகிச்சைகள், நோய்க்கான மருத்துவம் அல்ல. உயர் இரத்த அழுத்தம், சமீபத்திய அறுவைச் சிகிச்சை, தோல் நோய், டிஸ்க் பிரச்சினை இருந்தால் முன்பதிவின்போது சொல்லுங்கள். சில சிகிச்சைகள் பொருந்தாது; நாங்கள் சொல்வோம்." },
  { q: "என் சிகிச்சையாளரைத் தேர்ந்தெடுக்கலாமா?", a: "ஆம். முன்பதிவுப் பக்கத்தில் சிகிச்சையாளரைத் தேர்ந்தெடுக்கலாம் அல்லது **யாராவது** என விடுங்கள்; முதலில் காலியாக இருப்பவர் ஒதுக்கப்படுவார். ஆண் அல்லது பெண் சிகிச்சையாளர் வேண்டுமென்றால் குறிப்பில் எழுதுங்கள்." },
  { q: "மாற்ற அல்லது ரத்து செய்ய வேண்டுமானால்?", a: "நாங்கள் அனுப்பும் இணைப்பில் தொடக்கத்துக்கு **2 மணி** முன்புவரை ரத்து செய்யலாம். தாமத மாற்றத்துக்கு அழையுங்கள் அல்லது வாட்ஸ்அப் செய்யுங்கள்; முடிந்தால் இலவசமாக மாற்றுவோம். சொல்லாமல் வராதவர்களுக்கு 90 நிமிடம் அல்லது அதற்கு மேற்பட்ட சிகிச்சையில் 50% கட்டணம்." },
  { q: "உறுப்பினர் திட்டம் எப்படி வேலை செய்கிறது?", a: "உறுப்பினர் திட்டம் என்பது செல்லுபடியுடன் கூடிய அமர்வுத் தொகுப்பு: 30 நாளில் 4, 90 நாளில் 12, 365 நாளில் 48. வரவேற்பில் உங்கள் தொலைபேசி எண்ணால் தினம் ஒருமுறை பதிவு செய்யப்படும். காலாண்டு, ஆண்டுத் திட்டத்தினர் பயணம் அல்லது உடல்நலக்குறைவுக்கு (7 மற்றும் 30 நாள்) **நிறுத்தி** வைக்கலாம்; முடிவு தேதி நகரும்." },
  { q: "பரிசு வவுச்சர் காலாவதியாகுமா?", a: "வாங்கிய நாளிலிருந்து 12 மாதம் செல்லும்; எந்தச் சிகிச்சை, ஸ்டீம் அல்லது பேக்கேஜுக்கும் பயன்படுத்தலாம், பகுதி பகுதியாகவும். அதே நாளில் வாட்ஸ்அப் அல்லது மின்னஞ்சலில் குறியீட்டை உங்கள் செய்தியுடன் அனுப்புவோம்." },
  { q: "ஜிஎஸ்டி சேர்ந்ததா?", a: "ஆம். தளத்தில் உள்ள ஒவ்வொரு விலையிலும் **5% ஜிஎஸ்டி** சேர்ந்தது (அழகு, உடல்நல சேவைகள், உள்ளீட்டு வரிக் கடன் இல்லாமல்); உங்கள் பில்லில் SAC குறியீடு இருக்கும்." },
];

const PHOTOS: DemoStore["photos"] = {
  35884502: { by: "Pexels contributor", alt: "A massage table with a rolled towel, a candle and oils in a quiet treatment room" },
  6187418: { by: "Pexels contributor", alt: "A therapist massaging a woman's shoulders in a calm spa" },
  19641818: { by: "Pexels contributor", alt: "Close-up of a therapist massaging a woman's back" },
  6628649: { by: "Pexels contributor", alt: "A full-body massage in an indoor spa" },
  19641816: { by: "Pexels contributor", alt: "Massage oil being applied to a client's back" },
  6628701: { by: "Pexels contributor", alt: "Hands massaging a person's back indoors" },
  19666192: { by: "Pexels contributor", alt: "A woman receiving a neck massage with an aromatherapy theme" },
  9146372: { by: "Pexels contributor", alt: "Close-up of a woman enjoying a back massage" },
  6187421: { by: "Pexels contributor", alt: "A woman receiving a herbal massage in a traditional setting" },
  20689447: { by: "Pexels contributor", alt: "Bay leaves, herbs and oils in bowls on a white background" },
  39344587: { by: "Pexels contributor", alt: "A spa tray with oils, towels and flowers" },
  11627566: { by: "Pexels contributor", alt: "Hands during a herbal spa treatment" },
  20689436: { by: "Pexels contributor", alt: "Honey, herbs and leaves seen from above with a jar and spoon" },
  6560267: { by: "Pexels contributor", alt: "A spa massage with oil being applied" },
  28321583: { by: "Pexels contributor", alt: "An indoor massage with aromatic oils" },
  5308675: { by: "Pexels contributor", alt: "A coffee scrub applied to a leg" },
  27860845: { by: "Pexels contributor", alt: "A golden body scrub textured on skin" },
  11635432: { by: "Pexels contributor", alt: "Two jars of body and Himalayan salt scrubs" },
  27860842: { by: "Pexels contributor", alt: "An exfoliating scrub on a shoulder with black mud on the back" },
  7148526: { by: "Pexels contributor", alt: "Traditional Indian hair and skin care with aloe vera" },
  37229309: { by: "Pexels contributor", alt: "A woman with a facial mask and cucumber slices" },
  37229301: { by: "Pexels contributor", alt: "Close-up of a woman receiving a soothing facial mask" },
  6978043: { by: "Pexels contributor", alt: "A woman with a green clay mask in a bright room" },
  12115040: { by: "Pexels contributor", alt: "A beautician removing a clay mask from a woman's face" },
  7446659: { by: "Pexels contributor", alt: "An aesthetician giving a facial in a modern spa clinic" },
  5793888: { by: "Pexels contributor", alt: "A therapist giving foot reflexology on a massage table" },
  15949782: { by: "Pexels contributor", alt: "Feet being poured over with petals in a spa" },
  18120174: { by: "Pexels contributor", alt: "Two women receiving massages side by side in a spa" },
  6634900: { by: "Pexels contributor", alt: "A couple in bathrobes with candles" },
  6634892: { by: "Pexels contributor", alt: "A couple in bathrobes in a warm setting" },
  7598363: { by: "Pexels contributor", alt: "A brown spa room with ambient lighting" },
  34097625: { by: "Pexels contributor", alt: "A sauna with steaming stones and wooden benches" },
  32504769: { by: "Pexels contributor", alt: "A Nordic sauna heater releasing steam" },
  7795824: { by: "Pexels contributor", alt: "An aromatherapy candle with spa towels and dried flowers" },
  7795393: { by: "Pexels contributor", alt: "Candles and skincare on a wooden tray" },
  1926811: { by: "Pexels contributor", alt: "Flickering candles, soft towels and fresh flowers" },
  34478574: { by: "Pexels contributor", alt: "Candles, citrus slices, a towel and eucalyptus" },
  13720331: { by: "Pexels contributor", alt: "Stacked white towels and a black candle" },
};

/** The five chapters of a visit (English and Tamil), shared by the sticky story. */
const RITUAL = [
  { eyebrow: "On arrival", heading: "Tea, a foot wash and a quiet minute", markdown: "You are greeted by name, given **tulsi-ginger tea** and a warm foot wash. No rush: arrive 10 minutes early, fill a short form (any pain, allergy or pregnancy) and your therapist comes to meet you.", alt: "Candles, citrus slices, a towel and eucalyptus", photo: 34478574 },
  { eyebrow: "Step 1", heading: "A herbal steam to open the skin", markdown: "For Ayurvedic therapies we start with 10 minutes in a **private herbal steam cabin** (nirgundi and eucalyptus), so oil is absorbed and muscles let go. Skipped if you prefer.", alt: "A brown spa room with ambient lighting", photo: 7598363 },
  { eyebrow: "Step 2", heading: "The therapy itself", markdown: "Warm oil, the right pressure and a therapist who asks, rather than assumes. **Say 'harder' or 'softer' anytime.** The room is 24 degrees, the music is low and the phone stays outside.", alt: "A therapist massaging a woman's shoulders in a calm spa", photo: 6187418 },
  { eyebrow: "Step 3", heading: "Rest, then a warm shower", markdown: "You rest for **10 minutes** under a blanket while the oil settles, then a warm shower with herbal bath powder (shampoo and towels provided).", alt: "Stacked white towels and a black candle", photo: 13720331 },
  { eyebrow: "To finish", heading: "Warm water, jaggery and a plan for the week", markdown: "A cup of **dry-ginger coriander water**, a bite of jaggery and your therapist's one-line advice for the evening: eat light, drink water, sleep early.", alt: "Candles and skincare on a wooden tray", photo: 7795393 },
];
const RITUAL_TA = [
  { eyebrow: "வருகையில்", heading: "தேநீர், கால் கழுவல், ஒரு அமைதி நிமிடம்", markdown: "பெயர் சொல்லி வரவேற்று **துளசி-இஞ்சி தேநீர்**, வெதுவெதுப்பான கால் கழுவல் தருவோம். அவசரம் இல்லை: 10 நிமிடம் முன்பே வாருங்கள், சிறு படிவம் நிரப்புங்கள் (வலி, ஒவ்வாமை, கர்ப்பம்); சிகிச்சையாளர் உங்களைச் சந்திப்பார்." },
  { eyebrow: "படி 1", heading: "தோல் திறக்க மூலிகை ஆவி", markdown: "ஆயுர்வேத சிகிச்சைகளுக்கு முதலில் 10 நிமிடம் **தனி மூலிகை ஸ்டீம் அறை** (நொச்சி, யூகலிப்டஸ்), எண்ணெய் உள்ளே செல்லவும் தசை தளரவும். விரும்பாவிட்டால் தவிர்க்கலாம்." },
  { eyebrow: "படி 2", heading: "சிகிச்சை", markdown: "வெதுவெதுப்பான எண்ணெய், சரியான அழுத்தம், ஊகிக்காமல் கேட்கும் சிகிச்சையாளர். **எப்போது வேண்டுமானாலும் 'அழுத்தம் கூட்டு' அல்லது 'குறை' என்று சொல்லுங்கள்.** அறை 24 டிகிரி, இசை மெதுவாக, போன் வெளியே." },
  { eyebrow: "படி 3", heading: "ஓய்வு, பின் வெந்நீர்க் குளியல்", markdown: "எண்ணெய் ஊறும்வரை போர்வைக்குள் **10 நிமிடம்** ஓய்வு, பின் மூலிகைக் குளியல் பொடியுடன் வெந்நீர்க் குளியல் (ஷாம்பூ, துண்டு தரப்படும்)." },
  { eyebrow: "முடிவில்", heading: "சுக்கு-கொத்தமல்லி நீர், வெல்லம், வாரத்துக்கான ஆலோசனை", markdown: "ஒரு கோப்பை **சுக்கு-கொத்தமல்லி நீர்**, சிறு வெல்லத் துண்டு, இன்று மாலைக்கான ஒரு வரி ஆலோசனை: இலகுவாகச் சாப்பிடுங்கள், நீர் குடியுங்கள், சீக்கிரம் உறங்குங்கள்." },
];

export const SPA: DemoStore = {
  shop: {
    slug: "sukham",
    appId: "SV",
    businessType: "spa",
    planId: "pro",
    name: "Sukham Ayur Spa",
    primary: "#504d7d",
    billing: {
      legalName: "Sukham Ayur Spa and Wellness",
      gstin: "33AASFS4417K1ZT",
      address: "58, D.B. Road, R.S. Puram",
      city: "Coimbatore",
      pincode: "641002",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "SK",
      upiId: "sukhamspa@okhdfcbank",
    },
    // The desk's own billing items (the therapies come from the catalogue); kept off the online store.
    items: [
      { name: "Walk-in head massage (15 min)", hsn: "999723", unit: "service", rate: Math.round(40_000 / 1.05), gstRate: 5 },
      { name: "Herbal tea and snacks", hsn: "9963", unit: "pcs", rate: 8_000, gstRate: 5 },
      { name: "Corporate chair massage (on-site, 20 min per person)", hsn: "999723", unit: "person", rate: Math.round(70_000 / 1.05), gstRate: 5 },
      { name: "Corporate wellness day package (per person)", hsn: "999723", unit: "person", rate: Math.round(150_000 / 1.05), gstRate: 5 },
    ],
  },
  preset: "lotus-mist",
  store: {
    open: true,
    codEnabled: false,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@sukhamspa.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/sukham.ayur.spa", youtube: "https://youtube.com/@sukhamayurspa" },
    policies: {
      shipping:
        "Memberships and gift vouchers are **delivered digitally**: the voucher code arrives on WhatsApp or e-mail the same day, and a membership is activated at the front desk with your phone number. Nothing is shipped. Appointments are booked at **/book**.",
      returns:
        "**Bookings:** cancel up to 2 hours before from your booking link, free of charge. **Vouchers** are not refundable in cash and are valid for 12 months. **Memberships** can be frozen (quarterly 7 days, annual 30 days) but not refunded after the first session. If a session is not to your liking, tell the manager before you leave and we redo it or give the time back.",
      privacy:
        "We keep your name, phone, the therapies you take and any health note you give us (allergies, injuries, pregnancy) only to look after you and to send your bill. Health notes are seen by your therapist and the manager, never shared or used for marketing.",
      terms:
        "Prices include 5% GST (beauty and physical well-being services, without input tax credit). Couple packages are priced for two. Please arrive 10 minutes early; a late arrival is shortened to the booked end time. Therapies are for wellness, not medical treatment. Guests under 18 need a parent present. We do not provide any sexual service; such a request ends the session.",
    },
    businessType: "spa",
  },
  zones: [
    {
      name: "Digital delivery (vouchers and memberships)",
      states: ["33"],
      rate: { name: "WhatsApp or e-mail, same day", type: "flat", amount: 0, etaMinDays: 0, etaMaxDays: 0, codAllowed: false, codFee: 0 },
    },
    {
      name: "Rest of India (digital)",
      rate: { name: "WhatsApp or e-mail, same day", type: "flat", amount: 0, etaMinDays: 0, etaMaxDays: 0, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: MASSAGES, description: "Swedish, deep tissue, Thai, aromatherapy and hot stone massages, from 30 minutes to 90.", photo: 6187418 },
    { name: AYUR, description: "Abhyanga, shirodhara, kizhi, udvartana and other Ayurvedic oil therapies by trained therapists.", photo: 20689447 },
    { name: SCRUBS, description: "Coffee, sandalwood, rice and coconut body scrubs, mud and aloe wraps.", photo: 27860845 },
    { name: FACIALS, description: "Cleansing, radiance, Kumkumadi and hydrating facials for her and him.", photo: 37229301 },
    { name: FOOT, description: "Foot reflexology in 30, 45 or 60 minutes and a herbal foot soak.", photo: 5793888 },
    { name: COUPLE, description: "Private suites for two: a relaxation massage, abhyanga with steam, an anniversary ritual.", photo: 6634900 },
    { name: STEAM, description: "Private herbal steam cabin and dry cedar sauna, by the session or as a combo.", photo: 34097625 },
    { name: MEMBER, description: "Monthly, quarterly and annual session packs, with a freeze for travel.", photo: 7795824 },
    { name: VOUCHER, description: "Gift vouchers of ₹1,000, ₹2,500 and ₹5,000, valid for 12 months.", photo: 7795393 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "All therapies", slug: "all-therapies", description: "Every therapy, steam and package, A to Z.", rule: { sort: "name" } },
    { name: "Most booked", slug: "bestsellers", description: "What Coimbatore books again and again.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "To relax", slug: "relax", description: "Calm the mind: slow oils, warm steam, quiet rooms.", rule: { tag: "need-relax", sort: "price-asc" } },
    { name: "To recover", slug: "recover", description: "For stiff backs, tight shoulders and tired legs.", rule: { tag: "need-recover", sort: "price-asc" } },
    { name: "For glowing skin", slug: "glow", description: "Facials, scrubs and wraps.", rule: { tag: "need-glow", sort: "price-asc" } },
    { name: "Ayurveda", slug: "ayurveda", description: "Traditional oil therapies and herbal treatments.", rule: { tag: "ayurveda", sort: "price-asc" } },
    { name: "Quick, up to 45 minutes", slug: "quick", description: "When you have an hour for lunch.", rule: { tag: "time-short", sort: "price-asc" } },
    { name: "Under ₹1,500", slug: "under-1500", description: "Gentle prices for a first visit.", rule: { tag: "budget-low", sort: "price-asc" } },
  ],
  coupons: [
    { code: "FIRSTVISIT", description: "₹200 off your first therapy of ₹1,500 or more", type: "flat", value: 20_000, minOrder: 150_000, firstOrderOnly: true, perCustomerLimit: 1, channels: ["store"] },
    { code: "GIFTHOUR", description: "10% off gift vouchers of ₹2,500 or more (up to ₹500)", type: "percent", value: 10, minOrder: 250_000, maxDiscount: 50_000, channels: ["store", "manual"] },
  ],
  home: ({ photo, product }) => ({
    seo: {
      title: "Sukham Ayur Spa, Ayurvedic and wellness spa in R.S. Puram, Coimbatore",
      description:
        "Abhyanga, shirodhara, kizhi, massages, facials and couple suites in R.S. Puram, Coimbatore. Book your hour online, choose your therapist, save with a membership or gift a calm hour. All prices include 5% GST.",
      imageUrl: photo(35884502),
    },
    sections: [
      {
        type: "hero",
        id: "sk-hero",
        slides: [
          {
            imageUrl: photo(35884502),
            heading: "An hour that is only yours.",
            subheading: "Ayurvedic therapies, massages, facials and quiet rooms in R.S. Puram. Choose a therapy, a time and a therapist; we keep the rest calm.",
            cta: { label: "Book your hour", href: "/book" },
          },
        ],
      },
      {
        type: "finder",
        id: "sk-finder",
        title: "What do you need today?",
        text: "Three quiet questions. We show the therapies that fit.",
        layout: "wizard",
        results: "inline",
        limit: 6,
        imageUrl: photo(1926811, "tile"),
        cta: { label: "Not sure? Ask us on WhatsApp", href: waLink("Hello Sukham, I would like a recommendation. I need: … Time I have: …") },
        questions: [
          {
            label: "What do you need today?",
            options: [
              { label: "To relax and switch off", tag: "need-relax" },
              { label: "To recover from aches", tag: "need-recover" },
              { label: "To glow", tag: "need-glow" },
            ],
          },
          {
            label: "How much time do you have?",
            options: [
              { label: "About 30 to 45 minutes", tag: "time-short" },
              { label: "An hour or so", tag: "time-hour" },
              { label: "All afternoon, no hurry" },
            ],
          },
          {
            label: "What is your budget?",
            options: [
              { label: "Under ₹1,500", priceMax: rs(1500) },
              { label: "₹1,500 to ₹3,000", priceMin: rs(1500), priceMax: rs(3000) },
              { label: "Treat myself", priceMin: rs(2500) },
            ],
          },
        ],
      },
      {
        type: "sticky-story",
        id: "sk-ritual",
        title: "What a visit feels like",
        imageSide: "right",
        chapters: RITUAL.map((c) => ({ eyebrow: c.eyebrow, heading: c.heading, markdown: c.markdown, imageUrl: photo(c.photo, "tile"), alt: c.alt })),
      },
      {
        type: "tiles",
        id: "sk-rooms",
        title: "Our therapies",
        text: "Choose by the kind of care you want. Every page shows the minutes, the oils and who it suits.",
        layout: "grid",
        showCounts: true,
        items: [
          { label: "Ayurvedic therapies", note: "Abhyanga, shirodhara, kizhi, udvartana", imageUrl: photo(20689447, "tile"), href: "/c/ayurvedic-therapies" },
          { label: "Massages", note: "Swedish, deep tissue, Thai, hot stone", imageUrl: photo(6187418, "tile"), href: "/c/massages" },
          { label: "Facials", note: "Cleansing, radiance, Kumkumadi", imageUrl: photo(37229301, "tile"), href: "/c/facials" },
          { label: "Body scrubs and wraps", note: "Coffee, sandalwood, mud, aloe", imageUrl: photo(27860845, "tile"), href: "/c/body-scrubs-and-wraps" },
          { label: "Couple suites", note: "Two therapists, one private room", imageUrl: photo(6634900, "tile"), href: "/c/couple-packages" },
          { label: "Steam and sauna", note: "Private herbal steam, cedar sauna", imageUrl: photo(34097625, "tile"), href: "/c/steam-and-sauna" },
        ],
      },
      {
        type: "appointment",
        id: "sk-book",
        style: { background: "muted" },
        heading: "Book your hour",
        text: "Pick a therapy, a day and a therapist on the booking page. You get a WhatsApp confirmation and a link to change or cancel until 2 hours before.",
        services: [
          { name: "Swedish relaxation massage", duration: "60 min", price: rs(1800) },
          { name: "Abhyanga (herbal oil massage)", duration: "60 min", price: rs(2200) },
          { name: "Shirodhara", duration: "45 min", price: rs(2400) },
          { name: "Deep tissue massage", duration: "60 min", price: rs(2200) },
          { name: "Foot reflexology", duration: "30 min", price: rs(800) },
          { name: "Couple relaxation (Swedish, 60 min)", duration: "60 min, for two", price: rs(3400) },
        ],
        cta: { label: "Choose a time", href: "/book" },
      },
      {
        type: "pricing-table",
        id: "sk-plans",
        title: "Come more, pay less",
        text: "Session packs for regulars. Sessions are checked in at the desk with your phone number. Prices include 5% GST.",
        plans: [
          {
            name: "Monthly relax",
            price: rs(6500),
            period: "per 30 days",
            description: "4 sessions, about one a week",
            features: ["Any single therapy up to 60 minutes", "Worth ₹7,400 at regular prices", "Cancel up to 2 hours before", "Book online or at the desk"],
            cta: { label: "Get Monthly relax", href: "/p/monthly-relax-membership" },
          },
          {
            name: "Quarterly renew",
            price: rs(18000),
            period: "per 90 days",
            description: "12 sessions, a few a month",
            features: ["Any therapy up to 90 minutes", "A free herbal steam with each session", "Freeze for 7 days", "Worth ₹22,200 at regular prices"],
            highlight: true,
            badge: "Most chosen",
            cta: { label: "Get Quarterly renew", href: "/p/quarterly-renew-membership" },
          },
          {
            name: "Annual wellness",
            price: rs(54000),
            period: "per year",
            description: "48 sessions, about one a week",
            features: ["Any therapy, any length", "Unlimited steam and sauna", "Two guest passes", "Freeze for 30 days"],
            cta: { label: "Get Annual wellness", href: "/p/annual-wellness-membership" },
          },
        ],
      },
      {
        type: "image-text",
        id: "sk-gift",
        style: { background: "brand" },
        imageUrl: photo(7795393, "tile"),
        imageSide: "left",
        heading: "Give a calm hour",
        markdown: "A **gift voucher** of ₹1,000, ₹2,500 or ₹5,000, sent on WhatsApp or e-mail the same day with your message. Valid for 12 months on any therapy, steam or package, and it can be used in parts. For birthdays, weddings, a new baby (for the mother) and the friend who never stops.",
        cta: { label: "Send a gift voucher", href: "/c/gift-vouchers" },
      },
      {
        type: "team",
        id: "sk-team",
        title: "The hands you will meet",
        text: "Four people run the floor. Ask for a therapist when you book, or let us pick the first free one.",
        members: [
          { name: "Kavitha Murugesan", role: "Senior therapist: massage and Ayurveda", bio: "Twelve years at the table, trained in Kerala-style oil therapies. Our first choice for abhyanga and kizhi." },
          { name: "Prakash Rajendran", role: "Therapist: deep tissue and Ayurveda", bio: "Strong, careful hands for desk backs and sports shoulders; also does kati basti and pizhichil." },
          { name: "Anandhi Selvaraj", role: "Therapist: facials, scrubs, foot care", bio: "Patient with sensitive skin and first-timers. Evenings and Sundays." },
          { name: "Revathi Krishnamoorthy", role: "Manager", bio: "Looks after bookings, memberships and anything you want changed in your visit." },
        ],
      },
      {
        type: "testimonials",
        id: "sk-voices",
        title: "After the hour",
        layout: "single",
        items: [
          { quote: "I booked an abhyanga after a month of bad sleep. I slept nine hours that night and I have since taken the quarterly plan. The room is quiet in a way I did not know Coimbatore could be.", name: "Anitha R.", role: "Saibaba Colony", rating: 5 },
          { quote: "Prakash found the knot in my shoulder that three physios had missed. He asked me twice if the pressure was alright. No upselling, no pushing.", name: "Vishnu K.", role: "Peelamedu", rating: 5 },
          { quote: "We took the anniversary ritual for our 25th. The candles, the rose-petal soak and the tea afterwards. My husband still talks about it.", name: "Latha and Ramesh", role: "R.S. Puram", rating: 5 },
        ],
      },
      { type: "faq", id: "sk-faq", title: "Before your first visit", items: FAQ },
      {
        type: "location",
        id: "sk-visit",
        title: "Find us",
        address: "58, D.B. Road, R.S. Puram, Coimbatore 641002",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "11.0072, 76.9500",
      },
    ],
    translations: {
      ta: {
        "sk-hero": {
          slides: [
            {
              heading: "உங்களுக்கே உரிய ஒரு மணி நேரம்.",
              subheading: "ஆர்.எஸ். புரத்தில் ஆயுர்வேத சிகிச்சைகள், மசாஜ், ஃபேஷியல், அமைதியான அறைகள். சிகிச்சை, நேரம், சிகிச்சையாளரைத் தேர்ந்தெடுங்கள்; மற்றதை நாங்கள் அமைதியாகப் பார்த்துக்கொள்கிறோம்.",
              cta: { label: "உங்கள் நேரத்தை முன்பதிவு செய்" },
            },
          ],
        },
        "sk-finder": {
          title: "இன்று உங்களுக்கு என்ன தேவை?",
          text: "மூன்று அமைதியான கேள்விகள். பொருந்தும் சிகிச்சைகளைக் காட்டுவோம்.",
          cta: { label: "உறுதியில்லையா? வாட்ஸ்அப்பில் கேளுங்கள்" },
          questions: [
            { label: "இன்று உங்களுக்கு என்ன தேவை?", options: [{ label: "ஓய்வெடுத்து மனதை அமைதிப்படுத்த" }, { label: "வலிகளிலிருந்து மீள" }, { label: "முகப் பொலிவுக்கு" }] },
            { label: "உங்களுக்கு எவ்வளவு நேரம் உள்ளது?", options: [{ label: "சுமார் 30 முதல் 45 நிமிடம்" }, { label: "ஒரு மணி நேரம் அளவு" }, { label: "மதியம் முழுவதும், அவசரம் இல்லை" }] },
            { label: "உங்கள் பட்ஜெட் என்ன?", options: [{ label: "₹1,500-க்குள்" }, { label: "₹1,500 முதல் ₹3,000 வரை" }, { label: "எனக்கே ஒரு விருந்து" }] },
          ],
        },
        "sk-ritual": {
          title: "ஒரு வருகை எப்படி இருக்கும்",
          chapters: RITUAL_TA.map((c) => ({ eyebrow: c.eyebrow, heading: c.heading, markdown: c.markdown })),
        },
        "sk-rooms": {
          title: "எங்கள் சிகிச்சைகள்",
          text: "நீங்கள் விரும்பும் பராமரிப்பு வகையைத் தேர்ந்தெடுங்கள். ஒவ்வொரு பக்கத்திலும் நிமிடங்கள், எண்ணெய்கள், யாருக்குப் பொருந்தும் என்பது இருக்கும்.",
          items: [
            { label: "ஆயுர்வேத சிகிச்சைகள்", note: "அப்யங்கா, சிரோதாரா, கிழி, உத்வர்தனம்" },
            { label: "மசாஜ்", note: "ஸ்வீடிஷ், டீப் டிஷ்யூ, தாய், ஹாட் ஸ்டோன்" },
            { label: "ஃபேஷியல்", note: "கிளென்சிங், ரேடியன்ஸ், குங்குமாதி" },
            { label: "உடல் ஸ்க்ரப், ரேப்", note: "காபி, சந்தனம், சேறு, கற்றாழை" },
            { label: "தம்பதி அறைகள்", note: "இரண்டு சிகிச்சையாளர், ஒரு தனி அறை" },
            { label: "ஸ்டீம், சானா", note: "தனி மூலிகை ஸ்டீம், சிடார் சானா" },
          ],
        },
        "sk-book": {
          heading: "உங்கள் நேரத்தை முன்பதிவு செய்யுங்கள்",
          text: "முன்பதிவுப் பக்கத்தில் சிகிச்சை, நாள், சிகிச்சையாளரைத் தேர்ந்தெடுங்கள். வாட்ஸ்அப் உறுதி கிடைக்கும்; தொடக்கத்துக்கு 2 மணி முன்புவரை மாற்ற அல்லது ரத்து செய்ய இணைப்பு உண்டு.",
          services: [
            { name: "ஸ்வீடிஷ் ரிலாக்சேஷன் மசாஜ்", duration: "60 நிமிடம்" },
            { name: "அப்யங்கா (மூலிகை எண்ணெய் மசாஜ்)", duration: "60 நிமிடம்" },
            { name: "சிரோதாரா", duration: "45 நிமிடம்" },
            { name: "டீப் டிஷ்யூ மசாஜ்", duration: "60 நிமிடம்" },
            { name: "கால் ரிஃப்ளெக்ஸாலஜி", duration: "30 நிமிடம்" },
            { name: "தம்பதி ரிலாக்சேஷன் (ஸ்வீடிஷ், 60 நிமிடம்)", duration: "60 நிமிடம், இருவருக்கு" },
          ],
          cta: { label: "நேரத்தைத் தேர்ந்தெடு" },
        },
        "sk-plans": {
          title: "அடிக்கடி வாருங்கள், குறைவாகச் செலுத்துங்கள்",
          text: "வழக்கமாக வருபவர்களுக்கான அமர்வுத் தொகுப்புகள். வரவேற்பில் உங்கள் தொலைபேசி எண்ணால் அமர்வு பதிவாகும். விலையில் 5% ஜிஎஸ்டி சேர்ந்தது.",
          plans: ([
            { name: "மாதாந்திர ரிலாக்ஸ்", period: "30 நாளுக்கு", description: "4 அமர்வு, வாரம் ஒன்று", features: ["60 நிமிடம் வரை எந்த ஒரு சிகிச்சையும்", "வழக்கமான விலையில் ₹7,400 மதிப்பு", "2 மணி முன்புவரை ரத்து", "ஆன்லைனில் அல்லது வரவேற்பில் முன்பதிவு"], cta: { label: "மாதாந்திர ரிலாக்ஸ் பெறுங்கள்" } },
            { name: "காலாண்டு புதுப்பிப்பு", period: "90 நாளுக்கு", description: "12 அமர்வு, மாதம் சில", features: ["90 நிமிடம் வரை எந்தச் சிகிச்சையும்", "ஒவ்வொரு அமர்வுடனும் இலவச மூலிகை ஸ்டீம்", "7 நாள் நிறுத்தி வைக்கலாம்", "வழக்கமான விலையில் ₹22,200 மதிப்பு"], badge: "அதிகம் தேர்ந்தெடுப்பது", cta: { label: "காலாண்டு புதுப்பிப்பு பெறுங்கள்" } },
            { name: "ஆண்டு நல்வாழ்வு", period: "ஆண்டுக்கு", description: "48 அமர்வு, வாரம் ஒன்று", features: ["எந்தச் சிகிச்சையும், எந்த நேரமும்", "வரம்பற்ற ஸ்டீம், சானா", "இரண்டு விருந்தினர் அனுமதி", "30 நாள் நிறுத்தி வைக்கலாம்"], cta: { label: "ஆண்டு நல்வாழ்வு பெறுங்கள்" } },
          ] as Record<string, unknown>[]) as never,
        },
        "sk-gift": {
          heading: "ஒரு அமைதியான மணி நேரத்தைப் பரிசளியுங்கள்",
          markdown: "₹1,000, ₹2,500 அல்லது ₹5,000 **பரிசு வவுச்சர்**, உங்கள் செய்தியுடன் அதே நாளில் வாட்ஸ்அப் அல்லது மின்னஞ்சலில். எந்தச் சிகிச்சை, ஸ்டீம், பேக்கேஜுக்கும் 12 மாதம் செல்லும்; பகுதி பகுதியாகவும் பயன்படுத்தலாம். பிறந்தநாள், திருமணம், புதிய தாய், ஓயாமல் உழைக்கும் நண்பருக்கு.",
          cta: { label: "பரிசு வவுச்சர் அனுப்பு" },
        },
        "sk-team": {
          title: "உங்களை வரவேற்கும் கைகள்",
          text: "நால்வர் தளத்தை நடத்துகிறார்கள். முன்பதிவில் சிகிச்சையாளரைக் கேளுங்கள் அல்லது முதலில் காலியாக இருப்பவரை நாங்கள் தேர்வு செய்வோம்.",
          members: ([
            { role: "மூத்த சிகிச்சையாளர்: மசாஜ், ஆயுர்வேதம்", bio: "பன்னிரண்டு ஆண்டு அனுபவம், கேரள பாணி எண்ணெய் சிகிச்சைகளில் பயிற்சி. அப்யங்கா, கிழிக்கு எங்கள் முதல் தேர்வு." },
            { role: "சிகிச்சையாளர்: டீப் டிஷ்யூ, ஆயுர்வேதம்", bio: "மேசை வேலை முதுகு, விளையாட்டுத் தோள்களுக்கு வலிமையான, கவனமான கைகள்; கடி பஸ்தி, பிழிச்சிலும் செய்வார்." },
            { role: "சிகிச்சையாளர்: ஃபேஷியல், ஸ்க்ரப், கால் பராமரிப்பு", bio: "மென்மையான தோல், முதல் முறை வருபவர்களிடம் பொறுமை. மாலை, ஞாயிறு." },
            { role: "மேலாளர்", bio: "முன்பதிவு, உறுப்பினர் திட்டம், உங்கள் வருகையில் மாற்ற வேண்டிய எதையும் கவனிப்பார்." },
          ] as Record<string, unknown>[]) as never,
        },
        "sk-voices": {
          title: "அந்த ஒரு மணி நேரத்துக்குப் பிறகு",
          items: [
            { quote: "ஒரு மாதம் தூக்கம் இல்லாமல் இருந்த பிறகு அப்யங்கா முன்பதிவு செய்தேன். அன்று இரவு ஒன்பது மணி நேரம் தூங்கினேன்; அதன் பிறகு காலாண்டு திட்டம் எடுத்தேன். கோயம்புத்தூரில் இவ்வளவு அமைதியான அறை இருக்குமென்று தெரியாது." },
            { quote: "மூன்று பிசியோ தவறவிட்ட தோள்பட்டை முடிச்சை பிரகாஷ் கண்டுபிடித்தார். அழுத்தம் சரியா என்று இருமுறை கேட்டார். கட்டாயப்படுத்தல் இல்லை." },
            { quote: "25-வது ஆண்டு நிறைவுக்கு ஆனிவர்சரி ரிச்சுவல் எடுத்தோம். மெழுகுவர்த்தி, ரோஜா இதழ் குளியல், பின் தேநீர். என் கணவர் இன்னும் பேசுகிறார்." },
          ],
        },
        "sk-faq": { title: "முதல் வருகைக்கு முன்", items: FAQ_TA },
        "sk-visit": {
          title: "எங்களைக் கண்டுபிடியுங்கள்",
          address: "58, டி.பி. சாலை, ஆர்.எஸ். புரம், கோயம்புத்தூர் 641002",
          hours: HOURS_TA,
        },
      },
    },
  }),
  pages: [
    {
      slug: "your-first-visit",
      title: "Your first visit",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "What to expect" },
        {
          type: "paragraph",
          markdown:
            "Arrive **10 minutes early**. You fill a short card (pain, injuries, allergies, pregnancy, blood pressure), choose the oil and the pressure, and your therapist walks you to a private room. You undress to your comfort; a towel covers you throughout and only the area being worked on is uncovered.",
        },
        { type: "image", url: photo(35884502, "tile"), alt: "A massage table with a rolled towel, a candle and oils" },
        { type: "heading", level: 2, text: "When to wait" },
        {
          type: "paragraph",
          markdown:
            "Postpone oil therapies if you have a fever, an open wound or infection at the site, or have eaten a heavy meal in the last two hours. Tell us about pregnancy, recent surgery, blood-thinning medicine or high blood pressure; some therapies are not suitable and we will suggest another.",
        },
        { type: "heading", level: 2, text: "Prices and GST" },
        {
          type: "paragraph",
          markdown:
            "All prices include **5% GST** (SAC 999723 for massage, steam, sauna and memberships; SAC 999722 for facials and scrubs). Pay by cash, UPI or card at the desk, or online for vouchers and memberships.",
        },
        { type: "button", label: "Book your hour", href: "/book", style: "primary" },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Sukham, R.S. Puram" },
        {
          type: "paragraph",
          markdown:
            "Sukham means comfort. We opened in 2019 in a quiet old house on D.B. Road with five treatment rooms, a couple suite, a steam cabin and a cedar sauna. Our therapists are trained in Kerala-style Ayurvedic therapies and in Swedish and deep tissue work, and the oils are cold-pressed and prepared in small batches by our supplier near Pollachi.",
        },
        { type: "image", url: photo(34478574, "tile"), alt: "Candles, citrus slices, a towel and eucalyptus" },
        { type: "paragraph", markdown: "Open every day 9:30 am – 8:30 pm. Call or WhatsApp **+91 98765 00027**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our clients or staff.\n\n| Photo | Photographer | Link |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Ayurveda", type: "category", ref: "ayurvedic-therapies" },
      { label: "Massages", type: "category", ref: "massages" },
      { label: "Facials", type: "category", ref: "facials" },
      { label: "Couples", type: "category", ref: "couple-packages" },
      { label: "Memberships", type: "category", ref: "memberships" },
      { label: "Book now", type: "url", href: "/book" },
    ],
    footer: [
      {
        label: "Visit",
        type: "url",
        children: [
          { label: "Book your hour", type: "url", href: "/book" },
          { label: "Your first visit", type: "page", ref: "your-first-visit" },
          { label: "Gift vouchers", type: "category", ref: "gift-vouchers" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Therapies",
        type: "url",
        children: [
          { label: "To relax", type: "collection", ref: "relax" },
          { label: "To recover", type: "collection", ref: "recover" },
          { label: "For glowing skin", type: "collection", ref: "glow" },
          { label: "Quick, up to 45 minutes", type: "collection", ref: "quick" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  setup: setupSpa,
};
