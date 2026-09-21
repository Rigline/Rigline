/**
 * Reading an npm tarball, by refusing almost all of it (decisions.md, D57).
 *
 * This is not an extractor. An extractor's job is to put back what somebody put in, faithfully,
 * including the things a tar file can carry that nothing here wants: symlinks, hardlinks, devices,
 * absolute paths, paths that climb out of the directory, entries whose names collide once a
 * filesystem has had its way with them. This reader's job is the opposite one — take the small flat
 * set of regular files an npm tarball for a plugin actually is, and decline everything else by
 * name, loudly, before a byte is written.
 *
 * The format it accepts is the one a registry serves: gzip, ustar, every member under one leading
 * directory, which is stripped. `npm pack` always calls that directory `package`, and most of the
 * registry is its output; some of it is not — `@types/*` pack under `node/` — and the convention
 * that actually holds is the one npm's own installer implements, which is to strip one segment
 * whatever it is called. Anything else is a refusal rather than a feature request, and a refusal
 * that has to grow a feature to let a real archive through is the signal that owning this was the
 * wrong call (D57).
 *
 * Nothing is written until every entry has been read and checked, so a tarball that turns out to be
 * unacceptable halfway through leaves no half-unpacked directory behind.
 */
import { gunzipSync } from "node:zlib";
import { UserError } from "./errors.ts";

/** Tar's fixed block size: both the header and the padding every entry's body is rounded up to. */
const BLOCK = 512;

/**
 * The entry types this reader knows, as the bytes they are in the header rather than as characters:
 * one of them is NUL, and a source file carrying that literally is a source file nobody can edit
 * safely. A regular file is "0", or NUL from an archiver old enough to predate ustar; "5" is a
 * directory; "x" and "g" are pax extended headers. Every other byte is refused by name.
 */
const TYPE_FILE = 0x30;
const TYPE_FILE_LEGACY = 0x00;
const TYPE_DIRECTORY = 0x35;
const TYPE_PAX_ENTRY = 0x78;
const TYPE_PAX_GLOBAL = 0x67;

/**
 * Caps, so a tarball cannot exhaust a disk or a heap before anything has looked at it. A plugin is
 * one bundled module, a manifest and some documentation; these are two orders of magnitude above
 * anything real, and being refused by one is a signal worth reading rather than a limit to raise.
 */
const MAX_ENTRIES = 2000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** One regular file from the tarball, its path relative to the `package/` prefix. */
export interface TarFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/**
 * Every regular file in a gzipped npm tarball, `package/` stripped, in archive order.
 *
 * `label` names the thing being read in any refusal — a URL, a file — since by the time this throws
 * the caller is usually several steps from whatever the person typed.
 */
export function readPackageTarball(gzipped: Buffer, label: string): TarFile[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(gzipped);
  } catch (error) {
    throw new UserError(`${label} is not a gzipped tarball: ${(error as Error).message}`);
  }

  const members: TarFile[] = [];
  let total = 0;
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (isEndOfArchive(header)) break;
    offset += BLOCK;

    const name = readHeaderName(header, label);
    const size = readOctal(header, 124, 12, `${label}: entry "${name}" has an unreadable size`);
    const type = header[156] ?? 0;
    const body = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    // Skipped rather than refused: the two extended-header types carry the long names and the
    // per-entry metadata of an entry that follows, which this reader neither needs nor honours.
    // What it must not do is treat their bodies as a file.
    if (type === TYPE_PAX_ENTRY || type === TYPE_PAX_GLOBAL) continue;
    // A directory entry says nothing this reader acts on: directories are created for the files
    // that need them, and an empty one carries nothing.
    if (type === TYPE_DIRECTORY) continue;
    if (type !== TYPE_FILE && type !== TYPE_FILE_LEGACY) {
      throw new UserError(
        `${label} carries "${name}", which is not a regular file (tar type ` +
          `"${String.fromCharCode(type)}"). A plugin is files; nothing here unpacks a link, a ` +
          "device or an archive member of any other kind.",
      );
    }

    if (size > MAX_FILE_BYTES) {
      throw new UserError(`${label}: "${name}" is ${size} bytes, over the ${MAX_FILE_BYTES} cap`);
    }
    total += size;
    if (total > MAX_TOTAL_BYTES || members.length >= MAX_ENTRIES) {
      throw new UserError(
        `${label} unpacks to more than ${MAX_ENTRIES} files or ${MAX_TOTAL_BYTES} bytes`,
      );
    }
    if (body.length < size) {
      throw new UserError(`${label} ends inside "${name}", so it is truncated`);
    }

    const path = safePath(name, label);
    if (path === null) continue;
    members.push({ path, bytes: Buffer.from(body) });
  }

  return strip(members, label);
}

