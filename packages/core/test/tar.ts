/**
 * A tar writer, for testing the reader that refuses (D57).
 *
 * It exists to build archives npm would never produce: a symlink, a name climbing out of the
 * directory, a member outside `package/`, two members of one name. A refusing reader whose refusals
 * are never exercised is a reader nobody has tested, and the only way to exercise them is to be
 * able to write the thing being refused.
 *
 * Deliberately not general. It writes ustar headers with a correct checksum and nothing else.
 */
import { gzipSync } from "node:zlib";

const BLOCK = 512;

export interface TarEntry {
  readonly name: string;
  readonly body?: string | Buffer;
  /** The ustar type byte. "0" is a regular file, "5" a directory, "2" a symlink, "x" a pax header. */
  readonly type?: string;
  /** Written into the header's size field instead of the body's real length, to fake a truncation. */
  readonly declaredSize?: number;
}

/** A gzipped tar of these entries, with the end-of-archive blocks tar readers look for. */
export function tarball(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body ?? "", "utf8");
    blocks.push(header(entry, body.length));
    if (body.length > 0) {
      blocks.push(body, Buffer.alloc(padding(body.length)));
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks));
}

/** One npm-shaped package tarball: every path is put under `package/` for you. */
export function packageTarball(files: Readonly<Record<string, string>>): Buffer {
  return tarball(Object.entries(files).map(([path, body]) => ({ name: `package/${path}`, body })));
}

function padding(size: number): number {
  const over = size % BLOCK;
  return over === 0 ? 0 : BLOCK - over;
}

/**
 * Where to split a name too long for the 100-byte `name` field: ustar puts the front of it in a
 * separate 155-byte `prefix`, and the two are rejoined with a slash. The split has to fall on a
 * slash, so the smallest prefix that leaves a short enough tail is the one taken.
 */
function splitName(name: string): { prefix: string; rest: string } {
  if (name.length <= 100) return { prefix: "", rest: name };
  for (let at = 0; at < name.length && at <= 155; at++) {
    if (name[at] !== "/") continue;
    const rest = name.slice(at + 1);
    if (rest.length <= 100) return { prefix: name.slice(0, at), rest };
  }
  throw new Error(`no ustar split for "${name}"`);
}

function header(entry: TarEntry, size: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  const { prefix, rest } = splitName(entry.name);
  block.write(rest, 0, "utf8");
  if (prefix.length > 0) block.write(prefix, 345, "utf8");
  writeOctal(block, 100, 8, 0o644); // mode
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, entry.declaredSize ?? size);
  writeOctal(block, 136, 12, 0); // mtime
  block.write(entry.type ?? "0", 156, "utf8");
  block.write("ustar", 257, "utf8");
  block.write("00", 263, "utf8");

  // The checksum is computed with its own field read as eight spaces, which is the one part of a
  // tar header that is not simply a field written into a slot.
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  writeOctal(block, 148, 8, sum);
  return block;
}

function writeOctal(block: Buffer, at: number, length: number, value: number): void {
  block.write(value.toString(8).padStart(length - 1, "0"), at, length - 1, "utf8");
}
