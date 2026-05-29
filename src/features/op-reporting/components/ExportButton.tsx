// ExportButton — small "Export CSV" pill for the Op Reporting pages.
//
// Disabled while data is loading or empty. Renders inline with the page
// header / range picker.

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  onExport: () => void;
  disabled?: boolean;
  label?: string;
}

export function ExportButton({ onExport, disabled, label = "Export CSV" }: ExportButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-2"
      onClick={onExport}
      disabled={disabled}
    >
      <Download className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Button>
  );
}
