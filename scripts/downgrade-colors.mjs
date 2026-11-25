// Post-build CSS color downgrader for old WebViews (Quark / cheap Android / Chrome <111).
//
// Tailwind v4 emits colors as oklch()/oklab()/lab() and opacity modifiers as
// color-mix(in oklab/lab, ...). Old Chromium-based mobile browsers (Quark, system
// WebViews on sub-¥1500 phones) cannot parse any of these, so colored backgrounds
// vanish and text becomes invisible. This script rewrites the built CSS so that:
//   1. oklch()/oklab()/lab()  -> rgb()/rgba()
//   2. color-mix(in oklab, var(--color-X) P%, transparent) -> rgba(r,g,b,P/100)
//   3. color-mix(in lab, red, red) -> red  (Ring UI decorative placeholder)
//   4. strip gradient interpolation methods ('to right in oklab' -> 'to right'),
//      because old browsers reject the entire linear-gradient() declaration otherwise.
// Shadows (color-mix with var(--tw-shadow-alpha)) and the single currentColor case
// are left untouched — they are decorative and acceptable to degrade.
//
// Safe to run repeatedly (idempotent once colors are already rgb).

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_DIR = join(__dirname, '..', 'dist', 'assets');

// ---------- color math ----------

function parseL(s, kind) {
  s = s.trim();
  const num = parseFloat(s);
  if (kind === 'lab') return num;            // CSS lab(): L is 0..100
  if (s.endsWith('%')) return num / 100;     // oklch/oklab: L is 0..1 (or %)
  return num;
}

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bch = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [r, g, bch];
}

function labCssToLinear(L, a, b) {
  // CSS lab() -> CIE L*a*b* -> linear sRGB (D65)
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const eps = 216 / 24389, k = 24389 / 27;
  const fx3 = fx ** 3;
  const X = fx3 > eps ? fx3 : (116 * fx - 16) / k;
  const Y = L > k * eps ? ((L + 16) / 116) ** 3 : L / k;
  const Z = fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / k;
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const xr = X * Xn, yr = Y * Yn, zr = Z * Zn;
  const r = 3.2404542 * xr - 1.5371385 * yr - 0.4985314 * zr;
  const g = -0.9692660 * xr + 1.8760108 * yr + 0.0415560 * zr;
  const bch = 0.0556434 * xr - 0.2040259 * yr + 1.0572252 * zr;
  return [r, g, bch];
}

function to255(x) {
  x = Math.min(1, Math.max(0, x));
  if (x <= 0.0031308) return Math.round(x * 12.92 * 255);
  return Math.round((1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
}

function rgbStr(lin, alpha) {
  const r = to255(lin[0]);
  const g = to255(lin[1]);
  const b = to255(lin[2]);
  if (alpha == null || alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

// Convert a single oklch/oklab/lab(...) -> rgb(...)
function convertColorFn(fn, inner) {
  const [coordsPart, alphaPart] = inner.split('/');
  const parts = coordsPart.trim().split(/\s+/);
  const L = parts[0], a = parts[1], b = parts[2];
  let alpha = 1;
  if (alphaPart != null) {
    const av = alphaPart.trim();
    alpha = av.endsWith('%') ? parseFloat(av) / 100 : parseFloat(av);
  }
  let lin;
  if (fn === 'lab') {
    lin = labCssToLinear(parseL(L, 'lab'), parseFloat(a), parseFloat(b));
  } else if (fn === 'oklab') {
    lin = oklabToLinear(parseL(L, 'oklab'), parseFloat(a), parseFloat(b));
  } else { // oklch
    const Ln = parseL(L, 'oklch');
    const C = parseFloat(a);
    const H = parseFloat(b);
    const h = (H * Math.PI) / 180;
    const aa = C * Math.cos(h), bb = C * Math.sin(h);
    lin = oklabToLinear(Ln, aa, bb);
  }
  return rgbStr(lin, alpha);
}

// ---------- color-mix resolution ----------

// Parse an rgb()/rgba()/#hex string into [r,g,b] (0-255) or null.
function parseColorToRgb(str) {
  str = str.trim();
  let m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  m = str.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = str.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 8) & 0xf) * 17, ((n >> 4) & 0xf) * 17, (n & 0xf) * 17];
  }
  m = str.match(/^#([0-9a-f]{8})$/i); // #rrggbbaa -> ignore alpha for mix
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255];
  }
  return null;
}

