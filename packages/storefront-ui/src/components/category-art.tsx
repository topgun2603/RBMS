import * as React from "react";
import {
  BabyIcon,
  BackpackIcon,
  BandageIcon,
  BeefIcon,
  BicepsFlexedIcon,
  BookOpenIcon,
  BrickWallIcon,
  BrushIcon,
  CakeIcon,
  CakeSliceIcon,
  CameraIcon,
  CandyIcon,
  CarrotIcon,
  CoffeeIcon,
  CookingPotIcon,
  CroissantIcon,
  CrownIcon,
  CupSodaIcon,
  DrillIcon,
  DropletIcon,
  DropletsIcon,
  DrumstickIcon,
  DumbbellIcon,
  EggIcon,
  EyeIcon,
  FishIcon,
  FlameIcon,
  FlaskConicalIcon,
  FlowerIcon,
  FootprintsIcon,
  Gamepad2Icon,
  GemIcon,
  GiftIcon,
  GlassesIcon,
  HamburgerIcon,
  HammerIcon,
  HandIcon,
  HandPlatterIcon,
  HardHatIcon,
  HeadphonesIcon,
  HeartPulseIcon,
  IceCreamBowlIcon,
  IdCardIcon,
  LampIcon,
  LaptopIcon,
  LeafyGreenIcon,
  LightbulbIcon,
  LinkIcon,
  MicrowaveIcon,
  MilkIcon,
  NutIcon,
  PaintRollerIcon,
  PawPrintIcon,
  PillIcon,
  PizzaIcon,
  PlugZapIcon,
  PopcornIcon,
  PrinterIcon,
  RefrigeratorIcon,
  RulerIcon,
  ScanEyeIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoppingBagIcon,
  ShovelIcon,
  ShrimpIcon,
  SmartphoneIcon,
  SoapDispenserDropletIcon,
  SoupIcon,
  SpeakerIcon,
  SparklesIcon,
  SpoolIcon,
  SprayCanIcon,
  SproutIcon,
  StethoscopeIcon,
  SunIcon,
  TabletIcon,
  TagIcon,
  ThermometerSnowflakeIcon,
  TicketPercentIcon,
  ToyBrickIcon,
  TvIcon,
  UtensilsIcon,
  WalletIcon,
  WashingMachineIcon,
  WatchIcon,
  WheatIcon,
  WrenchIcon,
  ZapIcon,
  AppleIcon,
  ArmchairIcon,
  BathIcon,
  BikeIcon,
  BlocksIcon,
  DicesIcon,
  GraduationCapIcon,
  NotebookPenIcon,
  PaletteIcon,
  PaperclipIcon,
  PencilIcon,
  PenLineIcon,
  PuzzleIcon,
  RabbitIcon,
  VolleyballIcon,
  BedDoubleIcon,
  BirdIcon,
  BoneIcon,
  CatIcon,
  DogIcon,
  Flower2Icon,
  ImageIcon,
  PartyPopperIcon,
  RocketIcon,
  SofaIcon,
  TrophyIcon,
  type LucideProps,
} from "lucide-react";
import { cn } from "@rbms/ui/lib/utils";
import { imageUrl } from "../lib/format";
import { StoreImage } from "./bits";

/*
 * Category art: the category's photo, or — when a shop hasn't added one — a designed fallback instead of initials: an
 * icon picked from the category name/slug (`categoryIconKey`, keyword rules covering the trades we serve) on a brand
 * tint that rotates per tile (`tone`, six analogous shades of --primary, see styles.css `.sf-cat-art`), with a soft
 * halo + dot pattern. `bold` is the saturated version for tiles that carry white text on top.
 */

type Icon = React.ComponentType<LucideProps>;

