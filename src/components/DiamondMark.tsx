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
  const uid = useId().replace(/:/g, "");

  const numericSize =
    typeof size === "number" ? size : Number.parseFloat(size);

  const computedWidth = Number.isFinite(numericSize)
    ? numericSize * 2.5
    : size;

  const gradientId = `${uid}DiamondGradient`;
  const facetLightId = `${uid}FacetLight`;
  const facetGreenId = `${uid}FacetGreen`;
  const facetDarkId = `${uid}FacetDark`;
  const pavilionId = `${uid}Pavilion`;
  const orbitId = `${uid}Orbit`;
  const glowId = `${uid}Glow`;
  const starGlowId = `${uid}StarGlow`;
  const titleId = `${uid}Title`;

  return (
    <svg
      {...rest}
      width={computedWidth}
      height={size}
      viewBox="0 0 900 430"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: "block",
        width: computedWidth,
        maxWidth: "100%",
        minWidth: 0,
        height: "auto",
        overflow: "hidden",
        // 👇 اضافه شده: انیمیشن شناور بودن کل الماس
        animation: "floatDiamond 4s ease-in-out infinite",
        ...style,
      }}
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
    >
      {/* 👇 اضافه شده: استایل‌های انیمیشن */}
      <style>
        {`
          @keyframes floatDiamond {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
          }
          @keyframes orbitPulse {
            0%, 100% { opacity: 0.6; filter: drop-shadow(0 0 5px #39FF88); }
            50% { opacity: 1; filter: drop-shadow(0 0 15px #39FF88); }
          }
        `}
      </style>

      {title ? <title id={titleId}>{title}</title> : null}

      <defs>
        <linearGradient id={gradientId} x1="275" y1="135" x2="625" y2="345" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.2" stopColor="#E9FFF5" stopOpacity="0.94" />
          <stop offset="0.42" stopColor="#8DFFBE" stopOpacity="0.82" />
          <stop offset="0.62" stopColor="#FFFFFF" stopOpacity="0.94" />
          <stop offset="0.82" stopColor="#53FF9C" stopOpacity="0.7" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.96" />
        </linearGradient>

        <linearGradient id={facetLightId} x1="270" y1="145" x2="430" y2="350" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.3" stopColor="#D8FFEB" stopOpacity="0.9" />
          <stop offset="0.62" stopColor="#79FFB5" stopOpacity="0.68" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
        </linearGradient>

        <linearGradient id={facetGreenId} x1="440" y1="140" x2="570" y2="350" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.3" stopColor="#BFFFF0" stopOpacity="0.88" />
          <stop offset="0.55" stopColor="#39FF88" stopOpacity="0.64" />
          <stop offset="0.82" stopColor="#E8FFF5" stopOpacity="0.92" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.82" />
        </linearGradient>

        <linearGradient id={facetDarkId} x1="360" y1="170" x2="540" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#CFFFF0" stopOpacity="0.5" />
          <stop offset="0.35" stopColor="#123F31" stopOpacity="0.42" />
          <stop offset="0.62" stopColor="#05271B" stopOpacity="0.52" />
          <stop offset="1" stopColor="#8DFFC3" stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id={pavilionId} x1="320" y1="250" x2="580" y2="365" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.94" />
          <stop offset="0.22" stopColor="#CFFFF0" stopOpacity="0.78" />
          <stop offset="0.45" stopColor="#39FF88" stopOpacity="0.56" />
          <stop offset="0.67" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="0.84" stopColor="#5CFFA4" stopOpacity="0.62" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.94" />
        </linearGradient>

        <linearGradient id={orbitId} x1="100" y1="340" x2="800" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0.22" />
          <stop offset="0.12" stopColor="#9DFFC9" stopOpacity="0.82" />
          <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.5" stopColor="#39FF88" stopOpacity="0.96" />
          <stop offset="0.72" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="0.9" stopColor="#8DFFBE" stopOpacity="0.8" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0.18" />
        </linearGradient>

        <filter id={glowId} x="-40%" y="-80%" width="180%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id={starGlowId} x="-200%" y="-200%" width="400%" height="400%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Rear half of the orbital ring */}
      <ellipse
        cx="450"
        cy="226"
        rx="352"
        ry="105"
        transform="rotate(-8 450 226)"
        fill="none"
        stroke={`url(#${orbitId})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.82"
        filter={`url(#${glowId})`}
        // 👇 اضافه شده: انیمیشن نبض برای حلقه
        style={{ animation: "orbitPulse 3s ease-in-out infinite" }}
      />

      {/* Soft ambient glow */}
      <ellipse
        cx="450"
        cy="235"
        rx="215"
        ry="105"
        fill="#39FF88"
        opacity="0.045"
        filter={`url(#${glowId})`}
      />

      {/* Floating light particles */}
      <g filter={`url(#${starGlowId})`}>
        <circle cx="190" cy="195" r="2.8" fill="#FFFFFF" opacity="0.78" />
        <circle cx="254" cy="122" r="2" fill="#BFFFF0" opacity="0.68" />
        <circle cx="335" cy="82" r="1.7" fill="#39FF88" opacity="0.56" />
        <circle cx="463" cy="72" r="3.8" fill="#FFFFFF" opacity="0.92" />
        <circle cx="572" cy="104" r="2.1" fill="#BFFFF0" opacity="0.72" />
        <circle cx="672" cy="160" r="2.8" fill="#FFFFFF" opacity="0.68" />
        <circle cx="730" cy="257" r="1.8" fill="#39FF88" opacity="0.72" />
        <circle cx="654" cy="330" r="2.6" fill="#DFFFF0" opacity="0.68" />
        <circle cx="232" cy="318" r="2" fill="#FFFFFF" opacity="0.64" />
        <circle cx="145" cy="275" r="1.7" fill="#39FF88" opacity="0.66" />
      </g>

      {/* Larger four-point stars */}
      <g filter={`url(#${starGlowId})`}>
        <path d="M462 58 L466 69 L477 73 L466 77 L462 89 L458 77 L447 73 L458 69 Z" fill="#FFFFFF" opacity="0.9" />
        <path d="M190 181 L193 190 L202 193 L193 196 L190 205 L187 196 L178 193 L187 190 Z" fill="#EFFFF7" opacity="0.72" />
        <path d="M681 143 L684 151 L692 154 L684 157 L681 165 L678 157 L670 154 L678 151 Z" fill="#BFFFF0" opacity="0.78" />
      </g>

      {/* Diamond silhouette — wide brilliant-cut proportions */}
      <path
        d="M250 198 L305 135 L595 135 L650 198 L575 266 L450 365 L325 266 Z"
        fill="#F0FFF8"
        fillOpacity="0.2"
        stroke="#EFFFF7"
        strokeOpacity="0.9"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* Crown left outer facet */}
      <path
        d="M250 198 L305 135 L335 170 L325 266 Z"
        fill={`url(#${facetLightId})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.62"
        strokeWidth="1.3"
      />

      {/* Crown right outer facet */}
      <path
        d="M595 135 L650 198 L575 266 L565 170 Z"
        fill={`url(#${facetGreenId})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.62"
        strokeWidth="1.3"
      />

      {/* Broad table */}
      <path
        d="M335 151 L565 151 L585 198 L315 198 Z"
        fill={`url(#${gradientId})`}
        fillOpacity="0.94"
        stroke="#FFFFFF"
        strokeOpacity="0.86"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />

      {/* Table glass reflection */}
      <path d="M350 156 L550 156 L570 193 L330 193 Z" fill="#FFFFFF" fillOpacity="0.15" />

      {/* Left upper star facet */}
      <path
        d="M315 198 L335 151 L390 198 L325 266 Z"
        fill={`url(#${facetLightId})`}
        fillOpacity="0.82"
        stroke="#EFFFF7"
        strokeOpacity="0.6"
        strokeWidth="1.2"
      />

      {/* Left inner crown reflection */}
      <path d="M390 198 L335 151 L450 198 L325 266 Z" fill="#FFFFFF" fillOpacity="0.17" />

      {/* Right upper star facet */}
      <path
        d="M565 151 L585 198 L575 266 L510 198 Z"
        fill={`url(#${facetGreenId})`}
        fillOpacity="0.82"
        stroke="#EFFFF7"
        strokeOpacity="0.6"
        strokeWidth="1.2"
      />

      {/* Right inner crown reflection */}
      <path d="M450 198 L565 151 L510 198 L575 266 Z" fill="#FFFFFF" fillOpacity="0.16" />

      {/* Central transparent body */}
      <path
        d="M390 198 L450 198 L510 198 L450 266 Z"
        fill={`url(#${facetDarkId})`}
        fillOpacity="0.62"
        stroke="#DFFFF0"
        strokeOpacity="0.5"
        strokeWidth="1.1"
      />

      {/* Central glass reflection */}
      <path d="M450 198 L510 198 L450 266 L420 235 Z" fill="#FFFFFF" fillOpacity="0.23" />

      {/* Girdle band */}
      <path
        d="M250 198 L650 198 L575 266 L450 266 L325 266 Z"
        fill="none"
        stroke="#DFFFF0"
        strokeOpacity="0.82"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Lower girdle facets */}
      <path d="M250 198 L325 266 L450 266 L390 198 Z" fill="#CFFFF0" fillOpacity="0.16" />
      <path d="M450 266 L510 198 L650 198 L575 266 Z" fill="#39FF88" fillOpacity="0.12" />

      {/* Wide pavilion — intentionally shorter and broader */}
      <path
        d="M325 266 L450 266 L450 365 Z"
        fill={`url(#${pavilionId})`}
        fillOpacity="0.9"
        stroke="#FFFFFF"
        strokeOpacity="0.62"
        strokeWidth="1.3"
      />

      <path
        d="M450 266 L575 266 L450 365 Z"
        fill={`url(#${pavilionId})`}
        fillOpacity="0.86"
        stroke="#FFFFFF"
        strokeOpacity="0.62"
        strokeWidth="1.3"
      />

      {/* Pavilion central depth */}
      <path d="M450 266 L505 266 L450 353 L425 310 Z" fill="#103C2D" fillOpacity="0.24" />

      {/* Left pavilion reflection */}
      <path d="M325 266 L390 295 L450 365 Z" fill="#FFFFFF" fillOpacity="0.25" />

      {/* Right pavilion reflection */}
      <path d="M575 266 L510 295 L450 365 Z" fill="#39FF88" fillOpacity="0.2" />

      {/* Long glass highlight */}
      <path d="M390 198 L450 266 L450 350 L420 310 Z" fill="#FFFFFF" fillOpacity="0.28" />

      {/* Pavilion central seam */}
      <path d="M450 266 L450 365" stroke="#FFFFFF" strokeOpacity="0.48" strokeWidth="1.3" />

      {/* Outer lower silhouette */}
      <path
        d="M325 266 L450 365 L575 266"
        fill="none"
        stroke="#EFFFF7"
        strokeOpacity="0.78"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      {/* Upper crisp silhouette */}
      <path
        d="M250 198 L305 135 L595 135 L650 198"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.88"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Front half of the orbital ring */}
      <path
        d="M100 286 C135 349 260 380 385 353 C505 328 655 265 800 170"
        fill="none"
        stroke={`url(#${orbitId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
        opacity="0.96"
        filter={`url(#${glowId})`}
      />

      {/* Fine bright core of front orbit */}
      <path
        d="M101 286 C139 344 255 372 370 353"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.52"
        strokeWidth="1.15"
        strokeLinecap="round"
      />

      {/* Small foreground orbit sparkles */}
      <g filter={`url(#${starGlowId})`}>
        <circle cx="103" cy="286" r="3" fill="#FFFFFF" opacity="0.9" />
        <circle cx="791" cy="176" r="2.4" fill="#BFFFF0" opacity="0.82" />
        <circle cx="706" cy="313" r="2.1" fill="#FFFFFF" opacity="0.72" />
      </g>
    </svg>
  );
}
