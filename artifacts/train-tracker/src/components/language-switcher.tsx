import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LANGS } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSwitcher({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const { lang, setLang, languages } = useI18n();

  return (
    <Select value={lang} onValueChange={setLang}>
      <SelectTrigger
        aria-label="Select language"
        className={cn(
          "h-10 w-auto gap-2 rounded-full bg-primary/10 px-3 font-sans text-sm font-medium text-primary",
          iconOnly && "w-10 justify-center gap-0 px-0 [&>svg:last-child]:hidden",
          className,
        )}
        data-testid="select-language"
      >
        <Languages className="h-4 w-4 shrink-0" />
        {!iconOnly && <SelectValue>{languages[lang].native}</SelectValue>}
      </SelectTrigger>
      <SelectContent>
        {LANGS.map((code) => (
          <SelectItem key={code} value={code} data-testid={`option-language-${code}`}>
            <span className="me-2 inline-block w-16">{languages[code].native}</span>
            {languages[code].name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
