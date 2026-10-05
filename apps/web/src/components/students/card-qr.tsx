import { encode } from 'uqr';

/** SVG primitives only: no injected markup or remote QR service. */
export function CardQr({ code, label }: { code: string; label: string }) {
  const qr = encode(code, { ecc: 'M', border: 0 });
  const size = qr.size + 8;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="var(--color-print-paper)" />
      <g fill="var(--color-print-ink)">
        {qr.data.flatMap((row, y) =>
          row.flatMap((dark, x) =>
            dark ? [<rect key={`${x}-${y}`} x={x + 4} y={y + 4} width={1} height={1} />] : [],
          ),
        )}
      </g>
    </svg>
  );
}
