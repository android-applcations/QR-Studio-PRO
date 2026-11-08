import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Check, Clipboard, ExternalLink, Eye, EyeOff, ImageUp, Pause, Play, RefreshCw, Save, Share2, ShieldAlert, Sparkles, Zap, ZapOff } from "lucide-react";
import { detectType, TYPE_BY_ID } from "../core/qrTypes";
import { analyzeLink } from "../core/security";
import { T } from "../core/i18n";
import { addHistory } from "../db/db";
import { redactForLog } from "../core/qrTypes";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { CameraSession, cameraErrorKind, cameraSupported, decodeImageFile, type CameraCaps, type CameraErrorKind } from "../engine/scannerEngine";
import { canShareText, copyText, shareText } from "../engine/exportEngine";
import { cn } from "../utils/cn";
import { TypeIcon } from "./BrandIcon";
import { Button, IconBtn, Notice, Spinner } from "./ui";

type Status = "starting" | "live" | "stopped" | "error";

function maskWifi(content: string): string {
  return content.replace(/P:((?:\\.|[^;])*);/, "P:••••••;");
}

function ResultPanel({ codes, onAgain }: { codes: string[]; onAgain: () => void }) {
  const { t, toast, fail, confirm, go, saveHistory, bumpData } = useApp();
  const { loadRaw } = useProject();
  const [idx, setIdx] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(saveHistory);
  const content = codes[Math.min(idx, codes.length - 1)];
  const typeId = detectType(content);
  const def = TYPE_BY_ID[typeId] ?? TYPE_BY_ID.text;
  const link = useMemo(() => analyzeLink(content), [content]);
  const isWifi = typeId === "wifi";

  useEffect(() => { setSaved(saveHistory); setReveal(false); }, [content, saveHistory]);

  const onCopy = async () => {
    try { await copyText(content); toast(t(T.copied)); } catch (e) { fail(e); }
  };
  const onShare = async () => {
    try {
      if (canShareText()) await shareText(content, "QR Studio Pro");
      else { await copyText(content); toast(t(["Sharing isn't available — copied instead", "المشاركة غير متاحة — تم النسخ بدلاً منها"]), "info"); }
    } catch (e) { fail(e); }
  };
  const onOpen = async () => {
    if (!link.openable) return;
    const ok = await confirm({
      title: ["Open this link?", "فتح هذا الرابط؟"],
      message: [`You are about to open: ${link.host || link.href}${link.warnings.length ? "\n\nWarning: " + link.warnings.map((w) => w[0]).join(" ") : ""}`, `ستقوم بفتح: ${link.host || link.href}${link.warnings.length ? "\n\nتحذير: " + link.warnings.map((w) => w[1]).join(" ") : ""}`],
      confirmLabel: ["Open", "فتح"],
      danger: link.warnings.length > 0,
    });
    if (!ok) return;
    const a = document.createElement("a");
    a.href = link.href;
    a.target = link.kind === "web" ? "_blank" : "_self";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const onSave = async () => {
    try {
      await addHistory({ action: "scan", type: typeId, content: redactForLog(typeId, content), scanned_at: Date.now() });
      setSaved(true);
      bumpData();
      toast(t(T.saved));
    } catch (e) { fail(e); }
  };
  const onCreate = () => { loadRaw(content, typeId); go("create"); };

  return (
    <div className="anim-sheet card flex max-h-full min-h-0 flex-col overflow-hidden border-brand/40 bg-surface shadow-2xl">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2.5">
        <TypeIcon icon={def.icon} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-ok"><Check size={16} />{t(["Code detected", "تم اكتشاف الرمز"])}</p>
          <p className="truncate text-xs text-muted">{t(["Type", "النوع"])}: {t(def.title)}</p>
        </div>
      </div>
      {codes.length > 1 && (
        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
          {codes.map((c, i) => (
            <button key={i} type="button" onClick={() => setIdx(i)} className={cn("press min-h-9 shrink-0 rounded-full border px-3 text-xs", i === idx ? "border-brand bg-brand/15 text-brand" : "border-line text-muted")}>
              #{i + 1} · {t((TYPE_BY_ID[detectType(c)] ?? TYPE_BY_ID.text).title)}
            </button>
          ))}
        </div>
      )}
      <div className="scroll-area min-h-0 flex-1 space-y-2.5 px-3 py-3">
        <div className="rounded-xl border border-line bg-surface2/60 p-3">
          <p className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-sm leading-6" dir="auto">{isWifi && !reveal ? maskWifi(content) : content}</p>
          {isWifi && (
            <button type="button" onClick={() => setReveal((v) => !v)} className="press mt-1 inline-flex min-h-9 items-center gap-1.5 text-xs text-brand">
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? t(["Hide password", "إخفاء كلمة المرور"]) : t(["Show password", "إظهار كلمة المرور"])}
            </button>
          )}
        </div>
        {link.kind === "web" && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2/40 px-3 py-2 text-xs">
            <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", link.https ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn")}>{link.https ? "HTTPS" : "HTTP"}</span>
            <span className="min-w-0 truncate" dir="ltr">{link.host}</span>
          </div>
        )}
        {link.kind === "unsafe" && <Notice level="error">{link.warnings.map((w) => t(w)).join(" ")}</Notice>}
        {link.kind !== "unsafe" && link.warnings.map((w, i) => <Notice key={i} level="warn">{t(w)}</Notice>)}
        <p className="text-[11px] text-muted">{t(["Links are never opened automatically.", "لا يتم فتح الروابط تلقائياً."])}</p>
      </div>
      <div className="grid shrink-0 grid-cols-4 gap-1.5 border-t border-line p-2.5">
        <Button size="sm" onClick={onCopy} icon={<Clipboard size={16} />} className="col-span-2">{t(T.copy)}</Button>
        <Button size="sm" onClick={onShare} icon={<Share2 size={16} />} className="col-span-2">{t(T.share)}</Button>
        {link.openable && <Button size="sm" variant="soft" onClick={onOpen} icon={<ExternalLink size={16} />} className="col-span-2">{t(T.open)}</Button>}
        <Button size="sm" onClick={onSave} disabled={saved} icon={saved ? <Check size={16} /> : <Save size={16} />} className="col-span-2">{saved ? t(["In history", "في السجل"]) : t(["Save to history", "حفظ في السجل"])}</Button>
        <Button size="sm" onClick={onCreate} icon={<Sparkles size={16} />} className="col-span-2">{t(["Create QR from it", "إنشاء QR منه"])}</Button>
        <Button size="sm" variant="primary" onClick={onAgain} icon={<RefreshCw size={16} />} className="col-span-2">{t(["Scan another", "مسح رمز آخر"])}</Button>
      </div>
    </div>
  );
}

