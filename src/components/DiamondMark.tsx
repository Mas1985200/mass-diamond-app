import type { SVGProps } from "react";
import { useId } from "react";

type DiamondMarkProps = {
  size: number | string;
  title?: string;
  className?: string;
  style?: SVGProps<SVGSVGElement>["style"];
} & Omit<
  SVGProps<SVGSVGElement>,
  "width" | "height" | "title" | "className" | "style"
>;

const VIEW_W = 504;
const VIEW_H = 400;
const WIDTH_SCALE = 2.6;

export default function DiamondMark({
  size,
  title,
  className,
  style,
  ...rest
}: DiamondMarkProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const titleId = `${id}-title`;
  const auraId = `${id}-aura`;
  const orbitId = `${id}-orbit`;
  const crownLId = `${id}-crown-l`;
  const crownCId = `${id}-crown-c`;
  const crownRId = `${id}-crown-r`;
  const pavLId = `${id}-pav-l`;
  const pavCId = `${id}-pav-c`;
  const pavRId = `${id}-pav-r`;
  const glowId = `${id}-glow`;
  const orbitGlowId = `${id}-orbit-glow`;
  const starGlowId = `${id}-star-glow`;

  const width =
    typeof size === "number" ? Math.round(size * WIDTH_SCALE) : size;
  const height =
    typeof size === "number"
      ? Math.round((size * WIDTH_SCALE * VIEW_H) / VIEW_W)
      : "auto";

  const sparklePath =
    "M0 -14 L3 -3 L14 0 L3 3 L0 14 L-3 3 L-14 0 L-3 -3 Z";

  return (
    <svg
      {...rest}
      width={width}
      height={height}
      viewBox={`-60 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: "block",
        maxWidth: "100%",
        height: "auto",
        overflow: "hidden",
        ...style,
      }}
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
    >
      {title ? <title id={titleId}>{title}</title> : null}

      <defs>
        <radialGradient id={auraId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#39FF88" stopOpacity="0.08" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={orbitId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0" />
          <stop offset="0.18" stopColor="#9DFFC9" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="0.82" stopColor="#9DFFC9" stopOpacity="0.85" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={crownLId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#B5FFD5" stopOpacity="0.8" />
          <stop offset="1" stopColor="#3DF58C" stopOpacity="0.6" />
        </linearGradient>

        <linearGradient id={crownCId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#6CFFAF" stopOpacity="0.55" />
        </linearGradient>

        <linearGradient id={crownRId} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E3FFF1" stopOpacity="0.9" />
          <stop offset="1" stopColor="#22DD78" stopOpacity="0.65" />
        </linearGradient>

        <linearGradient id={pavLId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9BFFC8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#0E8A4C" stopOpacity="0.95" />
        </linearGradient>

        <linearGradient id={pavCId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F2FFF8" stopOpacity="0.92" />
          <stop offset="1" stopColor="#2BEA82" stopOpacity="0.8" />
        </linearGradient>

        <linearGradient id={pavRId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#63FFAA" stopOpacity="0.8" />
          <stop offset="1" stopColor="#075A32" stopOpacity="0.95" />
        </linearGradient>

        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="12" />
        </filter>

        <filter id={orbitGlowId} x="-10%" y="-150%" width="120%" height="400%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id={starGlowId} x="-400%" y="-400%" width="900%" height="900%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Aura */}
      <ellipse cx="192" cy="200" rx="215" ry="155" fill={`url(#${auraId})`} />

      {/* Back half of orbit */}
      <ellipse
        cx="0"
        cy="0"
        rx="235"
        ry="60"
        transform="translate(192 196) rotate(-14)"
        fill="none"
        stroke={`url(#${orbitId})`}
        strokeWidth="2.4"
        opacity="0.75"
        filter={`url(#${orbitGlowId})`}
      />

      {/* Particles */}
      <g filter={`url(#${starGlowId})`}>
        <circle cx="20" cy="80" r="2.2" fill="#FFFFFF" opacity="0.8" />
        <circle cx="90" cy="24" r="1.6" fill="#BFFFF0" opacity="0.7" />
        <circle cx="300" cy="26" r="1.8" fill="#39FF88" opacity="0.7" />
        <circle cx="372" cy="70" r="2.2" fill="#FFFFFF" opacity="0.75" />
        <circle cx="408" cy="200" r="1.8" fill="#39FF88" opacity="0.7" />
        <circle cx="356" cy="330" r="2" fill="#DFFFF0" opacity="0.7" />
        <circle cx="40" cy="320" r="1.8" fill="#FFFFFF" opacity="0.65" />
        <circle cx="-10" cy="230" r="1.6" fill="#39FF88" opacity="0.65" />
      </g>

      {/* Sparkles */}
      <g filter={`url(#${starGlowId})`}>
        <path d={sparklePath} transform="translate(192 20) scale(1.1)" fill="#FFFFFF" opacity="0.95" />
        <path d={sparklePath} transform="translate(8 140) scale(0.7)" fill="#EFFFF7" opacity="0.8" />
        <path d={sparklePath} transform="translate(398 118) scale(0.8)" fill="#BFFFF0" opacity="0.85" />
        <path d={sparklePath} transform="translate(192 356) scale(0.9)" fill="#FFFFFF" opacity="0.9" />
      </g>

      {/* Diamond glow */}
      <polygon
        points="32,144 96,48 288,48 352,144 192,352"
        fill="#39FF88"
        opacity="0.35"
        filter={`url(#${glowId})`}
      />

      {/* Dark glass body */}
      <polygon points="32,144 96,48 288,48 352,144 192,352" fill="#052A1A" fillOpacity="0.92" />

      {/* Crown facets */}
      <polygon
        points="32,144 96,48 128,144"
        fill={`url(#${crownLId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="96,48 152,48 128,144"
        fill={`url(#${crownCId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="152,48 232,48 256,144 128,144"
        fill={`url(#${crownCId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.85"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="232,48 288,48 256,144"
        fill={`url(#${crownRId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="288,48 352,144 256,144"
        fill={`url(#${crownRId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Crown glass highlight */}
      <polygon points="166,56 218,56 236,136 148,136" fill="#FFFFFF" fillOpacity="0.22" />

      {/* Pavilion facets */}
      <polygon
        points="32,144 128,144 192,352"
        fill={`url(#${pavLId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="128,144 192,144 192,352"
        fill={`url(#${pavCId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="192,144 256,144 192,352"
        fill={`url(#${pavRId})`}
        fillOpacity="0.75"
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <polygon
        points="256,144 352,144 192,352"
        fill={`url(#${pavRId})`}
        stroke="#EFFFF7"
        strokeOpacity="0.75"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Pavilion glass highlight */}
      <polygon points="128,144 192,144 192,300 160,220" fill="#FFFFFF" fillOpacity="0.25" />

      {/* Outer silhouette and girdle */}
      <polygon
        points="32,144 96,48 288,48 352,144 192,352"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.92"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <line
        x1="32"
        y1="144"
        x2="352"
        y2="144"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="2"
      />

      {/* Front half of orbit */}
      <path
        d="M -235 0 A 235 60 0 0 0 235 0"
        transform="translate(192 196) rotate(-14)"
        fill="none"
        stroke={`url(#${orbitId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        filter={`url(#${orbitGlowId})`}
      />
      <path
        d="M -235 0 A 235 60 0 0 0 235 0"
        transform="translate(192 196) rotate(-14)"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.5"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}
