import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DatePreset } from "../api/types";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "MTD",  label: "Month to date" },
  { value: "QTD",  label: "Quarter to date" },
  { value: "YTD",  label: "Year to date" },
  { value: "L30D", label: "Last 30 days" },
  { value: "L90D", label: "Last 90 days" },
];

interface Props {
  preset: DatePreset;
  onChange: (v: DatePreset) => void;
}

export function RangePicker({ preset, onChange }: Props) {
  return (
    <Select value={preset} onValueChange={(v) => onChange(v as DatePreset)}>
      <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {PRESETS.map((p) => (
          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
