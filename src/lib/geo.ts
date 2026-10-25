// AOI footprint math for the two imaging modes.
//
// Flat-earth (local tangent plane) approximation — adequate at the scale
// used here (max strip length 30km, spot 6x6km) and avoids pulling in a
// geodesy library for v1.

export type LngLat = [number, number];

export interface AoiFootprint {
  mode: "spot" | "strip";
  polygon: GeoJSON.Polygon;
  centroidLat: number;
  centroidLng: number;
  boundingRadiusKm: number;
}

const KM_PER_DEG_LAT = 111.32;
const SPOT_SIZE_KM = 6;
const STRIP_WIDTH_KM = 6;

function kmToLngLat(originLng: number, originLat: number, dxKm: number, dyKm: number): LngLat {
  const lat = originLat + dyKm / KM_PER_DEG_LAT;
  const lng = originLng + dxKm / (KM_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180));
  return [lng, lat];
}

function ring(points: LngLat[]): GeoJSON.Polygon {
  return { type: "Polygon", coordinates: [[...points, points[0]]] };
}

/** 6x6km square centered on the clicked point. */
export function buildSpotFootprint(center: LngLat): AoiFootprint {
  const [lng, lat] = center;
  const half = SPOT_SIZE_KM / 2;
  const corners: LngLat[] = [
    kmToLngLat(lng, lat, -half, -half),
    kmToLngLat(lng, lat, half, -half),
    kmToLngLat(lng, lat, half, half),
    kmToLngLat(lng, lat, -half, half),
  ];

  return {
    mode: "spot",
    polygon: ring(corners),
    centroidLat: lat,
    centroidLng: lng,
    boundingRadiusKm: Math.sqrt(half ** 2 + half ** 2),
  };
}

/** 6km-wide rectangle running from pointA to pointB, clamped to maxLengthKm. */
export function buildStripFootprint(pointA: LngLat, pointB: LngLat, maxLengthKm: number): AoiFootprint {
  const [lngA, latA] = pointA;
  const [lngB, latB] = pointB;

  // Local planar offset of B relative to A, in km.
  let xB = (lngB - lngA) * KM_PER_DEG_LAT * Math.cos((latA * Math.PI) / 180);
  let yB = (latB - latA) * KM_PER_DEG_LAT;

  let length = Math.sqrt(xB ** 2 + yB ** 2);
  if (length === 0) {
    xB = 0.01;
    length = 0.01;
  }
  if (length > maxLengthKm) {
    const scale = maxLengthKm / length;
    xB *= scale;
    yB *= scale;
    length = maxLengthKm;
  }

  const ux = xB / length;
  const uy = yB / length;
  const px = -uy;
  const py = ux;
  const halfWidth = STRIP_WIDTH_KM / 2;

  const corners: LngLat[] = [
    kmToLngLat(lngA, latA, px * halfWidth, py * halfWidth),
    kmToLngLat(lngA, latA, xB + px * halfWidth, yB + py * halfWidth),
    kmToLngLat(lngA, latA, xB - px * halfWidth, yB - py * halfWidth),
    kmToLngLat(lngA, latA, -px * halfWidth, -py * halfWidth),
  ];

  const midX = xB / 2;
  const midY = yB / 2;
  const [centroidLng, centroidLat] = kmToLngLat(lngA, latA, midX, midY);

  return {
    mode: "strip",
    polygon: ring(corners),
    centroidLat,
    centroidLng,
    boundingRadiusKm: Math.sqrt(halfWidth ** 2 + (length / 2) ** 2),
  };
}

export const MAX_STRIP_LENGTH_KM = 30;
