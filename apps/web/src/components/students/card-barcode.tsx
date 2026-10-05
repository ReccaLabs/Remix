import { encodeCode128 } from '@/lib/code128';

export function CardBarcode({ code, label }: { code: string; label: string }) {
  const encoded = encodeCode128(code);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${encoded.width} 48`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className="h-full w-full"
    >
      <rect width={encoded.width} height={48} fill="var(--color-print-paper)" />
      <g fill="var(--color-print-ink)">
        {encoded.bars.map((bar) => (
          <rect key={bar.x} x={bar.x} width={bar.width} height={48} />
        ))}
      </g>
    </svg>
  );
}
