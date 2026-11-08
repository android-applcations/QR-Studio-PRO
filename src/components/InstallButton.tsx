import { useState } from "react";
import { Check, Download, Share2, Smartphone } from "lucide-react";
import { useApp } from "../state/AppContext";
import { usePwa } from "../pwa/PwaProvider";
import { cn } from "../utils/cn";
import { Button, IconBtn, Modal } from "./ui";

/**
 * Install entry point (Android / Chrome / Edge / desktop + manual guide for iOS).
 * Renders nothing once the app already runs as an installed PWA.
 */
export default function InstallButton({ compact = false }: { compact?: boolean }) {
  const { t } = useApp();
  const { canInstall, install, installed, needsManualInstall } = usePwa();
  const [guide, setGuide] = useState(false);
  const [done, setDone] = useState(false);

  if (installed) {
    return compact ? null : (
      <div
        role="status"
        title={t(["Installed — runs offline from this device", "مثبّت — يعمل دون إنترنت من هذا الجهاز"])}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-3 text-[12px] text-ok"
      >
        <Check size={13} />
        <span>{t(["Installed", "مثبّت"])}</span>
      </div>
    );
  }

  const onInstall = async () => {
    const ok = await install();
    if (ok) setDone(true);
  };

  if (canInstall) {
    return compact ? (
      <IconBtn
        label={t(["Install app", "تثبيت التطبيق"])}
        onClick={() => void onInstall()}
        className={cn(done && "text-ok")}
      >
        {done ? <Check size={22} /> : <Download size={22} />}
      </IconBtn>
    ) : (
      <Button variant="primary" onClick={() => void onInstall()} icon={<Download size={17} />}>
        {t(["Install app", "تثبيت التطبيق"])}
      </Button>
    );
  }

  if (!needsManualInstall) return null;

  // iOS Safari never fires beforeinstallprompt — show the manual steps instead.
  return (
    <>
      {compact ? (
        <IconBtn label={t(["How to install", "طريقة التثبيت"])} onClick={() => setGuide(true)} className="text-brand">
          <Smartphone size={22} />
        </IconBtn>
      ) : (
        <Button onClick={() => setGuide(true)} icon={<Smartphone size={17} />}>
          {t(["How to install", "طريقة التثبيت"])}
        </Button>
      )}
      <Modal open={guide} onClose={() => setGuide(false)} title={t(["Install QR Studio Pro", "تثبيت QR Studio Pro"])}>
        <div className="space-y-3 text-sm leading-6">
          <p className="text-muted">
            {t(
              [
                "Install the app to open it from your home screen and use it with no connection at all.",
                "ثبّت التطبيق لفتحه من شاشتك الرئيسية واستخدامه بدون أي اتصال.",
              ],
            )}
          </p>
          <ol className="list-decimal space-y-2 ps-5" dir={document.documentElement.dir || "ltr"}>
            <li>
              {t(["Open this page in Safari", "افتح هذه الصفحة في متصفح Safari"])}
            </li>
            <li className="flex items-start gap-2">
              <Share2 size={16} className="mt-1 shrink-0 text-brand" />
              {t(["Tap the Share button", "اضغط زر المشاركة"])}
            </li>
            <li>{t(["Choose “Add to Home Screen”", "اختر «إضافة إلى الشاشة الرئيسية»"])}</li>
            <li>{t(["Confirm with “Add”", "أكّد بالضغط على «إضافة»"])}</li>
          </ol>
          <p className="rounded-xl border border-line bg-surface2/40 px-3 py-2 text-xs text-muted">
            {t(
              [
                "On Android, Chrome and Edge the install button appears automatically at the top of the app.",
                "على أندرويد وChrome وEdge يظهر زر التثبيت تلقائياً أعلى التطبيق.",
              ],
            )}
          </p>
          <Button variant="primary" full onClick={() => setGuide(false)}>
            {t(["Got it", "حسناً"])}
          </Button>
        </div>
      </Modal>
    </>
  );
}
