import { stockArtFor } from "@rbms/branding/stock-art";
import type { BusinessPack, BusinessType } from "./packs";

/**
 * A new shop's starter home page in the CMS section format (`@rbms/cms` homeSectionSchema validates it; see
 * packages/cms/src/starter.test.ts). Each trade gets its own mix: a photo-less hero (the theme's brand block, or a
 * split hero), categories as round pictures or a mosaic, trade sections (today's gold rate, book an appointment, the
 * menu board), the pack's promises, where to find the shop and a newsletter.
 *
 * The starter is published straight away, so nothing in it may claim things about the shop that the owner hasn't said:
 * customer words, menu prices and FAQ answers start `hidden` (ready to edit in the home page editor), and the
 * location section shows the shop's own contact details until the owner types an address.
 */

type Locale = "en" | "ta";
type L = { en: string; ta: string };
const l = (en: string, ta: string): L => ({ en, ta });

/** The section kinds a starter can contain, in the order they appear. */
type Part =
  | "hero"
  | "hero-split"
  | "categories"
  | "category-mosaic"
  | "gold-rates"
  | "appointment"
  | "menu-board"
  | "usp"
  | "testimonials"
  | "faq"
  | "location"
  | "newsletter";

const LAYOUT: Record<BusinessType, Part[]> = {
  fashion: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "newsletter"],
  pharmacy: ["hero", "categories", "usp", "faq", "location", "newsletter"],
  restaurant: ["hero", "menu-board", "categories", "testimonials", "location", "newsletter"],
  cloud_kitchen: ["hero", "menu-board", "categories", "usp", "testimonials", "faq"],
  grocery: ["hero-split", "category-mosaic", "usp", "faq", "location", "newsletter"],
  bakery: ["hero-split", "menu-board", "categories", "testimonials", "location", "newsletter"],
  fresh: ["hero", "category-mosaic", "usp", "faq", "newsletter"],
  electronics: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "location"],
  repair: ["hero", "appointment", "usp", "testimonials", "faq", "location"],
  salon: ["hero-split", "appointment", "categories", "testimonials", "faq", "location"],
  gym: ["hero", "appointment", "usp", "testimonials", "faq", "location"],
  jewellery: ["hero-split", "gold-rates", "category-mosaic", "testimonials", "location", "newsletter"],
  hardware: ["hero", "category-mosaic", "usp", "faq", "location"],
  optical: ["hero-split", "appointment", "category-mosaic", "testimonials", "location"],
  tailoring: ["hero", "appointment", "categories", "testimonials", "faq", "location"],
  organic: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "location", "newsletter"],
  footwear: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "location", "newsletter"],
  stationery: ["hero", "categories", "usp", "faq", "location", "newsletter"],
  toys: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "newsletter"],
  cosmetics: ["hero-split", "category-mosaic", "usp", "testimonials", "faq", "newsletter"],
  crackers: ["hero", "usp", "category-mosaic", "faq", "location", "newsletter"],
  florist_pooja: ["hero-split", "categories", "usp", "testimonials", "location", "faq"],
  mobile_accessories: ["hero", "categories", "usp", "testimonials", "faq", "newsletter"],
  furniture: ["hero", "usp", "category-mosaic", "testimonials", "faq", "location"],
  home_decor: ["hero-split", "category-mosaic", "testimonials", "usp", "faq", "newsletter"],
  pet_shop: ["hero", "categories", "usp", "faq", "testimonials", "newsletter"],
  sports: ["hero", "category-mosaic", "usp", "testimonials", "faq", "location", "newsletter"],
  tea_stall: ["hero-split", "menu-board", "usp", "location", "faq"],
  spa: ["hero", "appointment", "categories", "usp", "testimonials", "faq", "location"],
  school: ["hero-split", "usp", "categories", "appointment", "testimonials", "faq", "location", "newsletter"],
  general_shop: ["hero-split", "categories", "usp", "faq", "newsletter"],
  general_counter: ["hero", "categories", "usp", "faq", "location"],
  general_services: ["hero-split", "appointment", "categories", "usp", "faq", "location"],
  textiles_wholesale: ["hero", "category-mosaic", "usp", "faq", "location", "newsletter"],
  catering: ["hero-split", "appointment", "categories", "usp", "testimonials", "faq"],
  pet_grooming: ["hero", "appointment", "usp", "categories", "testimonials", "faq", "location"],
  photo_studio: ["hero-split", "category-mosaic", "appointment", "testimonials", "faq", "location"],
  laundry: ["hero", "appointment", "categories", "usp", "faq", "location"],
  event_decor: ["hero-split", "category-mosaic", "usp", "appointment", "testimonials", "faq"],
  ac_service: ["hero", "appointment", "categories", "usp", "testimonials", "faq", "location"],
  print_shop: ["hero-split", "categories", "usp", "location", "faq"],
  tuition: ["hero-split", "appointment", "categories", "usp", "testimonials", "faq", "location"],
  dance_music: ["hero", "category-mosaic", "appointment", "testimonials", "faq", "location"],
  yoga: ["hero-split", "appointment", "usp", "categories", "testimonials", "faq"],
  driving_school: ["hero", "usp", "appointment", "categories", "faq", "location"],
  paints: ["hero-split", "category-mosaic", "usp", "faq", "location", "newsletter"],
  electricals: ["hero-split", "categories", "usp", "faq", "location"],
  tiles_sanitary: ["hero", "category-mosaic", "usp", "faq", "location"],
  two_wheeler_service: ["hero", "appointment", "categories", "usp", "testimonials", "faq", "location"],
  car_service: ["hero-split", "appointment", "categories", "usp", "testimonials", "faq", "location"],
  agri_inputs: ["hero-split", "categories", "usp", "faq", "location", "newsletter"],
  auto_parts: ["hero", "category-mosaic", "usp", "faq", "location"],
};

/** Packs without stock artwork of their own borrow a near trade's (drawn in that trade's look, which the pack starts on). */
const STOCK_ART: Partial<Record<BusinessType, string>> = { organic: "fresh", footwear: "fashion", stationery: "optical", toys: "grocery", cosmetics: "salon",
  crackers: "grocery",
  florist_pooja: "fresh",
  mobile_accessories: "electronics",
  furniture: "hardware",
  home_decor: "jewellery",
  pet_shop: "grocery",
  sports: "gym",
  tea_stall: "restaurant",
  spa: "salon",
  school: "optical",
  general_shop: "grocery",
  general_counter: "grocery",
  general_services: "repair",
  textiles_wholesale: "tailoring",
  catering: "restaurant",
  pet_grooming: "salon",
  photo_studio: "electronics",
  laundry: "tailoring",
  event_decor: "jewellery",
  ac_service: "repair",
  print_shop: "electronics",
  tuition: "optical",
  dance_music: "jewellery",
  yoga: "gym",
  driving_school: "gym",
  paints: "hardware",
  electricals: "electronics",
  tiles_sanitary: "hardware",
  two_wheeler_service: "repair",
  car_service: "repair",
  agri_inputs: "fresh",
  auto_parts: "hardware",
};

// ------------------------------------------------------------------ trade words

/** Services listed in the "Book an appointment" section (names and usual time; no prices — the owner adds them). */
const SERVICES: Partial<Record<BusinessType, { name: L; duration?: L }[]>> = {
  salon: [
    { name: l("Haircut & styling", "முடி வெட்டு & ஸ்டைலிங்"), duration: l("45 min", "45 நிமி") },
    { name: l("Facial & clean-up", "ஃபேஷியல் & க்ளீன்-அப்"), duration: l("60 min", "60 நிமி") },
    { name: l("Bridal makeup", "மணப்பெண் அலங்காரம்"), duration: l("3 hours", "3 மணி நேரம்") },
  ],
  gym: [
    { name: l("Free trial workout", "இலவச சோதனைப் பயிற்சி"), duration: l("60 min", "60 நிமி") },
    { name: l("Personal training", "தனிப் பயிற்சி"), duration: l("60 min", "60 நிமி") },
    { name: l("Fitness assessment", "உடல்திறன் மதிப்பீடு"), duration: l("30 min", "30 நிமி") },
  ],
  repair: [
    { name: l("Screen replacement", "திரை மாற்றம்"), duration: l("Same day", "அதே நாள்") },
    { name: l("Battery replacement", "பேட்டரி மாற்றம்"), duration: l("1 hour", "1 மணி நேரம்") },
    { name: l("Free check-up", "இலவச பரிசோதனை"), duration: l("15 min", "15 நிமி") },
  ],
  optical: [
    { name: l("Eye test", "கண் பரிசோதனை"), duration: l("20 min", "20 நிமி") },
    { name: l("Frame fitting", "ஃப்ரேம் பொருத்துதல்"), duration: l("15 min", "15 நிமி") },
    { name: l("Contact lens trial", "காண்டாக்ட் லென்ஸ் சோதனை"), duration: l("30 min", "30 நிமி") },
  ],
  tailoring: [
    { name: l("Measurements", "அளவெடுத்தல்"), duration: l("15 min", "15 நிமி") },
    { name: l("Blouse stitching", "ரவிக்கை தையல்"), duration: l("5 days", "5 நாள்") },
    { name: l("Alterations", "ஆல்டரேஷன்"), duration: l("2 days", "2 நாள்") },
  ],
  spa: [
    { name: l("Full-body massage", "முழு உடல் மசாஜ்"), duration: l("60 min", "60 நிமி") },
    { name: l("Abhyanga (ayurvedic oil massage)", "அப்யங்கம் (ஆயுர்வேத எண்ணெய் மசாஜ்)"), duration: l("75 min", "75 நிமி") },
    { name: l("Foot reflexology", "பாத ரிஃப்ளெக்ஸாலஜி"), duration: l("30 min", "30 நிமி") },
  ],
  school: [
    { name: l("Campus visit and tour", "வளாகச் சுற்றுலா"), duration: l("45 min", "45 நிமி") },
    { name: l("Meet the principal", "முதல்வரைச் சந்திக்க"), duration: l("20 min", "20 நிமி") },
    { name: l("Admission counselling", "சேர்க்கை ஆலோசனை"), duration: l("30 min", "30 நிமி") },
  ],
  general_services: [
    { name: l("Consultation", "ஆலோசனை"), duration: l("30 min", "30 நிமி") },
    { name: l("Standard service", "வழக்கமான சேவை"), duration: l("60 min", "60 நிமி") },
    { name: l("Site visit", "இடத்துக்கு வருகை"), duration: l("On request", "கோரிக்கைப்படி") },
  ],
  catering: [
    { name: l("Menu tasting", "மெனு சுவைபார்த்தல்"), duration: l("45 min", "45 நிமி") },
    { name: l("Event quote", "நிகழ்வுக்கான விலைப்பட்டியல்"), duration: l("Within a day", "ஒரு நாளுக்குள்") },
    { name: l("Daily tiffin trial", "தினசரி டிஃபன் சோதனை"), duration: l("3 days", "3 நாள்") },
  ],
  pet_grooming: [
    { name: l("Bath & dry", "குளிப்பாட்டி உலர்த்துதல்"), duration: l("60 min", "60 நிமி") },
    { name: l("Full grooming", "முழு அழகுபடுத்தல்"), duration: l("2 hours", "2 மணி நேரம்") },
    { name: l("Nail & ear care", "நகம் & காது பராமரிப்பு"), duration: l("20 min", "20 நிமி") },
  ],
  photo_studio: [
    { name: l("Studio portrait session", "ஸ்டுடியோ போர்ட்ரெய்ட்"), duration: l("45 min", "45 நிமி") },
    { name: l("Passport & ID photos", "பாஸ்போர்ட் & அடையாள அட்டைப் படங்கள்"), duration: l("10 min", "10 நிமி") },
    { name: l("Wedding package discussion", "திருமணப் பேக்கேஜ் ஆலோசனை"), duration: l("30 min", "30 நிமி") },
  ],
  laundry: [
    { name: l("Pickup from home", "வீட்டிலிருந்து பிக்அப்"), duration: l("Your slot", "உங்கள் நேரம்") },
    { name: l("Wash & iron", "துவைத்து அயர்ன்"), duration: l("2 days", "2 நாள்") },
    { name: l("Dry cleaning", "டிரை கிளீனிங்"), duration: l("3 days", "3 நாள்") },
  ],
  event_decor: [
    { name: l("Venue visit & quote", "இடம் பார்வையிட்டு விலைப்பட்டியல்"), duration: l("45 min", "45 நிமி") },
    { name: l("Theme and design discussion", "தீம், வடிவமைப்பு ஆலோசனை"), duration: l("30 min", "30 நிமி") },
    { name: l("Rentals check", "வாடகைப் பொருட்கள் பார்வை"), duration: l("20 min", "20 நிமி") },
  ],
  ac_service: [
    { name: l("AC general service", "ஏசி பொது சர்வீஸ்"), duration: l("1 hour", "1 மணி நேரம்") },
    { name: l("Gas refill & leak check", "கேஸ் நிரப்பல் & கசிவு சோதனை"), duration: l("90 min", "90 நிமி") },
    { name: l("Fridge / washing machine check", "ஃப்ரிட்ஜ் / வாஷிங் மெஷின் சோதனை"), duration: l("Same day", "அதே நாள்") },
  ],
  tuition: [
    { name: l("Free demo class", "இலவச டெமோ வகுப்பு"), duration: l("60 min", "60 நிமி") },
    { name: l("Meet the teacher", "ஆசிரியரைச் சந்திக்க"), duration: l("20 min", "20 நிமி") },
    { name: l("Level assessment test", "நிலை மதிப்பீட்டுத் தேர்வு"), duration: l("45 min", "45 நிமி") },
  ],
  dance_music: [
    { name: l("Trial class", "சோதனை வகுப்பு"), duration: l("45 min", "45 நிமி") },
    { name: l("Level assessment", "நிலை மதிப்பீடு"), duration: l("30 min", "30 நிமி") },
    { name: l("Meet the teacher", "ஆசிரியரைச் சந்திக்க"), duration: l("20 min", "20 நிமி") },
  ],
  yoga: [
    { name: l("Free trial class", "இலவச சோதனை வகுப்பு"), duration: l("60 min", "60 நிமி") },
    { name: l("Personal yoga session", "தனிப்பட்ட யோகா அமர்வு"), duration: l("60 min", "60 நிமி") },
    { name: l("Posture and health check", "உடல்நிலை, தோரணை பரிசோதனை"), duration: l("20 min", "20 நிமி") },
  ],
  driving_school: [
    { name: l("Trial lesson", "சோதனைப் பாடம்"), duration: l("30 min", "30 நிமி") },
    { name: l("Learner's licence help", "எல்.எல்.ஆர். உதவி"), duration: l("20 min", "20 நிமி") },
    { name: l("Course counselling", "பயிற்சித் திட்ட ஆலோசனை"), duration: l("15 min", "15 நிமி") },
  ],
  two_wheeler_service: [
    { name: l("General service", "பொது சர்வீஸ்"), duration: l("2 hours", "2 மணி நேரம்") },
    { name: l("Oil change", "ஆயில் மாற்றம்"), duration: l("30 min", "30 நிமி") },
    { name: l("Brake and clutch check", "பிரேக், கிளட்ச் சோதனை"), duration: l("45 min", "45 நிமி") },
  ],
  car_service: [
    { name: l("Periodic service", "காலமுறை சர்வீஸ்"), duration: l("4 hours", "4 மணி நேரம்") },
    { name: l("AC check and gas top-up", "ஏசி சோதனை, கேஸ் நிரப்புதல்"), duration: l("2 hours", "2 மணி நேரம்") },
    { name: l("Wash and interior cleaning", "வாஷ், உள் சுத்தம்"), duration: l("90 min", "90 நிமி") },
  ],
};

