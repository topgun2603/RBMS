import { CAT, menuProducts } from "./theneer-menu";
import { setupTheneer } from "./theneer-setup";
import type { DemoStore } from "./types";

/**
 * Store #19 of the series: Theneer Kadai, a tea stall and juice bar on Sannidhi Street, Mylapore, Chennai
 * (theneer.localhost:3003). A counter-first street-corner shop on the restaurant app (RS) with the `tea_stall` trade (QR
 * table ordering is off: you order at the counter, take a token, or order online for pickup) and the "signboard" look
 * (enamel-board teal and marigold on warm paper, a ticker of daily offers, filled tiles with Add always visible, a
 * category rail and a phone tab bar). Theneer (தேநீர்) is Tamil for tea. The menu (theneer-menu.ts, shared with the
 * history simulator's `tea_stall` profile): tea and coffee, milk and malt drinks, fresh juices, milkshakes, jigarthanda,
 * rose milk, nannari sarbath, snacks, bakery bites and combos, in Small and Large; names are generic (no brands); prices
 * are typical Chennai tea-kadai prices in 2026, GST included. Address, phone, GSTIN and the FSSAI number are
 * placeholders like the other demo shops.
 *
 * GST: served drinks and snacks are restaurant service (SAC 996331, which includes takeaway) from a stand-alone
 * eatery: 5% (CGST 2.5% + SGST 2.5%) without input tax credit (Sr. No. 7(ii) of 11/2017-Central Tax (Rate)); the
 * 22 Sept 2025 rate changes (CGST 9/2025 and 15/2025-Central Tax (Rate)) did not touch standalone restaurant service.
 * The counter's packed bakery goods (buns, cream rolls, puffs, rusk, biscuits) are goods of heading 1905: biscuits,
 * pastries and rusk 5% since 22 Sept 2025 (the same entries as porunai.ts, store #2). Sources: the same as vaasam.ts
 * (store #18): CBIC notifications and the busy.in / Petpooja summaries of the 22 Sept 2025 changes.
 */

const PHONE = "+919876500022";
const WHATSAPP = "919876500022";
const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
/** A translated plan: built through a helper so plans that differ in shape (a badge or not) stay assignable. */
const plan = (o: Record<string, string | string[] | { label: string }>) => o;
const rs = (rupees: number) => Math.round(rupees * 100);

const HOURS = [
  { label: "Every day", value: "5:30 am - 11:00 pm" },
  { label: "Juice counter", value: "10:00 am - 10:30 pm" },
  { label: "Evening snacks", value: "4:00 pm - 6:30 pm, hot from the pan" },
];
const HOURS_TA = [
  { label: "தினமும்", value: "காலை 5:30 - இரவு 11:00" },
  { label: "ஜூஸ் கவுண்டர்", value: "காலை 10:00 - இரவு 10:30" },
  { label: "மாலைச் சிற்றுண்டி", value: "மாலை 4:00 - 6:30, சூடாகக் கடாயிலிருந்து" },
];

const FAQ = [
  { q: "Do I order at the counter or online?", a: "Both. At the counter you order, pay (cash or UPI) and take a **token**; we call the number when it is ready. Online, pick **pickup**, choose your items and sizes, and walk in to collect: no queue, no waiting for the tea." },
  { q: "What do Small and Large mean?", a: "A **Small** tea or coffee is a 100 ml cup, a **Large** is 200 ml. Juices and shakes are 250 ml and 400 ml. For snacks, Small is one or three pieces and Large is two or six: the item page says which." },
  { q: "How do the monthly tea cards work?", a: "A shop or small office takes a **tea card**: 50 teas or coffees for Rs 500 a month, used any day, billed at month end by UPI or cash. For a bigger office we send a steel flask and paper cups every morning and evening: see the plans below." },
  { q: "Do you press juice fresh?", a: "Yes, to order, with the fruit on the counter. The **Today's juices** board on this page shows what is ripe: oranges and mosambi most of the year, watermelon and mango in summer, sugarcane pressed in front of you." },
  { q: "Can I have less sugar?", a: "Say **sugar kammi** (less sugar) or **sugar illama** (no sugar) at the counter, or write it in the order note online. Juices have no sugar added unless you ask." },
];
const FAQ_TA = [
  { q: "கவுண்டரில் ஆர்டர் செய்வதா, ஆன்லைனிலா?", a: "இரண்டும் முடியும். கவுண்டரில் ஆர்டர் செய்து, பணம் அல்லது UPI-யில் செலுத்தி **டோக்கன்** பெறுங்கள்; தயாரானதும் எண்ணை அழைப்போம். ஆன்லைனில் **பிக்-அப்** தேர்ந்து, பொருட்களையும் அளவையும் தேர்ந்தெடுத்து வந்து எடுத்துச் செல்லுங்கள்: வரிசை இல்லை, டீக்காகக் காத்திருக்க வேண்டாம்." },
  { q: "ஸ்மால், லார்ஜ் என்றால் என்ன?", a: "**ஸ்மால்** டீ, காபி 100 மி.லி. கப்; **லார்ஜ்** 200 மி.லி. ஜூஸ், ஷேக் 250, 400 மி.லி. சிற்றுண்டிக்கு ஸ்மால் என்றால் ஒன்று அல்லது மூன்று, லார்ஜ் என்றால் இரண்டு அல்லது ஆறு: பொருளின் பக்கத்தில் இருக்கும்." },
  { q: "மாதாந்திர டீ கார்டு எப்படி?", a: "கடை அல்லது சிறிய அலுவலகம் **டீ கார்டு** எடுக்கலாம்: மாதம் ரூ 500-க்கு 50 டீ அல்லது காபி, எந்த நாளும் பயன்படுத்தலாம், மாத இறுதியில் UPI அல்லது பணமாகக் கட்டணம். பெரிய அலுவலகத்துக்கு ஒவ்வொரு காலையும் மாலையும் ஸ்டீல் ஃபிளாஸ்கும் பேப்பர் கப்பும் அனுப்புகிறோம்: கீழே உள்ள திட்டங்களைப் பாருங்கள்." },
  { q: "ஜூஸ் புதிதாகப் பிழிகிறீர்களா?", a: "ஆம், ஆர்டர் செய்ததும், கவுண்டரில் இருக்கும் பழத்திலிருந்து. இந்தப் பக்கத்தில் உள்ள **இன்றைய ஜூஸ்** பலகை என்ன பழுத்திருக்கிறது என்று காட்டும்: ஆண்டு முழுவதும் ஆரஞ்சு, மோசம்பி; கோடையில் தர்பூசணி, மாம்பழம்; கரும்புச்சாறு உங்கள் கண் முன்னே." },
  { q: "சர்க்கரை குறைவாகக் கிடைக்குமா?", a: "கவுண்டரில் **சுகர் கம்மி** அல்லது **சுகர் இல்லாமல்** என்று சொல்லுங்கள், ஆன்லைனில் குறிப்பில் எழுதுங்கள். கேட்காவிட்டால் ஜூஸில் சர்க்கரை சேர்ப்பதில்லை." },
];

