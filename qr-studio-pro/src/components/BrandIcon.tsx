import { memo, type ReactNode } from "react";
import {
  siAppstore, siBitcoin, siDiscord, siFacebook, siGooglemaps, siInstagram, siPaypal, siPinterest, siSnapchat,
  siSoundcloud, siSpotify, siTelegram, siThreads, siTiktok, siVimeo, siWhatsapp, siX, siYoutube,
} from "simple-icons";
import {
  Banknote, Briefcase, Calendar, FileText, Globe, Landmark, Languages, Link2, Mail, MessageSquare, Package,
  Phone, Play, Type, User, Users, Wallet, Wifi, type LucideIcon,
} from "lucide-react";
import { TYPE_BY_ID } from "../core/qrTypes";

interface Brand {
  path: string;
  /** tile background (CSS) */
  bg: string;
  /** glyph color */
  fg: string;
  ring?: boolean;
}

// LinkedIn was removed from simple-icons; official mark path embedded here.
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

const BRANDS: Record<string, Brand> = {
  instagram: { path: siInstagram.path, bg: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)", fg: "#fff" },
  facebook: { path: siFacebook.path, bg: "#0866ff", fg: "#fff" },
  tiktok: { path: siTiktok.path, bg: "#010101", fg: "#fff", ring: true },
  whatsapp: { path: siWhatsapp.path, bg: "#25d366", fg: "#fff" },
  telegram: { path: siTelegram.path, bg: "#26a5e4", fg: "#fff" },
  youtube: { path: siYoutube.path, bg: "#ff0000", fg: "#fff" },
  x: { path: siX.path, bg: "#000", fg: "#fff", ring: true },
  linkedin: { path: LINKEDIN_PATH, bg: "#0a66c2", fg: "#fff" },
  snapchat: { path: siSnapchat.path, bg: "#fffc00", fg: "#000" },
  pinterest: { path: siPinterest.path, bg: "#e60023", fg: "#fff" },
  threads: { path: siThreads.path, bg: "#000", fg: "#fff", ring: true },
  discord: { path: siDiscord.path, bg: "#5865f2", fg: "#fff" },
  spotify: { path: siSpotify.path, bg: "#1ed760", fg: "#000" },
  soundcloud: { path: siSoundcloud.path, bg: "#ff5500", fg: "#fff" },
  vimeo: { path: siVimeo.path, bg: "#1ab7ea", fg: "#fff" },
  paypal: { path: siPaypal.path, bg: "#003087", fg: "#fff" },
  bitcoin: { path: siBitcoin.path, bg: "#f7931a", fg: "#fff" },
  googlemaps: { path: siGooglemaps.path, bg: "#ffffff", fg: "#ea4335" },
  appstore: { path: siAppstore.path, bg: "#0d96f6", fg: "#fff" },
};

const LUCIDE: Record<string, { Icon: LucideIcon; bg: string }> = {
  globe: { Icon: Globe, bg: "linear-gradient(135deg,#3b82f6,#1d4ed8)" },
  link: { Icon: Link2, bg: "linear-gradient(135deg,#8b5cf6,#6d28d9)" },
  briefcase: { Icon: Briefcase, bg: "linear-gradient(135deg,#14b8a6,#0f766e)" },
  calendar: { Icon: Calendar, bg: "linear-gradient(135deg,#f87171,#dc2626)" },
  package: { Icon: Package, bg: "linear-gradient(135deg,#f59e0b,#b45309)" },
  phone: { Icon: Phone, bg: "linear-gradient(135deg,#34d399,#059669)" },
  "message-square": { Icon: MessageSquare, bg: "linear-gradient(135deg,#22d3ee,#0891b2)" },
  mail: { Icon: Mail, bg: "linear-gradient(135deg,#fb923c,#ea580c)" },
  wifi: { Icon: Wifi, bg: "linear-gradient(135deg,#38bdf8,#0369a1)" },
  user: { Icon: User, bg: "linear-gradient(135deg,#a78bfa,#7c3aed)" },
  type: { Icon: Type, bg: "linear-gradient(135deg,#94a3b8,#475569)" },
  languages: { Icon: Languages, bg: "linear-gradient(135deg,#e879f9,#a21caf)" },
  "file-text": { Icon: FileText, bg: "linear-gradient(135deg,#fb7185,#be123c)" },
  wallet: { Icon: Wallet, bg: "linear-gradient(135deg,#2dd4bf,#0d9488)" },
  landmark: { Icon: Landmark, bg: "linear-gradient(135deg,#60a5fa,#1e40af)" },
  banknote: { Icon: Banknote, bg: "linear-gradient(135deg,#4ade80,#15803d)" },
  users: { Icon: Users, bg: "linear-gradient(135deg,#f472b6,#be185d)" },
  play: { Icon: Play, bg: "linear-gradient(135deg,#fb923c,#e11d48)" },
};

function TikTokGlyph({ path, size }: { path: string; size: number }): ReactNode {
  // Original TikTok look: cyan + red offset shadows behind the white note.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={path} fill="#25f4ee" transform="translate(-0.7 -0.5)" />
      <path d={path} fill="#fe2c55" transform="translate(0.7 0.5)" />
      <path d={path} fill="#fff" />
    </svg>
  );
}

interface Props {
  /** icon key from QrTypeDef.icon */
  icon: string;
  size?: number;
  className?: string;
  /** optional view-transition name for hero animation */
  heroName?: string;
}

export const TypeIcon = memo(function TypeIcon({ icon, size = 44, className = "", heroName }: Props) {
  const brand = BRANDS[icon];
  const radius = Math.round(size * 0.28);
  const glyph = Math.round(size * 0.58);
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius, viewTransitionName: heroName } as React.CSSProperties;
  if (brand) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${brand.ring ? "ring-1 ring-white/20" : ""} ${className}`}
        style={{ ...style, background: brand.bg }}
        role="img"
        aria-hidden="true"
      >
        {icon === "tiktok" ? (
          <TikTokGlyph path={brand.path} size={glyph} />
        ) : (
          <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill={brand.fg} aria-hidden="true">
            <path d={brand.path} />
          </svg>
        )}
      </span>
    );
  }
  const l = LUCIDE[icon] ?? LUCIDE.link;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center text-white ${className}`} style={{ ...style, background: l.bg }} aria-hidden="true">
      <l.Icon size={Math.round(size * 0.52)} strokeWidth={2.1} />
    </span>
  );
});

export const typeIconKey = (typeId: string): string => TYPE_BY_ID[typeId]?.icon ?? "link";

/** Official WhatsApp mark (used for the contact button). */
export const WhatsAppMark = ({ size = 22, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true">
    <path d={siWhatsapp.path} />
  </svg>
);
