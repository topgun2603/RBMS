import type { AiFeatureInfo } from "../features";

/** Registry entries of Phase 5 part B, money. Spread into AI_FEATURE_REGISTRY (features.ts). */
export const MONEY_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: "credit-risk",
    status: "live",
    tier: "light",
    requires: ["invoices.credit-book"],
    label: "Credit risk score for credit customers",
    labelTa: "கடன் வாடிக்கையாளர்களுக்கான அபாய மதிப்பெண்",
    description:
      "Gives each credit customer a band A to D and a score from 0 to 100, worked out only from their own payment record with your shop: how often they pay on time, what is overdue, how much of the limit they use and whether their dues are growing. Shows the top reasons in plain words and a suggested credit limit, in the credit book and on the customer page, and a hint on the bill when you pick a D customer. It never blocks a sale. It does not use or guess a name, community, gender, place or any personal detail. The score is free (no credits); the one-line explanation, if you ask for it, uses about 1 credit.",
    descriptionTa:
      "ஒவ்வொரு கடன் வாடிக்கையாளருக்கும் A முதல் D வரை தரமும் 0 முதல் 100 வரை மதிப்பெண்ணும் தரும். அவர்களுடனான உங்கள் கடையின் சொந்த பணம் செலுத்தும் பதிவிலிருந்து மட்டுமே கணக்கிடப்படும்: எவ்வளவு முறை சரியான நேரத்தில் செலுத்துகிறார்கள், நிலுவை என்ன, வரம்பில் எவ்வளவு பயன்படுத்துகிறார்கள், நிலுவை கூடுகிறதா. முக்கிய காரணங்களை எளிய சொற்களில் காட்டும், கடன் வரம்பையும் பரிந்துரைக்கும்; கடன் கணக்கு, வாடிக்கையாளர் பக்கம், D வாடிக்கையாளரைத் தேர்ந்தெடுக்கும்போது பில்லில் குறிப்பு. விற்பனையைத் தடுக்காது. பெயர், சமூகம், பாலினம், இடம் அல்லது எந்த தனிப்பட்ட விவரத்தையும் பயன்படுத்தாது, ஊகிக்காது. மதிப்பெண் இலவசம்; ஒரு வரி விளக்கம் கேட்டால் சுமார் 1 கிரெடிட்.",
  },
  {
    key: "cashflow-forecast",
    status: "live",
    tier: "light",
    label: "Cash-flow forecast (next 30 days)",
    labelTa: "பணப்புழக்க முன்கணிப்பு (அடுத்த 30 நாள்)",
    description:
      "Shows day by day how much money to expect over the next 30 days: counter sales by weekday (with a festival lift when last year showed one), dues customers are likely to pay, supplier bills, monthly expenses such as rent and salary, and open purchase orders. Warns when the balance may fall below a level you set, with the date and the main reason. You can move two sliders (sales and collections) and watch the curve change. All numbers are worked out in code; the short plain-language note and two suggestions use about 2 credits (a template is used if AI is off).",
    descriptionTa:
      "அடுத்த 30 நாளில் நாளுக்கு நாள் எவ்வளவு பணம் வரும், போகும் என்று காட்டும்: கிழமைவாரி கவுண்டர் விற்பனை (கடந்த ஆண்டு உயர்வு காட்டியிருந்தால் பண்டிகை உயர்வுடன்), வாடிக்கையாளர்கள் செலுத்த வாய்ப்புள்ள நிலுவை, சப்ளையர் பில்கள், வாடகை, சம்பளம் போன்ற மாதாந்திர செலவுகள், திறந்துள்ள கொள்முதல் ஆர்டர்கள். நீங்கள் அமைத்த அளவுக்குக் கீழே இருப்பு குறையக்கூடும் என்றால் தேதி, முக்கிய காரணத்துடன் எச்சரிக்கும். இரண்டு ஸ்லைடர்களை (விற்பனை, வசூல்) நகர்த்தி வளைவு மாறுவதைப் பார்க்கலாம். எல்லா எண்களும் குறியீட்டில் கணக்கிடப்படுகின்றன; எளிய மொழிக் குறிப்பும் இரண்டு பரிந்துரைகளும் சுமார் 2 கிரெடிட் (AI அணைந்திருந்தால் வார்ப்புரு).",
  },
  {
    key: "loan-pack",
    status: "live",
    tier: "light",
    label: "Loan readiness pack",
    labelTa: "கடன் விண்ணப்பத் தயார்நிலை தொகுப்பு",
    description:
      "Prepares a printable summary of your last 12 months for a bank or finance company: sales by month, GST by month, margin trend, share of your top customers (names hidden unless you choose), receivables and payables, stock value and an estimated average balance. You see exactly what is included and agree before it is made. Only you (owner or admin) can make it. Nothing is ever sent to a lender: you print it or share an expiring link yourself. It is a summary of your records, not a credit decision. The neutral cover note uses about 2 credits (a template is used if AI is off).",
    descriptionTa:
      "வங்கி அல்லது நிதி நிறுவனத்துக்காக உங்கள் கடந்த 12 மாதங்களின் அச்சிடக்கூடிய சுருக்கத்தைத் தயாரிக்கும்: மாதவாரி விற்பனை, மாதவாரி GST, லாப விகித போக்கு, முன்னணி வாடிக்கையாளர்களின் பங்கு (நீங்கள் தேர்வு செய்யாவிட்டால் பெயர்கள் மறைக்கப்படும்), வர வேண்டியவை, செலுத்த வேண்டியவை, இருப்பு மதிப்பு, மதிப்பிடப்பட்ட சராசரி இருப்பு. தொகுப்பு உருவாகும் முன் என்ன சேர்க்கப்படுகிறது என்பதைச் சரியாகப் பார்த்து ஒப்புக்கொள்வீர்கள். உரிமையாளர் அல்லது நிர்வாகி மட்டுமே உருவாக்க முடியும். கடன் வழங்குநருக்கு எதுவும் தானாக அனுப்பப்படாது: நீங்களே அச்சிடுவீர்கள் அல்லது காலாவதியாகும் இணைப்பைப் பகிர்வீர்கள். இது உங்கள் பதிவுகளின் சுருக்கம், கடன் முடிவு அல்ல. நடுநிலையான முன்னுரைக் குறிப்பு சுமார் 2 கிரெடிட் (AI அணைந்திருந்தால் வார்ப்புரு).",
  },
  {
    key: "gst-2b-explain",
    status: "live",
    tier: "light",
    requires: ["invoices.gst-reports"],
    label: "Explain GSTR-2B mismatches",
    labelTa: "GSTR-2B வேறுபாடுகளின் விளக்கம்",
    description:
      "On Reports > GST > GSTR-2B, after you import the portal file, explains each group of mismatches in plain words: bills in your books but not in 2B (supplier may not have filed, different GSTIN or number, month-end timing), bills in 2B but not in your books, and amount differences (rounding, credit notes). Written only from the comparison your software already did; it gives reasons to check, never a verdict on your return (about 2 credits).",
    descriptionTa:
      "அறிக்கைகள் > GST > GSTR-2B-இல், போர்ட்டல் கோப்பை இறக்குமதி செய்த பின், ஒவ்வொரு வேறுபாட்டுக் குழுவையும் எளிய சொற்களில் விளக்கும்: உங்கள் கணக்கில் உள்ளது ஆனால் 2B-இல் இல்லாதவை (சப்ளையர் தாக்கல் செய்யாமல் இருக்கலாம், வேறு GSTIN அல்லது எண், மாத இறுதி நேரம்), 2B-இல் உள்ளது ஆனால் உங்கள் கணக்கில் இல்லாதவை, தொகை வேறுபாடுகள் (ரவுண்டிங், கிரெடிட் நோட்). உங்கள் மென்பொருள் ஏற்கனவே செய்த ஒப்பீட்டிலிருந்து மட்டுமே எழுதப்படும்; சரிபார்க்க வேண்டிய காரணங்களைத் தரும், உங்கள் ரிட்டர்ன் பற்றி தீர்ப்பு சொல்லாது (சுமார் 2 கிரெடிட்).",
  },
];
