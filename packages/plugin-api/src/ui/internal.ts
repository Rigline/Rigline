/**
 * What the shell draws the menu with. Not for plugins, and not in RUNTIME_MODULES: a plugin importing
 * it would bundle a copy whose context the served components cannot see.
 */
export { MENU_CSS, type MenuEntry, MenuPanel, type MenuPanelProps } from "./menu.tsx";
