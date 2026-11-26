import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import type {Locale} from "./translations";
import {translations} from "./translations";

interface LocaleContextType {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

export const LocaleProvider = ({children}: {children: ReactNode}) => {
    const [locale, setLocale] = useState<Locale>(() => {
        try {
            const saved = localStorage.getItem("ofcourses:locale");
            return saved === "zh" || saved === "en" ? saved : "zh";
        } catch {
            return "zh";
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("ofcourses:locale", locale);
        } catch {
            // Locale still works for this session if browser storage is unavailable.
        }
    }, [locale]);

    const t = (key: string): string => {
        return translations[locale]?.[key as keyof typeof translations[typeof locale]] ?? key;
    };

    return (
        <LocaleContext.Provider value={{locale, setLocale, t}}>
            {children}
        </LocaleContext.Provider>
    );
};

export const useLocale = (): LocaleContextType => {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
    return ctx;
};
