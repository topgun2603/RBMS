/**
 * The 15 solutions srikit ships. A pack is pure data: which app runs it, the theme it starts from, what the storefront
 * calls things, which shopper features make sense (size guide, "made locally"), starter categories and home page, and
 * hints for the product editor. Nothing here knows about the database; the API seeds from it and the UIs read it.
 */

export const APP_IDS = ["BL", "EC", "PH", "RS", "SV"] as const;
export type AppId = (typeof APP_IDS)[number];

export type UspIcon = "truck" | "cash" | "return" | "shield" | "star" | "gift" | "phone" | "leaf" | "clock" | "tag" | "heart" | "check";

/** Shopper-facing words, in English and Tamil. */
export interface Copy {
  /** Search box placeholder. */
  search: string;
  /** What "newest items" are called: New arrivals, Fresh today, Today's specials… */
  newItems: string;
  /** Home hero. */
  heroHeading: string;
  heroSubheading: string;
  /** Main call to action. */
  cta: string;
  /** Footer newsletter line. */
  newsletter: string;
  /** Categories section title on the home page. */
  categoriesTitle: string;
}

export interface Usp {
  icon: UspIcon;
  title: { en: string; ta: string };
  text: { en: string; ta: string };
}

export interface BusinessPack {
  id: BusinessType;
  name: string;
  nameTa: string;
  /** One line for pickers. */
  tagline: string;
  /** The app the shop runs on. */
  appId: AppId;
  /** Theme preset id (@srirealtime/branding THEME_PRESETS). */
  preset: string;
  copy: { en: Copy; ta: Copy };
  /**
   * Engines the trade uses that are off for other shops of the same app (switched on for the shop when the pack is
   * applied): weighing scales, serial numbers / warranty, jewellery rates.
   */
  features?: string[];
  /** Where the home page's main button goes: "/search" (shop) by default, "/book" for appointment trades. */
  ctaHref?: string;
  /** Show the clothing size guide next to a "Size" option. */
  sizeGuide: boolean;
  /** Show the "Made in Tamil Nadu / local makers" trust badge. */
  localMade: boolean;
  usps: Usp[];
  /** Starter categories for a new shop (none are created when the shop already has some). */
  categories: string[];
  /** Product editor hints. */
  editor: {
    namePlaceholder: string;
    descriptionPlaceholder: string;
    attributes: string[];
    options: string[];
    /** Example category path for the empty state. */
    categoryExample: string;
  };
}

