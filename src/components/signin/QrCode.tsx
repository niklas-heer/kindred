// A QR code drawn as an SVG (src/lib/qr/qrcode.ts): dark modules on a white square with its quiet zone, in light and dark
// themes alike, so a phone's camera reads it. `label` says what it holds, for a screen reader.
import { useMemo } from 'react';
import { encodeText, svgPath } from '~/lib/qr/qrcode';

export function QrCode({ text, label, size = 184 }: { text: string; label: string; size?: number }) {
  const { path, extent } = useMemo(() => {
    const qr = encodeText(text, 'M');
    return { path: svgPath(qr, 4), extent: qr.size + 8 };
  }, [text]);
  return (
    <svg className="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} shapeRendering="crispEdges">
      <rect width={extent} height={extent} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
