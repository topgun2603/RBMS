/**
 * Labels of the live preview (EN/TA). Self-contained for now; to merge into lib/messages.ts, add these under
 * `site.live.*` and switch `useLiveMessages` to `useI18n().t`.
 */
export const liveEn = {
  label: "Live preview",
  device: "Preview size",
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  reload: "Reload preview",
  openTab: "Open in new tab",
  loading: "Opening your store…",
  error: "Couldn't open the store preview.",
  errorExpired: "The preview link expired.",
  errorDraft: "Couldn't show your latest change. It will appear when you save.",
  errorVersion: "The store needs a refresh to show the live preview.",
  errorNoStore: "Your store address isn't set up yet.",
  retry: "Try again",
  updated: "Updated in {ms} ms",
  live: "Live — unsaved changes show instantly",
  frameTitle: "Your store, live preview",
} as const;

export type LiveKey = keyof typeof liveEn;

export const liveTa: Record<LiveKey, string> = {
  label: "நேரடி முன்னோட்டம்",
  device: "முன்னோட்ட அளவு",
  phone: "கைபேசி",
  tablet: "டேப்லெட்",
  desktop: "கணினி",
  reload: "முன்னோட்டத்தை மீண்டும் ஏற்று",
  openTab: "புதிய தாவலில் திற",
  loading: "உங்கள் கடை திறக்கப்படுகிறது…",
  error: "கடை முன்னோட்டத்தைத் திறக்க முடியவில்லை.",
  errorExpired: "முன்னோட்ட இணைப்பு காலாவதியானது.",
  errorDraft: "உங்கள் சமீபத்திய மாற்றத்தைக் காட்ட முடியவில்லை. சேமித்ததும் தெரியும்.",
  errorVersion: "நேரடி முன்னோட்டத்தைக் காட்ட கடையைப் புதுப்பிக்க வேண்டும்.",
  errorNoStore: "உங்கள் கடை முகவரி இன்னும் அமைக்கப்படவில்லை.",
  retry: "மீண்டும் முயல்க",
  updated: "{ms} மி.வி.யில் புதுப்பிக்கப்பட்டது",
  live: "நேரடி — சேமிக்காத மாற்றங்கள் உடனே தெரியும்",
  frameTitle: "உங்கள் கடை, நேரடி முன்னோட்டம்",
};

export function liveMessages(locale: string) {
  const dict = locale === "ta" ? liveTa : liveEn;
  return (key: LiveKey, vars?: Record<string, string | number>) => dict[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
}
