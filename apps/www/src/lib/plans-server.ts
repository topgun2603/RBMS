import { API_ORIGIN, APP_IDS, type AppId } from "./site";
import type { Plan } from "./plans";

/** One app's public plans for server pages (cached 5 minutes). Null when the API can't be reached. */
export async function fetchPlans(app: AppId): Promise<Plan[] | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/v1/plans?app=${encodeURIComponent(app)}`, { headers: { accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Plan[] };
    return Array.isArray(body.items) ? body.items : null;
  } catch {
    return null;
  }
}

/** Every app's public plans (for the sign-up wizard, which picks the app first). Apps that failed are left out; null when all did. */
export async function fetchPlansByApp(): Promise<Partial<Record<AppId, Plan[]>> | null> {
  const lists = await Promise.all(APP_IDS.map((app) => fetchPlans(app)));
  const out: Partial<Record<AppId, Plan[]>> = {};
  APP_IDS.forEach((app, i) => {
    const list = lists[i];
    if (list) out[app] = list;
  });
  return Object.keys(out).length ? out : null;
}
