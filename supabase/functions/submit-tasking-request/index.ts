// Submits a tasking request and runs the v1 governance gate server-side, so
// a client can't forge review_status/objection_flag by crafting its own
// insert. See project README for the full concept mapping.
//
// Every request must now be anchored to a specific satellite pass
// ("opportunity") the requester picked from check-feasibility. The
// descriptive feasibility numbers (cloud %, nadir angle, etc.) shown in that
// picker are trusted as display data, but everything governance-relevant is
// recomputed fresh, in this same invocation, so it can't be forged or drift
// from a stale picker call: the impacted footprint (from satellite_id +
// pass_at) and the active-conflict check.
//
// Gate order:
//   1. Community-objection check (flagged_locations) — overrides everything.
//      Run against BOTH the requested AOI and the sensor's actual impacted
//      footprint (which can be larger — see _shared/feasibility.ts), using
//      each one's centroid + bounding radius for simple overlap math.
//   2. Active-conflict acknowledgment — if another user's active request
//      overlaps this ground, the requester must have acknowledged that
//      (surfaced as a required checkbox in the picker) before we'll accept
//      the submission.
//   3. Proportionate review trigger — routine + trusted + no objection
//      auto-approves; everything else goes to pending_review for an admin.

import { adminClient, haversineKm, requireCaller } from "../_shared/auth.ts";
import { buildImpactedFootprint, findConflicts } from "../_shared/feasibility.ts";
import { corsJson, handlePreflight } from "../_shared/cors.ts";

const SENSITIVITIES = ["routine", "moderate", "sensitive"];
const LIFECYCLES = ["standard_1yr", "extended", "delete_after_use"];
const IMAGING_MODES = ["spot", "strip"];
const CONFIDENCES = ["high", "medium", "low"];
const PRIORITY_TIERS = ["high", "medium", "low"];

interface SubmitPayload {
  imaging_mode: string;
  aoi_geojson: GeoJSON.Polygon;
  centroid_lat: number;
  centroid_lng: number;
  bounding_radius_km: number;
  rationale: string;
  sensitivity: string;
  data_lifecycle: string;

