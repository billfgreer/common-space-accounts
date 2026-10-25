// Simplified solar position algorithm (Meeus/NOAA-style low-precision form)
// for computing solar elevation angle at a given UTC time + lat/lon. Accurate
// to within roughly 0.01 degrees for dates near the present — more than
// enough for a "is the sun up / is the lighting good" feasibility check.

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0); // noon Jan 1 2000 (TT ~ UTC here)
const DAY_MS = 86400000;

/** Solar elevation angle (degrees above horizon) at a given instant and ground location. */
export function solarElevationDeg(date: Date, latDeg: number, lonDeg: number): number {
  const n = (date.getTime() - J2000_MS) / DAY_MS; // days since J2000

  const meanLonDeg = (280.46 + 0.9856474 * n) % 360; // mean longitude of the Sun
  const meanAnomRad = (((357.528 + 0.9856003 * n) % 360) + 360) % 360 * DEG2RAD; // mean anomaly

  const eclipticLonRad =
    (meanLonDeg + 1.915 * Math.sin(meanAnomRad) + 0.02 * Math.sin(2 * meanAnomRad)) * DEG2RAD;
  const obliquityRad = (23.439 - 0.0000004 * n) * DEG2RAD;

  const rightAscRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(eclipticLonRad),
    Math.cos(eclipticLonRad),
  );
  const declRad = Math.asin(Math.sin(obliquityRad) * Math.sin(eclipticLonRad));

  const gmstDeg = (280.46061837 + 360.98564736629 * n) % 360; // Greenwich mean sidereal time
  let hourAngleDeg = (gmstDeg + lonDeg - rightAscRad * RAD2DEG + 360) % 360;
  if (hourAngleDeg > 180) hourAngleDeg -= 360;
  const hourAngleRad = hourAngleDeg * DEG2RAD;

  const latRad = latDeg * DEG2RAD;
  const elevationRad = Math.asin(
    Math.sin(latRad) * Math.sin(declRad) +
      Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad),
  );

  return elevationRad * RAD2DEG;
}
