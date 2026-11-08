import type { DesignConfig } from "../core/types";
import { renderQrSvg } from "./designEngine";
import { blobToDataUrl, canvasToBlob, rasterize } from "./raster";

export interface PrintItem {
  content: string;
  design: DesignConfig;
  logoHref: string | null;
  label: string;
}

export interface PrintOptions {
  sizeMm: number;
  marginMm: number;
  gapMm: number;
  labels: boolean;
  paper: "a4" | "a5" | "letter";
  dir: "rtl" | "ltr";
  title: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Build a standalone printable document (images embedded as PNG data URLs). */
export async function buildPrintHtml(items: PrintItem[], o: PrintOptions): Promise<string> {
  const px = Math.max(500, Math.min(1600, Math.round((o.sizeMm / 25.4) * 240)));
  const imgs: string[] = [];
  for (const it of items) {
    const r = renderQrSvg(it.content, it.design, { logoHref: it.logoHref, transparent: false });
    const canvas = await rasterize(r.svg, px, (px * r.height) / r.width, "#ffffff");
    imgs.push(await blobToDataUrl(await canvasToBlob(canvas, "image/png")));
  }
  const cells = items
    .map(
      (it, i) =>
        `<figure><img src="${imgs[i]}" alt="QR">${o.labels ? `<figcaption>${esc(it.label)}</figcaption>` : ""}</figure>`,
    )
    .join("");
  const page = o.paper === "letter" ? "letter" : o.paper.toUpperCase();
  return `<!doctype html><html dir="${o.dir}"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>
@page{size:${page};margin:${o.marginMm}mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:system-ui,'Segoe UI',Tahoma,Arial,sans-serif}
.sheet{display:flex;flex-wrap:wrap;gap:${o.gapMm}mm;align-content:flex-start;padding:${o.marginMm}mm}
@media print{.sheet{padding:0}}
figure{margin:0;width:${o.sizeMm}mm;break-inside:avoid;page-break-inside:avoid;text-align:center}
img{width:${o.sizeMm}mm;height:auto;display:block;image-rendering:crisp-edges}
figcaption{font-size:9pt;margin-top:1.5mm;word-break:break-word}
</style></head><body><div class="sheet">${cells}</div></body></html>`;
}

/** Print an HTML document via a hidden iframe so no app UI is included. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    iframe.srcdoc = html;
    iframe.onload = () => {
      const w = iframe.contentWindow;
      if (!w) {
        iframe.remove();
        reject(new Error("PRINT_FAILED"));
        return;
      }
      setTimeout(() => {
        try {
          w.focus();
          w.print();
          resolve();
        } catch (e) {
          reject(e);
        }
        setTimeout(() => iframe.remove(), 60000);
      }, 150);
    };
    document.body.appendChild(iframe);
  });
}
