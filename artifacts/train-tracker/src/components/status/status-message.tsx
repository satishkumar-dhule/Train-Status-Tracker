import { Info } from "lucide-react";

export function StatusMessage({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground"
      data-testid="status-message"
    >
      <Info className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
