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

export default function DiamondMark({
  size,
  title,
  className,
  style,
  ...rest
}: DiamondMarkProps) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  const width =
    typeof size === "number"
      ? Math.round(size * 2.45)
      : `min(245%, 100%)`;

  const height =
    typeof size === "number"
      ? Math.round(size * 1.64)
      : "auto";

  const titleId = `${id}-title`;
  const diamondGradient = `${id}-diamond-gradient`;
  const crownGradient = `${id}-crown-gradient`;
  const pavilionGradient = `${id}-pavilion-gradient`;
  const greenFacetGradient = `${id}-green-facet`;
  const darkGlassGradient = `${id}-dark-glass`;
  const orbitGradient = `${id}-orbit-gradient`;
  const facetLightSafe = `${id}-facet-light-safe`;
  const glowFilter = `${id}-glow`;
  const strongGlowFilter = `${id}-strong-glow`;
  const starGlowFilter = `${id}-star-glow`;

  return (
    <svg
      {...rest}
      width={width}
      height={height}
      viewBox="0 0 980 655"
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
      overflow="hidden"
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
    >
      {title ? <title id={titleId}>{title}</title> : null}

      <defs>
        {/* Main crystal */}
        <linearGradient id={diamondGradient} x1="260" y1="185" x2="700" y2="545" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.14" stopColor="#DFFFF0" stopOpacity="0.96" />
          <stop offset="0.3" stopColor="#7CFFB5" stopOpacity="0.78" />
          <stop offset="0.48" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.67" stopColor="#54FF9C" stopOpacity="0.72" />
          <stop offset="0.84" stopColor="#DFFFF0" stopOpacity="0.96" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.98" />
        </linearGradient>

        {/* Crown glass */}
        <linearGradient id={crownGradient} x1="300" y1="160" x2="670" y2="350" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="0.2" stopColor="#D5FFEA" stopOpacity="0.9" />
          <stop offset="0.42" stopColor="#57FF9E" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.8" stopColor="#9CFFC8" stopOpacity="0.76" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.96" />
        </linearGradient>

        {/* Left crown facet (light glass) */}
        <linearGradient id={facetLightSafe} x1="326" y1="216" x2="410" y2="365" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="0.3" stopColor="#D8FFEB" stopOpacity="0.9" />
          <stop offset="0.62" stopColor="#79FFB5" stopOpacity="0.7" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
        </linearGradient>

        {/* Green glass reflections */}
        <linearGradient id={greenFacetGradient} x1="530" y1="180" x2="700" y2="490" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="0.22" stopColor="#BFFFF0" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="#39FF88" stopOpacity="0.7" />
          <stop offset="0.72" stopColor="#E5FFF2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0.54" />
        </linearGradient>

        {/* Pavilion */}
        <linearGradient id={pavilionGradient} x1="350" y1="330" x2="620" y2="570" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.2" stopColor="#CFFFF0" stopOpacity="0.82" />
          <stop offset="0.4" stopColor="#39FF88" stopOpacity="0.58" />
          <stop offset="0.58" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="0.78" stopColor="#63FFA7" stopOpacity="0.7" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.95" />
        </linearGradient>

        {/* Transparent internal depth */}
        <linearGradient id={darkGlassGradient} x1="390" y1="210" x2="590" y2="510" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#BFFFF0" stopOpacity="0.28" />
          <stop offset="0.35" stopColor="#0B4B34" stopOpacity="0.34" />
          <stop offset="0.55" stopColor="#031E15" stopOpacity="0.42" />
          <stop offset="0.75" stopColor="#49FF98" stopOpacity="0.3" />
          <stop offset="1" stopColor="#DFFFF0" stopOpacity="0.42" />
        </linearGradient>

        {/* Orbit */}
        <linearGradient id={orbitGradient} x1="90" y1="410" x2="890" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0.2" />
          <stop offset="0.14" stopColor="#9DFFC9" stopOpacity="0.86" />
          <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.5" stopColor="#39FF88" stopOpacity="0.98" />
          <stop offset="0.7" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.86" stopColor="#A7FFD0" stopOpacity="0.84" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0.18" />
        </linearGradient>

        {/* Soft glow */}
        <filter id={glowFilter} x="-50%" y="-80%" width="200%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Strong crystal glow */}
        <filter id={strongGlowFilter} x="-60%" y="-70%" width="220%" height="240%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Stars */}
        <filter id={starGlowFilter} x="-250%" y="-250%" width="500%" height="500%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* REAR ORBIT */}
      <ellipse
        cx="490"
        cy="330"
        rx="400"
        ry="142"
        transform="rotate(-8 490 330)"
        fill="none"
        stroke={`url(#${orbitGradient})`}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.82"
        filter={`url(#${glowFilter})`}
      />

      {/* AMBIENT GREEN LIGHT */}
      <ellipse
        cx="490"
        cy="350"
        rx="255"
        ry="155"
        fill="#39FF88"
        opacity="0.055"
        filter={`url(#${strongGlowFilter})`}
      />

      {/* BACKGROUND STARS */}
      <g filter={`url(#${starGlowFilter})`}>
        <circle cx="185" cy="265" r="3" fill="#FFFFFF" opacity="0.76" />
        <circle cx="260" cy="165" r="2" fill="#BFFFF0" opacity="0.7" />
        <circle cx="350" cy="105" r="2" fill="#39FF88" opacity="0.62" />
        <circle cx="505" cy="75" r="4" fill="#FFFFFF" opacity="0.94" />
        <circle cx="615" cy="115" r="2.2" fill="#BFFFF0" opacity="0.74" />
        <circle cx="735" cy="185" r="3" fill="#FFFFFF" opacity="0.76" />
        <circle cx="800" cy="290" r="2" fill="#39FF88" opacity="0.72" />
        <circle cx="720" cy="430" r="2.7" fill="#DFFFF0" opacity="0.7" />
        <circle cx="220" cy="430" r="2" fill="#FFFFFF" opacity="0.62" />
        <circle cx="145" cy="350" r="1.8" fill="#39FF88" opacity="0.64" />
      </g>

      {/* LARGE STAR FLARES */}
      <g filter={`url(#${starGlowFilter})`}>
        <path d="M505 54 L509 69 L524 74 L509 79 L505 94 L501 79 L486 74 L501 69 Z" fill="#FFFFFF" opacity="0.92" />
        <path d="M188 246 L191 257 L202 261 L191 265 L188 276 L185 265 L174 261 L185 257 Z" fill="#EFFFF7" opacity="0.78" />
        <path d="M742 172 L745 182 L755 186 L745 190 L742 200 L739 190 L729 186 L739 182 Z" fill="#BFFFF0" opacity="0.78" />
        <path d="M798 390 L800 398 L808 401 L800 404 L798 412 L796 404 L788 401 L796 398 Z" fill="#FFFFFF" opacity="0.66" />
      </g>

      {/* DIAMOND — CLASSIC BRILLIANT CUT: outer silhouette */}
      <path
        d="M252 292 L320 202 L660 202 L728 292 L626 365 L490 548 L354 365 Z"
        fill="#EFFFF7"
        fillOpacity="0.12"
        stroke="#F4FFF9"
        strokeOpacity="0.92"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />

      {/* Far left crown */}
      <path
        d="M252 292 L320 202 L354 250 L354 365 Z"
        fill={`url(#${crownGradient})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.68"
        strokeWidth="1.5"
      />

      {/* Far right crown */}
      <path
        d="M660 202 L728 292 L626 365 L626 250 Z"
        fill={`url(#${greenFacetGradient})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.68"
        strokeWidth="1.5"
      />

      {/* TABLE */}
      <path
        d="M354 216 L626 216 L654 292 L326 292 Z"
        fill={`url(#${diamondGradient})`}
        fillOpacity="0.96"
        stroke="#FFFFFF"
        strokeOpacity="0.9"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Table interior reflection */}
      <path d="M370 221 L610 221 L635 286 L345 286 Z" fill="#FFFFFF" fillOpacity="0.13" />

      {/* LEFT CROWN FACET */}
      <path
        d="M326 292 L354 216 L410 292 L354 365 Z"
        fill={`url(#${facetLightSafe})`}
        fillOpacity="0.88"
        stroke="#EFFFF7"
        strokeOpacity="0.62"
        strokeWidth="1.4"
      />

      {/* Left triangular reflection */}
      <path d="M410 292 L354 216 L490 292 L354 365 Z" fill="#FFFFFF" fillOpacity="0.2" />

      {/* RIGHT CROWN FACET */}
      <path
        d="M626 216 L654 292 L626 365 L570 292 Z"
        fill={`url(#${greenFacetGradient})`}
        fillOpacity="0.9"
        stroke="#EFFFF7"
        strokeOpacity="0.62"
        strokeWidth="1.4"
      />

      {/* Right triangular reflection */}
      <path d="M490 292 L626 216 L570 292 L626 365 Z" fill="#FFFFFF" fillOpacity="0.18" />

      {/* CENTRAL GLASS */}
      <path
        d="M410 292 L490 292 L570 292 L490 365 Z"
        fill={`url(#${darkGlassGradient})`}
        fillOpacity="0.7"
        stroke="#DFFFF0"
        strokeOpacity="0.56"
        strokeWidth="1.2"
      />

      {/* Central bright reflection */}
      <path d="M490 292 L570 292 L490 365 L450 328 Z" fill="#FFFFFF" fillOpacity="0.28" />

      {/* Central green reflection */}
      <path d="M410 292 L490 292 L450 328 L354 365 Z" fill="#39FF88" fillOpacity="0.16" />

      {/* GIRDLE */}
      <path
        d="M252 292 L728 292 L626 365 L490 365 L354 365 Z"
        fill="none"
        stroke="#EFFFF7"
        strokeOpacity="0.84"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* Girdle green reflection */}
      <path d="M252 292 L354 365 L490 365 L410 292 Z" fill="#BFFFF0" fillOpacity="0.12" />
      <path d="M490 365 L570 292 L728 292 L626 365 Z" fill="#39FF88" fillOpacity="0.1" />

      {/* PAVILION — left */}
      <path
        d="M354 365 L490 365 L490 548 Z"
        fill={`url(#${pavilionGradient})`}
        fillOpacity="0.94"
        stroke="#FFFFFF"
        strokeOpacity="0.7"
        strokeWidth="1.5"
      />

      {/* PAVILION — right */}
      <path
        d="M490 365 L626 365 L490 548 Z"
        fill={`url(#${pavilionGradient})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.7"
        strokeWidth="1.5"
      />

      {/* Pavilion left glass reflection */}
      <path d="M354 365 L422 405 L490 548 Z" fill="#FFFFFF" fillOpacity="0.26" />

      {/* Pavilion right green reflection */}
      <path d="M626 365 L558 405 L490 548 Z" fill="#39FF88" fillOpacity="0.22" />

      {/* Deep inner pavilion */}
      <path d="M490 365 L555 365 L490 530 L457 430 Z" fill="#063321" fillOpacity="0.25" />

      {/* Long central light reflection */}
      <path d="M410 292 L490 365 L490 530 L448 435 Z" fill="#FFFFFF" fillOpacity="0.3" />

      {/* Pavilion center line */}
      <path d="M490 365 L490 548" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" />

      {/* Lower silhouette */}
      <path
        d="M354 365 L490 548 L626 365"
        fill="none"
        stroke="#F4FFF9"
        strokeOpacity="0.82"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* CRYSTAL HIGHLIGHTS */}
      <path d="M320 202 L660 202" stroke="#FFFFFF" strokeOpacity="0.92" strokeWidth="2.5" strokeLinecap="round" />

      <path
        d="M252 292 L320 202 L660 202 L728 292"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.72"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Bright left edge */}
      <path d="M252 292 L354 365" stroke="#FFFFFF" strokeOpacity="0.78" strokeWidth="2" />

      {/* Bright right edge */}
      <path d="M728 292 L626 365" stroke="#DFFFF0" strokeOpacity="0.76" strokeWidth="2" />

      {/* FRONT ORBIT */}
      <path
        d="M88 376 C130 466 275 500 415 464 C555 428 720 342 884 232"
        fill="none"
        stroke={`url(#${orbitGradient})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.98"
        filter={`url(#${glowFilter})`}
      />

      {/* Bright core of orbit */}
      <path
        d="M88 376 C130 462 270 492 400 465"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.52"
        strokeWidth="1.3"
        strokeLinecap="round"
      />

      {/* Orbit endpoint glow */}
      <g filter={`url(#${starGlowFilter})`}>
        <circle cx="88" cy="376" r="4" fill="#FFFFFF" opacity="0.92" />
        <circle cx="884" cy="232" r="3" fill="#BFFFF0" opacity="0.82" />
      </g>

      {/* FINAL DIAMOND SPARK */}
      <g filter={`url(#${strongGlowFilter})`}>
        <path
          d="M490 528 L495 543 L510 548 L495 553 L490 568 L485 553 L470 548 L485 543 Z"
          fill="#FFFFFF"
          opacity="0.82"
        />
      </g>
    </svg>
  );
}