function resolveOpacityMix(css, colorMap) {
  // color-mix(in oklab, var(--color-X) P%, transparent) -> rgba(r,g,b,P/100)
  const re1 = /color-mix\(\s*in\s+oklab\s*,\s*var\(--color-([\w-]+)\)\s*([\d.]+)?%?\s*,\s*transparent\s*\)/g;
  css = css.replace(re1, (_, name, pct) => {
    const val = colorMap.get(name);
    const rgb = val ? parseColorToRgb(val) : null;
    if (!rgb) return _;
    const a = (pct != null ? parseFloat(pct) : 50) / 100;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(a * 1000) / 1000})`;
  });
  // reversed order: color-mix(in oklab, transparent, var(--color-X) P%) -> alpha = 1 - P/100
  const re2 = /color-mix\(\s*in\s+oklab\s*,\s*transparent\s*,\s*var\(--color-([\w-]+)\)\s*([\d.]+)?%?\s*\)/g;
  css = css.replace(re2, (_, name, pct) => {
    const val = colorMap.get(name);
    const rgb = val ? parseColorToRgb(val) : null;
    if (!rgb) return _;
    const a = 1 - (pct != null ? parseFloat(pct) : 50) / 100;
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(a * 1000) / 1000})`;
  });
  return css;
}

// ---------- main ----------

function downgrade(css) {
  // Pass 1: oklch/oklab/lab -> rgb everywhere (incl. @theme custom properties)
  css = css.replace(/(oklch|oklab|lab)\(\s*([^)]*?)\s*\)/g, (m, fn, inner) => {
    // guard: do not touch inside color-mix 'in oklab' / 'in lab' keywords
    if (inner.includes('currentcolor') || inner.includes('var(') || inner.includes('transparent') || inner.includes('red')) {
      // only the standalone color fns have plain numeric coords; color-mix inner won't match this regex anyway
    }
    return convertColorFn(fn, inner);
  });

  // Build color map from converted @theme vars
  const colorMap = new Map();
  const themeRe = /--color-([\w-]+):\s*([^;]+);/g;
  let tm;
  while ((tm = themeRe.exec(css)) !== null) {
    colorMap.set(tm[1], tm[2].trim());
  }

  // Pass 2: resolve opacity color-mix -> rgba
  css = resolveOpacityMix(css, colorMap);

  // Pass 3: Ring UI placeholder color-mix(in lab, red, red) -> red
  css = css.replace(/color-mix\(\s*in\s+lab\s*,\s*red\s*,\s*red\s*\)/g, 'red');

  // Pass 4: strip modern gradient interpolation methods (e.g. 'to right in oklab').
  // Tailwind v4 writes '--tw-gradient-position: to right in oklab', which causes
  // the entire linear-gradient() declaration to fail on old WebViews even though the color stops are hex.
  css = css.replace(/(--tw-gradient-position:\s*[^;]+?)\s+in\s+(oklab|srgb|lab)\b/g, '$1');

  return css;
}

// ---------- run ----------

if (statSync(CSS_DIR, { throwIfNoEntry: false }) == null) {
  console.error(`[downgrade-colors] No dist/assets directory at ${CSS_DIR}; run build first.`);
  process.exit(0);
}

const files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
if (files.length === 0) {
  console.error('[downgrade-colors] No CSS files found in dist/assets.');
  process.exit(0);
}

let totalOk = 0, totalLab = 0, totalMix = 0;
for (const file of files) {
  const p = join(CSS_DIR, file);
  let css = readFileSync(p, 'utf8');
  const before = {
    ok: (css.match(/oklch\(/g) || []).length,
    lab: (css.match(/\blab\(/g) || []).length,
    mix: (css.match(/color-mix\(/g) || []).length,
  };
  css = downgrade(css);
  const after = {
    ok: (css.match(/oklch\(/g) || []).length,
    lab: (css.match(/\blab\(/g) || []).length,
    mix: (css.match(/color-mix\(/g) || []).length,
  };
  writeFileSync(p, css);
  totalOk += before.ok - after.ok;
  totalLab += before.lab - after.lab;
  totalMix += before.mix - after.mix;
  console.log(`[downgrade-colors] ${file}: oklch ${before.ok}->${after.ok}, lab ${before.lab}->${after.lab}, color-mix ${before.mix}->${after.mix}`);
}
console.log(`[downgrade-colors] done. converted oklch=${totalOk}, lab=${totalLab}, color-mix=${totalMix}`);
