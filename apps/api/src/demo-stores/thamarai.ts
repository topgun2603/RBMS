import { setupThamarai } from "./thamarai-setup";
import { ADMISSION_FAQ, ADMISSION_FAQ_TA, CLASS_OPTIONS, CLASS_OPTIONS_TA, PAGES, POSTS } from "./thamarai-content";
import { CO, HIGH, HIGHER, MIDDLE, PRE_PRIMARY, PRIMARY, PRODUCTS, VISIT_NAME } from "./thamarai-programmes";
import { PHONE, WHATSAPP } from "./thamarai-shared";
import { PHOTOS } from "./thamarai-photos";
import type { DemoStore } from "./types";

/**
 * Thamarai Vidyalaya Matriculation Higher Secondary School, Thillai Nagar, Tiruchirappalli (thamarai.localhost:3003;
 * admin and desk thamarai.localhost:3008): a demo school website of the "20+ stores" series. The services app (SV)
 * with the `school` trade (a website, not a shop: no cart, account or search; the header offers "Apply for admission"
 * -> /admissions) and the "thamarai-lotus" look (theme-presets-thamarai.ts). The programmes are catalogue items of kind
 * service without a price (thamarai-programmes.ts), the parents' enquiries come through the enquiry form (home and
 * the admissions / contact pages) into the Enquiries list of the services app, and /book takes campus-visit and
 * counselling appointments (thamarai-setup.ts). The school, its people, address and numbers are fictional; the
 * address is a placeholder in a real city, the phone a demo number, the GSTIN a placeholder with a valid check digit.
 *
 * GST: education by a school is exempt. Services provided by an educational institution (pre-school up to higher
 * secondary) to its students are exempt under Notification No. 12/2017-Central Tax (Rate) dated 28 June 2017, entry 66
 * (and the matching State notification), so every item is 0% (SAC heading 9992). Fees are not shown on the site, so
 * nothing is invented here. Paid extras outside the curriculum (for example optional coaching) may be taxable: check
 * with the CA before billing them for real.
 */

const waLink = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const HOURS = [
  { label: "Monday to Friday", value: "8:30 am to 4:30 pm" },
  { label: "Saturday", value: "8:30 am to 12:30 pm" },
  { label: "Sunday and holidays", value: "Closed" },
];
const HOURS_TA = [
  { label: "திங்கள் முதல் வெள்ளி", value: "காலை 8:30 முதல் மாலை 4:30 வரை" },
  { label: "சனி", value: "காலை 8:30 முதல் மதியம் 12:30 வரை" },
  { label: "ஞாயிறு, விடுமுறை நாட்கள்", value: "விடுமுறை" },
];