/** Line glyphs lucide lacks (same 24px grid and stroke as lucide). */
const glyph = (name: string, body: React.ReactNode): Icon => {
  const G = ({ className, strokeWidth = 2, ...rest }: LucideProps) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} {...(rest as React.SVGProps<SVGSVGElement>)}>
      {body}
    </svg>
  );
  G.displayName = name;
  return G;
};
const SareeIcon = glyph(
  "SareeIcon",
  <>
    <circle cx="12" cy="4" r="2" />
    <path d="M9 8.5h6l2.5 12.5h-11z" />
    <path d="M15 8.5 8.2 14.5" />
    <path d="M7 18h10" />
  </>,
);
const DressIcon = glyph(
  "DressIcon",
  <>
    <path d="m9.5 2.5.5 3.5" />
    <path d="m14.5 2.5-.5 3.5" />
    <path d="M10 6h4l1 4H9z" />
    <path d="M9 10 5.5 21h13L15 10" />
  </>,
);
const TrousersIcon = glyph(
  "TrousersIcon",
  <>
    <path d="M7 3h10l1.5 18h-4.5L12 10l-2 11H5.5z" />
    <path d="M7 6h10" />
  </>,
);
const RingIcon = glyph(
  "RingIcon",
  <>
    <circle cx="12" cy="15" r="6" />
    <path d="M10 3h4l1.5 2.5L12 9 8.5 5.5z" />
  </>,
);
const NecklaceIcon = glyph(
  "NecklaceIcon",
  <>
    <path d="M5 3c0 5.5 3 9.5 7 9.5S19 8.5 19 3" />
    <path d="m12 12.5-2.5 3.5 2.5 4 2.5-4z" />
  </>,
);
const BangleIcon = glyph(
  "BangleIcon",
  <>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
    <ellipse cx="12" cy="12" rx="5.5" ry="3" />
  </>,
);
const EarringIcon = glyph(
  "EarringIcon",
  <>
    <circle cx="12" cy="3.5" r="1.5" />
    <path d="M12 5v3" />
    <path d="M12 8 8 15a4 4 0 0 0 8 0z" />
    <path d="M10 20.5h4" />
  </>,
);
// Footwear, toys and beauty glyphs (stores #7, #9 and #10 of the series).
const ShoeIcon = glyph(
  "ShoeIcon",
  <>
    <path d="M2.5 17.5v-5a1 1 0 0 1 1-1H5l2-4h3l1.2 2.6c2 1 4.6 1.6 7.3 2.1a3 3 0 0 1 2.5 3v2.3z" />
    <path d="M2.5 17.5V19h19v-1.5" />
    <path d="m9.2 10.8 1.6.9" />
    <path d="m8 13 1.6.9" />
  </>,
);
const HeelIcon = glyph(
  "HeelIcon",
  <>
    <path d="M4 6.5c2.5 0 4.5 2 7 5.5s5 4.5 8 5a2 2 0 0 1 2 2v.5h-9.5c-2 0-3.5-1.5-5-3.5" />
    <path d="M4 6.5V20h1.5v-6.5" />
  </>,
);
const SandalIcon = glyph(
  "SandalIcon",
  <>
    <path d="M12 2.5c3 0 5 2.5 5 6.5 0 3-1 5-1 8a4 4 0 0 1-8 0c0-3-1-5-1-8 0-4 2-6.5 5-6.5z" />
    <path d="M12 6.5 8.3 11" />
    <path d="m12 6.5 3.7 4.5" />
  </>,
);
const DollIcon = glyph(
  "DollIcon",
  <>
    <circle cx="12" cy="6" r="3" />
    <path d="M9 4.8c.8-2.4 5.2-2.4 6 0" />
    <path d="M10 10h4l3.5 10h-11z" />
    <path d="M10 12.5 7.5 15" />
    <path d="m14 12.5 2.5 2.5" />
  </>,
);
const LipstickIcon = glyph(
  "LipstickIcon",
  <>
    <path d="M8.5 21h7v-8h-7z" />
    <path d="M7.5 13h9" />
    <path d="M10 13V7.5L14 4v9" />
  </>,
);
const PerfumeIcon = glyph(
  "PerfumeIcon",
  <>
    <rect x="5" y="9" width="14" height="12" rx="3" />
    <path d="M10 9V6.5h4V9" />
    <path d="M9.5 6.5h5V3.5h-5z" />
    <circle cx="12" cy="15" r="2.5" />
  </>,
);
const CombIcon = glyph(
  "CombIcon",
  <>
    <rect x="3" y="6" width="18" height="4.5" rx="1.2" />
    <path d="M5 10.5V18M8 10.5V18M11 10.5V18M14 10.5V18M17 10.5V18M20 10.5V16" />
  </>,
);
const RazorIcon = glyph(
  "RazorIcon",
  <>
    <path d="M5.5 3.5h13v3h-13z" />
    <path d="M8 6.5V8h8V6.5" />
    <path d="M12 8v13" />
    <path d="M10.5 13h3" />
    <path d="M10.5 16.5h3" />
  </>,
);
/** An oil lamp (agal vilakku / diya) with its flame: pooja items, brass lamps, temple offerings. */
const DiyaIcon = glyph(
  "DiyaIcon",
  <>
    <path d="M3 14h18c-1 3.5-4.5 5.5-9 5.5S4 17.5 3 14z" />
    <path d="M19 14l2.5-2" />
    <path d="M12 3c1.8 2.2 2.2 4.4 0 6.5-2.2-2.1-1.8-4.3 0-6.5z" />
    <path d="M12 9.5V12" />
  </>,
);

