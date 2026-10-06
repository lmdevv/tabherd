# Tabby extension

The toolbar uses the original PNGs in `public/icon` in light mode and the brighter
PNGs in `public/icon/dark` in dark mode. The dark icons use the same
`invert(1) hue-rotate(180deg)` treatment as `apps/docs/public/favicon.svg` and retain
the original transparency.

Firefox selects the toolbar variant from the browser theme using `theme_icons`.
Safari uses native `icon_variants` with `color_schemes`. Older Safari versions that
do not support this key keep the original default icon.
Chromium (Chrome 116 or newer) uses an offscreen document to check
`prefers-color-scheme` every second, since Chromium can defer media-query change
events in hidden documents. It updates the toolbar on startup and when the system
theme changes, without needing an extension reload. Unchanged checks do not send
messages or wake the background worker. Custom Chromium browser themes can differ
from this system preference.

Build with `pnpm --filter extension build`, `pnpm --filter extension build:firefox`,
or `pnpm --filter extension build:safari`. Load the Chrome or Firefox directory in
`dist` as an unpacked extension. Reload an already installed unpacked extension
after rebuilding. Package the Safari output with Apple's Safari web extension
packager on macOS before installing it in Safari.
