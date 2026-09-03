import {useMemo} from "react";

function prepareSvg(svg: string, color: string, size: number): string {
    return svg
        .replace(/fill="[^"]*"/g, 'fill="currentColor"')
        .replace(/stroke="[^"]*"/g, 'stroke="currentColor"')
        .replace(/width="\d+(?:\.\d+)?"/g, "")
        .replace(/height="\d+(?:\.\d+)?"/g, "")
        .replace(/<svg/, `<svg style="color:${color};width:${size}px;height:${size}px;display:block;fill:currentColor;"`);
}

export function MapIcon({
    svg,
    color,
    size = 16,
    className = "",
}: {
    svg: string;
    color: string;
    size?: number;
    className?: string;
}) {
    const html = useMemo(() => prepareSvg(svg, color, size), [svg, color, size]);
    return (
        <span
            className={className}
            style={{display: "inline-flex", width: size, height: size, color}}
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}
