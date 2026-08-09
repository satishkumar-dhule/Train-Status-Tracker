import { Moon, Sun } from "lucide-react";
import { useInverted } from "../hooks/use-inverted";
import { cn } from "../lib/utils";

/**
 * One always-visible toggle that flips the whole site between the light and
 * dark B&W palettes. The actual switch happens in CSS (`html.inverted`).
 */
export function InvertToggle({ className }: { className?: string }) {
  const [inverted, setInverted] = useInverted();

  return (
    <button
      type="button"
      onClick={() => setInverted(!inverted)}
      aria-pressed={inverted}
      aria-label="Invert colors"
      title={inverted ? "Switch to light" : "Switch to dark"}
      data-testid="button-invert"
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full text-current transition-colors hover:bg-current/15",
        className,
      )}
    >
      {inverted ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
