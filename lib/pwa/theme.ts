/**
 * Black: the site header's colour in both themes (the redesign's black header). The browser's
 * theme colour and the installed app's status bar use it, so they run straight into the header,
 * in Light and Dark alike.
 */
export const APP_THEME_COLOR = "#000000";

/**
 * White (the Light theme's --background in app/globals.css): the installed app's splash screen,
 * shown before the page. The manifest can't follow the visitor's theme, so it's the default
 * theme's page colour (docs/design/theme-white-dark.md §5.1).
 */
export const APP_BACKGROUND_COLOR = "#ffffff";

/**
 * Ink: the door check-in scope's --background (the door scope in
 * app/globals.css, docs/design/check-in.md §3.1), so the status bar above
 * the scanner doesn't glow paper-white in a dark venue.
 */
export const DOOR_THEME_COLOR = "#0b0b0b";
