import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PAPERLAB_COLORS } from "./PaperLabMark.js";
const WORDMARK_FONT = '\'SF Pro Display\', \'PingFang SC\', \'Segoe UI\', ui-sans-serif, system-ui, sans-serif';
/**
 * Render the PaperLab wordmark: the navy name plus the navy rounded badge.
 * @param props.size - height in px (default 24; width follows the artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to prepend the leading mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function PaperLabWordmark({ size = 24, className, includeMark = false }) {
    const textX = includeMark ? 30 : 2;
    const badgeX = includeMark ? 96 : 68;
    const width = includeMark ? 176 : 140;
    return (_jsxs("svg", { width: (size * width) / 24, height: size, className: className, viewBox: `0 0 ${width} 24`, fill: "none", "aria-hidden": "true", children: [includeMark && _jsx(PaperLabMarkGlyph, {}), _jsx("text", { x: textX, y: "17", fontFamily: WORDMARK_FONT, fontSize: "15.5", fontWeight: "800", letterSpacing: "-0.4", fill: PAPERLAB_COLORS.navy, children: "PaperLab" }), _jsx("rect", { x: badgeX, y: "6", width: includeMark ? 74 : 70, height: "12.5", rx: "3", fill: PAPERLAB_COLORS.navy }), _jsx("text", { x: badgeX + (includeMark ? 37 : 35), y: "15.2", textAnchor: "middle", fontFamily: WORDMARK_FONT, fontSize: "8.6", fontWeight: "600", letterSpacing: "1.2", fill: PAPERLAB_COLORS.paper, children: "\u8BBA\u6587\u5DE5\u4F5C\u53F0" })] }));
}
/** Inline mark used when includeMark is requested. */
function PaperLabMarkGlyph() {
    return (_jsxs("g", { transform: "translate(1, 1) scale(0.917)", children: [_jsx("path", { d: "M6.1 23V8.9c0-1.9 1.1-3.1 3-3.1h7.2c4 0 6.5 2.5 6.5 6.1 0 3.6-2.5 6.1-6.5 6.1h-5.9V23H6.1Zm4.3-8.3h5.4c1.8 0 2.9-1 2.9-2.7 0-1.6-1.1-2.7-2.9-2.7h-5.4v5.4Z", fill: PAPERLAB_COLORS.navy }), _jsx("path", { d: "M3.2 9.9c0-1.6.8-2.6 2.3-3.1l5.1-1.9c1.6-.6 2.9-.2 3.7 1.1l2.2 3.5c.8 1.3.5 2.8-.8 3.6l-6.3 3.8c-1.4.9-3 .5-3.8-.9L3.5 11.6c-.2-.5-.3-1.1-.3-1.7Z", fill: PAPERLAB_COLORS.paper }), _jsx("path", { d: "M3.6 9.4 10.5 4l.5 4.6-7.4 4.1V9.4Z", fill: PAPERLAB_COLORS.fold })] }));
}
//# sourceMappingURL=PaperLabWordmark.js.map