import { API_ORIGIN } from "./site";
import type { Plan } from "./plans";

/** Public plans for server pages (cached 5 minutes). Null when the API can't be reached. */
export async function fetchPlans(): Promise<Plan[] | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/v1/plans`, { headers: { accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Plan[] };
    return Array.isArray(body.items) ? body.items : null;
  } catch {
    return null;
  }
}
