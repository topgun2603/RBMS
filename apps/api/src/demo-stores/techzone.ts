import type { DemoProduct, DemoStore } from "./types";

/**
 * TechZone Mobiles, 52 Cross Cut Road, Coimbatore (techzone.localhost:3003): electronics and mobiles on the online store
 * app (EC) with the `electronics` trade (serial numbers / IMEI + warranty on). Unlike Kaipesi (accessories only), this is
 * the whole shop: smartphones with dual-IMEI units, laptops, tablets, smart TVs, refrigerators, washing machines and air
 * conditioners (with installation), audio, smartwatches and kitchen appliances. Names are generic (no makers' brands).
 * The shop was already one of the demo shops (seed.ts): this file turns it into a demo store of the series. Address,
 * phone, GSTIN and every offer are demo placeholders. The look is `big-box` (theme-presets-techzone.ts).
 *
 * GST: everything is 18%. From 22 Sept 2025 (Notification No. 9/2025-Central Tax (Rate) of 17 Sept 2025 and the matching
 * IGST / UTGST notifications, from the 56th GST Council meeting of 3-4 Sept 2025) air conditioners (8415), televisions
 * (8528 72, every size: the 28% above 32 inches is gone) and dishwashers (8422 11) moved from 28% to 18%. Refrigerators
 * (8418), washing machines (8450), vacuum cleaners and microwave ovens (8508, 8516) are 18% too; mobile phones (8517 13),
 * laptops and tablets (8471), smartwatches (8517 62), headphones and speakers (8518), projectors (8528 69) and water
 * purifiers (8421 21) were 18% before and after. Installation and set-up labour is SAC 9987 (maintenance and repair
 * services), 18%. Sources checked 23 Oct 2026: https://cleartax.in/s/gst-on-electronics (rate table) and
 * https://www.motilaloswal.com/personal-finance/tax/gst-on-electronics-2025-new-18-rates-price-impact (ACs, TVs,
 * dishwashers, 28% to 18%). Uncertain, check before invoicing for real: the 8-digit tariff lines (8528 72 19 for TVs,
 * 8415 10 10 window / 8415 10 90 split ACs, 8450 11 / 8450 12 washers, 8518 21 / 8518 22 speakers) and the SAC sub-code
 * 998719 used for installation.
 */

const rs = (rupees: number) => Math.round(rupees * 100);
const PHONE = "+919876500009";
const WHATSAPP = "919876500009";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** Variants of one option: [value, price ₹, MRP ₹, stock]. */
function one(option: string, rows: [string, number, number, number][]): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [{ name: option, values: rows.map((r) => r[0]) }],
    variants: rows.map(([value, price, mrp, stock]) => ({ values: { [option]: value }, price: rs(price), mrp: rs(mrp), stock })),
  };
}

/** Variants of two options (every combination), priced by the first option; stock per combination. */
function two(a: string, aRows: [string, number, number][], b: string, bValues: string[], stock: number): Pick<DemoProduct, "options" | "variants"> {
  return {
    options: [
      { name: a, values: aRows.map((r) => r[0]) },
      { name: b, values: bValues },
    ],
    variants: aRows.flatMap(([av, price, mrp]) => bValues.map((bv) => ({ values: { [a]: av, [b]: bv }, price: rs(price), mrp: rs(mrp), stock }))),
  };
}

/** One variant, no options: [price ₹, MRP ₹, stock]. */
const single = (price: number, mrp: number, stock: number): Pick<DemoProduct, "variants"> => ({ variants: [{ price: rs(price), mrp: rs(mrp), stock }] });

const PHONES = "Smartphones";
const LAPTOPS = "Laptops";
const TABLETS = "Tablets";
const TVS = "Smart TVs & projectors";
const FRIDGES = "Refrigerators";
const WASHERS = "Washing machines";
const ACS = "Air conditioners";
const AUDIO = "Audio";
const WATCHES = "Smartwatches & bands";
const HOME = "Kitchen & home appliances";
const SERVICES = "Installation & set-up";

/** Serial / IMEI tracking per product (the history simulator and the seed read it): warranty months from the bill date, dual IMEI. */
export const TECHZONE_SERIALS: Record<string, { months: number; dualImei?: boolean }> = {};
const serial = (months: number, dualImei = false) => ({ months, dualImei });

type P = Omit<DemoProduct, "sku" | "unit" | "gstRate" | "hsn" | "tags" | "attributes"> & { serial?: { months: number; dualImei: boolean }; tags?: string[]; attributes?: Record<string, string>; unit?: string };
const mk = (sku: string, hsn: string, p: P): DemoProduct => {
  const { serial: s, ...rest } = p;
  if (s) TECHZONE_SERIALS[p.name] = { months: s.months, ...(s.dualImei ? { dualImei: true } : {}) };
  return { sku, hsn, gstRate: 18, unit: p.unit ?? "pcs", ...rest, tags: [...(s ? ["serial"] : []), ...(p.tags ?? [])] };
};

const PHONE_NOTE =
  "\n\n**Genuine, GST-billed, IMEI-registered.** The IMEI of the phone you buy is printed on your bill and its warranty starts from the bill date: look it up any time on the Warranty page. Bring your old phone to the counter and we'll value it against this one (Exchange offer).";
const BIG_NOTE =
  "\n\n**Delivered, installed and billed.** Free delivery in Coimbatore; installation by our own technicians (book it from Installation & set-up). The serial number goes on your GST bill and starts the warranty.";
const SMALL_NOTE = "\n\n**Genuine, GST-billed.** Brand warranty from the bill date; bring the bill or the order number to our Cross Cut Road counter for service.";

