import { useId, type SVGProps } from "react";

export interface DiamondMarkProps
  extends Omit<
    SVGProps<SVGSVGElement>,
    "width" | "height" | "children"
  > {
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

  const auraId = `${id}-aura`;
  const auraStrongId = `${id}-aura-strong`;
  const diamondGlowId = `${id}-diamond-glow`;
  const orbitGlowId = `${id}-orbit-glow`;
  const starGlowId = `${id}-star-glow`;

  const crownGradientId = `${id}-crown`;
  const leftGradientId = `${id}-left`;
  const rightGradientId = `${id}-right`;
  const centerGradientId = `${id}-center`;
  const deepGradientId = `${id}-deep`;
  const orbitGradientId = `${id}-orbit`;

  const titleId = `${id}-title`;

  const resolvedSize =
    typeof size === "number" ? `${size}px` : size;

  return (
    <svg
      {...svgProps}
      width={resolvedSize}
      height={resolvedSize}
      viewBox="0 0 360 300"
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
        {/* =========================================================
            SOFT GREEN ATMOSPHERE
        ========================================================== */}

        <radialGradient
          id={auraId}
          cx="180"
          cy="145"
          r="145"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stopColor="#39FF88"
            stopOpacity="0.34"
          />
          <stop
            offset="0.28"
            stopColor="#39FF88"
            stopOpacity="0.18"
          />
          <stop
            offset="0.56"
            stopColor="#39FF88"
            stopOpacity="0.06"
          />
          <stop
            offset="1"
            stopColor="#39FF88"
            stopOpacity="0"
          />
        </radialGradient>

        <radialGradient
          id={auraStrongId}
          cx="180"
          cy="145"
          r="92"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stopColor="#CFFFF0"
            stopOpacity="0.26"
          />
          <stop
            offset="0.3"
            stopColor="#39FF88"
            stopOpacity="0.18"
          />
          <stop
            offset="0.72"
            stopColor="#39FF88"
            stopOpacity="0.04"
          />
          <stop
            offset="1"
            stopColor="#39FF88"
            stopOpacity="0"
          />
        </radialGradient>

        {/* =========================================================
            DIAMOND GRADIENTS
        ========================================================== */}

        <linearGradient
          id={crownGradientId}
          x1="72"
          y1="82"
          x2="282"
          y2="126"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#9DFFBE" />
          <stop offset="0.18" stopColor="#F5FFFA" />
          <stop offset="0.38" stopColor="#B8FFD5" />
          <stop offset="0.52" stopColor="#FFFFFF" />
          <stop offset="0.68" stopColor="#82FFB4" />
          <stop offset="0.86" stopColor="#DFFFF0" />
          <stop offset="1" stopColor="#32EA7B" />
        </linearGradient>

        <linearGradient
          id={leftGradientId}
          x1="90"
          y1="112"
          x2="176"
          y2="266"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#EFFFF7" />
          <stop offset="0.18" stopColor="#B9FFD7" />
          <stop offset="0.4" stopColor="#72FFA9" />
          <stop offset="0.66" stopColor="#28E878" />
          <stop offset="1" stopColor="#087A40" />
        </linearGradient>

        <linearGradient
          id={rightGradientId}
          x1="270"
          y1="111"
          x2="181"
          y2="266"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#DFFFF0" />
          <stop offset="0.2" stopColor="#A5FFCA" />
          <stop offset="0.42" stopColor="#5AFF9C" />
          <stop offset="0.68" stopColor="#1CD66B" />
          <stop offset="1" stopColor="#056E39" />
        </linearGradient>

        <linearGradient
          id={centerGradientId}
          x1="180"
          y1="105"
          x2="180"
          y2="270"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.16" stopColor="#DFFFF0" />
          <stop offset="0.36" stopColor="#8BFFB9" />
          <stop offset="0.6" stopColor="#39FF88" />
          <stop offset="0.82" stopColor="#14C965" />
          <stop offset="1" stopColor="#056E39" />
        </linearGradient>

        <linearGradient
          id={deepGradientId}
          x1="180"
          y1="111"
          x2="180"
          y2="267"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stopColor="#F4FFF8"
            stopOpacity="0.9"
          />
          <stop
            offset="0.32"
            stopColor="#6DFFA7"
            stopOpacity="0.76"
          />
          <stop
            offset="0.72"
            stopColor="#17D66D"
            stopOpacity="0.72"
          />
          <stop
            offset="1"
            stopColor="#056C38"
            stopOpacity="0.96"
          />
        </linearGradient>

        {/* =========================================================
            ORBIT GRADIENT
        ========================================================== */}

        <linearGradient
          id={orbitGradientId}
          x1="42"
          y1="204"
          x2="315"
          y2="90"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stopColor="#39FF88"
            stopOpacity="0"
          />
          <stop
            offset="0.11"
            stopColor="#39FF88"
            stopOpacity="0.72"
          />
          <stop
            offset="0.27"
            stopColor="#8DFFBB"
            stopOpacity="0.95"
          />
          <stop
            offset="0.5"
            stopColor="#FFFFFF"
            stopOpacity="1"
          />
          <stop
            offset="0.73"
            stopColor="#8DFFBB"
            stopOpacity="0.95"
          />
          <stop
            offset="0.89"
            stopColor="#39FF88"
            stopOpacity="0.72"
          />
          <stop
            offset="1"
            stopColor="#39FF88"
            stopOpacity="0"
          />
        </linearGradient>

        {/* =========================================================
            GLOWS
        ========================================================== */}

        <filter
          id={diamondGlowId}
          x="-70%"
          y="-70%"
          width="240%"
          height="240%"
        >
          <feGaussianBlur stdDeviation="8" />
        </filter>

        <filter
          id={orbitGlowId}
          x="-60%"
          y="-120%"
          width="220%"
          height="340%"
        >
          <feGaussianBlur stdDeviation="4.5" />
        </filter>

        <filter
          id={starGlowId}
          x="-600%"
          y="-600%"
          width="1300%"
          height="1300%"
        >
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>

      {/* ===========================================================
          AMBIENT LIGHT
      ============================================================ */}

      <ellipse
        cx="180"
        cy="145"
        rx="150"
        ry="138"
        fill={`url(#${auraId})`}
      />

      <ellipse
        cx="180"
        cy="151"
        rx="94"
        ry="100"
        fill={`url(#${auraStrongId})`}
      />

      {/* ===========================================================
          BACK HALF OF SATURN-LIKE ORBIT
      ============================================================ */}

      <path
        d="
          M42 184
          C69 135 120 92 177 83
          C228 75 283 94 314 123
        "
        stroke="#39FF88"
        strokeWidth="8"
        strokeLinecap="round"
        opacity="0.25"
        filter={`url(#${orbitGlowId})`}
      />

      <path
        d="
          M42 184
          C69 135 120 92 177 83
          C228 75 283 94 314 123
        "
        stroke={`url(#${orbitGradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* ===========================================================
          STARS / LIGHT PARTICLES
      ============================================================ */}

      <g>
        <circle
          cx="76"
          cy="106"
          r="1.4"
          fill="#FFFFFF"
        />
        <circle
          cx="76"
          cy="106"
          r="6"
          fill="#39FF88"
          opacity="0.28"
          filter={`url(#${starGlowId})`}
        />

        <circle
          cx="104"
          cy="72"
          r="1"
          fill="#39FF88"
          opacity="0.8"
        />

        <circle
          cx="206"
          cy="55"
          r="1.5"
          fill="#FFFFFF"
          opacity="0.95"
        />
        <circle
          cx="206"
          cy="55"
          r="7"
          fill="#39FF88"
          opacity="0.3"
          filter={`url(#${starGlowId})`}
        />

        <circle
          cx="253"
          cy="72"
          r="1"
          fill="#39FF88"
          opacity="0.82"
        />

        <circle
          cx="292"
          cy="109"
          r="1.2"
          fill="#FFFFFF"
          opacity="0.84"
        />

        <circle
          cx="60"
          cy="160"
          r="1"
          fill="#DFFFF0"
          opacity="0.76"
        />

        <circle
          cx="84"
          cy="216"
          r="1.1"
          fill="#39FF88"
          opacity="0.82"
        />

        <circle
          cx="268"
          cy="220"
          r="1.1"
          fill="#FFFFFF"
          opacity="0.72"
        />

        <circle
          cx="296"
          cy="181"
          r="1"
          fill="#39FF88"
          opacity="0.78"
        />
      </g>

      {/* ===========================================================
          DIAMOND OUTER GLOW
      ============================================================ */}

      <path
        d="
          M73 105
          L107 78
          L180 66
          L253 78
          L287 105
          L263 133
          L239 202
          L180 270
          L121 202
          L97 133
          Z
        "
        fill="#39FF88"
        opacity="0.22"
        filter={`url(#${diamondGlowId})`}
      />

      {/* ===========================================================
          MAIN DIAMOND BODY
      ============================================================ */}

      <path
        d="
          M73 105
          L107 78
          L180 66
          L253 78
          L287 105
          L263 133
          L239 202
          L180 270
          L121 202
          L97 133
          Z
        "
        fill={`url(#${centerGradientId})`}
        stroke="#EFFFF7"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* ===========================================================
          UPPER CROWN
      ============================================================ */}

      <polygon
        points="
          73,105
          107,78
          180,66
          253,78
          287,105
          263,128
          180,137
          97,128
        "
        fill={`url(#${crownGradientId})`}
      />

      {/* Left crown facets */}
      <polygon
        points="73,105 107,78 135,121 97,128"
        fill="#EFFFF7"
        opacity="0.72"
      />

      <polygon
        points="107,78 180,66 155,123 135,121"
        fill="#FFFFFF"
        opacity="0.56"
      />

      {/* Upper center facet */}
      <polygon
        points="180,66 205,123 155,123"
        fill="#CFFFF0"
        opacity="0.76"
      />

      {/* Right upper facets */}
      <polygon
        points="180,66 253,78 225,121 205,123"
        fill="#8BFFB9"
        opacity="0.58"
      />

      <polygon
        points="253,78 287,105 263,128 225,121"
        fill="#5CFFA0"
        opacity="0.68"
      />

      {/* ===========================================================
          UPPER INTERNAL FACETS
      ============================================================ */}

      <polygon
        points="97,128 135,121 180,137"
        fill="#39FF88"
        opacity="0.38"
      />

      <polygon
        points="135,121 155,123 180,137"
        fill="#FFFFFF"
        opacity="0.48"
      />

      <polygon
        points="155,123 205,123 180,137"
        fill="#EFFFF7"
        opacity="0.38"
      />

      <polygon
        points="205,123 225,121 263,128 180,137"
        fill="#39FF88"
        opacity="0.38"
      />

      {/* ===========================================================
          LEFT LOWER CRYSTAL
      ============================================================ */}

      <polygon
        points="97,128 180,137 180,270 121,202"
        fill={`url(#${leftGradientId})`}
      />

      <polygon
        points="97,128 135,121 180,270 121,202"
        fill="#DFFFF0"
        opacity="0.34"
      />

      <polygon
        points="97,128 121,202 151,238 135,121"
        fill="#72FFAA"
        opacity="0.46"
      />

      <polygon
        points="135,121 155,123 180,270"
        fill="#FFFFFF"
        opacity="0.23"
      />

      {/* ===========================================================
          RIGHT LOWER CRYSTAL
      ============================================================ */}

      <polygon
        points="180,137 263,128 239,202 180,270"
        fill={`url(#${rightGradientId})`}
      />

      <polygon
        points="225,121 263,128 239,202 180,270"
        fill="#B7FFD5"
        opacity="0.28"
      />

      <polygon
        points="205,123 225,121 180,270"
        fill="#F1FFF7"
        opacity="0.28"
      />

      <polygon
        points="180,137 239,202 208,239 180,270"
        fill="#12C762"
        opacity="0.4"
      />

      {/* ===========================================================
          CENTRAL DEEP FACET
      ============================================================ */}

      <polygon
        points="155,123 205,123 180,270"
        fill={`url(#${deepGradientId})`}
        opacity="0.94"
      />

      <polygon
        points="180,137 205,123 180,270"
        fill="#056D39"
        opacity="0.46"
      />

      <polygon
        points="155,123 180,137 180,270"
        fill="#B5FFD3"
        opacity="0.22"
      />

      {/* ===========================================================
          CRYSTAL EDGE LINES
      ============================================================ */}

      <path
        d="M73 105L107 78L180 66L253 78L287 105"
        stroke="#FFFFFF"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.96"
      />

      <path
        d="M73 105L97 128L180 137L263 128L287 105"
        stroke="#F2FFF8"
        strokeWidth="1.15"
        strokeLinejoin="round"
        opacity="0.72"
      />

      <path
        d="M107 78L135 121L180 137"
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity="0.7"
      />

      <path
        d="M180 66L155 123L180 137"
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity="0.62"
      />

      <path
        d="M180 66L205 123L180 137"
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity="0.54"
      />

      <path
        d="M253 78L225 121L180 137"
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity="0.58"
      />

      <path
        d="M97 128L121 202L180 270"
        stroke="#FFFFFF"
        strokeWidth="0.9"
        opacity="0.48"
      />

      <path
        d="M263 128L239 202L180 270"
        stroke="#FFFFFF"
        strokeWidth="0.9"
        opacity="0.42"
      />

      <path
        d="M180 137V270"
        stroke="#FFFFFF"
        strokeWidth="1"
        opacity="0.5"
      />

      {/* ===========================================================
          GLASS HIGHLIGHTS
      ============================================================ */}

      <path
        d="
          M107 78
          L180 66
          L155 123
          L135 121
          Z
        "
        fill="#FFFFFF"
        opacity="0.18"
      />

      <path
        d="
          M73 105
          L107 78
          L135 121
          L97 128
          Z
        "
        fill="#FFFFFF"
        opacity="0.2"
      />

      <path
        d="M101 96L127 81"
        stroke="#FFFFFF"
        strokeWidth="2.8"
        strokeLinecap="round"
        opacity="0.72"
      />

      <path
        d="M109 91L127 81"
        stroke="#FFFFFF"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.96"
      />

      {/* ===========================================================
          FRONT HALF OF ORBIT
          This creates the same wrapped-around-depth feeling.
      ============================================================ */}

      <path
        d="
          M42 184
          C70 218 122 226 174 209
          C226 192 271 157 314 123
        "
        stroke="#39FF88"
        strokeWidth="8"
        strokeLinecap="round"
        opacity="0.27"
        filter={`url(#${orbitGlowId})`}
      />

      <path
        d="
          M42 184
          C70 218 122 226 174 209
          C226 192 271 157 314 123
        "
        stroke={`url(#${orbitGradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* ===========================================================
          BRIGHT ORBIT TIP
      ============================================================ */}

      <circle
        cx="314"
        cy="123"
        r="2.4"
        fill="#FFFFFF"
      />

      <circle
        cx="314"
        cy="123"
        r="8"
        fill="#39FF88"
        opacity="0.35"
        filter={`url(#${starGlowId})`}
      />
    </svg>
  );
}