const PHOTOS: Record<number, { by: string; alt: string }> = {
  13377433: { by: "Amir Shrestha", alt: "Milk tea in a glass on a stove, steam rising" },
  18030044: { by: "Sreeraj R", alt: "A steaming glass of masala chai casting a long shadow in warm sunlight on a rustic cloth surface" },
  20270270: { by: "Sanket Sawale", alt: "Close-up of masala chai in clay cups surrounded by ginger and cardamom for a rustic look" },
  31141291: { by: "thel0stkidd .", alt: "Authentic Indian chai tea in a glass on a wooden table, evoking traditional tea culture" },
  18336646: { by: "Vijay Krishnam", alt: "A close-up shot of a wristwatch on an arm beside a steaming cup of coffee in a steel tumbler" },
  6307233: { by: "Magali Guimarães", alt: "Coffee decoction dripping through a cloth filter into a green enamel mug" },
  16128085: { by: "Akshata Bablad", alt: "Close-up of Indian filter coffee served in traditional brass cups on a table" },
  11588452: { by: "Büşra Arabacı", alt: "A warm, creamy drink topped with cinnamon served in a glass cup on a wooden coaster indoors" },
  26755317: { by: "Feyza Daştan", alt: "A warm vintage setting with milk pouring into coffee, accented by a floral background" },
  17272971: { by: "Gül Işık", alt: "Stylish flat lay of almond milk with scattered almonds and golden cutlery on white surface" },
  15082978: { by: "Shameel mukkath", alt: "Two glasses of turmeric milk with spices on a rustic wooden table setting" },
  18142621: { by: "Denys Gromov", alt: "Creamy chocolate milkshake in a tall glass with chocolate drizzle on a neutral background" },
  5511227: { by: "ABHISHEK HAJARE", alt: "Tall glass of orange juice with a lemon slice and straw" },
  30900665: { by: "Stephen Leonardi", alt: "A vibrant glass of orange juice with a fresh orange slice for a healthy refreshment" },
  11009208: { by: "Shameel mukkath", alt: "Tall glass of vibrant watermelon juice with a straw and fresh slice" },
  35020135: { by: "César O'neill", alt: "A vibrant yellow fruit juice in a clear glass, set against a white background" },
  18142601: { by: "Denys Gromov", alt: "Tall glass of vibrant pomegranate juice with a lemon slice on a neutral background" },
  8215113: { by: "Kindel Media", alt: "Colorful assortment of fresh fruit juices and fruits on a sunny outdoor table" },
  11009205: { by: "Shameel mukkath", alt: "A vibrant display of fresh fruit juices in the sunlight with various garnishes" },
  5817621: { by: "Shameel mukkath", alt: "A refreshing glass of mango juice garnished with mango slices" },
  31490093: { by: "Kalina Gakhal", alt: "Banana and mango shakes in mason jars with striped straws" },
  17429505: { by: "Jonathan Reynaga", alt: "A tall glass of chocolate milkshake with whipped cream and cookie, ideal for dessert lovers" },
  28162736: { by: "ahmed akeri", alt: "A tall glass of chocolate milkshake topped with whipped cream and a straw, served on a rustic table" },
  8211179: { by: "Arun Thomas", alt: "Delicious mango smoothie in a glass surrounded by fresh mangoes" },
  18646641: { by: "Dreamer Dude", alt: "A tempting glass of falooda topped with pistachios and rose syrup, captured elegantly in Dubai" },
  31540470: { by: "Esra Afşar", alt: "Bright pink iced drink served in a glass on a table in an Istanbul cafe" },
  10323614: { by: "Jhonny Salas Brochero", alt: "Close-up of a refreshing citrus mint lemonade held in a textured glass on a wooden table" },
  18142603: { by: "Denys Gromov", alt: "A chilled glass of lassi garnished with fresh mint leaves" },
  4324320: { by: "Engin Akyurt", alt: "A top-down view of a foamy glass of milk on a white marble surface. Perfect for a healthy lifestyle concept" },
  4045205: { by: "prasannabaarathi", alt: "A tall glass of lime soda with ice and citrus fruits on a sunny day" },
  19664357: { by: "aboodi vesakaran", alt: "Vada in a bowl with a glass of tea beside it" },
  21751212: { by: "SRIPADA STUDIOS", alt: "Close-up of traditional Indian vada doughnuts in a bowl on a bright yellow background" },
  29547418: { by: "apertur 2.8", alt: "Golden brown Indian pakoras freshly fried and resting on paper towel in kitchen setting" },
  20220705: { by: "Su La Pyae", alt: "Delicious deep-fried fritters served with a tangy dip on a plate" },
  9027521: { by: "I Own My Food Art", alt: "Top view of crispy samosas served with green and tamarind chutneys on a white plate" },
  23384616: { by: "Adrianna CA", alt: "Spiced chickpeas with onion and coriander on a plate" },
  36739323: { by: "Amjad ali", alt: "A plate of golden fried fritters" },
  27396343: { by: "Shambhudananda Sahoo", alt: "Top view of a toasted bread slice over an omelette on a white plate with a fork" },
  16107642: { by: "Anthony Rahayel", alt: "Golden brown buns fresh from the oven, showcasing artisanal baking" },
  10298082: { by: "TUBARONES PHOTOGRAPHY", alt: "Sugar-dusted rolls on a white plate" },
  1346216: { by: "Alisha Mishra", alt: "Appetizing homemade pastries with sesame seeds and cookies, presented with fresh leaves on a light surface" },
  14886371: { by: "Miff Ibra", alt: "Freshly baked pastry filled with meat and eggs on a wooden board, ideal for culinary visuals" },
  18724102: { by: "Abdurrahim Israfilov", alt: "Freshly baked almond bread slices in a basket with a warm background" },
  31909870: { by: "Marcos Sánchez", alt: "High-resolution photo of tasty Marie biscuits stacked closely" },
  15290322: { by: "Velroy Fernandes", alt: "Close-up of square biscuits on a plate with warm lighting" },
  13220364: { by: "Saveurs Secretes", alt: "Delicious crispy pakoras served with traditional Indian chai" },
  12865880: { by: "krishna prasad", alt: "Charming setup featuring a brass kettle and glasses of Indian chai on a rustic table" },
  35066809: { by: "Milton Das", alt: "Delicious crispy pakoras served with tangy ketchup on a pastel backdrop" },
  28219383: { by: "Baran Robin", alt: "Close-up of golden brown buns stacked on a wooden board, showcasing fresh bakery goods" },
  33339360: { by: "Ars Visions", alt: "A vendor prepares steaming chai on the busy streets of Varanasi, India" },
  10389156: { by: "Swastik Arora", alt: "A close-up of traditional chai being poured from a kettle in an outdoor urban market setting" },
  37867755: { by: "Preyansh patel", alt: "A street vendor pouring hot chai tea into a cup at a bustling market kitchen" },
  30855290: { by: "Cihan Çimen", alt: "A street fruit stall with oranges, apples and pineapples and water bottles below" },
  16387070: { by: "iPhone Snaps 🇨🇦", alt: "Close-up of a manual sugarcane machine in action at a bustling street market" },
  37720390: { by: "Dibyajyoti Das", alt: "Capturing an Indian street vendor expertly preparing chai with steamy pots and vibrant background" },
  31822992: { by: "Allan González", alt: "Colourful fresh juices in glasses on a plate" },
  15211517: { by: "anil kumar", alt: "Close-up of tea being poured into glasses in Darjeeling, capturing India's tea culture" },
  10377676: { by: "Mahesh E", alt: "A close-up shot of a hand holding a traditional clay cup filled with masala chai outdoors" },
};