const PRODUCTS: DemoProduct[] = [
  // ---- smartphones (8517 13 00: 18%)
  mk("TZ-P1", "85171300", {
    name: "Entry 4G smartphone, 6.5-inch HD+",
    category: PHONES,
    photo: 33797540,
    tags: ["phone", "budget", "under-10000", "under-15000", "use-everyday", "use-battery", "4g", "bestseller"],
    description: `A first smartphone that doesn't try to be more than it is: a bright 6.5-inch HD+ screen, a 5000 mAh battery that lasts two days of calls, WhatsApp and videos, dual SIM plus a memory-card slot. 13 MP main camera, face unlock and a side fingerprint reader.${PHONE_NOTE}`,
    attributes: { Display: "6.5-inch HD+ 60 Hz", Battery: "5000 mAh, 10 W charging", Camera: "13 MP + 2 MP, 5 MP selfie", Network: "4G dual SIM + microSD", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...two("Storage", [["4 GB + 64 GB", 7499, 8999], ["4 GB + 128 GB", 8499, 9999]], "Colour", ["Midnight Black", "Ocean Blue"], 3),
  }),
  mk("TZ-P2", "85171300", {
    name: "Everyday 5G smartphone, 6.6-inch 90 Hz",
    category: PHONES,
    photo: 30277522,
    tags: ["phone", "budget", "under-15000", "5g", "use-everyday", "use-battery", "bestseller", "deal"],
    description: `The one most people in the shop walk out with. 5G on both SIMs, a smooth 90 Hz 6.6-inch display, a 50 MP camera and a 5000 mAh battery with an 18 W charger in the box. Clean software with three years of security updates.${PHONE_NOTE}`,
    attributes: { Display: "6.6-inch FHD+ 90 Hz LCD", Battery: "5000 mAh, 18 W charger in the box", Camera: "50 MP + 2 MP, 8 MP selfie", Network: "5G (12 bands) dual SIM", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...two("Storage", [["6 GB + 128 GB", 12999, 15999], ["8 GB + 128 GB", 13999, 16999], ["8 GB + 256 GB", 15499, 18999]], "Colour", ["Midnight", "Ocean", "Mint"], 3),
  }),
  mk("TZ-P3", "85171300", {
    name: "AMOLED 5G smartphone, 6.67-inch 120 Hz",
    category: PHONES,
    photo: 12997975,
    tags: ["phone", "mid-range", "under-30000", "5g", "use-everyday", "use-bigscreen", "bestseller"],
    description: `A 6.67-inch AMOLED screen at 120 Hz makes everything from reels to maps look better than the price says. 67 W fast charging fills the 5000 mAh battery in about 45 minutes; stereo speakers and an IP54 splash-resistant body.${PHONE_NOTE}`,
    attributes: { Display: "6.67-inch AMOLED 120 Hz, 1800 nits", Battery: "5000 mAh, 67 W charger in the box", Camera: "64 MP OIS + 8 MP ultra-wide, 16 MP selfie", Network: "5G dual SIM", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...two("Storage", [["8 GB + 128 GB", 18999, 22999], ["8 GB + 256 GB", 20999, 25999]], "Colour", ["Graphite", "Pearl", "Lilac"], 3),
  }),
  mk("TZ-P4", "85171300", {
    name: "Camera 5G smartphone, 108 MP with OIS",
    category: PHONES,
    photo: 16094263,
    tags: ["phone", "mid-range", "under-30000", "5g", "use-camera", "deal"],
    description: `For people who photograph everything: a 108 MP main sensor with optical stabilisation, a 3x telephoto lens and a 32 MP selfie camera, with night and portrait modes that work on a Coimbatore evening. AMOLED screen, 5100 mAh battery.${PHONE_NOTE}`,
    attributes: { Display: "6.7-inch AMOLED 120 Hz", Battery: "5100 mAh, 80 W charger in the box", Camera: "108 MP OIS + 8 MP + 3x telephoto, 32 MP selfie", Network: "5G dual SIM", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...two("Storage", [["8 GB + 256 GB", 24999, 29999], ["12 GB + 256 GB", 27999, 32999]], "Colour", ["Black", "Forest Green", "Silver"], 3),
  }),
  mk("TZ-P5", "85171300", {
    name: "Gaming 5G smartphone, 6.78-inch 144 Hz",
    category: PHONES,
    photo: 7661069,
    tags: ["phone", "performance", "under-40000", "5g", "use-gaming"],
    description: `A top-end chip, vapour-chamber cooling and a 144 Hz AMOLED screen with fast touch response for long BGMI and Free Fire sessions without throttling. Shoulder triggers, a 6000 mAh battery and 100 W charging.${PHONE_NOTE}`,
    attributes: { Display: "6.78-inch AMOLED 144 Hz", Battery: "6000 mAh, 100 W charger in the box", Camera: "50 MP OIS + 8 MP, 16 MP selfie", Cooling: "Vapour chamber", Network: "5G dual SIM", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...two("Storage", [["12 GB + 256 GB", 34999, 39999], ["16 GB + 512 GB", 39999, 46999]], "Colour", ["Shadow", "Neon"], 3),
  }),
  mk("TZ-P6", "85171300", {
    name: "Flagship 5G smartphone, 6.7-inch LTPO OLED",
    category: PHONES,
    photo: 35278405,
    tags: ["phone", "flagship", "above-40000", "5g", "use-camera", "use-bigscreen", "esim"],
    description: `The one to keep for four years. Titanium frame, a bright 6.7-inch LTPO OLED that drops to 1 Hz when idle, a three-camera system with a 5x periscope lens, wireless charging and seven years of updates. Dual nano-SIM plus eSIM.${PHONE_NOTE}`,
    attributes: { Display: "6.7-inch LTPO OLED 1-120 Hz, 2600 nits", Battery: "5000 mAh, 45 W wired + 15 W wireless", Camera: "200 MP + 50 MP 5x periscope + 12 MP ultra-wide", Updates: "7 years of OS and security updates", Network: "5G dual SIM + eSIM", Warranty: "12 months on phone, 6 months on accessories" },
    serial: serial(12, true),
    ...two("Storage", [["12 GB + 256 GB", 64999, 74999], ["12 GB + 512 GB", 71999, 82999], ["16 GB + 1 TB", 84999, 96999]], "Colour", ["Titanium Grey", "Black", "Silver"], 2),
  }),
  mk("TZ-P7", "85171300", {
    name: "Compact flagship 5G smartphone, 6.1-inch",
    category: PHONES,
    photo: 3756879,
    tags: ["phone", "flagship", "above-40000", "5g", "use-camera", "esim"],
    description: `All the camera and speed of a flagship in a body that fits one hand and a pocket. 6.1-inch OLED, aluminium frame, a 48 MP main camera with 2x optical-quality zoom and an all-day battery. Dual nano-SIM plus eSIM.${PHONE_NOTE}`,
    attributes: { Display: "6.1-inch OLED 120 Hz", Battery: "4000 mAh, 30 W fast charging (charger sold separately)", Camera: "48 MP + 12 MP ultra-wide, 12 MP selfie", Network: "5G dual SIM + eSIM", Warranty: "12 months on phone" },
    serial: serial(12, true),
    ...two("Storage", [["128 GB", 59999, 69999], ["256 GB", 66999, 76999], ["512 GB", 79999, 89999]], "Colour", ["Black", "White", "Blue"], 2),
  }),
  mk("TZ-P8", "85171300", {
    name: "Foldable 5G smartphone, 7.6-inch inner screen",
    category: PHONES,
    photo: 3999536,
    tags: ["phone", "flagship", "above-40000", "5g", "use-bigscreen", "esim"],
    description: `A phone that opens into a 7.6-inch tablet: two apps side by side, a full-size reading view and a camera you can prop up and film hands-free. 6.3-inch cover screen, 4400 mAh battery, hinge tested for 200,000 folds. Dual nano-SIM plus eSIM.${PHONE_NOTE}`,
    attributes: { Display: "7.6-inch inner + 6.3-inch cover, both 120 Hz AMOLED", Battery: "4400 mAh, 25 W wired", Camera: "50 MP + 12 MP + 10 MP 3x", Hinge: "Tested for 200,000 folds", Network: "5G dual SIM + eSIM", Warranty: "12 months on phone, 6 months on accessories" },
    serial: serial(12, true),
    ...two("Storage", [["12 GB + 256 GB", 139999, 159999], ["12 GB + 512 GB", 149999, 169999]], "Colour", ["Navy", "Silver"], 1),
  }),
  mk("TZ-P9", "85171300", {
    name: "Rugged 5G smartphone, 6000 mAh battery",
    category: PHONES,
    photo: 11934173,
    tags: ["phone", "mid-range", "under-30000", "5g", "use-battery"],
    description: `Built for site engineers, electricians and delivery partners: IP68 dust and water proof, MIL-STD drop tested, a glove-friendly screen and a 6000 mAh battery that runs three days. A programmable side key opens the torch or a push-to-talk app.${PHONE_NOTE}`,
    attributes: { Display: "6.6-inch FHD+ 120 Hz, glove mode", Battery: "6000 mAh, 33 W charging", Protection: "IP68 / IP69K, MIL-STD-810H", Camera: "50 MP + 8 MP, 16 MP selfie", Network: "5G dual SIM", Warranty: "12 months on phone" },
    serial: serial(12, true),
    ...two("Storage", [["8 GB + 128 GB", 21999, 25999]], "Colour", ["Olive", "Black"], 3),
  }),
  mk("TZ-P10", "85171300", {
    name: "Keypad 4G phone, dual SIM, torch and FM",
    category: PHONES,
    photo: 16442035,
    tags: ["phone", "use-simple", "budget", "under-10000", "4g", "gift"],
    description: `Big keys, a loud speaker and a battery that lasts a week: for parents, grandparents and a second phone on the road. 4G calls (VoLTE) on dual SIM, a bright torch, FM radio, a Tamil keyboard and a 2.4-inch colour screen.${PHONE_NOTE}`,
    attributes: { Display: "2.4-inch colour", Battery: "1750 mAh, about 7 days standby", Network: "4G VoLTE dual SIM + microSD", Languages: "Tamil, English, Hindi", Warranty: "12 months on phone, 6 months on charger" },
    serial: serial(12, true),
    ...one("Colour", [["Black", 1799, 2199, 6], ["Blue", 1799, 2199, 6], ["Red", 1799, 2199, 6]]),
  }),

  // ---- laptops and tablets (8471 30 10 portable computers up to 10 kg: 18%)
  mk("TZ-L1", "84713010", {
    name: "Student laptop, 14-inch FHD, 8 GB RAM",
    category: LAPTOPS,
    photo: 6611937,
    tags: ["student", "work", "under-40000", "bestseller", "deal"],
    description: `A 1.4 kg laptop for classes, projects and Zoom: 14-inch full-HD anti-glare screen, a quad-core processor, fast SSD, a full keyboard with number pad and a battery that gets through a college day. Windows 11 with a one-year office suite licence.${SMALL_NOTE}\n\nThe serial number goes on your GST bill and starts the warranty.`,
    attributes: { Display: "14-inch FHD IPS anti-glare", Processor: "Quad-core, 8 threads", Memory: "8 GB DDR4 (one free slot)", Weight: "1.4 kg", Battery: "Up to 9 hours", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...two("Configuration", [["8 GB + 256 GB SSD", 29990, 38990], ["8 GB + 512 GB SSD", 33990, 42990]], "Colour", ["Silver", "Grey"], 3),
  }),
  mk("TZ-L2", "84713010", {
    name: "Everyday laptop, 15.6-inch FHD, 16 GB RAM",
    category: LAPTOPS,
    photo: 5793947,
    tags: ["work", "student", "under-50000"],
    description: `For accounts, design files and a hundred browser tabs: a 15.6-inch screen, 16 GB of RAM, a six-core processor and a backlit keyboard with number pad. Two USB-A, USB-C with charging, HDMI and a card reader.${SMALL_NOTE}`,
    attributes: { Display: "15.6-inch FHD IPS", Processor: "Six-core, 12 threads", Memory: "16 GB DDR4", Weight: "1.7 kg", Battery: "Up to 8 hours", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...one("Configuration", [["16 GB + 512 GB SSD", 44990, 56990, 3], ["16 GB + 1 TB SSD", 49990, 62990, 2]]),
  }),
  mk("TZ-L3", "84713010", {
    name: "Thin-and-light laptop, 14-inch OLED",
    category: LAPTOPS,
    photo: 8532766,
    tags: ["work", "premium", "above-50000"],
    description: `1.2 kg, 15 mm thin, with a 14-inch 2.8K OLED screen that makes photos and films glow. Aluminium body, a quiet fan, a backlit keyboard, Wi-Fi 6E and a 70 Wh battery with 65 W USB-C charging.${SMALL_NOTE}`,
    attributes: { Display: "14-inch 2.8K OLED 90 Hz", Processor: "Eight-core, 12 threads", Memory: "16 GB LPDDR5", Weight: "1.2 kg", Battery: "70 Wh, 65 W USB-C", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...one("Configuration", [["16 GB + 512 GB SSD", 64990, 79990, 2], ["16 GB + 1 TB SSD", 74990, 89990, 2]]),
  }),
  mk("TZ-L4", "84713010", {
    name: "Gaming laptop, 15.6-inch 144 Hz, 6 GB graphics",
    category: LAPTOPS,
    photo: 6372817,
    tags: ["gaming", "above-50000"],
    description: `A 15.6-inch 144 Hz screen, a dedicated 6 GB graphics card and a dual-fan cooling system for 1080p gaming on high settings. Per-key backlit keyboard, 2 TB-ready SSD slot and a 180 W charger.${SMALL_NOTE}`,
    attributes: { Display: "15.6-inch FHD 144 Hz", Graphics: "Dedicated, 6 GB GDDR6", Memory: "16 GB DDR5 (two slots)", Weight: "2.3 kg", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...one("Configuration", [["16 GB + 512 GB SSD", 74990, 92990, 2], ["16 GB + 1 TB SSD", 84990, 104990, 2]]),
  }),
  mk("TZ-L5", "84713010", {
    name: "Creator laptop, 16-inch 2.5K, 32 GB RAM",
    category: LAPTOPS,
    photo: 8424478,
    tags: ["work", "premium", "above-50000"],
    description: `For editors, designers and architects: a colour-accurate 16-inch 2.5K display (100% DCI-P3), 32 GB of RAM, 1 TB SSD and a graphics card for GPU rendering. SD card reader, Thunderbolt-class USB-C and a 99 Wh battery.${SMALL_NOTE}`,
    attributes: { Display: "16-inch 2.5K, 100% DCI-P3, 120 Hz", Graphics: "Dedicated, 8 GB", Memory: "32 GB DDR5", Weight: "1.9 kg", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...single(124990, 149990, 1),
  }),
  mk("TZ-L6", "84713010", {
    name: "Education laptop, 11.6-inch, 4 GB / 64 GB",
    category: LAPTOPS,
    photo: 6968164,
    tags: ["student", "under-20000", "budget"],
    description: `A tough little laptop for school: 11.6-inch screen, a spill-resistant keyboard, rubber bumpers and a battery that lasts a school day. Boots in seconds and runs web apps, Google Classroom and Meet.${SMALL_NOTE}`,
    attributes: { Display: "11.6-inch HD", Memory: "4 GB + 64 GB eMMC", Weight: "1.2 kg", Battery: "Up to 10 hours", Warranty: "12 months on-site in Coimbatore" },
    serial: serial(12),
    ...one("Colour", [["Grey", 17990, 22990, 3], ["Blue", 17990, 22990, 3]]),
  }),
  mk("TZ-T1", "84713010", {
    name: "Tablet 10.4-inch, Wi-Fi, 2K display",
    category: TABLETS,
    photo: 11495749,
    tags: ["student", "under-20000", "big-screen", "bestseller"],
    description: `A 10.4-inch 2K screen for classes, reading and films, with four speakers, a metal body and an 8000 mAh battery. Splits the screen in two for notes beside a video; a keyboard cover and pen are sold separately.${SMALL_NOTE}`,
    attributes: { Display: "10.4-inch 2K 60 Hz", Battery: "8000 mAh, 18 W charging", Camera: "8 MP + 5 MP", Network: "Wi-Fi", Warranty: "12 months" },
    serial: serial(12),
    ...two("Storage", [["4 GB + 64 GB", 14999, 18999], ["6 GB + 128 GB", 17999, 22999]], "Colour", ["Grey", "Blue"], 3),
  }),
  mk("TZ-T2", "84713010", {
    name: "Tablet 11-inch 120 Hz with pen support",
    category: TABLETS,
    photo: 5428644,
    tags: ["work", "above-20000", "big-screen"],
    description: `An 11-inch 120 Hz display with a low-latency pen for sketching, note-taking and marking up PDFs. Quad speakers, a keyboard dock option and an 8400 mAh battery. The Wi-Fi + 5G model takes a SIM.${SMALL_NOTE}`,
    attributes: { Display: "11-inch 2.5K 120 Hz", Battery: "8400 mAh, 33 W charging", Camera: "13 MP + 8 MP", Network: "Wi-Fi, or Wi-Fi + 5G", Warranty: "12 months on tablet, 6 months on pen" },
    serial: serial(12),
    ...one("Variant", [["8 GB + 128 GB, Wi-Fi", 29999, 36999, 2], ["8 GB + 256 GB, Wi-Fi + 5G", 36999, 44999, 2]]),
  }),
  mk("TZ-T3", "84713010", {
    name: "Kids tablet 8-inch with rugged case",
    category: TABLETS,
    photo: 3944397,
    tags: ["student", "under-10000", "gift"],
    description: `An 8-inch tablet in a drop-proof foam case with a stand, parental controls, a Tamil and English learning library and a screen-time limit you set from your phone. Eye-care display mode and a 5000 mAh battery.${SMALL_NOTE}`,
    attributes: { Display: "8-inch HD eye-care", Memory: "3 GB + 32 GB, microSD to 512 GB", Battery: "5000 mAh", Controls: "Parental controls and screen-time limits", Warranty: "12 months (case not covered for deliberate damage)" },
    serial: serial(12),
    ...one("Colour", [["Blue", 9999, 12999, 3], ["Pink", 9999, 12999, 3]]),
  }),

  // ---- smart TVs and projectors (8528 72: 18% from 22 Sept 2025, was 28% above 32 inches)
  mk("TZ-TV1", "85287219", {
    name: "Full HD smart TV, LED",
    category: TVS,
    photo: 6527058,
    tags: ["tv", "under-20000", "budget", "bestseller"],
    description: `A full-HD smart TV for the bedroom and the small hall: built-in streaming apps, Wi-Fi, three HDMI ports, two USB and a 20 W stereo sound. Voice remote and screen mirroring from your phone.${BIG_NOTE}`,
    attributes: { Resolution: "1920 x 1080", Smart: "Streaming apps, screen mirroring, voice remote", Sound: "20 W stereo", Ports: "3 HDMI, 2 USB", Warranty: "12 months on product + 12 months on panel" },
    serial: serial(12),
    ...one("Screen size", [["32-inch", 11499, 16999, 3], ["40-inch", 15999, 22999, 3]]),
  }),
  mk("TZ-TV2", "85287219", {
    name: "4K smart TV, Android-style OS",
    category: TVS,
    photo: 12285888,
    tags: ["tv", "under-40000", "big-screen", "bestseller", "deal"],
    description: `The hall TV most Coimbatore homes buy: a 4K panel with HDR10, a streaming-ready operating system, Dolby Audio on 24 W speakers and a bezel-less design. Cast from your phone, play from a pen drive or plug in a console (ALLM, 60 Hz).${BIG_NOTE}`,
    attributes: { Resolution: "3840 x 2160, HDR10", Smart: "Android-style OS, built-in cast", Sound: "24 W, Dolby Audio", Ports: "3 HDMI (1 eARC), 2 USB", Warranty: "12 months on product + 12 months on panel" },
    serial: serial(12),
    ...one("Screen size", [["43-inch", 24999, 36999, 3], ["50-inch", 31999, 47999, 3], ["55-inch", 36999, 54999, 3]]),
  }),
  mk("TZ-TV3", "85287219", {
    name: "QLED 4K smart TV, 120 Hz",
    category: TVS,
    photo: 6487954,
    tags: ["tv", "above-40000", "big-screen", "gaming"],
    description: `Quantum-dot colour, a 120 Hz panel with variable refresh for consoles and a 40 W Dolby Atmos sound system. Local dimming, a far-field voice assistant and a slim wall-hugging design. Wall-mount fitting is on the Installation page.${BIG_NOTE}`,
    attributes: { Resolution: "3840 x 2160 QLED, HDR10+ / Dolby Vision", Refresh: "120 Hz, VRR, ALLM", Sound: "40 W, Dolby Atmos", Ports: "4 HDMI 2.1 (1 eARC), 2 USB", Warranty: "12 months on product + 12 months on panel" },
    serial: serial(12),
    ...one("Screen size", [["55-inch", 54999, 79999, 2], ["65-inch", 79999, 119999, 2], ["75-inch", 129999, 179999, 1]]),
  }),
  mk("TZ-TV4", "85287219", {
    name: "OLED 4K TV, 120 Hz, self-lit pixels",
    category: TVS,
    photo: 34153693,
    tags: ["tv", "above-40000", "big-screen", "gaming", "premium"],
    description: `Every pixel lights itself, so blacks are really black and a dark film stays dark. 120 Hz, four HDMI 2.1 ports, a 60 W Dolby Atmos speaker system and a gallery-style wall mount in the box.${BIG_NOTE}`,
    attributes: { Resolution: "3840 x 2160 OLED, Dolby Vision", Refresh: "120 Hz, VRR, ALLM", Sound: "60 W, Dolby Atmos", Ports: "4 HDMI 2.1, 3 USB", Warranty: "12 months on product + 24 months on panel" },
    serial: serial(12),
    ...one("Screen size", [["55-inch", 119999, 159999, 1], ["65-inch", 179999, 239999, 1]]),
  }),
  mk("TZ-TV5", "85286900", {
    name: "Full HD portable projector, 4000 lumens",
    category: TVS,
    photo: 37834298,
    tags: ["tv", "under-20000", "gift"],
    description: `A 100-inch screen anywhere there is a wall: 1080p native, 4000 lumens, auto keystone and a built-in streaming stick. Bluetooth speaker mode, HDMI and USB inputs, and a carry bag.${SMALL_NOTE}`,
    attributes: { Resolution: "1920 x 1080 native", Brightness: "4000 lumens", Sound: "10 W built-in speaker", Inputs: "HDMI, USB, Bluetooth", Warranty: "12 months (lamp life 30,000 hours)" },
    serial: serial(12),
    ...single(18999, 27999, 3),
  }),

  // ---- refrigerators (8418 21: 18%)
  mk("TZ-R1", "84182100", {
    name: "Single-door refrigerator, direct cool",
    category: FRIDGES,
    photo: 4068316,
    tags: ["appliance", "under-20000", "budget"],
    description: `A simple, dependable single-door fridge for a family of two or three: direct-cool, a 4-star energy rating, toughened-glass shelves and a vegetable crisper. A 10-year warranty on the compressor.${BIG_NOTE}`,
    attributes: { Type: "Single door, direct cool", Rating: "4 star", Compressor: "10 years", Warranty: "12 months on product, 10 years on compressor" },
    serial: serial(12),
    ...one("Capacity", [["185 litres", 12990, 16990, 3], ["230 litres", 14990, 19990, 3]]),
  }),
  mk("TZ-R2", "84182100", {
    name: "Double-door frost-free refrigerator, inverter",
    category: FRIDGES,
    photo: 6956124,
    tags: ["appliance", "under-40000", "bestseller", "deal", "family"],
    description: `The family fridge: frost-free so you never defrost, an inverter compressor that saves power and runs quietly, a convertible freezer and a large crisper. Stays cold for up to 10 hours in a power cut.${BIG_NOTE}`,
    attributes: { Type: "Double door, frost-free, inverter", Rating: "3 star (260 L) / 2 star (345 L)", Compressor: "10 years", Warranty: "12 months on product, 10 years on compressor" },
    serial: serial(12),
    ...one("Capacity", [["260 litres", 25990, 33990, 3], ["310 litres", 29990, 39990, 3], ["345 litres", 33990, 44990, 2]]),
  }),
  mk("TZ-R3", "84182100", {
    name: "Side-by-side refrigerator, 598 litres, water dispenser",
    category: FRIDGES,
    photo: 6835090,
    tags: ["appliance", "above-40000", "family", "premium"],
    description: `Two tall doors, a chilled water dispenser on the outside and a twin-cooling system that keeps the fridge and freezer air separate. Wi-Fi control, a 5-star rating and a stainless-steel finish that resists fingerprints.${BIG_NOTE}`,
    attributes: { Type: "Side by side, frost-free, inverter", Capacity: "598 litres", Rating: "3 star", Warranty: "12 months on product, 10 years on compressor" },
    serial: serial(12),
    ...single(74990, 99990, 1),
  }),
  mk("TZ-R4", "84182100", {
    name: "Mini refrigerator, 90 litres, for rooms and shops",
    category: FRIDGES,
    photo: 9646742,
    tags: ["appliance", "under-10000", "gift"],
    description: `A 90-litre fridge that fits under a counter, in a hostel room or by a shop till. Direct-cool with a small freezer box, a reversible door and a low-noise compressor.${BIG_NOTE}`,
    attributes: { Type: "Single door, direct cool", Capacity: "90 litres", Warranty: "12 months on product, 5 years on compressor" },
    serial: serial(12),
    ...single(8990, 10990, 3),
  }),

  // ---- washing machines (8450 11 / 8450 12: 18%)
  mk("TZ-W1", "84501200", {
    name: "Semi-automatic washing machine, twin tub",
    category: WASHERS,
    photo: 4993073,
    tags: ["appliance", "under-20000", "budget"],
    description: `The tough, thrifty washer: a wash tub and a spin dryer, rust-proof body, a lint filter and a 5-year motor warranty. Works with low water pressure and needs no plumbing for the drain.${BIG_NOTE}`,
    attributes: { Type: "Semi-automatic, top load, twin tub", Wash: "Roller pulsator", Warranty: "12 months on product, 5 years on motor" },
    serial: serial(12),
    ...one("Capacity", [["7 kg", 9990, 12990, 3], ["8 kg", 11990, 15990, 3]]),
  }),
  mk("TZ-W2", "84501100", {
    name: "Fully automatic top-load washing machine",
    category: WASHERS,
    photo: 19846385,
    tags: ["appliance", "under-30000", "bestseller", "family"],
    description: `Fill, press start, take out dry clothes. Fully automatic with 8 wash programmes, a tough glass lid, a built-in heater on the 8 kg model and a quiet inverter motor. Soft-close lid and a child lock.${BIG_NOTE}`,
    attributes: { Type: "Fully automatic, top load", Programmes: "8 wash programmes", Motor: "Inverter on 7.5 and 8 kg", Warranty: "12 months on product, 10 years on motor" },
    serial: serial(24),
    ...one("Capacity", [["6.5 kg", 15990, 21990, 3], ["7.5 kg", 18990, 25990, 3], ["8 kg inverter", 21990, 29990, 3]]),
  }),
  mk("TZ-W3", "84501100", {
    name: "Front-load inverter washing machine",
    category: WASHERS,
    photo: 11316620,
    tags: ["appliance", "above-20000", "family", "bestseller"],
    description: `Gentler on clothes and thriftier with water: a front-load drum with 15 programmes including a 30-minute quick wash, steam, and a 1400 rpm spin. Inverter direct-drive motor with a 10-year warranty.${BIG_NOTE}`,
    attributes: { Type: "Fully automatic, front load, inverter", Spin: "Up to 1400 rpm", Programmes: "15, including steam and quick wash", Warranty: "24 months on product, 10 years on motor" },
    serial: serial(24),
    ...one("Capacity", [["7 kg", 27990, 37990, 2], ["8 kg", 31990, 42990, 2], ["9 kg", 36990, 49990, 2]]),
  }),
  mk("TZ-W4", "84501100", {
    name: "Washer-dryer, 8 kg wash + 5 kg dry, front load",
    category: WASHERS,
    photo: 34397245,
    tags: ["appliance", "above-40000", "premium", "family"],
    description: `Washes and dries in one machine, which is what a monsoon flat needs. 8 kg wash, 5 kg dry, steam sanitise and a 59-minute wash-and-dry cycle for a small load. Wi-Fi control and an inverter direct-drive motor.${BIG_NOTE}`,
    attributes: { Type: "Washer-dryer, front load, inverter", Capacity: "8 kg wash / 5 kg dry", Spin: "1400 rpm", Warranty: "24 months on product, 10 years on motor" },
    serial: serial(24),
    ...single(46990, 62990, 1),
  }),

  // ---- air conditioners (8415 10: 18% from 22 Sept 2025, was 28%)
  mk("TZ-A1", "84151090", {
    name: "3-star inverter split air conditioner",
    category: ACS,
    photo: 38788452,
    tags: ["appliance", "cooling", "under-40000", "bestseller", "deal"],
    description: `Quiet, cooling from the first minute, and cheap to run: an inverter compressor that slows down instead of switching off, copper condenser, a dust filter and a sleep mode. Works up to 52 degrees outside. Installation with 3 m of copper piping is on the Installation page.${BIG_NOTE}`,
    attributes: { Type: "Split, inverter, copper condenser", Rating: "3 star", Coverage: "Up to 120 sq ft (1 ton), 180 sq ft (1.5 ton), 250 sq ft (2 ton)", Warranty: "12 months on product, 5 years on PCB, 10 years on compressor" },
    serial: serial(12),
    ...one("Capacity", [["1 ton", 31990, 49990, 3], ["1.5 ton", 35990, 56990, 3], ["2 ton", 44990, 65990, 2]]),
  }),
  mk("TZ-A2", "84151090", {
    name: "5-star inverter split air conditioner with Wi-Fi",
    category: ACS,
    photo: 27427771,
    tags: ["appliance", "cooling", "above-40000", "premium"],
    description: `The efficient one: a 5-star rating cuts the monthly electricity bill, with a self-clean cycle, an anti-viral filter and control from your phone. Wi-Fi scheduling turns the room cool before you reach home.${BIG_NOTE}`,
    attributes: { Type: "Split, inverter, Wi-Fi", Rating: "5 star", Coverage: "Up to 120 sq ft (1 ton), 180 sq ft (1.5 ton)", Warranty: "12 months on product, 5 years on PCB, 10 years on compressor" },
    serial: serial(12),
    ...one("Capacity", [["1 ton", 38990, 58990, 2], ["1.5 ton", 42990, 64990, 2]]),
  }),
  mk("TZ-A3", "84151010", {
    name: "3-star window air conditioner",
    category: ACS,
    photo: 28206114,
    tags: ["appliance", "cooling", "under-40000", "budget"],
    description: `The no-fuss window AC for shops, offices and small rooms: a copper condenser, a washable filter and a remote with a sleep timer. A wall cut-out is all the installation it needs.${BIG_NOTE}`,
    attributes: { Type: "Window, fixed speed, copper condenser", Rating: "3 star", Coverage: "Up to 120 sq ft (1 ton), 180 sq ft (1.5 ton)", Warranty: "12 months on product, 5 years on compressor" },
    serial: serial(12),
    ...one("Capacity", [["1 ton", 26990, 36990, 2], ["1.5 ton", 30990, 42990, 2]]),
  }),
  mk("TZ-A4", "84151090", {
    name: "Portable air conditioner, 1 ton, no installation",
    category: ACS,
    photo: 15791508,
    tags: ["appliance", "cooling", "under-40000"],
    description: `Rolls to wherever it is hot: a 1-ton portable AC with a window kit for the hose and a drain-free design. For rented rooms where a split AC is not allowed. Cooling, fan and dry modes.${BIG_NOTE}`,
    attributes: { Type: "Portable, fixed speed", Coverage: "Up to 120 sq ft", Install: "Window kit and hose, no outdoor unit", Warranty: "12 months on product, 5 years on compressor" },
    serial: serial(12),
    ...single(33990, 44990, 2),
  }),

  // ---- audio (8518: 18%)
  mk("TZ-AU1", "85183000", {
    name: "Over-ear Bluetooth headphones with ANC",
    category: AUDIO,
    photo: 3394650,
    tags: ["audio", "under-10000", "gift", "bestseller"],
    description: `Cut the bus out of your commute: active noise cancelling, 40 hours of playback, soft ear cushions and a fold-flat design. Two devices at once over Bluetooth 5.3, a wired mode over the 3.5 mm cable.${SMALL_NOTE}`,
    attributes: { Type: "Over-ear, ANC", Battery: "40 hours (ANC on), 10 minutes charge gives 5 hours", Connectivity: "Bluetooth 5.3, multipoint, 3.5 mm", Warranty: "12 months" },
    ...one("Colour", [["Black", 4999, 8999, 6], ["White", 4999, 8999, 6], ["Sage", 4999, 8999, 6]]),
  }),
  mk("TZ-AU2", "85183000", {
    name: "True wireless earbuds with ANC",
    category: AUDIO,
    photo: 10104407,
    tags: ["audio", "under-5000", "gift", "bestseller"],
    description: `Pocket-size earbuds with noise cancelling and a four-microphone call system: 8 hours per charge and 32 hours with the case, IPX4 sweat resistance, touch controls and low-latency game mode.${SMALL_NOTE}`,
    attributes: { Type: "True wireless, ANC", Battery: "8 h earbuds + 24 h case", Connectivity: "Bluetooth 5.3", Warranty: "12 months" },
    ...one("Colour", [["Black", 2999, 5499, 8], ["White", 2999, 5499, 8]]),
  }),
  mk("TZ-AU3", "85182900", {
    name: "Portable Bluetooth speaker, 20 W, waterproof",
    category: AUDIO,
    photo: 11764413,
    tags: ["audio", "under-5000", "gift"],
    description: `Big sound in a bag-size body: 20 W of output, IPX7 waterproofing for the beach and the bathroom, 18 hours of playback and a strap. Pair two for stereo.${SMALL_NOTE}`,
    attributes: { Output: "20 W", Battery: "18 hours", Protection: "IPX7", Connectivity: "Bluetooth 5.3, USB-C", Warranty: "12 months" },
    ...one("Colour", [["Black", 2499, 4499, 6], ["Beige", 2499, 4499, 6]]),
  }),
  mk("TZ-AU4", "85182200", {
    name: "Soundbar 2.1 with wireless subwoofer, 300 W",
    category: AUDIO,
    photo: 11103381,
    tags: ["audio", "under-20000", "bestseller"],
    description: `Dialogue you can hear and a bass you can feel: a 2.1 soundbar with a wireless subwoofer, 300 W of output, HDMI ARC for your TV, Bluetooth and optical input. Movie, music and night modes.${BIG_NOTE}`,
    attributes: { Output: "300 W, 2.1 channel", Inputs: "HDMI ARC, optical, USB, Bluetooth 5.0", Subwoofer: "Wireless, 6.5-inch", Warranty: "12 months" },
    ...single(11990, 17990, 4),
  }),
  mk("TZ-AU5", "85182200", {
    name: "Home theatre 5.1 with Bluetooth, 1000 W",
    category: AUDIO,
    photo: 7772558,
    tags: ["audio", "under-30000"],
    description: `A full 5.1 system with five satellite speakers and a powerful subwoofer, 1000 W of output, HDMI ARC, Bluetooth and a karaoke input. Movie, music and game equaliser presets.${BIG_NOTE}`,
    attributes: { Output: "1000 W, 5.1 channel", Inputs: "HDMI ARC, optical, USB, Bluetooth 5.0, mic", Warranty: "12 months" },
    ...single(14990, 21990, 3),
  }),

  // ---- smartwatches and bands (8517 62: 18%)
  mk("TZ-S1", "85176290", {
    name: "Smartwatch 1.43-inch AMOLED with GPS and calling",
    category: WATCHES,
    photo: 11700618,
    tags: ["watch", "under-10000", "gift", "bestseller"],
    description: `A round-case watch you can answer calls on: 1.43-inch AMOLED, built-in GPS, heart-rate and SpO2, 100+ sports modes and a 7-day battery. Works with Android and iPhone; swim-proof to 5 ATM.${SMALL_NOTE}`,
    attributes: { Display: "1.43-inch AMOLED, always-on", Battery: "7 days typical", Sensors: "GPS, heart rate, SpO2, sleep", Protection: "5 ATM", Warranty: "12 months" },
    serial: serial(12),
    ...one("Colour", [["Black", 6999, 11999, 4], ["Silver", 6999, 11999, 4], ["Rose", 6999, 11999, 4]]),
  }),
  mk("TZ-S2", "85176290", {
    name: "Fitness band 1.1-inch, 14-day battery",
    category: WATCHES,
    photo: 13007642,
    tags: ["watch", "under-5000", "budget", "gift"],
    description: `Steps, sleep, heart-rate and SpO2 on a bright 1.1-inch screen, a 14-day battery and a swim-proof body for under two thousand rupees. Phone notifications and music control included.${SMALL_NOTE}`,
    attributes: { Display: "1.1-inch AMOLED", Battery: "14 days", Sensors: "Heart rate, SpO2, sleep", Protection: "5 ATM", Warranty: "12 months" },
    ...one("Colour", [["Black", 1799, 3499, 8], ["Blue", 1799, 3499, 8], ["Pink", 1799, 3499, 8]]),
  }),
  mk("TZ-S3", "85176290", {
    name: "Premium smartwatch with LTE and eSIM, 1.4-inch",
    category: WATCHES,
    photo: 31406903,
    tags: ["watch", "above-20000", "premium", "esim"],
    description: `Take calls and stream music without your phone: LTE with eSIM, a sapphire-glass 1.4-inch display, dual-band GPS, ECG and blood-oxygen readings and a titanium case. Two days of battery with LTE on.${SMALL_NOTE}`,
    attributes: { Display: "1.4-inch LTPO AMOLED, sapphire glass", Network: "LTE with eSIM", Sensors: "ECG, SpO2, heart rate, temperature", Case: "Titanium, 5 ATM", Warranty: "12 months" },
    serial: serial(12, true),
    ...single(24999, 29999, 2),
  }),

  // ---- kitchen and home appliances
  mk("TZ-H1", "85165000", {
    name: "Convection microwave oven, 25 litres",
    category: HOME,
    photo: 29149068,
    tags: ["home", "under-20000", "gift", "bestseller"],
    description: `Reheat, grill and bake: a 25-litre convection oven with 200 auto-cook menus, a child lock and a stainless-steel cavity that wipes clean. Includes a baking rack, a grill rack and a turntable.${SMALL_NOTE}`,
    attributes: { Capacity: "25 litres", Modes: "Microwave, grill, convection, combination", Control: "Touch, 200 auto menus", Warranty: "12 months on product, 5 years on magnetron" },
    ...single(9990, 13990, 4),
  }),
  mk("TZ-H2", "85166090", {
    name: "Digital air fryer, 4.5 litres",
    category: HOME,
    photo: 15279744,
    tags: ["home", "under-10000", "gift"],
    description: `Crisp vadai, chips and cutlets with a spoonful of oil: a 4.5-litre basket, eight presets, a digital touch display and a dishwasher-safe, non-stick basket. 1500 W with rapid air circulation.${SMALL_NOTE}`,
    attributes: { Capacity: "4.5 litres", Power: "1500 W", Control: "Digital touch, 8 presets", Warranty: "12 months" },
    ...single(5490, 8990, 4),
  }),
  mk("TZ-H3", "85081100", {
    name: "Bagless vacuum cleaner, 1400 W with HEPA filter",
    category: HOME,
    photo: 4792774,
    tags: ["home", "under-10000"],
    description: `Cyclonic suction with no bag to buy: a 1400 W motor, a washable HEPA filter, a 1.5-litre dust cup and a 6 m cord. Floor, upholstery and crevice tools included.${SMALL_NOTE}`,
    attributes: { Power: "1400 W", "Dust cup": "1.5 litres, bagless", Filter: "Washable HEPA", Cord: "6 m", Warranty: "12 months" },
    ...single(5990, 8990, 3),
  }),
  mk("TZ-H4", "84221100", {
    name: "Free-standing dishwasher, 12 place settings",
    category: HOME,
    photo: 19966809,
    tags: ["home", "appliance", "above-20000", "premium"],
    description: `Pots, pans and tiffin boxes included: a 12 place-setting dishwasher with an Indian-cookware cycle, a steam-wash for oily vessels, a rinse-aid indicator and a delay timer. Fits a standard counter gap.${BIG_NOTE}`,
    attributes: { Capacity: "12 place settings", Programmes: "8, including Indian-cookware and eco", Water: "11 litres per cycle (eco)", Warranty: "24 months on product, 5 years on motor" },
    serial: serial(24),
    ...single(31990, 42990, 2),
  }),
  mk("TZ-H5", "84212190", {
    name: "RO + UV water purifier, 8 litres",
    category: HOME,
    photo: 32168944,
    tags: ["home", "under-20000", "bestseller"],
    description: `Safe water from Coimbatore's mixed borewell and corporation supply: RO + UV + TDS control with a 8-litre tank, a filter-change alert and a 15 litre/hour purification rate. Wall-mount or counter-top. Includes one year of free filter services.${BIG_NOTE}`,
    attributes: { Purification: "RO + UV + TDS controller", Tank: "8 litres", Rate: "15 litres per hour", Service: "1 year of filter services included", Warranty: "12 months" },
    serial: serial(12),
    ...single(12990, 17990, 3),
  }),

  // ---- installation and set-up (labour: SAC 9987, 18%)
  mk("TZ-SV1", "998719", {
    name: "Split AC installation, up to 3 m copper piping",
    category: SERVICES,
    photo: 38788452,
    unit: "job",
    tags: ["service", "installation", "cooling"],
    description: "Our technician fits the indoor and outdoor units, 3 m of copper piping and cable, the drain pipe and a bracket, vacuums the lines and tests the cooling. Extra piping is billed per metre on the spot. Book it with your AC or any time after.",
    attributes: { Includes: "Bracket, 3 m piping, wiring, drain, vacuum and gas test", Time: "About 3 hours", Warranty: "90 days on workmanship" },
    ...single(1999, 2499, 99),
  }),
  mk("TZ-SV2", "998719", {
    name: "TV wall-mount fitting, up to 65-inch",
    category: SERVICES,
    photo: 4107154,
    unit: "job",
    tags: ["service", "installation"],
    description: "A tilting wall bracket (included for up to 65-inch) fitted level on brick or concrete, with the cables tidied and the TV tuned and set up with your streaming accounts. Bring the TV home from us or fit one you already own.",
    attributes: { Includes: "Bracket, anchors, cable tidy, setup and app login", Time: "About 1 hour", Warranty: "90 days on workmanship" },
    ...single(799, 999, 99),
  }),
  mk("TZ-SV3", "998719", {
    name: "Washing machine installation and demo",
    category: SERVICES,
    photo: 8146329,
    unit: "job",
    tags: ["service", "installation"],
    description: "We level the machine, connect the inlet and drain, run a test wash and show you every programme. Transit bolts removed and the warranty card activated with the serial number on your bill.",
    attributes: { Includes: "Levelling, water and drain connections, test wash, demo", Time: "About 45 minutes", Warranty: "90 days on workmanship" },
    ...single(499, 699, 99),
  }),
  mk("TZ-SV4", "998719", {
    name: "New phone set-up and data transfer",
    category: SERVICES,
    photo: 25809227,
    unit: "job",
    tags: ["service", "phone"],
    description: "We move your contacts, photos, WhatsApp chats and apps from your old phone to the new one, set up fingerprint and screen lock, and fit a screen guard. Over in about 30 minutes while you wait.",
    attributes: { Includes: "Contacts, photos, chats and apps, lock set-up, screen guard", Time: "About 30 minutes" },
    ...single(299, 499, 99),
  }),
];

const PHOTOS: DemoStore["photos"] = {
  33797540: { by: "Andrey Matveev", alt: "Top-down view of two modern smartphones with home screens displayed on a textured surface." },
  30277522: { by: "Rohit Sharma", alt: "A smartphone showing various apps is placed on a green bench outdoors." },
  12997975: { by: "Lens Of Pritam", alt: "A smartphone placed on a lush green kalo leaf, showcasing nature's contrast and simplicity." },
  16094263: { by: "Erik Mclean", alt: "A person holds a smartphone while browsing a webpage outdoors. Urban setting." },
  7661069: { by: "Eva Bronzini", alt: "A close-up shot of a smartphone with a shopping app on a white surface, ideal for e-commerce themes." },
  35278405: { by: "Ivett M", alt: "A tattooed hand holding a sleek blue smartphone against a neutral background." },
  3756879: { by: "Sound On", alt: "Close-up of a hand holding a smartphone against a bright orange backdrop, emphasizing modern technology." },
  3999536: { by: "Gantas Vaičiulėnas", alt: "Close-up of a smartphone showing a bird on a street lamp with a cloudy sky in the background." },
  11934173: { by: "Zaidan Falaah", alt: "Black smartphone on a plain white background showcasing simplicity and minimalism." },
  16442035: { by: "Chandan Kumar", alt: "Top view of Samsung and iPhone placed on a grassy surface, showcasing modern smartphone design." },
  6611937: { by: "Tima Miroshnichenko", alt: "Laptop with blank screen on a reflective table indoors, perfect for mockups and presentations." },
  5793947: { by: "Yan Krukau", alt: "A minimalist workspace with an open laptop, coffee mug, and vase on a bright indoor table." },
  8532766: { by: "Hanna Pad", alt: "A sleek laptop sitting on a woven chair in a minimalist setting, perfect for modern workspaces." },
  6372817: { by: "KATRIN  BOLOVTSOVA", alt: "A sleek laptop with a blank screen on a round marble-top table indoors." },
  8424478: { by: "Pavel Danilyuk", alt: "A black coffee mug on an office desk with a blurred laptop in the background." },
  6968164: { by: "Mikhail Nilov", alt: "Modern laptop on a clean white table, perfect for tech and workspace themes." },
  11495749: { by: "Towfiqu barbhuiya", alt: "A hand interacting with a digital tablet on a wooden table, showcasing modern technology." },
  5428644: { by: "Ivan S", alt: "A person drawing on a digital tablet in a creative workspace, surrounded by art supplies." },
  3944397: { by: "cottonbro studio", alt: "A minimalist home office setup featuring a tablet, stylus, keyboard, plant, and stationery on a white desk." },
  6527058: { by: "Max Vakhtbovych", alt: "Elegant modern room interior featuring wall-mounted TV, chair, and a vase with fresh flowers." },
  12285888: { by: "dada _design", alt: "Minimalist living room featuring a flat screen TV, yellow armchair, and stylish wooden furniture." },
  6487954: { by: "Max Vakhtbovych", alt: "Stylish and cozy minimalist living room with modern furnishings and a sleek design." },
  34153693: { by: "Fernanda Neitzel", alt: "Stylish living room interior with TV and view of greenery through the balcony." },
  37834298: { by: "Margo Evardson", alt: "A sleek and minimalist Scandinavian living room with white decor and electronics." },
  4068316: { by: "cottonbro studio", alt: "Cozy kitchen with a blank paper on the fridge, ideal for mockups or notes." },
  6956124: { by: "Max Vakhtbovych", alt: "Contemporary white kitchen featuring sleek cabinets, appliances, and stylish decor." },
  6835090: { by: "Curtis Adams", alt: "Spacious modern kitchen featuring stainless steel appliances and white cabinets, perfect for culinary enthusia" },
  9646742: { by: "Hakim  Santoso", alt: "Stylish kitchen featuring a modern refrigerator and a decorative plant in a clay pot." },
  4993073: { by: "Rachel Claire", alt: "Bright and tidy laundry room featuring a washing machine, wicker basket, and potted plant on a wooden counter." },
  19846385: { by: "Lisa Anna", alt: "Stylish and clean laundry space featuring a white washing machine with towels on top." },
  11316620: { by: "Towfiqu barbhuiya", alt: "A close-up of a hand loading colorful towels into a front-loading washing machine." },
  34397245: { by: "Vlad Deep", alt: "Detailed view of a clean, modern washing machine drum, showcasing shiny stainless steel interior." },
  38788452: { by: "NEOSiAM 18+", alt: "Close-up of a wall-mounted air conditioner indoors, showcasing sleek design for modern cooling solutions." },
  27427771: { by: "Jan van der Wolf", alt: "Rusty air conditioning unit casting shadow on a peach wall with blue stripe." },
  28206114: { by: "Şahin Doğdu", alt: "A sunlit window with potted plants and a vintage air conditioner in Bursa, Türkiye." },
  15791508: { by: "Zechen Li", alt: "Air conditioning unit against a pink wall with a sidewalk, showing urban setting." },
  3394650: { by: "Sound On", alt: "Sleek overhead view of modern white wireless headphones on a clean white background." },
  10104407: { by: "I'm Zion", alt: "Top view of sleek wireless earbuds and case on a marble surface next to a laptop." },
  11764413: { by: "Berke  Can", alt: "High-angle view of a beige portable speaker against a minimal white backdrop." },
  11103381: { by: "Towfiqu barbhuiya", alt: "Modern wireless speaker placed elegantly with a potted plant and colorful stationery." },
  7772558: { by: "Caleb Oquendo", alt: "A stylish compact portable speaker with a textured exterior on a white background, showcasing modern technolog" },
  11700618: { by: "pratik prasad", alt: "A sleek black smartwatch with a minimalist interface, perfect for modern tech enthusiasts." },
  13007642: { by: "pratik prasad", alt: "Close-up of a modern smartwatch with a white strap, showcasing sleek design and technology." },
  31406903: { by: "Deise Elen", alt: "A sleek white smartwatch displayed on a plain surface with a minimalist style." },
  29149068: { by: "AJ  Ahamad", alt: "Contemporary kitchen space featuring a microwave and a gas stove on a marble countertop in Dubai" },
  15279744: { by: "Valeriya Kobzar", alt: "A modern kitchen counter setup displaying appliances and food items." },
  4792774: { by: "Anete Lusina", alt: "Unrecognizable man using a vacuum in a modern home setting, focusing on cleanliness and tidiness." },
  19966809: { by: "Alex Tyson", alt: "Sleek modern kitchen featuring white cabinetry, built-in appliances, and minimalist design." },
  32168944: { by: "AJ  Ahamad", alt: "Stylish kitchen setup featuring a black microwave and coffee maker on a counter." },
  4107154: { by: "cottonbro studio", alt: "Modern interior with a TV, geometric sculpture, and wooden table decor." },
  8146329: { by: "Max Vakhtbovych", alt: "Modern bathroom design featuring bathtub, sink, and washing machine." },
  25809227: { by: "Matheus Bertelli", alt: "Close-up of modern tablets displayed on a wooden table in an electronics store." },
  7772548: { by: "Caleb Oquendo", alt: "Studio shot of modern black wireless headphones against a white background, showcasing sleek design." },
  11297769: { by: "Mathias Reding", alt: "Sleek interior of a high-tech store showcasing various mobile devices and accessories." },
  31145466: { by: "Andrei L", alt: "Vibrant desktop computers showcased on a wooden table in modern retail environment." },
};


const HOURS = [
  { label: "Monday – Saturday", value: "10:00 am – 9:30 pm" },
  { label: "Sunday", value: "10:30 am – 8:30 pm" },
];

const COMPARE_ROWS = [
  { label: "Screen", values: ["6.6-inch FHD+ 90 Hz", "6.67-inch AMOLED 120 Hz", "6.7-inch AMOLED 120 Hz", "6.7-inch LTPO OLED 1-120 Hz"] },
  { label: "Main camera", values: ["50 MP", "64 MP with OIS", "108 MP with OIS + 3x zoom", "200 MP + 5x periscope"] },
  { label: "Battery and charger", values: ["5000 mAh, 18 W", "5000 mAh, 67 W", "5100 mAh, 80 W", "5000 mAh, 45 W + wireless"] },
  { label: "SIM", values: ["Dual 5G", "Dual 5G", "Dual 5G", "Dual 5G + eSIM"] },
  { label: "Software updates", values: ["3 years", "4 years", "4 years", "7 years"] },
  { label: "Warranty", values: ["12 months", "12 months", "12 months", "12 months"] },
];
const COMPARE_ROWS_TA = [
  { label: "திரை", values: ["6.6-அங்குல FHD+ 90 Hz", "6.67-அங்குல AMOLED 120 Hz", "6.7-அங்குல AMOLED 120 Hz", "6.7-அங்குல LTPO OLED 1-120 Hz"] },
  { label: "முதன்மை கேமரா", values: ["50 MP", "64 MP, OIS உடன்", "108 MP, OIS + 3x ஜூம்", "200 MP + 5x பெரிஸ்கோப்"] },
  { label: "பேட்டரி & சார்ஜர்", values: ["5000 mAh, 18 W", "5000 mAh, 67 W", "5100 mAh, 80 W", "5000 mAh, 45 W + வயர்லெஸ்"] },
  { label: "சிம்", values: ["இரட்டை 5G", "இரட்டை 5G", "இரட்டை 5G", "இரட்டை 5G + eSIM"] },
  { label: "மென்பொருள் புதுப்பிப்பு", values: ["3 ஆண்டுகள்", "4 ஆண்டுகள்", "4 ஆண்டுகள்", "7 ஆண்டுகள்"] },
  { label: "வாரண்டி", values: ["12 மாதங்கள்", "12 மாதங்கள்", "12 மாதங்கள்", "12 மாதங்கள்"] },
];

const FAQ = [
  { q: "Is the IMEI on my bill, and how do I check my warranty?", a: "Yes. Every phone, laptop, TV and appliance we sell is a serial-numbered unit: the IMEI (both of them on a dual-SIM phone) or serial number is printed on your GST bill and starts the warranty from the bill date. Type it on the **Warranty** page to see the sale, the warranty end date and any claims." },
  { q: "Do you give EMI?", a: "Yes: **no-cost EMI for 3, 6, 9 and 12 months** on credit cards of partner banks above ₹10,000, and low-cost EMI on debit cards and through finance partners with just an Aadhaar and PAN. The EMI page has the table. (Demo shop: offers are placeholders.)" },
  { q: "Can I exchange my old phone?", a: "Bring it to the counter: we check it in five minutes and value it against any phone or laptop. The value is taken off the bill, on top of the **UPGRADE1000** coupon online." },
  { q: "Who installs the AC, TV and washing machine?", a: "Our own technicians, usually the next day in Coimbatore. Book it from **Installation & set-up** (AC ₹1,999, TV wall mount ₹799, washing machine ₹499). Installation is billed on the same GST bill and carries a 90-day workmanship warranty." },
  { q: "What if my phone has a problem in the first week?", a: "Tell us within **7 days of delivery**: if the fault is confirmed at our counter (or by the brand's service centre, on a Dead-On-Arrival certificate), we replace it. After that the brand warranty applies and we help you with the claim." },
  { q: "Are these genuine products with brand warranty?", a: "Yes, bought from authorised distributors, with a GST invoice that lists the serial number. This demo store uses generic product names only to show how a real shop's catalogue, warranty and billing hang together." },
];
const FAQ_TA = [
  { q: "என் பில்லில் IMEI இருக்குமா? வாரண்டியை எப்படிப் பார்ப்பது?", a: "ஆம். நாங்கள் விற்கும் ஒவ்வொரு போன், லேப்டாப், டிவி, சாதனத்துக்கும் தனித்த எண் உண்டு: IMEI (இரட்டை சிம் போனில் இரண்டும்) அல்லது சீரியல் எண் உங்கள் GST பில்லில் அச்சிடப்பட்டு, பில் தேதியிலிருந்து வாரண்டி தொடங்கும். **வாரண்டி** பக்கத்தில் அதைத் தட்டச்சு செய்தால் விற்பனை, வாரண்டி முடியும் தேதி, கிளெய்ம்கள் தெரியும்." },
  { q: "EMI உண்டா?", a: "உண்டு: கூட்டாளி வங்கிகளின் கிரெடிட் கார்டில் ₹10,000-க்கு மேல் **3, 6, 9, 12 மாத நோ-காஸ்ட் EMI**; டெபிட் கார்டிலும் நிதி நிறுவனங்கள் மூலமும் ஆதார், பான் மட்டுமே கொண்டு குறைந்த செலவு EMI. EMI பக்கத்தில் அட்டவணை உள்ளது. (டெமோ கடை: சலுகைகள் மாதிரிகள்.)" },
  { q: "என் பழைய போனை எக்ஸ்சேஞ்ச் செய்யலாமா?", a: "கடைக்குக் கொண்டு வாருங்கள்: ஐந்து நிமிடத்தில் பரிசோதித்து, எந்த போன் அல்லது லேப்டாப்புக்கும் மதிப்பிடுவோம். அந்தத் தொகை பில்லில் கழிக்கப்படும்; ஆன்லைனில் **UPGRADE1000** கூப்பனும் உண்டு." },
  { q: "AC, டிவி, வாஷிங் மெஷினை யார் பொருத்துவார்கள்?", a: "எங்கள் சொந்த டெக்னீஷியன்கள், கோயம்புத்தூரில் பெரும்பாலும் மறுநாளே. **நிறுவல் & செட்-அப்** பக்கத்தில் முன்பதிவு செய்யுங்கள் (AC ₹1,999, டிவி சுவர் பொருத்தம் ₹799, வாஷிங் மெஷின் ₹499). அதே GST பில்லில் வரும்; 90 நாள் வேலை உத்தரவாதம்." },
  { q: "முதல் வாரத்தில் போனில் கோளாறு வந்தால்?", a: "டெலிவரியான **7 நாட்களுக்குள்** சொல்லுங்கள்: எங்கள் கடையில் (அல்லது பிராண்டின் சர்வீஸ் சென்டரில் DOA சான்றுடன்) கோளாறு உறுதியானால் மாற்றித் தருவோம். அதன் பிறகு பிராண்ட் வாரண்டி பொருந்தும்; கிளெய்முக்கு நாங்கள் உதவுவோம்." },
  { q: "இவை அசல் பொருட்களா, பிராண்ட் வாரண்டி உண்டா?", a: "ஆம், அங்கீகரிக்கப்பட்ட விநியோகஸ்தர்களிடமிருந்து வாங்கியவை; சீரியல் எண் குறிப்பிடும் GST பில்லுடன். ஒரு உண்மையான கடையின் பட்டியல், வாரண்டி, பில்லிங் எப்படி இணைகின்றன என்பதைக் காட்டவே இந்த டெமோ கடை பொதுவான பெயர்களைப் பயன்படுத்துகிறது." },
];


const EMI_TABLE = "| Pay in | Per month on ₹24,000 | Extra cost |\n|---|---|---|\n| 3 months | ₹8,000 | ₹0 |\n| 6 months | ₹4,000 | ₹0 |\n| 9 months | ₹2,667 | ₹0 |\n| 12 months | ₹2,000 | ₹0 |";
const EMI_TABLE_TA = "| தவணை | ₹24,000-க்கு மாதம் | கூடுதல் செலவு |\n|---|---|---|\n| 3 மாதங்கள் | ₹8,000 | ₹0 |\n| 6 மாதங்கள் | ₹4,000 | ₹0 |\n| 9 மாதங்கள் | ₹2,667 | ₹0 |\n| 12 மாதங்கள் | ₹2,000 | ₹0 |";

export const TECHZONE: DemoStore = {
  shop: {
    slug: "techzone",
    appId: "EC",
    businessType: "electronics",
    planId: "pro",
    name: "TechZone Mobiles",
    primary: "#0f766e",
    billing: {
      legalName: "TechZone Mobiles",
      gstin: "33AATFT4826M1ZI",
      address: "52, Cross Cut Road",
      city: "Coimbatore",
      pincode: "641012",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TZ",
      upiId: "techzone@okaxis",
    },
    items: [
      { name: "Galaxy M35 5G 8/128", hsn: "8517", unit: "pcs", rate: 1_699_900, gstRate: 18 },
      { name: "Redmi Note 13 6/128", hsn: "8517", unit: "pcs", rate: 1_499_900, gstRate: 18 },
      { name: "boAt Airdopes 141", hsn: "8518", unit: "pcs", rate: 129_900, gstRate: 18 },
      { name: "20W USB-C charger", hsn: "8504", unit: "pcs", rate: 89_900, gstRate: 18 },
    ],
  },
  preset: "big-box",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 5_000_000,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "hello@techzone.in",
    social: {
      whatsapp: PHONE,
      instagram: "https://instagram.com/techzone.coimbatore",
      youtube: "https://youtube.com/@techzonecbe",
    },
    policies: {
      shipping:
        "**Coimbatore (641xxx):** same or next day by our own delivery team; phones and small items ₹99, free above ₹5,000; TVs, refrigerators, washing machines and ACs are delivered free and can be installed the next day.\n\n**Rest of Tamil Nadu:** 2–4 days by insured courier; large appliances by our logistics partner in 3–6 days. Free above ₹10,000.\n\n**Rest of India:** phones, laptops, tablets and audio by insured courier in 4–7 days, prepaid only. Large appliances are delivered in Tamil Nadu only. We hand over every phone sealed: please record a short unboxing video.",
      returns:
        "**7-day replacement for a faulty product.** If a phone, laptop or appliance is dead on arrival or develops a fault within 7 days, tell us and we replace it once the fault is confirmed at our counter or on the brand's Dead-On-Arrival certificate. Sealed, unused products with all accessories can be returned within 7 days for a refund of the amount paid, less any courier cost.\n\n**Warranty.** After that the brand warranty on each product page applies (phones 12 months, ACs and refrigerators with a longer compressor warranty). It starts on the date of your bill; look it up with the IMEI or serial number on the Warranty page. Physical or liquid damage and opened-up devices are not covered.\n\n**Installation** carries a 90-day workmanship warranty.",
      privacy:
        "We use your name, phone and address only to deliver your order, issue your GST bill with the product's serial number and honour your warranty. We never read what is on a phone you leave with us, and we don't share your details with anyone outside delivery and warranty service. You can ask us to delete your account at any time.",
      terms:
        "Prices include 18% GST; the MRP is the printed maximum retail price. Stock is shown as it stands at our Cross Cut Road counter and online. This is a demo store: product names are generic, and the offers, EMI plans, address and phone number are placeholders.",
    },
    businessType: "electronics",
  },
  zones: [
    {
      name: "Coimbatore",
      pincodePrefixes: ["641"],
      rate: { name: "Our delivery team (same / next day)", type: "free_above", amount: 9_900, freeAbove: 500_000, etaMinDays: 0, etaMaxDays: 1, codAllowed: true, codFee: 0 },
    },
    {
      name: "Rest of Tamil Nadu",
      states: ["33"],
      rate: { name: "Insured courier (2–6 days)", type: "free_above", amount: 14_900, freeAbove: 1_000_000, etaMinDays: 2, etaMaxDays: 6, codAllowed: true, codFee: 9_900 },
    },
    {
      name: "Rest of India",
      states: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "34", "35", "36", "37", "38"],
      rate: { name: "Insured courier (4–7 days)", type: "free_above", amount: 24_900, freeAbove: 2_000_000, etaMinDays: 4, etaMaxDays: 7, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: PHONES, description: "5G and 4G smartphones from ₹7,499 to a foldable: storage and colour options, dual SIM, IMEI on your bill.", photo: 30277522 },
    { name: LAPTOPS, description: "Student, everyday, thin-and-light, gaming and creator laptops with on-site warranty in Coimbatore.", photo: 6611937 },
    { name: TABLETS, description: "Wi-Fi and 5G tablets for classes, notes and films, and a kids tablet with a rugged case.", photo: 11495749 },
    { name: TVS, description: "Full HD to OLED smart TVs from 32 to 75 inches, and projectors. Delivered, mounted and set up.", photo: 6487954 },
    { name: FRIDGES, description: "Single-door, double-door, side-by-side and mini refrigerators with long compressor warranties.", photo: 6956124 },
    { name: WASHERS, description: "Semi-automatic, top-load, front-load and washer-dryer machines, installed with a demo.", photo: 4993073 },
    { name: ACS, description: "3-star and 5-star inverter splits, window and portable air conditioners, with installation.", photo: 38788452 },
    { name: AUDIO, description: "Headphones, true wireless earbuds, Bluetooth speakers, soundbars and home theatres.", photo: 7772548 },
    { name: WATCHES, description: "Calling smartwatches, an LTE watch with eSIM and fitness bands.", photo: 31406903 },
    { name: HOME, description: "Microwave ovens, air fryers, vacuum cleaners, dishwashers and water purifiers.", photo: 29149068 },
    { name: SERVICES, description: "Booked installation for ACs, TVs and washing machines, and phone set-up while you wait.", photo: 25809227 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "All smartphones", slug: "all-phones", description: "Every phone we stock, cheapest first.", rule: { category: PHONES, sort: "price-asc" } },
    { name: "5G phones", slug: "5g-phones", description: "5G on both SIMs, from ₹12,999.", rule: { tag: "5g", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Cross Cut Road buys every day.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "Festival offers", slug: "festival-offers", description: "The biggest discounts on MRP right now.", rule: { tag: "deal", sort: "price-asc" } },
    { name: "Student laptops and tablets", slug: "student-laptops", description: "Laptops and tablets for classes and homework.", rule: { tag: "student", sort: "price-asc" } },
    { name: "Big-screen TVs", slug: "big-screen-tvs", description: "Smart TVs from 32 to 75 inches and projectors.", rule: { tag: "tv", sort: "price-asc" } },
    { name: "Cool the room", slug: "cool-the-room", description: "Split, window and portable air conditioners.", rule: { tag: "cooling", sort: "price-asc" } },
    { name: "For the family", slug: "family-appliances", description: "Refrigerators and washing machines sized for a household.", rule: { tag: "family", sort: "price-asc" } },
    { name: "Gift ideas", slug: "gift-ideas", description: "Phones, earbuds, watches and gadgets that make good gifts.", rule: { tag: "gift", sort: "price-asc" } },
    { name: "Just landed", slug: "new-arrivals", description: "New stock as it reaches the shelves.", rule: { sort: "new" } },
  ],
  coupons: [
    {
      code: "UPGRADE1000",
      description: "Exchange bonus: ₹1,000 off any order above ₹15,000 when you bring your old phone to the counter",
      type: "flat",
      value: 100_000,
      minOrder: 1_500_000,
      channels: ["store", "manual"],
    },
    {
      code: "TECHFEST",
      description: "5% off orders above ₹30,000 (up to ₹3,000)",
      type: "percent",
      value: 5,
      minOrder: 3_000_000,
      maxDiscount: 300_000,
      channels: ["store", "manual"],
    },
    {
      code: "FIRSTTZ",
      description: "₹250 off your first order above ₹2,999",
      type: "flat",
      value: 25_000,
      minOrder: 299_900,
      firstOrderOnly: true,
      perCustomerLimit: 1,
      channels: ["store"],
    },
  ],
  home: ({ photo, category, product }) => ({
    seo: {
      title: "TechZone Mobiles, Coimbatore: phones, laptops, TVs, appliances",
      description:
        "Smartphones, laptops, tablets, smart TVs, refrigerators, washing machines and ACs with the IMEI or serial number on a GST bill, warranty lookup, no-cost EMI and free installation in Coimbatore.",
      imageUrl: photo(3756879),
    },
    sections: [
      {
        type: "hero-split",
        id: "tz-hero",
        imageUrl: photo(3756879, "tile"),
        imageSide: "right",
        eyebrow: "52 Cross Cut Road, Coimbatore",
        heading: "Phones, laptops, TVs and appliances, with the IMEI on your bill",
        text: "Every unit we sell is serial-numbered: your IMEI or serial goes on the GST bill, starts the warranty and can be looked up any time. No-cost EMI, exchange for your old phone, free installation in Coimbatore.",
        cta: { label: "Find your phone", href: "/c/smartphones" },
        cta2: { label: "Check a warranty", href: "/warranty" },
      },
      {
        type: "finder",
        id: "tz-finder",
        title: "Find your phone by budget and use",
        text: "Two taps: what you can spend and what matters most. The matching phones appear below; skip a question if you're not sure.",
        layout: "chips",
        results: "inline",
        limit: 8,
        questions: [
          {
            label: "Your budget",
            options: [
              { label: "Under ₹10,000", priceMax: rs(10_000), tag: "phone" },
              { label: "₹10,000 – ₹20,000", priceMin: rs(10_000), priceMax: rs(20_000), tag: "phone" },
              { label: "₹20,000 – ₹40,000", priceMin: rs(20_000), priceMax: rs(40_000), tag: "phone" },
              { label: "Above ₹40,000", priceMin: rs(40_000), tag: "phone" },
            ],
          },
          {
            label: "What matters most",
            options: [
              { label: "Everyday use", tag: "use-everyday" },
              { label: "Camera", tag: "use-camera" },
              { label: "Battery", tag: "use-battery" },
              { label: "Big screen", tag: "use-bigscreen" },
              { label: "Gaming", tag: "use-gaming" },
              { label: "Simple keypad phone", tag: "use-simple" },
            ],
          },
        ],
      },
      {
        type: "comparison",
        id: "tz-compare",
        title: "Four phones, side by side",
        text: "The four we sell most between ₹13,000 and ₹85,000. Prices are for the smallest storage; the product page has every storage and colour.",
        productIds: [product("Everyday 5G smartphone, 6.6-inch 90 Hz"), product("AMOLED 5G smartphone, 6.67-inch 120 Hz"), product("Camera 5G smartphone, 108 MP with OIS"), product("Flagship 5G smartphone, 6.7-inch LTPO OLED")],
        highlightId: product("AMOLED 5G smartphone, 6.67-inch 120 Hz"),
        highlightLabel: "Best value",
        showRating: false,
        rows: COMPARE_ROWS,
      },
      {
        type: "usp",
        id: "tz-promise",
        layout: "inline",
        items: [
          { icon: "check", title: "IMEI on the bill", text: "Serial-numbered units, warranty from the bill date" },
          { icon: "cash", title: "No-cost EMI", text: "3 to 12 months on partner cards" },
          { icon: "truck", title: "Free installation", text: "AC, TV and washer set up in Coimbatore" },
          { icon: "shield", title: "7-day replacement", text: "For a confirmed fault, no questions asked" },
        ],
      },
      {
        type: "categories",
        id: "tz-aisles",
        title: "Shop by department",
        categoryIds: [PHONES, LAPTOPS, TABLETS, TVS, FRIDGES, WASHERS, ACS, AUDIO, WATCHES, HOME].map(category),
        layout: "rounded-squares",
        showCounts: true,
        columns: "5",
      },
      {
        type: "text",
        id: "tz-emi",
        heading: "EMI made simple",
        markdown: `Pay for a ₹24,000 phone or a ₹24,000 washing machine over 3 to 12 months with **no-cost EMI** on credit cards of partner banks, or low-cost EMI on debit cards and through finance partners (Aadhaar + PAN, approved in 10 minutes at the counter).\n\n${EMI_TABLE}\n\nNo-cost EMI means the interest is waived by the bank against our discount: the price on your bill is the price you'd pay in cash. Offers on selected cards and models; demo placeholders.`,
        style: { background: "muted", span: "half" },
      },
      {
        type: "offer",
        id: "tz-exchange",
        eyebrow: "Exchange offer",
        heading: "Old phone in, ₹1,000 off a new one",
        text: "Bring your old phone to the counter: we value it in five minutes against any phone above ₹15,000 and add ₹1,000 off online with the code. Working phones are valued highest, cracked ones still count.",
        code: "UPGRADE1000",
        cta: { label: "Pick your next phone", href: "/c/smartphones" },
        style: { span: "half" },
      },
      {
        type: "flash-sale",
        id: "tz-flash",
        title: "Deepavali offers",
        text: "The biggest cuts on MRP until the festival: TVs, ACs, refrigerators and 5G phones. Delivered and installed before Deepavali if you order in time.",
        endsAt: "2026-11-12T21:30:00+05:30",
        source: "collection",
        collectionSlug: "festival-offers",
        layout: "grid",
        limit: 8,
        cta: { label: "See every offer", href: "/collections/festival-offers" },
      },
      {
        type: "product-tabs",
        id: "tz-tabs",
        title: "On the shelf now",
        layout: "carousel",
        limit: 8,
        tabs: [
          { label: "Just landed", source: "new" },
          { label: "Bestsellers", source: "bestsellers" },
          { label: "On offer", source: "sale" },
        ],
      },
      {
        type: "tiles",
        id: "tz-needs",
        title: "Shop by need",
        text: "Start from the job at home, not the model number.",
        layout: "row",
        showCounts: true,
        items: [
          { label: "Phones under ₹15,000", note: "5G with a day-long battery", imageUrl: photo(30277522, "tile"), tag: "under-15000" },
          { label: "For college", note: "Laptops and tablets for classes", imageUrl: photo(6611937, "tile"), collectionSlug: "student-laptops" },
          { label: "Cool the room", note: "Inverter splits and windows", imageUrl: photo(38788452, "tile"), collectionSlug: "cool-the-room" },
          { label: "Movie night", note: "TVs, soundbars and projectors", imageUrl: photo(6487954, "tile"), collectionSlug: "big-screen-tvs" },
          { label: "For the family", note: "Refrigerators and washing machines", imageUrl: photo(6956124, "tile"), collectionSlug: "family-appliances" },
        ],
      },
      {
        type: "image-text",
        id: "tz-warranty",
        imageUrl: photo(25809227, "tile"),
        imageSide: "left",
        heading: "Look up any warranty by IMEI",
        markdown: "Type the IMEI or serial number from your bill, the box or the phone's dialler (*#06#) and see when and where it was sold, when its warranty ends and every claim so far. Works for phones, laptops, TVs and appliances bought here, and it's free.",
        cta: { label: "Check my warranty", href: "/warranty" },
      },
      {
        type: "testimonials",
        id: "tz-voices",
        title: "From the counter",
        layout: "cards",
        items: [
          { quote: "Bought a 55-inch TV on Saturday, it was on my wall by Sunday noon, and the serial number was already on the bill. When the remote failed in week two they replaced it the same day.", name: "Senthil K.", role: "RS Puram", rating: 5 },
          { quote: "Traded in my old phone, got ₹1,000 off the new one and the data transfer done while I had a tea. The IMEI lookup on the website showed my warranty to the day.", name: "Meenakshi R.", role: "Peelamedu", rating: 5 },
          { quote: "The 12-month no-cost EMI on a washing machine, the installer showed my mother every programme. No hidden charges anywhere.", name: "Karthik S.", role: "Saibaba Colony", rating: 5 },
        ],
      },
      { type: "faq", id: "tz-faq", title: "Before you buy", items: FAQ },
      {
        type: "location",
        id: "tz-visit",
        title: "Visit us on Cross Cut Road",
        address: "52, Cross Cut Road, Gandhipuram, Coimbatore 641012",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "11.0183, 76.9631",
      },
    ],
    translations: {
      ta: {
        "tz-hero": {
          eyebrow: "52, கிராஸ் கட் ரோடு, கோயம்புத்தூர்",
          heading: "போன், லேப்டாப், டிவி, சாதனங்கள்: உங்கள் பில்லில் IMEI",
          text: "நாங்கள் விற்கும் ஒவ்வொரு பொருளுக்கும் தனித்த எண் உண்டு: IMEI அல்லது சீரியல் எண் GST பில்லில் அச்சாகி, வாரண்டியைத் தொடங்கி, எப்போது வேண்டுமானாலும் பார்க்கலாம். நோ-காஸ்ட் EMI, பழைய போனுக்கு எக்ஸ்சேஞ்ச், கோவையில் இலவச நிறுவல்.",
          cta: { label: "உங்கள் போனைக் கண்டுபிடியுங்கள்" },
          cta2: { label: "வாரண்டியைச் சரிபாருங்கள்" },
        },
        "tz-finder": {
          title: "பட்ஜெட், பயன்பாடு வாரியாக உங்கள் போனைக் கண்டுபிடியுங்கள்",
          text: "இரண்டு தட்டல்கள்: எவ்வளவு செலவிடலாம், எது முக்கியம். பொருந்தும் போன்கள் கீழே தெரியும்; தெரியாத கேள்வியைத் தவிர்க்கலாம்.",
          questions: [
            { label: "உங்கள் பட்ஜெட்", options: [{ label: "₹10,000-க்குள்" }, { label: "₹10,000 – ₹20,000" }, { label: "₹20,000 – ₹40,000" }, { label: "₹40,000-க்கு மேல்" }] },
            { label: "எது மிக முக்கியம்", options: [{ label: "அன்றாடப் பயன்பாடு" }, { label: "கேமரா" }, { label: "பேட்டரி" }, { label: "பெரிய திரை" }, { label: "கேமிங்" }, { label: "எளிய கீபேட் போன்" }] },
          ],
        },
        "tz-compare": {
          title: "நான்கு போன்கள், அருகருகே",
          text: "₹13,000 முதல் ₹85,000 வரை நாங்கள் அதிகம் விற்கும் நான்கு. விலைகள் குறைந்த சேமிப்பு மாடலுக்கு; எல்லா சேமிப்பு, நிறங்களும் பொருள் பக்கத்தில்.",
          highlightLabel: "சிறந்த மதிப்பு",
          rows: COMPARE_ROWS_TA,
        },
        "tz-promise": {
          items: [
            { title: "பில்லில் IMEI", text: "தனித்த எண் கொண்டவை, பில் தேதியிலிருந்து வாரண்டி" },
            { title: "நோ-காஸ்ட் EMI", text: "கூட்டாளி கார்டுகளில் 3 முதல் 12 மாதம்" },
            { title: "இலவச நிறுவல்", text: "கோவையில் AC, டிவி, வாஷர் பொருத்தம்" },
            { title: "7 நாள் மாற்றம்", text: "உறுதியான கோளாறுக்கு, கேள்வி இல்லை" },
          ],
        },
        "tz-aisles": { title: "பிரிவு வாரியாக வாங்குங்கள்" },
        "tz-emi": {
          heading: "எளிய EMI",
          markdown: `₹24,000 போன் அல்லது ₹24,000 வாஷிங் மெஷினை கூட்டாளி வங்கிகளின் கிரெடிட் கார்டில் **நோ-காஸ்ட் EMI**-யில் 3 முதல் 12 மாதங்களில் செலுத்துங்கள்; டெபிட் கார்டிலும் நிதி நிறுவனங்கள் மூலமும் குறைந்த செலவு EMI (ஆதார் + பான், கடையில் 10 நிமிடத்தில் ஒப்புதல்).\n\n${EMI_TABLE_TA}\n\nநோ-காஸ்ட் EMI என்றால் எங்கள் தள்ளுபடியால் வங்கி வட்டியை ஈடுசெய்யும்: பில்லில் உள்ள விலையே ரொக்கமாகச் செலுத்தும் விலை. தேர்ந்த கார்டுகள், மாடல்களுக்கு; டெமோ மாதிரிகள்.`,
        },
        "tz-exchange": {
          eyebrow: "எக்ஸ்சேஞ்ச் சலுகை",
          heading: "பழைய போன் கொடுங்கள், புதிய போனில் ₹1,000 தள்ளுபடி",
          text: "பழைய போனைக் கடைக்குக் கொண்டு வாருங்கள்: ₹15,000-க்கு மேலான எந்த போனுக்கும் ஐந்து நிமிடத்தில் மதிப்பிட்டு, கோடு மூலம் ஆன்லைனில் ₹1,000 கூடுதல் தள்ளுபடி தருவோம். வேலை செய்யும் போனுக்கு அதிக மதிப்பு; உடைந்ததற்கும் மதிப்பு உண்டு.",
          cta: { label: "உங்கள் அடுத்த போனைத் தேர்ந்தெடுங்கள்" },
        },
        "tz-flash": {
          title: "தீபாவளிச் சலுகைகள்",
          text: "பண்டிகை வரை MRP-யில் மிகப்பெரிய தள்ளுபடி: டிவி, AC, ஃப்ரிட்ஜ், 5G போன்கள். சரியான நேரத்தில் ஆர்டர் செய்தால் தீபாவளிக்கு முன் டெலிவரி, நிறுவல்.",
          cta: { label: "எல்லாச் சலுகைகளும்" },
        },
        "tz-tabs": { title: "இப்போது கடையில்", tabs: [{ label: "புதியவை" }, { label: "அதிகம் விற்பவை" }, { label: "சலுகையில்" }] },
        "tz-needs": {
          title: "தேவை வாரியாக வாங்குங்கள்",
          text: "மாடல் எண்ணிலிருந்து அல்ல, வீட்டுத் தேவையிலிருந்து தொடங்குங்கள்.",
          items: [
            { label: "₹15,000-க்குள் போன்கள்", note: "நாள் முழுதும் தாங்கும் பேட்டரியுடன் 5G" },
            { label: "கல்லூரிக்கு", note: "வகுப்புக்கான லேப்டாப், டேப்லெட்" },
            { label: "அறையைக் குளிர்விக்க", note: "இன்வெர்ட்டர் ஸ்பிளிட், விண்டோ" },
            { label: "சினிமா இரவு", note: "டிவி, சவுண்ட்பார், ப்ரொஜெக்டர்" },
            { label: "குடும்பத்துக்கு", note: "ஃப்ரிட்ஜ், வாஷிங் மெஷின்" },
          ],
        },
        "tz-warranty": {
          heading: "IMEI மூலம் எந்த வாரண்டியையும் பாருங்கள்",
          markdown: "பில், பெட்டி அல்லது போனின் டயலர் (*#06#) காட்டும் IMEI அல்லது சீரியல் எண்ணைத் தட்டச்சு செய்தால், அது எப்போது, எங்கே விற்கப்பட்டது, வாரண்டி எப்போது முடிகிறது, இதுவரை உள்ள கிளெய்ம்கள் தெரியும். இங்கு வாங்கிய போன், லேப்டாப், டிவி, சாதனங்களுக்கு வேலை செய்யும்; இலவசம்.",
          cta: { label: "என் வாரண்டியைச் சரிபார்" },
        },
        "tz-voices": {
          title: "கடையிலிருந்து",
          items: [
            { quote: "சனிக்கிழமை 55-அங்குல டிவி வாங்கினேன்; ஞாயிறு மதியத்துக்குள் சுவரில் பொருத்தப்பட்டது, பில்லில் சீரியல் எண் ஏற்கனவே இருந்தது. இரண்டாம் வாரம் ரிமோட் பழுதானபோது அன்றே மாற்றித் தந்தார்கள்." },
            { quote: "பழைய போனைக் கொடுத்து புதியதில் ₹1,000 தள்ளுபடி பெற்றேன்; தேநீர் குடிக்கும் நேரத்தில் டேட்டாவும் மாற்றித் தந்தார்கள். இணையதளத்தில் IMEI தேடினால் வாரண்டி நாள் வரை தெரிந்தது." },
            { quote: "வாஷிங் மெஷினுக்கு 12 மாத நோ-காஸ்ட் EMI; பொருத்த வந்தவர் என் அம்மாவுக்கு எல்லா புரோகிராமையும் காட்டினார். மறைமுகக் கட்டணம் எதுவும் இல்லை." },
          ],
        },
        "tz-faq": { title: "வாங்கும் முன்", items: FAQ_TA },
        "tz-visit": {
          title: "கிராஸ் கட் ரோட்டில் எங்களைக் காணுங்கள்",
          address: "52, கிராஸ் கட் ரோடு, காந்திபுரம், கோயம்புத்தூர் 641012",
          hours: [
            { label: "திங்கள் – சனி", value: "காலை 10:00 – இரவு 9:30" },
            { label: "ஞாயிறு", value: "காலை 10:30 – இரவு 8:30" },
          ],
        },
      },
    },
  }),
  pages: [
    {
      slug: "emi-and-exchange",
      title: "EMI and exchange",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "No-cost and low-cost EMI" },
        {
          type: "paragraph",
          markdown:
            "| Option | Who | Tenure |\n|---|---|---|\n| **No-cost EMI** | Credit cards of partner banks, orders above ₹10,000 | 3, 6, 9, 12 months |\n| **Low-cost EMI** | Debit cards of partner banks | 6, 9, 12 months |\n| **Finance partner** | Aadhaar + PAN + bank account, approved at the counter in 10 minutes | 6 to 18 months |\n\nNo-cost EMI means the bank's interest is covered by a discount on the price, so the amount you pay in total is the price on your bill. Processing fees and eligibility are set by the bank. This is a demo store: the plans are placeholders.",
        },
        { type: "image", url: photo(11297769, "tile"), alt: "Phones displayed on tables in a phone store" },
        { type: "heading", level: 2, text: "Exchange your old phone" },
        {
          type: "paragraph",
          markdown:
            "Bring the phone, its charger and your ID to the Cross Cut Road counter. We check the screen, the battery, the buttons and the IMEI (it must not be blocked), then give you a value in five minutes that comes off your bill. Online orders can use the **UPGRADE1000** coupon for ₹1,000 off orders above ₹15,000, in addition to the counter valuation. Remove your SIM and sign out of your accounts; we wipe the phone in front of you.",
        },
        { type: "button", label: "Ask us on WhatsApp", href: waLink("Hello TechZone, what is my old phone worth? Model: … Condition: …"), style: "primary" },
      ],
    },
    {
      slug: "warranty-and-service",
      title: "Warranty and service",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "How the warranty works" },
        {
          type: "paragraph",
          markdown:
            "Every phone, laptop, tablet, TV, refrigerator, washing machine, air conditioner and smartwatch is sold by serial number. The IMEI or serial is printed on your GST bill and its warranty starts on the **bill date**. Look it up any time on the [Warranty page](/warranty).\n\n| Product | Warranty |\n|---|---|\n| Smartphones and tablets | 12 months |\n| Laptops | 12 months on-site in Coimbatore |\n| TVs | 12 months + 12 to 24 months on the panel |\n| Refrigerators and ACs | 12 months, 5 to 10 years on the compressor |\n| Washing machines | 12 to 24 months, 10 years on the motor |\n| Smartwatches and earbuds | 12 months |",
        },
        { type: "image", url: photo(25809227, "tile"), alt: "Tablets and phones on a store counter" },
        { type: "heading", level: 2, text: "If something goes wrong" },
        {
          type: "paragraph",
          markdown:
            "Within 7 days of delivery a confirmed fault means a replacement. After that, bring the product with the bill (or tell us the IMEI) to the counter and we raise the claim with the brand's service centre, keep you updated on WhatsApp and note it on the warranty record. Physical damage, water damage and opened devices aren't covered. Large appliances are repaired at home.",
        },
        { type: "button", label: "Check a warranty", href: "/warranty", style: "primary" },
      ],
    },
    {
      slug: "about",
      title: "About us",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "TechZone Mobiles, Cross Cut Road, since 2011" },
        {
          type: "paragraph",
          markdown:
            "We began as a two-table mobile shop on **Cross Cut Road** in Gandhipuram, Coimbatore, and grew into a full electronics store because customers kept asking where to buy the TV, the AC and the washing machine, and who would install them. We still do the one thing that built the shop: every phone and appliance goes out with its IMEI or serial number on the bill, so the warranty is never a guess.\n\nThis is a demo store: its products are generic, and the address, phone number and offers are placeholders.",
        },
        { type: "image", url: photo(31145466, "tile"), alt: "Laptops and tablets on display tables in an electronics store" },
        { type: "paragraph", markdown: "Open Monday to Saturday 10:00 am – 9:30 pm, Sunday 10:30 am – 8:30 pm. Call or WhatsApp **+91 98765 00009**." },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' models, not our customers or staff, and the products shown are stand-ins for the generic products named.\n\n| Photo | Photographer | Link |\n|---|---|---|\n${Object.entries(PHOTOS)
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Phones", type: "category", ref: "smartphones" },
      { label: "Laptops", type: "category", ref: "laptops" },
      { label: "TVs", type: "category", ref: "smart-tvs-and-projectors" },
      { label: "Appliances", type: "category", ref: "air-conditioners" },
      { label: "Offers", type: "collection", ref: "festival-offers" },
      { label: "Warranty lookup", type: "url", href: "/warranty" },
    ],
    footer: [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Warranty lookup", type: "url", href: "/warranty" },
          { label: "Warranty and service", type: "page", ref: "warranty-and-service" },
          { label: "EMI and exchange", type: "page", ref: "emi-and-exchange" },
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
        ],
      },
      {
        label: "Shop",
        type: "url",
        children: [
          { label: "5G phones", type: "collection", ref: "5g-phones" },
          { label: "Student laptops", type: "collection", ref: "student-laptops" },
          { label: "Cool the room", type: "collection", ref: "cool-the-room" },
          { label: "Installation & set-up", type: "category", ref: "installation-and-set-up" },
          { label: "About us", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
};
