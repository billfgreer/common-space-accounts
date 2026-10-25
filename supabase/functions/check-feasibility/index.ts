// Pre-submission feasibility check. Given a candidate AOI, returns the set
// of upcoming satellite passes that could service it (with cloud outlook,
// pass geometry, lighting, resolution, and coverage) plus a summary of
// whether anyone else has already staked a claim on the same ground.
//
// Read-only — never writes to tasking_requests. Server-side because it needs
// the full constellation model and cross-user visibility for conflict
// detection, neither of which the client's RLS-scoped session has.

import { adminClient, requireCaller } from "../_shared/auth.ts";
import { findConflicts, findOpportunities } from "../_shared/feasibility.ts";

const IMAGING_MODES = ["spot", "strip"];

interface FeasibilityPayload {
  imaging_mode: string;
  aoi_geojson: GeoJSON.Polygon;
  centroid_lat: number;
  centroid_lng: number;
  bounding_radius_km: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const supabaseAdmin = adminClient();
  const caller = await requireCaller(req, supabaseAdmin);
  if ("error" in caller) {
    return new Response(JSON.stringify({ error: caller.error }), { status: 401 });
  }
  if (caller.profile.status !== "active") {
    return new Response(JSON.stringify({ error: "account_not_active" }), { status: 403 });
  }

  let payload: FeasibilityPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid request body" }), { status: 400 });
  }

  const { imaging_mode, aoi_geojson, centroid_lat, centroid_lng, bounding_radius_km } = payload;

  if (
    !IMAGING_MODES.includes(imaging_mode) ||
    !aoi_geojson ||
    typeof centroid_lat !== "number" ||
    typeof centroid_lng !== "number" ||
    typeof bounding_radius_km !== "number" ||
    bounding_radius_km <= 0
  ) {
    return new Response(JSON.stringify({ error: "invalid_fields" }), { status: 400 });
  }

  const [opportunities, conflicts] = await Promise.all([
    findOpportunities({
      centroidLat: centroid_lat,
      centroidLng: centroid_lng,
      boundingRadiusKm: bounding_radius_km,
      imagingMode: imaging_mode as "spot" | "strip",
      polygon: aoi_geojson,
    }),
    findConflicts(supabaseAdmin, caller.userId, centroid_lat, centroid_lng, bounding_radius_km),
  ]);

  return new Response(JSON.stringify({ opportunities, conflicts }), { status: 200 });
});
