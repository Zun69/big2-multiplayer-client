// rank: 1=A, 2=2, 3..13=3..K
function rankToHenryValue(rank) {
  if (rank >= 3 && rank <= 13) return rank - 2; // 3->1 ... K->11
  if (rank === 1) return 12; // A
  if (rank === 2) return 13; // 2
  throw new Error("Bad rank");
}

// your suits: 0♦ 1♣ 2♥ 3♠
// henry mod4: 1♦ 2♣ 3♥ 0♠
const SUIT_TO_HENRY = [1, 2, 3, 0];

export function toHenryId(card) {
  const v = rankToHenryValue(card.rank); // 1..13
  const s = SUIT_TO_HENRY[card.suit];    // 1,2,3,0
  const suitOffset = (s === 0) ? 4 : s;  // make spades multiple of 4
  return (v - 1) * 4 + suitOffset;       // 1..52
}

export function henryValue(id) {
  return Math.ceil(id / 4); // 1..13
}

export function henrySuit(id) {
  return id % 4; // 1,2,3,0
}
