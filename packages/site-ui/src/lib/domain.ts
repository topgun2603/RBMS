/** "https://Shop.Example.in/abc" → "shop.example.in"; null when it isn't a plausible domain. */
export function normalizeDomain(input: string): string | null {
  const v = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (v.length < 4 || v.length > 253) return null;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) ? v : null;
}
