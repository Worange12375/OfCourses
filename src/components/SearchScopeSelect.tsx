import {SCOPE_OPTIONS, type SearchScope} from "./mindmapShared";
import {MiniSelect} from "./MiniSelect";
import {useLocale} from "../i18n/LocaleContext";

interface Props {
    value: SearchScope;
    onChange: (value: SearchScope) => void;
    isDark: boolean;
    disabled?: boolean;
}

/** 导图搜索范围下拉（全部/交叉模块/基础通识）：交互与样式收敛到通用 MiniSelect */
export const SearchScopeSelect = ({value, onChange, isDark, disabled}: Props) => {
    const {locale} = useLocale();
    const options = SCOPE_OPTIONS.map((o) => ({
        value: o.value,
        label: locale === "en" && o.labelEn ? o.labelEn : o.label,
    }));

    return (
        <MiniSelect
            value={value}
            options={options}
            onChange={(v) => onChange(v as SearchScope)}
            isDark={isDark}
            disabled={disabled}
        />
    );
};
