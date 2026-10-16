/**
 * How a Save link is formed, for the layout menu and for a plugin saving its own settings (D93,
 * D138). One module, so the companion's id and the link's shape are written once.
 */
import {
  COMPANION,
  encodeSettingsPayload,
  MAX_SETTINGS_PAYLOAD,
  type SaveRecord,
  SETTINGS_PAYLOAD_VERSION,
} from "@rigline/plugin-api/internal";
import type { SaveLink, SettingsSaver } from "@rigline/plugin-api/ui/internal";

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

/**
 * The saver the shell provides around a contribution owned by `plugin`.
 *
 * `from` is the section as `install` baked it, which is what this panel's copy started from, so the
 * engine can say it wrote over a change made since (D92's rule, per section). Only the section being
 * written travels: a payload carrying every section would push this panel's stale copy of every
 * other plugin's settings into the file.
 */
export function settingsSaver(
  save: SaveRecord | null,
  baked: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  plugin: string,
): SettingsSaver {
  return {
    plugin,
    link: (value, section = plugin): SaveLink => {
      if (!maySaveSection(plugin, section)) {
        return { refused: `${plugin} may not save ${section}'s settings` };
      }
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
        sections: { [section]: { from: baked[section] ?? {}, to: value } },
      });
      if (payload.length > MAX_SETTINGS_PAYLOAD) {
        return {
          refused: `these settings are too large to save from the panel: ${payload.length} characters, over the ${MAX_SETTINGS_PAYLOAD} a Save link carries`,
        };
      }
      return { href: `${save.scheme}://${COMPANION}/settings?p=${payload}` };
    },
  };
}