const APPOINTMENT: Partial<Record<BusinessType, { heading: L; text: L }>> = {
  salon: { heading: l("Book your appointment", "உங்கள் நேரத்தை முன்பதிவு செய்யுங்கள்"), text: l("Pick a service and a time that suits you. No waiting at the counter.", "சேவையையும் உங்களுக்கு ஏற்ற நேரத்தையும் தேர்ந்தெடுங்கள். கவுண்டரில் காத்திருக்க வேண்டாம்.") },
  gym: { heading: l("Start with a free trial", "இலவச சோதனையுடன் தொடங்குங்கள்"), text: l("Book a slot, meet a trainer and see the gym before you join.", "நேரத்தை முன்பதிவு செய்து, பயிற்சியாளரைச் சந்தித்து, சேரும் முன் ஜிம்மைப் பாருங்கள்.") },
  repair: { heading: l("Book a repair", "பழுது நீக்க முன்பதிவு"), text: l("Tell us what's wrong and pick a time. Track your job online.", "என்ன கோளாறு என்று சொல்லி நேரத்தைத் தேர்ந்தெடுங்கள். உங்கள் வேலையை ஆன்லைனில் பாருங்கள்.") },
  optical: { heading: l("Book an eye test", "கண் பரிசோதனைக்கு முன்பதிவு"), text: l("Get your eyes checked and try frames, at a time that suits you.", "உங்களுக்கு ஏற்ற நேரத்தில் கண் பரிசோதனை செய்து ஃப்ரேம்களை அணிந்து பாருங்கள்.") },
  tailoring: { heading: l("Book a fitting", "அளவெடுக்க முன்பதிவு"), text: l("Come in for measurements, or book a pick-up of your fabric.", "அளவெடுக்க வாருங்கள், அல்லது உங்கள் துணியை எடுத்துச் செல்ல முன்பதிவு செய்யுங்கள்.") },
  spa: { heading: l("Book your session", "உங்கள் அமர்வை புக் செய்யுங்கள்"), text: l("Choose a therapy and a time, and come ten minutes early to settle in.", "சிகிச்சையையும் நேரத்தையும் தேர்ந்தெடுங்கள்; நிதானமாகத் தயாராகப் பத்து நிமிடம் முன்னதாக வாருங்கள்.") },
  school: { heading: l("Book a campus visit", "வளாகத்தைப் பார்வையிட முன்பதிவு செய்யுங்கள்"), text: l("Walk through the classrooms, meet our teachers and ask about admissions. Pick a day that suits you.", "வகுப்பறைகளைச் சுற்றிப் பாருங்கள், ஆசிரியர்களைச் சந்தியுங்கள், சேர்க்கை பற்றிக் கேளுங்கள். உங்களுக்கு ஏற்ற நாளைத் தேர்ந்தெடுங்கள்.") },
  general_services: { heading: l("Book a service", "சேவையை புக் செய்யுங்கள்"), text: l("Pick a service and a time that suits you. We confirm it quickly.", "சேவையையும் உங்களுக்கு ஏற்ற நேரத்தையும் தேர்ந்தெடுங்கள். விரைவில் உறுதி செய்வோம்.") },
  catering: { heading: l("Plan your event", "உங்கள் நிகழ்வைத் திட்டமிடுங்கள்"), text: l("Tell us the date, the number of guests and the menu you like; we send a quote within a day.", "தேதி, விருந்தினர் எண்ணிக்கை, விரும்பும் மெனுவைச் சொல்லுங்கள்; ஒரு நாளுக்குள் விலைப்பட்டியல் அனுப்புவோம்.") },
  pet_grooming: { heading: l("Book a grooming slot", "அழகுபடுத்தும் நேரத்தை புக் செய்யுங்கள்"), text: l("Choose the service and a time; tell us your pet's size and any health notes.", "சேவையையும் நேரத்தையும் தேர்ந்தெடுங்கள்; செல்லத்தின் அளவு, உடல்நலக் குறிப்புகளைச் சொல்லுங்கள்.") },
  photo_studio: { heading: l("Book your shoot", "படப்பிடிப்பை புக் செய்யுங்கள்"), text: l("Pick a session or ask about a package for your function; we confirm the date.", "ஒரு அமர்வைத் தேர்ந்தெடுங்கள், அல்லது உங்கள் விசேஷத்துக்கான பேக்கேஜ் பற்றிக் கேளுங்கள்; தேதியை உறுதி செய்வோம்.") },
  laundry: { heading: l("Schedule a pickup", "பிக்அப் நேரத்தை புக் செய்யுங்கள்"), text: l("Choose a pickup slot; we bring your clothes back on the ready date.", "பிக்அப் நேரத்தைத் தேர்ந்தெடுங்கள்; தயாராகும் நாளில் துணிகளைத் திருப்பிக் கொண்டு வருவோம்.") },
  event_decor: { heading: l("Get a quote for your event", "உங்கள் நிகழ்வுக்கு விலைப்பட்டியல் பெறுங்கள்"), text: l("Tell us the date, the venue and the theme you like; we visit and send an itemised quote.", "தேதி, இடம், விரும்பும் தீமைச் சொல்லுங்கள்; நேரில் வந்து விவரமான விலைப்பட்டியல் அனுப்புவோம்.") },
  ac_service: { heading: l("Book a service visit", "சர்வீஸ் வருகையை புக் செய்யுங்கள்"), text: l("Tell us the appliance and the problem, pick a time, and track your job online.", "உபகரணத்தையும் பிரச்சினையையும் சொல்லி, நேரத்தைத் தேர்ந்தெடுங்கள்; உங்கள் வேலையை ஆன்லைனில் பாருங்கள்.") },
  tuition: { heading: l("Try a free demo class", "இலவச டெமோ வகுப்பை முயற்சியுங்கள்"), text: l("Pick the class and a time; meet the teacher and see how a batch runs before you join.", "வகுப்பையும் நேரத்தையும் தேர்ந்தெடுங்கள்; சேரும் முன் ஆசிரியரைச் சந்தித்து பேட்ச் எப்படி நடக்கிறதெனப் பாருங்கள்.") },
  dance_music: { heading: l("Book a trial class", "சோதனை வகுப்பை புக் செய்யுங்கள்"), text: l("Try a class first. Tell us the age and level and we suggest the right batch.", "முதலில் ஒரு வகுப்பில் கலந்து பாருங்கள். வயதையும் நிலையையும் சொல்லுங்கள், பொருத்தமான பேட்சைச் சொல்வோம்.") },
  yoga: { heading: l("Join a free trial class", "இலவச சோதனை வகுப்பில் சேருங்கள்"), text: l("Pick a batch that suits you; wear comfortable clothes and come on an empty stomach.", "உங்களுக்கு ஏற்ற பேட்சைத் தேர்ந்தெடுங்கள்; வசதியான ஆடை அணிந்து, வெறும் வயிற்றில் வாருங்கள்.") },
  driving_school: { heading: l("Book your first lesson", "முதல் பாடத்தை புக் செய்யுங்கள்"), text: l("Choose car or two-wheeler and a time; bring your learner's licence if you have one.", "கார் அல்லது இருசக்கர வாகனத்தையும் நேரத்தையும் தேர்ந்தெடுங்கள்; எல்.எல்.ஆர். இருந்தால் கொண்டு வாருங்கள்.") },
  two_wheeler_service: { heading: l("Book a bike service", "பைக் சர்வீஸை புக் செய்யுங்கள்"), text: l("Pick a service and a time; tell us the registration number and we keep the history for your next visit.", "சேவையையும் நேரத்தையும் தேர்ந்தெடுங்கள்; பதிவு எண்ணைச் சொல்லுங்கள், அடுத்த வருகைக்கு வரலாற்றைப் பதிந்து வைப்போம்.") },
  car_service: { heading: l("Book a car service", "கார் சர்வீஸை புக் செய்யுங்கள்"), text: l("Pick a service and a drop-off time; we send the estimate for your approval before any work starts.", "சேவையையும் கொண்டு வரும் நேரத்தையும் தேர்ந்தெடுங்கள்; வேலை தொடங்கும் முன் உங்கள் ஒப்புதலுக்கு மதிப்பீடு அனுப்புவோம்.") },
};

