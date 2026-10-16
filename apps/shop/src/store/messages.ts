import type { Messages } from "@srirealtime/web";

/** store.* strings for the demo store module. Keep en and ta key sets identical. */
const en: Messages = {
  "store.nav.title": "Store",
  "store.nav.dashboard": "Dashboard",
  "store.nav.home": "Home",
  "store.nav.products": "Products",
  "store.nav.orders": "Orders",

  "store.products.title": "Products",
  "store.products.subtitle": "Your online catalogue",
  "store.orders.title": "Orders",
  "store.orders.subtitle": "Orders placed in your online store",
  "store.placeholder.title": "Coming with the {module} module",
  "store.placeholder.body":
    "This page is a placeholder in the demo store. The {module} module will mount here the same way billing is mounted at /billing, with its own pages, features and dashboard cards.",
  "store.placeholder.catalogue": "catalogue",
  "store.placeholder.orders": "orders",
  "store.placeholder.openBilling": "Open billing",
};

const ta: Messages = {
  "store.nav.title": "கடை",
  "store.nav.dashboard": "முகப்பு",
  "store.nav.home": "முகப்பு",
  "store.nav.products": "பொருட்கள்",
  "store.nav.orders": "ஆர்டர்கள்",

  "store.products.title": "பொருட்கள்",
  "store.products.subtitle": "உங்கள் ஆன்லைன் பட்டியல்",
  "store.orders.title": "ஆர்டர்கள்",
  "store.orders.subtitle": "உங்கள் ஆன்லைன் கடையில் வந்த ஆர்டர்கள்",
  "store.placeholder.title": "{module} தொகுதியுடன் வரும்",
  "store.placeholder.body":
    "இது டெமோ கடையில் ஒரு தற்காலிகப் பக்கம். பில்லிங் /billing-இல் இணைக்கப்பட்டது போலவே {module} தொகுதி தன் பக்கங்கள், வசதிகள், முகப்பு அட்டைகளுடன் இங்கே இணைக்கப்படும்.",
  "store.placeholder.catalogue": "பொருள் பட்டியல்",
  "store.placeholder.orders": "ஆர்டர்கள்",
  "store.placeholder.openBilling": "பில்லிங்கைத் திற",
};

export const storeMessages = { en, ta } as const;
