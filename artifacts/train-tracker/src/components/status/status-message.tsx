import { Info } from "lucide-react";

export function StatusMessage({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
      <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
      <span
        className="font-mono text-sm leading-relaxed text-foreground tracking-wide uppercase"
        data-testid="status-message"
      >
        {message}
      </span>
    </div>
  );
}