export const CATEGORY_ICONS = {
  saree: SareeIcon,
  shirt: ShirtIcon,
  bottoms: TrousersIcon,
  dress: DressIcon,
  kids: ToyBrickIcon,
  baby: BabyIcon,
  watch: WatchIcon,
  footwear: FootprintsIcon,
  bag: ShoppingBagIcon,
  backpack: BackpackIcon,
  wallet: WalletIcon,
  phone: SmartphoneIcon,
  laptop: LaptopIcon,
  tablet: TabletIcon,
  tv: TvIcon,
  audio: HeadphonesIcon,
  speaker: SpeakerIcon,
  camera: CameraIcon,
  gaming: Gamepad2Icon,
  printer: PrinterIcon,
  fridge: RefrigeratorIcon,
  washer: WashingMachineIcon,
  kitchen: MicrowaveIcon,
  charger: PlugZapIcon,
  medicine: PillIcon,
  wellness: HeartPulseIcon,
  personal: SoapDispenserDropletIcon,
  device: StethoscopeIcon,
  firstAid: BandageIcon,
  starter: HandPlatterIcon,
  main: CookingPotIcon,
  meal: UtensilsIcon,
  rice: SoupIcon,
  bread: CroissantIcon,
  dessert: IceCreamBowlIcon,
  sweets: CandyIcon,
  coffee: CoffeeIcon,
  drink: CupSodaIcon,
  snack: PopcornIcon,
  pizza: PizzaIcon,
  burger: HamburgerIcon,
  vegetable: CarrotIcon,
  greens: LeafyGreenIcon,
  fruit: AppleIcon,
  dairy: MilkIcon,
  egg: EggIcon,
  staples: WheatIcon,
  oil: DropletIcon,
  spice: FlameIcon,
  chicken: DrumstickIcon,
  meat: BeefIcon,
  fish: FishIcon,
  prawn: ShrimpIcon,
  cake: CakeIcon,
  pastry: CakeSliceIcon,
  organic: SproutIcon,
  nuts: NutIcon,
  frozen: ThermometerSnowflakeIcon,
  cleaning: SprayCanIcon,
  ring: RingIcon,
  necklace: NecklaceIcon,
  bangle: BangleIcon,
  earring: EarringIcon,
  chain: LinkIcon,
  jewel: GemIcon,
  bridal: CrownIcon,
  hair: ScissorsIcon,
  skin: DropletsIcon,
  spa: FlowerIcon,
  makeup: BrushIcon,
  nails: HandIcon,
  gym: DumbbellIcon,
  training: BicepsFlexedIcon,
  membership: IdCardIcon,
  supplement: FlaskConicalIcon,
  tools: WrenchIcon,
  hammer: HammerIcon,
  drill: DrillIcon,
  paint: PaintRollerIcon,
  plumbing: DropletsIcon,
  electrical: ZapIcon,
  lighting: LightbulbIcon,
  cement: BrickWallIcon,
  safety: HardHatIcon,
  garden: ShovelIcon,
  frames: GlassesIcon,
  lenses: EyeIcon,
  sunglasses: SunIcon,
  eyeTest: ScanEyeIcon,
  tailoring: ScissorsIcon,
  blouse: SpoolIcon,
  alteration: RulerIcon,
  gift: GiftIcon,
  decor: LampIcon,
  furniture: ArmchairIcon,
  books: BookOpenIcon,
  toys: ToyBrickIcon,
  pets: PawPrintIcon,
  offers: TicketPercentIcon,
  newIn: SparklesIcon,
  tag: TagIcon,
  // footwear
  shoe: ShoeIcon,
  heels: HeelIcon,
  sandal: SandalIcon,
  // stationery
  notebook: NotebookPenIcon,
  pen: PenLineIcon,
  pencil: PencilIcon,
  office: PaperclipIcon,
  art: PaletteIcon,
  exam: GraduationCapIcon,
  // toys
  softToy: RabbitIcon,
  doll: DollIcon,
  puzzle: PuzzleIcon,
  boardGame: DicesIcon,
  blocks: BlocksIcon,
  rideOn: BikeIcon,
  outdoor: VolleyballIcon,
  // beauty
  lipstick: LipstickIcon,
  fragrance: PerfumeIcon,
  hairCare: CombIcon,
  grooming: RazorIcon,
  bathBody: BathIcon,
  // crackers, florist & pooja, furniture & décor, pets, sports
  crackers: PartyPopperIcon,
  rocket: RocketIcon,
  flowers: Flower2Icon,
  pooja: DiyaIcon,
  sofa: SofaIcon,
  bed: BedDoubleIcon,
  wallArt: ImageIcon,
  dog: DogIcon,
  cat: CatIcon,
  bird: BirdIcon,
  petTreat: BoneIcon,
  sport: VolleyballIcon,
  trophy: TrophyIcon,
} satisfies Record<string, Icon>;
export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

