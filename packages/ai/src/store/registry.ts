import type { AiFeatureInfo } from "../features";

/** Registry entries of Phase 4 part B (the store features). Spread into AI_FEATURE_REGISTRY (features.ts). */
export const STORE_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: "shopper-chat",
    status: "live",
    tier: "light",
    optIn: true,
    label: "Shopper chat assistant (online store)",
    labelTa: "வாடிக்கையாளர் அரட்டை உதவியாளர் (ஆன்லைன் கடை)",
    description:
      "Adds an AI mode to the chat on your online store. Shoppers ask in Tamil, Tanglish or English about products, prices, stock, your delivery, pickup, payment and return information, and the status of their own orders. It answers only from your store's data, never invents policies, discounts or delivery promises, and hands over to you with \"Talk to the shop\". Your credits pay for it, up to a daily limit you set (default 300 credits a day); when the limit is reached the chat quietly goes back to you. Off until you switch it on here. Needs the shop's chat on.",
    descriptionTa:
      "உங்கள் ஆன்லைன் கடையின் அரட்டையில் AI முறையைச் சேர்க்கும். வாடிக்கையாளர்கள் தமிழ், தங்கிலிஷ் அல்லது ஆங்கிலத்தில் பொருட்கள், விலை, இருப்பு, உங்கள் டெலிவரி, பிக்அப், பணம் செலுத்துதல், திருப்பி அனுப்புதல் தகவல்கள், தங்கள் சொந்த ஆர்டர்களின் நிலை பற்றிக் கேட்கலாம். உங்கள் கடையின் தரவிலிருந்து மட்டுமே பதிலளிக்கும்; கொள்கைகள், தள்ளுபடிகள், டெலிவரி வாக்குறுதிகளை உருவாக்காது; \"கடையிடம் பேசுங்கள்\" மூலம் உங்களிடம் ஒப்படைக்கும். உங்கள் கிரெடிட்கள் செலவாகும், நீங்கள் அமைக்கும் தினசரி வரம்பு வரை (இயல்பாக நாளுக்கு 300 கிரெடிட்); வரம்பு தீர்ந்ததும் அரட்டை அமைதியாக உங்களிடம் திரும்பும். இங்கே நீங்கள் இயக்கும் வரை அணைந்திருக்கும். கடையின் அரட்டை இயக்கத்தில் இருக்க வேண்டும்.",
  },
  {
    key: "search-aliases",
    status: "live",
    tier: "light",
    label: "Search words for products (Tamil, Tanglish, spellings)",
    labelTa: "பொருட்களுக்கான தேடல் சொற்கள் (தமிழ், தங்கிலிஷ், எழுத்துப்பிழைகள்)",
    description:
      "When you save a product, writes its search words once: the Tamil name, Tanglish spellings (thakkali, takkali), English equivalents and common misspellings, so shoppers find it however they type. Searching costs nothing afterwards. You can see and edit the words on the product, and run it for the products you already have (about 2 credits a product).",
    descriptionTa:
      "ஒரு பொருளைச் சேமிக்கும்போது அதன் தேடல் சொற்களை ஒரு முறை எழுதும்: தமிழ் பெயர், தங்கிலிஷ் எழுத்துக்கூட்டல்கள் (thakkali, takkali), ஆங்கிலச் சமமான சொற்கள், பொதுவான எழுத்துப்பிழைகள்; வாடிக்கையாளர்கள் எப்படித் தட்டச்சு செய்தாலும் கண்டுபிடிப்பார்கள். அதன் பிறகு தேடலுக்குச் செலவு இல்லை. பொருளில் அந்தச் சொற்களைப் பார்க்கவும் திருத்தவும் முடியும்; ஏற்கனவே உள்ள பொருட்களுக்கும் இயக்கலாம் (ஒரு பொருளுக்கு சுமார் 2 கிரெடிட்).",
  },
  {
    key: "bought-together",
    status: "live",
    tier: "light",
    label: "Often bought together (no AI, no credits)",
    labelTa: "பொதுவாக சேர்த்து வாங்குவது (AI இல்லை, கிரெடிட் இல்லை)",
    description:
      "Every day, counts which items are bought in the same bill or order (last 180 days) and shows \"Often bought together\" with a combo add-to-cart on the store's product page and \"customers also buy\" chips in the POS cart, only for items in stock. Worked out by the software from your own sales; no AI model is called and no credits are used.",
    descriptionTa:
      "தினமும் ஒரே பில் அல்லது ஆர்டரில் (கடந்த 180 நாட்கள்) எந்தப் பொருட்கள் சேர்ந்து வாங்கப்படுகின்றன என்று கணக்கிட்டு, கடையின் பொருள் பக்கத்தில் காம்போ சேர்ப்புடன் \"பொதுவாக சேர்த்து வாங்குவது\" என்றும், POS கூடையில் \"வாடிக்கையாளர்கள் இதையும் வாங்குவார்கள்\" என்றும் காட்டும்; இருப்பிலுள்ள பொருட்களுக்கு மட்டும். உங்கள் சொந்த விற்பனையிலிருந்து மென்பொருளே கணக்கிடும்; AI மாடல் அழைக்கப்படாது, கிரெடிட் செலவாகாது.",
  },
  {
    key: "pricing-hints",
    status: "live",
    tier: "light",
    label: "Pricing hints",
    labelTa: "விலை குறிப்புகள்",
    description:
      "Looks at items whose price changed in the last 180 days and compares how fast they sold before and after (same length of time, corrected for how the whole shop sold), with the margin before and after. Flags items that are still selling well after a rise, items that slowed after the last increase, and strong sellers that may have room for a small increase, only when there are enough sales to be clear. All figures are worked out by the software; the AI writes one plain sentence per item (about 1 credit for a dozen items). It never changes a price.",
    descriptionTa:
      "கடந்த 180 நாட்களில் விலை மாறிய பொருட்களைப் பார்த்து, மாற்றத்துக்கு முன்னும் பின்னும் அவை எவ்வளவு வேகமாக விற்றன என்று ஒப்பிடும் (அதே கால அளவு, முழு கடையின் விற்பனைப் போக்கைக் கணக்கில் கொண்டு), மேலும் முன்/பின் லாப விகிதம். விலை உயர்வுக்குப் பிறகும் நன்றாக விற்கும் பொருட்கள், கடைசி உயர்வுக்குப் பிறகு மெதுவான பொருட்கள், சிறிய உயர்வுக்கு இடமிருக்கக்கூடிய வேகமாக விற்கும் பொருட்கள் ஆகியவற்றைக் குறிக்கும்; தெளிவான அளவு விற்பனை இருந்தால் மட்டும். எல்லா எண்களையும் மென்பொருளே கணக்கிடும்; AI ஒவ்வொரு பொருளுக்கும் ஒரு எளிய வாக்கியம் எழுதும் (ஒரு டஜன் பொருட்களுக்கு சுமார் 1 கிரெடிட்). விலையை ஒருபோதும் மாற்றாது.",
  },
  {
    key: "social-posts",
    status: "live",
    tier: "light",
    label: "Social posts for new arrivals",
    labelTa: "புதிய வரவுகளுக்கான சமூக ஊடகப் பதிவுகள்",
    description:
      "For a product (or this week's new arrivals), writes Instagram and WhatsApp Status captions in English and Tamil with hashtags, from the product's facts and your shop name only (no invented offers), and makes a ready-to-share square image with the product photo, shop name and logo, price and title in your theme colours (about 1 credit). You download or share it; nothing is posted for you.",
    descriptionTa:
      "ஒரு பொருளுக்கு (அல்லது இந்த வார புதிய வரவுகளுக்கு), பொருளின் தகவல்கள் மற்றும் உங்கள் கடையின் பெயரிலிருந்து மட்டும் (சலுகைகளை உருவாக்காமல்) ஆங்கிலத்திலும் தமிழிலும் Instagram மற்றும் WhatsApp Status தலைப்புகளையும் ஹேஷ்டேக்குகளையும் எழுதி, பொருள் புகைப்படம், கடையின் பெயர் மற்றும் லோகோ, விலை, தலைப்புடன் உங்கள் தீம் நிறங்களில் பகிரத் தயாரான சதுரப் படத்தையும் உருவாக்கும் (சுமார் 1 கிரெடிட்). நீங்கள் பதிவிறக்கலாம் அல்லது பகிரலாம்; உங்களுக்காக எதுவும் பதிவிடப்படாது.",
  },
];
