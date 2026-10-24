import { CAT, menuProducts, rs } from "./vaasam-menu";
import { setupVaasam } from "./vaasam-setup";
import type { DemoStore } from "./types";

/**
 * Store #18 of the series: Vaasam Biryani Kitchen, Karapakkam, OMR, Chennai (vaasam.localhost:3003). A delivery-only
 * cloud kitchen on the restaurant app (RS) with the `cloud_kitchen` trade (online orders go straight to the kitchen
 * screen with KOTs per station; QR table ordering is off, there is no dining room) and the "night-kitchen" look (a
 * pine-black page with a chilli-orange bar, rows on menu pages, a category rail and a phone tab bar). Vaasam (வாசம்) is
 * Tamil for aroma. The menu: Dindigul and Ambur biryani in single / combo / family portions, combo and meals boxes,
 * parotta and Chettinad gravies, snacks, gulab jamun, cool drinks, party trays for offices and families, and add-ons
 * (menu data in vaasam-menu.ts, shared with the history simulator's `cloud_kitchen` profile). Names are generic (no
 * brands); prices are typical OMR delivery prices in 2026, GST included. Address, phone, GSTIN and the FSSAI number are
 * placeholders like the other demo shops.
 *
 * GST: restaurant service (SAC 996331, which includes takeaway and door delivery of food) from a stand-alone kitchen:
 * 5% (CGST 2.5% + SGST 2.5%) without input tax credit. The 3rd September 2025 GST Council meeting and CGST notification
 * 15/2025-Central Tax (Rate) of 17 Sept 2025, in force from 22 Sept 2025, rationalised hotel-room and many goods
 * rates but left standalone restaurant service at 5% without ITC (Sr. No. 7(ii) of 11/2017-Central Tax (Rate)); the
 * 18%-with-ITC option exists only for "specified premises" (hotel stays above Rs 7,500 a night), which a stand-alone
 * kitchen cannot choose. Orders that come through a food-delivery platform are taxed under section 9(5) (the platform
 * pays the tax); this shop's own online store orders are billed by the kitchen at 5%. Outdoor catering is a separate
 * service at 18% with ITC and is not offered here: party trays are delivered food. Sources: busy.in "New GST for
 * Restaurants in India" and Petpooja's "new GST rates on food" (secondary summaries of the 22 Sept 2025 changes), and
 * the Gujarat AAR order in Ridhi Enterprise (5% without ITC for take-away from a restaurant).
 */

const PHONE = "+919876500020";
const WHATSAPP = "919876500020";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const PARTY_TEXT = "Hello Vaasam Kitchen, I want a party order. Date and time: … Number of people: … Trays: … Delivery address and pincode: …";

const PHOTOS: DemoStore["photos"] = {
  12392831: { by: "Saveurs Secretes", alt: "South Indian biryani on a banana leaf with sides" },
  9609840: { by: "Prabal Pratap Singh", alt: "Chicken biryani in a brass bowl" },
  9609863: { by: "Prabal Pratap Singh", alt: "Mutton biryani with curry and curd" },
  14731639: { by: "Shameel mukkath", alt: "Chicken biryani with herbs on a blue-patterned plate" },
  39536491: { by: "Bilal Moazzam", alt: "Chicken biryani with a lemon slice on a plate" },
  9609854: { by: "Prabal Pratap Singh", alt: "Chicken biryani with boiled eggs in a blue bowl" },
  9609848: { by: "Prabal Pratap Singh", alt: "Vegetable biryani with curry and raita" },
  9609859: { by: "Prabal Pratap Singh", alt: "Paneer biryani in a blue bowl" },
  35267280: { by: "Milton Das", alt: "A meal tray with biryani, curry and sides" },
  10810650: { by: "Saveurs Secretes", alt: "Parotta with a spicy chicken curry" },
  37883423: { by: "Naveed Basapur", alt: "Chicken biryani in a clay pot" },
  12737817: { by: "dhiraj jain", alt: "Chicken biryani with raita and onion rings" },
  36125185: { by: "Payal Parmar", alt: "A vegetarian thali with chickpeas, chutneys and roti" },
  9557675: { by: "Saveurs Secretes", alt: "A South Indian meal with rice, chicken curry and vegetables" },
  10810652: { by: "Saveurs Secretes", alt: "A South Indian seafood meal with fish curry, rice and fried prawns" },
  10078270: { by: "Saveurs Secretes", alt: "An overhead view of a South Indian meal on a steel plate" },
  30323513: { by: "Dilara", alt: "A stack of freshly cooked flatbreads" },
  36264075: { by: "Food_Lenz_Vlogs", alt: "Spicy chicken curry topped with coriander" },
  35532821: { by: "athul santhosh", alt: "Chicken curry in a bowl with garnish" },
  37180955: { by: "Bilal Moazzam", alt: "A pepper-style curry with herbs in a wok" },
  6113813: { by: "Mian Shahbaz Anjum", alt: "Chicken curry with onion rings in a white dish" },
  9609857: { by: "Prabal Pratap Singh", alt: "Parotta served with side dishes" },
  17050759: { by: "Chutney Indian", alt: "An overhead view of Indian starters on white plates" },
  35267272: { by: "Milton Das", alt: "Crispy fried fish with lemon and chilli" },
  21926675: { by: "Nithin Mohan", alt: "Fried fish steak with a fresh salad" },
  9792458: { by: "Alberta Studios", alt: "An Indian spread with tandoori chicken and curries" },
  15014918: { by: "Nishess Shakya", alt: "Gulab jamun in a white bowl" },
  35017895: { by: "Willians Huerta", alt: "Gulab jamun with ice cream in a white dish" },
  4324320: { by: "Engin Akyurt", alt: "A glass of white buttermilk-style drink on marble" },
  8917283: { by: "Vincenzo Malagoli", alt: "A tall glass of lassi topped with rose petals" },
  14930475: { by: "Shameel mukkath", alt: "A mango smoothie with fresh mango slices" },
  31490093: { by: "Kalina Gakhal", alt: "Mango and vanilla shakes in jars with striped straws" },
  9609869: { by: "Prabal Pratap Singh", alt: "Biryani with a rich curry sauce" },
  14731625: { by: "Shameel mukkath", alt: "Mutton biryani on a decorative plate" },
  7593267: { by: "Ahmad No More", alt: "Vegetable biryani in a metal bowl" },
  9609868: { by: "Prabal Pratap Singh", alt: "Chicken biryani with Indian condiments" },
  28674660: { by: "Kunal Lakhotia", alt: "Chicken biryani in a handi with a bowl of curry" },
  4253702: { by: "cottonbro studio", alt: "A cook frying food in a pan on a stove" },
  38834853: { by: "Kamal Uddin", alt: "Golden parottas cooking on a tawa" },
};

