import React from 'react';

// ── OKBadge — animating ball "O" in the wordmark ─────────────────
const CQ_BALLS = [
  { fill: "#185FA5", sheen: "rgba(255,255,255,0.25)" }, // blue
  { fill: "#2C2C2A", sheen: "rgba(255,255,255,0.18)" }, // black
  { fill: "#B83232", sheen: "rgba(255,255,255,0.25)" }, // red
  { fill: "#C49A0A", sheen: "rgba(255,255,255,0.30)" }, // yellow
  { fill: "#3A7D44", sheen: "rgba(255,255,255,0.22)" }, // green
  { fill: "#D4688A", sheen: "rgba(255,255,255,0.22)" }, // pink
  { fill: "#8B4513", sheen: "rgba(255,255,255,0.18)" }, // brown
  { fill: "#E8E8E2", sheen: "rgba(255,255,255,0.50)" }, // white
];
const HOLD_MS  = 7000;
const ENTER_MS = 650;
const EXIT_MS  = 450;
const DELAY_MS = 2200;

export function OKBadge({ scale = 1 }) {
  const [idx, setIdx]       = React.useState(7); // start on white
  const [rolling, setRolling] = React.useState(false);

  const BALL_PX = 11 * scale;

  React.useEffect(() => {
    const t = setTimeout(() => setRolling(true), DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!rolling) return;
    const t = setTimeout(() => setIdx(i => (i + 1) % CQ_BALLS.length), HOLD_MS);
    return () => clearTimeout(t);
  }, [rolling, idx]);

  const ball = CQ_BALLS[idx];
  const prev = CQ_BALLS[(idx - 1 + CQ_BALLS.length) % CQ_BALLS.length];

  // Badge clips at its own border — this catches the exiting ball on the left.
  // The entering ball only travels BALL_PX rightward from rest, so never reaches K!.
  const BADGE = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: `${2 * scale}px solid rgba(255,255,255,0.7)`,
    borderRadius: 6 * scale,
    padding: `${2 * scale}px ${8 * scale}px`,
    fontSize: 13 * scale,
    fontWeight: 800,
    color: "#fff",
    letterSpacing: "0.03em",
    lineHeight: 1,
    textShadow: "none",
    boxShadow: "none",
    position: "relative",
    overflow: "hidden",  // clips exiting ball at the left border
    gap: 0,
  };

  function BallSVG({ b }) {
    return (
      <svg width={BALL_PX} height={BALL_PX} viewBox="0 0 14 14" style={{ display: "block", flexShrink: 0 }}>
        <circle cx="7" cy="7" r="7" fill={b.fill} />
        <circle cx="4.2" cy="4.2" r="2.4" fill={b.sheen} />
      </svg>
    );
  }

  // Exit: travel left to badge border = left-pad(8) + left-border(2) + ball(11) = 21px, scaled
  // Enter: only travel BALL_PX from right so it never overlaps K!
  const EXIT_D  = 21 * scale;
  const ENTER_D = BALL_PX;

  return (
    <span style={{ ...BADGE }}>
      {/* Ball track: kept in flow at its original width so the pill size is
          unchanged. An absolutely-positioned inner clip lets the ball roll left
          to the badge border while clipping the right edge before the K!. */}
      <span style={{
        position: "relative",
        display: "inline-block",
        width: BALL_PX,
        height: BALL_PX,
        verticalAlign: "middle",
        flexShrink: 0,
      }}>
        <span style={{
          position: "absolute",
          top: 0, bottom: 0,
          right: 0,
          left: -10 * scale,      // extend left toward the badge border (out of flow)
          overflow: "hidden",
          pointerEvents: "none",
        }}>
          <span style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: BALL_PX }}>
            {rolling && (
              <span key={`out-${idx}`} style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: `cq-exit ${EXIT_MS}ms cubic-bezier(0.4,0,1,1) forwards`,
              }}>
                <BallSVG b={prev} />
              </span>
            )}
            <span key={`in-${idx}-${rolling}`} style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: rolling ? `cq-enter ${ENTER_MS}ms cubic-bezier(0.2,0,0.3,1) forwards` : "none",
            }}>
              <BallSVG b={ball} />
            </span>
          </span>
        </span>
      </span>
      <span style={{ position: "relative", zIndex: 2, opacity: 1, top: 1 }}>K!</span>
      <style>{`
        @keyframes cq-enter {
          from { transform: translateX(${ENTER_D}px) rotate(360deg); }
          to   { transform: translateX(0)             rotate(0deg);   }
        }
        @keyframes cq-exit {
          from { transform: translateX(0)              rotate(0deg);    }
          to   { transform: translateX(-${EXIT_D}px)  rotate(-360deg); }
        }
      `}</style>
    </span>
  );
}

// Full "Croquet? [ball]K!" wordmark, reusable at any scale.
export function CroquetOkLogo({ scale = 1, color = "#fff" }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      textAlign: "center",
      gap: 8 * scale,
      fontSize: 19 * scale,
      fontWeight: 700,
      lineHeight: 1,
      color,
      fontFamily: "'Libre Baskerville', Georgia, serif",
      textShadow: "0 1px 6px rgba(0,0,0,0.4)",
    }}>
      Croquet?
      <OKBadge scale={scale} />
    </span>
  );
}

export default OKBadge;
