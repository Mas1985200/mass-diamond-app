import type { CSSProperties, ImgHTMLAttributes } from "react";

type DiamondMarkProps = {
  size: number | string;
  title?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "width" | "height" | "src" | "alt" | "title" | "className" | "style"
>;

const WIDTH_SCALE = 2.6;

export default function DiamondMark({
  size,
  title,
  className,
  style,
  ...rest
}: DiamondMarkProps) {
  const width =
    typeof size === "number" ? Math.round(size * WIDTH_SCALE) : size;

  return (
    <img
      {...rest}
      src="/mass-diamond-logo.png"
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      width={width}
      draggable={false}
      decoding="async"
      className={className}
      style={{
        display: "block",
        width,
        maxWidth: "100%",
        height: "auto",
        userSelect: "none",
        ...style,
      }}
    />
  );
}
