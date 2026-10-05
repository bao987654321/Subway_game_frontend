import './TripLetters.css'
import { getTripLetterColors } from './trip-letter-colors'

export interface TripLettersProps {
  /** Route letters or numbers, in the order they were collected. */
  letters: readonly string[]
}

export function TripLetters({ letters }: TripLettersProps) {
  return (
    <section className="trip-letters-card" aria-label="Trip letters">
      <h2 className="trip-letters-title">Trip letters</h2>
      {letters.length > 0 ? (
        <ol className="trip-letters-list" role="list" aria-label="Routes taken, in order">
          {letters.map((letter, index) => (
            <li
              className="trip-letters-badge"
              key={index}
              style={getTripLetterColors(letter)}
            >
              {letter}
            </li>
          ))}
        </ol>
      ) : (
        <p className="trip-letters-empty">No trips yet.</p>
      )}
    </section>
  )
}
