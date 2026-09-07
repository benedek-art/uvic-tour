/**
 * Sunset for the UVic campus. Pure: no DOM, no map, no imports from src/map or src/ui.
 *
 * Why this module exists (docs/SPEC.md §5.9): Victoria gets dark astonishingly early in
 * the second half of term — sunset is around 16:20 in mid-November, while PSYC 100A runs
 * until 19:20 on Monday and Wednesday and PSYC 100B until 17:50. A first-year who has
 * never wintered here will walk out of MacLaurin into full darkness without expecting it.
 * `endsAfterDark` is what lets the app say so before it happens.
 *
 * Method: the standard NOAA solar-position approximation — fractional year, equation of
 * time, solar declination, then the hour angle at a zenith of 90.833°, which is 90° plus
 * an allowance for atmospheric refraction (~34') and the apparent radius of the solar
 * disc (~16'). Accurate to a couple of minutes at this latitude, which is far inside the
 * tolerance for "bring a light".
 *
 * Daylight saving is never hardcoded. The NOAA math yields an instant in UTC; that
 * instant is converted to America/Vancouver by `minutesOfDate`, which reads the OS
 * timezone database. The term straddles the PDT -> PST change on 2026-11-01, so a fixed
 * offset would put every November sunset an hour late.
 */

import type { Session } from './week'
import { campusDateKey, minutesOfDate } from './time'

/** UVic campus centre. Decimal degrees, longitude negative west of Greenwich. */
export const CAMPUS_LAT = 48.4634
export const CAMPUS_LON = -123.3117

/**
 * Zenith angle of the sun's centre at the moment the upper limb touches the horizon:
 * 90° + 34' refraction + 16' solar semi-diameter. The standard "official" sunset.
 */
const SUNSET_ZENITH_DEG = 90.833

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const MINUTES_PER_DAY = 1440
/** Minutes of Earth rotation per degree of longitude / hour angle: 1440 / 360. */
const MINUTES_PER_DEGREE = 4

/** 1-based day of the year for a proleptic Gregorian calendar date. */
function dayOfYear(year: number, month: number, day: number): number {
  const msPerDay = 86_400_000
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / msPerDay) + 1
}

/** Parse the 'YYYY-MM-DD' campus date key into numeric parts. */
function parseDateKey(key: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  const y = match?.[1]
  const m = match?.[2]
  const d = match?.[3]
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Expected a campus date key like "2026-11-15", got ${JSON.stringify(key)}`)
  }
  return { year: Number(y), month: Number(m), day: Number(d) }
}

/**
 * Sunset for the given day, as minutes from midnight in LOCAL VICTORIA time
 * (America/Vancouver), 0..1439.
 *
 * The argument is an instant; only the campus-local calendar date it falls on is used,
 * so any time of day on the right date gives the same answer.
 *
 * Latitude/longitude default to the UVic campus centre. Longitude is east-positive
 * (so Victoria is negative), matching GeoJSON and MapLibre coordinate order.
 *
 * Above the Arctic / below the Antarctic circle the sun may never set on a given day; in
 * that case the hour angle is undefined and this clamps to the closest real solution
 * rather than returning NaN. Irrelevant at 48°N, but it keeps the function total.
 */
export function sunsetMinutes(date: Date, lat: number = CAMPUS_LAT, lon: number = CAMPUS_LON): number {
  const { year, month, day } = parseDateKey(campusDateKey(date))
  const doy = dayOfYear(year, month, day)

  // Fractional year, radians. The (hour - 12)/24 term of the NOAA formula is zero
  // because we evaluate at local solar noon, which is close enough to sunset for the
  // slowly-varying quantities below.
  const gamma = ((2 * Math.PI) / 365) * (doy - 1)

  // Equation of time, minutes: the difference between apparent and mean solar time,
  // caused by Earth's orbital eccentricity and axial tilt. Swings roughly ±16 min.
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))

  // Solar declination, radians.
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const latRad = lat * DEG_TO_RAD
  const cosHourAngle =
    Math.cos(SUNSET_ZENITH_DEG * DEG_TO_RAD) / (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl)

  // Clamp for polar day / polar night, where no solution exists.
  const clamped = Math.min(1, Math.max(-1, cosHourAngle))
  const hourAngleDeg = Math.acos(clamped) * RAD_TO_DEG

  // NOAA's formula is written with west-positive longitude, hence the negation.
  const westLon = -lon
  // Minutes from UTC midnight of the same calendar date. May exceed 1440 (sunset in
  // Victoria falls after 00:00 UTC in winter); the Date constructor rolls that over.
  const sunsetUtcMinutes =
    720 + MINUTES_PER_DEGREE * (westLon + hourAngleDeg) - eqTime

  const instant = new Date(Date.UTC(year, month - 1, day) + sunsetUtcMinutes * 60_000)

  // Back to campus-local wall-clock minutes. This is where DST is resolved, by the
  // OS timezone database rather than by any assumption in this file.
  return minutesOfDate(instant)
}

/**
 * Does this session let out at or after sunset on the given day?
 *
 * `session.end` is minutes from campus-local midnight, the same scale `sunsetMinutes`
 * returns, so the comparison is direct. Equality counts as dark: a class ending exactly
 * at sunset still means walking home in the dusk.
 */
export function endsAfterDark(session: Session, date: Date): boolean {
  return session.end >= sunsetMinutes(date)
}
