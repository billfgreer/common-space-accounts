// Feasibility computation: for a candidate AOI, finds upcoming satellite
// passes ("opportunities") over the next few days and scores each one on
// the dimensions a real tasking system would show a customer before they
// commit a request — cloud outlook, pass geometry, lighting, resolution,
// and whether anyone else has already staked a claim on the same ground.
//
// Deliberately server-side only (see submit-tasking-request's governance
// gate for the parallel pattern): it needs (a) the full constellation model
// and (b) visibility into *other users'* tasking requests to do conflict
// detection, neither of which the RLS-scoped client session has.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { haversineKm } from "./auth.ts";
import {
  ALTITUDE_KM,
  bearingDeg,
  FOR_HALF_WIDTH_KM,
  FOV_HALF_WIDTH_KM,
  headingAt,
  NATIVE_GSD_M,
  offNadirAngleForGroundOffset,
  offsetByBearing,
  SAT_ORBITS,
  subPointRaw,
} from "./orbits.ts";
import { solarElevationDeg } from "./sun.ts";

const DEG2RAD = Math.PI / 180;

const LOOKAHEAD_HOURS = 4 * 24; // matches Satellite Foresight's FUTURE_CAP_HOURS
const STEP_MS = 15_000; // matches Satellite Foresight's pass-search resolution
const DELIVERY_LATENCY_MS = 45 * 60_000; // downlink + processing, fixed estimate
const GOOD_LIGHT_ELEVATION_DEG = 10; // below this, daylight is too weak for a usable optical image

export type Confidence = "high" | "medium" | "low";
export type PriorityTier = "high" | "medium" | "low";

export interface FeasibilityTarget {
  centroidLat: number;
  centroidLng: number;
  boundingRadiusKm: number;
  imagingMode: "spot" | "strip";
  polygon: GeoJSON.Polygon;
}

export interface Opportunity {
  satelliteId: string;
  passAt: string; // ISO timestamp of closest approach
  deliveryEtaAt: string; // ISO timestamp, estimated delivery
  nadirDeg: number;
  sunElevationDeg: number;
  cloudCoverPct: number;
  confidence: Confidence;
  resolutionM: number;
  coverageFraction: number; // 1.0 = full requested footprint imaged this pass
  priorityTier: PriorityTier;
}

export interface ConflictSummary {
  hasConflict: boolean;
  overlapType: "full" | "partial" | null;
  ownRequest: boolean;
  conflictCount: number;
}

// --- Cloud cover (real forecast, via Open-Meteo — free, keyless) ----------

interface CloudSeries {
  timesMs: number[];
  pct: number[];
}