export const THAMARAI: DemoStore = {
  shop: {
    slug: "thamarai",
    appId: "SC",
    businessType: "school",
    planId: "pro",
    name: "Thamarai Vidyalaya",
    primary: "#7a1f3d",
    billing: {
      legalName: "Thamarai Educational Trust",
      gstin: "33AAATT5821M1ZB",
      address: "14, Cauvery Nagar Main Road, Thillai Nagar",
      city: "Tiruchirappalli",
      pincode: "620018",
      stateCode: "33",
      phone: PHONE,
      invoicePrefix: "TV",
      upiId: "thamaraividyalaya@okhdfcbank",
    },
    // A billing item (kept off the online store) so the campus visit can be a bookable service; free of charge.
    items: [{ name: VISIT_NAME, hsn: "999299", unit: "visit", rate: 0, gstRate: 0 }],
  },
  preset: "thamarai-lotus",
  store: {
    open: true,
    codEnabled: false,
    minOrderValue: 0,
    contactPhone: PHONE,
    contactEmail: "admissions@thamaraividyalaya.in",
    social: { whatsapp: PHONE, instagram: "https://instagram.com/thamarai.vidyalaya", youtube: "https://youtube.com/@thamaraividyalaya" },
    policies: {
      shipping: "This is the school's website: nothing is sold or shipped online. Admissions, fees and certificates are handled at the school office; transport details are on the Transport page.",
      returns: "Fees paid are refundable only as set out in the fee schedule printed in the prospectus and shared at the counselling visit. Please ask the office before you pay.",
      privacy:
        "We keep a child's and parent's name, phone, e-mail, address and the class applied for only to answer your enquiry, run admissions and look after the child at school. Where a child is under 18 we ask for a parent or guardian's consent. We do not sell or share this data, and you can ask the school office to see, correct or delete it. See the Privacy policy page for details.",
      terms: "The information on this website is for guidance. Admission is confirmed only by the school's written offer after the counselling visit and the documents check. Dates and age limits are those of the admission notice for the year.",
    },
    businessType: "school",
  },
  zones: [],
  categories: [
    { name: PRE_PRIMARY, description: "Play group, Nursery, LKG and UKG: learning through play, songs, stories and a gentle start to school.", photo: 8535238 },
    { name: PRIMARY, description: "Classes 1 to 5: reading, writing and number sense made firm, with art, music and sport every week.", photo: 18012456 },
    { name: MIDDLE, description: "Classes 6 to 8: subject teachers, science practicals and the first clubs and competitions.", photo: 35551059 },
    { name: HIGH, description: "Classes 9 and 10: steady preparation for the SSLC public examination, with guidance and care.", photo: 35551044 },
    { name: HIGHER, description: "Classes 11 and 12: Science and Commerce groups with labs, counselling and entrance-exam foundation.", photo: 5539290 },
    { name: CO, description: "Dance, music, karate, sports, chess, robotics and art: clubs for every interest after school hours.", photo: 38396457 },
  ],
  products: PRODUCTS,
  collections: [
    { name: "All programmes", slug: "all-programmes", description: "Every stage and club, A to Z.", rule: { sort: "name" } },
    { name: "Clubs and activities", slug: "clubs", description: "After-school clubs in arts, sport and technology.", rule: { tag: "club", sort: "name" } },
    { name: "Sports and games", slug: "sports", description: "Karate, athletics, cricket, basketball and chess.", rule: { tag: "sports", sort: "name" } },
  ],
  coupons: [],
  home: ({ photo }) => ({
    seo: {
      title: "Thamarai Vidyalaya, Tiruchirappalli: Play group to Class 12",
      description:
        "Admissions open for 2027-28 at Thamarai Vidyalaya, Thillai Nagar, Tiruchirappalli: Play group to Class 12, State Board syllabus, English medium, Science and Commerce groups, safe transport and a caring campus. Apply online or book a campus visit.",
      imageUrl: photo(36293966),
    },
    sections: [
      {
        type: "hero-split",
        id: "thm-hero",
        imageUrl: photo(36293966),
        imageSide: "right",
        eyebrow: "Admissions open 2027-28",
        heading: "A school that grows with your child",
        text: "Thamarai Vidyalaya Matriculation Higher Secondary School, Thillai Nagar, Tiruchirappalli. Play group to Class 12, State Board syllabus, English medium, a safe campus and teachers who know every child by name.",
        cta: { label: "Apply for admission", href: "/admissions" },
        cta2: { label: "Book a campus visit", href: "/book" },
      },
      {
        type: "stats",
        id: "thm-stats",
        style: { background: "brand" },
        title: "Twenty-eight years, one idea: know every child",
        items: [
          { value: 28, suffix: " years", label: "Teaching Tiruchirappalli's children since 1998" },
          { value: 2400, suffix: "+", label: "Students from Play group to Class 12" },
          { value: 100, suffix: "%", label: "Pass in the SSLC and HSC public examinations, 2025-26" },
          { value: 22, prefix: "1:", label: "Student-teacher ratio" },
        ],
      },
      {
        type: "usp",
        id: "thm-why",
        title: "Why parents choose Thamarai",
        text: "What we promise, and what you can check on your campus visit.",
        layout: "centered",
        items: [
          { icon: "star", title: "Strong academics", text: "Experienced, qualified teachers, weekly practicals and steady results in the board examinations." },
          { icon: "shield", title: "A safe campus", text: "CCTV in every corridor, women staff for the early years, a visitor register and a doctor on call." },
          { icon: "heart", title: "Every child known", text: "Classes of 30 or fewer, a class teacher who stays all year and a parent meeting every term." },
          { icon: "truck", title: "Safe transport", text: "GPS-tracked buses with a woman attendant, covering most of Tiruchirappalli and Srirangam." },
          { icon: "leaf", title: "A green campus", text: "Trees, a kitchen garden, rainwater harvesting and a plastic-free canteen." },
          { icon: "check", title: "Fair and clear fees", text: "A printed fee schedule at the counselling visit. No donation, no capitation, no surprises." },
        ],
      },
      {
        type: "tiles",
        id: "thm-programmes",
        style: { background: "muted" },
        title: "Our programmes",
        text: "From a first day at school to the board examinations. Open any stage to see the syllabus, age criteria and timings.",
        layout: "grid",
        showCounts: false,
        items: [
          { label: "Pre-primary", note: "Play group, Nursery, LKG and UKG", imageUrl: photo(8535238, "tile"), href: "/c/pre-primary" },
          { label: "Primary", note: "Classes 1 to 5", imageUrl: photo(18012456, "tile"), href: "/c/primary" },
          { label: "Middle school", note: "Classes 6 to 8", imageUrl: photo(35551059, "tile"), href: "/c/middle-school" },
          { label: "High school", note: "Classes 9 and 10 (SSLC)", imageUrl: photo(35551044, "tile"), href: "/c/high-school" },
          { label: "Higher secondary", note: "Classes 11 and 12: Science and Commerce", imageUrl: photo(5539290, "tile"), href: "/c/higher-secondary" },
          { label: "Clubs and arts", note: "Dance, music, karate, sport, chess, robotics", imageUrl: photo(38396457, "tile"), href: "/c/co-curricular" },
        ],
      },
      {
        type: "image-text",
        id: "thm-principal",
        imageUrl: photo(6217466, "tile"),
        imageSide: "left",
        heading: "A message from our Principal",
        markdown:
          "Every morning our assembly begins the same way: a Tamil thai vazhthu, a thought for the day and a minute of silence. It tells a child that this is a place where we begin together.\n\nWe do not promise that every child will be a topper. We promise that every child will be **seen**: that a teacher will notice when a child is quiet, that reading is mended before it becomes a problem, and that the shy girl gets a part in the annual day as surely as the confident boy.\n\nCome and walk through our classrooms before you decide. Ask the teachers hard questions. Then tell us what your child needs, and we will tell you honestly whether we are the right school.\n\n**Mrs. R. Vasantha Lakshmi, M.A., M.Ed.**, Principal",
        cta: { label: "About the school", href: "/about" },
      },
      {
        type: "gallery",
        id: "thm-campus",
        title: "Campus and facilities",
        layout: "masonry",
        images: [
          { url: photo(5539290), alt: "Students in uniform in a bright computer lab", caption: "Computer lab" },
          { url: photo(35551059), alt: "Students in maroon uniforms in a smart classroom", caption: "Smart classrooms" },
          { url: photo(35551044), alt: "Students and a teacher studying human anatomy models", caption: "Science rooms" },
          { url: photo(8926894), alt: "A girl in school uniform browsing shelves in the library", caption: "Library" },
          { url: photo(7160120), alt: "Aerial view of a painted outdoor basketball court", caption: "Basketball court" },
          { url: photo(36293966), alt: "A large sports field with a school-style building and floodlights", caption: "Sports ground" },
          { url: photo(28203486), alt: "Yellow school buses parked in a row", caption: "School buses" },
          { url: photo(11445241), alt: "Children in uniform doing a group activity in a school courtyard, seen from above", caption: "Courtyard" },
        ],
      },
      {
        type: "timeline",
        id: "thm-story",
        style: { background: "muted" },
        title: "Our story",
        text: "From one rented building to a campus of 2,400 children.",
        items: [
          { when: "1998", title: "Thamarai begins", text: "Ninety-six children, six teachers and a rented house in Thillai Nagar: Play group to Class 3." },
          { when: "2004", title: "Our own campus", text: "The trust builds the present campus on Cauvery Nagar Main Road, and the school grows to Class 8." },
          { when: "2009", title: "First SSLC batch", text: "The first Class 10 batch writes the public examination and every student passes." },
          { when: "2013", title: "Higher secondary", text: "Science and Commerce groups open in Class 11, with new labs and a library wing." },
          { when: "2018", title: "Smart classrooms", text: "Every classroom from Class 3 gets a digital board, and the State Board's new syllabus is taken up in full." },
          { when: "2023", title: "STEM lab and sports track", text: "A robotics and coding lab, a running track and a basketball court open for all classes." },
        ],
      },
      {
        type: "text",
        id: "thm-results",
        style: { align: "start" },
        heading: "Results and achievements",
        markdown:
          "| Examination | Students | Pass | Distinction (75% and above) |\n|---|---|---|---|\n| SSLC (Class 10), 2025-26 | 186 | 100% | 81% |\n| HSC (Class 12), 2025-26 | 142 | 100% | 74% |\n\n- District champions in school chess, three years in a row.\n- Twelve medals in State-level karate and athletics meets in 2025-26.\n- Eighteen students selected for the State science exhibition in the last five years.\n- A scholarship (NMMS) selection every year since 2015.\n\nResults are for the batch that took the examination; every figure is on the notice board for you to see.",
      },
      {
        type: "testimonials",
        id: "thm-voices",
        style: { background: "muted" },
        title: "Parents say",
        layout: "cards",
        items: [
          { quote: "My son was afraid of Mathematics when he came to Class 6. His teacher sat with him after school for a month, at no charge. This year he asked to join the Olympiad group.", name: "Karthikeyan S.", role: "Parent of a Class 8 student, Srirangam", rating: 5 },
          { quote: "I visited five schools. Here the principal herself showed us the kitchen, the bus and the first-aid room. We did not have to ask twice about the fees; they were on a sheet, in writing.", name: "Priya Dharshini", role: "Parent of a UKG student, K.K. Nagar", rating: 5 },
          { quote: "The bus attendant calls me when my daughter boards and when she gets down. As a working mother that call is worth more than any facility.", name: "Revathi Murugan", role: "Parent of a Class 5 student, Woraiyur", rating: 5 },
        ],
      },
      { type: "blog-posts", id: "thm-news", title: "News and events", limit: 3 },
      { type: "faq", id: "thm-faq", style: { background: "muted" }, title: "Questions parents ask", items: ADMISSION_FAQ },
      {
        type: "enquiry-form",
        id: "thm-enquire",
        heading: "Admission enquiry 2027-28",
        text: "Tell us about your child and we will call you within one working day to explain the process and fix a campus visit.",
        topic: "Admission 2027-28",
        askStudent: true,
        studentLabel: "Child's name",
        optionLabel: "Class applying for",
        options: CLASS_OPTIONS,
        askEmail: true,
        askMessage: true,
        submitLabel: "Send enquiry",
        successText: "Thank you. Our admissions office will call you within one working day.",
        imageUrl: photo(11445241, "tile"),
        imageAlt: "Children in uniform doing a group activity in a school courtyard, seen from above",
      },
      {
        type: "appointment",
        id: "thm-visit-book",
        style: { background: "muted" },
        heading: "Visit the campus",
        text: "A 45-minute visit with our admissions counsellor: a walk through the classrooms, labs and bus, a talk about your child and the fee schedule. No charge, no obligation. Monday to Saturday.",
        services: [{ name: "Campus visit and counselling", duration: "45 min" }],
        cta: { label: "Book a campus visit", href: "/book" },
      },
      {
        type: "location",
        id: "thm-contact",
        title: "School office",
        address: "14, Cauvery Nagar Main Road, Thillai Nagar, Tiruchirappalli 620018",
        hours: HOURS,
        phone: PHONE,
        whatsapp: PHONE,
        coords: "10.8231, 78.6840",
      },
    ],
    translations: {
      ta: {
        "thm-hero": {
          eyebrow: "சேர்க்கை தொடங்கியுள்ளது 2027-28",
          heading: "உங்கள் குழந்தையுடன் வளரும் பள்ளி",
          text: "திருச்சிராப்பள்ளி, தில்லை நகரில் உள்ள தாமரை வித்யாலயா மெட்ரிகுலேஷன் மேல்நிலைப் பள்ளி. விளையாட்டுப் பள்ளி முதல் 12-ஆம் வகுப்பு வரை, தமிழ்நாடு மாநிலப் பாடத்திட்டம், ஆங்கில வழி, பாதுகாப்பான வளாகம், ஒவ்வொரு குழந்தையையும் பெயர் சொல்லி அறியும் ஆசிரியர்கள்.",
          cta: { label: "சேர்க்கைக்கு விண்ணப்பிக்க" },
          cta2: { label: "வளாகத்தைப் பார்வையிட முன்பதிவு" },
        },
        "thm-stats": {
          title: "இருபத்தெட்டு ஆண்டுகள், ஒரே எண்ணம்: ஒவ்வொரு குழந்தையையும் அறிவது",
          items: [
            { suffix: " ஆண்டுகள்", label: "1998 முதல் திருச்சிக் குழந்தைகளுக்குக் கற்பித்து வருகிறோம்" },
            { suffix: "+", label: "விளையாட்டுப் பள்ளி முதல் 12-ஆம் வகுப்பு வரை மாணவர்கள்" },
            { suffix: "%", label: "2025-26 எஸ்.எஸ்.எல்.சி., எச்.எஸ்.சி. பொதுத் தேர்வுகளில் தேர்ச்சி" },
            { suffix: "", label: "மாணவர்: ஆசிரியர் விகிதம்" },
          ],
        },
        "thm-why": {
          title: "பெற்றோர் தாமரையைத் தேர்ந்தெடுக்கக் காரணம்",
          text: "நாங்கள் உறுதியளிப்பவை, வளாகத்தைப் பார்க்க வரும்போது நீங்களே சரிபார்க்கக்கூடியவை.",
          items: [
            { title: "சிறந்த கல்வித்தரம்", text: "அனுபவமும் தகுதியும் உள்ள ஆசிரியர்கள், வாரந்தோறும் செய்முறை, பொதுத்தேர்வுகளில் நிலையான தேர்ச்சி." },
            { title: "பாதுகாப்பான வளாகம்", text: "ஒவ்வொரு நடைபாதையிலும் கண்காணிப்பு கேமரா, ஆரம்ப வகுப்புகளுக்குப் பெண் பணியாளர்கள், பார்வையாளர் பதிவேடு, அழைப்பில் மருத்துவர்." },
            { title: "ஒவ்வொரு குழந்தையும் அறியப்படுவார்", text: "30 மாணவர்களுக்கு மிகாத வகுப்புகள், ஆண்டு முழுவதும் ஒரே வகுப்பாசிரியர், ஒவ்வொரு பருவத்துக்கும் பெற்றோர் சந்திப்பு." },
            { title: "பாதுகாப்பான போக்குவரத்து", text: "ஜி.பி.எஸ். கண்காணிப்பு, பெண் உதவியாளர் கொண்ட பேருந்துகள்; திருச்சி, ஸ்ரீரங்கத்தின் பெரும்பாலான பகுதிகளுக்கு." },
            { title: "பசுமையான வளாகம்", text: "மரங்கள், காய்கறித் தோட்டம், மழைநீர் சேகரிப்பு, பிளாஸ்டிக் இல்லாத உணவகம்." },
            { title: "நியாயமான, தெளிவான கட்டணம்", text: "ஆலோசனை வருகையில் அச்சிட்ட கட்டணப் பட்டியல். நன்கொடை இல்லை, கேபிடேஷன் இல்லை, எதிர்பாரா செலவுகள் இல்லை." },
          ],
        },
        "thm-programmes": {
          title: "எங்கள் கல்வித் திட்டங்கள்",
          text: "பள்ளியின் முதல் நாளிலிருந்து பொதுத்தேர்வு வரை. எந்தப் படிநிலையையும் திறந்து பாடத்திட்டம், வயது வரம்பு, நேரத்தைப் பாருங்கள்.",
          items: [
            { label: "மழலையர் நிலை", note: "விளையாட்டுப் பள்ளி, நர்சரி, எல்.கே.ஜி., யு.கே.ஜி." },
            { label: "தொடக்கநிலை", note: "1 முதல் 5-ஆம் வகுப்பு வரை" },
            { label: "நடுநிலை", note: "6 முதல் 8-ஆம் வகுப்பு வரை" },
            { label: "உயர்நிலை", note: "9, 10-ஆம் வகுப்புகள் (எஸ்.எஸ்.எல்.சி.)" },
            { label: "மேல்நிலை", note: "11, 12-ஆம் வகுப்புகள்: அறிவியல், வணிகவியல்" },
            { label: "மன்றங்களும் கலைகளும்", note: "நடனம், இசை, கராத்தே, விளையாட்டு, சதுரங்கம், ரோபாட்டிக்ஸ்" },
          ],
        },
        "thm-principal": {
          heading: "முதல்வரின் செய்தி",
          markdown:
            "ஒவ்வொரு காலையும் எங்கள் காலைக்கூட்டம் ஒரே விதமாகத் தொடங்குகிறது: தமிழ்த்தாய் வாழ்த்து, அன்றைய சிந்தனை, ஒரு நிமிட மௌனம். நாம் இங்கே ஒன்றாகத் தொடங்குகிறோம் என்பதைக் குழந்தைக்கு அது சொல்கிறது.\n\nஒவ்வொரு குழந்தையும் முதல் மதிப்பெண் பெறும் என்று நாங்கள் உறுதியளிக்கவில்லை. ஒவ்வொரு குழந்தையும் **கவனிக்கப்படும்** என்று உறுதியளிக்கிறோம்: குழந்தை அமைதியாக இருந்தால் ஆசிரியர் கவனிப்பார், வாசிப்புக் குறை பெரிதாகும் முன் சரிசெய்யப்படும், கூச்சக் குழந்தைக்கும் ஆண்டுவிழாவில் தன்னம்பிக்கை உள்ள குழந்தையைப் போலவே இடம் கிடைக்கும்.\n\nமுடிவு செய்யும் முன் எங்கள் வகுப்பறைகளைச் சுற்றிப் பாருங்கள். ஆசிரியர்களிடம் கடினமான கேள்விகளைக் கேளுங்கள். பிறகு உங்கள் குழந்தைக்கு என்ன தேவை என்று சொல்லுங்கள்; நாங்கள் சரியான பள்ளிதானா என்பதை நேர்மையாகச் சொல்வோம்.\n\n**திருமதி ஆர். வசந்த லட்சுமி, எம்.ஏ., எம்.எட்.**, முதல்வர்",
          cta: { label: "பள்ளியைப் பற்றி" },
        },
        "thm-campus": {
          title: "வளாகமும் வசதிகளும்",
          images: [
            { alt: "பிரகாசமான கணினி ஆய்வகத்தில் சீருடை அணிந்த மாணவர்கள்", caption: "கணினி ஆய்வகம்" },
            { alt: "மெரூன் சீருடையில் மாணவர்கள் உள்ள ஸ்மார்ட் வகுப்பறை", caption: "ஸ்மார்ட் வகுப்பறைகள்" },
            { alt: "மனித உடல் மாதிரிகளைப் படிக்கும் மாணவர்களும் ஆசிரியரும்", caption: "அறிவியல் அறைகள்" },
            { alt: "நூலகத்தில் புத்தக அலமாரியைப் பார்க்கும் சீருடை அணிந்த சிறுமி", caption: "நூலகம்" },
            { alt: "வண்ணம் பூசப்பட்ட கூடைப்பந்து மைதானத்தின் மேலிருந்து தோற்றம்", caption: "கூடைப்பந்து மைதானம்" },
            { alt: "மின்விளக்குக் கம்பங்களுடன் கூடிய பெரிய விளையாட்டு மைதானம்", caption: "விளையாட்டு மைதானம்" },
            { alt: "வரிசையாக நிறுத்தப்பட்ட மஞ்சள் பள்ளிப் பேருந்துகள்", caption: "பள்ளிப் பேருந்துகள்" },
            { alt: "பள்ளி முற்றத்தில் குழுச் செயல்பாட்டில் ஈடுபடும் சீருடைக் குழந்தைகள், மேலிருந்து தோற்றம்", caption: "பள்ளி முற்றம்" },
          ],
        },
        "thm-story": {
          title: "எங்கள் கதை",
          text: "வாடகைக் கட்டடத்திலிருந்து 2,400 குழந்தைகள் உள்ள வளாகம் வரை.",
          items: [
            { title: "தாமரை தொடங்கியது", text: "தில்லை நகரில் வாடகை வீட்டில் தொண்ணூற்றாறு குழந்தைகள், ஆறு ஆசிரியர்கள்: விளையாட்டுப் பள்ளி முதல் 3-ஆம் வகுப்பு வரை." },
            { title: "சொந்த வளாகம்", text: "காவேரி நகர் பிரதான சாலையில் அறக்கட்டளை இப்போதைய வளாகத்தைக் கட்டியது; பள்ளி 8-ஆம் வகுப்பு வரை வளர்ந்தது." },
            { title: "முதல் எஸ்.எஸ்.எல்.சி. குழு", text: "முதல் 10-ஆம் வகுப்புக் குழு பொதுத்தேர்வு எழுதி அனைவரும் தேர்ச்சி பெற்றனர்." },
            { title: "மேல்நிலைப் பிரிவு", text: "11-ஆம் வகுப்பில் அறிவியல், வணிகவியல் பிரிவுகள், புதிய ஆய்வகங்கள், நூலகக் கட்டடம்." },
            { title: "ஸ்மார்ட் வகுப்பறைகள்", text: "3-ஆம் வகுப்பு முதல் ஒவ்வொரு வகுப்பறையிலும் டிஜிட்டல் பலகை; மாநிலப் பாடத்திட்டம் முழுமையாக ஏற்பு." },
            { title: "ஸ்டெம் ஆய்வகம், ஓடுபாதை", text: "ரோபாட்டிக்ஸ், கோடிங் ஆய்வகம், ஓடுபாதை, கூடைப்பந்து மைதானம் அனைத்து வகுப்புகளுக்கும் திறக்கப்பட்டன." },
          ],
        },
        "thm-results": {
          heading: "தேர்ச்சியும் சாதனைகளும்",
          markdown:
            "| தேர்வு | மாணவர்கள் | தேர்ச்சி | சிறப்பு (75%, அதற்கு மேல்) |\n|---|---|---|---|\n| எஸ்.எஸ்.எல்.சி. (10-ஆம் வகுப்பு), 2025-26 | 186 | 100% | 81% |\n| எச்.எஸ்.சி. (12-ஆம் வகுப்பு), 2025-26 | 142 | 100% | 74% |\n\n- பள்ளிகளுக்கிடையேயான சதுரங்கத்தில் மூன்று ஆண்டுகளாக மாவட்ட வெற்றியாளர்.\n- 2025-26-இல் மாநில அளவிலான கராத்தே, தடகளப் போட்டிகளில் பன்னிரண்டு பதக்கங்கள்.\n- கடந்த ஐந்து ஆண்டுகளில் மாநில அறிவியல் கண்காட்சிக்கு பதினெட்டு மாணவர்கள் தேர்வு.\n- 2015 முதல் ஒவ்வோர் ஆண்டும் என்.எம்.எம்.எஸ். உதவித்தொகைக்கு மாணவர் தேர்வு.\n\nதேர்வு எழுதிய குழுக்களின் முடிவுகள் இவை; ஒவ்வோர் எண்ணும் அறிவிப்புப் பலகையில் உங்கள் பார்வைக்கு உண்டு.",
        },
        "thm-voices": {
          title: "பெற்றோர் சொல்கிறார்கள்",
          items: [
            { quote: "என் மகன் 6-ஆம் வகுப்புக்கு வந்தபோது கணிதத்துக்குப் பயந்தான். அவனுடைய ஆசிரியர் ஒரு மாதம் பள்ளி முடிந்த பிறகு கட்டணம் இல்லாமல் அவனுடன் அமர்ந்தார். இந்த ஆண்டு ஒலிம்பியாட் குழுவில் சேரக் கேட்டான்.", role: "8-ஆம் வகுப்பு மாணவரின் பெற்றோர், ஸ்ரீரங்கம்" },
            { quote: "ஐந்து பள்ளிகளுக்குச் சென்றேன். இங்கே முதல்வரே சமையலறை, பேருந்து, முதலுதவி அறையைக் காட்டினார். கட்டணம் பற்றி இருமுறை கேட்க வேண்டியதில்லை; எழுத்தில் ஒரு தாளில் இருந்தது.", role: "யு.கே.ஜி. மாணவரின் பெற்றோர், கே.கே. நகர்" },
            { quote: "என் மகள் பேருந்தில் ஏறும்போதும் இறங்கும்போதும் உதவியாளர் எனக்கு அழைக்கிறார். வேலைக்குச் செல்லும் தாய்க்கு அந்த அழைப்பு எந்த வசதியையும் விட மேலானது.", role: "5-ஆம் வகுப்பு மாணவரின் பெற்றோர், உறையூர்" },
          ],
        },
        "thm-news": { title: "செய்திகளும் நிகழ்வுகளும்" },
        "thm-faq": { title: "பெற்றோர் கேட்கும் கேள்விகள்", items: ADMISSION_FAQ_TA },
        "thm-enquire": {
          heading: "சேர்க்கை விசாரணை 2027-28",
          text: "உங்கள் குழந்தையைப் பற்றிச் சொல்லுங்கள்; ஒரு வேலை நாளுக்குள் அழைத்து நடைமுறையை விளக்கி வளாகப் பார்வையை உறுதி செய்வோம்.",
          studentLabel: "குழந்தையின் பெயர்",
          optionLabel: "விண்ணப்பிக்கும் வகுப்பு",
          options: CLASS_OPTIONS_TA,
          submitLabel: "விசாரணையை அனுப்பு",
          successText: "நன்றி. எங்கள் சேர்க்கை அலுவலகம் ஒரு வேலை நாளுக்குள் உங்களை அழைக்கும்.",
          imageAlt: "பள்ளி முற்றத்தில் குழுச் செயல்பாட்டில் ஈடுபடும் சீருடைக் குழந்தைகள், மேலிருந்து தோற்றம்",
        },
        "thm-visit-book": {
          heading: "வளாகத்தைப் பார்வையிடுங்கள்",
          text: "சேர்க்கை ஆலோசகருடன் 45 நிமிட வருகை: வகுப்பறைகள், ஆய்வகங்கள், பேருந்தைச் சுற்றிப் பார்த்தல், உங்கள் குழந்தை பற்றிய உரையாடல், கட்டணப் பட்டியல். கட்டணம் இல்லை, கட்டாயம் இல்லை. திங்கள் முதல் சனி வரை.",
          services: [{ name: "வளாகப் பார்வை மற்றும் ஆலோசனை", duration: "45 நிமிடம்" }],
          cta: { label: "வளாகப் பார்வைக்கு முன்பதிவு" },
        },
        "thm-contact": {
          title: "பள்ளி அலுவலகம்",
          address: "14, காவேரி நகர் பிரதான சாலை, தில்லை நகர், திருச்சிராப்பள்ளி 620018",
          hours: HOURS_TA,
        },
      },
    },
  }),
  pages: PAGES,
  posts: POSTS,
  menus: {
    header: [
      { label: "About", type: "page", ref: "about" },
      { label: "Academics", type: "page", ref: "academics" },
      { label: "Admissions", type: "page", ref: "admissions" },
      { label: "Facilities", type: "page", ref: "facilities" },
      { label: "News", type: "url", href: "/blog" },
      { label: "Contact", type: "page", ref: "contact" },
    ],
    footer: [
      {
        label: "Admissions",
        type: "url",
        children: [
          { label: "Apply for admission", type: "page", ref: "admissions" },
          { label: "Book a campus visit", type: "url", href: "/book" },
          { label: "Fees", type: "page", ref: "fees" },
          { label: "WhatsApp the office", type: "url", href: waLink("Hello, I would like to know about admission at Thamarai Vidyalaya.") },
        ],
      },
      {
        label: "School",
        type: "url",
        children: [
          { label: "About us", type: "page", ref: "about" },
          { label: "Academics", type: "page", ref: "academics" },
          { label: "Facilities", type: "page", ref: "facilities" },
          { label: "Transport", type: "page", ref: "transport" },
          { label: "Contact", type: "page", ref: "contact" },
        ],
      },
      {
        label: "Programmes",
        type: "url",
        children: [
          { label: "Pre-primary", type: "category", ref: "pre-primary" },
          { label: "Primary", type: "category", ref: "primary" },
          { label: "Middle and high school", type: "category", ref: "middle-school" },
          { label: "Higher secondary", type: "category", ref: "higher-secondary" },
          { label: "Clubs and activities", type: "collection", ref: "clubs" },
          { label: "Privacy policy", type: "page", ref: "privacy-policy" },
          { label: "Photo credits", type: "page", ref: "photo-credits" },
        ],
      },
    ],
  },
  photos: PHOTOS,
  setup: setupThamarai,
};