const HOURS = [{ label: "Every day", value: "11:00 am - 11:30 pm" }];

const FAQ = [
  {
    q: "Is Vaasam delivery-only? Can I eat there?",
    a: "Yes, we are a **delivery-only kitchen**: no dining room and no tables, so every rupee goes into the food. You can collect a pre-paid order from our pickup window at the kitchen (Karapakkam, OMR), but we cannot seat you.",
  },
  {
    q: "How fast is delivery and which areas do you cover?",
    a: "**30 to 40 minutes** in Karapakkam, Thoraipakkam, Perungudi, Sholinganallur and Taramani (minimum order Rs 149); **45 to 60 minutes** in Navalur, Siruseri, Kelambakkam and Medavakkam (minimum Rs 249); **50 to 60 minutes** in Velachery and Thiruvanmiyur (minimum Rs 299). Put your pincode in at checkout to see your time and fee.",
  },
  {
    q: "What is the difference between Single, Combo and Family?",
    a: "**Single** is one person's biryani with raita. **Combo** adds a side (chicken 65 for the chicken biryanis, brinjal gravy and a boiled egg) for one hungry person or two light eaters. **Family** serves **four**, packed in a sealed tub with raita and gravy.",
  },
  {
    q: "Can I order for an office lunch or a function?",
    a: "Yes. Party trays serve **10 or 20** (and corporate lunch boxes start at 30). Order a day ahead on this page or on WhatsApp. Offices can have a monthly GST invoice on credit after the first order; see the party orders page.",
  },
  {
    q: "Is the food vegetarian-safe? Do you use the same kitchen for veg and non-veg?",
    a: "We cook vegetarian and egg dishes on separate burners with separate ladles, but it is **one kitchen**, so it is not a pure-veg kitchen. Every dish is marked **green (veg), brown (egg) or red (non-veg)** on the menu.",
  },
  {
    q: "What if my order is late or wrong?",
    a: "Message us on WhatsApp within 30 minutes of delivery with a photo. A wrong or spilt dish is replaced or refunded in full; if we miss the time shown at checkout by more than 20 minutes, the delivery fee is refunded.",
  },
];

const FAQ_TA = [
  {
    q: "வாசம் டெலிவரி மட்டும்தானா? அங்கே அமர்ந்து சாப்பிடலாமா?",
    a: "ஆம், நாங்கள் **டெலிவரி மட்டும் செய்யும் சமையலறை**: உணவறை இல்லை, மேசைகள் இல்லை; ஒவ்வொரு ரூபாயும் உணவுக்கே செல்கிறது. முன்பணம் செலுத்திய ஆர்டரை கரப்பாக்கம் (OMR) சமையலறையின் பிக்-அப் ஜன்னலில் வாங்கிக்கொள்ளலாம்; ஆனால் அமரவைக்க இடம் இல்லை.",
  },
  {
    q: "டெலிவரி எவ்வளவு வேகம், எந்தெந்தப் பகுதிகள்?",
    a: "கரப்பாக்கம், துரைப்பாக்கம், பெருங்குடி, சோழிங்கநல்லூர், தரமணியில் **30 முதல் 40 நிமிடம்** (குறைந்தபட்ச ஆர்டர் ரூ 149); நாவலூர், சிறுசேரி, கேளம்பாக்கம், மேடவாக்கத்தில் **45 முதல் 60 நிமிடம்** (குறைந்தபட்சம் ரூ 249); வேளச்சேரி, திருவான்மியூரில் **50 முதல் 60 நிமிடம்** (குறைந்தபட்சம் ரூ 299). செக்அவுட்டில் உங்கள் பின்கோடை இட்டால் நேரமும் கட்டணமும் தெரியும்.",
  },
  {
    q: "சிங்கிள், காம்போ, ஃபேமிலி வித்தியாசம் என்ன?",
    a: "**சிங்கிள்** என்பது ஒருவருக்கான பிரியாணியும் ரைத்தாவும். **காம்போ** ஒரு சைடு சேர்க்கிறது (சிக்கன் பிரியாணிகளுக்கு சிக்கன் 65, கத்தரிக்காய் கிரேவி, வேகவைத்த முட்டை): ஒரு பசித்தவருக்கோ இருவருக்கோ. **ஃபேமிலி** **நால்வருக்கு** போதும்; ரைத்தாவும் கிரேவியும் சேர்த்து மூடிய டப்பாவில் வரும்.",
  },
  {
    q: "அலுவலக மதிய உணவுக்கோ விழாவுக்கோ ஆர்டர் செய்யலாமா?",
    a: "ஆம். பார்ட்டி ட்ரேக்கள் **10 அல்லது 20 பேருக்கு** (கார்ப்பரேட் லஞ்ச் பாக்ஸ் 30-இல் தொடங்கும்). ஒரு நாள் முன்பு இந்தப் பக்கத்திலோ வாட்ஸ்அப்பிலோ ஆர்டர் செய்யுங்கள். முதல் ஆர்டருக்குப் பின் அலுவலகங்களுக்கு மாத GST இன்வாய்ஸ் கடனில்; பார்ட்டி ஆர்டர் பக்கத்தைப் பாருங்கள்.",
  },
  {
    q: "சைவ உணவு பாதுகாப்பாக இருக்குமா? சைவ, அசைவம் ஒரே சமையலறையா?",
    a: "சைவம், முட்டை உணவுகளைத் தனி அடுப்பிலும் தனி கரண்டிகளிலும் சமைக்கிறோம்; ஆனால் இது **ஒரே சமையலறை**, எனவே முழுச் சைவ சமையலறை அல்ல. ஒவ்வொரு உணவும் மெனுவில் **பச்சை (சைவம்), பழுப்பு (முட்டை), சிவப்பு (அசைவம்)** என்று குறிக்கப்பட்டுள்ளது.",
  },
  {
    q: "ஆர்டர் தாமதமானாலோ தவறாக வந்தாலோ?",
    a: "டெலிவரியான 30 நிமிடத்துக்குள் ஒரு படத்துடன் வாட்ஸ்அப்பில் தெரிவியுங்கள். தவறான அல்லது சிந்திய உணவு மாற்றித் தரப்படும் அல்லது முழுப் பணம் திருப்பித் தரப்படும்; செக்அவுட்டில் காட்டிய நேரத்தை 20 நிமிடத்துக்கு மேல் தவறவிட்டால் டெலிவரி கட்டணம் திருப்பித் தரப்படும்.",
  },
];

