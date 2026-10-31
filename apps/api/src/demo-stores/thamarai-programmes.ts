import type { DemoProduct } from "./types";

/**
 * Thamarai Vidyalaya: the programmes, one catalogue item of kind service per stage or club (thamarai.ts). They are
 * not for sale online: no price (every variant is ₹0, which the store shows as "Fee on enquiry"; the fee is shared at
 * the counselling visit) and no online booking, so a programme page offers "Enquire on WhatsApp" and the enquiry form.
 * GST 0%: education by a school to its students is exempt (see thamarai.ts for the notification). SAC codes follow
 * heading 9992 (education services): 999210 pre-primary, 999220 primary, 999231 secondary (general; used here from
 * Class 6 to Class 12), 999291 cultural education, 999292 sports and recreation education, 999299 other education
 * services n.e.c.
 */
export const PRE_PRIMARY = "Pre-primary";
export const PRIMARY = "Primary";
export const MIDDLE = "Middle school";
export const HIGH = "High school";
export const HIGHER = "Higher secondary";
export const CO = "Co-curricular";

/** The campus visit is a billing item (kept off the store) so it can be a bookable service; see thamarai-setup.ts. */
export const VISIT_NAME = "Campus visit and counselling (45 min)";

interface Programme {
  name: string;
  category: string;
  hsn: string;
  sku: string;
  photo: number;
  description: string;
  attributes: Record<string, string>;
  tags?: string[];
}

const TIMINGS_SCHOOL = "8:50 am to 3:40 pm, Monday to Friday; Saturday 8:50 am to 12:30 pm";
const TIMINGS_SENIOR = "8:50 am to 4:30 pm, Monday to Friday; Saturday 8:50 am to 1:00 pm";

