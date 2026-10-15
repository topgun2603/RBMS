"use client";

import * as React from "react";

/** Moves the element at `from` to `to` (returns a new array). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
}

/**
 * Drag-to-reorder for a flat list with the native drag-and-drop API (mouse and pen). Touch and keyboard users get the
 * same result through `move(index, ±1)` buttons, which every sortable list in this module renders as well.
 */
export function useDragSort<T>(items: readonly T[], getId: (item: T) => string, onReorder: (next: T[]) => void) {
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const indexOf = React.useCallback((id: string) => items.findIndex((it) => getId(it) === id), [items, getId]);

  const move = React.useCallback(
    (index: number, delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= items.length) return;
      onReorder(moveItem(items, index, to));
    },
    [items, onReorder],
  );

  const itemProps = React.useCallback(
    (id: string) => ({
      draggable: true,
      "data-dragging": dragId === id || undefined,
      "data-over": overId === id && dragId !== id ? true : undefined,
      onDragStart: (e: React.DragEvent) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = "move";
        // Firefox needs data to start a drag.
        e.dataTransfer.setData("text/plain", id);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (overId !== id) setOverId(id);
      },
      onDragLeave: () => {
        if (overId === id) setOverId(null);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragId && dragId !== id) {
          const from = indexOf(dragId);
          const to = indexOf(id);
          if (from >= 0 && to >= 0) onReorder(moveItem(items, from, to));
        }
        setDragId(null);
        setOverId(null);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverId(null);
      },
    }),
    [dragId, overId, indexOf, items, onReorder],
  );

  return { itemProps, move, dragging: dragId };
}
