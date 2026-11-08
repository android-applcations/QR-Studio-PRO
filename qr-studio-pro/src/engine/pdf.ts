/** Minimal PDF writer: pages containing JPEG images. No external dependencies. */

export interface PdfImage {
  jpeg: Uint8Array;
  pxW: number;
  pxH: number;
  /** position from the top-left in points */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPage {
  w: number;
  h: number;
  images: PdfImage[];
}

export const PAPER = {
  a4: { w: 595.28, h: 841.89 },
  a5: { w: 419.53, h: 595.28 },
  letter: { w: 612, h: 792 },
} as const;

export const mmToPt = (mm: number) => (mm / 25.4) * 72;

const enc = new TextEncoder();
const f = (v: number) => (Math.round(v * 100) / 100).toString();

function concat(parts: (Uint8Array | string)[]): Uint8Array {
  const arrs = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export function buildPdf(pages: PdfPage[], title = "QR Studio Pro"): Blob {
  const objs: Uint8Array[] = [];
  const reserve = () => {
    objs.push(new Uint8Array());
    return objs.length; // object number
  };
  const set = (num: number, data: Uint8Array | string) => {
    objs[num - 1] = concat([`${num} 0 obj\n`, data, "\nendobj\n"]);
  };

  const catalog = reserve();
  const pagesObj = reserve();
  const kids: number[] = [];

  for (const page of pages) {
    const pageNum = reserve();
    const contentNum = reserve();
    kids.push(pageNum);
    const xobjs: string[] = [];
    let content = "";
    page.images.forEach((img, i) => {
      const imgNum = reserve();
      set(
        imgNum,
        concat([
          `<< /Type /XObject /Subtype /Image /Width ${img.pxW} /Height ${img.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
          img.jpeg,
          "\nendstream",
        ]),
      );
      xobjs.push(`/Im${i} ${imgNum} 0 R`);
      const yPdf = page.h - img.y - img.h;
      content += `q ${f(img.w)} 0 0 ${f(img.h)} ${f(img.x)} ${f(yPdf)} cm /Im${i} Do Q\n`;
    });
    set(contentNum, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
    set(
      pageNum,
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(page.w)} ${f(page.h)}] /Resources << /XObject << ${xobjs.join(" ")} >> >> /Contents ${contentNum} 0 R >>`,
    );
  }
  const info = reserve();
  const safeTitle = title.replace(/[^\x20-\x7E]/g, "").replace(/[()\\]/g, "");
  set(info, `<< /Title (${safeTitle}) /Producer (QR Studio Pro) >>`);
  set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  set(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);

  const header = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const chunks: (Uint8Array | string)[] = [header];
  let offset = enc.encode(header).length;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(offset);
    chunks.push(o);
    offset += o.length;
  }
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF`;
  chunks.push(xref);
  return new Blob([concat(chunks) as BlobPart], { type: "application/pdf" });
}
