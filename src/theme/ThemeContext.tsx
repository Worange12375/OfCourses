import {createContext, useContext, useState, useEffect, type ReactNode} from "react";

export type ThemeMode = "dark" | "light";

interface ThemeContextType {
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const AppThemeProvider = ({children}: {children: ReactNode}) => {
    const [theme, setTheme] = useState<ThemeMode>(() => {
      try {
        const saved = localStorage.getItem("ofcourses:theme");
        return saved === "light" || saved === "dark" ? saved : "dark";
      } catch {
        return "dark";
      }
    });

    const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

    useEffect(() => {
      const root = document.documentElement;
      try {
        localStorage.setItem("ofcourses:theme", theme);
      } catch {
        // Theme still works for this session if browser storage is unavailable.
      }
      root.setAttribute("data-theme", theme);
      root.style.colorScheme = theme;
      // Ring UI popup 通过 portal 渲染到 document.body，脱离 RingThemeProvider。
      // Ring 的暗色 CSS 变量作用域是 .ring-ui-theme-dark 类，必须挂在 <html> 上才能生效。
      if (theme === "dark") {
        root.classList.add("ring-ui-theme-dark");
      } else {
        root.classList.remove("ring-ui-theme-dark");
      }
    }, [theme]);

    return (
        <ThemeContext.Provider value={{theme, setTheme, toggleTheme}}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useAppTheme = (): ThemeContextType => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
    return ctx;
};
