import { PROFILES, type CatalogueEntry } from "../demo-history/profiles";
import type { DemoProduct } from "./types";

/**
 * Thunai Pharmacy & Wellness: the catalogue (91 products). The pharmacy history profile (demo-history/profiles.ts,
 * `pharmacy`) owns the medicine facts: name, pack, HSN, GST rate, MRP (price incl. GST), schedule, composition and
 * manufacturer (fictional makers, no brands). This file adds what a storefront needs: category, what it is used for,
 * the finder / tile tags, the photo and the responsible-health wording. Names match the profile's, so the history
 * simulator sells the shop's own items (no duplicates), and a test checks that every profile item is on the store.
 *
 * Tags: n-… the need (diabetes, bp, baby, women, bone, cold, stomach, vitamin, eye, skin, ayur, fever, infection,
 * firstaid, device, pain, other), a-… who it is for (adult, child, senior), f-… the form (tablet, liquid, topical,
 * device, care), plus bestseller, monthly (refill items), monsoon, rx (prescription needed), h1 (counter only: the
 * store's setup in thunai.ts keeps Schedule H1 medicines off the online store) and under-100.
 */
export const MED = "Medicines";
export const RX = "Prescription medicines";
export const DIA = "Diabetes care";
export const VIT = "Vitamins & supplements";
export const BABY = "Baby care";
export const PERS = "Personal care";
export const AYU = "Ayurveda & siddha";
export const AID = "First aid";
export const DEV = "Devices";

/** Photo pools (Pexels ids), rotated per kind so neighbouring tiles differ. */
const POOLS: Record<string, number[]> = {
  tab: [4210615, 3873149, 9742738, 4210613, 12585202, 5995306, 4076532, 3873148, 9742744, 28300481, 4210607, 140123],
  syr: [10022079, 24703022, 5921726, 5858861],
  inh: [29702938, 6816451],
  eye: [5842835, 5843418],
  tube: [5240619, 4465121, 8015462],
  vit: [3850725, 3850749, 7615558, 13534590, 17820733],
};

type Form = "t" | "l" | "o" | "d" | "c";
const FORM_TAG: Record<Form, string> = { t: "f-tablet", l: "f-liquid", o: "f-topical", d: "f-device", c: "f-care" };
const AGE_TAG: Record<string, string> = { a: "a-adult", c: "a-child", s: "a-senior" };