type Dish = { name: L; price: number; diet?: "veg" | "nonveg" | "egg" };
/** Sample menu (hidden until the owner puts in their own dishes and prices). Prices in paise. */
const MENU: Partial<Record<BusinessType, { name: L; items: Dish[] }[]>> = {
  restaurant: [
    {
      name: l("Tiffin", "டிஃபன்"),
      items: [
        { name: l("Idli (2 pcs)", "இட்லி (2)"), price: 4500, diet: "veg" },
        { name: l("Masala dosa", "மசாலா தோசை"), price: 9000, diet: "veg" },
        { name: l("Ven pongal", "வெண் பொங்கல்"), price: 7000, diet: "veg" },
      ],
    },
    {
      name: l("Meals", "சாப்பாடு"),
      items: [
        { name: l("South Indian meals", "தென்னிந்திய சாப்பாடு"), price: 18000, diet: "veg" },
        { name: l("Chicken biryani", "சிக்கன் பிரியாணி"), price: 22000, diet: "nonveg" },
        { name: l("Egg curry", "முட்டைக் குழம்பு"), price: 12000, diet: "egg" },
      ],
    },
    { name: l("Drinks", "பானங்கள்"), items: [{ name: l("Filter coffee", "ஃபில்டர் காபி"), price: 3000, diet: "veg" }] },
  ],
  bakery: [
    {
      name: l("Cakes", "கேக்குகள்"),
      items: [
        { name: l("Black forest (½ kg)", "பிளாக் ஃபாரஸ்ட் (½ கி)"), price: 45000, diet: "egg" },
        { name: l("Eggless pineapple (½ kg)", "முட்டையில்லா அன்னாசி (½ கி)"), price: 40000, diet: "veg" },
      ],
    },
    {
      name: l("Snacks", "சிற்றுண்டி"),
      items: [
        { name: l("Veg puff", "வெஜ் பஃப்"), price: 2500, diet: "veg" },
        { name: l("Chicken puff", "சிக்கன் பஃப்"), price: 3500, diet: "nonveg" },
      ],
    },
  ],
};
MENU.tea_stall = [
  {
    name: l("Tea & coffee", "டீ & காபி"),
    items: [
      { name: l("Tea", "டீ"), price: 1500, diet: "veg" },
      { name: l("Ginger tea", "இஞ்சி டீ"), price: 2000, diet: "veg" },
      { name: l("Filter coffee", "ஃபில்டர் காபி"), price: 2500, diet: "veg" },
    ],
  },
  {
    name: l("Juices", "ஜூஸ்கள்"),
    items: [
      { name: l("Lime juice", "எலுமிச்சை ஜூஸ்"), price: 3000, diet: "veg" },
      { name: l("Watermelon juice", "தர்பூசணி ஜூஸ்"), price: 4000, diet: "veg" },
      { name: l("Rose milk", "ரோஸ் மில்க்"), price: 3500, diet: "veg" },
    ],
  },
  {
    name: l("Snacks", "சிற்றுண்டி"),
    items: [
      { name: l("Medu vada", "மெது வடை"), price: 1500, diet: "veg" },
      { name: l("Onion bajji", "வெங்காய பஜ்ஜி"), price: 2000, diet: "veg" },
      { name: l("Samosa", "சமோசா"), price: 2000, diet: "veg" },
    ],
  },
];
MENU.cloud_kitchen = MENU.restaurant;

const MENU_TITLE: L = l("Today's menu", "இன்றைய மெனு");

