/** Product grid columns: 2 on phones, 3 on tablets, 4–5 on desktop (4 when a filter sidebar takes the space). */
export type GridLayout = "full" | "sidebar";
/** Desktop columns a listing asks for (theme `listingColumns`). */
export type GridColumns = "2" | "3" | "4" | "5";

export const gridCols: Record<GridLayout, string> = {
  full: "grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  sidebar: "grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4",
};

const GAPS = "grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5";
/**
 * Columns per desktop choice, with or without a filter sidebar beside the grid. Phones always show two; tablets step
 * up so a five-column choice never squeezes tiles on a laptop next to the sidebar. Literal class names (Tailwind).
 */
export const listingCols: Record<GridLayout, Record<GridColumns, string>> = {
  sidebar: {
    "2": `${GAPS} lg:gap-x-6`,
    "3": `${GAPS} md:grid-cols-3`,
    "4": `${GAPS} md:grid-cols-3 xl:grid-cols-4`,
    "5": `${GAPS} md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5`,
  },
  full: {
    "2": `${GAPS} lg:gap-x-8`,
    "3": `${GAPS} md:grid-cols-3`,
    "4": `${GAPS} md:grid-cols-3 lg:grid-cols-4`,
    "5": `${GAPS} md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`,
  },
};

/** The grid classes for a layout and (optionally) a desktop column choice. */
export const gridClass = (layout: GridLayout, columns?: GridColumns) => (columns ? listingCols[layout][columns] : gridCols[layout]);

/** List view: one row per product; two side by side on wide screens without a sidebar. */
export const listClass = (layout: GridLayout) => (layout === "full" ? "grid-cols-1 gap-3 lg:grid-cols-2" : "grid-cols-1 gap-3 2xl:grid-cols-2");
