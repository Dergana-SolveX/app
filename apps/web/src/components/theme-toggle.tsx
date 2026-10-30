import { getLabels } from "@solvex-dergana/shared";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@solvex-dergana/ui/components/button";
import { MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "@/components/theme-provider";

export default function ThemeToggle() {
  const { locale } = useLocale();
  const t = getLabels(locale, "navigation");
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? t.light : t.dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