export const THENEER: DemoStore = {
  shop: {
    slug: "theneer",
    appId: "RS",
    businessType: "tea_stall",
    planId: "pro",
    name: "Theneer Kadai",
    primary: "#077886",
    billing: {
      legalName: "Theneer Kadai",
      gstin: "33AAUFT6284K1ZD",
      address: "28, Sannidhi Street, Mylapore",
      city: "Chennai",
      pincode: "600004",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TK",
      upiId: "theneerkadai@okicici",
    },
    // The counter sells the catalogue items themselves: no extra billing items.
    items: [],
  },
  preset: "signboard",
  store: {
    open: true,
    codEnabled: true,
    codMaxAmount: 100_000,
    minOrderValue: 0,
    deliveryEnabled: true,
    pickupEnabled: true,
    pickupNote: "Ready in 5 to 10 minutes at the tea counter. Give your name or token number.",
    contactPhone: PHONE,
    contactEmail: "hello@theneerkadai.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/theneerkadai" },
    policies: {
      shipping:
        "**Pickup (the usual way):** order online, walk in and give your name or token at the counter; ready in 5 to 10 minutes. No charge.\n\n**Near us:** Mylapore, Alwarpet, Mandaveli and Santhome, delivered by our own boy in 20 to 30 minutes, Rs 20, free above Rs 199 (7 am to 9 pm).\n\n**Office flasks and function tea:** anywhere in Chennai, order a day ahead, Rs 60.",
      returns:
        "Food and drinks cannot be returned. If something is wrong, cold or spilt, tell the counter or message us on WhatsApp within 15 minutes and we make it again or refund it.",
      privacy: "We use your name and phone only to call your token, deliver your order and send your GST bill. We do not share them with anyone.",
      terms:
        "Prices include GST at 5% (restaurant service, no input tax credit; packed bakery goods 5%). Juice flavours change with the season. The evening 4 to 6 pm offers run every day while the pans are hot. FSSAI licence: 12345678901234 (placeholder).",
    },
    businessType: "tea_stall",
  },
  zones: [
    {
      name: "Mylapore, Alwarpet, Mandaveli, Santhome (20-30 min)",
      pincodePrefixes: ["60000", "60001", "60002"],
      rate: { name: "Delivery in 20-30 min", type: "free_above", amount: 2_000, freeAbove: 19_900, etaMinDays: 0, etaMaxDays: 0, codAllowed: true, codFee: 0 },
    },
    {
      name: "Chennai office flasks and function tea (a day ahead)",
      pincodePrefixes: ["600"],
      rate: { name: "Scheduled delivery, order a day ahead", type: "flat", amount: 6_000, etaMinDays: 1, etaMaxDays: 1, codAllowed: false, codFee: 0 },
    },
  ],
  categories: [
    { name: CAT.tea, description: "Tea, masala and ginger tea, filter coffee, sukku malli and karupatti coffee, in a 100 ml or 200 ml cup.", photo: 13377433 },
    { name: CAT.milk, description: "Hot and cold malt drinks, hot milk, badam milk and turmeric milk.", photo: 11588452 },
    { name: CAT.juice, description: "Fruit pressed when you order: orange, mosambi, watermelon, sugarcane, pineapple, pomegranate and the seasonal mango.", photo: 11009205 },
    { name: CAT.shakes, description: "Banana, chocolate, dates and mango milkshakes, thick and cold.", photo: 17429505 },
    { name: CAT.cool, description: "Jigarthanda, rose milk, nannari sarbath, lassi, buttermilk and fresh lime soda.", photo: 31540470 },
    { name: CAT.snacks, description: "Medu vada, bajji, bonda, samosa, sundal and bread omelette, fried through the day.", photo: 35066809 },
    { name: CAT.bakery, description: "Butter buns, cream rolls, puffs, rusk and biscuits for dunking.", photo: 16107642 },
    { name: CAT.combos, description: "Tea and vada, the evening snack combo and steel flasks for the office.", photo: 19664357 },
  ],
  products: menuProducts(),
  collections: [
    { name: "New at the counter", slug: "new-in", description: "Fresh on the menu this month.", rule: { sort: "new" } },
    { name: "Today's juices", slug: "todays-juices", description: "The juices pressed fresh today, from the board by the counter.", rule: { tag: "todays-juice", sort: "price-asc" } },
    { name: "Evening 4 to 6 pm", slug: "evening", description: "Hot snacks, tea and combos at their evening prices.", rule: { tag: "evening", sort: "price-asc" } },
    { name: "Hot", slug: "hot", description: "Everything served hot: tea, coffee, milk, vada and bajji.", rule: { tag: "hot", sort: "price-asc" } },
    { name: "Cold", slug: "cold", description: "Juices, shakes, jigarthanda, sarbath and buttermilk.", rule: { tag: "cold", sort: "price-asc" } },
    { name: "Morning favourites", slug: "morning", description: "Tea, filter coffee, vada, bun and bread omelette: the 6 to 9 am queue.", rule: { tag: "morning", sort: "price-asc" } },
    { name: "Office tea", slug: "office", description: "Steel flasks of tea or coffee for offices and shops.", rule: { tag: "office", sort: "price-asc" } },
    { name: "Bestsellers", slug: "bestsellers", description: "What Mylapore orders again and again.", rule: { tag: "bestseller", sort: "price-asc" } },
    { name: "On offer", slug: "on-offer", description: "Items below their MRP right now.", rule: { onSale: true, sort: "price-asc" } },
  ],
  coupons: [
    {
      code: "KADAI10",
      description: "10% off online pickup orders above Rs 150 (up to Rs 40)",
      type: "percent",
      value: 10,
      minOrder: 15_000,
      maxDiscount: 4_000,
      channels: ["store"],
    },
    {
      code: "OFFICE5",
      description: "Office flasks: 5% off orders above Rs 1,000 (up to Rs 300)",
      type: "percent",
      value: 5,
      minOrder: 100_000,
      maxDiscount: 30_000,
      channels: ["store", "manual"],
    },
  ],
  home: ({ photo }) => {
    return {
      seo: {
        title: "Theneer Kadai, Mylapore: tea, filter coffee, fresh juice and snacks",
        description:
          "A Mylapore tea stall and juice bar open 5:30 am to 11 pm: tea and filter coffee, fresh juices, jigarthanda, nannari sarbath, vada and bajji. Order at the counter or online for pickup; monthly tea cards for offices.",
        imageUrl: photo(33339360),
      },
      sections: [
        {
          type: "hero",
          id: "tk-hero",
          slides: [
            {
              imageUrl: photo(33339360),
              heading: "Hot tea from 5:30 am. Fresh juice till 10:30 pm.",
              subheading: "Theneer Kadai, Sannidhi Street, Mylapore. Order at the counter or online for pickup; we call your token.",
              cta: { label: "Order now", href: "/collections/bestsellers" },
            },
            {
              imageUrl: photo(30855290),
              heading: "Pressed while you watch.",
              subheading: "Oranges, mosambi, watermelon, sugarcane and pineapple, cut and pressed to order. No water, no added sugar.",
              cta: { label: "Today's juices", href: "/collections/todays-juices" },
            },
            {
              imageUrl: photo(31822992),
              heading: "Cool for the afternoon.",
              subheading: "Jigarthanda, rose milk, nannari sarbath, buttermilk and lime soda, in a 250 ml or 400 ml glass.",
              cta: { label: "Cold drinks", href: "/collections/cold" },
            },
          ],
        },
        {
          type: "location",
          id: "tk-location",
          title: "Find us, open every day",
          address: "28, Sannidhi Street, Mylapore, Chennai 600004 (two minutes from the Kapaleeshwarar temple tank)",
          hours: HOURS,
          phone: PHONE,
          whatsapp: PHONE,
          coords: "13.0337, 80.2697",
          mapLink: "https://www.google.com/maps/search/?api=1&query=Kapaleeshwarar+Temple+Mylapore+Chennai",
          style: { span: "half" },
        },
        {
          type: "offer",
          id: "tk-offer",
          eyebrow: "Order online, skip the queue",
          heading: "10% off your first pickup order",
          text: "Order from your phone, walk in and collect with your name. Above Rs 150, up to Rs 40 off.",
          code: "KADAI10",
          endsAt: "2027-03-31T23:59:00+05:30",
          cta: { label: "Start an order", href: "/collections/bestsellers" },
          style: { span: "half", background: "brand" },
        },
        {
          type: "stories",
          id: "tk-stories",
          title: "The morning crowd",
          layout: "rings",
          items: [
            { imageUrl: photo(37720390), title: "First boil", text: "The kettles are steaming by 5:30, before the temple bells.", href: "/collections/morning", ctaLabel: "Morning favourites" },
            { imageUrl: photo(15211517), title: "The 7:30 queue", text: "Forty glasses poured in a row, tea and filter coffee, for the walkers and the bus stop.", href: "/collections/hot", ctaLabel: "See hot drinks" },
            { imageUrl: photo(16387070), title: "Cane press", text: "Sugarcane juice with ginger and lemon, pressed in front of you.", href: "/collections/todays-juices", ctaLabel: "Today's juices" },
            { imageUrl: photo(37867755), title: "Filter coffee", text: "Decoction, thick milk and a long pour: degree coffee the Mylapore way.", href: "/collections/hot", ctaLabel: "Order a coffee" },
            { imageUrl: photo(10377676), title: "Rainy day", text: "Ginger tea in a clay cup when it pours on Sannidhi Street.", href: "/collections/hot", ctaLabel: "Hot drinks" },
          ],
        },
        {
          type: "menu-board",
          id: "tk-board",
          title: "Today's board",
          groups: [
            {
              name: "Hot now",
              items: [
                { name: "Tea", description: "100 ml · 200 ml ₹20", price: rs(12), diet: "veg" },
                { name: "Masala tea", description: "100 ml · 200 ml ₹25", price: rs(15), diet: "veg" },
                { name: "Filter coffee", description: "100 ml · 200 ml ₹30", price: rs(20), diet: "veg" },
                { name: "Medu vada", description: "One piece · two ₹18", price: rs(10), diet: "veg" },
              ],
            },
            {
              name: "Juices pressed today",
              items: [
                { name: "Orange juice", description: "250 ml · 400 ml ₹70", price: rs(40), diet: "veg" },
                { name: "Mosambi juice", description: "250 ml · 400 ml ₹70", price: rs(40), diet: "veg" },
                { name: "Watermelon juice", description: "250 ml · 400 ml ₹50", price: rs(30), diet: "veg" },
                { name: "Pineapple juice", description: "250 ml · 400 ml ₹70", price: rs(40), diet: "veg" },
                { name: "Sugarcane juice", description: "250 ml · 400 ml ₹40", price: rs(25), diet: "veg" },
              ],
            },
            {
              name: "Cool and sweet",
              items: [
                { name: "Jigarthanda", description: "250 ml · 400 ml ₹80", price: rs(50), diet: "veg" },
                { name: "Nannari sarbath", description: "250 ml · 400 ml ₹35", price: rs(20), diet: "veg" },
                { name: "Buttermilk", description: "250 ml · 400 ml ₹25", price: rs(15), diet: "veg" },
              ],
            },
            {
              name: "Fresh from the pan, 4 pm onwards",
              items: [
                { name: "Onion bajji", description: "3 pieces · 6 ₹35", price: rs(20), diet: "veg" },
                { name: "Potato bonda", description: "One piece · two ₹22", price: rs(12), diet: "veg" },
                { name: "Samosa", description: "One piece · two ₹22", price: rs(12), diet: "veg" },
              ],
            },
          ],
          cta: { label: "See the full menu", href: "/collections/new-in" },
          style: { background: "muted" },
        },
        {
          type: "flash-sale",
          id: "tk-evening",
          title: "Evening 4 to 6 pm",
          text: "Every evening the pans are hot: tea and vada, the snack combo and coffee with bonda at their evening prices.",
          endsAt: "2027-03-31T23:59:00+05:30",
          daily: { from: "16:00", to: "18:00" },
          source: "collection",
          collectionSlug: "evening",
          layout: "grid",
          limit: 4,
          cta: { label: "All evening items", href: "/collections/evening" },
        },
        {
          type: "finder",
          id: "tk-finder",
          title: "What are you in the mood for?",
          text: "Three taps and we show you the cup.",
          layout: "chips",
          results: "inline",
          imageUrl: photo(10389156),
          limit: 6,
          questions: [
            {
              label: "Hot or cold?",
              options: [
                { label: "Hot", tag: "hot" },
                { label: "Cold", tag: "cold" },
              ],
            },
            {
              label: "Sweet or spicy?",
              options: [
                { label: "Sweet", tag: "sweet" },
                { label: "Spicy", tag: "spicy" },
              ],
            },
            {
              label: "How big?",
              options: [
                { label: "Small", filterName: "Size", filterValue: "Small" },
                { label: "Large", filterName: "Size", filterValue: "Large" },
              ],
            },
          ],
        },
        {
          type: "category-shelf",
          id: "tk-menu",
          title: "The whole menu",
          showImages: true,
          limit: 8,
        },
        {
          type: "pricing-table",
          id: "tk-cards",
          title: "Tea cards and office tea",
          text: "For the shops, clinics and offices of Mylapore: pay once a month, drink all month.",
          plans: [
            {
              name: "Monthly tea card",
              price: rs(500),
              period: "/ month",
              description: "For a shop or a small office.",
              features: ["50 small teas or filter coffees", "Use any day, any time we are open", "Bill at month end by UPI or cash", "Share the card with your team"],
              highlight: false,
              cta: { label: "Ask for a card", href: waLink("Hello Theneer Kadai, I would like a monthly tea card for our shop. Name and address: …") },
            },
            {
              name: "Office flask supply",
              price: rs(5200),
              period: "/ month",
              description: "A steel flask and cups, twice a day.",
              features: ["A 1-litre flask of tea or coffee at 10 am and 4 pm", "About 8 cups each time, paper cups included", "26 working days, within 1 km of Sannidhi Street", "Bill at month end, GST invoice for your accounts"],
              highlight: true,
              badge: "Most popular",
              cta: { label: "Set up supply", href: waLink("Hello Theneer Kadai, we need office tea supply. Office name, address and number of people: …") },
            },
            {
              name: "Function and event tea",
              description: "Birthdays, meetings, marriages and pooja.",
              features: ["Tea and coffee flasks by the 20 litres", "Paper cups, sugar and stirrers included", "Order a day ahead, delivered anywhere in Chennai", "Ask for a quote on WhatsApp"],
              highlight: false,
              cta: { label: "Ask for a quote", href: waLink("Hello Theneer Kadai, I need tea for an event. Date, place and number of people: …") },
            },
          ],
          style: { background: "muted" },
        },
        {
          type: "testimonials",
          id: "tk-reviews",
          title: "From the queue",
          layout: "cards",
          items: [
            { quote: "I have had my 6:30 filter coffee here for eleven years. The tumbler is hot, the decoction is the same strength, and the token system on busy mornings is the best thing they did.", name: "Ramanujam S.", role: "Walker, Mylapore", rating: 5 },
            { quote: "We take the office flask supply: two flasks a day, on time, with cups. The GST bill comes at month end and our accountant has never had to ask twice.", name: "Anitha R.", role: "Chartered accountant, Luz", rating: 5 },
            { quote: "Jigarthanda and nannari in summer, hot bajji with ginger tea in the rain. We come after the evening class at the temple, and ordering online saves the wait.", name: "Kavitha M.", role: "Mylapore", rating: 5 },
          ],
        },
        { type: "faq", id: "tk-faq", title: "Tokens, sizes, tea cards and sugar", items: FAQ },
        {
          type: "newsletter",
          id: "tk-newsletter",
          layout: "inline",
          heading: "Today's juices and evening offers",
          text: "One short message when the mango season starts or a new sarbath lands. No spam.",
        },
      ],
      translations: {
        ta: {
          "tk-hero": {
            slides: [
              {
                heading: "அதிகாலை 5:30 முதல் சூடான டீ. இரவு 10:30 வரை புதிய ஜூஸ்.",
                subheading: "தேநீர் கடை, சந்நிதி தெரு, மயிலாப்பூர். கவுண்டரிலோ ஆன்லைனிலோ ஆர்டர் செய்யுங்கள்; உங்கள் டோக்கனை அழைப்போம்.",
                cta: { label: "இப்போதே ஆர்டர் செய்" },
              },
              {
                heading: "கண் முன்னே பிழிந்து தருகிறோம்.",
                subheading: "ஆரஞ்சு, மோசம்பி, தர்பூசணி, கரும்பு, அன்னாசி: ஆர்டர் செய்ததும் வெட்டிப் பிழிந்து. தண்ணீர் இல்லை, சர்க்கரை சேர்ப்பதில்லை.",
                cta: { label: "இன்றைய ஜூஸ்" },
              },
              {
                heading: "பிற்பகலுக்குக் குளிர்ச்சி.",
                subheading: "ஜிகர்தண்டா, ரோஸ் மில்க், நன்னாரி சர்பத், மோர், லைம் சோடா: 250 அல்லது 400 மி.லி. கிளாஸில்.",
                cta: { label: "குளிர் பானங்கள்" },
              },
            ],
          },
          "tk-location": {
            title: "எங்களைக் கண்டறியுங்கள், தினமும் திறந்திருக்கும்",
            address: "28, சந்நிதி தெரு, மயிலாப்பூர், சென்னை 600004 (கபாலீஸ்வரர் கோயில் குளத்திலிருந்து இரண்டு நிமிடம்)",
            hours: HOURS_TA,
          },
          "tk-offer": {
            eyebrow: "ஆன்லைனில் ஆர்டர், வரிசை வேண்டாம்",
            heading: "முதல் பிக்-அப் ஆர்டருக்கு 10% தள்ளுபடி",
            text: "போனிலிருந்து ஆர்டர் செய்து, வந்து உங்கள் பெயரைச் சொல்லி எடுத்துச் செல்லுங்கள். ரூ 150-க்கு மேல், ரூ 40 வரை தள்ளுபடி.",
            cta: { label: "ஆர்டர் தொடங்குங்கள்" },
          },
          "tk-stories": {
            title: "காலை நேரக் கூட்டம்",
            items: [
              { title: "முதல் கொதி", text: "கோயில் மணி அடிக்கும் முன்பே, 5:30-க்கு கெட்டில்கள் ஆவி விடுகின்றன.", ctaLabel: "காலைப் பிடித்தவை" },
              { title: "7:30 வரிசை", text: "நடைப்பயிற்சிக்காரர்களுக்கும் பேருந்து நிறுத்தத்துக்கும் வரிசையாக நாற்பது கிளாஸ் டீ, காபி.", ctaLabel: "சூடான பானங்கள்" },
              { title: "கரும்பு இயந்திரம்", text: "இஞ்சி, எலுமிச்சையுடன் கரும்புச்சாறு, உங்கள் கண் முன்னே பிழிந்து.", ctaLabel: "இன்றைய ஜூஸ்" },
              { title: "ஃபில்டர் காபி", text: "டிகாக்ஷன், கெட்டிப் பால், நீண்ட ஆற்றல்: மயிலாப்பூர் பாணி டிகிரி காபி.", ctaLabel: "காபி ஆர்டர்" },
              { title: "மழை நாள்", text: "சந்நிதி தெருவில் மழை பெய்யும்போது மண் கோப்பையில் இஞ்சி டீ.", ctaLabel: "சூடான பானங்கள்" },
            ],
          },
          "tk-board": {
            title: "இன்றைய பலகை",
            groups: [
              {
                name: "சூடாக இப்போது",
                items: [{ name: "டீ", description: "100 மி.லி. · 200 மி.லி. ₹20" }, { name: "மசாலா டீ", description: "100 மி.லி. · 200 மி.லி. ₹25" }, { name: "ஃபில்டர் காபி", description: "100 மி.லி. · 200 மி.லி. ₹30" }, { name: "மெது வடை", description: "ஒன்று · இரண்டு ₹18" }],
              },
              {
                name: "இன்று பிழிந்த ஜூஸ்கள்",
                items: [{ name: "ஆரஞ்சு ஜூஸ்", description: "250 மி.லி. · 400 மி.லி. ₹70" }, { name: "மோசம்பி ஜூஸ்", description: "250 மி.லி. · 400 மி.லி. ₹70" }, { name: "தர்பூசணி ஜூஸ்", description: "250 மி.லி. · 400 மி.லி. ₹50" }, { name: "அன்னாசி ஜூஸ்", description: "250 மி.லி. · 400 மி.லி. ₹70" }, { name: "கரும்புச்சாறு", description: "250 மி.லி. · 400 மி.லி. ₹40" }],
              },
              {
                name: "குளிர்ச்சியும் இனிப்பும்",
                items: [{ name: "ஜிகர்தண்டா", description: "250 மி.லி. · 400 மி.லி. ₹80" }, { name: "நன்னாரி சர்பத்", description: "250 மி.லி. · 400 மி.லி. ₹35" }, { name: "மோர்", description: "250 மி.லி. · 400 மி.லி. ₹25" }],
              },
              {
                name: "மாலை 4 மணி முதல் கடாயிலிருந்து சூடாக",
                items: [{ name: "வெங்காய பஜ்ஜி", description: "3 துண்டு · 6 ₹35" }, { name: "உருளை போண்டா", description: "ஒன்று · இரண்டு ₹22" }, { name: "சமோசா", description: "ஒன்று · இரண்டு ₹22" }],
              },
            ],
            cta: { label: "முழு மெனுவைப் பாருங்கள்" },
          },
          "tk-evening": {
            title: "மாலை 4 முதல் 6 வரை",
            text: "தினமும் மாலை கடாய்கள் சூடாக இருக்கும்: டீயுடன் வடை, சிற்றுண்டி காம்போ, காபியுடன் போண்டா மாலை விலையில்.",
            cta: { label: "அனைத்து மாலைப் பொருட்கள்" },
          },
          "tk-finder": {
            title: "இப்போது என்ன மனநிலை?",
            text: "மூன்று தொடுதலில் உங்கள் கப்பைக் காட்டுகிறோம்.",
            questions: [
              { label: "சூடா, குளிரா?", options: [{ label: "சூடு" }, { label: "குளிர்" }] },
              { label: "இனிப்பா, காரமா?", options: [{ label: "இனிப்பு" }, { label: "காரம்" }] },
              { label: "எவ்வளவு பெரியது?", options: [{ label: "ஸ்மால்" }, { label: "லார்ஜ்" }] },
            ],
          },
          "tk-menu": { title: "முழு மெனு" },
          "tk-cards": {
            title: "டீ கார்டும் அலுவலக டீயும்",
            text: "மயிலாப்பூர் கடைகள், கிளினிக்குகள், அலுவலகங்களுக்கு: மாதம் ஒருமுறை செலுத்துங்கள், மாதம் முழுவதும் அருந்துங்கள்.",
            plans: [
              plan({
                name: "மாதாந்திர டீ கார்டு",
                period: "/ மாதம்",
                description: "கடை அல்லது சிறிய அலுவலகத்துக்கு.",
                features: ["50 ஸ்மால் டீ அல்லது ஃபில்டர் காபி", "நாங்கள் திறந்திருக்கும் எந்த நாளும், எந்த நேரமும்", "மாத இறுதியில் UPI அல்லது பணமாகக் கட்டணம்", "கார்டை உங்கள் குழுவுடன் பகிருங்கள்"],
                cta: { label: "கார்டு கேளுங்கள்" },
              }),
              plan({
                name: "அலுவலக ஃபிளாஸ்க் சப்ளை",
                period: "/ மாதம்",
                description: "ஒரு ஸ்டீல் ஃபிளாஸ்கும் கப்புகளும், தினம் இருமுறை.",
                features: ["காலை 10 மணிக்கும் மாலை 4 மணிக்கும் 1 லிட்டர் டீ அல்லது காபி ஃபிளாஸ்க்", "ஒவ்வொரு முறையும் சுமார் 8 கப், பேப்பர் கப் உட்பட", "26 வேலை நாட்கள், சந்நிதி தெருவிலிருந்து 1 கி.மீ. உள்ளே", "மாத இறுதியில் கட்டணம், உங்கள் கணக்குக்கு GST பில்"],
                badge: "அதிகம் விரும்பப்படுவது",
                cta: { label: "சப்ளை தொடங்குங்கள்" },
              }),
              plan({
                name: "விழா, நிகழ்ச்சி டீ",
                description: "பிறந்தநாள், கூட்டம், திருமணம், பூஜை.",
                features: ["20 லிட்டர் கணக்கில் டீ, காபி ஃபிளாஸ்க்", "பேப்பர் கப், சர்க்கரை, கரண்டி உட்பட", "ஒரு நாள் முன்பு ஆர்டர், சென்னை முழுவதும் டெலிவரி", "வாட்ஸ்அப்பில் விலை கேளுங்கள்"],
                cta: { label: "விலை கேளுங்கள்" },
              }),
            ],
          },
          "tk-reviews": {
            title: "வரிசையிலிருந்து",
            items: [
              { quote: "பதினொரு ஆண்டுகளாக என் காலை 6:30 ஃபில்டர் காபி இங்கேதான். டம்ளர் சூடாக இருக்கிறது, டிகாக்ஷன் எப்போதும் ஒரே வலிமை, கூட்டமான காலைகளில் டோக்கன் முறை அவர்கள் செய்த சிறந்த விஷயம்.", role: "நடைப்பயிற்சி செய்பவர், மயிலாப்பூர்" },
              { quote: "நாங்கள் அலுவலக ஃபிளாஸ்க் சப்ளை எடுத்திருக்கிறோம்: தினம் இரண்டு ஃபிளாஸ்க், நேரத்துக்கு, கப்புகளுடன். மாத இறுதியில் GST பில் வருகிறது; எங்கள் கணக்காளர் இரண்டாம் முறை கேட்டதே இல்லை.", role: "பட்டயக் கணக்காளர், லஸ்" },
              { quote: "கோடையில் ஜிகர்தண்டா, நன்னாரி; மழையில் இஞ்சி டீயுடன் சூடான பஜ்ஜி. கோயிலில் மாலை வகுப்பு முடிந்ததும் வருகிறோம்; ஆன்லைனில் ஆர்டர் செய்தால் காத்திருப்பு மிச்சம்.", role: "மயிலாப்பூர்" },
            ],
          },
          "tk-faq": { title: "டோக்கன், அளவு, டீ கார்டு, சர்க்கரை", items: FAQ_TA },
          "tk-newsletter": { heading: "இன்றைய ஜூஸ், மாலைச் சலுகைகள்", text: "மாம்பழக் காலம் தொடங்கும்போது அல்லது புதிய சர்பத் வரும்போது ஒரு சிறு செய்தி. ஸ்பேம் இல்லை." },
        },
      },
    };
  },
  pages: [
    {
      slug: "about",
      title: "Our story",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Theneer Kadai, Sannidhi Street, since 1998" },
        {
          type: "paragraph",
          markdown:
            "Theneer (தேநீர்) is Tamil for tea. We opened in **1998** as a three-stool tea counter on Sannidhi Street, two minutes from the Kapaleeshwarar temple tank, boiling the first kettle at 5:30 am for the people on their morning walk. The kettles are still the same brass ones.\n\nToday the corner has a juice counter with a cane press, a snack pan that runs from 4 pm, filter coffee through brass filters, and about **300 customers a day**. You order at the counter, pay by cash or UPI and take a **token**, or order online and walk in to collect. Shops and offices in Mylapore run monthly tea cards with us.",
        },
        { type: "image", url: photo(10389156, "tile"), alt: "Tea being poured from a brass kettle at a street counter" },
        { type: "paragraph", markdown: "Open every day 5:30 am to 11:00 pm. Call or WhatsApp **+91 98765 00022**." },
      ],
    },
    {
      slug: "tea-cards",
      title: "Tea cards and office tea",
      blocks: ({ photo }) => [
        { type: "heading", level: 2, text: "Pay once a month, drink all month" },
        {
          type: "paragraph",
          markdown:
            "**Monthly tea card (Rs 500):** 50 small teas or filter coffees for a shop or small office, used any day we are open, billed at month end by UPI or cash.\n\n**Office flask supply (Rs 5,200 a month):** a 1-litre steel flask of tea or coffee with paper cups at 10 am and 4 pm on 26 working days, within 1 km of Sannidhi Street. Monthly GST invoice for your accounts.\n\n**Function tea:** flasks by the 20 litres for birthdays, meetings, marriages and pooja. Order a day ahead.",
        },
        { type: "image", url: photo(12865880, "tile"), alt: "A brass kettle and glasses of chai on a rustic table" },
        { type: "button", label: "Ask us on WhatsApp", href: waLink("Hello Theneer Kadai, I would like a tea card / office supply. Name, address and number of people: …"), style: "primary" },
      ],
    },
    {
      slug: "photo-credits",
      title: "Photo credits",
      blocks: () => [
        { type: "heading", level: 2, text: "Photo credits" },
        {
          type: "paragraph",
          markdown: `Photos on this demo store are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). People shown are photographers' subjects, not our customers or staff.\n\n| Photo | Photographer | Source |\n|---|---|---|\n${Object.entries(
            PHOTOS,
          )
            .map(([id, p]) => `| ${p.alt} | ${p.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
            .join("\n")}`,
        },
      ],
    },
  ],
  menus: {
    header: [
      { label: "Tea & coffee", type: "category", ref: "tea-and-coffee" },
      { label: "Fresh juices", type: "category", ref: "fresh-juices" },
      { label: "Cool drinks", type: "category", ref: "cool-drinks-and-sarbath" },
      { label: "Snacks", type: "category", ref: "snacks" },
      { label: "Today's juices", type: "collection", ref: "todays-juices" },
      { label: "Tea cards", type: "page", ref: "tea-cards" },
    ],
    footer: [
      {
        label: "Menu",
        type: "url",
        children: [
          { label: "Milk & malt", type: "category", ref: "milk-and-malt" },
          { label: "Milkshakes", type: "category", ref: "milkshakes" },
          { label: "Bakery bites", type: "category", ref: "bakery-bites" },
          { label: "Combos", type: "category", ref: "combos" },
          { label: "Evening 4 to 6 pm", type: "collection", ref: "evening" },
          { label: "Office tea", type: "collection", ref: "office" },
        ],
      },
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track your order", type: "url", href: "/track" },
          { label: "WhatsApp us", type: "url", href: `https://wa.me/${WHATSAPP}` },
          { label: "Tea cards and office tea", type: "page", ref: "tea-cards" },
          { label: "Our story", type: "page", ref: "about" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  setup: setupTheneer,
};
