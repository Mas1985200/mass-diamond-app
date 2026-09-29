import { useId, type SVGProps } from "react";

export interface DiamondMarkProps
  extends Omit<SVGProps<SVGSVGElement>, "width" | "height" | "children"> {
  readonly size: number | string;
  readonly title?: string;
}

export default function DiamondMark({
  size,
  className,
  style,
  title,
  ...svgProps
}: DiamondMarkProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");

  const glowId = `${id}-glow`;
  const diamondId = `${id}-diamond`;
  const crownId = `${id}-crown`;
  const leftFacetId = `${id}-left-facet`;
  const rightFacetId = `${id}-right-facet`;
  const centerFacetId = `${id}-center-facet`;
  const orbitId = `${id}-orbit`;
  const orbitGlowId = `${id}-orbit-glow`;
  const diamondGlowId = `${id}-diamond-glow`;
  const starGlowId = `${id}-star-glow`;
  const titleId = `${id}-title`;

  const resolvedSize = typeof size === "number" ? `${size}px` : size;

  return (
    <svg
      {...svgProps}
      width={resolvedSize}
      height={resolvedSize}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        display: "block",
        overflow: "visible",
        ...style,
      }}
      role={title ? "img" : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title id={titleId}>{title}</title> : null}

      <defs>
        <radialGradient id={glowId} cx="120" cy="116" r="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0.34" />
          <stop offset="0.28" stopColor="#39FF88" stopOpacity="0.18" />
          <stop offset="0.58" stopColor="#39FF88" stopOpacity="0.07" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={diamondId} x1="87" y1="54" x2="151" y2="194" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.13" stopColor="#E7FFF1" />
          <stop offset="0.34" stopColor="#A6FFCA" />
          <stop offset="0.58" stopColor="#39FF88" />
          <stop offset="0.82" stopColor="#13C964" />
          <stop offset="1" stopColor="#056D38" />
        </linearGradient>

        <linearGradient id={crownId} x1="71" y1="70" x2="169" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.22" stopColor="#DFFFF0" />
          <stop offset="0.48" stopColor="#8DFFBA" />
          <stop offset="0.76" stopColor="#39FF88" />
          <stop offset="1" stopColor="#16C96A" />
        </linearGradient>

        <linearGradient id={leftFacetId} x1="74" y1="96" x2="119" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#CFFFF0" />
          <stop offset="0.24" stopColor="#75FFAC" />
          <stop offset="0.58" stopColor="#25E477" />
          <stop offset="1" stopColor="#06773D" />
        </linearGradient>

        <linearGradient id={rightFacetId} x1="166" y1="95" x2="123" y2="190" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E1FFF0" />
          <stop offset="0.25" stopColor="#7BFFAF" />
          <stop offset="0.58" stopColor="#20DB70" />
          <stop offset="1" stopColor="#056C37" />
        </linearGradient>

        <linearGradient id={centerFacetId} x1="120" y1="99" x2="120" y2="194" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F4FFF8" />
          <stop offset="0.18" stopColor="#A5FFCA" />
          <stop offset="0.48" stopColor="#39FF88" />
          <stop offset="0.78" stopColor="#13B95B" />
          <stop offset="1" stopColor="#08743C" />
        </linearGradient>

        <linearGradient id={orbitId} x1="35" y1="132" x2="205" y2="95" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#39FF88" stopOpacity="0" />
          <stop offset="0.15" stopColor="#39FF88" stopOpacity="0.48" />
          <stop offset="0.32" stopColor="#7AFFB0" stopOpacity="0.88" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="0.68" stopColor="#7AFFB0" stopOpacity="0.88" />
          <stop offset="0.86" stopColor="#39FF88" stopOpacity="0.48" />
          <stop offset="1" stopColor="#39FF88" stopOpacity="0" />
        </linearGradient>

        <filter id={diamondGlowId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>

        <filter id={orbitGlowId} x="-60%" y="-120%" width="220%" height="340%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>

        <filter id={starGlowId} x="-500%" y="-500%" width="1100%" height="1100%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      <ellipse cx="120" cy="120" rx="91" ry="88" fill={`url(#${glowId})`} />

      <path
        d="M120 43 L178 78 L164 109 L153 171 L120 198 L87 171 L76 109 L62 78 Z"
        fill="#39FF88"
        opacity="0.18"
        filter={`url(#${diamondGlowId})`}
      />

      <ellipse
        cx="120"
        cy="119"
        rx="91"
        ry="31"
        transform="rotate(-21 120 119)"
        stroke="#39FF88"
        strokeWidth="5"
        strokeOpacity="0.22"
        filter={`url(#${orbitGlowId})`}
      />

      <ellipse
        cx="120"
        cy="119"
        rx="91"
        ry="31"
        transform="rotate(-21 120 119)"
        stroke={`url(#${orbitId})`}
        strokeWidth="2"
        strokeLinecap="round"
      />

      <g>
        <circle cx="46" cy="80" r="1.4" fill="#FFFFFF" opacity="0.9" />
        <circle cx="46" cy="80" r="5" fill="#39FF88" opacity="0.3" filter={`url(#${starGlowId})`} />
        <circle cx="67" cy="51" r="1" fill="#39FF88" opacity="0.8" />
        <circle cx="176" cy="48" r="1.2" fill="#FFFFFF" opacity="0.8" />
        <circle cx="198" cy="78" r="1.1" fill="#39FF88" opacity="0.9" />
        <circle cx="208" cy="119" r="1.2" fill="#DFFFF0" opacity="0.8" />
        <circle cx="48" cy="132" r="0.9" fill="#39FF88" opacity="0.75" />
        <circle cx="68" cy="176" r="1.2" fill="#FFFFFF" opacity="0.7" />
        <circle cx="176" cy="179" r="1.1" fill="#39FF88" opacity="0.8" />
        <circle cx="194" cy="149" r="0.9" fill="#FFFFFF" opacity="0.7" />
      </g>

      <path
        d="M120 47 L175 79 L163 105 L153 169 L120 194 L87 169 L77 105 L65 79 Z"
        fill={`url(#${diamondId})`}
        stroke="#DFFFF0"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />

      <polygon
        points="65,79 91,61 120,47 149,61 175,79 163,101 120,108 77,101"
        fill={`url(#${crownId})`}
      />
      <polygon points="65,79 91,61 120,108 77,101" fill="#E8FFF2" opacity="0.58" />
      <polygon points="91,61 120,47 120,108" fill="#FFFFFF" opacity="0.48" />
      <polygon points="120,47 149,61 175,79 163,101 120,108" fill="#63FFA0" opacity="0.48" />

      <polygon points="77,101 120,108 120,194 87,169" fill={`url(#${leftFacetId})`} />
      <polygon points="120,108 163,101 153,169 120,194" fill={`url(#${rightFacetId})`} />
      <polygon
        points="77,101 120,108 163,101 120,194"
        fill={`url(#${centerFacetId})`}
        opacity="0.74"
      />
      <polygon points="120,108 143,127 120,194" fill="#078D46" opacity="0.58" />
      <polygon points="77,101 102,111 120,194 87,169" fill="#C9FFE0" opacity="0.28" />
      <polygon points="163,101 138,111 120,194 153,169" fill="#39FF88" opacity="0.3" />

      <path
        d="M65 79L120 47L175 79"
        stroke="#FFFFFF"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path d="M77 101L120 108L163 101" stroke="#EFFFF5" strokeWidth="1.1" opacity="0.7" />
      <path d="M120 108V194" stroke="#FFFFFF" strokeWidth="1" opacity="0.5" />
      <path d="M91 61L120 108L149 61" stroke="#FFFFFF" strokeWidth="0.95" opacity="0.58" />
      <path d="M77 101L87 169L120 194" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.4" />
      <path d="M163 101L153 169L120 194" stroke="#FFFFFF" strokeWidth="0.8" opacity="0.34" />

      <path d="M91 61 L120 47 L120 108 L77 101 L65 79 Z" fill="#FFFFFF" opacity="0.16" />
      <path d="M87 75L111 58" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.68" />
      <path d="M95 69L111 58" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" opacity="0.9" />

      <path
        d="M38 108 C57 91 86 78 119 77 C153 76 183 87 202 104"
        stroke="#39FF88"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.24"
        filter={`url(#${orbitGlowId})`}
      />
      <path
        d="M38 108 C57 91 86 78 119 77 C153 76 183 87 202 104"
        stroke={`url(#${orbitId})`}
        strokeWidth="2.1"
        strokeLinecap="round"
      />

      <circle cx="198" cy="101" r="2" fill="#FFFFFF" />
      <circle
        cx="198"
        cy="101"
        r="7"
        fill="#39FF88"
        opacity="0.28"
        filter={`url(#${starGlowId})`}
      />
    </svg>
  );
}