/*
 * Keyword rules, most specific first (baby care before personal care, sunglasses before glasses, earrings before
 * rings, biryani before rice). Each pattern is matched against "name slug-as-words", lower-cased; word starts are
 * anchored so "men" doesn't hit "women" and "ring" doesn't hit "earring".
 */
const RULES: [CategoryIconKey, RegExp][] = [
  // Tamil names (Tamil letters aren't regex word characters, so no \b): footwear, stationery, toys, beauty.
  ["heels", /ஹீல்/],
  ["sandal", /(செருப்பு|சப்பல்|ஸ்லிப்பர்)/],
  ["shoe", /ஷூ/],
  ["footwear", /காலணி/],
  ["notebook", /நோட்டு/],
  ["pen", /பேனா/],
  ["pencil", /பென்சில்/],
  ["art", /(ஓவிய|கைவினை)/],
  ["exam", /(தேர்வு|போட்டித் தேர்வு)/],
  ["office", /அலுவலக/],
  ["books", /(புத்தக|நூல்கள்|எழுதுபொருள்)/],
  ["softToy", /(மென் பொம்மை|டெடி)/],
  ["puzzle", /புதிர்/],
  ["toys", /பொம்மை/],
  ["boardGame", /(விளையாட்டு|தாயம்|பல்லாங்குழி|சதுரங்க)/],
  ["lipstick", /(லிப்ஸ்டிக்|உதட்டுச்சாய)/],
  ["fragrance", /(வாசனை|நறுமண|அத்தர்|பெர்ஃப்யூம்|சென்ட்)/],
  ["hairCare", /(கூந்தல்|தலைமுடி|ஷாம்பு)/],
  ["grooming", /(ஷேவிங்|தாடி|ஆண்கள் பராமரிப்பு)/],
  ["bathBody", /(குளியல்|சோப்பு)/],
  ["makeup", /(மேக்கப்|ஒப்பனை|அழகுசாதன|கண்மை)/],
  ["skin", /சரும/],
  // Tamil names: crackers, flowers & pooja, furniture, pets, sports, tea stall, spa.
  ["crackers", /(பட்டாசு|மத்தாப்பு|சரவெடி|புஸ்வாணம்|வாணவேடிக்கை)/],
  ["pooja", /(பூஜை|விளக்கு|தீபம்|கற்பூர|ஊதுபத்தி)/],
  ["flowers", /(பூக்கள்|உதிரிப் பூ|மல்லிகை|மாலைகள்|பூமாலை|சாமந்தி)/],
  ["sofa", /சோஃபா/],
  ["bed", /(கட்டில்|மெத்தை)/],
  ["furniture", /(ஃபர்னிச்சர்|மரச்சாமான்|அலமாரி|நாற்காலி|மேசை)/],
  ["dog", /நாய்/],
  ["cat", /பூனை/],
  ["bird", /பறவை/],
  ["pets", /செல்லப்பிராணி/],
  ["sport", /(கிரிக்கெட்|பேட்மிண்டன்|கால்பந்து|கைப்பந்து|டென்னிஸ்)/],
  ["coffee", /( டீ |தேநீர்|காபி)/],
  ["drink", /(ஜூஸ்|பழச்சாறு)/],
  ["spa", /(மசாஜ்|ஸ்பா)/],
  // Crackers, florist & pooja, pets, furniture & décor, sports, phone accessories and spa, before the jewellery,
  // optical and clothing rules they would otherwise fall into ("wedding garlands", "wall art & frames", "kids' crackers").
  ["rocket", /\b(rockets?\b|sky ?shots?|aerial (shots?|crackers?)|multi ?shots?)/],
  ["crackers", /\b((?<!(cream|cheese|rice|biscuits (&|and)) )crackers?\b|sparklers?|fire ?works?|pattasu|chakkars?|bijili|atom bombs?|mathappu|sara ?vedi)/],
  ["pooja", /\b(pooja|puja|temple (offerings?|items?|needs?)|deepam|diyas?\b|agarbatti|incense|camphor|kumkum|vilakku|brass\b(?! ?(fittings?|taps?|valves?|hinges?|screws?))|oil lamps?)/],
  ["flowers", /\b(flowers?\b(?! ?pots?)|garlands?|jasmine(?! rice)|malli\b|bouquets?|petals?|marigold|samanthi)/],
  ["petTreat", /\b(treats? (&|and) chews|chews?\b|(dog|pet) treats?)/],
  ["dog", /\b((?<!hot )dogs?\b|pupp(y|ies))/],
  ["cat", /\b(cats?\b|kittens?\b(?! heels))/],
  ["bird", /\b(birds?\b|bird ?seeds?|parrots?|budgies?)/],
  ["pets", /\b(pets?\b|leash(es)?|pet carriers?|beds? (&|and) carriers?|litter|aquariums?)/],
  ["sofa", /\b(sofas?|couch(es)?|recliners?|diwans?|divans?|settees?)/],
  ["bed", /\b(beds?\b(?! ?sheets?)|cots?\b|mattress(es)?|bunk)/],
  ["furniture", /\b(furniture|wardrobes?|almirah|cupboards?|dining (sets?|tables?)|office chairs?|study tables?|tv units?|shoe racks?|book ?shel(f|ves))/],
  ["wallArt", /\b(wall (art|d[eé]cor|hangings?)|paintings\b|photo frames?|frames? (&|and) art|art (&|and) frames?)/],
  ["art", /\b(handicrafts?|handmade crafts?|artefacts?|figurines?|terracotta|wood ?carv)/],
  ["trophy", /\b(troph(y|ies)|medals?|mementos?|team kits?)/],
  ["sport", /\b(cricket|badminton|shuttle ?cocks?|rackets?|racquets?|foot ?balls?|volley ?balls?|basket ?balls?|tennis|hockey|skating|kabaddi|sports (goods|equipment|gear))/],
  ["shirt", /\b(sports ?wear|jerseys?|track ?suits?|active ?wear|gym ?wear)/],
  ["phone", /\b(cases? (&|and) covers?|(phone|mobile) (cases?|covers?)|back covers?|screen (guards?|protectors?)|tempered glass|(car|bike|phone)( (&|and) (car|bike))? mounts?|phone holders?)/],
  ["spa", /\b(body (scrubs?|wraps?|polish)|(scrubs?|wraps?) (&|and) (scrubs?|wraps?)|reflexology|aromatherapy|steam ?(bath|room)|sauna|abhyang|shirodhara|couples? (packages?|massages?|spa))/],
  ["baby",/\b(bab(y|ies)|infant|diaper|toddler|newborn)/],
  ["sunglasses", /\b(sun ?glass|shades|goggle|aviator)/],
  ["lenses", /\b(lens|contacts?\b)/],
  ["eyeTest", /\b(eye ?(test|check)|optometr)/],
  ["frames", /\b(frames?\b|spectacle|eye ?glass|eyewear|optical|glasses|specs\b)/],
  ["earring", /\b(ear ?rings?|jhumk|studs?\b)/],
  ["necklace", /\b(necklace|haram|pendant|mangalsutra|choker|mala\b)/],
  ["bangle", /\b(bangle|bracelet|kada|valayal|anklet|kolusu)/],
  ["chain", /\b(chains?\b)/],
  ["ring", /\b(rings?\b|mothiram)/],
  ["jewel", /\b(jewel|silver|gold|diamond|platinum|gem|coins?\b)/],
  ["bridal", /\b(bridal|bride|wedding)/],
  ["blouse", /\b(blouse|stitching|embroider|aari)/],
  ["alteration", /\b(alter|measure|fitting)/],
  ["tailoring", /\b(tailor|uniform)/],
  ["saree", /\b(sarees?|sari\b|saris\b|silk|pattu|veshti|dhoti|handloom|cotton saree)/],
  // Toys before "kids" (kids' cycles are ride-ons), "games" before gaming (a toy shop's games are board games).
  ["softToy", /\b(soft toys?|plush|teddy|stuffed)/],
  ["doll", /\b(dolls?\b|doll ?houses?|barbie)/],
  ["puzzle", /\b(puzzles?|jigsaw|rubik)/],
  ["blocks", /\b(building blocks|stacking|lego|construction (toys?|sets?)|magnetic tiles)|^ blocks\b/],
  ["rideOn", /\b(ride-? ?ons?|tricycles?|bicycles?|cycles?\b|scooters?|kids? cars?|rocking horse)/],
  ["outdoor", /^ outdoor( outdoor)?\s*$|\boutdoor (toys?|play|games?)\b|\b(kites?|swings?|sand ?pit|water guns?)/],
  ["boardGame", /\b(board games?|card games?|carrom|chess|ludo|snakes (and|&) ladders)|^ games\b/],
  ["kids", /\b(kids?|child|junior)/],
  // Footwear by kind, then the general rule.
  ["heels", /\b(heels?\b|stilettos?|wedges)/],
  ["sandal", /\b(sandals?|chappals?|slippers?|flip ?flops?|seruppu|kolhapuri|floaters?)/],
  ["shoe", /\b(shoes?|sneakers?|boots?\b|loafers?|moccasins?|oxfords?|brogues?)/],
  ["footwear", /\b(foot ?wear|shoes?|sandals?|chappal|slippers?|heels|sneakers?|boots?\b)/],
  // Beauty before the clothing rules ("men's grooming", "women's fragrance") and personal care.
  ["lipstick", /\b(lip ?sticks?|lip (colou?rs?|gloss|liners?|tints?|balms?|care)|lips\b)/],
  ["fragrance", /\b(fragrances?|perfumes?|attars?|ittar|itr\b|deo(dorant)?s?\b|colognes?|body (mists?|sprays?)|scents?\b)/],
  ["hairCare", /\b(hair ?(care|oils?|masks?|serums?|colou?rs?|dyes?|packs?)|shampoos?|hair conditioners?|combs?\b|hair ?brush)/],
  ["grooming", /\b(grooming|shav(e|ing)|beard|razors?|trimmers?|after ?shave|moustache)/],
  ["bathBody", /\b(bath (&|and) body|body (care|lotions?|wash|butter)|shower gels?|bath salts?)/],
  ["skin", /\b(skin ?care|face ?wash|serums?|moisturi[sz]ers?|sunscreens?|cleansers?)/],
  ["makeup", /\b(kajal|kohl|eye ?liners?|mascara|concealers?|make ?up brush|beauty (tools|accessories))/],
  ["bottoms", /\b(bottoms?|jeans|trousers?|pants?\b|leggings?|palazzo|skirts?|shorts|track ?pants|chinos)/],
  ["dress", /\b(dress|gown|lehenga|frock|anarkali|ethnic|women|ladies|girls?\b)/],
  ["shirt", /\b(shirts?|t-?shirts?|tees?\b|tops?\b|kurti|kurta|salwar|churidar|polo|men\b|mens\b|gents|boys?\b|apparel|clothing|wear\b|western)/],
  // Stationery before electronics ("notebooks" are exercise books here) and the general books rule.
  ["exam", /\b(exams?\b|competitive|question ?banks?|guides? (books?|for)|text ?books?|tnpsc|neet\b|jee\b|upsc)/],
  ["notebook", /\b(note ?books?|exercise books?|long ?books?|diar(y|ies)|journals?|registers?\b|copy ?books?|note ?pads?)/],
  ["backpack", /\bschool (supplies|essentials|kits?|stationery)|geometry box|lunch ?box|pencil ?box/],
  ["pencil", /\b(pencils?|crayons?|erasers?|sharpeners?|sketch ?pens?)/],
  ["pen", /\b(pens?\b|ball ?points?|gel pens?|fountain pens?|markers?|highlighters?|refills?)/],
  ["office", /\b(office (supplies|stationery|essentials)|files?\b|folders?|staplers?|paper ?clips?|filing|envelopes?)/],
  ["art", /\b(arts?\b|crafts?|drawing|sketch(ing| ?books?)|canvas|origami|colou?ring)/],
  ["backpack", /\b(backpack|school bag)/],
  ["wallet", /\b(wallet|purse)/],
  ["bag", /\b(bags?\b|handbag|luggage|clutch)/],
  ["watch", /\b(watch|smart ?watch)/],
  ["charger", /\b(charger|cables?|power ?bank|adapter|plug)/],
  ["phone", /\b(mobiles?|phones?|smartphone|iphone|android)/],
  ["laptop", /\b(laptop|computer|notebook|desktop|pc\b|macbook)/],
  ["tablet", /\b(ipad)/],
  ["tv", /\b(tvs?\b|television|monitor|led tv|smart tv)/],
  ["speaker", /\b(speaker|soundbar|home theat)/],
  ["audio", /\b(audio|headphone|earphone|ear ?buds|headset|music)/],
  ["camera", /\b(camera|cctv|dslr)/],
  ["gaming", /\b(gaming|games?\b|console|playstation|xbox)/],
  ["printer", /\b(printer|ink|toner)/],
  ["watch", /\baccessor/],
  ["washer", /\b(washing|washer|dryer)/],
  ["fridge", /\b(fridge|refrigerator|freezer|appliance|air ?condition|\bac\b)/],
  ["kitchen", /\b(kitchen|mixer|grinder|microwave|oven|cooker)/],
  ["device", /\b(devices?|bp\b|glucometer|thermometer|nebuli|oximeter|medical equip)/],
  ["firstAid", /\b(first ?aid|bandage|ortho)/],
  ["personal", /\b(personal|hygiene|soap|shampoo|toiletr|oral|tooth|deo)/],
  ["supplement", /\b(supplement|protein|whey|creatine|pre-?workout)/],
  ["medicine", /\b(medicine|tablets?|capsule|syrup|pharma|rx\b|prescription|generic|drugs?\b|ointment)/],
  ["wellness", /\b(wellness|vitamin|ayurved|health|immunity|herbal|siddha)/],
  ["membership", /\b(membership|plans?\b|pass(es)?\b|subscription)/],
  ["training", /\b(personal training|trainer|coaching|crossfit|strength)/],
  ["gym", /\b(gym|workout|fitness|cardio|yoga|zumba|exercise)/],
  ["hair", /\b(hair|cut\b|haircut|beard|groom|shave|barber)/],
  ["nails", /\b(nails?|manicure|pedicure)/],
  ["makeup", /\b(make ?up|cosmetic|lipstick|mehendi|mehndi|beauty)/],
  ["skin", /\b(skin|facial|cleanup|wax|threading|glow)/],
  ["spa", /\b(spa\b|massage|therapy|relax)/],
  ["rice", /\b(biryani|pulao|fried rice|rice bowl|noodles|chinese)/],
  ["starter", /\b(starters?|appeti[sz]er|tikka|kebab|tandoor|chaat)/],
  ["meal", /\b(meals?\b|thali|combo|lunch|dinner|tiffin|breakfast|south indian|north indian)/],
  ["main", /\b(main|curry|curries|gravy|course)/],
  ["pizza", /\b(pizza|pasta|italian)/],
  ["burger", /\b(burger|sandwich|wrap|rolls?\b)/],
  ["bread", /\b(breads?|roti|naan|paratha|chapat|parotta|bun|bakery)/],
  ["cake", /\b(cakes?\b|cupcake|birthday)/],
  ["pastry", /\b(pastr|brownie|muffin|cookie)/],
  ["sweets", /\b(sweets?|mithai|halwa|laddu|chocolate|candy)/],
  ["dessert", /\b(dessert|ice ?cream|kulfi|falooda|pudding)/],
  ["coffee", /\b(coffee|tea\b|chai)/],
  ["drink", /\b(beverage|drinks?|juice|shake|lassi|soda|mocktail|water)/],
  ["snack", /\b(snacks?|chips|namkeen|savour|murukku|mixture|bites)/],
  ["meat", /\bnon-?veg/],
  ["greens", /\b(greens|leafy|keerai|herbs?\b)/],
  ["vegetable", /\b(vegetables?|veggies?|veg\b|sabzi|kaai)/],
  ["fruit", /\b(fruits?|apple|banana|mango)/],
  ["dairy", /\b(dairy|milk|curd|paneer|ghee|butter|cheese|yog(h)?urt)/],
  ["egg", /\b(eggs?\b)/],
  ["oil", /\b(oils?\b)/],
  ["spice", /\b(spice|masala|chilli|pepper|condiment|pooja)/],
  ["nuts", /\b(dry ?fruit|nuts?\b|cashew|almond)/],
  ["organic", /\b(organic|millet|natural)/],
  ["staples", /\b(staples?|atta|flour|rice|dal\b|dhal|pulses|grains?|grocery|provision)/],
  ["chicken", /\b(chicken|poultry|wings)/],
  ["prawn", /\b(prawns?|shrimps?|crab)/],
  ["fish", /\b(fish|seafood|meen)/],
  ["meat", /\b(meat|mutton|lamb|beef|pork|non-?veg)/],
  ["frozen", /\b(frozen|ice\b)/],
  ["cleaning", /\b(clean|detergent|household|home care)/],
  ["paint", /\b(paint|primer|putty|colou?rs?\b)/],
  ["plumbing", /\b(plumb|pipes?|taps?\b|sanitary|bath|fittings)/],
  ["lighting", /\b(light|bulb|lamp\b|led\b)/],
  ["electrical", /\b(electric|wires?|switch|cables?|fans?\b)/],
  ["cement", /\b(cement|building|construct|bricks?|steel|tiles?\b|sand\b)/],
  ["drill", /\b(power tools?|drill)/],
  ["hammer", /\b(hand tools?|hammer|hardware)/],
  ["tools", /\b(tools?|spanner|wrench|repair|service)/],
  ["safety", /\b(safety|helmet|gloves)/],
  ["garden", /\b(garden|plants?|seeds?|pots?\b)/],
  ["gift", /\b(gifts?|hamper|combo)/],
  ["furniture", /\b(furniture|sofa|chairs?|tables?\b)/],
  ["decor", /\b(home|decor|living)/],
  ["books", /\b(books?|stationery|pens?\b|school)/],
  ["toys", /\b(toys?|puzzle)/],
  ["pets", /\b(pets?|dog|cat\b)/],
  ["offers", /\b(offers?|sale|deals?|discount|clearance)/],
  ["newIn", /\b(new|arrival|latest|trending|featured|best ?sell)/],
];

