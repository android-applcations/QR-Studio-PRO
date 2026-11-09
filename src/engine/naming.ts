/**
 * File names for anything the app writes to disk.
 *
 * Kept apart from the export engine on purpose: the render worker needs the
 * same names for the files inside a ZIP archive, and importing the engine there
 * would drag the whole main-thread export path into the worker's bundle.
 */

/** Turns arbitrary text into something every filesystem accepts. */
export function sanitizeFilename(name: string, fallback = "qr-code"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** `qr-batch-20261108-1430` — sorts nicely, says when it was made. */
export function timestampName(prefix: string): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${sanitizeFilename(prefix, "qr")}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