export const BUSINESS_TYPES = [
  "fashion",
  "pharmacy",
  "restaurant",
  "cloud_kitchen",
  "grocery",
  "bakery",
  "fresh",
  "electronics",
  "repair",
  "salon",
  "gym",
  "jewellery",
  "hardware",
  "optical",
  "tailoring",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

const usp = (icon: UspIcon, en: [string, string], ta: [string, string]): Usp => ({ icon, title: { en: en[0], ta: ta[0] }, text: { en: en[1], ta: ta[1] } });

const DELIVERY = usp("truck", ["Home delivery", "Quick delivery to your door"], ["வீட்டு டெலிவரி", "உங்கள் வாசலுக்கு விரைவில்"]);
const COD = usp("cash", ["Cash on delivery", "Pay when it arrives"], ["டெலிவரியில் பணம்", "வந்ததும் செலுத்துங்கள்"]);
const UPI = usp("phone", ["UPI & cards", "Pay the way you like"], ["UPI & கார்டு", "விரும்பிய வழியில் செலுத்துங்கள்"]);
const GENUINE = usp("shield", ["100% genuine", "Sourced from authorised suppliers"], ["100% அசல்", "அங்கீகரிக்கப்பட்ட விநியோகஸ்தர்களிடமிருந்து"]);

export const PACKS: Record<BusinessType, BusinessPack> = {
  fashion: {
    id: "fashion",
    name: "Clothing & boutique",
    nameTa: "ஆடை & பூட்டிக்",
    tagline: "Sarees, kurtis, menswear and kidswear with sizes and colours",
    appId: "EC",
    preset: "heritage",
    sizeGuide: true,
    localMade: true,
    copy: {
      en: {
        search: "Search sarees, kurtis, shirts…",
        newItems: "New arrivals",
        heroHeading: "New season, handpicked for you",
        heroSubheading: "Fresh styles every week, delivered to your door.",
        cta: "Shop the collection",
        newsletter: "New arrivals, festive drops and offers, once a week.",
        categoriesTitle: "Shop by category",
      },
      ta: {
        search: "புடவை, குர்தி, சட்டை தேடு…",
        newItems: "புதிய வரவுகள்",
        heroHeading: "புதிய சீசன், உங்களுக்காகத் தேர்ந்தவை",
        heroSubheading: "ஒவ்வொரு வாரமும் புதிய ஸ்டைல்கள், உங்கள் வாசலுக்கு.",
        cta: "கலெக்‌ஷனைப் பாருங்கள்",
        newsletter: "புதிய வரவுகள், பண்டிகை சலுகைகள், வாரம் ஒருமுறை.",
        categoriesTitle: "வகை வாரியாக",
      },
    },
    usps: [DELIVERY, COD, usp("return", ["Easy returns", "7-day returns on unused items"], ["எளிய திருப்பம்", "பயன்படுத்தாதவைக்கு 7 நாள்"])],
    categories: ["Sarees", "Kurtis", "Men", "Kids", "Accessories"],
    editor: {
      namePlaceholder: "e.g. Kanchipuram silk saree",
      descriptionPlaceholder: "Fabric, fit, care instructions…",
      attributes: ["Fabric", "Fit", "Pattern", "Occasion", "Care", "Origin"],
      options: ["Size", "Colour", "Material", "Style"],
      categoryExample: "Women › Sarees › Silk",
    },
  },
  pharmacy: {
    id: "pharmacy",
    name: "Pharmacy",
    nameTa: "மருந்தகம்",
    tagline: "Medicines with batches, expiry, prescriptions and the H1 register",
    appId: "PH",
    preset: "care",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search medicines, brands or salts…",
        newItems: "Just in",
        heroHeading: "Your neighbourhood pharmacy, now online",
        heroSubheading: "Genuine medicines and wellness essentials, delivered fast.",
        cta: "Order medicines",
        newsletter: "Health tips and offers on wellness essentials.",
        categoriesTitle: "Shop by need",
      },
      ta: {
        search: "மருந்து, பிராண்ட் அல்லது கலவை தேடு…",
        newItems: "புதிதாக வந்தவை",
        heroHeading: "உங்கள் அருகிலுள்ள மருந்தகம், இப்போது ஆன்லைனில்",
        heroSubheading: "அசல் மருந்துகள், ஆரோக்கியப் பொருட்கள், விரைவான டெலிவரி.",
        cta: "மருந்து ஆர்டர் செய்",
        newsletter: "ஆரோக்கியக் குறிப்புகள், சலுகைகள்.",
        categoriesTitle: "தேவை வாரியாக",
      },
    },
    usps: [GENUINE, DELIVERY, usp("check", ["Pharmacist checked", "Every order checked before dispatch"], ["மருந்தாளர் சரிபார்ப்பு", "அனுப்பும் முன் சரிபார்க்கப்படும்"])],
    categories: ["Medicines", "Diabetes care", "Vitamins & supplements", "Personal care", "Baby care", "Devices"],
    editor: {
      namePlaceholder: "e.g. Paracetamol 650 mg (strip of 15)",
      descriptionPlaceholder: "Uses, dosage, side effects, storage…",
      attributes: ["Composition", "Manufacturer", "Form", "Storage", "Prescription"],
      options: ["Pack size", "Strength"],
      categoryExample: "Medicines › Pain relief",
    },
  },
  restaurant: {
    id: "restaurant",
    name: "Restaurant & café",
    nameTa: "உணவகம் & கஃபே",
    tagline: "Tables, KOTs, kitchen display, QR menu and online orders",
    appId: "RS",
    preset: "bistro",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search dishes…",
        newItems: "Today's specials",
        heroHeading: "Freshly cooked, served hot",
        heroSubheading: "Order online for pickup or delivery, or scan the QR at your table.",
        cta: "Order now",
        newsletter: "New dishes and weekend specials.",
        categoriesTitle: "Our menu",
      },
      ta: {
        search: "உணவுகளைத் தேடு…",
        newItems: "இன்றைய சிறப்பு",
        heroHeading: "புதிதாகச் சமைத்து, சூடாகப் பரிமாறுகிறோம்",
        heroSubheading: "எடுத்துச் செல்ல அல்லது டெலிவரிக்கு ஆன்லைனில் ஆர்டர் செய்யுங்கள்.",
        cta: "இப்போது ஆர்டர் செய்",
        newsletter: "புதிய உணவுகள், வார இறுதி சிறப்புகள்.",
        categoriesTitle: "எங்கள் மெனு",
      },
    },
    usps: [usp("clock", ["Ready in minutes", "Cooked to order"], ["நிமிடங்களில் தயார்", "ஆர்டருக்கு ஏற்ப சமையல்"]), DELIVERY, UPI],
    categories: ["Starters", "Main course", "Breads & rice", "Desserts", "Beverages"],
    editor: {
      namePlaceholder: "e.g. Masala dosa",
      descriptionPlaceholder: "What's in it, spice level, serves…",
      attributes: ["Spice level", "Serves", "Allergens", "Contains"],
      options: ["Portion", "Size", "Add-on"],
      categoryExample: "Main course › Biryani",
    },
  },
  cloud_kitchen: {
    id: "cloud_kitchen",
    name: "Cloud kitchen",
    nameTa: "கிளவுட் கிச்சன்",
    tagline: "Delivery-only kitchen: online and aggregator orders straight to the kitchen screen",
    appId: "RS",
    preset: "bistro",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search the menu…",
        newItems: "New on the menu",
        heroHeading: "Hot food, delivered",
        heroSubheading: "Order online and track it to your door.",
        cta: "Order now",
        newsletter: "New dishes and combo offers.",
        categoriesTitle: "Menu",
      },
      ta: {
        search: "மெனுவில் தேடு…",
        newItems: "மெனுவில் புதியவை",
        heroHeading: "சூடான உணவு, உங்கள் வீட்டுக்கு",
        heroSubheading: "ஆன்லைனில் ஆர்டர் செய்து, வாசல் வரை கண்காணியுங்கள்.",
        cta: "இப்போது ஆர்டர் செய்",
        newsletter: "புதிய உணவுகள், காம்போ சலுகைகள்.",
        categoriesTitle: "மெனு",
      },
    },
    usps: [DELIVERY, usp("clock", ["30-minute delivery", "Fresh from our kitchen"], ["30 நிமிட டெலிவரி", "எங்கள் சமையலறையிலிருந்து"]), UPI],
    categories: ["Combos", "Biryani", "Meals", "Snacks", "Beverages"],
    editor: {
      namePlaceholder: "e.g. Chicken biryani combo",
      descriptionPlaceholder: "What's in it, spice level, serves…",
      attributes: ["Spice level", "Serves", "Allergens"],
      options: ["Portion", "Add-on"],
      categoryExample: "Combos › Family packs",
    },
  },
  grocery: {
    id: "grocery",
    name: "Grocery & supermarket",
    nameTa: "மளிகை & சூப்பர்மார்க்கெட்",
    tagline: "Fast counter billing, loose items by weight, expiry and home delivery",
    appId: "EC",
    preset: "fresh",
    features: ["scales"],
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search rice, oil, atta, snacks…",
        newItems: "Fresh in store",
        heroHeading: "Your monthly groceries, delivered",
        heroSubheading: "Daily essentials at honest prices, at your door today.",
        cta: "Start shopping",
        newsletter: "Weekly offers on daily essentials.",
        categoriesTitle: "Shop by aisle",
      },
      ta: {
        search: "அரிசி, எண்ணெய், மாவு, ஸ்நாக்ஸ் தேடு…",
        newItems: "கடையில் புதியவை",
        heroHeading: "மாத மளிகை, உங்கள் வீட்டுக்கு",
        heroSubheading: "நேர்மையான விலையில் தினசரி பொருட்கள், இன்றே வாசலுக்கு.",
        cta: "ஷாப்பிங் தொடங்கு",
        newsletter: "தினசரி பொருட்களில் வாரச் சலுகைகள்.",
        categoriesTitle: "பிரிவு வாரியாக",
      },
    },
    usps: [usp("clock", ["Same-day delivery", "Order by 5 pm"], ["அதே நாள் டெலிவரி", "மாலை 5 மணிக்குள் ஆர்டர்"]), COD, usp("tag", ["Best prices", "Weekly offers"], ["சிறந்த விலை", "வாரச் சலுகைகள்"])],
    categories: ["Rice & grains", "Oils & ghee", "Masalas & spices", "Snacks", "Beverages", "Household"],
    editor: {
      namePlaceholder: "e.g. Ponni rice 25 kg",
      descriptionPlaceholder: "Brand, pack size, best before…",
      attributes: ["Brand", "Net weight", "Best before", "Origin"],
      options: ["Pack size", "Weight"],
      categoryExample: "Rice & grains › Ponni",
    },
  },
  bakery: {
    id: "bakery",
    name: "Bakery & sweets",
    nameTa: "பேக்கரி & இனிப்பு",
    tagline: "Counter billing by weight, expiry, custom cake orders and pre-orders",
    appId: "EC",
    preset: "bistro",
    features: ["scales"],
    sizeGuide: false,
    localMade: true,
    copy: {
      en: {
        search: "Search cakes, sweets, savouries…",
        newItems: "Fresh from the oven",
        heroHeading: "Baked fresh every morning",
        heroSubheading: "Cakes, sweets and savouries. Order a custom cake for your celebration.",
        cta: "Order now",
        newsletter: "Festival sweets and new bakes.",
        categoriesTitle: "Our bakes",
      },
      ta: {
        search: "கேக், இனிப்பு, காரம் தேடு…",
        newItems: "அடுப்பிலிருந்து புதிதாக",
        heroHeading: "ஒவ்வொரு காலையும் புதிதாகச் சுட்டவை",
        heroSubheading: "கேக், இனிப்பு, காரம். உங்கள் கொண்டாட்டத்துக்கு கேக் ஆர்டர் செய்யுங்கள்.",
        cta: "இப்போது ஆர்டர் செய்",
        newsletter: "பண்டிகை இனிப்புகள், புதிய வகைகள்.",
        categoriesTitle: "எங்கள் தயாரிப்புகள்",
      },
    },
    usps: [usp("heart", ["Made fresh daily", "No preservatives"], ["தினமும் புதிது", "பாதுகாப்புப் பொருள் இல்லை"]), usp("gift", ["Custom cakes", "For every celebration"], ["விருப்ப கேக்", "ஒவ்வொரு கொண்டாட்டத்துக்கும்"]), DELIVERY],
    categories: ["Cakes", "Sweets", "Savouries", "Breads", "Cookies"],
    editor: {
      namePlaceholder: "e.g. Black forest cake 1 kg",
      descriptionPlaceholder: "Flavour, weight, eggless, best before…",
      attributes: ["Flavour", "Eggless", "Best before", "Serves"],
      options: ["Weight", "Flavour"],
      categoryExample: "Cakes › Birthday",
    },
  },
  fresh: {
    id: "fresh",
    name: "Fruits, vegetables, meat & fish",
    nameTa: "பழம், காய்கறி, இறைச்சி & மீன்",
    tagline: "Sold by weight with daily prices; fresh stock, quick delivery",
    appId: "EC",
    preset: "fresh",
    features: ["scales"],
    sizeGuide: false,
    localMade: true,
    copy: {
      en: {
        search: "Search tomatoes, chicken, fish…",
        newItems: "Today's fresh stock",
        heroHeading: "Farm fresh, every morning",
        heroSubheading: "Fruits, vegetables, meat and fish, cut and cleaned to order.",
        cta: "Shop fresh",
        newsletter: "Today's prices and seasonal arrivals.",
        categoriesTitle: "Shop fresh",
      },
      ta: {
        search: "தக்காளி, கோழி, மீன் தேடு…",
        newItems: "இன்றைய புதிய சரக்கு",
        heroHeading: "தோட்டத்திலிருந்து, ஒவ்வொரு காலையும்",
        heroSubheading: "பழம், காய்கறி, இறைச்சி, மீன்: ஆர்டருக்கு ஏற்ப வெட்டி சுத்தம் செய்து.",
        cta: "புதியவை வாங்கு",
        newsletter: "இன்றைய விலைகள், பருவகால வரவுகள்.",
        categoriesTitle: "புதியவை",
      },
    },
    usps: [usp("leaf", ["Fresh daily", "Sourced every morning"], ["தினமும் புதிது", "ஒவ்வொரு காலையும் கொள்முதல்"]), usp("check", ["Cut & cleaned", "Just the way you like"], ["வெட்டி சுத்தம்", "நீங்கள் விரும்பியபடி"]), DELIVERY],
    categories: ["Vegetables", "Fruits", "Chicken", "Mutton", "Fish & seafood", "Eggs"],
    editor: {
      namePlaceholder: "e.g. Tomato (per kg)",
      descriptionPlaceholder: "Variety, origin, how it's cut…",
      attributes: ["Origin", "Variety", "Cut"],
      options: ["Weight", "Cut"],
      categoryExample: "Vegetables › Leafy greens",
    },
  },
  electronics: {
    id: "electronics",
    name: "Electronics & mobiles",
    nameTa: "எலக்ட்ரானிக்ஸ் & மொபைல்",
    tagline: "Serial / IMEI tracking, warranty and EMI on the bill",
    appId: "EC",
    preset: "tech",
    features: ["serials", "serials.warranty"],
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search phones, TVs, accessories…",
        newItems: "Latest launches",
        heroHeading: "The latest tech, at the best price",
        heroSubheading: "Genuine products with brand warranty. EMI available.",
        cta: "Shop now",
        newsletter: "New launches and price drops.",
        categoriesTitle: "Shop by category",
      },
      ta: {
        search: "போன், டிவி, ஆக்சசரீஸ் தேடு…",
        newItems: "புதிய அறிமுகங்கள்",
        heroHeading: "சமீபத்திய தொழில்நுட்பம், சிறந்த விலையில்",
        heroSubheading: "பிராண்ட் வாரண்டியுடன் அசல் பொருட்கள். EMI உண்டு.",
        cta: "இப்போது வாங்கு",
        newsletter: "புதிய அறிமுகங்கள், விலைக் குறைப்புகள்.",
        categoriesTitle: "வகை வாரியாக",
      },
    },
    usps: [GENUINE, usp("star", ["Brand warranty", "Every product, every time"], ["பிராண்ட் வாரண்டி", "ஒவ்வொரு பொருளுக்கும்"]), usp("cash", ["Easy EMI", "On cards and finance"], ["எளிய EMI", "கார்டு, ஃபைனான்ஸ்"])],
    categories: ["Mobiles", "TVs", "Laptops", "Audio", "Accessories", "Appliances"],
    editor: {
      namePlaceholder: "e.g. Samsung Galaxy A55 5G",
      descriptionPlaceholder: "Key specs, what's in the box, warranty…",
      attributes: ["Brand", "Model", "Warranty", "Colour", "In the box"],
      options: ["Storage", "Colour", "RAM"],
      categoryExample: "Mobiles › Android",
    },
  },
  repair: {
    id: "repair",
    name: "Mobile & electronics repair",
    nameTa: "மொபைல் & எலக்ட்ரானிக்ஸ் ரிப்பேர்",
    tagline: "Job cards from intake to delivery, parts and service bills",
    appId: "SV",
    preset: "tech",
    features: ["serials", "serials.warranty"],
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search repairs, parts, accessories…",
        newItems: "New accessories",
        heroHeading: "Fast, honest repairs",
        heroSubheading: "Screens, batteries, charging ports and more, often the same day.",
        cta: "Book a repair",
        newsletter: "Service offers and new accessories.",
        categoriesTitle: "What we fix",
      },
      ta: {
        search: "ரிப்பேர், பாகங்கள், ஆக்சசரீஸ் தேடு…",
        newItems: "புதிய ஆக்சசரீஸ்",
        heroHeading: "விரைவான, நேர்மையான ரிப்பேர்",
        heroSubheading: "ஸ்கிரீன், பேட்டரி, சார்ஜிங் போர்ட் மற்றும் பல, பெரும்பாலும் அதே நாளில்.",
        cta: "ரிப்பேர் புக் செய்",
        newsletter: "சர்வீஸ் சலுகைகள், புதிய ஆக்சசரீஸ்.",
        categoriesTitle: "நாங்கள் சரி செய்வது",
      },
    },
    usps: [usp("clock", ["Same-day repairs", "Most jobs done in hours"], ["அதே நாள் ரிப்பேர்", "பெரும்பாலானவை சில மணிநேரத்தில்"]), usp("shield", ["Service warranty", "On parts and labour"], ["சர்வீஸ் வாரண்டி", "பாகங்கள், வேலைக்கு"]), UPI],
    categories: ["Screen replacement", "Battery", "Charging port", "Accessories", "Spare parts"],
    editor: {
      namePlaceholder: "e.g. iPhone 13 screen replacement",
      descriptionPlaceholder: "What's included, time taken, warranty…",
      attributes: ["Brand", "Model", "Warranty", "Time taken"],
      options: ["Model", "Quality"],
      categoryExample: "Screen replacement › iPhone",
    },
  },
  salon: {
    id: "salon",
    name: "Salon & spa",
    nameTa: "சலூன் & ஸ்பா",
    tagline: "Appointments, stylists, packages and memberships",
    appId: "SV",
    preset: "luxe",
    ctaHref: "/book",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search services and products…",
        newItems: "New treatments",
        heroHeading: "Look good, feel better",
        heroSubheading: "Hair, skin and spa by experienced stylists. Book your slot online.",
        cta: "Book an appointment",
        newsletter: "Seasonal offers and new treatments.",
        categoriesTitle: "Our services",
      },
      ta: {
        search: "சேவைகள், பொருட்கள் தேடு…",
        newItems: "புதிய சிகிச்சைகள்",
        heroHeading: "அழகாகத் தோன்றுங்கள், நன்றாக உணருங்கள்",
        heroSubheading: "அனுபவமிக்க ஸ்டைலிஸ்டுகளின் முடி, சருமம், ஸ்பா. ஆன்லைனில் நேரம் புக் செய்யுங்கள்.",
        cta: "நேரம் புக் செய்",
        newsletter: "பருவகால சலுகைகள், புதிய சிகிச்சைகள்.",
        categoriesTitle: "எங்கள் சேவைகள்",
      },
    },
    usps: [usp("clock", ["Book online", "Pick your time and stylist"], ["ஆன்லைனில் புக்", "நேரம், ஸ்டைலிஸ்ட் தேர்வு"]), usp("star", ["Expert stylists", "Trained and certified"], ["நிபுணர்கள்", "பயிற்சி பெற்றவர்கள்"]), usp("gift", ["Packages", "Save with memberships"], ["பேக்கேஜ்கள்", "உறுப்பினர் சேமிப்பு"])],
    categories: ["Hair", "Skin", "Spa", "Bridal", "Products"],
    editor: {
      namePlaceholder: "e.g. Hair spa (45 min)",
      descriptionPlaceholder: "What's included, duration, products used…",
      attributes: ["Duration", "Suitable for", "Products used"],
      options: ["Length", "Stylist level"],
      categoryExample: "Hair › Colour",
    },
  },
  gym: {
    id: "gym",
    name: "Gym & fitness",
    nameTa: "ஜிம் & ஃபிட்னஸ்",
    tagline: "Memberships, renewals, attendance and personal training",
    appId: "SV",
    preset: "power",
    ctaHref: "/book",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search plans, classes, supplements…",
        newItems: "New programmes",
        heroHeading: "Train harder. Get stronger.",
        heroSubheading: "Memberships, group classes and personal training for every goal.",
        cta: "Join now",
        newsletter: "Training tips and membership offers.",
        categoriesTitle: "Plans & classes",
      },
      ta: {
        search: "திட்டங்கள், வகுப்புகள், சப்ளிமென்ட்ஸ் தேடு…",
        newItems: "புதிய திட்டங்கள்",
        heroHeading: "கடினமாகப் பயிற்சி. வலிமையாக வளருங்கள்.",
        heroSubheading: "ஒவ்வொரு இலக்குக்கும் உறுப்பினர், குழு வகுப்புகள், தனிப் பயிற்சி.",
        cta: "இப்போது சேருங்கள்",
        newsletter: "பயிற்சிக் குறிப்புகள், உறுப்பினர் சலுகைகள்.",
        categoriesTitle: "திட்டங்கள் & வகுப்புகள்",
      },
    },
    usps: [usp("clock", ["Open 5 am – 11 pm", "Every day of the week"], ["காலை 5 – இரவு 11", "வாரம் முழுவதும்"]), usp("star", ["Certified trainers", "Personal plans"], ["சான்றளிக்கப்பட்ட பயிற்சியாளர்", "தனித் திட்டங்கள்"]), usp("gift", ["Flexible plans", "Monthly to yearly"], ["நெகிழ்வான திட்டங்கள்", "மாதம் முதல் ஆண்டு வரை"])],
    categories: ["Memberships", "Personal training", "Group classes", "Supplements", "Gear"],
    editor: {
      namePlaceholder: "e.g. Quarterly membership",
      descriptionPlaceholder: "What's included, timings, validity…",
      attributes: ["Validity", "Sessions", "Timings"],
      options: ["Duration", "Batch"],
      categoryExample: "Memberships › Couple",
    },
  },
  jewellery: {
    id: "jewellery",
    name: "Jewellery",
    nameTa: "நகை",
    tagline: "Weight-based pricing with the day's gold rate, making charges, HUID and old-gold exchange",
    appId: "EC",
    preset: "luxe",
    features: ["jewellery", "jewellery.exchange"],
    sizeGuide: false,
    localMade: true,
    copy: {
      en: {
        search: "Search necklaces, bangles, rings…",
        newItems: "New designs",
        heroHeading: "Timeless gold, crafted for you",
        heroSubheading: "BIS hallmarked jewellery with transparent pricing at today's gold rate.",
        cta: "Explore collection",
        newsletter: "New designs and gold rate alerts.",
        categoriesTitle: "Collections",
      },
      ta: {
        search: "நெக்லஸ், வளையல், மோதிரம் தேடு…",
        newItems: "புதிய டிசைன்கள்",
        heroHeading: "காலத்தால் அழியாத தங்கம், உங்களுக்காக",
        heroSubheading: "இன்றைய தங்க விலையில் வெளிப்படையான விலையுடன் BIS ஹால்மார்க் நகைகள்.",
        cta: "கலெக்‌ஷனைப் பாருங்கள்",
        newsletter: "புதிய டிசைன்கள், தங்க விலை அறிவிப்புகள்.",
        categoriesTitle: "கலெக்‌ஷன்கள்",
      },
    },
    usps: [usp("shield", ["BIS hallmarked", "HUID on every piece"], ["BIS ஹால்மார்க்", "ஒவ்வொன்றிலும் HUID"]), usp("tag", ["Today's gold rate", "Transparent making charges"], ["இன்றைய தங்க விலை", "வெளிப்படையான செய்கூலி"]), usp("return", ["Old gold exchange", "Best value for your gold"], ["பழைய தங்க மாற்று", "சிறந்த மதிப்பு"])],
    categories: ["Necklaces", "Bangles", "Earrings", "Rings", "Chains", "Silver"],
    editor: {
      namePlaceholder: "e.g. 22K temple necklace",
      descriptionPlaceholder: "Purity, weight, stones, occasion…",
      attributes: ["Purity", "Gross weight", "Net weight", "Stone", "HUID"],
      options: ["Size", "Purity"],
      categoryExample: "Necklaces › Temple",
    },
  },
  hardware: {
    id: "hardware",
    name: "Hardware & building materials",
    nameTa: "ஹார்டுவேர் & கட்டுமானப் பொருள்",
    tagline: "Units like bag, kg and feet, quotations and the credit book",
    appId: "BL",
    preset: "workshop",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search cement, pipes, paints, tools…",
        newItems: "New stock",
        heroHeading: "Everything you need to build",
        heroSubheading: "Cement to fittings, tools to paints. Bulk quotes and site delivery.",
        cta: "Get a quote",
        newsletter: "Price updates and new stock.",
        categoriesTitle: "Shop by department",
      },
      ta: {
        search: "சிமெண்ட், பைப், பெயிண்ட், டூல்ஸ் தேடு…",
        newItems: "புதிய சரக்கு",
        heroHeading: "கட்டுவதற்கு தேவையான அனைத்தும்",
        heroSubheading: "சிமெண்ட் முதல் ஃபிட்டிங்ஸ் வரை. மொத்த விலைப்புள்ளி, சைட் டெலிவரி.",
        cta: "விலைப்புள்ளி பெறு",
        newsletter: "விலை மாற்றங்கள், புதிய சரக்கு.",
        categoriesTitle: "பிரிவு வாரியாக",
      },
    },
    usps: [usp("truck", ["Site delivery", "Bulk orders to your site"], ["சைட் டெலிவரி", "மொத்த ஆர்டர்கள்"]), usp("tag", ["Bulk pricing", "Ask for a quote"], ["மொத்த விலை", "விலைப்புள்ளி கேளுங்கள்"]), GENUINE],
    categories: ["Cement & steel", "Pipes & fittings", "Electricals", "Paints", "Tools", "Sanitary"],
    editor: {
      namePlaceholder: "e.g. UltraTech cement (50 kg bag)",
      descriptionPlaceholder: "Brand, grade, size, unit…",
      attributes: ["Brand", "Grade", "Size", "Unit"],
      options: ["Size", "Grade", "Colour"],
      categoryExample: "Pipes & fittings › PVC",
    },
  },
  optical: {
    id: "optical",
    name: "Optical store",
    nameTa: "கண்ணாடிக் கடை",
    tagline: "Eye prescriptions, frames and made-to-order lenses",
    appId: "SV",
    preset: "care",
    ctaHref: "/book",
    sizeGuide: false,
    localMade: false,
    copy: {
      en: {
        search: "Search frames, sunglasses, lenses…",
        newItems: "New frames",
        heroHeading: "See better, look sharper",
        heroSubheading: "Free eye test, hundreds of frames and lenses made to your prescription.",
        cta: "Book an eye test",
        newsletter: "New frames and eye-care tips.",
        categoriesTitle: "Shop eyewear",
      },
      ta: {
        search: "ஃப்ரேம், சன்கிளாஸ், லென்ஸ் தேடு…",
        newItems: "புதிய ஃப்ரேம்கள்",
        heroHeading: "தெளிவாகப் பாருங்கள், அழகாகத் தோன்றுங்கள்",
        heroSubheading: "இலவச கண் பரிசோதனை, நூற்றுக்கணக்கான ஃப்ரேம்கள், உங்கள் பவருக்கு லென்ஸ்.",
        cta: "கண் பரிசோதனை புக் செய்",
        newsletter: "புதிய ஃப்ரேம்கள், கண் பராமரிப்புக் குறிப்புகள்.",
        categoriesTitle: "கண்ணாடிகள்",
      },
    },
    usps: [usp("check", ["Free eye test", "By qualified optometrists"], ["இலவச கண் பரிசோதனை", "தகுதியான நிபுணர்களால்"]), usp("clock", ["Lenses in 48 hours", "Made to your prescription"], ["48 மணிநேரத்தில் லென்ஸ்", "உங்கள் பவருக்கு ஏற்ப"]), usp("shield", ["1-year warranty", "On frames and lenses"], ["1 ஆண்டு வாரண்டி", "ஃப்ரேம், லென்ஸுக்கு"])],
    categories: ["Eyeglasses", "Sunglasses", "Contact lenses", "Kids", "Accessories"],
    editor: {
      namePlaceholder: "e.g. Ray-Ban RB2140 Wayfarer",
      descriptionPlaceholder: "Frame size, material, lens options…",
      attributes: ["Brand", "Frame size", "Material", "Shape"],
      options: ["Colour", "Lens type"],
      categoryExample: "Eyeglasses › Full rim",
    },
  },
  tailoring: {
    id: "tailoring",
    name: "Tailoring & stitching",
    nameTa: "தையல்",
    tagline: "Orders with measurements, trial and delivery dates",
    appId: "SV",
    preset: "atelier",
    ctaHref: "/book",
    sizeGuide: true,
    localMade: true,
    copy: {
      en: {
        search: "Search blouses, salwars, shirts…",
        newItems: "New designs",
        heroHeading: "Stitched to fit you perfectly",
        heroSubheading: "Blouses, salwars and shirts tailored to your measurements, on time.",
        cta: "Book a fitting",
        newsletter: "New designs and festival booking dates.",
        categoriesTitle: "What we stitch",
      },
      ta: {
        search: "பிளவுஸ், சல்வார், சட்டை தேடு…",
        newItems: "புதிய டிசைன்கள்",
        heroHeading: "உங்களுக்கு கச்சிதமாகத் தைக்கப்படும்",
        heroSubheading: "உங்கள் அளவுக்கு ஏற்ப பிளவுஸ், சல்வார், சட்டை, நேரத்துக்கு.",
        cta: "அளவெடுக்க புக் செய்",
        newsletter: "புதிய டிசைன்கள், பண்டிகை புக்கிங் தேதிகள்.",
        categoriesTitle: "நாங்கள் தைப்பவை",
      },
    },
    usps: [usp("check", ["Perfect fit", "Free alterations in 7 days"], ["கச்சிதமான அளவு", "7 நாளில் இலவச திருத்தம்"]), usp("clock", ["On-time delivery", "Or your stitching is free"], ["நேரத்துக்கு டெலிவரி", "இல்லையேல் தையல் இலவசம்"]), usp("heart", ["Designer finish", "Piping, lining, embroidery"], ["டிசைனர் ஃபினிஷ்", "பைப்பிங், லைனிங், எம்பிராய்டரி"])],
    categories: ["Blouses", "Salwar & churidar", "Shirts & pants", "Kids", "Alterations"],
    editor: {
      namePlaceholder: "e.g. Princess-cut blouse stitching",
      descriptionPlaceholder: "Style, lining, delivery time…",
      attributes: ["Style", "Lining", "Delivery time"],
      options: ["Style", "Sleeve"],
      categoryExample: "Blouses › Designer",
    },
  },
};

