// Simplified circular-orbit propagation for a 6-satellite constellation —
// ported from the sibling Satellite Foresight project's orbit model. Enough
// to compute realistic pass geometry (ground track, off-nadir angle, swath
// heading) for the feasibility tool below. Deliberately not SGP4/real
// astrodynamics — no TLEs exist for satellites that don't exist yet. This is
// a mock, physically-plausible sun-synchronous LEO model.

const EARTH_RADIUS_KM = 6371;
const MU_EARTH = 398600.4418; // km^3/s^2, standard gravitational parameter
const EARTH_ROT_DEG_PER_SEC = 360 / 86164.0905; // sidereal day

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Fixed at module load — every satellite's clock starts "now," relative to
// when this edge function isolate was last cold-started.
const EPOCH_MS = Date.now();

export const ALTITUDE_KM = 500;
const INCLINATION_DEG = 97.4; // sun-synchronous-like, typical for EO smallsats

export interface OrbitElements {
  altitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  m0Deg: number;
}

// Orbital elements per satellite — same altitude/inclination (uniform
// fleet), spread across distinct RAAN + phase so ground tracks don't overlap.
export const SAT_ORBITS: Record<string, OrbitElements> = {
  "CS-1": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 0, m0Deg: 0 },
  "CS-2": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 60, m0Deg: 40 },
  "CS-3": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 120, m0Deg: 200 },
  "CS-4": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 180, m0Deg: 90 },
  "CS-5": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 240, m0Deg: 300 },
  "CS-6": { altitudeKm: ALTITUDE_KM, inclinationDeg: INCLINATION_DEG, raanDeg: 300, m0Deg: 150 },
};

// Sensor geometry: FOV is the instantaneous (near-nadir) imaging swath; FOR
// is everything reachable this pass via slewing up to the max off-nadir angle.
export const NATIVE_GSD_M = 0.8;
export const FOV_HALF_WIDTH_KM = 8;
export const FOR_MAX_OFFNADIR_DEG = 30;

/** Ground distance (km) for a given off-nadir look angle, via the standard satellite-geometry triangle (law of sines). Returns null past the horizon. */
export function groundOffsetForNadirAngle(offNadirDeg: number, altitudeKm: number): number | null {
  const r = EARTH_RADIUS_KM + altitudeKm;
  const etaRad = offNadirDeg * DEG2RAD;
  const ratio = (r / EARTH_RADIUS_KM) * Math.sin(etaRad);
  if (ratio > 1) return null;
  const lambdaRad = Math.asin(ratio) - etaRad;
  return EARTH_RADIUS_KM * lambdaRad;
}

export const FOR_HALF_WIDTH_KM = groundOffsetForNadirAngle(FOR_MAX_OFFNADIR_DEG, ALTITUDE_KM)!;

/** Inverse of groundOffsetForNadirAngle — the off-nadir look angle needed to reach a target a given ground distance (km) from the sub-satellite point. */
export function offNadirAngleForGroundOffset(groundDistKm: number, altitudeKm: number): number {
  const r = EARTH_RADIUS_KM + altitudeKm;
  const k = r / EARTH_RADIUS_KM;
  const lambdaRad = groundDistKm / EARTH_RADIUS_KM;
  const etaRad = Math.atan2(Math.sin(lambdaRad), k - Math.cos(lambdaRad));
  return etaRad * RAD2DEG;
}

/** Sub-satellite point at an absolute time (ms since epoch). Longitude is continuous/unwrapped. */
export function subPointRaw(satId: string, timeMs: number): { lat: number; lon: number } | null {
  const orb = SAT_ORBITS[satId];
  if (!orb) return null;

  const a = EARTH_RADIUS_KM + orb.altitudeKm;
  const n = Math.sqrt(MU_EARTH / (a * a * a)); // mean motion, rad/s
  const tSec = (timeMs - EPOCH_MS) / 1000;
  const u = orb.m0Deg * DEG2RAD + n * tSec; // argument of latitude (circular orbit)

  const iRad = orb.inclinationDeg * DEG2RAD;
  const latRad = Math.asin(Math.sin(iRad) * Math.sin(u));

  const deltaLambdaRad = Math.atan2(Math.cos(iRad) * Math.sin(u), Math.cos(u));
  const earthRotRad = EARTH_ROT_DEG_PER_SEC * tSec * DEG2RAD;
  const lonRad = orb.raanDeg * DEG2RAD + deltaLambdaRad - earthRotRad;

  return { lat: latRad * RAD2DEG, lon: lonRad * RAD2DEG };
}

/** Initial bearing (deg, 0=N/90=E) from point A to point B — standard spherical formula. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dLambda = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/** Ground-track heading (deg) for a satellite at a given time, via a small forward difference. */
export function headingAt(satId: string, timeMs: number): number | null {
  const a = subPointRaw(satId, timeMs);
  const b = subPointRaw(satId, timeMs + 1000);
  if (!a || !b) return null;
  return bearingDeg(a.lat, a.lon, b.lat, b.lon);
}

/** Offset a lat/lon by a bearing + distance (km) — flat-earth approx, fine for the small offsets used here. */
export function offsetByBearing(lat: number, lon: number, bearingDegVal: number, distKm: number): { lat: number; lon: number } {
  const rad = bearingDegVal * DEG2RAD;
  const dNorthKm = distKm * Math.cos(rad);
  const dEastKm = distKm * Math.sin(rad);
  const dLat = dNorthKm / 111.32;
  const dLon = dEastKm / (111.32 * Math.cos(lat * DEG2RAD));
  return { lat: lat + dLat, lon: lon + dLon };
}
