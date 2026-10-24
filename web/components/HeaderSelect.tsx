import { ChevronDown } from "lucide-react";

type Option = { value: string; label: string };

type HeaderSelectProps = {
  id: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function HeaderSelect({ id, label, value, options, onChange, disabled }: HeaderSelectProps) {
  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/80">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled || options.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full appearance-none rounded-xl border border-white/10 bg-white/10 pr-11 pl-4 text-sm text-white shadow-inner outline-none focus:border-emerald-400/70 focus:bg-white/15 disabled:text-emerald-100/50"
        >
          {options.length === 0 ? (
            <option value="">None</option>
          ) : (
            options.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-emerald-100/70" />
      </div>
    </div>
  );
}