/** The icon for a category, from its name and slug ("tag" when nothing matches). Pure: same input, same icon. */
export function categoryIconKey(name: string, slug = ""): CategoryIconKey {
  const text = ` ${name} ${slug.replace(/[-_]+/g, " ")} `.toLowerCase();
  for (const [key, re] of RULES) if (re.test(text)) return key;
  return "tag";
}

/** How many brand tints the fallback rotates through (styles.css `.sf-cat-art[data-tone]`). */
export const CATEGORY_TONES = 6;

/**
 * A category's picture (object-cover), or the icon fallback. Fills its box (give the parent a size / aspect ratio).
 * `alt` "" = decorative (the name is printed next to it).
 */
export function CategoryArt({
  name,
  slug,
  image,
  tone = 0,
  bold,
  compact,
  alt = "",
  eager,
  sizes,
  className,
  imageClassName,
}: {
  name: string;
  slug?: string;
  image: string | null | undefined;
  tone?: number;
  bold?: boolean;
  /** Small chips: a flat tint and a bigger icon. */
  compact?: boolean;
  alt?: string;
  eager?: boolean;
  sizes?: string;
  className?: string;
  /** Extra classes for the photo only (hover zoom). */
  imageClassName?: string;
}) {
  if (imageUrl(image)) return <StoreImage src={image} alt={alt} name={name} eager={eager} sizes={sizes} className={cn(className, imageClassName)} />;
  const key = categoryIconKey(name, slug);
  const Icon = CATEGORY_ICONS[key];
  return (
    <span
      {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
      data-tone={((tone % CATEGORY_TONES) + CATEGORY_TONES) % CATEGORY_TONES}
      data-bold={bold ? "" : undefined}
      data-compact={compact ? "" : undefined}
      data-cat-icon={key}
      className={cn("sf-cat-art", className)}
    >
      <Icon className="sf-cat-art-icon" strokeWidth={1.6} aria-hidden />
    </span>
  );
}