export default function ScannerScreen() {
  const { t, toast, fail, logActivity, section } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Lazy, render-stable camera session (created once per mounted screen).
  const sessionRef = useRef<CameraSession | null>(null);
  const session = (sessionRef.current ??= new CameraSession());
  const alive = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [errKind, setErrKind] = useState<CameraErrorKind>("unknown");
  const [caps, setCaps] = useState<CameraCaps>({ torch: false, zoom: null });
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busyImg, setBusyImg] = useState(false);
  const [imgError, setImgError] = useState(false);
  const codesRef = useRef<string[] | null>(null);
  codesRef.current = codes;

  const onFound = useCallback((found: string[]) => {
    if (codesRef.current) return;
    session.pauseLoop();
    setCodes(found);
    try { navigator.vibrate?.(60); } catch { /* optional */ }
    for (const c of found) logActivity({ action: "scan", type: detectType(c), content: c });
  }, [logActivity]);

  const start = useCallback(async (opts?: { deviceId?: string; facing?: "environment" | "user" }) => {
    const v = videoRef.current;
    if (!v) return;
    setStatus("starting");
    setTorch(false);
    setImgError(false);
    if (!cameraSupported()) {
      session.stop();
      setErrKind(window.isSecureContext === false ? "insecure" : "unsupported");
      setStatus("error");
      return;
    }
    try {
      const c = await session.start(v, { deviceId: opts?.deviceId, facing: opts?.facing ?? facing });
      // The screen may have been left while the camera permission dialog was open.
      if (!alive.current) {
        session.stop();
        return;
      }
      setCaps(c);
      setZoom(c.zoom?.min ?? 1);
      setStatus("live");
      session.loop(v, onFound);
      const list = await CameraSession.listCameras();
      if (!alive.current) return;
      setCams(list);
      setDeviceId(session.currentDeviceId() ?? "");
    } catch (e) {
      session.stop();
      if (!alive.current) return;
      setErrKind(cameraErrorKind(e));
      setStatus("error");
    }
  }, [facing, onFound]);

  // Start on mount; always release the camera on unmount / hidden page
  useEffect(() => {
    alive.current = true;
    void start();
    const s = sessionRef.current ?? session;
    const release = () => {
      s.stop();
      setStatus((st) => (st === "error" ? st : "stopped"));
    };
    const onVis = () => {
      if (document.hidden) release();
    };
    document.addEventListener("visibilitychange", onVis);
    // pagehide covers bfcache / tab close where visibilitychange may not fire
    window.addEventListener("pagehide", release);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", release);
      s.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (section !== "scan") session.stop(); }, [section]);

  const stop = () => { session.stop(); setStatus("stopped"); setTorch(false); };

  const again = () => {
    setCodes(null);
    setImgError(false);
    if (status === "live" && videoRef.current) session.loop(videoRef.current, onFound);
    else void start({ deviceId: deviceId || undefined });
  };

  const toggleTorch = async () => {
    try { await session.setTorch(!torch); setTorch(!torch); } catch { toast(t(["Flash isn't available on this camera", "المصباح غير متاح في هذه الكاميرا"]), "err"); }
  };
  const changeZoom = async (z: number) => {
    setZoom(z);
    try { await session.setZoom(z); } catch { /* ignore */ }
  };

  const onImage = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { toast(t(["Choose a PNG, JPG or WebP image", "اختر صورة PNG أو JPG أو WebP"]), "err"); return; }
    setBusyImg(true);
    setImgError(false);
    try {
      const found = await decodeImageFile(f);
      if (!found.length) { setImgError(true); return; }
      session.pauseLoop();
      setCodes(found);
      for (const c of found) logActivity({ action: "scan", type: detectType(c), content: c });
    } catch (e) { fail(e); } finally { setBusyImg(false); }
  };

  const errText: Record<CameraErrorKind, [string, string]> = {
    denied: ["Camera permission was denied. Allow camera access for this app in your device settings, then try again.", "تم رفض إذن الكاميرا. اسمح بالوصول إلى الكاميرا لهذا التطبيق من إعدادات الجهاز ثم حاول مجدداً."],
    none: ["No camera was found on this device.", "لم يتم العثور على كاميرا في هذا الجهاز."],
    busy: ["The camera is being used by another app.", "الكاميرا مستخدمة من تطبيق آخر."],
    insecure: ["The camera needs a secure (HTTPS) context. Open the app over HTTPS or from an installed app.", "تتطلب الكاميرا سياقاً آمناً (HTTPS). افتح التطبيق عبر HTTPS أو من التطبيق المثبّت."],
    unsupported: ["This browser does not support camera access. You can still scan a QR code from an image.", "هذا المتصفح لا يدعم الوصول إلى الكاميرا. يمكنك مسح رمز QR من صورة."],
    unknown: ["Could not start the camera.", "تعذر تشغيل الكاميرا."],
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:flex-row md:p-5">
      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { void onImage(e.target.files?.[0]); e.target.value = ""; }} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-line bg-black">
          <video ref={videoRef} playsInline muted autoPlay className={cn("absolute inset-0 h-full w-full object-cover", status !== "live" && "opacity-0", facing === "user" && !deviceId && "-scale-x-100")} aria-label={t(["Camera preview", "معاينة الكاميرا"])} />
          {status === "live" && !codes && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative aspect-square w-[68%] max-w-[300px] overflow-hidden rounded-3xl border border-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                {["start-0 top-0 border-s-4 border-t-4 rounded-ss-3xl", "end-0 top-0 border-e-4 border-t-4 rounded-se-3xl", "start-0 bottom-0 border-s-4 border-b-4 rounded-es-3xl", "end-0 bottom-0 border-e-4 border-b-4 rounded-ee-3xl"].map((c) => (
                  <span key={c} className={cn("absolute h-9 w-9 border-brand2", c)} />
                ))}
                <span className="absolute inset-x-3 h-0.5 rounded bg-brand2/90 shadow-[0_0_12px_var(--c-brand2)]" style={{ animation: "scan-line 2.2s ease-in-out infinite alternate" }} />
              </div>
            </div>
          )}
          {status === "starting" && <div className="absolute inset-0 flex items-center justify-center gap-2 text-white/80"><Spinner />{t(["Starting camera…", "جارٍ تشغيل الكاميرا…"])}</div>}
          {status === "stopped" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface/95 p-6 text-center">
              <CameraOff size={34} className="text-muted" />
              <p className="text-sm text-muted">{t(["Camera is off", "الكاميرا متوقفة"])}</p>
              <Button variant="primary" onClick={() => start({ deviceId: deviceId || undefined })} icon={<Play size={18} />}>{t(["Resume", "استئناف"])}</Button>
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-surface p-6 text-center">
              <ShieldAlert size={34} className="text-warn" />
              <p className="max-w-sm text-sm leading-6">{t(errText[errKind])}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {errKind !== "none" && <Button variant="primary" onClick={() => start()} icon={<Camera size={18} />}>{t(["Allow & retry", "السماح وإعادة المحاولة"])}</Button>}
                <Button onClick={() => fileRef.current?.click()} icon={<ImageUp size={18} />}>{t(["Scan from image", "مسح من صورة"])}</Button>
              </div>
            </div>
          )}
          {/* floating camera controls */}
          {status === "live" && !codes && (
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
              {caps.zoom && (
                <input type="range" aria-label={t(["Zoom", "التكبير"])} min={caps.zoom.min} max={Math.min(caps.zoom.max, caps.zoom.min + 8)} step={caps.zoom.step} value={zoom} onChange={(e) => void changeZoom(Number(e.target.value))} className="h-8 w-full" />
              )}
              <div className="flex items-center justify-center gap-2">
                {caps.torch && <IconBtn label={t(["Flash", "المصباح"])} active={torch} onClick={toggleTorch} className="bg-black/50 text-white">{torch ? <Zap size={22} /> : <ZapOff size={22} />}</IconBtn>}
                <IconBtn label={t(["Pause camera", "إيقاف الكاميرا"])} onClick={stop} className="bg-black/50 text-white"><Pause size={22} /></IconBtn>
                <IconBtn label={t(["Switch camera", "تبديل الكاميرا"])} onClick={() => { const next = facing === "environment" ? "user" : "environment"; setFacing(next); setDeviceId(""); void start({ facing: next }); }} className="bg-black/50 text-white"><RefreshCw size={21} /></IconBtn>
                <IconBtn label={t(["Scan from image", "مسح من صورة"])} onClick={() => fileRef.current?.click()} className="bg-black/50 text-white"><ImageUp size={22} /></IconBtn>
              </div>
            </div>
          )}
          {busyImg && <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-black/60 text-white"><Spinner />{t(["Analyzing image…", "جارٍ تحليل الصورة…"])}</div>}
          {/* result overlay on phones */}
          {codes && <div className="absolute inset-x-2 bottom-2 top-2 flex items-end md:hidden"><div className="max-h-full min-h-0 w-full"><ResultPanel codes={codes} onAgain={again} /></div></div>}
        </div>

        {cams.length > 1 && status === "live" && (
          <select aria-label={t(["Choose camera", "اختيار الكاميرا"])} value={deviceId} onChange={(e) => { setDeviceId(e.target.value); void start({ deviceId: e.target.value }); }} className="min-h-11 shrink-0 rounded-xl border border-line bg-surface2 px-3 text-sm">
            {cams.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `${t(["Camera", "كاميرا"])} ${i + 1}`}</option>)}
          </select>
        )}
        {imgError && <Notice level="error">{t(["No valid QR code was found in this image. Try a sharper, closer or better-lit picture.", "لم يتم العثور على رمز QR صالح في هذه الصورة. جرّب صورة أوضح أو أقرب أو بإضاءة أفضل."])}</Notice>}
        {!codes && status !== "error" && (
          <p className="shrink-0 text-center text-xs text-muted">{t(["Point the camera at a QR code. Nothing is sent anywhere — scanning happens on your device.", "وجّه الكاميرا نحو رمز QR. لا يتم إرسال أي شيء — المسح يتم على جهازك."])}</p>
        )}
      </div>

      <div className="hidden min-h-0 md:flex md:w-[360px] md:flex-col">
        {codes ? (
          <ResultPanel codes={codes} onAgain={again} />
        ) : (
          <div className="card flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
            <Camera size={30} className="text-brand" />
            <p>{t(["Scan results appear here", "تظهر نتائج المسح هنا"])}</p>
            <Button onClick={() => fileRef.current?.click()} icon={<ImageUp size={18} />}>{t(["Scan from image", "مسح من صورة"])}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