const COMPARE_ROWS = [
  { label: "Serves", values: ["4", "4", "4"] },
  { label: "Family pack price", values: ["Rs 1,299", "Rs 749", "Rs 1,149"] },
  { label: "What comes in the box", values: ["Biryani, chicken 65, gravy, raita, 4 eggs, gulab jamun", "Biryani with raita and brinjal gravy", "Mutton biryani, raita and brinjal gravy"] },
  { label: "Spice", values: ["Medium", "Medium", "Medium"] },
  { label: "Best for", values: ["A full family dinner", "Four people who just want biryani", "Sunday lunch at home"] },
];
const COMPARE_ROWS_TA = [
  { label: "எத்தனை பேருக்கு", values: ["4", "4", "4"] },
  { label: "ஃபேமிலி பேக் விலை", values: ["ரூ 1,299", "ரூ 749", "ரூ 1,149"] },
  { label: "பெட்டியில் என்ன", values: ["பிரியாணி, சிக்கன் 65, கிரேவி, ரைத்தா, 4 முட்டை, குலாப் ஜாமூன்", "பிரியாணி, ரைத்தா, கத்தரிக்காய் கிரேவி", "மட்டன் பிரியாணி, ரைத்தா, கத்தரிக்காய் கிரேவி"] },
  { label: "காரம்", values: ["நடுத்தரம்", "நடுத்தரம்", "நடுத்தரம்"] },
  { label: "எதற்குச் சிறந்தது", values: ["முழு குடும்ப இரவு உணவு", "பிரியாணி மட்டும் வேண்டும் நால்வருக்கு", "வீட்டில் ஞாயிறு மதிய உணவு"] },
];

/** A pricing-table plan's Tamil words (no undefined fields: translations are plain values). */
const plan = (p: { name: string; period?: string; description: string; features: string[]; badge?: string; cta: { label: string } }): Record<string, string | string[] | { label: string }> => ({
  name: p.name,
  ...(p.period ? { period: p.period } : {}),
  description: p.description,
  features: p.features,
  ...(p.badge ? { badge: p.badge } : {}),
  cta: p.cta,
});

const stat = (label: string, suffix?: string): Record<string, string> => (suffix ? { label, suffix } : { label });