/** Old free-text signup values and aliases → a pack. Unknown or empty → null. */
const ALIASES: Record<string, BusinessType> = {
  textiles: "fashion",
  clothing: "fashion",
  boutique: "fashion",
  medical: "pharmacy",
  chemist: "pharmacy",
  cafe: "restaurant",
  hotel: "restaurant",
  supermarket: "grocery",
  kirana: "grocery",
  sweets: "bakery",
  meat: "fresh",
  fish: "fresh",
  vegetables: "fresh",
  fruits: "fresh",
  mobile: "electronics",
  mobiles: "electronics",
  service: "repair",
  beauty: "salon",
  spa: "salon",
  fitness: "gym",
  gold: "jewellery",
  jewelry: "jewellery",
  optician: "optical",
  tailor: "tailoring",
};

export function packFor(type: string | null | undefined): BusinessPack | null {
  const k = (type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!k) return null;
  if ((BUSINESS_TYPES as readonly string[]).includes(k)) return PACKS[k as BusinessType];
  const alias = ALIASES[k];
  return alias ? PACKS[alias] : null;
}

/** The pack a shop of this app gets when it never chose a business type. */
export const DEFAULT_PACK_FOR_APP: Record<AppId, BusinessType> = { BL: "grocery", EC: "fashion", PH: "pharmacy", RS: "restaurant", SV: "salon" };

export function packOrDefault(type: string | null | undefined, appId: string | null | undefined): BusinessPack {
  return packFor(type) ?? PACKS[DEFAULT_PACK_FOR_APP[(appId as AppId) ?? "EC"] ?? "fashion"];
}

/** The pack's words for a locale (Tamil falls back to English). */
export const copyFor = (pack: BusinessPack, locale: string | null | undefined): Copy => (locale === "ta" ? pack.copy.ta : pack.copy.en);
