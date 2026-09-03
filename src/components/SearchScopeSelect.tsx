import {useEffect, useRef, useState} from "react";
import {SCOPE_OPTIONS, type SearchScope} from "./mindmapShared";

interface Props {
    value: SearchScope;
    onChange: (value: SearchScope) => void;
    isDark: boolean;
    disabled?: boolean;
}

export const SearchScopeSelect = ({value, onChange, isDark, disabled}: Props) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = SCOPE_OPTIONS.find((o) => o.value === value);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const btnCls = `rounded border px-2 py-1 text-[11px] whitespace-nowrap outline-none ${
        isDark
            ? "bg-white/5 text-white/90 border-white/10 hover:bg-white/10"
            : "bg-white text-gray-800 border-gray-200 hover:bg-gray-100"
    } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`;

    const panelCls = `absolute left-0 top-full mt-1 z-50 min-w-[88px] rounded border shadow-lg ${
        isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"
    }`;

    return (
        <div ref={ref} className="relative inline-block">
            <button
                type="button"
                disabled={disabled}
                className={btnCls}
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                {selected?.label ?? "范围"} <span className="ml-1 opacity-60">▾</span>
            </button>
            {open && (
                <div className={panelCls} role="listbox">
                    {SCOPE_OPTIONS.map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            role="option"
                            aria-selected={o.value === value}
                            className={`w-full text-left px-2.5 py-1.5 text-[11px] ${
                                isDark ? "text-white/90 hover:bg-white/10" : "text-gray-800 hover:bg-gray-100"
                            } ${o.value === value ? (isDark ? "bg-white/10" : "bg-gray-100") : ""} first:rounded-t last:rounded-b`}
                            onClick={() => {
                                onChange(o.value);
                                setOpen(false);
                            }}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