/** name ; category ; needs ; ages (a adult, c child, s senior) ; form ; photo (pool or id) ; extra tags ; what it is used for */
const ROWS = `
Paracetamol 650 mg (strip of 15) ; ${MED} ; fever,pain ; as ; t ; tab ; bestseller,monsoon ; A common medicine for fever and mild to moderate pain such as headache and body ache.
Cetirizine 10 mg (strip of 10) ; ${MED} ; cold ; as ; t ; tab ; bestseller ; An antihistamine for sneezing, runny nose and itchy eyes from allergies.
Metformin 500 mg (strip of 20) ; ${DIA} ; diabetes ; as ; t ; tab ; rx,monthly,bestseller ; Prescribed by doctors to help control blood sugar in type 2 diabetes.
Amlodipine 5 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed for high blood pressure and some kinds of chest pain.
Vitamin C 500 mg (strip of 15) ; ${VIT} ; vitamin ; as ; t ; vit ; monsoon,bestseller ; A vitamin C supplement for everyday dietary needs.
Pantoprazole 40 mg (strip of 15) ; ${RX} ; stomach ; as ; t ; tab ; rx,monthly ; Prescribed to reduce stomach acid in acidity and reflux.
Telmisartan 40 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed for high blood pressure.
Atorvastatin 10 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed to lower cholesterol and reduce the risk of heart disease.
ORS powder sachet ; ${MED} ; stomach ; asc ; l ; 3923160 ; monsoon,bestseller,under-100 ; A glucose-electrolyte powder to dissolve in clean water and replace fluids lost in loose motions or heat.
Cough syrup 100 ml ; ${MED} ; cold ; as ; l ; syr ; monsoon,bestseller ; A syrup for dry, irritating cough with a runny nose.
Azithromycin 500 mg (strip of 3) ; ${RX} ; infection ; as ; t ; tab ; rx,h1 ; An antibiotic prescribed for bacterial infections.
Omeprazole 20 mg (strip of 10) ; ${RX} ; stomach ; as ; t ; tab ; rx ; Prescribed to reduce stomach acid in acidity and ulcers.
Diclofenac gel 30 g ; ${MED} ; bone,pain ; as ; o ; tube ; bestseller ; A gel rubbed on the skin for muscle, back and joint pain.
Amoxicillin + Clavulanate 625 (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx ; An antibiotic combination prescribed for bacterial infections.
Calcium + D3 (strip of 15) ; ${VIT} ; bone,vitamin ; as ; t ; vit ; monthly,bestseller ; A calcium and vitamin D3 supplement for bone health.
Multivitamin capsules (strip of 10) ; ${VIT} ; vitamin ; as ; t ; vit ; bestseller ; A daily multivitamin and mineral supplement.
Antacid gel 170 ml ; ${MED} ; stomach ; as ; l ; syr ; bestseller ; A gel for quick relief from acidity and heartburn.
Povidone iodine 100 ml ; ${AID} ; firstaid ; asc ; l ; 5921726 ;  ; An antiseptic solution for cleaning minor cuts and scrapes.
Cefixime 200 mg (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx,h1 ; An antibiotic prescribed for bacterial infections.
Levothyroxine 50 mcg (strip of 100) ; ${RX} ; other ; as ; t ; tab ; rx,monthly ; Prescribed for an underactive thyroid.
Paracetamol 650 mg - Nilgiri (strip of 15) ; ${MED} ; fever,pain ; as ; t ; tab ; monsoon ; The same paracetamol 650 mg from another maker, usually priced lower.
Metformin 500 mg - Cauvery (strip of 20) ; ${DIA} ; diabetes ; as ; t ; tab ; rx,monthly ; The same metformin 500 mg from another maker: ask the pharmacist about a substitute if your doctor allows.
Glimepiride 2 mg (strip of 15) ; ${DIA} ; diabetes ; as ; t ; tab ; rx,monthly ; Prescribed to help control blood sugar in type 2 diabetes.
Losartan 50 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed for high blood pressure and to protect the kidneys in diabetes.
Atenolol 50 mg (strip of 14) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed for high blood pressure and heart rhythm problems.
Rosuvastatin 10 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed to lower cholesterol.
Clopidogrel 75 mg (strip of 15) ; ${RX} ; bp ; as ; t ; tab ; rx,monthly ; Prescribed to prevent blood clots after a heart attack or stroke.
Aspirin 75 mg (strip of 14) ; ${MED} ; bp ; as ; t ; tab ; monthly,under-100 ; Low-dose aspirin, taken only when your doctor has advised it.
Ibuprofen 400 mg (strip of 15) ; ${MED} ; fever,pain,bone ; as ; t ; tab ;  ; A pain and fever medicine, best taken after food.
Diclofenac 50 mg (strip of 10) ; ${RX} ; bone,pain ; as ; t ; tab ; rx ; Prescribed for joint pain, back pain and inflammation.
Aceclofenac + Paracetamol (strip of 10) ; ${RX} ; bone,pain ; as ; t ; tab ; rx ; Prescribed for pain and swelling in joints and muscles.
Famotidine 20 mg (strip of 10) ; ${RX} ; stomach ; as ; t ; tab ; rx ; Prescribed to reduce stomach acid.
Domperidone 10 mg (strip of 10) ; ${RX} ; stomach ; as ; t ; tab ; rx ; Prescribed for nausea, vomiting and bloating.
Ondansetron 4 mg (strip of 10) ; ${RX} ; stomach ; as ; t ; tab ; rx ; Prescribed to prevent nausea and vomiting.
Levocetirizine 5 mg (strip of 10) ; ${RX} ; cold ; as ; t ; tab ; rx ; Prescribed for allergic rhinitis and hives.
Montelukast + Levocetirizine (strip of 10) ; ${RX} ; cold ; as ; t ; tab ; rx ; Prescribed for allergic rhinitis with asthma symptoms.
Cetirizine 10 mg - Cauvery (strip of 10) ; ${MED} ; cold ; as ; t ; tab ; under-100 ; The same cetirizine 10 mg from another maker, usually priced lower.
Azithromycin 250 mg (strip of 6) ; ${RX} ; infection ; as ; t ; tab ; rx,h1 ; An antibiotic prescribed for bacterial infections.
Levofloxacin 500 mg (strip of 5) ; ${RX} ; infection ; as ; t ; tab ; rx,h1 ; An antibiotic prescribed for bacterial infections.
Cefpodoxime 200 mg (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx,h1 ; An antibiotic prescribed for bacterial infections.
Amoxicillin 500 mg (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx ; An antibiotic prescribed for bacterial infections.
Doxycycline 100 mg (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx ; An antibiotic prescribed for bacterial infections.
Ciprofloxacin 500 mg (strip of 10) ; ${RX} ; infection ; as ; t ; tab ; rx ; An antibiotic prescribed for bacterial infections.
Metronidazole 400 mg (strip of 15) ; ${RX} ; infection,stomach ; as ; t ; tab ; rx ; Prescribed for amoebic and some bacterial infections of the gut.
Alprazolam 0.25 mg (strip of 15) ; ${RX} ; other ; as ; t ; tab ; rx,h1 ; A Schedule H1 medicine prescribed for anxiety.
Clonazepam 0.5 mg (strip of 10) ; ${RX} ; other ; as ; t ; tab ; rx,h1 ; A Schedule H1 medicine prescribed for seizures and panic disorder.
Tramadol 50 mg (strip of 10) ; ${RX} ; pain ; as ; t ; tab ; rx,h1 ; A Schedule H1 pain medicine, prescribed for moderate to severe pain.
Pregabalin 75 mg (strip of 10) ; ${RX} ; pain ; as ; t ; tab ; rx,h1 ; A Schedule H1 medicine prescribed for nerve pain.
Prednisolone 10 mg (strip of 10) ; ${RX} ; other ; as ; t ; tab ; rx ; A steroid prescribed for inflammation and allergy, only for the days your doctor says.
Folic acid 5 mg (strip of 20) ; ${RX} ; women,vitamin ; as ; t ; tab ; rx ; Prescribed before and during pregnancy and for some kinds of anaemia.
Iron + Folic acid (strip of 15) ; ${VIT} ; women,vitamin ; as ; t ; vit ; bestseller ; An iron and folic acid supplement, often used for low haemoglobin.
Vitamin B-complex (strip of 15) ; ${VIT} ; vitamin ; as ; t ; vit ;  ; A B-vitamin and vitamin C supplement for daily dietary needs.
Vitamin D3 60000 IU (sachet of 4) ; ${VIT} ; bone,vitamin ; as ; l ; vit ; monthly ; A weekly vitamin D3 sachet, for people whose doctor has found low vitamin D.
Zinc 50 mg (strip of 15) ; ${VIT} ; vitamin ; asc ; t ; vit ; monsoon ; A zinc supplement, used in children's diarrhoea on a doctor's advice and for daily needs.
Insulin glargine pen ; ${DIA} ; diabetes ; as ; l ; 32532049 ; rx,monthly ; A long-acting insulin pen, prescribed for diabetes.
Salbutamol inhaler ; ${RX} ; cold ; asc ; d ; inh ; rx,monthly ; A reliever inhaler prescribed for wheeze and breathlessness in asthma.
Budesonide + Formoterol inhaler ; ${RX} ; cold ; as ; d ; inh ; rx,monthly ; A controller inhaler prescribed for asthma and COPD.
Eye drops 10 ml ; ${RX} ; eye ; as ; l ; eye ; rx ; Antibiotic eye drops prescribed for bacterial eye infections.
Lubricant eye drops 10 ml ; ${MED} ; eye ; as ; l ; eye ; bestseller ; Lubricating drops for dry, tired eyes after long screen hours.
Cough lozenges (strip of 8) ; ${MED} ; cold ; asc ; t ; tab ; monsoon,under-100 ; Menthol and eucalyptus lozenges to soothe a sore throat.
Cold and flu tablets (strip of 10) ; ${MED} ; cold,fever ; as ; t ; tab ; monsoon,bestseller ; A combination tablet for the symptoms of a cold: fever, blocked nose and sneezing.
Pain relief spray 55 g ; ${MED} ; bone,pain ; as ; o ; tube ;  ; A spray for temporary relief of muscle and joint pain.
Burn and antiseptic cream 20 g ; ${AID} ; firstaid ; asc ; o ; tube ;  ; An antiseptic cream for minor burns and wounds.
Antifungal cream 15 g ; ${RX} ; skin ; as ; o ; tube ; rx ; Prescribed for fungal skin infections.
Cotton roll 100 g ; ${AID} ; firstaid ; asc ; c ; 6129902 ;  ; Absorbent cotton wool for cleaning wounds and dressings.
Crepe bandage 6 inch ; ${AID} ; firstaid,bone ; asc ; c ; 7722685 ;  ; An elastic bandage for sprains and strains and to hold dressings.
Adhesive bandage (box of 100) ; ${AID} ; firstaid ; asc ; c ; 12625109 ;  ; Adhesive strips for small cuts and blisters.
Digital thermometer ; ${DEV} ; fever,device ; asc ; d ; 3873145 ; monsoon,bestseller ; A digital thermometer with a fast reading and a beep, for the mouth, armpit or under the tongue.
Glucometer strips (50) ; ${DIA} ; diabetes,device ; as ; d ; 33200680 ; monthly ; 50 test strips. Check that they match your meter before you buy.
BP monitor ; ${DEV} ; bp,device ; as ; d ; 8670204 ; bestseller ; A fully automatic upper-arm blood pressure monitor with a one-touch start.
Pulse oximeter ; ${DEV} ; device,cold ; as ; d ; 7580291 ;  ; A fingertip device that shows pulse rate and oxygen saturation.
Face masks (box of 50) ; ${AID} ; cold ; asc ; c ; 5040615 ; monsoon ; 3-ply disposable face masks.
Hand sanitizer 200 ml ; ${PERS} ; firstaid ; asc ; l ; 4175020 ;  ; An alcohol-based hand sanitizer for use when soap and water are not at hand.
Baby diapers (pack of 20) ; ${BABY} ; baby ; c ; c ; 6849268 ; bestseller ; Soft diapers with a wetness indicator.
Protein powder 200 g ; ${VIT} ; vitamin ; a ; c ; 13779103 ;  ; A whey protein supplement to add to milk or water, to be used with a balanced diet.
Glucose powder 500 g ; ${VIT} ; vitamin ; asc ; c ; 10994727 ;  ; A glucose powder for a quick energy drink in hot weather.
Toothpaste 100 g ; ${PERS} ; skin ; asc ; o ; 216729 ; bestseller ; A fluoride toothpaste for daily brushing.
Glucometer with 10 strips ; ${DIA} ; diabetes,device ; as ; d ; 11081349 ; bestseller ; A compact blood glucose meter with a lancing pen and 10 test strips, with a small blood sample and a quick result.
Voice glucometer kit (25 strips) ; ${DIA} ; diabetes,device ; as ; d ; 6941101 ;  ; A talking glucose meter for people with weak eyesight, with a large display, 25 strips and a lancing pen.
Wrist BP monitor ; ${DEV} ; bp,device ; as ; d ; 8900018 ;  ; A compact wrist blood pressure monitor that fits a pocket, for checking on the move.
BP monitor with memory (arm) ; ${DEV} ; bp,device ; as ; d ; 32417921 ;  ; An upper-arm blood pressure monitor with a large display, two user profiles and 60 readings each in memory, for couples and families.
Nebuliser, compressor type ; ${DEV} ; cold,device ; asc ; d ; 32351200 ;  ; A compressor nebuliser with a mask and a mouthpiece, for the medicines your doctor has prescribed for inhalation.
Nilavembu kudineer powder 100 g ; ${AYU} ; ayur,fever ; as ; c ; 4871306 ; monsoon,bestseller ; A traditional siddha herbal powder, made into a decoction (kudineer) at home, popular in the rainy season.
Triphala churna 100 g ; ${AYU} ; ayur,stomach ; as ; c ; 4871294 ;  ; A traditional ayurvedic powder of three fruits, taken with warm water.
Ashwagandha capsules (bottle of 30) ; ${AYU} ; ayur,vitamin ; as ; t ; 7615621 ;  ; An ashwagandha root extract capsule, a traditional ayurvedic tonic.
Chyawanprash 500 g ; ${AYU} ; ayur,vitamin ; asc ; c ; 34928280 ; monsoon ; A traditional ayurvedic herbal jam made with amla, a spoonful with warm milk.
Herbal pain relief oil 100 ml ; ${AYU} ; ayur,bone,pain ; as ; o ; 8167172 ;  ; A herbal massage oil with camphor, wintergreen and nirgundi for sore muscles and joints.
Sanitary napkins (pack of 15) ; ${PERS} ; women ; a ; c ; 7692457 ; bestseller,under-100 ; Soft, absorbent sanitary napkins with wings.
Baby lotion 200 ml ; ${BABY} ; baby ; c ; o ; 8015781 ;  ; A mild moisturising lotion for a baby's skin.
Feeding bottle 250 ml ; ${BABY} ; baby ; c ; d ; 11501481 ;  ; A BPA-free feeding bottle with a slow-flow teat and a measuring scale.
Anti-dandruff shampoo 180 ml ; ${PERS} ; skin ; as ; o ; 13516802 ;  ; A zinc pyrithione shampoo for dandruff and an itchy scalp.
`;