/** FAQ questions per trade with draft answers (hidden until the owner checks them). */
const FAQ: Partial<Record<BusinessType, { q: L; a: L }[]>> = {
  fashion: [
    { q: l("How do I find my size?", "என் அளவை எப்படி அறிவது?"), a: l("Each product has a size guide. Between two sizes? Pick the larger one.", "ஒவ்வொரு பொருளிலும் அளவு வழிகாட்டி உள்ளது. இரண்டு அளவுகளுக்கு இடையிலா? பெரியதைத் தேர்ந்தெடுங்கள்.") },
    { q: l("Can I return or exchange?", "திருப்பி அல்லது மாற்றிக் கொள்ளலாமா?"), a: l("Yes, unused items within 7 days. See our returns policy.", "ஆம், பயன்படுத்தாதவை 7 நாட்களுக்குள். எங்கள் திருப்பக் கொள்கையைப் பாருங்கள்.") },
    { q: l("Do you offer cash on delivery?", "டெலிவரியில் பணம் செலுத்தலாமா?"), a: l("Yes, pay when your order arrives.", "ஆம், ஆர்டர் வந்ததும் செலுத்துங்கள்.") },
  ],
  pharmacy: [
    { q: l("How do I order prescription medicines?", "மருந்துச் சீட்டு மருந்துகளை எப்படி ஆர்டர் செய்வது?"), a: l("Add the medicines and upload a photo of your prescription at checkout. Our pharmacist checks it before packing.", "மருந்துகளைச் சேர்த்து, செக்அவுட்டில் மருந்துச் சீட்டின் படத்தைப் பதிவேற்றுங்கள். பேக் செய்யும் முன் எங்கள் மருந்தாளர் சரிபார்ப்பார்.") },
    { q: l("How fast is delivery?", "டெலிவரி எவ்வளவு விரைவில்?"), a: l("Usually the same day in town.", "பொதுவாக ஊருக்குள் அதே நாளில்.") },
    { q: l("Are the medicines genuine?", "மருந்துகள் அசலானவையா?"), a: l("Yes, from authorised distributors only, stored as required.", "ஆம், அங்கீகரிக்கப்பட்ட விநியோகஸ்தர்களிடமிருந்து மட்டும், முறைப்படி சேமிக்கப்படுகின்றன.") },
  ],
  cloud_kitchen: [
    { q: l("Where do you deliver?", "எங்கே டெலிவரி செய்கிறீர்கள்?"), a: l("Within a few kilometres of our kitchen. Enter your pincode at checkout.", "எங்கள் சமையலறையிலிருந்து சில கி.மீ. தூரம் வரை. செக்அவுட்டில் பின்கோடை உள்ளிடுங்கள்.") },
    { q: l("Can I order in advance?", "முன்கூட்டியே ஆர்டர் செய்யலாமா?"), a: l("Yes, for parties and bulk orders call us a day ahead.", "ஆம், விருந்து மற்றும் மொத்த ஆர்டர்களுக்கு ஒரு நாள் முன் அழையுங்கள்.") },
  ],
  grocery: [
    { q: l("Is there a minimum order?", "குறைந்தபட்ச ஆர்டர் உண்டா?"), a: l("No minimum. Free delivery on bigger orders.", "குறைந்தபட்சம் இல்லை. பெரிய ஆர்டர்களுக்கு இலவச டெலிவரி.") },
    { q: l("How are loose items weighed?", "தளர்வான பொருட்கள் எப்படி எடை போடப்படுகின்றன?"), a: l("On a stamped electronic scale; you pay for the exact weight.", "முத்திரையிட்ட மின்னணு எடைக் கருவியில்; சரியான எடைக்கு மட்டும் செலுத்துங்கள்.") },
  ],
  fresh: [
    { q: l("When is it harvested / caught?", "எப்போது அறுவடை / பிடிக்கப்பட்டது?"), a: l("Every morning. What's not fresh, we don't sell.", "ஒவ்வொரு காலையும். புதியதல்லாததை நாங்கள் விற்பதில்லை.") },
    { q: l("Do you clean and cut?", "சுத்தம் செய்து வெட்டித் தருவீர்களா?"), a: l("Yes, tell us how you'd like it in the order note.", "ஆம், ஆர்டர் குறிப்பில் எப்படி வேண்டும் என்று சொல்லுங்கள்.") },
  ],
  electronics: [
    { q: l("Is there a warranty?", "உத்தரவாதம் உண்டா?"), a: l("Yes, the brand warranty. Your serial number is on the bill.", "ஆம், நிறுவன உத்தரவாதம். வரிசை எண் பில்லில் இருக்கும்.") },
    { q: l("Can I pay in EMI?", "தவணையில் செலுத்தலாமா?"), a: l("Ask us in the shop about card EMI offers.", "கார்டு தவணைச் சலுகைகளைப் பற்றிக் கடையில் கேளுங்கள்.") },
  ],
  repair: [
    { q: l("How long does a repair take?", "பழுது நீக்க எவ்வளவு நேரம்?"), a: l("Most repairs are done the same day. We tell you before we start.", "பெரும்பாலானவை அதே நாளில். தொடங்கும் முன் சொல்வோம்.") },
    { q: l("Is my data safe?", "என் தரவு பாதுகாப்பானதா?"), a: l("We don't open your files. Back up before you hand over the phone.", "உங்கள் கோப்புகளைத் திறப்பதில்லை. கொடுக்கும் முன் பேக்கப் எடுங்கள்.") },
  ],
  salon: [
    { q: l("Do I need an appointment?", "முன்பதிவு தேவையா?"), a: l("Walk-ins are welcome, but booking means no waiting.", "நேரில் வரலாம், ஆனால் முன்பதிவு செய்தால் காத்திருக்க வேண்டாம்.") },
    { q: l("Which products do you use?", "எந்தப் பொருட்களைப் பயன்படுத்துகிறீர்கள்?"), a: l("Professional, skin-tested brands. Ask us about allergies.", "தொழில்முறை, தோல் சோதனை செய்த பிராண்டுகள். ஒவ்வாமை பற்றிக் கேளுங்கள்.") },
  ],
  gym: [
    { q: l("Can I try before I join?", "சேரும் முன் முயற்சிக்கலாமா?"), a: l("Yes, book a free trial workout.", "ஆம், இலவச சோதனைப் பயிற்சியை முன்பதிவு செய்யுங்கள்.") },
    { q: l("What are the timings?", "நேரங்கள் என்ன?"), a: l("Morning and evening batches every day; see the hours below.", "தினமும் காலை மற்றும் மாலை பிரிவுகள்; கீழே நேரங்களைப் பாருங்கள்.") },
    { q: l("Do you have trainers for women?", "பெண்களுக்குப் பயிற்சியாளர் உண்டா?"), a: l("Yes, ask for a women's batch when you book.", "ஆம், முன்பதிவு செய்யும்போது பெண்கள் பிரிவைக் கேளுங்கள்.") },
  ],
  hardware: [
    { q: l("Do you deliver to site?", "கட்டுமான இடத்திற்கு டெலிவரி உண்டா?"), a: l("Yes, for bulk orders within town.", "ஆம், ஊருக்குள் மொத்த ஆர்டர்களுக்கு.") },
    { q: l("Can I get a GST bill?", "GST பில் கிடைக்குமா?"), a: l("Yes, add your GSTIN at checkout.", "ஆம், செக்அவுட்டில் உங்கள் GSTIN-ஐச் சேர்க்கவும்.") },
  ],
  tailoring: [
    { q: l("How long does stitching take?", "தைக்க எவ்வளவு நாள்?"), a: l("Usually 5 days; festival season may take longer.", "பொதுவாக 5 நாள்; பண்டிகைக் காலத்தில் அதிகமாகலாம்.") },
    { q: l("Can I send my own fabric?", "என் துணியைக் கொடுக்கலாமா?"), a: l("Yes, bring it in or book a pick-up.", "ஆம், கொண்டு வாருங்கள் அல்லது எடுத்துச் செல்ல முன்பதிவு செய்யுங்கள்.") },
  ],
  organic: [
    { q: l("Are your products certified organic?", "உங்கள் பொருட்கள் ஆர்கானிக் சான்றிதழ் பெற்றவையா?"), a: l("Each product page says whether it is certified or naturally grown by farmers we buy from directly.", "ஒவ்வொரு பொருளின் பக்கத்திலும் அது சான்றிதழ் பெற்றதா, நாங்கள் நேரடியாக வாங்கும் விவசாயிகள் இயற்கை முறையில் விளைவித்ததா என்று இருக்கும்.") },
    { q: l("How long do millets and cold-pressed oils keep?", "சிறுதானியமும் செக்கு எண்ணெயும் எவ்வளவு நாள் இருக்கும்?"), a: l("Millets about 6 months in an airtight jar; cold-pressed oils 6 months away from sunlight. The packed date is on every pack.", "காற்றுப் புகாத டப்பாவில் சிறுதானியம் சுமார் 6 மாதம்; வெயில் படாமல் வைத்தால் செக்கு எண்ணெய் 6 மாதம். ஒவ்வொரு பேக்கிலும் பேக் செய்த தேதி உள்ளது.") },
    { q: l("How do I cook millets?", "சிறுதானியத்தை எப்படிச் சமைப்பது?"), a: l("Rinse, soak for 30 minutes and cook like rice with 2½ to 3 cups of water per cup.", "கழுவி, 30 நிமிடம் ஊறவைத்து, ஒரு கப்புக்கு 2½ முதல் 3 கப் தண்ணீர் விட்டு அரிசி போலச் சமையுங்கள்.") },
  ],
  footwear: [
    { q: l("How do I pick my size?", "என் அளவை எப்படித் தேர்ந்தெடுப்பது?"), a: l("Sizes are UK/India. Between two sizes, or wide feet? Pick the larger one.", "அளவுகள் UK/இந்திய அளவுகள். இரண்டு அளவுகளுக்கு இடையிலா, அகலமான பாதமா? பெரியதைத் தேர்ந்தெடுங்கள்.") },
    { q: l("Can I exchange if it doesn't fit?", "அளவு சரியில்லையென்றால் மாற்றலாமா?"), a: l("Yes, unworn pairs in the original box within 7 days.", "ஆம், அணியாத ஜோடியை அசல் பெட்டியுடன் 7 நாட்களுக்குள்.") },
    { q: l("Do you have school shoes in all sizes?", "எல்லா அளவுகளிலும் பள்ளி ஷூ உண்டா?"), a: l("Yes, black and white school shoes from kids' sizes up; ask us for bulk school orders.", "ஆம், குழந்தைகள் அளவு முதல் கருப்பு, வெள்ளைப் பள்ளி ஷூக்கள் உண்டு; பள்ளிகளுக்கான மொத்த ஆர்டர்களுக்குக் கேளுங்கள்.") },
  ],
  stationery: [
    { q: l("Can you pack my child's school list?", "என் குழந்தையின் பள்ளிப் பட்டியலைத் தயார் செய்வீர்களா?"), a: l("Yes, send us a photo of the list and we'll pack the full set for pick-up or delivery.", "ஆம், பட்டியலின் படத்தை அனுப்புங்கள்; முழுத் தொகுப்பையும் பேக் செய்து, நேரில் பெறவோ டெலிவரிக்கோ தயாராக வைப்போம்.") },
    { q: l("Do you have books for my syllabus?", "எங்கள் பாடத்திட்டத்துக்கான புத்தகங்கள் உண்டா?"), a: l("Books and guides are listed by class and board: State board, CBSE and Matriculation.", "புத்தகங்களும் வழிகாட்டிகளும் வகுப்பு, பாடத்திட்டம் வாரியாக உள்ளன: மாநிலப் பாடத்திட்டம், CBSE, மெட்ரிகுலேஷன்.") },
    { q: l("Do you give bulk rates to offices and schools?", "அலுவலகங்கள், பள்ளிகளுக்கு மொத்த விலை உண்டா?"), a: l("Yes, ask us for a quote; we give a GST bill too.", "ஆம், விலைப்பட்டியல் கேளுங்கள்; GST பில்லும் தருவோம்.") },
  ],
  toys: [
    { q: l("How do I pick a toy for my child's age?", "குழந்தையின் வயதுக்கேற்ற பொம்மையை எப்படித் தேர்ந்தெடுப்பது?"), a: l("Shop by age: every toy shows the age it suits. Toys with small parts are for 3 years and up.", "வயது வாரியாகப் பாருங்கள்: ஒவ்வொரு பொம்மையிலும் ஏற்ற வயது இருக்கும். சிறு பாகங்கள் உள்ளவை 3 வயதுக்கு மேல்.") },
    { q: l("Are the toys safe?", "பொம்மைகள் பாதுகாப்பானவையா?"), a: l("We sell BIS-marked toys; the safety mark is on each product page.", "BIS முத்திரையுள்ள பொம்மைகளையே விற்கிறோம்; பாதுகாப்பு முத்திரை ஒவ்வொரு பொருளின் பக்கத்திலும் உள்ளது.") },
    { q: l("Are batteries included?", "பேட்டரி சேர்த்து வருமா?"), a: l("Each product says whether batteries are included and which ones it needs.", "பேட்டரி சேர்த்து வருமா, எந்த பேட்டரி தேவை என்று ஒவ்வொரு பொருளிலும் குறிப்பிட்டிருக்கும்.") },
  ],
  cosmetics: [
    { q: l("Are the products genuine?", "பொருட்கள் அசலானவையா?"), a: l("Yes, from the brands or their authorised distributors, with batch and expiry dates.", "ஆம், பிராண்டுகளிடமிருந்தோ அவற்றின் அங்கீகரிக்கப்பட்ட விநியோகஸ்தர்களிடமிருந்தோ, பேட்ச், காலாவதி தேதியுடன்.") },
    { q: l("How do I choose my shade?", "என் நிறத்தை எப்படித் தேர்ந்தெடுப்பது?"), a: l("Each shade has a swatch; not sure? Message us a photo in daylight and we'll suggest one.", "ஒவ்வொரு நிறத்துக்கும் மாதிரி உள்ளது; சந்தேகமா? பகல் வெளிச்சத்தில் எடுத்த படத்தை அனுப்புங்கள், பொருத்தமானதைச் சொல்வோம்.") },
    { q: l("Can I return a cosmetic?", "அழகுப் பொருளைத் திருப்பித் தரலாமா?"), a: l("Sealed, unopened items within 7 days. Opened products can't be returned for hygiene reasons.", "சீல் உடைக்காத, திறக்காத பொருட்களை 7 நாட்களுக்குள். சுகாதாரக் காரணங்களால் திறந்தவற்றைத் திருப்ப இயலாது.") },
  ],
  crackers: [
    { q: l("Do you deliver crackers?", "பட்டாசுகளை டெலிவரி செய்வீர்களா?"), a: l("Crackers can't go by courier. Order online and pick up at the shop, or ask us about local delivery in our own vehicle.", "பட்டாசுகளை கூரியரில் அனுப்ப இயலாது. ஆன்லைனில் ஆர்டர் செய்து கடையில் பெற்றுக் கொள்ளுங்கள், அல்லது எங்கள் சொந்த வண்டியில் உள்ளூர் டெலிவரி பற்றிக் கேளுங்கள்.") },
    { q: l("Are these green crackers?", "இவை பசுமைப் பட்டாசுகளா?"), a: l("Products marked 'Green cracker' carry the CSIR-NEERI green logo; it's shown on each product page.", "'பசுமைப் பட்டாசு' எனக் குறிக்கப்பட்டவற்றில் CSIR-NEERI பசுமை முத்திரை உள்ளது; ஒவ்வொரு பொருளின் பக்கத்திலும் காட்டப்பட்டுள்ளது.") },
    { q: l("How do I burst crackers safely?", "பட்டாசுகளைப் பாதுகாப்பாக வெடிப்பது எப்படி?"), a: l("Light them in an open space with a bucket of water nearby, keep children with an adult, wear cotton clothes and never relight one that didn't go off.", "திறந்த வெளியில், அருகில் ஒரு வாளித் தண்ணீருடன் வெடியுங்கள்; குழந்தைகளுடன் பெரியவர் இருக்கட்டும்; பருத்தி ஆடை அணியுங்கள்; வெடிக்காததை மீண்டும் பற்ற வைக்காதீர்கள்.") },
  ],
  florist_pooja: [
    { q: l("How are flowers sold?", "பூக்கள் எப்படி விற்கப்படுகின்றன?"), a: l("Loose flowers by weight on a stamped scale, jasmine and other strings by the muzham, garlands by length or by the piece.", "உதிரிப் பூக்கள் முத்திரையிட்ட தராசில் எடைக்கு, மல்லிகை போன்ற சரங்கள் முழக் கணக்கில், மாலைகள் நீளத்துக்கு அல்லது எண்ணிக்கைக்கு.") },
    { q: l("Can I order a wedding garland?", "திருமண மாலை ஆர்டர் செய்யலாமா?"), a: l("Yes, at least two days ahead: tell us the flowers, the length and the date.", "ஆம், குறைந்தது இரண்டு நாள் முன்பே: பூக்கள், நீளம், தேதியைச் சொல்லுங்கள்.") },
    { q: l("How do I keep jasmine fresh?", "மல்லிகையை வாடாமல் வைப்பது எப்படி?"), a: l("Wrap it in a damp cloth or keep it in a closed box in the fridge; it stays fresh till the next morning.", "ஈரத் துணியில் சுற்றி வையுங்கள், அல்லது மூடிய டப்பாவில் ஃப்ரிட்ஜில் வையுங்கள்; மறுநாள் காலை வரை வாடாது.") },
  ],
  mobile_accessories: [
    { q: l("Will it fit my phone?", "என் போனுக்குப் பொருந்துமா?"), a: l("Each case and screen guard lists the exact models it fits. Not sure? Send us your phone's model name.", "ஒவ்வொரு கேஸ், ஸ்கிரீன் கார்டிலும் பொருந்தும் மாடல்கள் குறிப்பிடப்பட்டுள்ளன. சந்தேகமா? உங்கள் போனின் மாடல் பெயரை அனுப்புங்கள்.") },
    { q: l("Do you fix screen guards?", "ஸ்கிரீன் கார்டு ஒட்டித் தருவீர்களா?"), a: l("Yes, at the shop, in a few minutes.", "ஆம், கடையிலேயே, சில நிமிடங்களில்.") },
    { q: l("Is there a warranty on chargers and earphones?", "சார்ஜர், இயர்போனுக்கு வாரண்டி உண்டா?"), a: l("Branded chargers, earphones and power banks carry the brand's warranty; keep your bill.", "பிராண்டட் சார்ஜர், இயர்போன், பவர் பேங்க்குகளுக்கு நிறுவன வாரண்டி உண்டு; பில்லை வைத்திருங்கள்.") },
  ],
  furniture: [
    { q: l("Do you deliver and assemble?", "டெலிவரி செய்து பொருத்தித் தருவீர்களா?"), a: l("Yes, our team delivers in town and assembles it in your home; for places further away we tell you the charge before you order.", "ஆம், ஊருக்குள் எங்கள் குழு டெலிவரி செய்து வீட்டிலேயே பொருத்தும்; தொலைவான இடங்களுக்கு ஆர்டருக்கு முன்பே கட்டணத்தைச் சொல்வோம்.") },
    { q: l("Will it fit my room?", "என் அறைக்குப் பொருந்துமா?"), a: l("Every piece lists its length, width and height. Measure the room and the doorway, and ask us if you're unsure.", "ஒவ்வொரு பொருளுக்கும் நீளம், அகலம், உயரம் குறிப்பிடப்பட்டுள்ளது. அறையையும் வாசலையும் அளந்து பாருங்கள்; சந்தேகமிருந்தால் கேளுங்கள்.") },
    { q: l("Can I get a custom size?", "எனக்கு வேண்டிய அளவில் செய்து தருவீர்களா?"), a: l("Many pieces can be made in your size or wood; ask us for a quote and the time it takes.", "பல பொருட்களை உங்கள் அளவில் அல்லது விரும்பிய மரத்தில் செய்து தருவோம்; விலையையும் நேரத்தையும் கேளுங்கள்.") },
  ],
  home_decor: [
    { q: l("How do I care for brass?", "பித்தளையை எப்படிப் பராமரிப்பது?"), a: l("Wipe it with a dry cloth; now and then polish it with tamarind or a brass cleaner to bring back the shine.", "உலர்ந்த துணியால் துடையுங்கள்; பளபளப்பு திரும்ப அவ்வப்போது புளி அல்லது பித்தளை கிளீனரால் தேயுங்கள்.") },
    { q: l("Do you pack fragile pieces safely?", "உடையக்கூடியவற்றைப் பத்திரமாக பேக் செய்வீர்களா?"), a: l("Glass, ceramic and clay pieces are bubble-wrapped and boxed. If something arrives broken, send us a photo within 2 days.", "கண்ணாடி, பீங்கான், மண் பொருட்கள் பபிள் ராப் செய்து பெட்டியில் அனுப்பப்படும். உடைந்து வந்தால் 2 நாட்களுக்குள் படம் அனுப்புங்கள்.") },
    { q: l("Can I order return gifts in bulk?", "திருப்பிக் கொடுக்கும் பரிசுகளை மொத்தமாக ஆர்டர் செய்யலாமா?"), a: l("Yes, for weddings, housewarmings and functions: tell us how many and your budget, and we'll suggest options.", "ஆம், திருமணம், புதுமனை புகுவிழா, விசேஷங்களுக்கு: எண்ணிக்கையையும் பட்ஜெட்டையும் சொல்லுங்கள், பொருத்தமானவற்றைப் பரிந்துரைப்போம்.") },
  ],
  pet_shop: [
    { q: l("Which food is right for my pet?", "என் செல்லத்துக்கு எந்த உணவு சரி?"), a: l("Pick by pet, age and size: every food lists the life stage and breed size it suits. If your pet has a health problem, ask your vet first.", "செல்லப்பிராணி, வயது, அளவு பார்த்துத் தேர்ந்தெடுங்கள்: ஒவ்வொரு உணவிலும் ஏற்ற வயதும் இன அளவும் குறிப்பிடப்பட்டுள்ளன. உடல்நலப் பிரச்சினை இருந்தால் முதலில் கால்நடை மருத்துவரிடம் கேளுங்கள்.") },
    { q: l("Do you have small packs to try?", "சோதித்துப் பார்க்கச் சிறிய பேக் உண்டா?"), a: l("Most foods come in several pack sizes; ask us for a trial pack before you buy a big bag.", "பெரும்பாலான உணவுகள் பல அளவுகளில் உள்ளன; பெரிய பை வாங்கும் முன் சோதனை பேக் கேளுங்கள்.") },
    { q: l("Can you keep my pet's food ready every month?", "ஒவ்வொரு மாதமும் என் செல்லத்தின் உணவைத் தயாராக வைப்பீர்களா?"), a: l("Yes, message us the food and pack size and we'll keep it ready, or deliver it, every month.", "ஆம், உணவின் பெயரையும் பேக் அளவையும் அனுப்புங்கள்; ஒவ்வொரு மாதமும் தயாராக வைப்போம், அல்லது டெலிவரி செய்வோம்.") },
  ],
  sports: [
    { q: l("How do I choose the right bat size?", "சரியான பேட் அளவை எப்படித் தேர்ந்தெடுப்பது?"), a: l("Bats go by height: sizes 4 to 6 for children, SH (short handle) for most adults. Come in and feel the weight.", "பேட் அளவு உயரத்தைப் பொறுத்தது: குழந்தைகளுக்கு 4 முதல் 6, பெரும்பாலான பெரியவர்களுக்கு SH (ஷார்ட் ஹேண்டில்). நேரில் வந்து எடையைப் பாருங்கள்.") },
    { q: l("Do you string badminton rackets?", "பேட்மிண்டன் ராக்கெட்டுக்கு ஸ்ட்ரிங் போடுவீர்களா?"), a: l("Yes, bring your racket and tell us the string and tension you like.", "ஆம், ராக்கெட்டைக் கொண்டு வந்து விரும்பும் ஸ்ட்ரிங்கையும் டென்ஷனையும் சொல்லுங்கள்.") },
    { q: l("Do you make team jerseys?", "அணி ஜெர்சிகள் செய்து தருவீர்களா?"), a: l("Yes, for schools, clubs and offices, with names and numbers printed; ask us for a quote.", "ஆம், பள்ளிகள், கிளப்புகள், அலுவலகங்களுக்குப் பெயரும் எண்ணும் அச்சிட்டு; விலைப்பட்டியல் கேளுங்கள்.") },
  ],
  tea_stall: [
    { q: l("Can I order ahead and pick up?", "முன்பே ஆர்டர் செய்து எடுத்துச் செல்லலாமா?"), a: l("Yes, order online and collect it at the counter; your token number is on the order.", "ஆம், ஆன்லைனில் ஆர்டர் செய்து கவுண்டரில் பெற்றுக் கொள்ளுங்கள்; உங்கள் டோக்கன் எண் ஆர்டரில் இருக்கும்.") },
    { q: l("Do you take orders for offices and events?", "அலுவலகங்கள், விழாக்களுக்கு ஆர்டர் எடுப்பீர்களா?"), a: l("Yes, tea, coffee and snacks for meetings and functions; call us an hour ahead.", "ஆம், கூட்டங்கள், விசேஷங்களுக்கு டீ, காபி, சிற்றுண்டி; ஒரு மணி நேரம் முன்பே அழையுங்கள்.") },
    { q: l("Can I have juice without sugar or ice?", "சர்க்கரை, ஐஸ் இல்லாமல் ஜூஸ் கிடைக்குமா?"), a: l("Yes, tell us when you order: no sugar, less ice or no ice.", "ஆம், ஆர்டர் செய்யும்போதே சொல்லுங்கள்: சர்க்கரை இல்லாமல், குறைந்த ஐஸ், அல்லது ஐஸ் இல்லாமல்.") },
  ],
  spa: [
    { q: l("What should I bring?", "என்ன கொண்டு வர வேண்டும்?"), a: l("Nothing: we give you a robe, towels and disposables. Come 10 minutes early.", "எதுவும் வேண்டாம்: அங்கி, துண்டுகள், ஒருமுறை பயன்படுத்தும் பொருட்களை நாங்களே தருவோம். 10 நிமிடம் முன்னதாக வாருங்கள்.") },
    { q: l("Can I ask for a woman therapist?", "பெண் சிகிச்சையாளரைக் கேட்கலாமா?"), a: l("Yes, tell us your preference when you book.", "ஆம், முன்பதிவின்போதே உங்கள் விருப்பத்தைச் சொல்லுங்கள்.") },
    { q: l("Is it safe in pregnancy or with a health condition?", "கர்ப்ப காலத்திலோ உடல்நலப் பிரச்சினையுடனோ பாதுகாப்பானதா?"), a: l("Tell us when you book. Some therapies aren't suitable; we'll suggest a gentle one or ask you to check with your doctor.", "முன்பதிவின்போதே சொல்லுங்கள். சில சிகிச்சைகள் ஏற்றவை அல்ல; மென்மையான ஒன்றைப் பரிந்துரைப்போம், அல்லது மருத்துவரிடம் கேட்கச் சொல்வோம்.") },
  ],
  school: [
    { q: l("What is the age criterion for admission?", "சேர்க்கைக்கு வயது வரம்பு என்ன?"), a: l("Age criteria depend on the class; ask the office for this year's cut-off dates for each class.", "வயது வரம்பு வகுப்பைப் பொறுத்தது; ஒவ்வொரு வகுப்புக்கும் இந்த ஆண்டுக்கான தேதிகளை அலுவலகத்தில் கேளுங்கள்.") },
    { q: l("Which documents are needed?", "என்னென்ன ஆவணங்கள் தேவை?"), a: l("Usually the birth certificate, previous school's transfer certificate and report card, passport photos and address proof. The office will confirm the list.", "பொதுவாகப் பிறப்புச் சான்றிதழ், முந்தைய பள்ளியின் மாற்றுச் சான்றிதழ், மதிப்பெண் அட்டை, புகைப்படங்கள், முகவரிச் சான்று. முழுப் பட்டியலை அலுவலகம் உறுதி செய்யும்.") },
    { q: l("Is school transport available?", "பள்ளி வாகன வசதி உண்டா?"), a: l("Yes, on selected routes; ask the office whether your area is covered.", "ஆம், குறிப்பிட்ட வழித்தடங்களில்; உங்கள் பகுதி உள்ளதா என அலுவலகத்தில் கேளுங்கள்.") },
    { q: l("How do I know about the fees?", "கட்டண விவரங்களை எப்படி அறிவது?"), a: l("Fees differ by class. Send an enquiry or visit the office and we will share the fee structure.", "கட்டணம் வகுப்புக்கு ஏற்ப மாறும். விசாரணை அனுப்புங்கள் அல்லது அலுவலகத்துக்கு வாருங்கள்; கட்டண விவரத்தைப் பகிர்வோம்.") },
    { q: l("Which board and syllabus do you follow?", "எந்த வாரியம், பாடத்திட்டத்தைப் பின்பற்றுகிறீர்கள்?"), a: l("Ask the office about the board, syllabus and medium of instruction for each class.", "ஒவ்வொரு வகுப்புக்குமான வாரியம், பாடத்திட்டம், பயிற்றுமொழி பற்றி அலுவலகத்தில் கேளுங்கள்.") },
  ],
  general_shop: [
    { q: l("Do you deliver?", "டெலிவரி உண்டா?"), a: l("Yes, enter your pincode at checkout to see delivery options and charges.", "ஆம், செக்அவுட்டில் பின்கோடை உள்ளிட்டு டெலிவரி வசதிகளையும் கட்டணத்தையும் பாருங்கள்.") },
    { q: l("Can I pick up from the shop?", "கடையில் நேரில் எடுத்துக் கொள்ளலாமா?"), a: l("Yes, choose pickup at checkout and we call you when the order is packed.", "ஆம், செக்அவுட்டில் நேரில் பெறுதலைத் தேர்ந்தெடுங்கள்; ஆர்டர் தயாரானதும் அழைப்போம்.") },
    { q: l("Can I return or exchange?", "திருப்பி அல்லது மாற்றிக் கொள்ளலாமா?"), a: l("Unused items with the bill can be returned or exchanged; see our returns policy.", "பில்லுடன் பயன்படுத்தாத பொருட்களைத் திருப்பலாம் அல்லது மாற்றலாம்; எங்கள் திருப்பக் கொள்கையைப் பாருங்கள்.") },
  ],
  general_counter: [
    { q: l("Do I get a GST bill?", "GST பில் கிடைக்குமா?"), a: l("Yes, every sale has a GST bill; add your GSTIN when you order.", "ஆம், ஒவ்வொரு விற்பனைக்கும் GST பில் உண்டு; ஆர்டர் செய்யும்போது உங்கள் GSTIN-ஐச் சேர்க்கவும்.") },
    { q: l("Can I order and collect later?", "ஆர்டர் செய்து பிறகு எடுத்துக் கொள்ளலாமா?"), a: l("Yes, order online and collect at the counter when it is ready.", "ஆம், ஆன்லைனில் ஆர்டர் செய்து தயாரானதும் கவுண்டரில் பெற்றுக் கொள்ளுங்கள்.") },
    { q: l("Do you give bulk rates?", "மொத்த விலை உண்டா?"), a: l("Yes, ask us for a quote on large orders.", "ஆம், பெரிய ஆர்டர்களுக்கு விலைப்பட்டியல் கேளுங்கள்.") },
  ],
  general_services: [
    { q: l("How do I book?", "எப்படி புக் செய்வது?"), a: l("Pick a service and a time on this page; we confirm by call or message.", "இந்தப் பக்கத்தில் சேவையையும் நேரத்தையும் தேர்ந்தெடுங்கள்; அழைப்பு அல்லது செய்தி மூலம் உறுதி செய்வோம்.") },
    { q: l("Will I get a quote first?", "முதலில் விலைப்பட்டியல் கிடைக்குமா?"), a: l("Yes, we tell you the price before we start.", "ஆம், தொடங்கும் முன் விலையைச் சொல்வோம்.") },
    { q: l("Can I reschedule?", "நேரத்தை மாற்றலாமா?"), a: l("Yes, call or message us at least a few hours before your slot.", "ஆம், உங்கள் நேரத்துக்குச் சில மணி நேரம் முன்பாவது அழையுங்கள் அல்லது செய்தி அனுப்புங்கள்.") },
  ],
  textiles_wholesale: [
    { q: l("Do you sell by the metre?", "மீட்டர் கணக்கில் விற்பீர்களா?"), a: l("Yes, any length from the roll; wholesale rates apply from a bale or a set minimum.", "ஆம், ரோலிலிருந்து தேவையான நீளம்; பேல் அல்லது குறிப்பிட்ட குறைந்தபட்சத்திலிருந்து மொத்த விலை.") },
    { q: l("What is the minimum order?", "குறைந்தபட்ச ஆர்டர் என்ன?"), a: l("It depends on the fabric; each product lists its minimum quantity.", "துணியைப் பொறுத்தது; ஒவ்வொரு பொருளிலும் குறைந்தபட்ச அளவு குறிப்பிடப்பட்டுள்ளது.") },
    { q: l("Can you send samples?", "மாதிரிகள் அனுப்புவீர்களா?"), a: l("Yes, ask for swatches of the fabrics you are interested in.", "ஆம், உங்களுக்குப் பிடித்த துணிகளின் மாதிரிகளைக் கேளுங்கள்.") },
  ],
  catering: [
    { q: l("How early should I book?", "எவ்வளவு முன்பே புக் செய்ய வேண்டும்?"), a: l("For weddings book a month ahead; for parties and office meals a few days before.", "திருமணங்களுக்கு ஒரு மாதம் முன்பே; விழாக்கள், அலுவலக உணவுக்குச் சில நாள் முன்பு.") },
    { q: l("Do you take an advance?", "முன்பணம் பெறுவீர்களா?"), a: l("Yes, a part advance confirms your date; the balance is paid after the event.", "ஆம், ஒரு பகுதி முன்பணம் தேதியை உறுதி செய்யும்; மீதியை நிகழ்வுக்குப் பிறகு செலுத்தலாம்.") },
    { q: l("Can you serve at our venue?", "எங்கள் இடத்தில் பரிமாறுவீர்களா?"), a: l("Yes, we cook fresh, deliver and can send serving staff; ask in your quote request.", "ஆம், புதிதாகச் சமைத்து கொண்டு வருகிறோம், பரிமாறும் பணியாளர்களையும் அனுப்புவோம்; விலைப்பட்டியல் கேட்கும்போது சொல்லுங்கள்.") },
  ],
  pet_grooming: [
    { q: l("Which pets do you groom?", "எந்தச் செல்லப்பிராணிகளுக்கு அழகுபடுத்துவீர்கள்?"), a: l("Dogs and cats of all sizes; tell us the breed and size when you book.", "எல்லா அளவு நாய், பூனைகள்; புக் செய்யும்போது இனத்தையும் அளவையும் சொல்லுங்கள்.") },
    { q: l("Does my pet need vaccinations?", "என் செல்லத்துக்குத் தடுப்பூசி தேவையா?"), a: l("Yes, please bring the vaccination card; we groom only vaccinated pets.", "ஆம், தடுப்பூசி அட்டையைக் கொண்டு வாருங்கள்; தடுப்பூசி போட்ட செல்லங்களை மட்டுமே அழகுபடுத்துகிறோம்.") },
    { q: l("How long does grooming take?", "அழகுபடுத்த எவ்வளவு நேரம்?"), a: l("A bath takes about an hour and full grooming about two; we call you when your pet is ready.", "குளிப்பாட்ட சுமார் ஒரு மணி நேரம், முழு அழகுபடுத்தலுக்கு இரண்டு; தயாரானதும் அழைப்போம்.") },
  ],
  photo_studio: [
    { q: l("How do I book a wedding shoot?", "திருமணப் படப்பிடிப்பை எப்படி புக் செய்வது?"), a: l("Send us the date, venue and what you need; we send a package quote and hold your date with an advance.", "தேதி, இடம், தேவையைச் சொல்லுங்கள்; பேக்கேஜ் விலைப்பட்டியல் அனுப்பி, முன்பணத்துடன் தேதியை ஒதுக்குவோம்.") },
    { q: l("When do I get the photos?", "படங்கள் எப்போது கிடைக்கும்?"), a: l("Edited photos in about two weeks and albums in three to four weeks after the event.", "நிகழ்வுக்குப் பிறகு திருத்திய படங்கள் சுமார் இரண்டு வாரத்தில், ஆல்பம் மூன்று முதல் நான்கு வாரத்தில்.") },
    { q: l("Do you do passport photos?", "பாஸ்போர்ட் படங்கள் எடுப்பீர்களா?"), a: l("Yes, in the studio in a few minutes; prints are ready on the spot.", "ஆம், ஸ்டுடியோவில் சில நிமிடங்களில்; அச்சுப் படங்கள் உடனே தயார்.") },
  ],
  laundry: [
    { q: l("How do you charge?", "கட்டணம் எப்படி?"), a: l("By the piece for ironing and dry cleaning, and by the kilo for wash and fold.", "அயர்னிங், டிரை கிளீனிங் எண்ணிக்கைக்கு; துவைத்து மடிக்க கிலோ கணக்கில்.") },
    { q: l("How will I know it is ready?", "தயாரானது எனத் தெரிந்து கொள்வது எப்படி?"), a: l("The slip has the ready date and we message you when your clothes are ready.", "சீட்டில் தயாராகும் தேதி இருக்கும்; துணிகள் தயாரானதும் செய்தி அனுப்புவோம்.") },
    { q: l("What if a garment is damaged?", "துணி சேதமானால்?"), a: l("Tell us at delivery and we will make it right; delicate items are handled with care and noted on the slip.", "டெலிவரியின்போதே சொல்லுங்கள், சரி செய்வோம்; நுட்பமான துணிகள் கவனமாகக் கையாளப்பட்டு சீட்டில் குறிக்கப்படும்.") },
  ],
  event_decor: [
    { q: l("Can you decorate at my venue?", "எங்கள் இடத்தில் அலங்கரிப்பீர்களா?"), a: l("Yes, we visit the venue first, then set up on the day and clear after.", "ஆம், முதலில் இடத்தைப் பார்வையிடுவோம்; நாளன்று அமைத்து, முடிந்ததும் அகற்றுவோம்.") },
    { q: l("How much advance do I pay?", "எவ்வளவு முன்பணம்?"), a: l("Usually half of the quote confirms your date; the rest is due before the event.", "பொதுவாக விலைப்பட்டியலில் பாதி தேதியை உறுதி செய்யும்; மீதி நிகழ்வுக்கு முன்.") },
    { q: l("Do you rent chairs, utensils and lights?", "நாற்காலி, பாத்திரம், விளக்குகள் வாடகைக்கு உண்டா?"), a: l("Yes, rentals are listed with the price per day; ask us for a combined quote.", "ஆம், வாடகைப் பொருட்கள் நாளுக்கான விலையுடன் பட்டியலிடப்பட்டுள்ளன; ஒட்டுமொத்த விலைப்பட்டியல் கேளுங்கள்.") },
  ],
  ac_service: [
    { q: l("How often should I service my AC?", "ஏசியை எவ்வளவு முறை சர்வீஸ் செய்ய வேண்டும்?"), a: l("Twice a year, before summer and after the rains, keeps cooling strong and bills low.", "ஆண்டுக்கு இருமுறை, கோடைக்கு முன்பும் மழைக்குப் பிறகும்; குளிர்ச்சி நன்றாக இருக்கும், மின்கட்டணம் குறையும்.") },
    { q: l("Do you charge for the visit?", "வருகைக்குக் கட்டணம் உண்டா?"), a: l("We tell you the visit and repair charges before we start; nothing is done without your approval.", "தொடங்கும் முன் வருகை, பழுது கட்டணத்தைச் சொல்வோம்; உங்கள் அனுமதியின்றி எதுவும் செய்யப்படாது.") },
    { q: l("What is a yearly care plan?", "ஆண்டுப் பராமரிப்புத் திட்டம் என்றால் என்ன?"), a: l("An annual maintenance contract (AMC) with scheduled services and priority visits.", "திட்டமிட்ட சர்வீஸ்களும் முன்னுரிமை வருகைகளும் கொண்ட ஆண்டுப் பராமரிப்பு ஒப்பந்தம் (AMC).") },
  ],
  print_shop: [
    { q: l("Can I send my file online?", "கோப்பை ஆன்லைனில் அனுப்பலாமா?"), a: l("Yes, send it by WhatsApp or email with the size and number of copies, and collect it when ready.", "ஆம், அளவு, பிரதிகள் எண்ணிக்கையுடன் வாட்ஸ்அப் அல்லது மின்னஞ்சலில் அனுப்புங்கள்; தயாரானதும் பெற்றுக் கொள்ளுங்கள்.") },
    { q: l("How long does a flex or visiting card take?", "ஃபிளெக்ஸ், விசிட்டிங் கார்டு எவ்வளவு நேரம்?"), a: l("Visiting cards in one to two days and flex banners usually the same day.", "விசிட்டிங் கார்டு ஒன்று முதல் இரண்டு நாளில், ஃபிளெக்ஸ் பொதுவாக அதே நாளில்.") },
    { q: l("Do you give bulk rates?", "மொத்த விலை உண்டா?"), a: l("Yes, the price per page or piece comes down on large orders; ask for a quote.", "ஆம், பெரிய ஆர்டர்களுக்குப் பக்கம் அல்லது எண்ணிக்கை விலை குறையும்; விலைப்பட்டியல் கேளுங்கள்.") },
  ],
  tuition: [
    { q: l("Can my child attend a demo class?", "என் குழந்தை டெமோ வகுப்பில் கலந்து கொள்ளலாமா?"), a: l("Yes, book a free demo class and meet the teacher before joining.", "ஆம், இலவச டெமோ வகுப்பை புக் செய்து சேரும் முன் ஆசிரியரைச் சந்தியுங்கள்.") },
    { q: l("How are the fees paid?", "கட்டணம் எப்படிச் செலுத்துவது?"), a: l("Monthly, in advance, by UPI or cash; you get a receipt each time.", "மாதந்தோறும் முன்கூட்டியே, UPI அல்லது பணமாக; ஒவ்வொரு முறையும் ரசீது கிடைக்கும்.") },
    { q: l("How will I know my child's progress?", "என் குழந்தையின் முன்னேற்றத்தை எப்படி அறிவது?"), a: l("Regular tests and a monthly progress report are shared with parents.", "தொடர் தேர்வுகள், மாதாந்திர முன்னேற்ற அறிக்கை பெற்றோருடன் பகிரப்படும்.") },
  ],
  dance_music: [
    { q: l("What age can my child start?", "என் குழந்தை எந்த வயதில் தொடங்கலாம்?"), a: l("Most children start from 5 or 6 years; adults can join at any age.", "பெரும்பாலான குழந்தைகள் 5 அல்லது 6 வயதிலிருந்து; பெரியவர்கள் எந்த வயதிலும் சேரலாம்.") },
    { q: l("Do I need my own instrument?", "எனக்கென்று இசைக்கருவி வேண்டுமா?"), a: l("You can start with the practice instruments in class; we advise on buying one later.", "வகுப்பிலுள்ள பயிற்சிக் கருவிகளுடன் தொடங்கலாம்; பிறகு வாங்க ஆலோசனை தருவோம்.") },
    { q: l("What if I miss a class?", "ஒரு வகுப்பைத் தவறவிட்டால்?"), a: l("Tell us in advance and we move you to a make-up class in another batch.", "முன்பே சொல்லுங்கள்; மற்றொரு பேட்சில் ஈடுசெய் வகுப்புக்கு மாற்றுவோம்.") },
  ],
  yoga: [
    { q: l("I am a beginner, can I join?", "நான் தொடக்கநிலை, சேரலாமா?"), a: l("Yes, our beginner batches go slowly and the teacher adjusts each posture for you.", "ஆம், தொடக்கநிலை பேட்ச்கள் மெதுவாக நடக்கும்; ஒவ்வொரு ஆசனத்தையும் ஆசிரியர் உங்களுக்கு ஏற்ப மாற்றுவார்.") },
    { q: l("Is yoga safe with a health condition?", "உடல்நலப் பிரச்சினை இருந்தால் யோகா பாதுகாப்பானதா?"), a: l("Tell the teacher about any condition or injury; for serious conditions please check with your doctor first.", "ஏதேனும் பிரச்சினை, காயம் இருந்தால் ஆசிரியரிடம் சொல்லுங்கள்; தீவிர நிலைகளில் முதலில் மருத்துவரிடம் கேளுங்கள்.") },
    { q: l("What are the membership plans?", "உறுப்பினர் திட்டங்கள் என்ன?"), a: l("Monthly and quarterly memberships with a fixed number of classes; see the plans below.", "நிலையான வகுப்புகள் கொண்ட மாதம், காலாண்டு உறுப்பினர் திட்டங்கள்; கீழே பாருங்கள்.") },
  ],
  driving_school: [
    { q: l("How many days is the course?", "பயிற்சி எத்தனை நாட்கள்?"), a: l("Most courses run 21 to 30 days with a fixed daily slot; refresher lessons are shorter.", "பெரும்பாலான பயிற்சிகள் ஒரு நிலையான தினசரி நேரத்துடன் 21 முதல் 30 நாட்கள்; புத்தாக்கப் பாடங்கள் குறைவு.") },
    { q: l("Do you help with the licence?", "உரிமம் பெற உதவுவீர்களா?"), a: l("Yes, we help with the learner's licence, the test slot booking and the paperwork.", "ஆம், எல்.எல்.ஆர்., தேர்வு நேரப் பதிவு, ஆவணப் பணிகளில் உதவுவோம்.") },
    { q: l("Which cars do you train on?", "எந்தக் கார்களில் பயிற்சி?"), a: l("Manual and automatic dual-control cars; tell us which one you want.", "கையால் மாற்றும் மற்றும் தானியங்கி இரட்டைக் கட்டுப்பாட்டுக் கார்கள்; எது வேண்டும் என்று சொல்லுங்கள்.") },
  ],
  paints: [
    { q: l("How much paint do I need?", "எவ்வளவு பெயின்ட் தேவை?"), a: l("Tell us the wall area and the number of coats; as a guide one litre covers 100 to 140 sq ft per coat.", "சுவரின் பரப்பையும் கோட் எண்ணிக்கையையும் சொல்லுங்கள்; ஒரு லிட்டர் ஒரு கோட்டுக்குச் சுமார் 100 முதல் 140 சதுர அடி.") },
    { q: l("Can you match a shade?", "நிறத்தைப் பொருத்தித் தருவீர்களா?"), a: l("Bring a small sample or a shade card number and we mix it on the machine.", "சிறிய மாதிரி அல்லது ஷேட் கார்டு எண்ணைக் கொண்டு வாருங்கள்; இயந்திரத்தில் கலந்து தருவோம்.") },
    { q: l("Do you give contractor rates?", "ஒப்பந்ததாரர் விலை உண்டா?"), a: l("Yes, ask us for a quote on bulk and repeat orders; we give a GST bill.", "ஆம், மொத்த, தொடர் ஆர்டர்களுக்கு விலைப்பட்டியல் கேளுங்கள்; GST பில் தருவோம்.") },
  ],
  electricals: [
    { q: l("Is there a warranty?", "வாரண்டி உண்டா?"), a: l("Fans, lights and appliances carry the brand warranty; the serial number is on your bill.", "ஃபேன், விளக்கு, உபகரணங்களுக்கு நிறுவன வாரண்டி உண்டு; வரிசை எண் உங்கள் பில்லில் இருக்கும்.") },
    { q: l("Are the wires ISI marked?", "வயர்கள் ISI முத்திரை உள்ளவையா?"), a: l("Yes, we sell ISI-marked wires and cables from known brands only.", "ஆம், அறியப்பட்ட பிராண்டுகளின் ISI முத்திரை வயர்கள், கேபிள்களை மட்டுமே விற்கிறோம்.") },
    { q: l("Do you give electrician rates?", "எலக்ட்ரீஷியன் விலை உண்டா?"), a: l("Yes, ask us for a quote on bulk and repeat orders; we give a GST bill.", "ஆம், மொத்த, தொடர் ஆர்டர்களுக்கு விலைப்பட்டியல் கேளுங்கள்; GST பில் தருவோம்.") },
  ],
  tiles_sanitary: [
    { q: l("How many boxes do I need?", "எத்தனை பெட்டிகள் தேவை?"), a: l("Tell us the floor or wall area in sq ft; add about 10% extra for cutting and breakage.", "தரை அல்லது சுவரின் பரப்பைச் சதுர அடியில் சொல்லுங்கள்; வெட்டுதல், உடைவுக்கு சுமார் 10% கூடுதல் சேர்க்கவும்.") },
    { q: l("Do you deliver to site?", "கட்டுமான இடத்துக்கு டெலிவரி உண்டா?"), a: l("Yes, with careful handling; we tell you the charge for your area before you order.", "ஆம், கவனமாகக் கையாண்டு; ஆர்டருக்கு முன் உங்கள் பகுதிக்கான கட்டணத்தைச் சொல்வோம்.") },
    { q: l("Can I return unopened boxes?", "திறக்காத பெட்டிகளைத் திருப்பலாமா?"), a: l("Unopened boxes of the same batch can be returned within a few days; ask us for the terms.", "அதே பேட்சின் திறக்காத பெட்டிகளைச் சில நாட்களுக்குள் திருப்பலாம்; விதிமுறைகளைக் கேளுங்கள்.") },
  ],
  two_wheeler_service: [
    { q: l("How long does a service take?", "சர்வீஸுக்கு எவ்வளவு நேரம்?"), a: l("A general service is usually ready the same day; we tell you when you drop the bike.", "பொது சர்வீஸ் பொதுவாக அதே நாளில் தயார்; பைக்கைக் கொடுக்கும்போது சொல்வோம்.") },
    { q: l("Will you remind me of the next service?", "அடுத்த சர்வீஸை நினைவூட்டுவீர்களா?"), a: l("Yes, we message you on WhatsApp or SMS when it is due, by months or kilometres.", "ஆம், மாதங்கள் அல்லது கிலோமீட்டர் கணக்கில் நேரம் வரும்போது வாட்ஸ்அப் அல்லது SMS அனுப்புவோம்.") },
    { q: l("Do you tell me the price first?", "முதலில் விலை சொல்வீர்களா?"), a: l("Yes, we tell you the cost before any extra work is done.", "ஆம், கூடுதல் வேலை செய்யும் முன் செலவைச் சொல்வோம்.") },
  ],
  car_service: [
    { q: l("Do I approve the estimate?", "மதிப்பீட்டை நான் ஒப்புக்கொள்ள வேண்டுமா?"), a: l("Yes, we send the estimate to your phone and start only after you approve it.", "ஆம், மதிப்பீட்டை உங்கள் ஃபோனுக்கு அனுப்பி, நீங்கள் ஒப்புக்கொண்ட பிறகே தொடங்குவோம்.") },
    { q: l("Can I see where my car is?", "என் கார் எங்கே என்று பார்க்கலாமா?"), a: l("Yes, the link in your message shows the status of your job.", "ஆம், செய்தியில் உள்ள இணைப்பு உங்கள் வேலையின் நிலையைக் காட்டும்.") },
    { q: l("Do you give a warranty on work?", "வேலைக்கு உத்தரவாதம் உண்டா?"), a: l("Yes, on labour and spare parts; ask us for the terms.", "ஆம், உழைப்புக்கும் உதிரிபாகங்களுக்கும்; விதிமுறைகளைக் கேளுங்கள்.") },
  ],
  agri_inputs: [
    { q: l("What should I use for my crop?", "என் பயிருக்கு எதைப் பயன்படுத்த வேண்டும்?"), a: l("Tell us the crop, the season and the problem; we suggest the right seed, fertiliser or spray and the dose per acre.", "பயிர், பருவம், பிரச்சினையைச் சொல்லுங்கள்; பொருத்தமான விதை, உரம், தெளிப்பு, ஏக்கருக்கான அளவைச் சொல்வோம்.") },
    { q: l("Is the stock fresh?", "இருப்பு புதியதா?"), a: l("We track batch and expiry on every pack and sell the oldest in-date stock first.", "ஒவ்வொரு பேக்கிலும் பேட்ச், காலாவதியைக் கண்காணித்து, பழைய ஆனால் காலாவதியாகாத இருப்பை முதலில் விற்கிறோம்.") },
    { q: l("Do you give a GST bill?", "GST பில் தருவீர்களா?"), a: l("Yes, with batch details; ask us for rates on bulk orders.", "ஆம், பேட்ச் விவரங்களுடன்; மொத்த ஆர்டருக்கு விலை கேளுங்கள்.") },
  ],
  auto_parts: [
    { q: l("How do I know a part fits?", "பாகம் பொருந்தும் என்று எப்படி அறிவது?"), a: l("Each item lists the part number and the vehicles it fits; send us your model and year if unsure.", "ஒவ்வொரு பொருளிலும் பாக எண், பொருந்தும் வாகனங்கள் உண்டு; உறுதியில்லையெனில் மாடல், ஆண்டை அனுப்புங்கள்.") },
    { q: l("Are the parts genuine?", "பாகங்கள் அசலா?"), a: l("We sell OEM and trusted aftermarket brands and say which is which.", "OEM மற்றும் நம்பகமான ஆஃப்டர்மார்க்கெட் பிராண்டுகளை விற்று, எது எதுவென்று சொல்கிறோம்.") },
    { q: l("Do you give garage rates?", "கேரேஜ் விலை உண்டா?"), a: l("Yes, ask us for a quote on bulk and repeat orders; we give a GST bill.", "ஆம், மொத்த, தொடர் ஆர்டர்களுக்கு விலைப்பட்டியல் கேளுங்கள்; GST பில் தருவோம்.") },
  ],
};

