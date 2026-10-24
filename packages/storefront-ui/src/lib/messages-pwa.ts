import type { Messages } from "@srirealtime/i18n/client";

/**
 * Installable storefront (PWA): the install banner, the iOS "Add to Home Screen" sheet, the offline page and the
 * manifest description. Merged into lib/messages (same keys in en and ta).
 */
export const pwaEn: Messages = {
  "pwa.install.title": "Install the {name} app",
  "pwa.install.body": "Shop faster from your home screen. It takes no space and works on slow networks.",
  "pwa.install.cta": "Install",
  "pwa.install.later": "Not now",
  "pwa.install.close": "Close",
  "pwa.ios.title": "Add {name} to your home screen",
  "pwa.ios.step1": "Tap the Share button (a square with an arrow) in Safari's toolbar.",
  "pwa.ios.step2": "Scroll down and tap “Add to Home Screen”.",
  "pwa.ios.step3": "Tap “Add”. The shop opens like an app.",
  "pwa.ios.done": "Got it",
  "pwa.offline.title": "You're offline",
  "pwa.offline.body": "Check your internet connection and try again. Your cart is saved.",
  "pwa.offline.retry": "Try again",
  "pwa.description": "{name} online: browse, order and track from your home screen.",
};

export const pwaTa: Messages = {
  "pwa.install.title": "{name} செயலியை நிறுவுங்கள்",
  "pwa.install.body": "முகப்புத் திரையிலிருந்தே விரைவாக வாங்குங்கள். இடம் எடுக்காது, மெதுவான இணையத்திலும் இயங்கும்.",
  "pwa.install.cta": "நிறுவு",
  "pwa.install.later": "இப்போது வேண்டாம்",
  "pwa.install.close": "மூடு",
  "pwa.ios.title": "{name}-ஐ முகப்புத் திரையில் சேர்க்க",
  "pwa.ios.step1": "Safari கருவிப்பட்டையில் பகிர் பொத்தானை (அம்புக்குறியுடன் கூடிய சதுரம்) தட்டுங்கள்.",
  "pwa.ios.step2": "கீழே நகர்த்தி “Add to Home Screen” என்பதைத் தட்டுங்கள்.",
  "pwa.ios.step3": "“Add” தட்டுங்கள். கடை ஒரு செயலி போலத் திறக்கும்.",
  "pwa.ios.done": "சரி",
  "pwa.offline.title": "இணைய இணைப்பு இல்லை",
  "pwa.offline.body": "இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலுங்கள். உங்கள் கூடை சேமிக்கப்பட்டுள்ளது.",
  "pwa.offline.retry": "மீண்டும் முயல்க",
  "pwa.description": "{name} ஆன்லைனில்: முகப்புத் திரையிலிருந்தே பார்க்க, ஆர்டர் செய்ய, கண்காணிக்க.",
};