/**
 * The members with their shared leading directory removed.
 *
 * Every member of a published tarball sits under one, and which one is not ours to say: `npm pack`
 * writes `package/`, but `@types/*` pack under `node/` and a reader that insisted would refuse a
 * package the registry serves. What can be insisted on is that there is exactly one, because a
 * tarball with two roots is one whose shape nobody here understands.
 */
function strip(members: readonly TarFile[], label: string): TarFile[] {
  const first = members[0];
  if (first === undefined) {
    throw new UserError(`${label} has no files in it`);
  }
  const root = first.path.split("/")[0] as string;
  const files: TarFile[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const segments = member.path.split("/");
    if (segments[0] !== root) {
      throw new UserError(
        `${label} carries "${member.path}", which is outside "${root}/"; every member of a ` +
          "published tarball sits under one directory, and this one has two",
      );
    }
    const path = segments.slice(1).join("/");
    if (path.length === 0) continue;
    if (seen.has(path)) {
      // Two members of a name is how an archive says one thing to a reader that keeps the first and
      // another to a reader that keeps the last. Neither answer is worth having.
      throw new UserError(`${label} carries "${path}" twice`);
    }
    seen.add(path);
    files.push({ path, bytes: member.bytes });
  }
  if (files.length === 0) {
    throw new UserError(`${label} has nothing under "${root}/"`);
  }
  return files;
}

/** Whether this header block is the run of zero bytes that ends an archive. */
function isEndOfArchive(header: Buffer): boolean {
  for (const byte of header) {
    if (byte !== 0) return false;
  }
  return true;
}

/**
 * The entry's name, from the ustar `name` field and the `prefix` field that holds the front of a
 * name too long for it.
 */
function readHeaderName(header: Buffer, label: string): string {
  const name = readString(header, 0, 100);
  const prefix = readString(header, 345, 155);
  if (name.length === 0) {
    throw new UserError(`${label} carries an entry with no name`);
  }
  return prefix.length > 0 ? `${prefix}/${name}` : name;
}

function readString(header: Buffer, at: number, length: number): string {
  const field = header.subarray(at, at + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readOctal(header: Buffer, at: number, length: number, problem: string): number {
  const text = readString(header, at, length).trim();
  const value = text.length === 0 ? 0 : Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new UserError(problem);
  return value;
}

/**
 * The entry's path, normalised, or null when it names nothing but a directory.
 *
 * Every refusal here is a path that would write somewhere the caller did not choose. They are
 * checked on the name as the archive gives it, before anything is joined to a real directory,
 * because a check made after joining is a check made against a path that has already escaped.
 */
function safePath(name: string, label: string): string | null {
  const path = name.replace(/\\/g, "/").replace(/\/+$/, "");
  if (path.length === 0) return null;

  const segments = path.split("/");
  if (
    name.startsWith("/") ||
    // Tested per segment rather than on the whole path, because the leading directory is stripped
    // after this and a "C:" left in second place would become the first thing joined to a real one.
    segments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || /^[a-zA-Z]:/.test(segment),
    )
  ) {
    throw new UserError(
      `${label} carries "${name}", which does not stay inside the directory it unpacks into`,
    );
  }
  return path;
}
