import type { AiFeatureInfo } from "../features";

/** Registry entries of Phase 5 part A (the counter helpers). Spread into AI_FEATURE_REGISTRY (features.ts). */
export const VOICE_FEATURE_KEY = "voice-billing";
export const ALERTS_FEATURE = "activity-alerts";
export const COACHING_FEATURE_KEY = "staff-coaching";
export const SHIFTS_FEATURE = "shift-planning";

export const COUNTER_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: VOICE_FEATURE_KEY,
    status: "live",
    tier: "light",
    label: "Voice billing at the counter",
    labelTa: "கவுண்டரில் குரல் பில்லிங்",
    description:
      "In the POS search bar, tap the mic and say the order in Tamil, Tanglish or English (\"ரெண்டு கிலோ பொன்னி அரிசி, ஒரு நல்லெண்ணெய், அரை கிலோ துவரம் பருப்பு\"). The software reads the quantities and units itself and finds your items by name, Tamil name and search words; AI helps only with words it could not match, choosing from your own item list (about 1 credit, usually none). You see every line with its price and confirm; nothing is billed by itself. Needs the POS and permission to create bills and use AI helpers.",
    descriptionTa:
      "POS தேடல் பெட்டியில் மைக்கைத் தட்டி, ஆர்டரை தமிழ், தங்கிலிஷ் அல்லது ஆங்கிலத்தில் சொல்லுங்கள் (\"ரெண்டு கிலோ பொன்னி அரிசி, ஒரு நல்லெண்ணெய், அரை கிலோ துவரம் பருப்பு\"). அளவுகளையும் அலகுகளையும் மென்பொருளே படிக்கும்; உங்கள் பொருட்களை பெயர், தமிழ்ப் பெயர், தேடல் சொற்கள் மூலம் கண்டுபிடிக்கும்; பொருந்தாத சொற்களுக்கு மட்டும் AI உங்கள் சொந்த பொருள் பட்டியலிலிருந்து தேர்வு செய்யும் (சுமார் 1 கிரெடிட், பெரும்பாலும் இல்லை). ஒவ்வொரு வரியையும் விலையுடன் பார்த்து நீங்கள் உறுதி செய்வீர்கள்; தானாக எதுவும் பில் ஆகாது. POS மற்றும் பில் உருவாக்க, AI உதவியாளர்களைப் பயன்படுத்த அனுமதி தேவை.",
  },
  {
    key: ALERTS_FEATURE,
    status: "live",
    tier: "light",
    label: "Unusual-activity alerts (no AI, no credits)",
    labelTa: "வழக்கத்துக்கு மாறான செயல்பாடு எச்சரிக்கைகள் (AI இல்லை, கிரெடிட் இல்லை)",
    description:
      "Every day the software compares each cashier's cancelled bills, returns, discounts (also after 9 pm), price changes, no-sale drawer opens and till differences with that person's own last 60 days, and lists what is far from usual, with the bills to look at. It uses fixed rules on your own numbers, only for owners and managers, and says \"worth a look\", never that someone did wrong. Quiet days never alert. You can mark each alert as looked at and add the top ones to the daily summary.",
    descriptionTa:
      "தினமும் ஒவ்வொரு காசாளரின் ரத்தான பில்கள், திருப்பங்கள், தள்ளுபடிகள் (இரவு 9 மணிக்குப் பிறகும்), விலை மாற்றங்கள், விற்பனை இல்லாத டிராயர் திறப்புகள், கல்லா வேறுபாடுகளை அந்த நபரின் சொந்த கடந்த 60 நாட்களுடன் மென்பொருள் ஒப்பிட்டு, வழக்கத்தை விட மிகவும் மாறுபட்டதை, பார்க்க வேண்டிய பில்களுடன் பட்டியலிடும். உங்கள் சொந்த எண்களில் நிலையான விதிகள்; உரிமையாளர், மேலாளருக்கு மட்டும்; \"ஒரு முறை பார்க்கலாம்\" என்றே சொல்லும், யாரும் தவறு செய்ததாகச் சொல்லாது. அமைதியான நாட்களில் எச்சரிக்கை வராது. ஒவ்வொன்றையும் பார்த்ததாகக் குறிக்கலாம்; முக்கியவற்றை தினசரி சுருக்கத்தில் சேர்க்கலாம்.",
  },
  {
    key: COACHING_FEATURE_KEY,
    status: "live",
    tier: "light",
    label: "Weekly staff coaching notes",
    labelTa: "வாராந்திர பணியாளர் ஆலோசனைக் குறிப்புகள்",
    description:
      "Each week, for each cashier, the software counts bills, average bill, items per bill, busiest hours and compares with the shop's average; AI then writes two or three constructive sentences in Tamil or English from those facts (about 1 credit a person). Every number is checked against the facts, and notes that judge the person are replaced with plain wording. Only owners and managers see them; you can copy a note to share with that person.",
    descriptionTa:
      "ஒவ்வொரு வாரமும் ஒவ்வொரு காசாளருக்கும் பில்கள், சராசரி பில், ஒரு பில்லுக்கு பொருட்கள், பரபரப்பான நேரங்களை மென்பொருள் எண்ணி கடை சராசரியுடன் ஒப்பிடும்; பிறகு அந்த உண்மைகளிலிருந்து AI தமிழிலோ ஆங்கிலத்திலோ இரண்டு அல்லது மூன்று ஆக்கபூர்வமான வாக்கியங்களை எழுதும் (ஒருவருக்கு சுமார் 1 கிரெடிட்). ஒவ்வொரு எண்ணும் உண்மைகளுடன் சரிபார்க்கப்படும்; நபரை மதிப்பிடும் குறிப்புகள் எளிய சொற்களால் மாற்றப்படும். உரிமையாளர், மேலாளருக்கு மட்டும் தெரியும்; குறிப்பை நகலெடுத்து அந்த நபருடன் பகிரலாம்.",
  },
  {
    key: SHIFTS_FEATURE,
    status: "live",
    tier: "light",
    label: "Shift planning (no AI, no credits)",
    labelTa: "ஷிப்ட் திட்டமிடல் (AI இல்லை, கிரெடிட் இல்லை)",
    description:
      "From your last 8 weeks of bills per hour and weekday, plus festival shopping weeks, the software suggests how many people to have in each hour of next week, using how many bills one person usually handles in an hour at your shop (you can change it). A simple week grid you can copy or print; nothing is scheduled for you.",
    descriptionTa:
      "கடந்த 8 வாரங்களின் மணி நேர, கிழமை வாரியான பில்கள் மற்றும் பண்டிகை கால ஷாப்பிங் வாரங்களை வைத்து, அடுத்த வாரத்தின் ஒவ்வொரு மணி நேரத்திலும் எத்தனை பேர் இருக்க வேண்டும் என்று மென்பொருள் பரிந்துரைக்கும்; உங்கள் கடையில் ஒருவர் மணிக்கு சராசரியாக கையாளும் பில்களை அடிப்படையாகக் கொள்ளும் (மாற்றலாம்). நகலெடுக்க அல்லது அச்சிட எளிய வாரக் கட்டம்; உங்களுக்காக எதுவும் திட்டமிடப்படாது.",
  },
];
