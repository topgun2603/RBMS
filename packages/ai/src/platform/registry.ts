import type { AiFeatureInfo } from "../features";

/**
 * Registry entries of Phase 7 part B (platform tools of the RBMS team). Spread into AI_FEATURE_REGISTRY (features.ts).
 * `platform: true`: they run on the platform's own account (`ai.run({ platform: true, tenantId: PLATFORM_TENANT_ID })`),
 * are never listed in a shop's Settings > AI and never spend a shop's credits. Churn signals call no model and are not here.
 */
export const TRIAGE_FEATURE = "support-triage";
export const RELEASE_NOTES_FEATURE = "release-notes";

export const PLATFORM_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: TRIAGE_FEATURE,
    status: "live",
    tier: "light",
    platform: true,
    label: "Support ticket triage (RBMS team)",
    labelTa: "ஆதரவுக் கோரிக்கை வகைப்படுத்தல் (RBMS குழு)",
    description:
      "For the RBMS support inbox: sorts each new ticket from a shop (topic, urgency, language) and drafts a reply from the user guides, citing the section. A person reads and sends it. Runs on the platform's account, about 1 credit a ticket.",
    descriptionTa:
      "RBMS ஆதரவு இன்பாக்ஸுக்கு: கடையிலிருந்து வரும் ஒவ்வொரு புதிய கோரிக்கையையும் வகைப்படுத்தி (தலைப்பு, அவசரம், மொழி), பயனர் கையேட்டிலிருந்து பதில் வரைவை, பகுதியைக் குறிப்பிட்டு எழுதும். ஒருவர் படித்த பிறகே அனுப்பப்படும். தளத்தின் கணக்கில் இயங்கும், ஒரு கோரிக்கைக்கு சுமார் 1 கிரெடிட்.",
  },
  {
    key: RELEASE_NOTES_FEATURE,
    status: "live",
    tier: "light",
    platform: true,
    label: "What's new notes (RBMS team)",
    labelTa: "புதியவை குறிப்புகள் (RBMS குழு)",
    description:
      "For the RBMS team: turns a list of changes into short, plain notes for shop owners in English and Tamil, grouped by app and trade. The team edits and publishes them. Runs on the platform's account.",
    descriptionTa:
      "RBMS குழுவுக்கு: மாற்றங்களின் பட்டியலை கடை உரிமையாளர்களுக்கான சுருக்கமான, எளிய குறிப்புகளாக ஆங்கிலத்திலும் தமிழிலும், செயலி மற்றும் தொழில் வாரியாக எழுதும். குழு திருத்தி வெளியிடும். தளத்தின் கணக்கில் இயங்கும்.",
  },
];
