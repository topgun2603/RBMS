import type { Bi } from "./types";

/** Example requests the panel offers (real things Studio can do). A few more for the shop's trade come first. */
const COMMON: Bi[] = [
  { en: "Show the offers section above the categories on my home page", ta: "என் முகப்புப் பக்கத்தில் சலுகைகள் பகுதியை வகைகளுக்கு மேலே காட்டு" },
  { en: "Make the store theme a darker green", ta: "கடையின் தீமை அடர் பச்சை நிறமாக மாற்று" },
  { en: "Add a WhatsApp button to the store, my number is 9876543210", ta: "கடையில் WhatsApp பொத்தானைச் சேர், என் எண் 9876543210" },
  { en: "Cashiers must not give more than 5% discount", ta: "காசாளர்கள் 5%-க்கு மேல் தள்ளுபடி தரக்கூடாது" },
  { en: "Add a Pongal festive look to my store", ta: "பொங்கலுக்கு என் கடையின் முகப்புப் பக்கத்தை மாற்று" },
  { en: "Print my business name and GSTIN on the top of the receipt", ta: "ரசீதின் மேலே என் வணிகப் பெயர், GSTIN அச்சிடு" },
];

const BY_TRADE: Record<string, Bi[]> = {
  fashion: [{ en: "Give my store a premium look for a silk saree shop", ta: "பட்டுச் சேலைக் கடைக்கு பிரீமியம் தோற்றம் கொடு" }],
  jewellery: [{ en: "Add a gold rates board to my home page", ta: "என் முகப்புப் பக்கத்தில் தங்க விலைப் பலகையைச் சேர்" }],
  restaurant: [{ en: "Turn on pickup and add a pickup note", ta: "பிக்கப் வசதியை இயக்கி குறிப்பு சேர்" }],
  grocery: [{ en: "Set a minimum order of 300 rupees", ta: "குறைந்தபட்ச ஆர்டர் 300 ரூபாய் வை" }],
};

export function studioSuggestions(trade: string | null | undefined): Bi[] {
  return [...(BY_TRADE[(trade ?? "").toLowerCase()] ?? []), ...COMMON].slice(0, 8);
}
