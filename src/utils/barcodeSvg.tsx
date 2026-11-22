interface BarcodeGraphicProps {
  code: string;
  height?: number;
  className?: string;
}

/**
 * Deterministic crisp vector barcode renderer (SVG) for retail shelf & sticker printing.
 * Encodes digits/ASCII characters into high-contrast bar/space patterns with start/stop guards.
 */
export function BarcodeGraphic({ code, height = 38, className = '' }: BarcodeGraphicProps) {
  const clean = (code || '6220000000000').trim();
  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 4;

  // Left guard bars
  bars.push({ x: cursor, w: 2 });
  cursor += 4;
  bars.push({ x: cursor, w: 2 });
  cursor += 4;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    // Generate 4 deterministic widths per character (2 bars, 2 spaces)
    const b1 = ((ch * 7 + i * 3) % 3) + 1;
    const s1 = ((ch * 5 + i * 2) % 2) + 1;
    const b2 = ((ch * 11 + i) % 3) + 1;
    const s2 = ((ch * 13 + i * 5) % 2) + 1;

    bars.push({ x: cursor, w: b1 });
    cursor += b1 + s1;
    bars.push({ x: cursor, w: b2 });
    cursor += b2 + s2;
  }

  // Right guard bars
  bars.push({ x: cursor, w: 2 });
  cursor += 4;
  bars.push({ x: cursor, w: 2 });
  cursor += 6;

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <svg
        viewBox={`0 0 ${cursor} ${height}`}
        className="w-full max-w-[170px] bg-white px-1"
        style={{ height: `${height}px` }}
        shapeRendering="crispEdges"
        aria-label={`باركود ${clean}`}
      >
        <rect x={0} y={0} width={cursor} height={height} fill="#ffffff" />
        {bars.map((b, idx) => (
          <rect key={idx} x={b.x} y={2} width={b.w} height={height - 4} fill="#000000" />
        ))}
      </svg>
      <div className="mt-0.5 font-mono-num text-[10px] tracking-[0.14em] text-slate-900">
        {clean}
      </div>
    </div>
  );
}
