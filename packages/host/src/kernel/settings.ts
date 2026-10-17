/**
 * The settings screen's editor: what `registry.js` last held of every plugin's settings and of
 * Rigline's own, a draft for each tab that differs from it, and the one Save that writes them all.
 *
 * The host holds the drafts, so a tab is a controlled view over its own and loses nothing when the
 * person switches tabs or closes the screen. A clean tab shows what is saved, so a save from another
 * window reaches it unreconciled; a dirty one keeps what it started from, which is what tells the
 * engine, and the tab, that the file moved under it (D92's rule, per tab).
 */
import {
  encodeSettingsPayload,
  RIGLINE,
  type RiglineSave,
  type RiglineSettings,
  type SaveRecord,
  SETTINGS_PAYLOAD_VERSION,
  type SettingsSave,
  type Store,
  sameValue,
  store,
} from "@rigline/plugin-api/internal";
import type { SaveLink } from "@rigline/plugin-api/ui/internal";
import { maySaveSection, settingsLink, tooLarge } from "./save.ts";
import { createSaveTracker, type SavedState, type SaveState } from "./saving.ts";

type Section = Readonly<Record<string, unknown>>;

/** What the file held when last read, frozen: every plugin's section, and Rigline's own settings. */
export interface SavedSettings {
  readonly sections: Readonly<Record<string, Section>>;
  readonly rigline: RiglineSettings;
}

/** One tab's unsaved work: what it started from, and what it is now. */
export interface Draft {
  readonly from: Section;
  readonly to: Section;
}

export interface SettingsEditor {
  readonly saved: Store<SavedSettings>;
  /** Each tab's draft, by owner, while it differs from what is saved. */
  readonly drafts: Store<ReadonlyMap<string, Draft>>;
  readonly saving: Store<SaveState>;
  /** The tab the screen shows by owner, `""` for none in particular, or null while it is closed. */
  readonly open: Store<string | null>;
  /** What is saved for `owner`: its section, or Rigline's own settings for `rigline`. */
  savedOf(owner: string): Section;
  /** What `owner`'s tab shows: its draft, else what is saved. */
  value(owner: string): Section;
  /** Replaces `owner`'s draft, which goes once it equals what is saved. */
  set(owner: string, value: Section): void;
  /** Drops `owner`'s draft, for a tab that has gone. */
  forget(owner: string): void;
  /** Reads the file afresh and drops every draft. */
  revert(): Promise<void>;
  /** Save's link, carrying every draft, or why there is none. */
  link(): SaveLink;
  /** Why `owner`'s saved section could not be written back from the panel, or null. */
  unsaveable(owner: string): string | null;
  /** After a Save click: waits for `registry.js` to hold what `sent` carried, by owner. */
  confirm(sent: ReadonlyMap<string, Section>): Promise<void>;
  /** A re-read of `registry.js`, whoever asked for it: every one is a source for what is saved. */
  observe(read: SavedState): void;
  /** Hands `handler` `owner`'s saved settings now, and again whenever they change. */
  subscribe(owner: string, handler: (section: Section) => void): () => void;
}

export interface SettingsEditorOptions {
  readonly save: SaveRecord | null;
  readonly sections: Readonly<Record<string, Section>>;
  readonly rigline: RiglineSettings;
  /** What `registry.js` holds now, read afresh, or null when it cannot be read. */
  readonly readSaved: () => Promise<SavedState | null>;
  /** Injected so a test need not wait out the confirmation. */
  readonly wait?: (ms: number) => Promise<void>;
}

const EMPTY: Section = Object.freeze({});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return value;
}

/** A frozen copy no caller holds a reference into. */
function settled<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function createSettingsEditor(options: SettingsEditorOptions): SettingsEditor {
  const { save, readSaved } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const saved = store<SavedSettings>(
    settled({ sections: options.sections, rigline: options.rigline }),
  );
  const drafts = store<ReadonlyMap<string, Draft>>(new Map());
  const tracker = createSaveTracker(readSaved, wait);
  const open = store<string | null>(null);

  function of(settings: SavedSettings, owner: string): Section {
    if (owner === RIGLINE) return settings.rigline as unknown as Section;
    return Object.hasOwn(settings.sections, owner) ? (settings.sections[owner] ?? EMPTY) : EMPTY;
  }

  function savedOf(owner: string): Section {
    return of(saved.get(), owner);
  }

  function observe(read: SavedState): void {
    const next = { sections: read.settings, rigline: read.rigline };
    if (sameValue(next, saved.get())) return;
    saved.set(settled(next));
  }

  function withDrafts(change: (next: Map<string, Draft>) => void): void {
    const next = new Map(drafts.get());
    change(next);
    drafts.set(next);
  }

  return {
    saved,
    drafts,
    saving: tracker.state,
    open,
    savedOf,
    value(owner) {
      return drafts.get().get(owner)?.to ?? savedOf(owner);
    },
    set(owner, value) {
      const to = settled(value);
      withDrafts((next) => {
        if (sameValue(to, savedOf(owner))) next.delete(owner);
        else next.set(owner, { from: next.get(owner)?.from ?? savedOf(owner), to });
      });
      tracker.edited();
    },
    forget(owner) {
      if (drafts.get().has(owner)) withDrafts((next) => next.delete(owner));
    },
    async revert() {
      await readSaved();
      drafts.set(new Map());
      tracker.state.set("idle");
    },
    link() {
      const sections: Record<string, SettingsSave> = {};
      let rigline: RiglineSave | undefined;
      // Each draft is stamped with its own tab's owner, so the check passes as written (D138).
      for (const [owner, { from, to }] of drafts.get()) {
        if (owner === RIGLINE) {
          rigline = { from, to };
        } else if (maySaveSection(owner, owner)) {
          sections[owner] = { from, to };
        }
      }
      return settingsLink(save, sections, rigline);
    },
    unsaveable(owner) {
      if (owner === RIGLINE || !save?.token) return null;
      const section = savedOf(owner);
      const payload = encodeSettingsPayload({
        v: SETTINGS_PAYLOAD_VERSION,
        token: save.token,
        sections: { [owner]: { from: section, to: section } },
      });
      return tooLarge(payload.length);
    },
    async confirm(sent) {
      await tracker.confirm(
        (read) => {
          const file = { sections: read.settings, rigline: read.rigline };
          return [...sent].every(([owner, value]) => sameValue(of(file, owner), value));
        },
        (read) => {
          observe(read);
          // A draft edited since the click is unsaved work, now over what that click saved.
          withDrafts((next) => {
            for (const [owner, value] of sent) {
              const draft = next.get(owner);
              if (draft === undefined) continue;
              if (sameValue(draft.to, value)) next.delete(owner);
              else next.set(owner, { from: savedOf(owner), to: draft.to });
            }
          });
        },
      );
    },
    observe,
    subscribe(owner, handler) {
      let last = savedOf(owner);
      handler(last);
      return saved.subscribe(() => {
        const now = savedOf(owner);
        if (sameValue(now, last)) return;
        last = now;
        handler(now);
      });
    },
  };
}