interface Row {
  name: string;
  category: string;
  needs: string[];
  ages: string;
  form: Form;
  photo: string;
  extra: string[];
  use: string;
}

export const ROW_LIST: Row[] = ROWS.trim()
  .split("\n")
  .map((line) => {
    const [name, category, needs, ages, form, photo, extra, use] = line.split(" ; ").map((x) => x.trim());
    return { name: name!, category: category!, needs: needs!.split(","), ages: ages!, form: form as Form, photo: photo!, extra: extra ? extra.split(",") : [], use: use! };
  });

/** The price in paise, GST included, snapped to 50 paise when within a paisa of it (the profile's rate is rounded to the paisa, so 40.01 becomes 40.00). */
const priceOf = (e: CatalogueEntry) => {
  const exact = Math.round((e.rate * (100 + e.gstRate)) / 100);
  const snapped = Math.round(exact / 50) * 50;
  return Math.abs(exact - snapped) <= 1 ? snapped : exact;
};

const SCHEDULE_NOTE: Record<string, string> = {
  otc: "Sold without a prescription: read the label and use as directed.",
  H: "Schedule H: sold only against a valid prescription from a registered medical practitioner. Send us the prescription (WhatsApp or at the counter) and the pharmacist confirms the order before it is packed.",
  H1: "Schedule H1: sold only at our counter against a prescription, which we record in the H1 register. Not available to order online.",
};
const DEVICE_NOTE = "A home-check device is not a substitute for a doctor's examination: ask your doctor what your readings mean for you.";
const GENERAL_NOTE = "Do not exceed the stated dose. If symptoms last more than a few days or get worse, consult your doctor. Keep out of the reach of children.";
const FRIDGE_NOTE = "Insulin is kept in our fridge: collect it from the shop, or we deliver it in a cool bag in Salem the same day.";

