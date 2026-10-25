// Builds a Satellite Foresight-compatible Task object from an approved
// tasking request. Foresight (the standalone scheduler app) is a fully
// static, backend-less site with no API or shared datastore of its own, so
// the only transport available is a deep link: the encoded task travels in
// the URL's `?import=` query param, which Foresight's App.jsx reads on load.
//
// The shape here matches Foresight's own createTaskFromOpportunity()
// (satellite-foresight/src/lib/feasibility.js) field-for-field, so Foresight
// can ingest it exactly like a locally-scheduled task.

export interface ForesightTimestamps {
  requestedAt: string;
  taskedAt: string;
  captureAt: string;
  availableAt?: string;
}

export interface ForesightTask {
  id: string;
  imageId: string | null;
  timeZone: string | null;
  utcOffsetHours: number;
  center: [number, number];
  bbox: [number, number, number, number];
  satelliteId: string;
  status: "Tasked";
  cloudCoverPct: number;
  nadirDeg: number;
  resolutionM: number;
  confidence: "High" | "Medium" | "Low";
  note: string;
  timestamps: ForesightTimestamps;
}

interface TaskingRequestRow {
  id: string;
  aoi_geojson: GeoJSON.Polygon;
  centroid_lat: number;
  centroid_lng: number;
  rationale: string;
  satellite_id: string;
  pass_at: string;
  delivery_eta_at: string;
  nadir_deg: number;
  cloud_cover_pct: number;
  resolution_m: number;
  confidence: string;
  created_at: string;
}

function dateStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Deterministic 4-digit sequence derived from the request's UUID, so the
// same request always produces the same Foresight task id even if re-sent.
function seqFromRequestId(requestId: string): number {
  const hex = requestId.replace(/-/g, "").slice(0, 8);
  return (parseInt(hex, 16) % 9000) + 1000;
}

// Foresight's own tasking.js comment: "a scheduled opportunity's request
// bbox becomes that task's bbox as-is" — so we use the AOI's bounding box,
// not the (potentially larger) sensor swath.
function bboxFromPolygon(polygon: GeoJSON.Polygon): [number, number, number, number] {
  const coords = polygon.coordinates[0];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

const CONFIDENCE_LABELS: Record<string, "High" | "Medium" | "Low"> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function buildForesightTask(row: TaskingRequestRow): ForesightTask {
  const taskId = `CS-TSK-${dateStamp(row.created_at)}-${String(seqFromRequestId(row.id)).padStart(4, "0")}`;
  const nowIso = new Date().toISOString();

  return {
    id: taskId,
    imageId: null,
    timeZone: null,
    utcOffsetHours: Math.round(row.centroid_lng / 15),
    center: [row.centroid_lng, row.centroid_lat],
    bbox: bboxFromPolygon(row.aoi_geojson),
    satelliteId: row.satellite_id,
    status: "Tasked",
    cloudCoverPct: row.cloud_cover_pct,
    nadirDeg: row.nadir_deg,
    resolutionM: row.resolution_m,
    confidence: CONFIDENCE_LABELS[row.confidence] ?? "Medium",
    note: `Imported from Common Space accounts — ${row.rationale}`.slice(0, 280),
    timestamps: {
      requestedAt: row.created_at,
      taskedAt: nowIso,
      captureAt: row.pass_at,
      availableAt: row.delivery_eta_at,
    },
  };
}

// URL-safe, unicode-safe base64 encoding — the encoded string is further
// percent-encoded by the caller before being placed in a query string.
export function encodeForesightTask(task: ForesightTask): string {
  const json = JSON.stringify(task);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
