import type { SVGProps } from "react";
import { useId } from "react";

type DiamondMarkProps = {
  size: number | string;
  title?: string;
  className?: string;
  style?: SVGProps<SVGSVGElement>["style"];
} & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "title" | "className" | "style">;

const WIDTH_SCALE = 2.4;

export default function DiamondMark({
  size,
  title,
  className,
  style,
  ...rest
}: DiamondMarkProps) {
  const uid = useId().replace(/:/g, "");

  const gradientId = `${uid}-diamond-gradient`;
  const tableGradientId = `${uid}-table-gradient`;
  const facetGradientId = `${uid}-facet-gradient`;
  const darkFacetGradientId = `${uid}-dark-facet-gradient`;
  const pavilionGradientId = `${uid}-pavilion-gradient`;
  const orbitGradientId = `${uid}-orbit-gradient`;
  const glowFilterId = `${uid}-glow`;
  const softGlowFilterId = `${uid}-soft-glow`;
  const titleId = `${uid}-title`;

  const resolvedWidth = typeof size === "number" ? size * WIDTH_SCALE : size;

  return (
    <svg
      {...rest}
      width={resolvedWidth}
      viewBox="50 100 700 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: "block",
        overflow: "visible",
        maxWidth: "100%",
        height: "auto",
        ...style,
      }}
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      preserveAspectRatio="xMidYMid meet"
    >
      {title ? <title id={titleId}>{title}</title> : null}

      <defs>
        <linearGradient id={gradientId} x1="270" y1="205" x2="520" y2="470" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.18" stopColor="#DFFFF0" stopOpacity="0.92" />
          <stop offset="0.42" stopColor="#7DFFBD" stopOpacity="0.72" />
          <stop offset="0.65" stopColor="#D8FFF0" stopOpacity="0.88" />
          <stop offset="0.86" stopColor="#45FF98" stopOpacity="0.52" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
        </linearGradient>

        <linearGradient id={tableGradientId} x1="310" y1="215" x2="500" y2="265" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.94" />
          <stop offset="0.35" stopColor="#C9FFE6" stopOpacity="0.76" />
          <stop offset="0.58" stopColor="#62FFA7" stopOpacity="0.5" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.86" />
        </linearGradient>

        <linearGradient id={facetGradientId} x1="275" y1="250" x2="405" y2="475" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.88" />
          <stop offset="0.3" stopColor="#B7FFDB" stopOpacity="0.72" />
          <stop offset="0.62" stopColor="#48FF9A" stopOpacity="0.46" />
          <stop offset="1" stopColor="#E8FFF5" stopOpacity="0.82" />
        </linearGradient>

        <linearGradient id={darkFacetGradientId} x1="325" y1="250" x2="475" y2="450" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0A392A" stopOpacity="0.84" />
          <stop offset="0.38" stopColor="#123E31" stopOpacity="0.68" />
          <stop offset="0.7" stopColor="#061C17" stopOpacity="0.88" />
          <stop offset="1" stopColor="#02100D" stopOpacity="0.96" />
        </linearGradient>

        <linearGradient id={pavilionGradientId} x1="300" y1="300" x2="500" y2="480" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#DFFFF0" stopOpacity="0.7" />
          <stop offset="0.2" stopColor="#45FF98" stopOpacity="0.36" />
          <stop offset="0.5" stopColor="#071C16" stopOpacity="0.9" />
          <stop offset="0.76" stopColor="#A9FFD3" stopOpacity="0.48" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.84" />
        </linearGradient>

        <linearGradient id={orbitGradientId} x1="90" y1="350" x2="710" y2="230" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0.18" />
          <stop offset="0.18" stopColor="#BFFFF0" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#39FF88" stopOpacity="0.95" />
          <stop offset="0.82" stopColor="#E8FFF5" stopOpacity="0.9" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0.18" />
        </linearGradient>

        <filter id={glowFilterId} x="-40%" y="-60%" width="180%" height="220%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id={softGlowFilterId} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Orbit behind the diamond */}
      <ellipse
        cx="400"
        cy="285"
        rx="345"
        ry="104"
        transform="rotate(-8 400 285)"
        stroke={`url(#${orbitGradientId})`}
        strokeWidth="2.8"
        opacity="0.72"
        filter={`url(#${softGlowFilterId})`}
      />

      {/* Ambient light */}
      <ellipse
        cx="400"
        cy="305"
        rx="205"
        ry="120"
        fill="#39FF88"
        opacity="0.055"
        filter={`url(#${glowFilterId})`}
      />

      {/* Light particles */}
      <g filter={`url(#${softGlowFilterId})`}>
        <circle cx="177" cy="300" r="2.4" fill="#FFFFFF" opacity="0.82" />
        <circle cx="235" cy="214" r="1.7" fill="#BFFFF0" opacity="0.7" />
        <circle cx="300" cy="166" r="1.3" fill="#39FF88" opacity="0.5" />
        <circle cx="413" cy="128" r="3.2" fill="#FFFFFF" opacity="0.9" />
        <circle cx="505" cy="170" r="1.8" fill="#8DFFC3" opacity="0.72" />
        <circle cx="595" cy="226" r="2.2" fill="#FFFFFF" opacity="0.62" />
        <circle cx="636" cy="315" r="1.5" fill="#39FF88" opacity="0.65" />
        <circle cx="555" cy="382" r="2.3" fill="#DFFFF0" opacity="0.72" />
        <circle cx="228" cy="378" r="1.4" fill="#FFFFFF" opacity="0.58" />
        <circle cx="142" cy="348" r="1.2" fill="#39FF88" opacity="0.55" />
        <circle cx="658" cy="270" r="1.1" fill="#BFFFF0" opacity="0.55" />
      </g>

      {/* Four-point light stars */}
      <g filter={`url(#${softGlowFilterId})`}>
        <path d="M413 116 L416 126 L426 129 L416 132 L413 142 L410 132 L400 129 L410 126 Z" fill="#FFFFFF" opacity="0.88" />
        <path d="M592 213 L594 220 L601 222 L594 224 L592 231 L590 224 L583 222 L590 220 Z" fill="#BFFFF0" opacity="0.72" />
        <path d="M176 286 L178 293 L185 295 L178 297 L176 304 L174 297 L167 295 L174 293 Z" fill="#FFFFFF" opacity="0.64" />
      </g>

      {/* Diamond outer silhouette */}
      <path
        d="M250 255 L300 205 L500 205 L550 255 L500 300 L400 485 L300 300 Z"
        fill="#071B15"
        fillOpacity="0.82"
        stroke="#CFFFF0"
        strokeOpacity="0.82"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Dark internal depth */}
      <path
        d="M300 255 L500 255 L500 300 L400 470 L300 300 Z"
        fill={`url(#${darkFacetGradientId})`}
        opacity="0.9"
      />

      {/* Crown left main facet */}
      <path
        d="M250 255 L300 205 L315 220 L290 255 L300 300 Z"
        fill={`url(#${facetGradientId})`}
        opacity="0.86"
        stroke="#E8FFF5"
        strokeOpacity="0.48"
        strokeWidth="1.2"
      />

      {/* Crown right main facet */}
      <path
        d="M500 205 L550 255 L500 300 L510 255 L485 220 Z"
        fill={`url(#${facetGradientId})`}
        opacity="0.86"
        stroke="#E8FFF5"
        strokeOpacity="0.48"
        strokeWidth="1.2"
      />

      {/* Table */}
      <path
        d="M315 220 L485 220 L510 255 L290 255 Z"
        fill={`url(#${tableGradientId})`}
        fillOpacity="0.88"
        stroke="#FFFFFF"
        strokeOpacity="0.72"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Table internal reflection */}
      <path d="M330 225 L470 225 L492 251 L308 251 Z" fill="#FFFFFF" fillOpacity="0.11" />

      {/* Left star / bezel facets */}
      <path
        d="M290 255 L315 220 L350 255 L300 300 Z"
        fill={`url(#${facetGradientId})`}
        fillOpacity="0.82"
        stroke="#DFFFF0"
        strokeOpacity="0.5"
        strokeWidth="1.1"
      />
      <path d="M350 255 L315 220 L400 255 L300 300 Z" fill="#DFFFF0" fillOpacity="0.16" />

      {/* Right star / bezel facets */}
      <path
        d="M485 220 L510 255 L500 300 L450 255 Z"
        fill={`url(#${facetGradientId})`}
        fillOpacity="0.82"
        stroke="#DFFFF0"
        strokeOpacity="0.5"
        strokeWidth="1.1"
      />
      <path d="M400 255 L485 220 L450 255 L500 300 Z" fill="#DFFFFF" fillOpacity="0.14" />

      {/* Central dark star facet */}
      <path
        d="M350 255 L400 255 L450 255 L400 300 Z"
        fill="#061610"
        fillOpacity="0.88"
        stroke="#9DFFCC"
        strokeOpacity="0.32"
        strokeWidth="1"
      />

      {/* Central upper reflection */}
      <path d="M400 255 L450 255 L400 300 L375 275 Z" fill="#BFFFF0" fillOpacity="0.23" />

      {/* Left pavilion facet */}
      <path
        d="M300 300 L400 300 L400 485 Z"
        fill={`url(#${pavilionGradientId})`}
        fillOpacity="0.86"
        stroke="#E8FFF5"
        strokeOpacity="0.42"
        strokeWidth="1.1"
      />

      {/* Right pavilion facet */}
      <path
        d="M400 300 L500 300 L400 485 Z"
        fill={`url(#${pavilionGradientId})`}
        fillOpacity="0.8"
        stroke="#E8FFF5"
        strokeOpacity="0.42"
        strokeWidth="1.1"
      />

      {/* Deep central pavilion */}
      <path d="M400 300 L455 300 L400 465 L365 365 Z" fill="#02110C" fillOpacity="0.76" />

      {/* Pavilion reflection facets */}
      <path d="M300 300 L365 365 L400 485 Z" fill="#DFFFF0" fillOpacity="0.2" />
      <path d="M500 300 L435 365 L400 485 Z" fill="#39FF88" fillOpacity="0.14" />

      {/* Long white-green internal reflection */}
      <path d="M365 270 L400 300 L400 455 L382 390 Z" fill="#FFFFFF" fillOpacity="0.34" />

      {/* Girdle highlight */}
      <path
        d="M250 255 L550 255 L500 300 L400 300 L300 300 Z"
        fill="none"
        stroke="#DFFFF0"
        strokeOpacity="0.72"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Crisp upper silhouette */}
      <path
        d="M250 255 L300 205 L500 205 L550 255"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.78"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Culet highlight */}
      <path d="M400 300 L400 485" stroke="#FFFFFF" strokeOpacity="0.38" strokeWidth="1.4" />

      <path
        d="M300 300 L400 485 L500 300"
        fill="none"
        stroke="#9DFFCC"
        strokeOpacity="0.42"
        strokeWidth="1.3"
      />

      {/* Front half of orbital ring */}
      <path
        d="M72 326 C95 398 222 429 374 398 C526 367 665 294 728 238"
        stroke={`url(#${orbitGradientId})`}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.9"
        filter={`url(#${softGlowFilterId})`}
      />

      {/* Small orbital highlight */}
      <path
        d="M74 326 C98 392 214 419 342 400"
        stroke="#FFFFFF"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.48"
      />

      {/* Foreground sparkles */}
      <g filter={`url(#${softGlowFilterId})`}>
        <circle cx="118" cy="337" r="2.2" fill="#39FF88" opacity="0.76" />
        <circle cx="684" cy="245" r="2" fill="#FFFFFF" opacity="0.72" />
        <circle cx="624" cy="358" r="1.6" fill="#BFFFF0" opacity="0.65" />
      </g>
    </svg>
  );
}