const used = new Map<string, number>();
const photoFor = (key: string): number => {
  const pool = POOLS[key];
  if (!pool) return Number(key);
  const n = used.get(key) ?? 0;
  used.set(key, n + 1);
  return pool[n % pool.length]!;
};

const catalogue = new Map(PROFILES.pharmacy.catalogue.map((e) => [e.name, e]));

export const PRODUCTS: DemoProduct[] = ROW_LIST.map((row, i) => {
  const e = catalogue.get(row.name);
  if (!e) throw new Error(`thunai-products: "${row.name}" is not in the pharmacy profile`);
  const price = priceOf(e);
  const device = row.form === "d" && !["Salbutamol inhaler", "Budesonide + Formoterol inhaler"].includes(row.name);
  const sched = SCHEDULE_NOTE[e.schedule ?? "otc"] ?? SCHEDULE_NOTE.otc!;
  const composition = device ? `${e.composition}.` : `Contains: ${e.composition}.`;
  const description = [row.use, composition, device ? DEVICE_NOTE : sched, row.name === "Insulin glargine pen" ? FRIDGE_NOTE : "", device ? "" : GENERAL_NOTE].filter(Boolean).join(" ");
  const attributes: Record<string, string> = device
    ? { Type: e.composition ?? "", Maker: e.manufacturer ?? "", Warranty: "1 year (demo)" }
    : {
        Composition: e.composition ?? "",
        Maker: e.manufacturer ?? "",
        Pack: row.name.match(/\(([^)]+)\)/)?.[1] ?? `${e.packSize ?? 1} ${e.unit}`,
        Prescription: e.schedule === "H1" ? "Required, counter only (Schedule H1)" : e.schedule === "H" ? "Required (Schedule H)" : "Not required",
      };
  const tags = [...row.needs.map((n) => `n-${n}`), ...[...row.ages].map((a) => AGE_TAG[a]!), FORM_TAG[row.form], ...row.extra, ...(price < 10_000 && !row.extra.includes("under-100") ? ["under-100"] : [])];
  return {
    name: row.name,
    category: row.category,
    hsn: e.hsn,
    gstRate: e.gstRate,
    unit: e.unit,
    description,
    attributes,
    tags: [...new Set(tags)],
    sku: `TN${String(i + 1).padStart(3, "0")}`,
    photo: photoFor(row.photo),
    variants: [{ price, mrp: price, stock: 0 }],
    costShare: e.cost,
  };
});
