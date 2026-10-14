import type { Messages } from "../client";

export const en = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.search": "Search",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.yes": "Yes",
  "common.no": "No",
  "common.back": "Back",
  "common.next": "Next",
  "common.done": "Done",
  "common.itemCount": "{count, plural, =0 {No items} one {# item} other {# items}}",

  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.enterPhone": "Enter your mobile number",
  "auth.enterEmail": "Enter your email address",
  "auth.sendOtp": "Send OTP",
  "auth.verifyOtp": "Verify OTP",
  "auth.otpSentTo": "We sent a code to {target}",
  "auth.invalidOtp": "That code is incorrect or has expired. Please try again.",
  "auth.continueWithGoogle": "Continue with Google",

  "errors.generic": "Something went wrong. Please try again.",
  "errors.network": "Network problem. Please check your connection.",
  "errors.unauthorized": "Please sign in to continue.",
  "errors.forbidden": "You don't have permission to do this.",
  "errors.notFound": "We couldn't find what you were looking for.",
  "errors.planLimit": "You've reached your plan's limit. Upgrade your plan to continue.",

  "notify.otpSms": "{code} is your {app} verification code. It expires in {minutes} minutes.",

  "consent.title": "Privacy and consent",
  "consent.accept": "I agree",
  "consent.decline": "I don't agree",
  "consent.withdraw": "Withdraw consent",
  "consent.privacyPolicy": "Privacy policy",
  "consent.terms": "Terms and conditions",
  "consent.agreeToTerms": "By continuing, you agree to our {terms} and {privacy}.",
  "consent.marketing": "Send me offers and updates",

  "settings.title": "Settings",
  "settings.saved": "Settings saved",
  "settings.language": "Language",
  "settings.notifications": "Notifications",
  "settings.theme": "Appearance",
  "settings.profile": "Profile",
  "settings.resetToDefault": "Reset to default",
} satisfies Messages;

export type MessageKey = keyof typeof en;
