# srikit_theme

`BrandTokens` (the `tokens` of GET /v1/branding) and `SrikitTheme.light/dark(tokens)` → Material 3 `ThemeData`.

- `ColorScheme.fromSeed(primary)`, then the brand's exact primary / secondary / accent (tertiary) with readable
  on-colours (the same near-black / white contrast rule as `readableForeground` in packages/branding).
- `background` / `foreground` apply to the scheme whose brightness they match (a dark background → dark scheme).
- `radius` is in rem (1rem = 16 logical px) and shapes cards, buttons, inputs, dialogs and sheets.
- `fontSans` / `fontHeading` are set as font families. Fonts are not bundled yet: an unknown family falls back to the
  platform font (Roboto / SF). Bundle Inter (or use google_fonts) when the design calls for it.

`lib/src/srikit_defaults.dart` is generated: `node scripts/mobile/gen-theme.mjs` (from the repo root).