const P: Programme[] = [
  {
    name: "Play group and Nursery",
    category: PRE_PRIMARY,
    hsn: "999210",
    sku: "TV-PRE",
    photo: 8535238,
    description:
      "A first school for ages 2½ to 4, run as a gentle half day. Children come with a parent for the first week, then settle into songs, sand and water play, clay, picture books and simple Tamil and English rhymes. Small groups of 15 with a teacher and an aaya, a quiet room for a nap and a daily note to parents. No written tests and no homework.",
    attributes: { Classes: "Play group, Nursery", Session: "Half day", "Board / syllabus": "Activity-based early years programme", Medium: "English", "Age criteria": "2 years 6 months by 31 July of the admission year", Timings: "9:00 am to 12:30 pm" },
    tags: ["stage-pre"],
  },
  {
    name: "LKG and UKG",
    category: PRE_PRIMARY,
    hsn: "999210",
    sku: "TV-KG",
    photo: 13806486,
    description:
      "Two years of learning through play that get a child ready for Class 1: letters and sounds in Tamil and English, numbers to 100, shapes and colours, story time, a weekly craft period, music and movement, and a short outdoor period every day. Reading is built slowly with picture books; writing starts with patterns and grows into neat letters by the end of UKG.",
    attributes: { Classes: "LKG, UKG", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board early years curriculum, with activity worksheets", Medium: "English", "Age criteria": "LKG: 3½ years; UKG: 4½ years, by 31 July", Timings: "8:50 am to 3:00 pm" },
    tags: ["stage-pre"],
  },
  {
    name: "Classes 1 to 3 (foundation years)",
    category: PRIMARY,
    hsn: "999220",
    sku: "TV-P13",
    photo: 18012456,
    description:
      "The years where reading, handwriting and number sense are made firm. Tamil, English, Mathematics and Environmental Science are taught by class teachers who stay with a section for the whole year, with a weekly library period, art, music, physical education and a computer introduction from Class 2. Learning is checked through activities and short unit tests, with a parent meeting every term.",
    attributes: { Classes: "1, 2, 3", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (Samacheer Kalvi)", Medium: "English", "Age criteria": "Class 1: 5½ years by 31 July", Timings: TIMINGS_SCHOOL },
    tags: ["stage-primary"],
  },
  {
    name: "Classes 4 and 5 (upper primary)",
    category: PRIMARY,
    hsn: "999220",
    sku: "TV-P45",
    photo: 1720186,
    description:
      "Subject teachers begin in Class 4 for English and Mathematics, with Tamil and Environmental Science staying with the class teacher. Children start projects, a reading log, a weekly science activity in the lab and their first public speaking at assembly. Clubs open to them: art, chess, music and the junior eco club. Extra mentoring for pupils who need it, at no extra charge.",
    attributes: { Classes: "4, 5", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (Samacheer Kalvi)", Medium: "English", "Age criteria": "Class 4: 8½ years by 31 July", Timings: TIMINGS_SCHOOL },
    tags: ["stage-primary"],
  },
  {
    name: "Classes 6 to 8",
    category: MIDDLE,
    hsn: "999231",
    sku: "TV-M68",
    photo: 35551059,
    description:
      "Subject-wise teaching in smart classrooms, with Science and Mathematics practicals in the labs every week. Tamil, English, Hindi (a third language from Class 6, optional), Mathematics, Science and Social Science, with computer science and a weekly life-skills period. Pupils take part in the school's science expo, inter-school quizzes and elocution, and can join the Olympiad and NMMS (scholarship) coaching that runs after school hours.",
    attributes: { Classes: "6, 7, 8", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (Samacheer Kalvi)", Medium: "English", "Age criteria": "Class 6: 10½ years by 31 July", Timings: TIMINGS_SCHOOL },
    tags: ["stage-middle"],
  },
  {
    name: "Classes 9 and 10 (SSLC)",
    category: HIGH,
    hsn: "999231",
    sku: "TV-H910",
    photo: 35551044,
    description:
      "Two years that lead to the State Board SSLC public examination. Class 9 builds the base with a full syllabus plan and monthly tests; Class 10 adds revision tests, top-up classes for pupils who need them, a career guidance session with a counsellor and evening study hours before the board exams. Children also complete the school's service project in these years. English medium, with Tamil as the first language.",
    attributes: { Classes: "9, 10", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (SSLC public examination)", Medium: "English", "Age criteria": "Class 9: 13½ years by 31 July", Timings: "8:50 am to 4:15 pm, Monday to Friday; Saturday 8:50 am to 1:00 pm" },
    tags: ["stage-high"],
  },
  {
    name: "Classes 11 and 12: Science group",
    category: HIGHER,
    hsn: "999231",
    sku: "TV-HS",
    photo: 35551044,
    description:
      "For students aiming at engineering, medicine, pure science or allied courses. Physics, Chemistry and Mathematics with Biology or Computer Science as the fourth subject, plus Tamil and English. Physics, Chemistry, Biology and computer labs, weekly practical records, a guided NEET and JEE foundation programme and college counselling in Class 12.",
    attributes: { Classes: "11, 12", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (HSC public examinations)", Medium: "English", "Age criteria": "Class 11: passed Class 10 (SSLC); a school entry test for outside candidates", Timings: TIMINGS_SENIOR },
    tags: ["stage-higher"],
  },
  {
    name: "Classes 11 and 12: Commerce group",
    category: HIGHER,
    hsn: "999231",
    sku: "TV-HC",
    photo: 5539290,
    description:
      "For students aiming at B.Com, BBA, CA, CMA, company secretary or law. Accountancy, Commerce, Economics and Business Mathematics (or Computer Applications), plus Tamil and English. Accounting practice on spreadsheet software in the computer lab, a school bank and stock-market simulation project, and talks by chartered accountants and bank officers through the year.",
    attributes: { Classes: "11, 12", Session: "Full day", "Board / syllabus": "Tamil Nadu State Board (HSC public examinations)", Medium: "English", "Age criteria": "Class 11: passed Class 10 (SSLC); a school entry test for outside candidates", Timings: TIMINGS_SENIOR },
    tags: ["stage-higher"],
  },
  {
    name: "Bharatanatyam and folk dance",
    category: CO,
    hsn: "999291",
    sku: "TV-DAN",
    photo: 38396457,
    description:
      "Weekly classes in Bharatanatyam, with karagattam, oyilattam and kolattam for the annual day, taught by a trained teacher in the school's dance hall. Pupils prepare for a stage show every January and take part in district competitions. Open to girls and boys from Class 1. Annual day costumes are arranged by the school.",
    attributes: { Classes: "1 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "From Class 1", Timings: "Two evening sessions a week, 3:45 pm to 4:45 pm" },
    tags: ["club"],
  },
  {
    name: "Carnatic vocal and harmonium",
    category: CO,
    hsn: "999291",
    sku: "TV-MUS",
    photo: 34195649,
    description:
      "Group lessons in Carnatic vocal music (sarali varisai to simple kirtanais and Tamil devotional songs) and harmonium. Pupils sing at morning assembly, the Tamil Mandram programme and the annual day. Keen children can prepare for the Tamil Nadu government music examination.",
    attributes: { Classes: "1 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "From Class 1", Timings: "Two sessions a week, 3:45 pm to 4:30 pm" },
    tags: ["club"],
  },
  {
    name: "Karate and martial arts",
    category: CO,
    hsn: "999292",
    sku: "TV-MAR",
    photo: 4044373,
    description:
      "Karate and basic self-defence training by a certified coach, with belt grading every six months. Builds fitness, discipline and confidence; the girls' self-defence batch is run separately. Pupils represent the school at district-level tournaments.",
    attributes: { Classes: "2 to 12", Session: "Early morning", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "From Class 2", Timings: "Three early-morning sessions a week, 7:00 am to 8:00 am" },
    tags: ["club", "sports"],
  },
  {
    name: "Athletics, cricket and basketball",
    category: CO,
    hsn: "999292",
    sku: "TV-SPO",
    photo: 7160120,
    description:
      "A running track, a cricket ground and a basketball court, each with a trained coach. Selection trials in July for the school teams that play in the district and zonal tournaments; every child has a daily physical education period and an annual sports day, with house events from Class 1.",
    attributes: { Classes: "3 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "From Class 3 for the teams", Timings: "Evenings, 4:00 pm to 5:30 pm, five days a week" },
    tags: ["club", "sports"],
  },
  {
    name: "Chess club",
    category: CO,
    hsn: "999292",
    sku: "TV-CHE",
    photo: 8466025,
    description:
      "A weekly chess class for beginners and rated players alike, with a coach who prepares the school team for district and State school tournaments. Children learn to read a board, plan three moves ahead and lose with grace.",
    attributes: { Classes: "2 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "From Class 2", Timings: "One session a week, 3:45 pm to 4:45 pm" },
    tags: ["club"],
  },
  {
    name: "Robotics and coding club",
    category: CO,
    hsn: "999299",
    sku: "TV-ROB",
    photo: 7869085,
    description:
      "Block coding from Class 4, then Python and sensor-based projects with microcontroller kits for older pupils. Teams build a small project each term and show it at the science expo; senior teams enter inter-school robotics and innovation contests.",
    attributes: { Classes: "4 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "English", "Age criteria": "From Class 4", Timings: "One session a week, 3:45 pm to 5:00 pm" },
    tags: ["club"],
  },
  {
    name: "Art and craft",
    category: CO,
    hsn: "999291",
    sku: "TV-ART",
    photo: 1720186,
    description:
      "A weekly art and craft period for every class, with an optional after-school studio for children who love to draw, paint and make. Work from the art room is shown at the annual day and the school's open-house evening.",
    attributes: { Classes: "1 to 12", Session: "After school", "Board / syllabus": "School co-curricular programme", Medium: "Tamil and English", "Age criteria": "All classes", Timings: "During school hours; studio on Wednesdays, 3:45 pm to 4:45 pm" },
    tags: ["club"],
  },
];

const make = (p: Programme): DemoProduct => ({
  name: p.name,
  category: p.category,
  hsn: p.hsn,
  gstRate: 0,
  unit: "service",
  description: p.description,
  attributes: p.attributes,
  tags: p.tags,
  sku: p.sku,
  photo: p.photo,
  // No fee on the site: ₹0 shows as "Fee on enquiry" (storefront-ui Price) and the fee is shared at counselling.
  variants: [{ price: 0, mrp: 0, stock: 999 }],
  costShare: 0,
});

export const PRODUCTS: DemoProduct[] = P.map(make);
