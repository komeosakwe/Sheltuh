/**
 * Leaflet chrome restyled to the app's tokens, plus reduced-motion handling
 * for Leaflet's CSS zoom/fade transitions (it falls back to a timer, so
 * removing the transition is safe). Marker styling lives in components/map/.
 * Shared by every map: /map (SceneMapPanel), the event page's Location map
 * (components/events/EventLocationLeaflet.tsx) and the venue pin step
 * (components/dashboard/VenuePinMapLeaflet.tsx).
 */
export default function MapStyles() {
  return (
    <style>{`
      .scene-marker { background: none; border: 0; }
      .leaflet-control-attribution {
        background: color-mix(in srgb, var(--background) 85%, transparent) !important; color: var(--muted) !important;
      }
      .leaflet-control-attribution a { color: var(--foreground) !important; }
      /*
       * Mapbox wordmark (components/map/MapboxLogo.tsx): Mapbox's official SVG (public/mapbox-logo.svg,
       * docs/maps.md) bottom-left, 88x23 as in mapbox-gl, in a 24px-high link. It's white with a dark
       * outline, so it reads on the map in both themes. Where it's shown, the attribution (bottom-right)
       * stops short of it and wraps instead of running underneath on a narrow screen.
       */
      .mapbox-logo { display: block; width: 5.5rem; height: 1.5rem; background: url("/mapbox-logo.svg") center / contain no-repeat; }
      .leaflet-control.mapbox-logo-control { margin-bottom: 0.25rem; }
      .leaflet-container:has(.mapbox-logo) .leaflet-bottom.leaflet-right { max-width: calc(100% - 7rem); }
      /* Zoom: two separate 44px rounded-square controls with a black edge (§6.1), not Leaflet's grey bar. */
      .leaflet-control-zoom.leaflet-bar { border: 0 !important; box-shadow: none !important; display: flex; flex-direction: column; gap: 0.5rem; }
      .leaflet-control-zoom a {
        width: 2.75rem !important; height: 2.75rem !important; line-height: 2.625rem !important; font-size: 1.25rem !important;
        background: var(--card) !important; color: var(--foreground) !important;
        border: 1px solid var(--foreground) !important; border-radius: var(--radius-control) !important;
      }
      .leaflet-control-zoom a:hover { background: var(--surface) !important; }
      .leaflet-control-zoom a.leaflet-disabled { color: var(--muted) !important; border-color: var(--surface-border) !important; }
      /*
       * Tile seams. At a fractional devicePixelRatio (Windows at 125% or 150%, a zoomed browser),
       * Chromium draws each tile on whole device pixels, so between two tiles there can be a 1px
       * gap the map's background shows through as a hairline (Leaflet issue #3575). Leaflet 1.9's
       * own fix, mix-blend-mode: plus-lighter, only adds up half-covered edge pixels; it doesn't
       * cover a whole missing pixel. So each base tile is drawn 1 CSS px wider and taller (at
       * least one device pixel) and overlaps its right and bottom neighbours, with normal
       * blending, since plus-lighter would brighten the overlap into a light line. Leaflet sets
       * each tile's size inline (256px, or 512px for Mapbox), hence the attribute match and
       * !important. Only the base tiles in the tile pane: Esri's see-through labels layer
       * (shadow pane) shows no seam. The image stretches by 1/256 or 1/512: nothing visible.
       */
      .leaflet-container .leaflet-tile-pane img.leaflet-tile[style*="width: 256px"] {
        width: 257px !important; height: 257px !important; mix-blend-mode: normal;
      }
      .leaflet-container .leaflet-tile-pane img.leaflet-tile[style*="width: 512px"] {
        width: 513px !important; height: 513px !important; mix-blend-mode: normal;
      }
      @media (prefers-reduced-motion: reduce) {
        .leaflet-zoom-anim .leaflet-zoom-animated, .leaflet-fade-anim .leaflet-tile, .leaflet-fade-anim .leaflet-popup {
          transition: none !important;
        }
      }
    `}</style>
  );
}
