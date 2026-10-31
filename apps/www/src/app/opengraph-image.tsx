import { ImageResponse } from "next/og";

export const alt = "RBMS: billing and online store for your shop";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card (English only: the OG renderer has no Tamil font bundled). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(120deg, #312e81 0%, #6d28d9 55%, #f59e0b 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 700 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>S</div>
          RBMS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Billing and online store for your shop</div>
          <div style={{ fontSize: 32, opacity: 0.9 }}>GST bills · Credit book · WhatsApp · Online store — made for Tamil Nadu</div>
        </div>
        <div style={{ fontSize: 28, opacity: 0.85 }}>14-day free trial · No card needed</div>
      </div>
    ),
    size,
  );
}
