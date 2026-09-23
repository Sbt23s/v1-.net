import DataResetPage from "@/pages/DataReset";
import { Eraser } from "lucide-react";

export function SettingsResetTab() {
  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Eraser className="w-5 h-5 text-primary" />
            Fresh Start & Data Reset
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Safely clear day-to-day transactional test records while permanently preserving employees, salaries, and master configurations.
          </p>
        </div>
      </div>

      {/* Embedded DataResetPage */}
      <DataResetPage hideHeader={true} />
    </div>
  );
}
