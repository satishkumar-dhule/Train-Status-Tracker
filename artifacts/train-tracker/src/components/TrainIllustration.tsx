import { cn } from "@/lib/utils";

function Railbed() {
  return (
    <g className="train-rail">
      <rect
        x="0"
        y="111"
        width="800"
        height="6"
        fill="var(--color-foreground)"
        opacity="0.05"
      />
      {Array.from({ length: 34 }).map((_, i) => (
        <rect
          key={i}
          x={i * 24}
          y="106"
          width="11"
          height="3"
          rx="1"
          fill="var(--color-muted)"
          opacity="0.85"
        />
      ))}
      <rect x="0" y="103" width="800" height="2" fill="var(--color-muted-foreground)" opacity="0.55" />
      <rect x="0" y="106" width="800" height="2" fill="var(--color-muted-foreground)" opacity="0.55" />
    </g>
  );
}

function Coach({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <path
        d="M0 94 L0 52 Q0 50 2 50 L126 52 Q130 53 130 55 L130 94 Z"
        fill="var(--color-muted-foreground)"
        stroke="var(--color-muted-foreground)"
        strokeOpacity="0.5"
        strokeWidth="1"
      />
      <rect x="0" y="70" width="130" height="6" fill="var(--color-brand)" />
      <rect x="0" y="88" width="130" height="6" fill="var(--color-primary)" />
      {[8, 28, 48, 68, 88, 108].map((wx) => (
        <rect
          key={wx}
          x={wx}
          y="58"
          width="14"
          height="8"
          rx="2"
          fill="var(--color-muted)"
          opacity="0.95"
        />
      ))}
      {[18, 30, 86, 98].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="100" r="6" fill="var(--color-foreground)" />
          <circle cx={cx} cy="100" r="2.2" fill="var(--color-card)" />
        </g>
      ))}
    </g>
  );
}

function Wap7Loco() {
  return (
    <g>
      <g stroke="var(--color-muted-foreground)" strokeWidth="2" strokeLinecap="round">
        <rect x="654" y="43" width="12" height="3" fill="var(--color-muted-foreground)" stroke="none" />
        <line x1="660" y1="43" x2="651" y2="27" />
        <line x1="660" y1="43" x2="673" y2="27" />
        <line x1="648" y1="27" x2="676" y2="27" strokeWidth="2.5" />
      </g>
      <rect x="590" y="42" width="14" height="3" rx="1.5" fill="var(--color-muted-foreground)" opacity="0.7" />
      <rect x="612" y="43" width="10" height="2.5" rx="1.25" fill="var(--color-muted-foreground)" opacity="0.6" />

      <path
        d="M580 94 L580 50 Q580 46 586 46 L690 46 Q700 46 706 40 L732 40 Q748 40 750 54 L750 94 Z"
        fill="var(--color-primary)"
        stroke="var(--color-foreground)"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
      <rect x="580" y="55" width="116" height="4" fill="var(--color-card)" opacity="0.85" />
      <rect x="580" y="72" width="170" height="6" fill="var(--color-brand)" />
      <rect x="580" y="88" width="170" height="6" fill="var(--color-foreground)" opacity="0.75" />

      <rect x="604" y="52" width="16" height="9" rx="2" fill="var(--color-card)" opacity="0.95" />
      <rect x="646" y="52" width="16" height="9" rx="2" fill="var(--color-card)" opacity="0.95" />
      <rect x="726" y="54" width="22" height="12" rx="3" fill="var(--color-card)" opacity="0.92" />

      <rect x="712" y="66" width="14" height="6" rx="1" fill="var(--color-card)" opacity="0.9" />
      <circle cx="745" cy="70" r="4" fill="var(--color-warning)" stroke="var(--color-card)" strokeOpacity="0.5" strokeWidth="1" />
      <circle cx="743" cy="85" r="4" fill="var(--color-card)" opacity="0.9" />

      <rect x="750" y="78" width="3" height="7" fill="var(--color-muted-foreground)" />
      <rect x="750" y="87" width="3" height="7" fill="var(--color-muted-foreground)" />

      {[596, 636, 676].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="100" r="6" fill="var(--color-foreground)" />
          <circle cx={cx} cy="100" r="2.2" fill="var(--color-card)" />
        </g>
      ))}
    </g>
  );
}

function TrainCrop() {
  return (
    <g>
      <g stroke="var(--color-muted-foreground)" strokeLinecap="round">
        <line x1="0" y1="46" x2="760" y2="46" strokeWidth="1" opacity="0.12" />
        <line x1="20" y1="40" x2="140" y2="40" strokeWidth="2" opacity="0.3" />
        <line x1="40" y1="58" x2="150" y2="58" strokeWidth="2" opacity="0.3" />
        <line x1="0" y1="76" x2="92" y2="76" strokeWidth="1.5" opacity="0.3" />
        <line x1="30" y1="88" x2="130" y2="88" strokeWidth="1.5" opacity="0.2" />
        <line x1="10" y1="99" x2="70" y2="99" strokeWidth="1.5" opacity="0.15" />
        <line x1="560" y1="34" x2="700" y2="34" strokeWidth="2" opacity="0.18" />
        <line x1="752" y1="56" x2="760" y2="56" strokeWidth="1.5" opacity="0.2" />
        <line x1="752" y1="84" x2="760" y2="84" strokeWidth="1.5" opacity="0.2" />
      </g>

      <Coach x={430} />
      <Coach x={290} />
      <Coach x={150} />

      <rect x="562" y="80" width="16" height="4" rx="1" fill="var(--color-muted-foreground)" opacity="0.6" />
      <rect x="421" y="80" width="8" height="4" rx="1" fill="var(--color-muted-foreground)" opacity="0.6" />
      <rect x="281" y="80" width="8" height="4" rx="1" fill="var(--color-muted-foreground)" opacity="0.6" />

      <Wap7Loco />

      <path d="M743 70 L760 63 L760 77 Z" fill="var(--color-warning)" opacity="0.14" />
    </g>
  );
}

export function TrainIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 120"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn("train-illustration block w-full h-auto", className)}
    >
      <Railbed />
      <g
        className="animate-train-move"
        style={{
          transformBox: "fill-box",
          animation: "train-move 14s linear infinite reverse",
        }}
      >
        <TrainCrop />
        <g transform="translate(760 0)">
          <TrainCrop />
        </g>
      </g>
    </svg>
  );
}
