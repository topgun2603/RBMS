import type { DemoPage, DemoPost } from "./types";
import { ADDRESS, EMAIL, PHONE_SPACED } from "./thamarai-shared";
import { PHOTOS } from "./thamarai-photos";

/**
 * Thamarai Vidyalaya: the admission FAQ, the class list of the enquiry form, the pages and the news posts
 * (thamarai.ts). Fees are never quoted: they are shared at the counselling visit.
 */

export const CLASS_OPTIONS = [
  "Play group",
  "Nursery",
  "LKG",
  "UKG",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11 (Science)",
  "Class 11 (Commerce)",
];
export const CLASS_OPTIONS_TA = [
  "விளையாட்டுப் பள்ளி",
  "நர்சரி",
  "எல்.கே.ஜி.",
  "யு.கே.ஜி.",
  "1-ஆம் வகுப்பு",
  "2-ஆம் வகுப்பு",
  "3-ஆம் வகுப்பு",
  "4-ஆம் வகுப்பு",
  "5-ஆம் வகுப்பு",
  "6-ஆம் வகுப்பு",
  "7-ஆம் வகுப்பு",
  "8-ஆம் வகுப்பு",
  "9-ஆம் வகுப்பு",
  "10-ஆம் வகுப்பு",
  "11-ஆம் வகுப்பு (அறிவியல்)",
  "11-ஆம் வகுப்பு (வணிகவியல்)",
];

