/** Copy for "Try it on" (live camera / selfie preview of glasses and jewellery). `{name}` style placeholders via `fill`. */

const en = {
  "tryon.button": "Try it on",
  "tryon.title": "Try it on",
  "tryon.preview": "Preview",
  "tryon.previewNote": "A preview to give you an idea. Fit and size in real life can differ.",
  "tryon.intro": "See how {name} looks on you, using your phone camera.",
  "tryon.privacy": "Your camera stays on your phone. Nothing is uploaded: no video, no photo, no selfie.",
  "tryon.allow": "Use my camera",
  "tryon.selfie": "Use a selfie from my phone instead",
  "tryon.loading": "Getting ready... (a one-time download of about 4 MB)",
  "tryon.starting": "Starting the camera...",
  "tryon.noFace": "We cannot see your face. Face the camera in good light.",
  "tryon.denied": "The camera is blocked. You can allow it in your browser's settings, or use a selfie instead.",
  "tryon.noCamera": "This browser or phone cannot use the camera here. Use a selfie instead.",
  "tryon.failed": "Try-on could not start on this phone. Please try again, or use a selfie.",
  "tryon.photoFailed": "That photo could not be read. Choose another selfie.",
  "tryon.snapshot": "Take a picture",
  "tryon.retake": "Back to camera",
  "tryon.save": "Save picture",
  "tryon.share": "Share",
  "tryon.saved": "Saved on your phone only.",
  "tryon.stop": "Stop camera",
  "tryon.snapshotNote": "This picture is only on your phone. It was never uploaded.",
  "tryon.chooseSelfie": "Choose a selfie",
  "tryon.resultAlt": "Your picture with {name} on",
  "tryon.cameraLabel": "Live camera with {name} shown on your face",
  "tryon.kind.glasses": "Glasses are lined up with your eyes.",
  "tryon.kind.earrings": "Earrings are placed near your earlobes (an estimate).",
  "tryon.kind.nosepin": "The nose pin is placed on your nostril (an estimate).",
  "tryon.kind.necklace": "The necklace is placed below your chin (an estimate).",
} as const;

export type TryonText = Record<keyof typeof en, string>;

const ta: TryonText = {
  "tryon.button": "அணிந்து பார்",
  "tryon.title": "அணிந்து பார்",
  "tryon.preview": "முன்னோட்டம்",
  "tryon.previewNote": "இது ஒரு தோராய முன்னோட்டம். நேரில் பொருந்தும் விதமும் அளவும் மாறுபடலாம்.",
  "tryon.intro": "உங்கள் போன் கேமராவில் {name} உங்களுக்கு எப்படி இருக்கும் என்று பாருங்கள்.",
  "tryon.privacy": "உங்கள் கேமரா உங்கள் போனிலேயே இருக்கும். எதுவும் பதிவேற்றப்படாது: வீடியோ இல்லை, புகைப்படம் இல்லை, செல்ஃபி இல்லை.",
  "tryon.allow": "என் கேமராவைப் பயன்படுத்து",
  "tryon.selfie": "அதற்குப் பதிலாக என் போனிலிருந்து செல்ஃபி பயன்படுத்து",
  "tryon.loading": "தயாராகிறது... (ஒரு முறை மட்டும் சுமார் 4 MB பதிவிறக்கம்)",
  "tryon.starting": "கேமரா தொடங்குகிறது...",
  "tryon.noFace": "உங்கள் முகம் தெரியவில்லை. நல்ல வெளிச்சத்தில் கேமராவை நோக்குங்கள்.",
  "tryon.denied": "கேமரா தடுக்கப்பட்டுள்ளது. உலாவி அமைப்புகளில் அனுமதிக்கலாம் அல்லது செல்ஃபியைப் பயன்படுத்தலாம்.",
  "tryon.noCamera": "இந்த உலாவி அல்லது போனில் கேமராவைப் பயன்படுத்த முடியவில்லை. செல்ஃபியைப் பயன்படுத்துங்கள்.",
  "tryon.failed": "இந்த போனில் try-on தொடங்கவில்லை. மீண்டும் முயலுங்கள் அல்லது செல்ஃபியைப் பயன்படுத்துங்கள்.",
  "tryon.photoFailed": "அந்தப் புகைப்படத்தைப் படிக்க முடியவில்லை. வேறு செல்ஃபியைத் தேர்வு செய்யுங்கள்.",
  "tryon.snapshot": "படம் எடு",
  "tryon.retake": "கேமராவுக்குத் திரும்பு",
  "tryon.save": "படத்தைச் சேமி",
  "tryon.share": "பகிர்",
  "tryon.saved": "உங்கள் போனில் மட்டும் சேமிக்கப்பட்டது.",
  "tryon.stop": "கேமராவை நிறுத்து",
  "tryon.snapshotNote": "இந்தப் படம் உங்கள் போனில் மட்டுமே உள்ளது. அது ஒருபோதும் பதிவேற்றப்படவில்லை.",
  "tryon.chooseSelfie": "செல்ஃபியைத் தேர்வு செய்",
  "tryon.resultAlt": "{name} அணிந்த உங்கள் படம்",
  "tryon.cameraLabel": "உங்கள் முகத்தில் {name} காட்டும் நேரடி கேமரா",
  "tryon.kind.glasses": "கண்ணாடி உங்கள் கண்களுக்கு நேராக வைக்கப்படுகிறது.",
  "tryon.kind.earrings": "காதணிகள் காது மடல் அருகே வைக்கப்படுகின்றன (தோராயம்).",
  "tryon.kind.nosepin": "மூக்குத்தி உங்கள் மூக்கில் வைக்கப்படுகிறது (தோராயம்).",
  "tryon.kind.necklace": "கழுத்தணி உங்கள் தாடைக்குக் கீழே வைக்கப்படுகிறது (தோராயம்).",
};

export const tryonText = (locale: string | null | undefined): TryonText => (locale === "ta" ? ta : (en as TryonText));

export function fillText(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
