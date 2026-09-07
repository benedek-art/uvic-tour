/**
 * Hand-authored room-finding hints. OpenStreetMap has no indoor data for UVic, so
 * every word here is written by a human for someone who has never set foot in the
 * building.
 *
 * Tone (see docs/SPEC.md §5.7): concrete, confident, one short paragraph. Say which
 * side of the building to enter from, which wing the room is in, and what to do the
 * moment you're through the door. Where the interior layout genuinely isn't known,
 * give the reliable part — the wing, the floor, the signage to follow — rather than
 * inventing a corridor.
 *
 * `room` is matched against `Course.room` and `building` against `Course.building`,
 * so both must stay in sync with `src/data/schedule.ts`. The three entries whose
 * `room` is `MAIN_ENTRANCE` are the "just get me in the door" hints for each building.
 */

/** Sentinel `room` value for a building's main-entrance hint. */
export const MAIN_ENTRANCE = 'Main entrance'

export interface RoomHint {
  /** Room number as it appears on the schedule, or `MAIN_ENTRANCE`. */
  room: string
  /** Must match the OpenStreetMap building name used in `src/data/schedule.ts`. */
  building: string
  /** Wing letter or name, e.g. 'D'. */
  wing: string
  /** Floor number, ground floor = 1. */
  floor: number
  /** Which door to aim for. */
  entrance: string
  /** What to do once you're inside. */
  directions: string
}

export const ROOM_HINTS: RoomHint[] = [
  // --- MacLaurin Building ------------------------------------------------------
  {
    room: 'D287',
    building: 'MacLaurin Building',
    wing: 'D',
    floor: 2,
    entrance: 'Ring Road side, north end of the building',
    directions:
      'D wing is the north end. Enter from the Ring Road side and take the stairs immediately left of the entrance up one floor. Every room up there starts with D — 287 is along that corridor. Give yourself five minutes the first time.',
  },
  {
    room: 'A144',
    building: 'MacLaurin Building',
    wing: 'A',
    floor: 1,
    entrance: 'South end of MacLaurin, the courtyard side facing the Fine Arts buildings',
    directions:
      'A wing is the south end and A144 is on the ground floor, so no stairs — go in and follow the A-numbered signage. It is a big lecture theatre, so at ten to the hour just follow the crowd; both your PSYC sections are in this exact room.',
  },
  {
    room: MAIN_ENTRANCE,
    building: 'MacLaurin Building',
    wing: 'A and D',
    floor: 1,
    entrance: 'Ring Road side, between the Fine Arts complex and the Library',
    directions:
      'MacLaurin is the long building on the inner side of Ring Road near the Library. It runs north–south: D wing at the north end, A wing at the south end. Room numbers always start with the wing letter, so check the letter before you pick a door — walking in the wrong end costs you a couple of minutes of indoor corridor.',
  },

  // --- Bob Wright Centre -------------------------------------------------------
  {
    room: 'B150',
    building: 'Bob Wright Centre',
    wing: 'B',
    floor: 1,
    entrance: 'Main doors on the Ring Road side of the building',
    directions:
      'B150 is a ground-floor lecture theatre, so you stay on the level you walk in on. Head in the main doors and follow the signs for the 100-numbered rooms. This is your 08:30 Monday class — the building is quiet that early, and the theatre doors are the obvious big ones.',
  },
  {
    room: MAIN_ENTRANCE,
    building: 'Bob Wright Centre',
    wing: 'B',
    floor: 1,
    entrance: 'Ring Road side, in the science precinct next to Elliott and Cunningham',
    directions:
      'Bob Wright is the modern glass science building on the east side of campus, joined to the older Elliott and Cunningham buildings. Come off Ring Road and use the main doors; the first digit of a room number is its floor, so 150 is ground level.',
  },

  // --- Engineering/Computer Science Building -----------------------------------
  {
    room: '123',
    building: 'Engineering/Computer Science Building',
    wing: 'ECS',
    floor: 1,
    entrance: 'Main doors facing the engineering courtyard, off Ring Road',
    directions:
      'ECS numbers its rooms by floor: 123 is on the ground floor, so walk in and stay level. This is the room you walk to from MacLaurin after Italian — about 266 m, four minutes, straight across the middle of campus. Leaving at 12:25 gets you there comfortably.',
  },
  {
    room: MAIN_ENTRANCE,
    building: 'Engineering/Computer Science Building',
    wing: 'ECS',
    floor: 1,
    entrance: 'Main doors off the engineering courtyard, on the Ring Road side',
    directions:
      'ECS sits with the other engineering buildings on the south-east side of Ring Road. Use the main doors off the courtyard. Room numbers are floor-first — 1xx ground, 2xx one up — which makes it one of the easier buildings on campus to navigate.',
  },
]