export const ADMISSION_FAQ = [
  { q: "What is the age for admission?", a: "The child must have completed the age shown for the class **on 31 July** of the admission year: **2 years 6 months** for Play group, **3 years 6 months** for LKG, **4 years 6 months** for UKG and **5 years 6 months** for Class 1. See the [Admissions page](/admissions) for the full table." },
  { q: "Which syllabus and medium do you follow?", a: "The **Tamil Nadu State Board syllabus** (Samacheer Kalvi) with **English as the medium of instruction**. Tamil is taught as the first language in every class, and Hindi is offered as an optional third language from Class 6." },
  { q: "What documents do I need to apply?", a: "A birth certificate, Aadhaar of the child (if available), the previous school's Transfer Certificate and last report card for Class 1 onwards, community certificate (if claimed), four passport photographs and the parents' address proof. The full list is on the Admissions page." },
  { q: "What are the fees? Is there a donation?", a: "There is **no donation or capitation**. The fee schedule for each class is given in writing at the counselling visit, along with what it includes and the instalment dates. We do not publish amounts on the website because they differ by class and by transport route." },
  { q: "Do you admit children under the RTE Act?", a: "Yes. As a private school we keep **25% of the seats** in the entry class for admission under the Right to Education Act, through the State government's online RTE portal. Apply on the portal when it opens; the school office can help you with the form." },
  { q: "Can my child join in the middle of the year?", a: "Sometimes. Mid-year admission to Classes 2 to 9 depends on vacancy and a short interaction and assessment. Admission to Class 10 and Class 12 in the middle of the year is not possible because of the board examinations." },
  { q: "Is there school transport?", a: "Yes. GPS-tracked buses with a woman attendant run to most parts of Tiruchirappalli and Srirangam. The fee depends on the distance and is shared with the fee schedule. See the [Transport page](/transport) for routes." },
  { q: "How do I apply?", a: "Send the admission enquiry form on this page, or [book a campus visit](/book). Our admissions counsellor will explain the process, show you the campus and give you the application form. You can also call or WhatsApp the office." },
];
export const ADMISSION_FAQ_TA = [
  { q: "சேர்க்கைக்கான வயது என்ன?", a: "சேர்க்கை ஆண்டின் **ஜூலை 31 அன்று** வகுப்புக்கு உரிய வயதை நிறைவு செய்திருக்க வேண்டும்: விளையாட்டுப் பள்ளிக்கு **2 ஆண்டு 6 மாதம்**, எல்.கே.ஜி.க்கு **3 ஆண்டு 6 மாதம்**, யு.கே.ஜி.க்கு **4 ஆண்டு 6 மாதம்**, 1-ஆம் வகுப்புக்கு **5 ஆண்டு 6 மாதம்**. முழு அட்டவணை [சேர்க்கைப் பக்கத்தில்](/admissions) உள்ளது." },
  { q: "எந்தப் பாடத்திட்டம், எந்த மொழி வழி?", a: "**தமிழ்நாடு மாநிலப் பாடத்திட்டம்** (சமச்சீர் கல்வி), **ஆங்கிலம் பயிற்று மொழி**. எல்லா வகுப்புகளிலும் தமிழ் முதல் மொழியாகக் கற்பிக்கப்படுகிறது; 6-ஆம் வகுப்பு முதல் இந்தி விருப்ப மூன்றாம் மொழியாக உண்டு." },
  { q: "விண்ணப்பிக்க என்ன ஆவணங்கள் வேண்டும்?", a: "பிறப்புச் சான்றிதழ், குழந்தையின் ஆதார் (இருந்தால்), 1-ஆம் வகுப்பு முதல் முந்தைய பள்ளியின் மாற்றுச் சான்றிதழ், கடைசி மதிப்பெண் அட்டை, சாதிச் சான்றிதழ் (கோரினால்), நான்கு பாஸ்போர்ட் அளவு புகைப்படங்கள், பெற்றோரின் முகவரிச் சான்று. முழுப் பட்டியல் சேர்க்கைப் பக்கத்தில் உள்ளது." },
  { q: "கட்டணம் எவ்வளவு? நன்கொடை உண்டா?", a: "**நன்கொடை, கேபிடேஷன் இல்லை.** ஒவ்வொரு வகுப்புக்கும் கட்டணப் பட்டியல், அதில் என்னென்ன அடங்கும், தவணைத் தேதிகளுடன், ஆலோசனை வருகையில் எழுத்தில் தரப்படும். வகுப்பு, போக்குவரத்து வழியைப் பொறுத்து மாறுவதால் தொகைகளை இணையதளத்தில் வெளியிடுவதில்லை." },
  { q: "ஆர்.டி.ஈ. சட்டத்தின் கீழ் சேர்க்கை உண்டா?", a: "உண்டு. தனியார் பள்ளியாக, நுழைவு வகுப்பில் **25% இடங்களை** கல்வி உரிமைச் சட்டப்படி மாநில அரசின் இணையவழி ஆர்.டி.ஈ. தளம் வழியாக ஒதுக்குகிறோம். தளம் திறக்கும்போது அங்கே விண்ணப்பியுங்கள்; படிவம் நிரப்பப் பள்ளி அலுவலகம் உதவும்." },
  { q: "கல்வியாண்டின் நடுவில் சேரலாமா?", a: "சில சமயம் முடியும். 2 முதல் 9-ஆம் வகுப்பு வரை நடுவாண்டுச் சேர்க்கை காலியிடம், சிறு உரையாடல், மதிப்பீட்டைப் பொறுத்தது. பொதுத்தேர்வு இருப்பதால் 10, 12-ஆம் வகுப்புகளில் நடுவாண்டுச் சேர்க்கை இல்லை." },
  { q: "பள்ளிப் பேருந்து உண்டா?", a: "உண்டு. ஜி.பி.எஸ். கண்காணிப்பு, பெண் உதவியாளர் கொண்ட பேருந்துகள் திருச்சி, ஸ்ரீரங்கத்தின் பெரும்பாலான பகுதிகளுக்கு ஓடுகின்றன. கட்டணம் தூரத்தைப் பொறுத்தது; கட்டணப் பட்டியலுடன் தெரிவிக்கப்படும். வழிகள் [போக்குவரத்துப் பக்கத்தில்](/transport) உள்ளன." },
  { q: "எப்படி விண்ணப்பிப்பது?", a: "இந்தப் பக்கத்தில் உள்ள சேர்க்கை விசாரணைப் படிவத்தை அனுப்புங்கள் அல்லது [வளாகப் பார்வைக்கு முன்பதிவு](/book) செய்யுங்கள். எங்கள் சேர்க்கை ஆலோசகர் நடைமுறையை விளக்கி, வளாகத்தைக் காட்டி, விண்ணப்பப் படிவத்தைத் தருவார். அலுவலகத்துக்கு அழைக்கவும் வாட்ஸ்அப் செய்யவும் முடியும்." },
];

