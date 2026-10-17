/**
 * How a Save link is formed, for the layout menu, the settings screen and a plugin saving its own
 * settings (D93, D138). One module, so the companion's id and the link's shape are written once.
 */
import {
  COMPANION,
  encodeSettingsPayload,
  MAX_SETTINGS_PAYLOAD,
  type RiglineSave,
  type SaveRecord,
  SETTINGS_PAYLOAD_VERSION,
  type SettingsSave,
} from "@rigline/plugin-api/internal";
import type { SaveLink, SettingsSaver } from "@rigline/plugin-api/ui/internal";

type Section = Readonly<Record<string, unknown>>;

/**
 * Whether `plugin` may write `section`.
 *
 * One line today, and the place a permission to write another plugin's section or a first-party
 * exemption would be expressed — a change inside here and nowhere else. Making the section
 * inexpressible would have bought a slightly stronger guarantee now at the cost of having no way to
 * say the thing later (D138).
 */
export function maySaveSection(plugin: string, section: string): boolean {
  return section === plugin;
}

/** Why a payload `length` characters long cannot travel in a link, or null. */
export function tooLarge(length: number): string | null {
  return length > MAX_SETTINGS_PAYLOAD
    ? `these settings are too large to save from the panel: ${length} characters, over the ${MAX_SETTINGS_PAYLOAD} a Save link carries`
    : null;
}

/** The link that writes `sections` and Rigline's own blocks, or why this machine has none. */
export function settingsLink(
  save: SaveRecord | null,
  sections: Readonly<Record<string, SettingsSave>>,
  rigline?: RiglineSave,
): SaveLink {
  if (!save?.token) {
    return { refused: "Rigline has no token for this machine, so nothing can be saved" };
  }
  if (!save.companion) {
    return {
      refused: "the Rigline companion extension is not installed, so nothing can be saved",
    };
  }
  const payload = encodeSettingsPayload({
    v: SETTINGS_PAYLOAD_VERSION,
    token: save.token,
    sections,
    ...(rigline === undefined ? {} : { rigline }),
  });
  const refused = tooLarge(payload.length);
  if (refused !== null) return { refused };
  return { href: `${save.scheme}://${COMPANION}/settings?p=${payload}` };
}

/**
 * The saver the shell provides around a contribution owned by `plugin`.
 *
 * `savedOf` is what this panel last read of a section, which is what its copy started from, so the
 * engine can say it wrote over a change made since (D92's rule, per section). Only the section being
 * written travels: a payload carrying every section would push this panel's stale copy of every
 * other plugin's settings into the file. `followed` hears a click on the link, so the panel learns
 * the save landed.
 */
export function settingsSaver(
  save: SaveRecord | null,
  savedOf: (section: string) => Section,
  plugin: string,
  followed: (section: string, value: Section) => void,
): SettingsSaver {
  return {
    plugin,
    link: (value, section = plugin): SaveLink => {
      if (!maySaveSection(plugin, section)) {
        return { refused: `${plugin} may not save ${section}'s settings` };
      }
      return settingsLink(save, { [section]: { from: savedOf(section), to: value } });
    },
    followed: (value, section = plugin) => followed(section, value),
  };
}
