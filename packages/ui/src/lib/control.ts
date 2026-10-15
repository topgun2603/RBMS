/**
 * The one height scale every form control shares (Input, SelectTrigger, Button, ToggleGroup items, ColorInput,
 * InputGroup, picker/combobox triggers). Controls placed side by side line up as long as they use the same size;
 * don't override heights with ad-hoc `h-*` classes — pick a size instead.
 *
 *   sm      36px  dense rows: table cells, inline editors, toolbars
 *   default 40px  forms, filter bars, dialogs
 *   lg      44px  touch-first / hero forms (storefront checkout, sign-in)
 */
export const CONTROL_HEIGHT = { sm: "h-9", default: "h-10", lg: "h-11" } as const;

/** Square controls (icon buttons) on the same scale. */
export const CONTROL_SQUARE = { sm: "size-9", default: "size-10", lg: "size-11" } as const;

export type ControlSize = keyof typeof CONTROL_HEIGHT;

/** Height class for a control size ("h-10" for default). */
export function controlHeight(size: ControlSize | null | undefined = "default"): string {
  return CONTROL_HEIGHT[size ?? "default"];
}
