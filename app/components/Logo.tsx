import { Orbit } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="WorkPilot home">
      <span className="brand-mark"><Orbit aria-hidden="true" size={20} strokeWidth={2.2} /></span>
      {!compact && <span>workpilot</span>}
    </div>
  );
}
