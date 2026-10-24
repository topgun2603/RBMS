import { MURUGAN } from "./murugan";
import { PORUNAI } from "./porunai";
import { CAUVERY } from "./cauvery";
import { VAYAL } from "./vayal";
import { THARI } from "./thari";
import { ARASAN } from "./arasan";
import { AZHAGU } from "./azhagu";
import { PADHAM } from "./padham";
import { EZHUTHAANI } from "./ezhuthaani";
import { PAMBARAM } from "./pambaram";
import { THIRUVIZHA } from "./thiruvizha";
import { MALLIGAI } from "./malligai";
import { KAIPESI } from "./kaipesi";
import { MARAM } from "./maram";
import { KALAIYAGAM } from "./kalaiyagam";
import { SELLAM } from "./sellam";
import { MAIDHANAM } from "./maidhanam";
import { VAASAM } from "./vaasam";
import { QUICKFIX } from "./quickfix";
import { TECHZONE } from "./techzone";
import { THENEER } from "./theneer";
import { SPA } from "./spa";
import { ARUSUVAI } from "./arusuvai";
import { THAIYAL } from "./thaiyal";
import { THUNAI } from "./thunai";
import type { DemoStore } from "./types";

/**
 * The demo stores of the "20+ stores" series, one look each (docs/verticals.md, "How to add a new store look + demo
 * shop"). Seeded by `pnpm seed` (after the demo shops) and on their own by `pnpm seed:stores [slug…]`.
 */
export const DEMO_STORES: DemoStore[] = [MURUGAN, PORUNAI, CAUVERY, VAYAL, THARI, ARASAN, AZHAGU, PADHAM, EZHUTHAANI, PAMBARAM, THIRUVIZHA, MALLIGAI, KAIPESI, MARAM, KALAIYAGAM, SELLAM, MAIDHANAM, VAASAM, QUICKFIX, TECHZONE, THENEER, THAIYAL, SPA, THUNAI, ARUSUVAI];

export { seedDemoStore } from "./seed-demo-store";
export type { DemoStore } from "./types";
