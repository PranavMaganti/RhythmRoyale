/**
 * Shared SVG filters that make crisp CSS borders look drawn by hand. They're
 * applied to outlines only (via ::before pseudo-elements), never to text.
 */
export function SketchDefs() {
  return (
    <svg className="sketch-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="sketch" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id="sketch-strong" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="3" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/** A few bars of doodled sheet music for the home page. */
export function StaffDoodle() {
  const lines = [18, 30, 42, 54, 66];
  // [x, y of the note head, stem up?]
  const notes: Array<[number, number, boolean]> = [
    [70, 60, true],
    [112, 48, true],
    [150, 36, false],
    [188, 42, false],
    [252, 30, false],
  ];
  return (
    <svg
      className="staff-doodle"
      viewBox="0 0 320 84"
      role="img"
      aria-label="A hand-drawn line of sheet music"
    >
      <g filter="url(#sketch-strong)" fill="none" stroke="currentColor" strokeLinecap="round">
        {lines.map((y) => (
          <path key={y} d={`M6 ${y} Q 160 ${y + (y % 3) - 1} 314 ${y + 1}`} strokeWidth="1.4" />
        ))}
        <path d="M230 18 L231 66" strokeWidth="2" />
        <path d="M312 17 L313 67" strokeWidth="3" />
        {/* Treble-ish swirl */}
        <path
          d="M30 74 C 22 60, 44 52, 38 38 C 32 22, 20 30, 28 44 C 36 60, 46 40, 34 12 C 30 4, 24 10, 27 20 L 34 78"
          strokeWidth="2"
        />
        {notes.map(([x, y, up]) => (
          <g key={x}>
            <ellipse
              cx={x}
              cy={y}
              rx="7.5"
              ry="5.2"
              transform={`rotate(-20 ${x} ${y})`}
              fill="currentColor"
            />
            <path
              d={
                up
                  ? `M${x + 6.5} ${y - 2} L${x + 7} ${y - 34}`
                  : `M${x - 6.5} ${y + 2} L${x - 6} ${y + 34}`
              }
              strokeWidth="1.8"
            />
          </g>
        ))}
        {/* Beam joining the two quavers */}
        <path d="M143 72 L182 74" strokeWidth="5" />
      </g>
    </svg>
  );
}
