/**
 * White (--background in app/globals.css). The installed app's status bar,
 * theme colour and splash screen use it so they run straight into the
 * white header. The manifest can't follow the visitor's theme, so the splash
 * is white for everyone (docs/design/theme-white-dark.md §5.1).
 */
export const APP_THEME_COLOR = "#ffffff";

/**
 * Black: the Dark theme's --background and its header. The no-flash script
 * and ThemeSync swap the theme-color meta to it in Dark (lib/theme.ts).
 */
export const DARK_THEME_COLOR = "#000000";

/**
 * Ink: the door check-in scope's --background (the door scope in
 * app/globals.css, docs/design/check-in.md §3.1), so the status bar above
 * the scanner doesn't glow paper-white in a dark venue.
 */
export const DOOR_THEME_COLOR = "#0b0b0b";