export const VAASAM: DemoStore = {
  shop: {
    slug: "vaasam",
    appId: "RS",
    businessType: "cloud_kitchen",
    planId: "pro",
    name: "Vaasam Biryani Kitchen",
    primary: "#ff6a1a",
    billing: {
      legalName: "Vaasam Foods",
      gstin: "33AAKFV4821H1ZP",
      address: "Plot 22, Karapakkam Main Road, OMR",
      city: "Chennai",
      pincode: "600097",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "VK",
      upiId: "vaasamkitchen@okicici",
    },
    // Counter items at the pickup window are the catalogue dishes themselves: no extra billing items.
    items: [],
  },
  preset: "night-kitchen",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 300_000,
    minOrderValue: 14_900,
    deliveryEnabled: true,
    pickupEnabled: true,
    pickupNote: "Collect from our kitchen in Karapakkam, OMR, about 20 minutes after you order. Give your order number at the pickup window.",
    contactPhone: PHONE,
    contactEmail: "hello@vaasamkitchen.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/vaasamkitchen" },
    policies: {
      shipping:
        "**Delivery only**, from our kitchen in Karapakkam, OMR, every day 11 am to 11:30 pm.\n\n**30-40 min:** Karapakkam, Thoraipakkam, Perungudi, Sholinganallur, Taramani (min order Rs 149, fee Rs 29, free above Rs 499).\n\n**45-60 min:** Navalur, Siruseri, Kelambakkam, Medavakkam (min Rs 249, fee Rs 49, free above Rs 699).\n\n**50-60 min:** Velachery, Thiruvanmiyur (min Rs 299, fee Rs 59, free above Rs 799).\n\n**Party orders** anywhere in Chennai: order a day ahead, Rs 149 (free above Rs 2,000).",
      returns:
        "Food cannot be returned. If a dish arrives wrong, spilt or cold, send a photo on WhatsApp within 30 minutes and we replace it or refund in full. If we miss the time shown at checkout by more than 20 minutes, the delivery fee is refunded.",
      privacy: "We use your name, phone and address only to deliver your order and send your GST bill. We do not share them with anyone else.",
      terms:
        "Prices include GST at 5% (restaurant service, no input tax credit). Delivery times are estimates that depend on traffic and weather. Party orders need a day's notice and 50% advance above Rs 5,000. FSSAI licence: 12345678901234 (placeholder).",
    },
    businessType: "cloud_kitchen",
  },
  zones: [
    {
      name: "OMR Zone 1: Karapakkam to Sholinganallur, Taramani (30-40 min)",
      pincodePrefixes: ["60009", "60011"],
      rate: { name: "Delivery in 30-40 min, min order Rs 149", type: "free_above", amount: 2_900, freeAbove: 49_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "OMR Zone 2: Navalur, Siruseri, Kelambakkam (45-60 min)",
      pincodePrefixes: ["60310", "60013", "60010"],
      rate: { name: "Delivery in 45-60 min, min order Rs 249", type: "free_above", amount: 4_900, freeAbove: 69_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Velachery and Thiruvanmiyur (50-60 min)",
      pincodePrefixes: ["60004"],
      rate: { name: "Delivery in 50-60 min, min order Rs 299", type: "free_above", amount: 5_900, freeAbove: 79_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Chennai party orders (a day ahead)",
      pincodePrefixes: ["600"],
      rate: { name: "Scheduled party delivery, order a day ahead", type: "free_above", amount: 14_900, freeAbove: 200_000, etaMinDays: 1, etaMaxDays: 1, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CAT.combos, description: "Boxes with biryani, a side and a sweet: lunch for one, dinner for two, a feast for four.", photo: 35267280 },
    { name: CAT.biryani, description: "Dindigul and Ambur biryani in single, combo and family portions, dum-cooked every hour.", photo: 9609840 },
    { name: CAT.meals, description: "Rice, gravy, rasam, poriyal and curd in a four-compartment box.", photo: 9557675 },
    { name: CAT.gravies, description: "Fresh parotta with Chettinad chicken, pepper chicken, mutton chukka and veg kurma.", photo: 36264075 },
    { name: CAT.snacks, description: "Chicken 65, fish fry and tandoori chicken, packed to stay crisp.", photo: 35267272 },
    { name: CAT.desserts, description: "Warm gulab jamun, with or without ice cream.", photo: 15014918 },
    { name: CAT.beverages, description: "Buttermilk, lassi and mango shakes, chilled for the ride.", photo: 14930475 },
    { name: CAT.party, description: "Sealed trays for 10 or 20, for offices, birthdays and functions. Order a day ahead.", photo: 9609869 },
    { name: CAT.addons, description: "An egg, a tub of raita or extra gravy on the side.", photo: 9609868 },
  ],
  products: menuProducts(),
  collections: [
    { name: "New on the menu", slug: "new-in", description: "Fresh on the menu this month.", rule: { sort: "new" } },
    { name: "Lunch rush", slug: "lunch-rush", description: "The 12 to 3 pm line-up: biryani, meals and combo boxes that are ready in minutes.", rule: { tag: "lunch-rush", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What OMR orders again and again.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Veg menu", slug: "veg", description: "Every vegetarian dish, marked green.", rule: { tag: "veg", sort: "price-asc" } },
    { name: "Non-veg menu", slug: "non-veg", description: "Chicken, mutton and fish dishes, marked red.", rule: { tag: "non-veg", sort: "price-asc" } },
    { name: "Family packs", slug: "family-packs", description: "Boxes that serve four.", rule: { tag: "family", sort: "price-asc" } },
    { name: "Spicy", slug: "spicy", description: "For people who like their food hot.", rule: { tag: "spicy", sort: "price-asc" } },
    { name: "Party trays", slug: "party-trays", description: "Sealed trays that serve 10 or 20.", rule: { tag: "party", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Items below their MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    { code: "FIRST50", description: "Rs 50 off your first order above Rs 299", type: "flat", value: 5_000, minOrder: 29_900, channels: ["store"] },
    { code: "BIRYANI10", description: "10% off biryani orders above Rs 499 (up to Rs 100)", type: "percent", value: 10, minOrder: 49_900, maxDiscount: 10_000, channels: ["store"] },
    { code: "PARTY5", description: "Party orders: 5% off above Rs 5,000 (up to Rs 1,000)", type: "percent", value: 5, minOrder: 500_000, maxDiscount: 100_000, channels: ["store", "manual"] },
  ],
  home: ({ photo, category, product }) => {
    const family = product("Family Feast Box (serves 4)");
    return {
      seo: {
        title: "Vaasam Biryani Kitchen, OMR Chennai: biryani delivered hot",
        description:
          "Delivery-only kitchen on OMR, Chennai: Dindigul and Ambur biryani, meals boxes, parotta and Chettinad gravies, family packs and party trays. 30-40 minute delivery, order online.",
        imageUrl: photo(12392831),
      },
      sections: [
        {
          type: "usp",
          id: "vk-open",
          layout: "inline",
          items: [
            { icon: "clock", title: "Kitchen open till 11:30 pm tonight", text: "Every day, 11 am onwards" },
            { icon: "truck", title: "30-40 min on OMR", text: "Delivered hot, from one kitchen" },
            { icon: "shield", title: "FSSAI licensed", text: "Licence no. on the hygiene page" },
          ],
        },
        {
          type: "hero",
          id: "vk-hero",
          slides: [
            {
              imageUrl: photo(12392831),
              heading: "Biryani, dum-cooked and at your door in 30 minutes.",
              subheading: "Dindigul and Ambur biryani from our Karapakkam kitchen, packed hot, no dining room, no markup.",
              cta: { label: "Order biryani", href: "/c/biryani" },
            },
            {
              imageUrl: photo(9609840),
              heading: "Feeding the office? Trays for 10 or 20.",
              subheading: "Sealed party trays with raita and gravy. Order a day ahead; GST invoice for your accounts team.",
              cta: { label: "Party orders", href: "/collections/party-trays" },
            },
          ],
        },
        {
          type: "categories",
          id: "vk-menu",
          title: "The menu",
          layout: "pills",
          showCounts: true,
          columns: "auto",
        },
        {
          type: "flash-sale",
          id: "vk-lunch",
          title: "Lunch rush, 12 to 3 pm",
          text: "Every day between 12 and 3, the quickest dishes in the kitchen: boxes, meals and biryani that leave in minutes.",
          endsAt: "2027-12-31T23:59:00+05:30",
          daily: { from: "12:00", to: "15:00" },
          source: "collection",
          collectionSlug: "lunch-rush",
          layout: "carousel",
          limit: 8,
          cta: { label: "See the lunch menu", href: "/collections/lunch-rush" },
        },
        {
          type: "finder",
          id: "vk-finder",
          title: "What should we send?",
          text: "Three taps: how many are eating, veg or non-veg, and your budget. We show what fits.",
          layout: "wizard",
          results: "inline",
          limit: 6,
          buttonLabel: "Show my menu",
          imageUrl: photo(12737817, "tile"),
          cta: { label: "A crowd? Plan a party order on WhatsApp", href: waLink(PARTY_TEXT) },
          questions: [
            {
              label: "How many are eating?",
              options: [
                { label: "Just me", filterName: "Portion", filterValue: "Single" },
                { label: "Two of us", filterName: "Portion", filterValue: "Combo" },
                { label: "Three or four", filterName: "Portion", filterValue: "Family" },
                { label: "A party (10+)", categoryId: category(CAT.party) },
              ],
            },
            {
              label: "Veg or non-veg?",
              options: [{ label: "Veg", tag: "veg" }, { label: "Egg", tag: "egg" }, { label: "Non-veg", tag: "non-veg" }],
            },
            {
              label: "Budget per order",
              options: [
                { label: "Under Rs 200", priceMax: 19_999 },
                { label: "Rs 200 - 400", priceMin: 20_000, priceMax: 40_000 },
                { label: "Rs 400 - 800", priceMin: 40_000, priceMax: 80_000 },
                { label: "Rs 800 and above", priceMin: 80_000 },
              ],
            },
          ],
        },
        {
          type: "comparison",
          id: "vk-family",
          title: "Which family pack?",
          text: "Three ways to feed four, all packed hot and sealed. The Feast Box is the whole dinner; the biryani tubs are for when you already have the rest.",
          productIds: [family, product("Dindigul Chicken Biryani"), product("Ambur Mutton Biryani")],
          highlightId: family,
          highlightLabel: "Whole dinner",
          showRating: false,
          rows: COMPARE_ROWS,
        },
        { type: "collection", id: "vk-best", title: "Most ordered this week", collectionSlug: "bestsellers", layout: "carousel", limit: 10 },
        {
          type: "stories",
          id: "vk-stories",
          title: "Inside the kitchen",
          layout: "rings",
          items: [
            { imageUrl: photo(28674660, "square"), title: "The dum", text: "Every biryani is sealed and steamed for 25 minutes. Nothing sits under a lamp.", href: "/c/biryani", ctaLabel: "Biryani" },
            { imageUrl: photo(38834853, "square"), title: "Parotta, live", text: "Rolled, stretched and cooked on the tawa as the orders come in, never reheated.", href: "/c/parotta-and-gravies", ctaLabel: "Parotta and gravies" },
            { imageUrl: photo(4253702, "square"), title: "Fry station", text: "Chicken 65 and fish fry go into fresh oil each batch, packed in vented boxes.", href: "/c/snacks", ctaLabel: "Snacks" },
            { imageUrl: photo(35267280, "square"), title: "Boxing", text: "Every box is packed by hand, sealed and stickered with the order time.", href: "/c/combos", ctaLabel: "Combo boxes" },
          ],
        },
        {
          type: "pricing-table",
          id: "vk-party",
          title: "Party trays",
          text: "Sealed trays with raita and gravy, delivered a day-ahead at the time you choose. Prices include 5% GST.",
          plans: [
            { name: "Veg tray, serves 10", price: rs(1799), description: "Veg dum biryani, raita, veg kurma.", features: ["Serves 10 (Rs 3,399 for 20)", "Veg kurma and raita", "Sealed aluminium tray"], cta: { label: "Order the tray", href: "/p/veg-biryani-party-tray" } },
            { name: "Chicken tray, serves 10", price: rs(2499), description: "Dindigul chicken biryani, raita, brinjal gravy.", features: ["Serves 10 (Rs 4,799 for 20)", "Raita and brinjal gravy", "Add chicken 65 tray, Rs 1,699"], highlight: true, badge: "Most ordered", cta: { label: "Order the tray", href: "/p/chicken-biryani-party-tray" } },
            { name: "Mutton tray, serves 10", price: rs(3999), description: "Ambur mutton biryani, raita, brinjal gravy.", features: ["Serves 10 (Rs 7,699 for 20)", "Mutton on the bone", "Raita and brinjal gravy"], cta: { label: "Order the tray", href: "/p/mutton-biryani-party-tray" } },
            { name: "Office lunch boxes", price: rs(139), description: "A box, for 30 or more; one GST invoice a month.", features: ["Meals or biryani boxes", "Delivered 12:15 pm", "Monthly invoice on credit"], cta: { label: "Ask on WhatsApp", href: waLink(PARTY_TEXT) } },
          ],
        },
        {
          type: "stats",
          id: "vk-stats",
          title: "The kitchen in numbers",
          items: [
            { value: 32, label: "Minutes, median delivery time" },
            { value: 600, suffix: "+", label: "Biryanis dum-cooked a day" },
            { value: 25, suffix: "+", label: "OMR offices on monthly lunch" },
            { value: 38, label: "Dishes on the menu" },
          ],
          style: { background: "dark" },
        },
        {
          type: "testimonials",
          id: "vk-reviews",
          title: "From OMR's inboxes",
          layout: "cards",
          items: [
            { quote: "We order 35 chicken biryani boxes for our team every Thursday. They arrive at 12:15, still hot, with the invoice in the bag. The accounts team loves the monthly GST bill.", name: "Divya R.", role: "Admin lead, Thoraipakkam", rating: 5 },
            { quote: "The Ambur mutton biryani tastes like the one from my uncle's wedding. The family tub fed four of us with some left for the next day.", name: "Ibrahim S.", role: "Sholinganallur", rating: 5 },
            { quote: "Ordered at 8:40 pm, parotta and chicken salna came in 34 minutes, the parotta still soft. The delivery boy called at the gate instead of ringing the bell at midnight.", name: "Meena K.", role: "Karapakkam", rating: 5 },
          ],
        },
        { type: "faq", id: "vk-faq", title: "Delivery, portions and party orders", items: FAQ },
        {
          type: "location",
          id: "vk-location",
          title: "Our kitchen",
          address: "Plot 22, Karapakkam Main Road, OMR, Chennai 600097. Delivery-only; pickup window for pre-paid orders.",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "12.9189, 80.2306",
        },
      ],
      translations: {
        ta: {
          "vk-open": {
            items: [
              { title: "இன்றிரவு 11:30 வரை சமையலறை திறந்திருக்கும்", text: "தினமும் காலை 11 மணி முதல்" },
              { title: "OMR-இல் 30-40 நிமிடம்", text: "ஒரே சமையலறையிலிருந்து சூடாக" },
              { title: "FSSAI உரிமம்", text: "உரிம எண் சுகாதாரப் பக்கத்தில்" },
            ],
          },
          "vk-hero": {
            slides: [
              {
                heading: "தம்மில் வேகவைத்த பிரியாணி, 30 நிமிடத்தில் உங்கள் வாசலில்.",
                subheading: "கரப்பாக்கம் சமையலறையிலிருந்து திண்டுக்கல், ஆம்பூர் பிரியாணி: சூடாக அடைத்து, உணவறை இல்லை, கூடுதல் விலை இல்லை.",
                cta: { label: "பிரியாணி ஆர்டர் செய்" },
              },
              {
                heading: "அலுவலகத்துக்கு உணவா? 10 அல்லது 20 பேருக்கு ட்ரே.",
                subheading: "ரைத்தா, கிரேவியுடன் மூடிய பார்ட்டி ட்ரேக்கள். ஒரு நாள் முன்பு ஆர்டர் செய்யுங்கள்; உங்கள் கணக்குக் குழுவுக்கு GST இன்வாய்ஸ்.",
                cta: { label: "பார்ட்டி ஆர்டர்கள்" },
              },
            ],
          },
          "vk-menu": { title: "மெனு" },
          "vk-lunch": {
            title: "மதிய நேர ரஷ், 12 முதல் 3 மணி",
            text: "தினமும் 12 முதல் 3 மணி வரை சமையலறையின் மிக வேகமான உணவுகள்: பெட்டிகள், மீல்ஸ், நிமிடத்தில் புறப்படும் பிரியாணி.",
            cta: { label: "மதிய மெனுவைப் பார்" },
          },
          "vk-finder": {
            title: "நாங்கள் என்ன அனுப்ப வேண்டும்?",
            text: "மூன்று தட்டல்கள்: எத்தனை பேர் சாப்பிடுகிறீர்கள், சைவமா அசைவமா, உங்கள் பட்ஜெட். பொருத்தமானதைக் காட்டுவோம்.",
            buttonLabel: "என் மெனுவைக் காட்டு",
            cta: { label: "கூட்டமா? வாட்ஸ்அப்பில் பார்ட்டி ஆர்டரைத் திட்டமிடுங்கள்" },
            questions: [
              { label: "எத்தனை பேர் சாப்பிடுகிறீர்கள்?", options: [{ label: "நான் மட்டும்" }, { label: "நாங்கள் இருவர்" }, { label: "மூன்று அல்லது நான்கு" }, { label: "பார்ட்டி (10+)" }] },
              { label: "சைவமா அசைவமா?", options: [{ label: "சைவம்" }, { label: "முட்டை" }, { label: "அசைவம்" }] },
              { label: "ஆர்டருக்கான பட்ஜெட்", options: [{ label: "ரூ 200-க்குள்" }, { label: "ரூ 200 - 400" }, { label: "ரூ 400 - 800" }, { label: "ரூ 800 மேல்" }] },
            ],
          },
          "vk-family": {
            title: "எந்த ஃபேமிலி பேக்?",
            text: "நால்வருக்கு உணவளிக்க மூன்று வழிகள், எல்லாம் சூடாக அடைத்தவை. ஃபீஸ்ட் பாக்ஸ் முழு இரவு உணவு; பிரியாணி டப்பாக்கள் மற்றவை உங்களிடம் ஏற்கனவே இருக்கும்போது.",
            highlightLabel: "முழு இரவு உணவு",
            rows: COMPARE_ROWS_TA,
          },
          "vk-best": { title: "இந்த வாரம் அதிகம் ஆர்டர் செய்தவை" },
          "vk-stories": {
            title: "சமையலறையின் உள்ளே",
            items: [
              { title: "தம்", text: "ஒவ்வொரு பிரியாணியும் அடைத்து 25 நிமிடம் ஆவியில் வேகும். எதுவும் விளக்கின் கீழ் காத்திருப்பதில்லை.", ctaLabel: "பிரியாணி" },
              { title: "பரோட்டா, நேரடியாக", text: "ஆர்டர் வர வர உருட்டி, விரித்து, தவாவில் சுடுகிறோம்; மீண்டும் சூடாக்குவதில்லை.", ctaLabel: "பரோட்டா, கிரேவி" },
              { title: "பொரிக்கும் இடம்", text: "சிக்கன் 65, மீன் வறுவல் ஒவ்வொரு தொகுதிக்கும் புதிய எண்ணெயில்; காற்றோட்டப் பெட்டிகளில் அடைப்பு.", ctaLabel: "ஸ்நாக்ஸ்" },
              { title: "பெட்டி அடைப்பு", text: "ஒவ்வொரு பெட்டியும் கையால் அடைத்து, மூடி, ஆர்டர் நேரம் ஒட்டப்படும்.", ctaLabel: "காம்போ பெட்டிகள்" },
            ],
          },
          "vk-party": {
            title: "பார்ட்டி ட்ரேக்கள்",
            text: "ரைத்தா, கிரேவியுடன் மூடிய ட்ரேக்கள்; ஒரு நாள் முன்பு ஆர்டர் செய்தால் நீங்கள் தேர்ந்த நேரத்தில் டெலிவரி. விலையில் 5% GST சேர்ந்தது.",
            plans: [
              plan({ name: "சைவ ட்ரே, 10 பேருக்கு", description: "சைவ தம் பிரியாணி, ரைத்தா, வெஜ் குருமா.", features: ["10 பேருக்கு (20 பேருக்கு ரூ 3,399)", "வெஜ் குருமா, ரைத்தா", "மூடிய அலுமினிய ட்ரே"], cta: { label: "ட்ரே ஆர்டர் செய்" } }),
              plan({ name: "சிக்கன் ட்ரே, 10 பேருக்கு", description: "திண்டுக்கல் சிக்கன் பிரியாணி, ரைத்தா, கத்தரிக்காய் கிரேவி.", features: ["10 பேருக்கு (20 பேருக்கு ரூ 4,799)", "ரைத்தா, கத்தரிக்காய் கிரேவி", "சிக்கன் 65 ட்ரே சேர்க்கலாம், ரூ 1,699"], badge: "அதிகம் ஆர்டர் செய்தது", cta: { label: "ட்ரே ஆர்டர் செய்" } }),
              plan({ name: "மட்டன் ட்ரே, 10 பேருக்கு", description: "ஆம்பூர் மட்டன் பிரியாணி, ரைத்தா, கத்தரிக்காய் கிரேவி.", features: ["10 பேருக்கு (20 பேருக்கு ரூ 7,699)", "எலும்புடன் மட்டன்", "ரைத்தா, கத்தரிக்காய் கிரேவி"], cta: { label: "ட்ரே ஆர்டர் செய்" } }),
              plan({ name: "அலுவலக லஞ்ச் பாக்ஸ்", description: "ஒரு பெட்டி, 30 அல்லது அதற்கு மேல்; மாதம் ஒரு GST இன்வாய்ஸ்.", features: ["மீல்ஸ் அல்லது பிரியாணி பெட்டிகள்", "மதியம் 12:15-க்கு டெலிவரி", "மாத இன்வாய்ஸ் கடனில்"], cta: { label: "வாட்ஸ்அப்பில் கேளுங்கள்" } }),
            ],
          },
          "vk-stats": {
            title: "எண்களில் சமையலறை",
            items: [stat("நிமிடம், சராசரி டெலிவரி நேரம்"), stat("தினமும் தம் பிரியாணிகள்", "+"), stat("மாத லஞ்ச் பெறும் OMR அலுவலகங்கள்", "+"), stat("மெனுவில் உணவுகள்")],
          },
          "vk-reviews": {
            title: "OMR-இன் இன்பாக்ஸ்களிலிருந்து",
            items: [
              { quote: "ஒவ்வொரு வியாழனும் எங்கள் குழுவுக்கு 35 சிக்கன் பிரியாணி பெட்டிகள் ஆர்டர் செய்கிறோம். 12:15-க்கு சூடாக வரும், பையில் இன்வாய்ஸும் இருக்கும். கணக்குக் குழுவுக்கு மாத GST பில் பிடிக்கும்.", role: "அட்மின் லீட், துரைப்பாக்கம்" },
              { quote: "ஆம்பூர் மட்டன் பிரியாணி என் மாமா வீட்டுக் கல்யாணத்தில் சாப்பிட்டது போலவே இருக்கிறது. ஃபேமிலி டப்பா நால்வருக்குப் போதும், மறுநாளுக்கும் மிச்சம்.", role: "சோழிங்கநல்லூர்" },
              { quote: "இரவு 8:40-க்கு ஆர்டர் செய்தேன்; பரோட்டா, சிக்கன் சால்னா 34 நிமிடத்தில் வந்தது, பரோட்டா இன்னும் மென்மையாக. நள்ளிரவில் காலிங் பெல் அடிக்காமல் கேட்டில் நின்று அழைத்தார்.", role: "கரப்பாக்கம்" },
            ],
          },
          "vk-faq": { title: "டெலிவரி, அளவுகள், பார்ட்டி ஆர்டர்", items: FAQ_TA },
          "vk-location": {
            title: "எங்கள் சமையலறை",
            address: "ப்ளாட் 22, கரப்பாக்கம் மெயின் ரோடு, OMR, சென்னை 600097. டெலிவரி மட்டும்; முன்பணம் செலுத்திய ஆர்டர்களுக்கு பிக்-அப் ஜன்னல்.",
            hours: [{ label: "தினமும்", value: "காலை 11:00 - இரவு 11:30" }],
          },
        },
      },
    };
  },
  pages: [
    {
      slug: "about",
      title: "Our kitchen",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Vaasam Biryani Kitchen, Karapakkam, OMR" },
        {
          type: "paragraph",
          markdown:
            "Vaasam (வாசம்) means aroma. We started in **2022** in a 400 sq ft kitchen behind the Karapakkam main road, cooking Dindigul biryani for neighbours on WhatsApp. There is no dining room: the money that would have gone to rent, tables and a service team goes into rice, meat and good boxes.\n\nToday we cook biryani in small dum batches all day, make parotta live on the tawa, and deliver across OMR in **30 to 40 minutes**. Offices on Rajiv Gandhi Salai order team lunches and party trays on monthly credit.",
        },
        { type: "image", url: photo(28674660, "tile"), alt: "Chicken biryani in a handi with a bowl of curry" },
        { type: "paragraph", markdown: "Open every day 11 am to 11:30 pm. Call or WhatsApp **+91 98765 00020**." },
      ],
    },
    {
      slug: "party-orders",
      title: "Party orders",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Trays for 10, 20 or 30+" },
        {
          type: "paragraph",
          markdown:
            "| Tray | Serves 10 | Serves 20 |\n|---|---|---|\n| Veg biryani | Rs 1,799 | Rs 3,399 |\n| Chicken biryani | Rs 2,499 | Rs 4,799 |\n| Mutton biryani | Rs 3,999 | Rs 7,699 |\n| Chicken 65 | Rs 1,699 | Rs 3,199 |\n\nPrices include 5% GST. Every tray comes sealed with raita and brinjal gravy.",
        },
        { type: "heading", level: 3, text: "How it works" },
        {
          type: "paragraph",
          markdown:
            "1. Order on the store or send the date, time, count and address on WhatsApp, **a day ahead** (by 6 pm).\n2. Pay 50% in advance above Rs 5,000; the rest on delivery by UPI or cash.\n3. We deliver in the slot you pick, anywhere in Chennai (Rs 149, free above Rs 2,000).\n4. Use the code **PARTY5** for 5% off orders above Rs 5,000 (up to Rs 1,000).\n\n**Offices:** 30 or more lunch boxes a day or a week? After the first order we can set up a monthly credit account with one GST invoice. Send your GSTIN on WhatsApp.",
        },
        { type: "image", url: photo(9609869, "tile"), alt: "Biryani with a rich curry sauce" },
        { type: "button", label: "Plan a party order on WhatsApp", href: waLink(PARTY_TEXT), style: "primary" },
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
            "- **FSSAI licence:** 12345678901234 (placeholder for this demo). The licence and our latest hygiene audit are displayed at the kitchen.\n- **Staff:** a food-handler medical check every year, caps, gloves and aprons on the line, hand-wash stations at each station.\n- **Cold chain:** chicken, mutton and fish are stored below 4 degrees C and cooked the same day; nothing is cooked twice.\n- **Oil:** fresh oil for every fry batch; used oil goes to an authorised collector, not back into the pan.\n- **Boxes:** food-grade, leak-proof containers sealed and stickered with the cooking time.\n- **Veg and non-veg:** separate burners and ladles, but one kitchen (see the delivery FAQ).",
        },
        { type: "paragraph", markdown: "Found something wrong with your order? Message us on WhatsApp within 30 minutes with a photo." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). They illustrate similar dishes and are not photographs of our own food.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Biryani", type: "category", ref: "biryani" },
      { label: "Combos", type: "category", ref: "combos" },
      { label: "Meals", type: "category", ref: "meals" },
      {
        label: "Parotta & gravies",
        type: "category",
        ref: "parotta-and-gravies",
      },
      { label: "Snacks", type: "category", ref: "snacks" },
      { label: "Desserts & drinks", type: "category", ref: "desserts", children: [{ label: "Beverages", type: "category", ref: "beverages" }] },
      { label: "Party orders", type: "page", ref: "party-orders" },
    ],
    footer: [
      {
        label: "Order",
        type: "url",
        children: [
          { label: "Lunch rush", type: "collection", ref: "lunch-rush" },
          { label: "Family packs", type: "collection", ref: "family-packs" },
          { label: "Party trays", type: "collection", ref: "party-trays" },
          { label: "Track your order", type: "url", href: "/track" },
        ],
      },
      {
        label: "Kitchen",
        type: "url",
        children: [
          { label: "Our kitchen", type: "page", ref: "about" },
          { label: "Hygiene and FSSAI", type: "page", ref: "hygiene" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  setup: setupVaasam,
};