/** Draft customer words (hidden until the owner replaces them with real ones). */
const QUOTES: L[] = [
  l("Lovely service and quick delivery. Will order again!", "அருமையான சேவை, விரைவான டெலிவரி. மீண்டும் ஆர்டர் செய்வேன்!"),
  l("Friendly people and honest prices.", "அன்பான ஊழியர்கள், நேர்மையான விலை."),
];

const HOURS: Partial<Record<BusinessType, { label: L; value: L }[]>> = {
  restaurant: [{ label: l("Every day", "தினமும்"), value: l("7:00 am – 10:30 pm", "காலை 7:00 – இரவு 10:30") }],
  bakery: [{ label: l("Every day", "தினமும்"), value: l("8:00 am – 10:00 pm", "காலை 8:00 – இரவு 10:00") }],
  gym: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("5:00 am – 10:00 pm", "காலை 5:00 – இரவு 10:00") },
    { label: l("Sunday", "ஞாயிறு"), value: l("6:00 am – 12:00 noon", "காலை 6:00 – மதியம் 12:00") },
  ],
  tea_stall: [{ label: l("Every day", "தினமும்"), value: l("5:30 am – 10:30 pm", "காலை 5:30 – இரவு 10:30") }],
  spa: [{ label: l("Every day", "தினமும்"), value: l("10:00 am – 9:00 pm", "காலை 10:00 – இரவு 9:00") }],
  school: [{ label: l("Office: Mon – Sat", "அலுவலகம்: திங்கள் – சனி"), value: l("9:00 am – 4:30 pm", "காலை 9:00 – மாலை 4:30") }],
  tuition: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("4:00 pm – 8:30 pm", "மாலை 4:00 – இரவு 8:30") },
    { label: l("Sunday", "ஞாயிறு"), value: l("9:00 am – 1:00 pm", "காலை 9:00 – மதியம் 1:00") },
  ],
  dance_music: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("4:30 pm – 8:30 pm", "மாலை 4:30 – இரவு 8:30") },
    { label: l("Sunday", "ஞாயிறு"), value: l("9:00 am – 12:30 pm", "காலை 9:00 – மதியம் 12:30") },
  ],
  yoga: [
    { label: l("Every day", "தினமும்"), value: l("5:30 am – 8:30 am, 5:30 pm – 7:30 pm", "காலை 5:30 – 8:30, மாலை 5:30 – 7:30") },
  ],
  driving_school: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("6:00 am – 6:00 pm", "காலை 6:00 – மாலை 6:00") },
  ],
  laundry: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("8:00 am – 8:00 pm", "காலை 8:00 – இரவு 8:00") },
    { label: l("Sunday", "ஞாயிறு"), value: l("8:00 am – 1:00 pm", "காலை 8:00 – மதியம் 1:00") },
  ],
  photo_studio: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("10:00 am – 8:00 pm", "காலை 10:00 – இரவு 8:00") },
  ],
  print_shop: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("8:30 am – 9:00 pm", "காலை 8:30 – இரவு 9:00") },
    { label: l("Sunday", "ஞாயிறு"), value: l("9:00 am – 1:00 pm", "காலை 9:00 – மதியம் 1:00") },
  ],
  ac_service: [
    { label: l("Every day", "தினமும்"), value: l("8:00 am – 8:00 pm", "காலை 8:00 – இரவு 8:00") },
  ],
  two_wheeler_service: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("8:30 am – 7:30 pm", "காலை 8:30 – இரவு 7:30") },
    { label: l("Sunday", "ஞாயிறு"), value: l("9:00 am – 1:00 pm", "காலை 9:00 – மதியம் 1:00") },
  ],
  car_service: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("8:30 am – 7:00 pm", "காலை 8:30 – மாலை 7:00") },
  ],
  agri_inputs: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("7:00 am – 8:00 pm", "காலை 7:00 – இரவு 8:00") },
    { label: l("Sunday", "ஞாயிறு"), value: l("7:00 am – 1:00 pm", "காலை 7:00 – மதியம் 1:00") },
  ],
  auto_parts: [
    { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("9:00 am – 8:30 pm", "காலை 9:00 – இரவு 8:30") },
    { label: l("Sunday", "ஞாயிறு"), value: l("9:00 am – 1:00 pm", "காலை 9:00 – மதியம் 1:00") },
  ],
};
const DEFAULT_HOURS = [
  { label: l("Mon – Sat", "திங்கள் – சனி"), value: l("9:30 am – 9:00 pm", "காலை 9:30 – இரவு 9:00") },
  { label: l("Sunday", "ஞாயிறு"), value: l("10:00 am – 2:00 pm", "காலை 10:00 – மதியம் 2:00") },
];

