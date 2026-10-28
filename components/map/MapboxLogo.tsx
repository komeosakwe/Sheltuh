import { useMapTileStyle } from "@/components/map/useMapTileStyle";

/**
 * The Mapbox wordmark that Mapbox's attribution guidelines require, bottom-left,
 * on maps using its styles (docs.mapbox.com/help/getting-started/attribution/;
 * source in docs/maps.md). Render it inside a Leaflet map: it reuses Leaflet's
 * bottom-left control corner, so it sits clear of the zoom control and the
 * attribution (bottom-right). Nothing with Esri tiles. Like the attribution
 * links, it's hidden from assistive tech and the tab order wherever the map is
 * (the event page's map is aria-hidden and inert).
 */
export default function MapboxLogo() {
  const { id } = useMapTileStyle();
  if (id !== "mapbox-streets") return null;
  return (
    <div className="leaflet-bottom leaflet-left">
      <div className="leaflet-control mapbox-logo-control">
        <a href="https://www.mapbox.com/" target="_blank" rel="noopener noreferrer" aria-label="Mapbox" className="mapbox-logo" />
      </div>
    </div>
  );
}
