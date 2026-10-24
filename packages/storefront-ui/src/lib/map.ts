export type MapPin = { lat: number; lng: number };

/** OpenStreetMap embed URL for a pin (a ~1.3 km box around it, with the marker), or null for an invalid pin. */
export function osmEmbedUrl(pin: MapPin | null | undefined, delta = 0.006): string | null {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng) || Math.abs(pin.lat) > 90 || Math.abs(pin.lng) > 180) return null;
  const f = (n: number) => String(Number(n.toFixed(6)));
  const box = [pin.lng - delta, pin.lat - delta, pin.lng + delta, pin.lat + delta].map(f).join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${f(pin.lat)}%2C${f(pin.lng)}`;
}
