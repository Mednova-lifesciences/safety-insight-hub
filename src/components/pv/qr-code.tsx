import { useMemo } from "react";
import { encodeQr, qrSvgPath } from "@/lib/qr-code";

/** A QR code for `value`, drawn as an SVG (dark on white, quiet zone included). */
export function QrCode({
  value,
  size = 192,
  title,
}: {
  value: string;
  size?: number;
  title?: string;
}) {
  const { path, size: n } = useMemo(() => qrSvgPath(encodeQr(value)), [value]);
  return (
    <svg
      role="img"
      aria-label={title ?? `QR code for ${value}`}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="rounded-sm"
    >
      <rect width={n} height={n} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
