/**
 * C3b.1 — math markup shown as plain characters. Seen live: an assistant answer printed `\( … \)` and `\frac{…}` raw. The assistant is now told to write plain text
 * (`CHAT_SYSTEM_PROMPT`), and whatever markup is left over is drawn WITHOUT its backslashes and braces. No math library, no HTML: a string in, a string out.
 *
 * The rule that keeps ordinary text safe: inside `\( … \)` and `\[ … \]` every `\word` loses its backslash; outside them only the commands that carry braces
 * (`\frac{a}{b}`, `\text{…}`, `\sqrt{…}`) are rewritten and a stray delimiter is dropped. A backslash anywhere else (a Windows path) is never touched.
 */

const SYMBOLS: Readonly<Record<string, string>> = {
  times: "×",
  div: "÷",
  cdot: "·",
  pm: "±",
  mp: "∓",
  approx: "≈",
  neq: "≠",
  ne: "≠",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  infty: "∞",
  rightarrow: "→",
  to: "→",
  Rightarrow: "⇒",
  leftarrow: "←",
  pi: "π",
  alpha: "α",
  beta: "β",
  delta: "δ",
  Delta: "Δ",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  sigma: "σ",
  sum: "∑",
  circ: "°",
};

/** a side of a fraction is put in brackets when it is more than one word or number */
const wrap = (part: string): string => (/^[\p{L}\p{N}.]+$/u.test(part.trim()) ? part.trim() : `(${part.trim()})`);

const FRAC = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
const SQRT = /\\sqrt\s*\{([^{}]*)\}/g;
const TEXTLIKE = /\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathbb|operatorname|boldsymbol)\s*\{([^{}]*)\}/g;

/** The commands that carry braces: safe anywhere. Repeated, so a fraction inside a fraction is reached from the inside out. */
function braceCommands(text: string): string {
  let out = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = out;
    out = out
      .replace(TEXTLIKE, (_m, inner: string) => inner)
      .replace(FRAC, (_m, a: string, b: string) => `${wrap(a)}/${wrap(b)}`)
      .replace(SQRT, (_m, inner: string) => `√${/^[\p{L}\p{N}.]+$/u.test(inner.trim()) ? inner.trim() : `(${inner.trim()})`}`);
    if (out === before) break;
  }
  return out;
}

/** What is inside a math delimiter: every command is dropped to its plain character or word. */
function inner(text: string): string {
  let out = braceCommands(text);
  out = out
    .replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![A-Za-z])\s?/g, "")
    .replace(/\\(?:quad|qquad)(?![A-Za-z])/g, " ")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\([%$&#_{}])/g, "$1")
    .replace(/\^\s*\{([^{}]*)\}/g, (_m, p: string) => `^${p.length > 1 && !/^[\p{L}\p{N}.]+$/u.test(p) ? `(${p})` : p}`)
    .replace(/_\s*\{([^{}]*)\}/g, (_m, p: string) => `_${p.length > 1 && !/^[\p{L}\p{N}.]+$/u.test(p) ? `(${p})` : p}`)
    .replace(/\\([A-Za-z]+)/g, (_m, name: string) => (Object.prototype.hasOwnProperty.call(SYMBOLS, name) ? (SYMBOLS[name] as string) : name));
  // what is left of braces and of doubled spaces
  out = out.replace(/[{}]/g, "").replace(/ {2,}/g, " ");
  return out.trim();
}

/** The longest formula taken between two delimiters (a longer span is left as it is: nobody writes a 600-character formula in a chat). */
const MAX_FORMULA = 600;

/** The text with every `\( ... \)` and `\[ ... \]` replaced by its plain form. One pass; each closing delimiter is looked up once, so a long run of openers with no partner stays linear. */
function formulas(text: string): string {
  const opener = /\\[([]/g;
  const closing = { "(": "\\)", "[": "\\]" } as const;
  const found: Record<string, number> = { "(": 0, "[": 0 }; // the cached position of the next closer of each kind (-1: there is none left)
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(text)) !== null) {
    const kind = m[0].charAt(1) as "(" | "[";
    const at = m.index;
    if ((found[kind] as number) !== -1 && (found[kind] as number) < at + 2) found[kind] = text.indexOf(closing[kind], at + 2);
    const end = found[kind] as number;
    if (end === -1 || end - at > MAX_FORMULA) continue;
    out += text.slice(last, at) + inner(text.slice(at + 2, end));
    last = end + 2;
    opener.lastIndex = last;
  }
  return out + text.slice(last);
}

/** The text with its leftover math markup shown as plain characters. A text without a backslash is returned as it is. */
export function cleanMath(text: string): string {
  if (text.indexOf("\\") < 0) return text;
  let out = formulas(text);
  out = braceCommands(out);
  // a delimiter whose partner is gone
  out = out.replace(/\\[()[\]]/g, "");
  return out;
}
