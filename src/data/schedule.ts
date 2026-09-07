/**
 * THE ONE EDITABLE FILE.
 *
 * Every screen in this app is driven by the array below. To add, remove, or change a
 * course, edit `COURSES` — nothing else needs to change.
 *
 * Rules when hand-editing:
 *   - `start` / `end` are MINUTES FROM MIDNIGHT (08:30 -> 510, 19:20 -> 1160).
 *     Use `hhmmToMinutes('08:30')` from `src/core/time.ts` if you'd rather not do the math.
 *   - `building` MUST match the OpenStreetMap `name` property character-for-character,
 *     because the 3D map layer highlights buildings by filtering on this exact string.
 *     The three valid values are listed in `SCHEDULE_BUILDINGS` below.
 *   - `id` must be unique; it is used as a DOM id and as a store key.
 *
 * Source of truth: docs/SPEC.md §2 (the student's real Fall 2026 registration).
 */

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'

export interface Course {
  /** Stable unique slug, e.g. 'biol-184-a01'. Used as a DOM id and store key. */
  id: string
  /** Course code as printed on the registration, e.g. 'BIOL 184'. */
  code: string
  /** Section, e.g. 'A01'. */
  section: string
  title: string
  crn: number
  units: number
  /** Every weekday this course meets. */
  days: Day[]
  /** Minutes from midnight, campus time. */
  start: number
  /** Minutes from midnight, campus time. */
  end: number
  /** MUST equal the OpenStreetMap building `name` exactly — see SCHEDULE_BUILDINGS. */
  building: string
  room: string
  instructor: string
}

/**
 * The only three building names the schedule may reference. These strings are copied
 * from the OpenStreetMap `name` tag and are matched exactly by the map layer filters.
 */
export const SCHEDULE_BUILDINGS = [
  'Bob Wright Centre',
  'MacLaurin Building',
  'Engineering/Computer Science Building',
] as const

export const COURSES: Course[] = [
  {
    id: 'biol-184-a01',
    code: 'BIOL 184',
    section: 'A01',
    title: 'Evolution and Biodiversity',
    crn: 10258,
    units: 1.5,
    days: ['Mon', 'Thu'],
    start: 510, // 08:30
    end: 590, // 09:50
    building: 'Bob Wright Centre',
    room: 'B150',
    instructor: 'David Punzalan',
  },
  {
    id: 'ital-100a-a01',
    code: 'ITAL 100A',
    section: 'A01',
    title: "Beginners' Italian I",
    crn: 11996,
    units: 1.5,
    days: ['Tue', 'Wed', 'Fri'],
    start: 690, // 11:30
    end: 740, // 12:20
    building: 'MacLaurin Building',
    room: 'D287',
    instructor: 'Marina Bettaglio',
  },
  {
    id: 'biol-150a-a02',
    code: 'BIOL 150A',
    section: 'A02',
    title: 'Modern Biology',
    crn: 10257,
    units: 1.5,
    days: ['Tue', 'Wed', 'Fri'],
    start: 810, // 13:30
    end: 860, // 14:20
    building: 'Engineering/Computer Science Building',
    room: '123',
    instructor: 'Gerry Gourlay',
  },
  {
    id: 'psyc-100b-a01',
    code: 'PSYC 100B',
    section: 'A01',
    title: 'Introductory Psychology II',
    crn: 13005,
    units: 1.5,
    days: ['Mon', 'Thu'],
    start: 990, // 16:30
    end: 1070, // 17:50
    building: 'MacLaurin Building',
    // Deliberately the same room as PSYC 100A — 17:50 -> 18:00 on Monday is a
    // 10-minute "stay put" gap, not a walk. This is not a typo.
    room: 'A144',
    instructor: 'Imran Tatla',
  },
  {
    id: 'psyc-100a-a04',
    code: 'PSYC 100A',
    section: 'A04',
    title: 'Introductory Psychology I',
    crn: 13004,
    units: 1.5,
    days: ['Mon', 'Wed'],
    start: 1080, // 18:00
    end: 1160, // 19:20
    building: 'MacLaurin Building',
    room: 'A144',
    instructor: 'Randal Tonks',
  },
]
