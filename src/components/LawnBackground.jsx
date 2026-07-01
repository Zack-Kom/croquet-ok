import React from 'react';

// ── LawnBackground — full-bleed mown-lawn backdrop for the pre-login screen ──
// Picks a random mowing pattern each load and overlays a fine "short grass"
// blade texture, echoing the lawn-diagram styling used elsewhere in the app.
const LAWN_BASE = '#0F3D22';
const LAWN_ALT = '#12452A';
const BLADE_COLOR = '#0A2A17';

const PATTERNS = ['stripe_h', 'stripe_v', 'stripe_d45', 'stripe_d135', 'checker', 'diamond'];

function seededRand(seed) {
  let s = seed | 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967295;
  };
}

// A tile of short mown grass blades — spacing/height mirror the in-app
// "short" grass-length preset used on lawn diagrams.
function BladeTile({ id }) {
  const TILE = 36, SPACING = 9, BLADE_H = 4, LEAN = 2;
  const r = seededRand(42);
  const blades = [];
  for (let x = 3; x < TILE; x += SPACING) {
    for (let y = 3; y < TILE; y += SPACING) {
      const bx = x + (r() - 0.5) * SPACING * 0.7;
      const by = y + (r() - 0.5) * SPACING * 0.7;
      const leanX = (r() - 0.5) * LEAN * 2;
      const h = BLADE_H * (0.7 + r() * 0.6);
      blades.push(
        <line key={`${x}-${y}`}
          x1={bx.toFixed(1)} y1={by.toFixed(1)}
          x2={(bx + leanX).toFixed(1)} y2={(by - h).toFixed(1)}
          stroke={BLADE_COLOR} strokeWidth={0.8} strokeLinecap="round"
          opacity={0.35 + r() * 0.25}
        />
      );
    }
  }
  return (
    <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
      {blades}
    </pattern>
  );
}

function MowPatternDef({ id, style }) {
  const S = 46;
  if (style === 'stripe_v') {
    return (
      <pattern id={id} width={S * 2} height={4} patternUnits="userSpaceOnUse">
        <rect x={0} y={0} width={S} height={4} fill={LAWN_BASE} />
        <rect x={S} y={0} width={S} height={4} fill={LAWN_ALT} />
      </pattern>
    );
  }
  if (style === 'stripe_d45' || style === 'stripe_d135') {
    const angle = style === 'stripe_d45' ? 45 : 135;
    return (
      <pattern id={id} width={S * 2} height={S * 2} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
        <rect x={0} y={0} width={S} height={S * 2} fill={LAWN_BASE} />
        <rect x={S} y={0} width={S} height={S * 2} fill={LAWN_ALT} />
      </pattern>
    );
  }
  if (style === 'checker') {
    return (
      <pattern id={id} width={S * 2} height={S * 2} patternUnits="userSpaceOnUse">
        <rect x={0} y={0} width={S} height={S} fill={LAWN_BASE} />
        <rect x={S} y={0} width={S} height={S} fill={LAWN_ALT} />
        <rect x={0} y={S} width={S} height={S} fill={LAWN_ALT} />
        <rect x={S} y={S} width={S} height={S} fill={LAWN_BASE} />
      </pattern>
    );
  }
  if (style === 'diamond') {
    return (
      <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
        <rect x={0} y={0} width={S} height={S} fill={LAWN_BASE} />
        <polygon points={`${S / 2},0 ${S},${S / 2} ${S / 2},${S} 0,${S / 2}`} fill={LAWN_ALT} />
      </pattern>
    );
  }
  // stripe_h (default)
  return (
    <pattern id={id} width={4} height={S * 2} patternUnits="userSpaceOnUse">
      <rect x={0} y={0} width={4} height={S} fill={LAWN_BASE} />
      <rect x={0} y={S} width={4} height={S} fill={LAWN_ALT} />
    </pattern>
  );
}

export function LawnBackground() {
  const style = React.useMemo(() => PATTERNS[Math.floor(Math.random() * PATTERNS.length)], []);
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
    >
      <defs>
        <MowPatternDef id="lawn-mow" style={style} />
        <BladeTile id="lawn-blades" />
      </defs>
      <rect width="100%" height="100%" fill={LAWN_BASE} />
      <rect width="100%" height="100%" fill="url(#lawn-mow)" />
      <rect width="100%" height="100%" fill="url(#lawn-blades)" />
    </svg>
  );
}

export default LawnBackground;
