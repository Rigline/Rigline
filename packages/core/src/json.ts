/** Byte order mark, which PowerShell 5 and Notepad put at the start of a UTF-8 file. */
const BOM = 0xfeff;

/** `JSON.parse` for a file a person may have written, which is the same JSON with or without a BOM. */
export function parseJson(text: string): unknown {
  return JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text);
}
