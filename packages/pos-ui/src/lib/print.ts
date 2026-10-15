"use client";

/**
 * Prints a PDF without leaving the counter: loads it into a hidden iframe and calls the frame's print(). Works in
 * Chromium browsers (the usual counter PC); rejects when the browser can't print a PDF frame, so the caller can
 * fall back to the in-page 80 mm receipt (`window.print()` with the receipt print CSS).
 */
export function printPdfBlob(blob: Blob, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0" });
    let done = false;
    const cleanup = () => window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      frame.remove();
      URL.revokeObjectURL(url);
      reject(new Error("print_timeout"));
    }, timeoutMs);
    frame.onload = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("no_frame");
        win.focus();
        win.print();
        cleanup();
        resolve();
      } catch (err) {
        frame.remove();
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error("print_failed"));
      }
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

/** Prints the page with only the `[data-pos-print]` receipt visible (80 mm print CSS in ReceiptPrintStyles). */
export function printReceiptInPage() {
  document.documentElement.dataset.posPrinting = "true";
  const off = () => {
    delete document.documentElement.dataset.posPrinting;
    window.removeEventListener("afterprint", off);
  };
  window.addEventListener("afterprint", off);
  window.print();
  window.setTimeout(off, 2000);
}
