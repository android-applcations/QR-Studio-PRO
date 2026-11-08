import type { Lang, Tx } from "./types";

export const pick = (lang: Lang, tx: Tx): string => tx[lang === "ar" ? 1 : 0];

/** Common shared strings. Screen-specific strings are defined inline as [en, ar] tuples. */
export const T = {
  appName: ["QR Studio Pro", "QR Studio Pro"],
  create: ["Create", "إنشاء"],
  design: ["Design", "تصميم"],
  scan: ["Scan", "قراءة"],
  library: ["My codes", "رموزي"],
  history: ["History", "السجل"],
  templates: ["Templates", "القوالب"],
  settings: ["Settings", "الإعدادات"],
  save: ["Save", "حفظ"],
  cancel: ["Cancel", "إلغاء"],
  delete: ["Delete", "حذف"],
  edit: ["Edit", "تعديل"],
  copy: ["Copy", "نسخ"],
  share: ["Share", "مشاركة"],
  export: ["Export", "تصدير"],
  print: ["Print", "طباعة"],
  close: ["Close", "إغلاق"],
  back: ["Back", "رجوع"],
  search: ["Search", "بحث"],
  undo: ["Undo", "تراجع"],
  redo: ["Redo", "إعادة"],
  reset: ["Reset", "إعادة ضبط"],
  confirm: ["Confirm", "تأكيد"],
  open: ["Open", "فتح"],
  name: ["Name", "الاسم"],
  all: ["All", "الكل"],
  none: ["None", "بدون"],
  copied: ["Copied", "تم النسخ"],
  saved: ["Saved", "تم الحفظ"],
  deleted: ["Deleted", "تم الحذف"],
  loading: ["Loading…", "جارٍ التحميل…"],
  download: ["Download", "تنزيل"],
  language: ["Language", "اللغة"],
  type: ["Type", "النوع"],
  date: ["Date", "التاريخ"],
  favorites: ["Favorites", "المفضلة"],
  category: ["Category", "التصنيف"],
  description: ["Description", "الوصف"],
  today: ["Today", "اليوم"],
  week: ["Last 7 days", "آخر 7 أيام"],
  month: ["Last 30 days", "آخر 30 يوماً"],
  select: ["Select", "تحديد"],
  noResults: ["No results", "لا توجد نتائج"],
  error: ["Error", "خطأ"],
} as const satisfies Record<string, Tx>;

export interface LegalDoc {
  title: Tx;
  items: Tx[];
}

export const TERMS: LegalDoc = {
  title: ["Terms of Use", "شروط الاستخدام"],
  items: [
    ["You use the app at your own responsibility.", "استخدام التطبيق على مسؤولية المستخدم."],
    ["You are responsible for the content you place inside QR codes.", "المستخدم مسؤول عن المحتوى الذي ينشئه داخل رموز QR."],
    ["Do not use the app to create codes for illegal or harmful purposes.", "يُمنع استخدام التطبيق لإنشاء رموز لأغراض غير قانونية أو ضارة."],
    ["We do not guarantee that every code can be read in all conditions, especially when printed or when unsuitable designs are used. Always test before publishing.", "لا نضمن صلاحية جميع الرموز للقراءة في جميع الظروف، خصوصاً عند الطباعة أو استخدام تصميمات غير مناسبة. اختبر الرمز دائماً قبل نشره."],
  ],
};

export const PRIVACY: LegalDoc = {
  title: ["Privacy Policy", "سياسة الخصوصية"],
  items: [
    ["Your data is stored locally on your device using IndexedDB.", "تُحفظ بياناتك محلياً على جهازك باستخدام IndexedDB."],
    ["QR contents are never sent to an external server.", "لا يتم إرسال محتويات الرموز إلى أي خادم خارجي."],
    ["No personal data is collected for tracking purposes.", "لا يتم جمع بيانات شخصية لأغراض التتبع."],
    ["The camera is used only while the scanner is running.", "تُستخدم الكاميرا فقط عند تشغيل الماسح."],
    ["You can delete or export your data at any time from the app.", "يمكنك حذف بياناتك أو تصديرها في أي وقت من التطبيق."],
    ["The platform or browser may keep app data locally according to its own storage policies.", "قد تحتفظ المنصة أو المتصفح ببيانات التطبيق محلياً وفق سياسات التخزين الخاصة به."],
  ],
};

export function formatDate(ts: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
