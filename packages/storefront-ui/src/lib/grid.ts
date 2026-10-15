/** Product grid columns: 2 on phones, 3 on tablets, 4–5 on desktop (4 when a filter sidebar takes the space). */
export type GridLayout = "full" | "sidebar";

export const gridCols: Record<GridLayout, string> = {
  full: "grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  sidebar: "grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4",
};
