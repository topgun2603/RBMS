import type { AiFeatureInfo } from "../features";

/** Phase 7 part A (docs/ai.md): the shop setup assistant for new owners. */
export const ONBOARDING_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: "onboarding-assistant",
    status: "live",
    tier: "light",
    label: "Shop setup assistant",
    labelTa: "கடை அமைப்பு உதவியாளர்",
    description:
      "Five questions about your shop, typed or spoken in Tamil or English; then your type of business, product groups, store look and home page are set up for you to check and apply, with undo (about 1 credit). It never makes up facts about your shop. With AI off it still works with simple rules, for free.",
    descriptionTa:
      "உங்கள் கடையைப் பற்றி ஐந்து கேள்விகள், தமிழிலோ ஆங்கிலத்திலோ தட்டச்சு செய்யலாம் அல்லது பேசலாம்; பிறகு உங்கள் வணிக வகை, பொருள் வகைகள், கடைத் தோற்றம், முகப்புப் பக்கம் அமைக்கப்பட்டு நீங்கள் பார்த்து பயன்படுத்தலாம், Undo செய்யலாம் (சுமார் 1 கிரெடிட்). உங்கள் கடையைப் பற்றி இல்லாத தகவல்களை எழுதாது. AI நிறுத்தத்தில் இருந்தாலும் எளிய விதிகளுடன் இலவசமாக வேலை செய்யும்.",
  },
];
