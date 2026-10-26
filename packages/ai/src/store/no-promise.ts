import { claimKinds } from "../assist/safety";

/**
 * Sentences that carry a claim WORD (delivery, returns, offers...) but promise nothing, so the claims filter must not remove them:
 * "I do not have that information", "please contact the shop about returns", "I cannot give discount codes", "prices are as shown
 * on the store", "I can help you with delivery and payment questions". They never contain a number. A sentence that states a
 * promise ("free delivery", "10% off") is not one of these and still goes through the filter.
 */
const NEG_INFO = /\b(?:don'?t|do not|doesn'?t|does not|haven'?t|have not|has not|hasn'?t|no)\b[^.!?]{0,40}\b(?:information|details|policy|stated|set|shared)\b|தகவல்[^.]{0,20}இல்லை/i;
const CONTACT = /\b(?:contact|talk to|ask|speak to|message|reach)\b[^.!?]{0,20}\bthe shop\b|கடையிடம்|கடையினரிடம்|கடையைத் தொடர்பு/i;
const REFUSAL = /\bI(?:'m| am)? ?(?:can'?t|cannot|can not|unable|not able|won'?t|not allowed)\b|என்னால்[^.!?]{0,60}முடியாது/i;
const CAPABILITY = /^\s*(?:i can (?:help|check|look|find|answer|show)|i'?m here to|i am here to|i can only)|நான் (?:உதவ|உங்களுக்கு உதவ)/i;
const SHOWN = /\bas (?:shown|listed|displayed) (?:on|in) the (?:store|shop|website)|கடையில் காட்டப்படும்/i;
const PROMISE_WORDS = /\bfree\b|%|\bcheap\b|\bguarantee|\bwarranty\b|இலவச|தள்ளுபடி/i;

export function promisesNothing(sentence: string): boolean {
  if (/\d/.test(sentence)) return false;
  if (REFUSAL.test(sentence) || NEG_INFO.test(sentence)) return true;
  if (PROMISE_WORDS.test(sentence)) return false;
  return CONTACT.test(sentence) || CAPABILITY.test(sentence) || SHOWN.test(sentence) || claimKinds(sentence).length === 0;
}
