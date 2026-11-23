\version "2.24.0"
\header {
  title = "Recognition study"
  subtitle = "Sixteenths, triplets and close chords"
  tagline = ##f
}
\paper { #(set-paper-size "a5") }
\score {
  \new PianoStaff <<
    \new Staff { \absolute { \clef treble \time 4/4
      c'16 d'16 e'16 f'16 g'16 f'16 e'16 d'16 c'16 e'16 g'16 e'16 d'16 f'16 a'16 g'16 | \break
      \tuplet 3/2 { g'8 a'8 g'8 } \tuplet 3/2 { f'8 g'8 f'8 } \tuplet 3/2 { e'8 f'8 e'8 } \tuplet 3/2 { d'8 e'8 d'8 } | \break
      <c' d' ees' g'>4 <f' g' aes' c''>4 <g' a' b' d''>4 <c' ees' f' g'>4
    } }
    \new Staff { \absolute { \clef bass \time 4/4
      c4 g,4 c4 g,4 |
      g,4 c4 f,4 g,4 |
      c4 f,4 g,4 c4
    } }
  >>
  \layout { }
}
