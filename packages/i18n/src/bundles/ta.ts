import type { Messages } from "../client";
import type { MessageKey } from "./en";

export const ta = {
  "common.save": "சேமி",
  "common.cancel": "ரத்துசெய்",
  "common.delete": "நீக்கு",
  "common.edit": "திருத்து",
  "common.search": "தேடு",
  "common.loading": "ஏற்றுகிறது…",
  "common.retry": "மீண்டும் முயற்சி செய்",
  "common.yes": "ஆம்",
  "common.no": "இல்லை",
  "common.back": "பின்செல்",
  "common.next": "அடுத்து",
  "common.done": "முடிந்தது",
  "common.itemCount": "{count, plural, =0 {உருப்படிகள் இல்லை} one {# உருப்படி} other {# உருப்படிகள்}}",

  "auth.signIn": "உள்நுழை",
  "auth.signOut": "வெளியேறு",
  "auth.enterPhone": "உங்கள் கைப்பேசி எண்ணை உள்ளிடவும்",
  "auth.enterEmail": "உங்கள் மின்னஞ்சல் முகவரியை உள்ளிடவும்",
  "auth.sendOtp": "OTP அனுப்பு",
  "auth.verifyOtp": "OTP-ஐச் சரிபார்",
  "auth.otpSentTo": "{target} க்குக் குறியீடு அனுப்பப்பட்டது",
  "auth.invalidOtp": "குறியீடு தவறானது அல்லது காலாவதியாகிவிட்டது. மீண்டும் முயற்சிக்கவும்.",
  "auth.continueWithGoogle": "Google மூலம் தொடரவும்",

  "errors.generic": "ஏதோ தவறு நடந்துவிட்டது. மீண்டும் முயற்சிக்கவும்.",
  "errors.network": "இணைய இணைப்பில் சிக்கல். உங்கள் இணைப்பைச் சரிபார்க்கவும்.",
  "errors.unauthorized": "தொடர உள்நுழையவும்.",
  "errors.forbidden": "இதைச் செய்ய உங்களுக்கு அனுமதி இல்லை.",
  "errors.notFound": "நீங்கள் தேடியது கிடைக்கவில்லை.",
  "errors.planLimit": "உங்கள் திட்டத்தின் வரம்பை அடைந்துவிட்டீர்கள். தொடர உங்கள் திட்டத்தை மேம்படுத்தவும்.",

  "notify.otpSms": "{code} என்பது உங்கள் {app} சரிபார்ப்புக் குறியீடு. இது {minutes} நிமிடங்களில் காலாவதியாகும்.",

  "consent.title": "தனியுரிமை மற்றும் ஒப்புதல்",
  "consent.accept": "ஒப்புக்கொள்கிறேன்",
  "consent.decline": "ஒப்புக்கொள்ளவில்லை",
  "consent.withdraw": "ஒப்புதலைத் திரும்பப் பெறு",
  "consent.privacyPolicy": "தனியுரிமைக் கொள்கை",
  "consent.terms": "விதிமுறைகள் மற்றும் நிபந்தனைகள்",
  "consent.agreeToTerms": "தொடர்வதன் மூலம், எங்கள் {terms} மற்றும் {privacy} ஆகியவற்றை ஏற்கிறீர்கள்.",
  "consent.marketing": "சலுகைகள் மற்றும் புதிய தகவல்களை எனக்கு அனுப்பவும்",

  "settings.title": "அமைப்புகள்",
  "settings.saved": "அமைப்புகள் சேமிக்கப்பட்டன",
  "settings.language": "மொழி",
  "settings.notifications": "அறிவிப்புகள்",
  "settings.theme": "தோற்றம்",
  "settings.profile": "சுயவிவரம்",
  "settings.resetToDefault": "இயல்புநிலைக்கு மீட்டமை",
} satisfies Messages & Partial<Record<MessageKey, string>>;
