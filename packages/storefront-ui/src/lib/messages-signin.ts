import type { Messages } from "@rbms/i18n/client";

/** Shopper sign-in options chosen by the shop (email + password, WhatsApp). Merged into lib/messages. */
export const signInEn: Messages = {
  "auth.password": "Continue with email and password",
  "auth.viaSms": "SMS",
  "auth.viaWhatsapp": "WhatsApp",
  "auth.phoneHintWhatsapp": "We'll send a 6-digit code on WhatsApp",
  "auth.noMethods": "Sign-in isn't available right now. Please try again later.",
};

export const signInTa: Messages = {
  "auth.password": "மின்னஞ்சல் மற்றும் கடவுச்சொல்லுடன் தொடருங்கள்",
  "auth.viaSms": "SMS",
  "auth.viaWhatsapp": "WhatsApp",
  "auth.phoneHintWhatsapp": "WhatsApp-இல் 6 இலக்கக் குறியீடு அனுப்புவோம்",
  "auth.noMethods": "உள்நுழைவு இப்போது கிடைக்கவில்லை. பின்னர் முயலுங்கள்.",
};
