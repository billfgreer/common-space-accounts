import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre-gl auto-detects its worker script's URL via import.meta.url, which
// bundlers (Vite's dev pre-bundling, and its production rollup build alike)
// rewrite to a path the worker script doesn't actually live at — the worker
// then fails to load and the map silently renders with no tiles or clicks.
// Importing the worker file with `?url` gives Vite-resolved, always-correct
// URL in both dev and prod, which we hand to maplibre-gl explicitly.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { buildSpotFootprint, buildStripFootprint, MAX_STRIP_LENGTH_KM, type AoiFootprint, type LngLat } from "../lib/geo";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const SOURCE_ID = "aoi-footprint";
const PENDING_POINT_SOURCE_ID = "aoi-pending-point";

type ImagingMode = "spot" | "strip";

interface AoiMapProps {
  mode: ImagingMode;
  onChange: (footprint: AoiFootprint | null) => void;
}

export default function AoiMap({ mode, onChange }: AoiMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const pendingPointRef = useRef<LngLat | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 2,
    });
    mapRef.current = map;
    // top-right/top-left are both covered by floating panels (see wizard-map-panel,
    // aoi-map-hint), so the controls go bottom-left where nothing else docks.
    map.addControl(new maplibregl.NavigationControl(), "bottom-left");

    map.on("load", () => {
      map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${SOURCE_ID}-fill`,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-color": "#FF1DFF", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: `${SOURCE_ID}-line`,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": "#FF1DFF", "line-width": 2 },
      });

      map.addSource(PENDING_POINT_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${PENDING_POINT_SOURCE_ID}-circle`,
        type: "circle",
        source: PENDING_POINT_SOURCE_ID,
        paint: { "circle-color": "#FF1DFF", "circle-radius": 5 },
      });

      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setFootprintLayer(footprint: AoiFootprint | null) {
    const source = mapRef.current?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: footprint ? [{ type: "Feature", geometry: footprint.polygon, properties: {} }] : [],
    });
  }

  function setPendingPointLayer(point: LngLat | null) {
    const source = mapRef.current?.getSource(PENDING_POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: point ? [{ type: "Feature", geometry: { type: "Point", coordinates: point }, properties: {} }] : [],
    });
  }

  function reset() {
    pendingPointRef.current = null;
    setPendingPointLayer(null);
    setFootprintLayer(null);
    onChange(null);
  }

  // Reset drawing state whenever the mode changes.
  useEffect(() => {
    if (!loaded) return;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loaded]);

  // Attach click handler (recreated when mode changes so the closure stays fresh).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    function handleClick(e: maplibregl.MapMouseEvent) {
      const clicked: LngLat = [e.lngLat.lng, e.lngLat.lat];

      if (mode === "spot") {
        const footprint = buildSpotFootprint(clicked);
        setFootprintLayer(footprint);
        onChange(footprint);
        return;
      }

      // strip mode
      if (!pendingPointRef.current) {
        pendingPointRef.current = clicked;
        setPendingPointLayer(clicked);
        setFootprintLayer(null);
        onChange(null);
      } else {
        const footprint = buildStripFootprint(pendingPointRef.current, clicked, MAX_STRIP_LENGTH_KM);
        pendingPointRef.current = null;
        setPendingPointLayer(null);
        setFootprintLayer(footprint);
        onChange(footprint);
      }
    }

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loaded]);

  return (
    <div className="aoi-map-canvas-wrap">
      <div ref={containerRef} className="aoi-map-canvas" />
      <div className="aoi-map-hint">
        <p className="aoi-map-instructions">
          {mode === "spot"
            ? "Click once to place a 6\u00d76km spot footprint."
            : `Click a start point, then an end point, to draw a 6km-wide strip (max ${MAX_STRIP_LENGTH_KM}km).`}
        </p>
        <button type="button" className="aoi-map-clear" onClick={reset}>
          Clear
        </button>
      </div>
    </div>
  );
}
