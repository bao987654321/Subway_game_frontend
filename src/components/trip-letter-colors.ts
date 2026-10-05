interface TripLetterColors {
  readonly backgroundColor: string
  readonly color: string
}

// Backgrounds from the MTA palette: https://www.mta.info/document/168976
// Dark text keeps the lighter route colors readable at badge size.
const blue = { backgroundColor: '#0062CF', color: '#FFFFFF' }
const orange = { backgroundColor: '#EB6800', color: '#111827' }
const lightGreen = { backgroundColor: '#799534', color: '#111827' }
const brown = { backgroundColor: '#8E5C33', color: '#FFFFFF' }
const gray = { backgroundColor: '#7C858C', color: '#111827' }
const yellow = { backgroundColor: '#F6BC26', color: '#111827' }
const red = { backgroundColor: '#D82233', color: '#FFFFFF' }
const green = { backgroundColor: '#009952', color: '#111827' }
const purple = { backgroundColor: '#9A38A1', color: '#FFFFFF' }
const sirBlue = { backgroundColor: '#08179C', color: '#FFFFFF' }

export const TRIP_LETTER_COLORS: ReadonlyMap<string, TripLetterColors> = new Map([
  ['1', red],
  ['2', red],
  ['3', red],
  ['4', green],
  ['5', green],
  ['6', green],
  ['7', purple],
  ['A', blue],
  ['C', blue],
  ['E', blue],
  ['B', orange],
  ['D', orange],
  ['F', orange],
  ['M', orange],
  ['G', lightGreen],
  ['J', brown],
  ['Z', brown],
  ['L', gray],
  ['S', gray],
  ['FS', gray],
  ['GS', gray],
  ['H', gray],
  ['N', yellow],
  ['Q', yellow],
  ['R', yellow],
  ['W', yellow],
  ['SI', sirBlue],
  ['SIR', sirBlue],
])

export const DEFAULT_TRIP_LETTER_COLORS: TripLetterColors = {
  backgroundColor: '#344054',
  color: '#FFFFFF',
}

/** Prefer an exact route match, then its first letter, then a neutral badge. */
export function getTripLetterColors(letter: string): TripLetterColors {
  const route = letter.trim().toUpperCase()
  return TRIP_LETTER_COLORS.get(route)
    ?? TRIP_LETTER_COLORS.get(route.charAt(0))
    ?? DEFAULT_TRIP_LETTER_COLORS
}
