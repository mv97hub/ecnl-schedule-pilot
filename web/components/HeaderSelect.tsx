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
    <div className="flex w-full min-w-0 items-center gap-2">
      <label htmlFor={id} className="w-[6.75rem] shrink-0 text-[11px] font-semibold uppercase leading-none tracking-wide text-emerald-200/80 sm:text-xs">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">
        <select
          id={id}
          value={value}
          disabled={disabled || options.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full min-w-0 appearance-none truncate rounded-xl border border-white/10 bg-white/10 pr-9 pl-3 text-sm text-white shadow-inner outline-none focus:border-emerald-400/70 focus:bg-white/15 disabled:text-emerald-100/50 sm:h-12 sm:pr-11 sm:pl-4"
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