const W = {
  stayInTouch: l("Stay in touch", "தொடர்பில் இருங்கள்"),
  lovedBy: l("What our customers say", "எங்கள் வாடிக்கையாளர்கள் சொல்வது"),
  customer: l("Happy customer", "மகிழ்ந்த வாடிக்கையாளர்"),
  faq: l("Questions & answers", "கேள்விகளும் பதில்களும்"),
  visit: l("Visit us", "எங்களை நேரில் சந்திக்க"),
  book: l("Book now", "முன்பதிவு செய்க"),
  viewAll: l("See everything", "அனைத்தையும் பாருங்கள்"),
  bookOrShop: l("Book a visit", "வருகையை முன்பதிவு செய்க"),
  goldTitle: l("Today's gold rate", "இன்றைய தங்க விலை"),
  goldText: l("Rates per gram, updated every morning. Making charges as per design.", "கிராம் ஒன்றுக்கான விலை, ஒவ்வொரு காலையும் புதுப்பிக்கப்படும். செய்கூலி வடிவமைப்பைப் பொறுத்து."),
  welcome: l("Welcome", "வரவேற்கிறோம்"),
  fullMenu: l("See the full menu", "முழு மெனுவைப் பாருங்கள்"),
};

/** The starter home for a pack, in English or Tamil. */
export function starterHome(pack: BusinessPack, shopName: string, locale: Locale = "en") {
  const c = pack.copy[locale];
  const t = (x: L) => x[locale];
  const id = (k: string) => `starter-${k}`;
  const ctaHref = pack.ctaHref ?? "/search";
  const heading = shopName ? `${shopName}: ${c.heroHeading}` : c.heroHeading;
  const booking = ctaHref === "/book";
  const art = STOCK_ART[pack.id] ?? pack.id;

  const build = (part: Part) => {
    switch (part) {
      case "hero":
        // Stock artwork for the trade (drawn in its theme colours) until the owner adds photos; the tall picture on phones.
        return {
          type: "hero" as const,
          id: id("hero"),
          slides: [{ imageUrl: stockArtFor(art, "hero-1"), mobileImageUrl: stockArtFor(art, "split-1"), heading, subheading: c.heroSubheading, cta: { label: c.cta, href: ctaHref } }] };
      case "hero-split":
        return {
          type: "hero-split" as const,
          id: id("hero-split"),
          imageUrl: stockArtFor(art, "split-1"),
          imageSide: "right" as const,
          eyebrow: (shopName || t(W.welcome)).slice(0, 60),
          heading: c.heroHeading,
          text: c.heroSubheading,
          cta: { label: c.cta, href: ctaHref },
          cta2: booking ? { label: t(W.viewAll), href: "/search" } : { label: c.newItems, href: "/products" },
        };
      case "categories":
        return { type: "categories" as const, id: id("categories"), title: c.categoriesTitle };
      case "category-mosaic":
        return { type: "category-mosaic" as const, id: id("mosaic"), title: c.categoriesTitle, style: { animation: "rise" as const } };
      case "gold-rates":
        return { type: "gold-rates" as const, id: id("gold-rates"), title: t(W.goldTitle), text: t(W.goldText), showSilver: true, style: { background: "muted" as const, align: "center" as const } };
      case "appointment": {
        const a = APPOINTMENT[pack.id];
        return {
          type: "appointment" as const,
          id: id("appointment"),
          heading: a ? t(a.heading) : c.cta,
          ...(a ? { text: t(a.text) } : {}),
          services: (SERVICES[pack.id] ?? []).map((s) => ({ name: t(s.name), ...(s.duration ? { duration: t(s.duration) } : {}) })),
          cta: { label: t(W.book), href: "/book" },
          style: { background: "brand" as const },
        };
      }
      case "menu-board":
        return {
          type: "menu-board" as const,
          id: id("menu"),
          hidden: true,
          title: t(MENU_TITLE),
          groups: (MENU[pack.id] ?? []).map((g) => ({ name: t(g.name), items: g.items.map((d) => ({ name: t(d.name), price: d.price, ...(d.diet ? { diet: d.diet } : {}) })) })),
          cta: { label: t(W.fullMenu), href: "/products" },
        };
      case "usp":
        return { type: "usp" as const, id: id("usp"), items: pack.usps.map((u) => ({ icon: u.icon, title: u.title[locale], text: u.text[locale] })) };
      case "testimonials":
        return {
          type: "testimonials" as const,
          id: id("testimonials"),
          hidden: true,
          title: t(W.lovedBy),
          layout: "cards" as const,
          items: QUOTES.map((q) => ({ quote: t(q), name: t(W.customer), rating: 5 })),
          style: { background: "muted" as const },
        };
      case "faq":
        return { type: "faq" as const, id: id("faq"), hidden: true, title: t(W.faq), items: (FAQ[pack.id] ?? []).map((f) => ({ q: t(f.q), a: t(f.a) })) };
      case "location":
        return {
          type: "location" as const,
          id: id("location"),
          title: t(W.visit),
          hours: (HOURS[pack.id] ?? DEFAULT_HOURS).map((h) => ({ label: t(h.label), value: t(h.value) })),
        };
      case "newsletter":
        return { type: "newsletter" as const, id: id("newsletter"), heading: t(W.stayInTouch), text: c.newsletter };
    }
  };

  return LAYOUT[pack.id]
    .filter((p) => (p === "faq" ? (FAQ[pack.id]?.length ?? 0) > 0 : p === "menu-board" ? (MENU[pack.id]?.length ?? 0) > 0 : true))
    .map(build);
}