const h2 = (text: string) => ({ type: "heading" as const, level: 2 as const, text });
const h3 = (text: string) => ({ type: "heading" as const, level: 3 as const, text });
const p = (markdown: string) => ({ type: "paragraph" as const, markdown });

const ENQUIRY_IMG = 11445241;

export const PAGES: DemoPage[] = [
  {
    slug: "admissions",
    title: "Admissions 2027-28",
    blocks: ({ photo }) => [
      p("Admissions are open for **2027-28** from Play group to Class 11. We meet every family before we offer a seat: a short visit, a conversation about your child and a look at the school together."),
      { type: "button", label: "Book a campus visit", href: "/book", style: "primary" },
      { type: "image", url: photo(11445241, "tile"), alt: PHOTOS[11445241]!.alt },
      h2("How to apply"),
      p("1. **Enquire.** Send the form below, call or WhatsApp the office.\n2. **Visit.** Walk through the campus with our admissions counsellor (45 minutes, no charge).\n3. **Apply.** Fill in the application form and submit the documents.\n4. **Interaction.** A friendly conversation for Play group to Class 2; a short written and oral assessment for Class 3 onwards. There is no test for young children.\n5. **Offer.** We write to you with the decision and the fee schedule. Pay the admission fee by the date in the letter to confirm the seat."),
      h2("Age and eligibility"),
      p("The child must have completed this age on **31 July** of the admission year.\n\n| Class | Minimum age | Entry requirement |\n|---|---|---|\n| Play group | 2 years 6 months | Interaction with parents |\n| LKG | 3 years 6 months | Interaction |\n| UKG | 4 years 6 months | Interaction |\n| Class 1 | 5 years 6 months | Interaction |\n| Classes 2 to 9 | One year above the previous class | Transfer Certificate and report card; short assessment |\n| Class 10 | Only at the start of the year | Transfer Certificate and report card; subject to vacancy |\n| Class 11 | Passed Class 10 (SSLC) | Mark sheet; group allotted by marks and counselling |"),
      h2("Documents needed"),
      p("- Birth certificate (original and a copy)\n- Aadhaar of the child, if available\n- Transfer Certificate and last report card (Class 1 onwards)\n- Community certificate, if claimed\n- Four recent passport-size photographs of the child, and one of each parent\n- Address proof of a parent (Aadhaar, ration card or utility bill)\n- Immunisation record for Play group to UKG"),
      h2("Important dates for 2027-28"),
      p("| What | When |\n|---|---|\n| Application forms available | From 1 November 2026 |\n| Campus visits and counselling | Monday to Saturday, by appointment |\n| Interaction and assessments | January to March 2027, on Saturdays |\n| Offers sent to families | From 1 March 2027 |\n| Last date to confirm the seat | 31 March 2027 |\n| Classes begin | First week of June 2027 |\n\nThe dates are those announced so far; the school's admission notice gives the final ones."),
      h2("Fees"),
      p("The school shares the fee schedule for each class in writing at the counselling visit. See the [Fees page](/fees)."),
      { type: "enquiry-form", id: "adm-enquiry", heading: "Admission enquiry 2027-28", text: "Tell us about your child. We call back within one working day.", topic: "Admission 2027-28", askStudent: true, studentLabel: "Child's name", optionLabel: "Class applying for", options: CLASS_OPTIONS, askEmail: true, askMessage: true, submitLabel: "Send enquiry", successText: "Thank you. Our admissions office will call you within one working day.", imageUrl: photo(ENQUIRY_IMG, "tile"), imageAlt: PHOTOS[ENQUIRY_IMG]!.alt },
    ],
  },
  {
    slug: "about",
    title: "About Thamarai Vidyalaya",
    blocks: ({ photo }) => [
      p("Thamarai Vidyalaya was founded in **1998** by the Thamarai Educational Trust, a group of teachers and parents in Thillai Nagar who wanted a school where children were not just taught but known. Today it is a Matriculation Higher Secondary School with about 2,400 students from Play group to Class 12."),
      { type: "image", url: photo(22616347, "tile"), alt: PHOTOS[22616347]!.alt },
      h2("Vision"),
      p("To grow thoughtful, kind and capable young people who are rooted in Tamil culture and ready for the wider world."),
      h2("Mission"),
      p("- Give every child a strong foundation in language, mathematics and science.\n- Keep classes small enough for a teacher to know each child.\n- Build character through service, sport, music and the arts.\n- Work with parents as partners, openly and honestly.\n- Keep fees fair and clearly stated, with no donation."),
      h2("Our values"),
      p("**Respect** for every person, **honesty** in work and in dealing with parents, **curiosity** that asks why, **service** to the community, and **courage** to try and to fail."),
      h2("Management"),
      p("The school is run by the **Thamarai Educational Trust**. The Trust's correspondent, **Thiru. K. Ramanathan**, and a board of five trustees (two of them parents of former students) meet the Principal every month to review academics, safety and finances."),
      h2("Principal"),
      p("**Mrs. R. Vasantha Lakshmi, M.A., M.Ed.**, has led the school since 2011 after teaching English for fourteen years. She meets parents without an appointment on Saturday mornings. The **Vice Principal, Mr. A. Selvaraj**, and **Mrs. J. Fathima Beevi**, head of the primary section, lead the day-to-day work of the school."),
      { type: "button", label: "Book a campus visit", href: "/book", style: "primary" },
    ],
  },
  {
    slug: "academics",
    title: "Academics",
    blocks: ({ photo }) => [
      p("Thamarai follows the **Tamil Nadu State Board syllabus** (Samacheer Kalvi) in **English medium**, with Tamil as the first language throughout. We add practical work, reading and life skills on top of the textbooks."),
      { type: "image", url: photo(35551059, "tile"), alt: PHOTOS[35551059]!.alt },
      h2("Curriculum by stage"),
      p("| Stage | Classes | What children do |\n|---|---|---|\n| Pre-primary | Play group, Nursery, LKG, UKG | Learning through play, rhymes, stories, early reading and number sense |\n| Primary | 1 to 5 | Tamil, English, Mathematics, Environmental Science, art, music, PE, computers |\n| Middle school | 6 to 8 | Subject teachers, science and maths practicals, Hindi (optional), Social Science |\n| High school | 9 and 10 | SSLC syllabus, monthly tests, revision and top-up classes, career guidance |\n| Higher secondary | 11 and 12 | Science (with Biology or Computer Science) and Commerce groups |"),
      h2("How we assess"),
      p("Unit tests and activities through the year, term examinations and a report card that says what a child can do, not just a mark. Pupils who need extra help get **free mentoring classes** after school. Parents meet the class teacher every term."),
      h2("Languages"),
      p("Tamil and English in every class. Hindi is optional from Class 6. Reading in both Tamil and English is checked every term from Class 1."),
      h2("Co-curricular programme"),
      p("Dance, Carnatic music, karate, athletics, cricket, basketball, chess, robotics and art run after school hours. See the [co-curricular programmes](/c/co-curricular)."),
      { type: "button", label: "See all programmes", href: "/c/all-programmes", style: "secondary" },
    ],
  },
  {
    slug: "facilities",
    title: "Campus and facilities",
    blocks: ({ photo }) => [
      p("The campus covers four acres in Thillai Nagar, with three academic blocks, a sports ground and a quiet garden at the back."),
      { type: "gallery", images: [
        { url: photo(5539290, "tile"), alt: PHOTOS[5539290]!.alt, caption: "Computer lab" },
        { url: photo(35551044, "tile"), alt: PHOTOS[35551044]!.alt, caption: "Science room" },
        { url: photo(8926894, "tile"), alt: PHOTOS[8926894]!.alt, caption: "Library" },
        { url: photo(36293966, "tile"), alt: PHOTOS[36293966]!.alt, caption: "Sports ground" },
      ] },
      h2("Classrooms"),
      p("Airy, well-lit classrooms with a digital board from Class 3, fans and LED lights, and furniture of the right size for each age."),
      h2("Science and computer labs"),
      p("Physics, Chemistry and Biology labs for Classes 9 to 12, a junior science room, a computer lab with one machine for every two students and a robotics and coding lab."),
      h2("Library"),
      p("Over 12,000 books in Tamil, English and Hindi, a children's corner and a weekly library period for every class up to Class 8."),
      h2("Sports"),
      p("A running track, a cricket ground, a basketball court, a karate hall and an indoor room for chess and carrom, with trained coaches."),
      h2("Safety and health"),
      p("CCTV across the campus, a visitor register and ID check at the gate, women staff for the early years, a first-aid room with a nurse, a doctor on call and fire safety drills twice a year. Children are released only to the persons named on the pick-up card."),
      h2("Canteen"),
      p("A plain vegetarian canteen run by the school: idli, pongal, curd rice, sundal, fruit and millet snacks. No packaged chips, no fizzy drinks, no plastic."),
      { type: "image", url: photo(30858416, "tile"), alt: PHOTOS[30858416]!.alt },
    ],
  },
  {
    slug: "transport",
    title: "School transport",
    blocks: ({ photo }) => [
      p("Thamarai runs **GPS-tracked school buses** to most of Tiruchirappalli and Srirangam. Every bus has a trained driver and a woman attendant who travels with the children."),
      { type: "image", url: photo(30473509, "tile"), alt: PHOTOS[30473509]!.alt },
      h2("Routes"),
      p("| Route | Main areas | First pick-up |\n|---|---|---|\n| 1 | Srirangam, Amma Mandapam Road, Chinthamani | 7:05 am |\n| 2 | Woraiyur, Thennur, Anna Nagar | 7:10 am |\n| 3 | K.K. Nagar, Ponmalai, Golden Rock | 7:00 am |\n| 4 | Thillai Nagar, Karumandapam, Cantonment | 7:30 am |\n| 5 | Tiruverumbur, B.H.E.L., Navalpattu | 6:55 am |\n| 6 | Mannarpuram, Palakarai, Gandhi Market | 7:15 am |\n\nRoutes and stops are fixed each year after the admissions. Ask the office whether your area is covered."),
      h2("Safety"),
      p("- A live GPS tracker on every bus; parents see the bus on a phone app.\n- A woman attendant on every bus; she calls the parent at boarding and at drop.\n- Speed governors set at 40 km/h; no bus runs with a standing child.\n- Drivers are checked by the police and by the school, and trained in first aid.\n- Fitness certificate, fire extinguisher and first-aid box on every bus, checked each month.\n- The school-bus norms of the Tamil Nadu Motor Vehicles rules are followed."),
      h2("Fee"),
      p("The transport fee depends on the distance of your stop and is given with the fee schedule at the counselling visit. See the [Fees page](/fees)."),
      { type: "gallery", images: [{ url: photo(28203486, "tile"), alt: PHOTOS[28203486]!.alt, caption: "The school's buses at the campus" }] },
    ],
  },
  {
    slug: "fees",
    title: "Fees",
    blocks: () => [
      p("We do not publish fee amounts on the website, because they differ by class, by transport route and by the year. The **complete fee schedule for the class you are applying for is given to you in writing at the counselling visit**, so you can read it at home before you decide."),
      h2("What the schedule contains"),
      p("- Admission fee (once, at entry)\n- Tuition fee by term\n- Activity, library and computer-lab fee\n- Transport fee, if you use a school bus, by distance\n- Uniform, books and notebooks, if bought from the school (you may buy them elsewhere)\n- The date of every instalment"),
      h2("What we promise"),
      p("- **No donation and no capitation fee**, for any class.\n- Nothing is charged that is not on the printed schedule.\n- Fees are paid by UPI, cheque, demand draft or at the counter, and every payment gets a receipt.\n- Fee concessions are given for siblings and under the rules for seats under the Right to Education Act; ask the office."),
      h2("GST"),
      p("Education services given by the school to its students are exempt from GST. Nothing on the fee schedule carries GST."),
      { type: "button", label: "Book a campus visit to get the schedule", href: "/book", style: "primary" },
      { type: "button", label: "Ask us on WhatsApp", href: `https://wa.me/919876500023?text=${encodeURIComponent("Hello, please share the fee schedule for Class ")}`, style: "secondary" },
    ],
  },
  {
    slug: "contact",
    title: "Contact us",
    blocks: ({ photo }) => [
      p(`**Thamarai Vidyalaya Matriculation Higher Secondary School**\n\n${ADDRESS}\n\nPhone and WhatsApp: **${PHONE_SPACED}**\n\nE-mail: ${EMAIL}`),
      h2("Office hours"),
      p("Monday to Friday, 8:30 am to 4:30 pm. Saturday, 8:30 am to 12:30 pm. Closed on Sunday and school holidays. The Principal meets parents without an appointment on Saturday mornings."),
      h2("Reaching us"),
      p("The campus is on Cauvery Nagar Main Road in Thillai Nagar, five minutes from the Thillai Nagar main road. Parking for visitors is inside the gate."),
      { type: "enquiry-form", id: "contact-enquiry", heading: "Write to us", text: "For admission, fees, transport or anything else. We reply within one working day.", topic: "General enquiry", askStudent: false, askEmail: true, askMessage: true, options: [], submitLabel: "Send message", successText: "Thank you. We will reply within one working day.", imageUrl: photo(ENQUIRY_IMG, "tile"), imageAlt: PHOTOS[ENQUIRY_IMG]!.alt },
      { type: "button", label: "Book a campus visit", href: "/book", style: "primary" },
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy policy",
    blocks: () => [
      p("This policy explains how Thamarai Vidyalaya uses the personal data you give us on this website and at the school office. It follows India's Digital Personal Data Protection Act, 2023."),
      h2("What we collect"),
      p("When you send an enquiry or book a campus visit: the parent's name, phone number and e-mail, the child's name and the class applied for, and any message you write. At admission we also collect the documents listed on the Admissions page."),
      h2("Children's data"),
      p("A child's data is given by a parent or guardian, and we ask for their consent before we keep it. We do not track children, show them advertisements or build profiles of them."),
      h2("Why we use it"),
      p("Only to reply to your enquiry, arrange visits, process admission and look after the child at school. We do not use it for marketing without your consent."),
      h2("Who sees it"),
      p("The admissions office and, after admission, the teachers and staff who need it. We do not sell or share it with outsiders, except where the law requires it."),
      h2("How long we keep it"),
      p("Enquiry data that does not become an admission is deleted after twelve months. Admission records are kept for as long as the law requires."),
      h2("Your rights"),
      p(`You can ask to see, correct or delete your or your child's data, or withdraw your consent, by writing to ${EMAIL} or telling the school office. We reply within thirty days.`),
    ],
  },
  {
    slug: "photo-credits",
    title: "Photo credits",
    blocks: () => [
      h2("Photo credits"),
      p(`Photos on this demo website are from [Pexels](https://www.pexels.com), used under the [Pexels licence](https://www.pexels.com/license/). Thamarai Vidyalaya is a fictional school; the people shown are the photographers' subjects, not our students or staff.\n\n| Photo | Photographer | Link |\n|---|---|---|\n${Object.entries(PHOTOS)
        .map(([id, ph]) => `| ${ph.alt} | ${ph.by} | [pexels.com/photo/${id}](https://www.pexels.com/photo/${id}/) |`)
        .join("\n")}`),
    ],
  },
];

export const POSTS: DemoPost[] = [
  {
    slug: "admissions-open-2027-28",
    title: "Admissions open for 2027-28",
    excerpt: "Application forms for Play group to Class 11 are available from 1 November. Book a campus visit before you apply.",
    cover: 36293966,
    tags: ["admissions", "notice"],
    authorName: "School office",
    blocks: () => [
      p("Admissions for the academic year **2027-28** are open for **Play group to Class 11** (Science and Commerce). Application forms are available at the school office and by enquiry on this website from **1 November 2026**."),
      h2("What to do"),
      p("1. Send the admission enquiry form or [book a campus visit](/book).\n2. Meet our admissions counsellor and see the campus.\n3. Submit the application form with the documents listed on the [Admissions page](/admissions).\n\nInteractions and assessments take place on Saturdays from January to March 2027."),
      p("There is no donation or capitation fee for any class. The fee schedule is given in writing at the counselling visit."),
      { type: "button", label: "Apply for admission", href: "/admissions", style: "primary" },
    ],
  },
  {
    slug: "annual-day-thamarai-vizha",
    title: "Annual Day: Thamarai Vizha celebrates Tamil arts",
    excerpt: "Eight hundred children sang, danced and acted in an evening of Tamil folk and classical arts.",
    cover: 38396457,
    tags: ["events", "arts"],
    authorName: "Cultural committee",
    blocks: () => [
      p("The school's annual day, **Thamarai Vizha**, filled the open-air stage on a January evening with Bharatanatyam, karagattam, oyilattam, a Carnatic vocal ensemble and a Tamil play written by the Class 9 students."),
      p("More than eight hundred children, from UKG to Class 12, took part. Every child in a class had a part, whether on stage, in the choir or behind the scenes. Parents filled the grounds, and the evening ended with the school's anthem sung together."),
      p("Classes in dance and music run through the year. Details are on the [co-curricular page](/c/co-curricular)."),
    ],
  },
  {
    slug: "science-expo-2026",
    title: "Science Expo 2026: 120 working models",
    excerpt: "Students from Classes 5 to 12 showed rainwater harvesting, solar pumps, a mini weather station and a line-following robot.",
    cover: 35551044,
    tags: ["events", "science"],
    authorName: "Science department",
    blocks: () => [
      p("The yearly **Science Expo** showed 120 working models built by students of Classes 5 to 12. Visitors saw a rainwater harvesting system for the school roof, a solar-powered water pump, a mini weather station and a line-following robot from the robotics club."),
      p("Eighteen projects were chosen for the district exhibition. Teachers helped with ideas; the building was the children's own work."),
      p("The robotics and coding club welcomes new members from Class 4. See [the programme](/c/co-curricular)."),
    ],
  },
  {
    slug: "inter-house-sports-meet",
    title: "Inter-house Sports Meet: Blue House takes the trophy",
    excerpt: "Three days of track and field, drill and team games for all four houses, with parents cheering from the stands.",
    cover: 13812360,
    tags: ["events", "sports"],
    authorName: "Physical education department",
    blocks: () => [
      p("The annual **Inter-house Sports Meet** ran for three days on our ground. Children from Class 1 to Class 12 competed in track events, relays, long jump, drill and team games such as kho-kho and throwball, with the youngest children doing fun races and hula-hoop games."),
      p("**Blue House** took the overall trophy, with Green House winning the march-past and Red House the relay. Each house received a participation certificate for every child who took part."),
      p("Our teams in athletics, cricket and basketball train after school. See [the sports programme](/c/co-curricular)."),
    ],
  },
];