  // Chosen opportunity, from check-feasibility.
  satellite_id: string;
  pass_at: string;
  delivery_eta_at: string;
  nadir_deg: number;
  sun_elevation_deg: number;
  cloud_cover_pct: number;
  resolution_m: number;
  confidence: string;
  coverage_fraction: number;
  priority_tier: string;
  acknowledged_conflict: boolean;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return corsJson({ error: "method not allowed" }, { status: 405 });
  }

  const supabaseAdmin = adminClient();
  const caller = await requireCaller(req, supabaseAdmin);
  if ("error" in caller) {
    return corsJson({ error: caller.error }, { status: 401 });
  }
  if (caller.profile.status !== "active") {
    return corsJson({ error: "account_not_active" }, { status: 403 });
  }

  let payload: SubmitPayload;
  try {
    payload = await req.json();
  } catch {
    return corsJson({ error: "invalid request body" }, { status: 400 });
  }

  const {
    imaging_mode,
    aoi_geojson,
    centroid_lat,
    centroid_lng,
    bounding_radius_km,
    rationale,
    sensitivity,
    data_lifecycle,
    satellite_id,
    pass_at,
    delivery_eta_at,
    nadir_deg,
    sun_elevation_deg,
    cloud_cover_pct,
    resolution_m,
    confidence,
    coverage_fraction,
    priority_tier,
    acknowledged_conflict,
  } = payload;

  const passAtMs = Date.parse(pass_at);
  const deliveryEtaMs = Date.parse(delivery_eta_at);

  if (
    !IMAGING_MODES.includes(imaging_mode) ||
    !aoi_geojson ||
    typeof centroid_lat !== "number" ||
    typeof centroid_lng !== "number" ||
    typeof bounding_radius_km !== "number" ||
    bounding_radius_km <= 0 ||
    !rationale?.trim() ||
    !SENSITIVITIES.includes(sensitivity) ||
    !LIFECYCLES.includes(data_lifecycle) ||
    !satellite_id?.trim() ||
    Number.isNaN(passAtMs) ||
    Number.isNaN(deliveryEtaMs) ||
    typeof nadir_deg !== "number" ||
    typeof sun_elevation_deg !== "number" ||
    typeof cloud_cover_pct !== "number" ||
    typeof resolution_m !== "number" ||
    !CONFIDENCES.includes(confidence) ||
    typeof coverage_fraction !== "number" ||
    !PRIORITY_TIERS.includes(priority_tier) ||
    typeof acknowledged_conflict !== "boolean"
  ) {
    return corsJson({ error: "invalid_fields" }, { status: 400 });
  }

  // Recomputed fresh, in this invocation, from the chosen pass — not trusted
  // from the client's picker call.
  const impacted = buildImpactedFootprint(
    {
      centroidLat: centroid_lat,
      centroidLng: centroid_lng,
      boundingRadiusKm: bounding_radius_km,
      imagingMode: imaging_mode as "spot" | "strip",
      polygon: aoi_geojson,
    },
    satellite_id,
    passAtMs,
  );

  // 1. Community-objection check against admin-curated flagged locations —
  //    against both the requested AOI and the sensor's impacted footprint.
  const { data: flagged, error: flaggedError } = await supabaseAdmin
    .from("flagged_locations")
    .select("*");

  if (flaggedError) {
    return corsJson({ error: "governance_check_unavailable" }, { status: 503 });
  }

  let objectionFlag = false;
  let objectionReason: string | null = null;
  for (const loc of flagged ?? []) {
    const aoiDistanceKm = haversineKm(centroid_lat, centroid_lng, loc.center_lat, loc.center_lng);
    const impactedDistanceKm = haversineKm(
      impacted.centroidLat,
      impacted.centroidLng,
      loc.center_lat,
      loc.center_lng,
    );
    if (
      aoiDistanceKm <= bounding_radius_km + loc.radius_km ||
      impactedDistanceKm <= impacted.boundingRadiusKm + loc.radius_km
    ) {
      objectionFlag = true;
      objectionReason = loc.reason;
      break;
    }
  }

  // 2. Active-conflict acknowledgment — recomputed fresh, not trusted from
  //    the client's picker call, so acknowledgment can't be forged either.
  const conflicts = await findConflicts(
    supabaseAdmin,
    caller.userId,
    centroid_lat,
    centroid_lng,
    bounding_radius_km,
  );
  const needsAcknowledgment = conflicts.hasConflict && !conflicts.ownRequest;
  if (needsAcknowledgment && !acknowledged_conflict) {
    return corsJson({ error: "conflict_acknowledgment_required" }, { status: 409 });
  }

  // 3. Proportionate review trigger.
  let reviewStatus: "auto_approved" | "pending_review";
  if (objectionFlag) {
    reviewStatus = "pending_review";
  } else if (sensitivity === "routine" && caller.profile.trusted) {
    reviewStatus = "auto_approved";
  } else {
    reviewStatus = "pending_review";
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("tasking_requests")
    .insert({
      requester_id: caller.userId,
      imaging_mode,
      aoi_geojson,
      centroid_lat,
      centroid_lng,
      bounding_radius_km,
      rationale,
      sensitivity,
      data_lifecycle,
      review_status: reviewStatus,
      objection_flag: objectionFlag,
      objection_reason: objectionReason,
      decided_at: reviewStatus === "auto_approved" ? new Date().toISOString() : null,
      satellite_id,
      pass_at,
      delivery_eta_at,
      nadir_deg,
      sun_elevation_deg,
      cloud_cover_pct,
      resolution_m,
      confidence,
      coverage_fraction,
      priority_tier,
      acknowledged_conflict,
      impacted_geojson: impacted.polygon,
      impacted_centroid_lat: impacted.centroidLat,
      impacted_centroid_lng: impacted.centroidLng,
      impacted_bounding_radius_km: impacted.boundingRadiusKm,
    })
    .select()
    .single();

  if (insertError) {
    return corsJson({ error: "submit_failed" }, { status: 500 });
  }

  return corsJson({ request: inserted }, { status: 200 });
});
