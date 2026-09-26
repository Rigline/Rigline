/**
 * The class names a stylesheet's text names, for `ctx.style`'s refusal (D107).
 *
 * A tokenizer rather than a regex, so comments and strings are skipped as the browser skips them and
 * nothing is unbounded. It errs towards finding a name: a token the browser would read differently
 * is harmless here, because only a name in this extension's class table is ever refused.
 *
 * Characters are compared by code, so the source holds no escape sequence for a tool to decode.
 */

const BACKSLASH = 92;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const FORM_FEED = 12;
const SLASH = 47;
const STAR = 42;
const DOT = 46;
const HYPHEN = 45;
const UNDERSCORE = 95;
const QUOTE = 34;
const APOSTROPHE = 39;
const OPEN_BRACKET = 91;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const PIPE = 124;
const EQUALS = 61;
const HASH = 35;

/** The longest `[class…]` quoted in a refusal, so the message stays one line. */
const QUOTED_SELECTOR = 80;

export interface StylesheetNames {
  /** Every class a `.name` token names, escapes decoded, in order of first appearance. */
  readonly classes: readonly string[];
  /** The first selector on the `class` attribute, as written, or null when there is none. */
  readonly classAttribute: string | null;
}

export function stylesheetNames(css: string): StylesheetNames {
  const classes = new Set<string>();
  let classAttribute: string | null = null;
  let i = 0;

  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (c === SLASH && css.charCodeAt(i + 1) === STAR) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
    } else if (c === QUOTE || c === APOSTROPHE) {
      i = skipString(css, i);
    } else if (c === DOT && startsIdent(css, i + 1)) {
      const [name, next] = readIdent(css, i + 1);
      classes.add(name);
      i = next;
    } else if (c === OPEN_BRACKET) {
      const [isClass, next] = attributeIsClass(css, i + 1);
      if (isClass && classAttribute === null) classAttribute = quoteSelector(css, i);
      i = next;
    } else if (isDigit(c)) {
      i = skipNumber(css, i);
    } else if (c === HASH) {
      i = readIdent(css, i + 1)[1];
    } else if (startsIdent(css, i)) {
      const [name, next] = readIdent(css, i);
      i =
        name.toLowerCase() === "url" && css.charCodeAt(next) === OPEN_PAREN
          ? skipUrl(css, next + 1)
          : next;
    } else {
      i++;
    }
  }
  return { classes: [...classes], classAttribute };
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isNameStart(c: number): boolean {
  return isLetter(c) || c === UNDERSCORE || c >= 0x80;
}

function isNameChar(c: number): boolean {
  return isNameStart(c) || isDigit(c) || c === HYPHEN;
}

function isHex(c: number): boolean {
  return isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

function isLineBreak(c: number): boolean {
  return c === NEWLINE || c === CARRIAGE_RETURN || c === FORM_FEED;
}

function isWhitespace(c: number): boolean {
  return c === 32 || c === 9 || isLineBreak(c);
}

function startsEscape(css: string, i: number): boolean {
  return (
    css.charCodeAt(i) === BACKSLASH && i + 1 < css.length && !isLineBreak(css.charCodeAt(i + 1))
  );
}

/** CSS Syntax's "would start an identifier". */
function startsIdent(css: string, i: number): boolean {
  const c = css.charCodeAt(i);
  if (isNameStart(c) || startsEscape(css, i)) return true;
  if (c !== HYPHEN) return false;
  const d = css.charCodeAt(i + 1);
  return isNameStart(d) || d === HYPHEN || startsEscape(css, i + 1);
}

/** The identifier at `i`, escapes decoded, and where it ends. */
function readIdent(css: string, i: number): [string, number] {
  let name = "";
  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (isNameChar(c)) {
      name += css[i];
      i++;
    } else if (startsEscape(css, i)) {
      const [decoded, next] = readEscape(css, i + 1);
      name += decoded;
      i = next;
    } else {
      break;
    }
  }
  return [name, i];
}

/** One escape, `i` just past its backslash: up to six hex digits and one whitespace, or a character. */
function readEscape(css: string, i: number): [string, number] {
  let hex = "";
  while (hex.length < 6 && isHex(css.charCodeAt(i + hex.length))) hex += css[i + hex.length];
  if (hex.length === 0) {
    const point = css.codePointAt(i) ?? 0xfffd;
    return [String.fromCodePoint(point), i + (point > 0xffff ? 2 : 1)];
  }
  let next = i + hex.length;
  if (isWhitespace(css.charCodeAt(next))) next++;
  const point = Number.parseInt(hex, 16);
  const valid = point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff);
  return [String.fromCodePoint(valid ? point : 0xfffd), next];
}

/** Past the string starting at `i`: it ends at its quote, or at an unescaped line break, as CSS's does. */
function skipString(css: string, i: number): number {
  const quote = css.charCodeAt(i);
  i++;
  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (c === quote) return i + 1;
    if (isLineBreak(c)) return i;
    i += c === BACKSLASH ? 2 : 1;
  }
  return i;
}

/** Past a number and its unit, so the dot in `1.5dppx` is not taken for a class. */
function skipNumber(css: string, i: number): number {
  while (isDigit(css.charCodeAt(i))) i++;
  if (css.charCodeAt(i) === DOT && isDigit(css.charCodeAt(i + 1))) {
    i++;
    while (isDigit(css.charCodeAt(i))) i++;
  }
  return startsIdent(css, i) ? readIdent(css, i)[1] : i;
}

/** Past an unquoted `url(…)`, which holds neither comments nor classes. A quoted one is a string. */
function skipUrl(css: string, i: number): number {
  let j = i;
  while (isWhitespace(css.charCodeAt(j))) j++;
  const c = css.charCodeAt(j);
  if (c === QUOTE || c === APOSTROPHE) return i;
  while (j < css.length && css.charCodeAt(j) !== CLOSE_PAREN) j += startsEscape(css, j) ? 2 : 1;
  return j;
}

/**
 * Whether the attribute selector opening before `i` names `class`, in any case, namespaced or not,
 * escaped or not, and where its name ends.
 */
function attributeIsClass(css: string, i: number): [boolean, number] {
  while (isWhitespace(css.charCodeAt(i))) i++;
  if (css.charCodeAt(i) === STAR && css.charCodeAt(i + 1) === PIPE) i += 2;
  else if (css.charCodeAt(i) === PIPE && css.charCodeAt(i + 1) !== EQUALS) i += 1;
  if (!startsIdent(css, i)) return [false, i];
  let [name, next] = readIdent(css, i);
  let j = next;
  while (isWhitespace(css.charCodeAt(j))) j++;
  if (css.charCodeAt(j) === PIPE && css.charCodeAt(j + 1) !== EQUALS && startsIdent(css, j + 1)) {
    [name, next] = readIdent(css, j + 1);
  }
  return [name.toLowerCase() === "class", next];
}

function quoteSelector(css: string, open: number): string {
  const close = css.indexOf("]", open);
  const end = close === -1 ? css.length : close + 1;
  const text = css.slice(open, Math.min(end, open + QUOTED_SELECTOR));
  return end - open > QUOTED_SELECTOR ? `${text}...` : text;
}