async function fetchCloudForecast(lat: number, lng: number): Promise<CloudSeries | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=cloud_cover&forecast_days=5&timezone=UTC`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const times: string[] = body?.hourly?.time ?? [];
    const pct: number[] = body?.hourly?.cloud_cover ?? [];
    if (!times.length || times.length !== pct.length) return null;
    return { timesMs: times.map((t) => Date.parse(t + "Z")), pct };
  } catch {
    return null;
  }
}

const FALLBACK_CLOUD_PCT = 50; // neutral assumption if the forecast call fails

function sampleCloudCover(series: CloudSeries | null, timeMs: number): number {
  if (!series || !series.timesMs.length) return FALLBACK_CLOUD_PCT;
  let closestIdx = 0;
  let closestDelta = Infinity;
  for (let i = 0; i < series.timesMs.length; i++) {
    const delta = Math.abs(series.timesMs[i] - timeMs);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestIdx = i;
    }
  }
  return series.pct[closestIdx];
}

function confidenceFor(cloudCoverPct: number, sunElevationDeg: number): Confidence {
  if (sunElevationDeg < 0) return "low"; // night pass — no usable optical image regardless of cloud
  if (cloudCoverPct <= 15) return "high";
  if (cloudCoverPct <= 35) return "medium";
  return "low";
}

// --- Strip coverage: can this pass image the full requested length? -------

function foldAngleTo90(diffDeg: number): number {
  let d = Math.abs(diffDeg % 180);
  if (d > 90) d = 180 - d;
  return d;
}

/**
 * Fraction of the requested strip this pass can actually image. A pushbroom
 * sensor images a fixed-width swath along the ground track; a strip whose
 * long axis runs parallel to the track gets full-length coverage in one
 * pass, but one that runs across the track is capped to roughly the
 * cross-track swath width, regardless of requested length.
 */
function stripCoverageFraction(satelliteId: string, passAtMs: number, polygon: GeoJSON.Polygon): number {
  const ring = polygon.coordinates[0];
  const [lonA, latA] = ring[0];
  const [lonB, latB] = ring[1];
  const stripBearing = bearingDeg(latA, lonA, latB, lonB);
  const stripLengthKm = haversineKm(latA, lonA, latB, lonB);

  const trackHeading = headingAt(satelliteId, passAtMs);
  if (trackHeading == null || stripLengthKm === 0) return 1;

  const diff = foldAngleTo90(stripBearing - trackHeading);
  const crossTrackOnlyFraction = Math.min(1, (FOV_HALF_WIDTH_KM * 2) / stripLengthKm);

  if (diff <= 30) return 1;
  if (diff >= 60) return crossTrackOnlyFraction;
  const t = (diff - 30) / 30; // 0 at 30deg (full), 1 at 60deg (cross-track only)
  return 1 - t * (1 - crossTrackOnlyFraction);
}

// --- Opportunity search -----------------------------------------------------

function priorityTierFor(rank: number, total: number): PriorityTier {
  if (total <= 1) return "high";
  const fraction = rank / (total - 1);
  if (fraction <= 1 / 3) return "high";
  if (fraction <= 2 / 3) return "medium";
  return "low";
}

export async function findOpportunities(target: FeasibilityTarget): Promise<Opportunity[]> {
  const { centroidLat, centroidLng, boundingRadiusKm, imagingMode, polygon } = target;
  const cloudSeries = await fetchCloudForecast(centroidLat, centroidLng);

  const nowMs = Date.now();
  const horizonMs = nowMs + LOOKAHEAD_HOURS * 3600_000;
  const rangeKm = FOR_HALF_WIDTH_KM + boundingRadiusKm;

  type Raw = { satelliteId: string; passAtMs: number; distKm: number };
  const raw: Raw[] = [];

  for (const satelliteId of Object.keys(SAT_ORBITS)) {
    let inRange = false;
    let best: { timeMs: number; distKm: number } | null = null;

    for (let t = nowMs; t <= horizonMs; t += STEP_MS) {
      const sub = subPointRaw(satelliteId, t);
      if (!sub) continue;
      const distKm = haversineKm(centroidLat, centroidLng, sub.lat, sub.lon);
      const withinRange = distKm <= rangeKm;

      if (withinRange) {
        inRange = true;
        if (!best || distKm < best.distKm) best = { timeMs: t, distKm };
      } else if (inRange) {
        raw.push({ satelliteId, passAtMs: best!.timeMs, distKm: best!.distKm });
        inRange = false;
        best = null;
      }
    }
    if (inRange && best) {
      raw.push({ satelliteId, passAtMs: best.timeMs, distKm: best.distKm });
    }
  }

  raw.sort((a, b) => a.passAtMs - b.passAtMs);

  const opportunities: Opportunity[] = raw.map(({ satelliteId, passAtMs, distKm }) => {
    const groundOffsetKm = Math.max(0, distKm - boundingRadiusKm);
    const nadirDeg = offNadirAngleForGroundOffset(groundOffsetKm, ALTITUDE_KM);
    const sunElevationDeg = solarElevationDeg(new Date(passAtMs), centroidLat, centroidLng);
    const cloudCoverPct = sampleCloudCover(cloudSeries, passAtMs);
    const resolutionM = NATIVE_GSD_M / Math.cos(nadirDeg * DEG2RAD);
    const confidence = confidenceFor(cloudCoverPct, sunElevationDeg);
    const coverageFraction =
      imagingMode === "spot" ? 1 : stripCoverageFraction(satelliteId, passAtMs, polygon);

    return {
      satelliteId,
      passAt: new Date(passAtMs).toISOString(),
      deliveryEtaAt: new Date(passAtMs + DELIVERY_LATENCY_MS).toISOString(),
      nadirDeg,
      sunElevationDeg,
      cloudCoverPct,
      confidence,
      resolutionM,
      coverageFraction,
      priorityTier: "low", // placeholder, assigned below once ranked
    };
  });

  // Rank by a composite desirability score (good light, near-nadir, clear
  // sky) to assign each pass a priority tier relative to its siblings.
  const scored = opportunities.map((o) => ({
    o,
    score:
      (o.sunElevationDeg >= GOOD_LIGHT_ELEVATION_DEG ? 1 : 0.4) -
      o.nadirDeg / 30 -
      o.cloudCoverPct / 100,
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach(({ o }, rank) => {
    o.priorityTier = priorityTierFor(rank, scored.length);
  });

  return opportunities.sort((a, b) => Date.parse(a.passAt) - Date.parse(b.passAt));
}

// --- Impacted footprint: the sensor's actual ground coverage -------------
//
// A pushbroom sensor images a fixed-width swath along the satellite's
// ground track, not just the requester's drawn AOI. This rectangle is
// always at least as large as the native FOV (16km square) and stretches
// further along-track when the requested strip runs parallel to the track,
// since the sensor then images the full strip length in one pass.

export interface ImpactedFootprint {
  polygon: GeoJSON.Polygon;
  centroidLat: number;
  centroidLng: number;
  boundingRadiusKm: number;
}

export function buildImpactedFootprint(
  target: FeasibilityTarget,
  satelliteId: string,
  passAtMs: number,
): ImpactedFootprint {
  const { centroidLat, centroidLng, boundingRadiusKm, imagingMode, polygon } = target;
  const trackHeading = headingAt(satelliteId, passAtMs) ?? 0;

  let alongHalfKm = Math.max(FOV_HALF_WIDTH_KM, boundingRadiusKm);
  if (imagingMode === "strip") {
    const ring = polygon.coordinates[0];
    const [lonA, latA] = ring[0];
    const [lonB, latB] = ring[1];
    const stripBearing = bearingDeg(latA, lonA, latB, lonB);
    const stripLengthKm = haversineKm(latA, lonA, latB, lonB);
    const diff = foldAngleTo90(stripBearing - trackHeading);
    alongHalfKm = diff <= 30 ? Math.max(FOV_HALF_WIDTH_KM, stripLengthKm / 2) : FOV_HALF_WIDTH_KM;
  }
  const crossHalfKm = FOV_HALF_WIDTH_KM;

  const signs: Array<[1 | -1, 1 | -1]> = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  const corners: GeoJSON.Position[] = signs.map(([alongSign, crossSign]) => {
    const along = offsetByBearing(centroidLat, centroidLng, trackHeading, alongSign * alongHalfKm);
    const full = offsetByBearing(along.lat, along.lon, trackHeading + 90, crossSign * crossHalfKm);
    return [full.lon, full.lat];
  });

  return {
    polygon: { type: "Polygon", coordinates: [[...corners, corners[0]]] },
    centroidLat,
    centroidLng,
    boundingRadiusKm: Math.sqrt(alongHalfKm ** 2 + crossHalfKm ** 2),
  };
}

// --- Conflicts: has someone else already staked this ground? --------------

export async function findConflicts(
  supabaseAdmin: SupabaseClient,
  callerId: string,
  centroidLat: number,
  centroidLng: number,
  boundingRadiusKm: number,
): Promise<ConflictSummary> {
  const { data: existing, error } = await supabaseAdmin
    .from("tasking_requests")
    .select("requester_id, centroid_lat, centroid_lng, bounding_radius_km")
    .in("review_status", ["pending_review", "approved", "auto_approved"]);

  if (error || !existing) {
    return { hasConflict: false, overlapType: null, ownRequest: false, conflictCount: 0 };
  }

  let overlapType: "full" | "partial" | null = null;
  let ownRequest = false;
  let conflictCount = 0;

  for (const other of existing) {
    const distanceKm = haversineKm(centroidLat, centroidLng, other.centroid_lat, other.centroid_lng);
    const sumRadii = boundingRadiusKm + other.bounding_radius_km;
    if (distanceKm > sumRadii) continue;

    conflictCount++;
    if (other.requester_id === callerId) ownRequest = true;

    const containment = Math.abs(boundingRadiusKm - other.bounding_radius_km);
    const thisOverlap: "full" | "partial" = distanceKm <= containment ? "full" : "partial";
    if (overlapType !== "full") overlapType = thisOverlap;
  }

  return { hasConflict: conflictCount > 0, overlapType, ownRequest, conflictCount };
}
