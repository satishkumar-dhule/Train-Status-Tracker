function TrainSvg() {
  return (
    <svg
      viewBox="0 0 600 120"
      width="600"
      height="120"
      className="h-full w-auto shrink-0"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="locoBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a4fa0" />
          <stop offset="100%" stopColor="#123a7c" />
        </linearGradient>
        <linearGradient id="coachBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdf8ee" />
          <stop offset="100%" stopColor="#f1e8d5" />
        </linearGradient>
      </defs>

      {/* Rail line */}
      <rect x="0" y="103" width="600" height="3" fill="#8a8578" opacity="0.5" />
      {Array.from({ length: 40 }).map((_, i) => (
        <rect key={i} x={i * 16} y="106" width="8" height="4" fill="#8a8578" opacity="0.4" />
      ))}

      {/* Coach 3 */}
      <g transform="translate(360,0)">
        <rect x="0" y="52" width="118" height="42" rx="6" fill="url(#coachBody)" stroke="#c9bfa0" strokeWidth="1" />
        <rect x="0" y="60" width="118" height="8" fill="#F47B20" />
        <rect x="0" y="80" width="118" height="4" fill="#1a4fa0" />
        {[10, 30, 50, 70, 90].map((x) => (
          <rect key={x} x={x} y="70" width="12" height="10" rx="2" fill="#1a4fa0" opacity="0.85" />
        ))}
        <rect x="10" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <rect x="78" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <circle cx="20" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="30" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="88" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="98" cy="100" r="6" fill="#2b2b2b" />
      </g>

      {/* Coach 2 */}
      <g transform="translate(232,0)">
        <rect x="0" y="52" width="118" height="42" rx="6" fill="url(#coachBody)" stroke="#c9bfa0" strokeWidth="1" />
        <rect x="0" y="60" width="118" height="8" fill="#F47B20" />
        <rect x="0" y="80" width="118" height="4" fill="#1a4fa0" />
        {[10, 30, 50, 70, 90].map((x) => (
          <rect key={x} x={x} y="70" width="12" height="10" rx="2" fill="#1a4fa0" opacity="0.85" />
        ))}
        <rect x="10" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <rect x="78" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <circle cx="20" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="30" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="88" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="98" cy="100" r="6" fill="#2b2b2b" />
      </g>

      {/* Coach 1 */}
      <g transform="translate(104,0)">
        <rect x="0" y="52" width="118" height="42" rx="6" fill="url(#coachBody)" stroke="#c9bfa0" strokeWidth="1" />
        <rect x="0" y="60" width="118" height="8" fill="#F47B20" />
        <rect x="0" y="80" width="118" height="4" fill="#1a4fa0" />
        {[10, 30, 50, 70, 90].map((x) => (
          <rect key={x} x={x} y="70" width="12" height="10" rx="2" fill="#1a4fa0" opacity="0.85" />
        ))}
        <rect x="10" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <rect x="78" y="92" width="30" height="6" rx="2" fill="#3a3a3a" />
        <circle cx="20" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="30" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="88" cy="100" r="6" fill="#2b2b2b" />
        <circle cx="98" cy="100" r="6" fill="#2b2b2b" />
      </g>

      {/* Locomotive WAP-7 */}
      <g transform="translate(0,0)">
        <line x1="30" y1="38" x2="42" y2="18" stroke="#2b2b2b" strokeWidth="2" />
        <line x1="42" y1="18" x2="54" y2="38" stroke="#2b2b2b" strokeWidth="2" />
        <line x1="54" y1="38" x2="66" y2="18" stroke="#2b2b2b" strokeWidth="2" />
        <line x1="66" y1="18" x2="78" y2="38" stroke="#2b2b2b" strokeWidth="2" />
        <rect x="40" y="16" width="16" height="3" fill="#2b2b2b" />

        <path d="M8 94 L8 56 Q8 46 20 46 L96 46 L104 60 L104 94 Z" fill="url(#locoBody)" stroke="#0e2f66" strokeWidth="1" />
        <rect x="8" y="64" width="96" height="7" fill="#fdf3df" />
        <rect x="8" y="72" width="96" height="4" fill="#F47B20" />
        <path d="M96 46 L104 60 L104 46 Z" fill="#0e2f66" />
        <rect x="76" y="50" width="18" height="12" rx="2" fill="#bcd6f0" opacity="0.9" />
        <rect x="18" y="52" width="16" height="10" rx="2" fill="#bcd6f0" opacity="0.8" />
        <circle cx="100" cy="82" r="3.5" fill="#ffe08a" stroke="#8a5a00" strokeWidth="0.5" />
        <rect x="20" y="80" width="26" height="9" rx="1.5" fill="#fdf3df" />
        <text x="33" y="87" fontSize="6" fontFamily="monospace" fill="#1a4fa0" textAnchor="middle" fontWeight="700">
          30276
        </text>
        <rect x="14" y="90" width="34" height="7" rx="2" fill="#222" />
        <rect x="60" y="90" width="34" height="7" rx="2" fill="#222" />
        <circle cx="22" cy="100" r="7" fill="#1c1c1c" stroke="#444" strokeWidth="1" />
        <circle cx="40" cy="100" r="7" fill="#1c1c1c" stroke="#444" strokeWidth="1" />
        <circle cx="68" cy="100" r="7" fill="#1c1c1c" stroke="#444" strokeWidth="1" />
        <circle cx="86" cy="100" r="7" fill="#1c1c1c" stroke="#444" strokeWidth="1" />
      </g>
    </svg>
  );
}

export function TrainIllustration({ className }: { className?: string }) {
  return (
    <div className={className} style={{ overflow: "hidden" }} aria-hidden="true">
      <div
        className="flex h-full items-end"
        style={{ width: "max-content", animation: "train-move 8s linear infinite" }}
      >
        <TrainSvg />
        <TrainSvg />
      </div>
    </div>
  );
}
