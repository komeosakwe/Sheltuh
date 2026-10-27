/**
 * Leaflet chrome restyled to the app's tokens, plus reduced-motion handling
 * for Leaflet's CSS zoom/fade transitions (it falls back to a timer, so
 * removing the transition is safe). Marker styling lives in components/map/.
 * Shared by /map (SceneMapPanel) and the event page's Location map
 * (components/events/EventLocationLeaflet.tsx).
 */
export default function MapStyles() {
  return (
    <style>{`
      .scene-marker { background: none; border: 0; }
      .leaflet-control-attribution {
        background: color-mix(in srgb, var(--background) 85%, transparent) !important; color: var(--muted) !important;
      }
      .leaflet-control-attribution a { color: var(--foreground) !important; }
      /* Zoom: two separate 44px rounded-square controls with a black edge (§6.1), not Leaflet's grey bar. */
      .leaflet-control-zoom.leaflet-bar { border: 0 !important; box-shadow: none !important; display: flex; flex-direction: column; gap: 0.5rem; }
      .leaflet-control-zoom a {
        width: 2.75rem !important; height: 2.75rem !important; line-height: 2.625rem !important; font-size: 1.25rem !important;
        background: var(--card) !important; color: var(--foreground) !important;
        border: 1px solid var(--foreground) !important; border-radius: var(--radius-control) !important;
      }
      .leaflet-control-zoom a:hover { background: var(--surface) !important; }
      .leaflet-control-zoom a.leaflet-disabled { color: var(--muted) !important; border-color: var(--surface-border) !important; }
      @media (prefers-reduced-motion: reduce) {
        .leaflet-zoom-anim .leaflet-zoom-animated, .leaflet-fade-anim .leaflet-tile, .leaflet-fade-anim .leaflet-popup {
          transition: none !important;
        }
      }
    `}</style>
  );
}
