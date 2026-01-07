// henryLegal.js
// Port of Henry Charlesworth's legal-move enumeration + action masking.
// Matches big2_PPOalgorithm (enumerateOptions.py + gameLogic.py) action space:
// nActions = [13,33,31,330,1287,1694] and passInd = 1694 (ACTION_DIM = 1695)

import { toHenryId } from "./henryCardId.js";

export const nActions = [13, 33, 31, 330, 1287, 1694];
export const nAcSum = [nActions[0], nActions[0] + nActions[1], nActions[0] + nActions[1] + nActions[2], nActions[0] + nActions[1] + nActions[2] + nActions[3]];
export const passInd = nActions[5];
export const ACTION_DIM = passInd + 1; // 1695

export function getIndex(option, nCards) {
  if (nCards === 0) return passInd;
  let sInd = 0;
  for (let i = 0; i < nCards - 1; i++) sInd += nActions[i];
  return sInd + option;
}

export function getOptionNC(ind) {
  if (ind === passInd) return { option: -1, nCards: 0 };
  if (ind < nAcSum[0]) return { option: ind, nCards: 1 };
  if (ind < nAcSum[1]) return { option: ind - nAcSum[0], nCards: 2 };
  if (ind < nAcSum[2]) return { option: ind - nAcSum[1], nCards: 3 };
  if (ind < nAcSum[3]) return { option: ind - nAcSum[2], nCards: 4 };
  return { option: ind - nAcSum[3], nCards: 5 };
}

// ----------------------------
// gameLogic.py ports
// ----------------------------

export function cardValue(id) {
  // Henry: value is ceil(id/4), 1..13
  return Math.ceil(id / 4);
}

export function isPair(hand) {
  return hand.length === 2 && Math.ceil(hand[0] / 4) === Math.ceil(hand[1] / 4);
}

export function isThreeOfAKind(hand) {
  return hand.length === 3 && Math.ceil(hand[0] / 4) === Math.ceil(hand[1] / 4) && Math.ceil(hand[1] / 4) === Math.ceil(hand[2] / 4);
}

export function isFourOfAKind(hand) {
  return hand.length === 4 && Math.ceil(hand[0] / 4) === Math.ceil(hand[1] / 4) && Math.ceil(hand[1] / 4) === Math.ceil(hand[2] / 4) && Math.ceil(hand[2] / 4) === Math.ceil(hand[3] / 4);
}

export function isTwoPair(hand) {
  if (hand.length !== 4) return false;
  if (isFourOfAKind(hand)) return false;
  const h = [...hand].sort((a, b) => a - b);
  return isPair(h.slice(0, 2)) && isPair(h.slice(2));
}

export function isStraightFlush(hand) {
  if (hand.length !== 5) return false;
  const h = [...hand].sort((a, b) => a - b);
  return (h[0] + 4 === h[1]) && (h[1] + 4 === h[2]) && (h[2] + 4 === h[3]) && (h[3] + 4 === h[4]);
}

export function isStraight(hand) {
  if (hand.length !== 5) return false;
  const h = [...hand].sort((a, b) => a - b);
  return (Math.ceil(h[0] / 4) + 1 === Math.ceil(h[1] / 4)) &&
         (Math.ceil(h[1] / 4) + 1 === Math.ceil(h[2] / 4)) &&
         (Math.ceil(h[2] / 4) + 1 === Math.ceil(h[3] / 4)) &&
         (Math.ceil(h[3] / 4) + 1 === Math.ceil(h[4] / 4));
}

export function isFlush(hand) {
  if (hand.length !== 5) return false;
  return (hand[0] % 4 === hand[1] % 4) && (hand[1] % 4 === hand[2] % 4) && (hand[2] % 4 === hand[3] % 4) && (hand[3] % 4 === hand[4] % 4);
}

export function isFullHouse(hand) {
  if (hand.length !== 5) return { ok: false };
  const h = [...hand].sort((a, b) => a - b);
  if (isPair(h.slice(0, 2)) && isThreeOfAKind(h.slice(2))) return { ok: true, threeVal: Math.ceil(h[3] / 4) };
  if (isThreeOfAKind(h.slice(0, 3)) && isPair(h.slice(3))) return { ok: true, threeVal: Math.ceil(h[0] / 4) };
  return { ok: false };
}

// ---- 5-card: four of a kind + kicker detection + comparison key ----
function fourKindInfo5(hand) {
  if (!hand || hand.length !== 5) return { ok: false };

  const counts = new Map();
  for (const id of hand) {
    const v = cardValue(id); // 1..13
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  if (counts.size !== 2) return { ok: false };

  let quadVal = null;
  for (const [v, c] of counts.entries()) {
    if (c === 4) quadVal = v;
  }
  if (quadVal == null) return { ok: false };

  // kicker = the lone card not in the quad
  let kickerId = null;
  for (const id of hand) {
    if (cardValue(id) !== quadVal) { kickerId = id; break; }
  }

  // for comparisons: compare quad value first, then kicker id as tie-break
  return { ok: true, quadVal, kickerId: kickerId ?? -1 };
}

function straightHighId5(hand) {
  // Henry compares straights/flushes using the "high" card id (max id works with his encoding)
  let m = -Infinity;
  for (const id of hand) if (id > m) m = id;
  return m;
}

function flushSuitRank5(hand) {
  // Henry suit encoding: id % 4 => 1:D, 2:C, 3:H, 0:S
  const s = hand[0] % 4;
  return (s === 0) ? 4 : s; // D=1, C=2, H=3, S=4
}


// card + handsAvailable (enough fields for enumerateOptions)
class CardMeta {
  constructor(id, indexInHand) {
    this.id = id;
    this.indexInHand = indexInHand;
    this.value = cardValue(id);
    this.suit = id % 4; // 1♦ 2♣ 3♥ 0♠
    this.inPair = 0;
    this.inThreeOfAKind = 0;
    this.inFourOfAKind = 0;
    this.inStraight = 0;
    this.inFlush = 0;
    this.flushIndex = -1;
    this.straightIndex = -1;
  }
}

export class HandsAvailable {
  constructor(currentHand, nC = 0) {
    this.cHand = [...currentHand].sort((a, b) => a - b);
    this.handLength = this.cHand.length;
    this.cards = {};
    for (let i = 0; i < this.cHand.length; i++) {
      this.cards[this.cHand[i]] = new CardMeta(this.cHand[i], i);
    }
    this.flushes = [];
    this.pairs = [];
    this.threeOfAKinds = [];
    this.fourOfAKinds = [];
    this.straights = [];
    this.nPairs = 0;
    this.nThreeOfAKinds = 0;
    this.nDistinctPairs = 0;

    if (nC === 2) {
      this.fillPairs();
    } else if (nC === 3) {
      this.fillThreeOfAKinds();
    } else if (nC === 4) {
      this.fillFourOfAKinds();
      this.fillPairs();
    } else {
      this.fillPairs();
      this.fillSuits();
      this.fillStraights();
      this.fillThreeOfAKinds();
      this.fillFourOfAKinds();
    }
  }

  fillSuits() {
    const diamonds = [];
    const clubs = [];
    const hearts = [];
    const spades = [];

    for (let i = 0; i < this.handLength; i++) {
      const id = this.cHand[i];
      const val = id % 4;
      if (val === 1) diamonds.push(id);
      else if (val === 2) clubs.push(id);
      else if (val === 3) hearts.push(id);
      else spades.push(id);
    }

    if (diamonds.length >= 5) this.flushes.push(diamonds);
    if (clubs.length >= 5) this.flushes.push(clubs);
    if (hearts.length >= 5) this.flushes.push(hearts);
    if (spades.length >= 5) this.flushes.push(spades);

    for (let i = 0; i < this.flushes.length; i++) {
      const flush = this.flushes[i];
      for (const id of flush) {
        this.cards[id].inFlush = 1;
        this.cards[id].flushIndex = i;
      }
    }
  }

  fillStraights() {
    let streak = 0;
    let cInd = 0;
    let sInd = 0;

    while (cInd < this.cHand.length - 1) {
      const cVal = this.cards[this.cHand[cInd]].value;
      const nVal = this.cards[this.cHand[cInd + 1]].value;
      if (nVal === cVal + 1) {
        streak += 1;
        cInd += 1;
      } else if (nVal === cVal) {
        cInd += 1;
      } else {
        if (streak >= 4) this.straights.push(this.cHand.slice(sInd, cInd + 1));
        streak = 0;
        cInd = cInd + 1;
        sInd = cInd;
      }
    }
    if (streak >= 4) this.straights.push(this.cHand.slice(sInd));

    for (let i = 0; i < this.straights.length; i++) {
      const straight = this.straights[i];
      for (const id of straight) {
        this.cards[id].inStraight = 1;
        this.cards[id].straightIndex = i;
      }
    }
  }

  fillPairs() {
    let cVal = -1;
    let nDistinct = 0;

    for (let i = 0; i < this.handLength - 1; i++) {
      for (let j = i + 1; j < i + 4; j++) {
        if (j >= this.handLength) continue;
        const a = this.cHand[i];
        const b = this.cHand[j];
        if (isPair([a, b])) {
          const nVal = cardValue(a);
          if (nVal !== cVal) {
            nDistinct += 1;
            cVal = nVal;
          }
          this.pairs.push([a, b]);
          this.nPairs += 1;
          this.nDistinctPairs = nDistinct;
          this.cards[a].inPair = 1;
          this.cards[b].inPair = 1;
        }
      }
    }
  }

  fillThreeOfAKinds() {
    for (let i = 0; i < this.handLength - 2; i++) {
      for (let j = i + 1; j < i + 3; j++) {
        if (j + 1 >= this.handLength) continue;
        const a = this.cHand[i];
        const b = this.cHand[j];
        const c = this.cHand[j + 1];
        if (isThreeOfAKind([a, b, c])) {
          this.threeOfAKinds.push([a, b, c]);
          this.nThreeOfAKinds += 1;
          this.cards[a].inThreeOfAKind = 1;
          this.cards[b].inThreeOfAKind = 1;
          this.cards[c].inThreeOfAKind = 1;
        }
      }
    }
  }

  fillFourOfAKinds() {
    for (let i = 0; i < this.handLength - 3; i++) {
      const a = this.cHand[i];
      // Henry shortcut: only check if first suit == 1
      if (this.cards[a].suit !== 1) continue;
      if (Math.ceil(a / 4) === Math.ceil(this.cHand[i + 1] / 4) &&
          Math.ceil(a / 4) === Math.ceil(this.cHand[i + 2] / 4) &&
          Math.ceil(a / 4) === Math.ceil(this.cHand[i + 3] / 4)) {
        const four = [this.cHand[i], this.cHand[i + 1], this.cHand[i + 2], this.cHand[i + 3]];
        this.fourOfAKinds.push(four);
        for (const id of four) this.cards[id].inFourOfAKind = 1;
      }
    }
  }
}

// ----------------------------
// enumerateOptions.py ports
// ----------------------------

export function oneCardOptions(hand, prevHand = [], prevType = 0) {
  const nCards = hand.length;
  const out = [];
  for (let i = 0; i < nCards; i++) {
    if (prevType === 1) {
      if (prevHand > hand[i]) continue;
    }
    out.push(i);
  }
  return out.length ? out : -1;
}

export function twoCardOptions(handOptions, prevHand = [], prevType = 0, actionIndices) {
  // prevType = 1 means must beat prevHand
  const valid = [];
  for (const pair of handOptions.pairs) {
    const i0 = handOptions.cards[pair[0]].indexInHand;
    const i1 = handOptions.cards[pair[1]].indexInHand;
    if (prevType === 1) {
      if (handOptions.cHand[i1] < prevHand[1]) continue;
    }
    valid.push(actionIndices.twoCardIndices[i0][i1]);
  }
  return valid.length ? valid : -1;
}

export function threeCardOptions(handOptions, prevHand = [], prevType = 0, actionIndices) {
  const valid = [];
  if (handOptions.nThreeOfAKinds > 0) {
    for (const three of handOptions.threeOfAKinds) {
      const i0 = handOptions.cards[three[0]].indexInHand;
      const i1 = handOptions.cards[three[1]].indexInHand;
      const i2 = handOptions.cards[three[2]].indexInHand;
      if (prevType === 1) {
        if (handOptions.cHand[i0] < prevHand[2]) continue;
      }
      valid.push(actionIndices.threeCardIndices[i0][i1][i2]);
    }
  }
  return valid.length ? valid : -1;
}

export function fourCardOptions(handOptions, prevHand = [], prevType = 0, actionIndices) {
  // prevType: 1 - pair (two pair), 2 - four-of-a-kind
  const valid = [];

  // four of a kinds
  if (handOptions.fourOfAKinds.length > 0) {
    for (const four of handOptions.fourOfAKinds) {
      const i0 = handOptions.cards[four[0]].indexInHand;
      const i1 = handOptions.cards[four[1]].indexInHand;
      const i2 = handOptions.cards[four[2]].indexInHand;
      const i3 = handOptions.cards[four[3]].indexInHand;
      if (prevType === 2) {
        if (handOptions.cHand[i0] < prevHand[3]) continue;
      }
      valid.push(actionIndices.fourCardIndices[i0][i1][i2][i3]);
    }
  }

  // two pairs
  if (prevType !== 2) {
    if (handOptions.nDistinctPairs >= 2) {
      const nPairs = handOptions.nPairs;
      for (let p1 = 0; p1 < nPairs - 1; p1++) {
        const p1Val = handOptions.cards[handOptions.pairs[p1][0]].value;
        for (let p2 = p1 + 1; p2 < nPairs; p2++) {
          const p2Val = handOptions.cards[handOptions.pairs[p2][0]].value;
          if (p1Val === p2Val) continue;
          const i0 = handOptions.cards[handOptions.pairs[p1][0]].indexInHand;
          const i1 = handOptions.cards[handOptions.pairs[p1][1]].indexInHand;
          const i2 = handOptions.cards[handOptions.pairs[p2][0]].indexInHand;
          const i3 = handOptions.cards[handOptions.pairs[p2][1]].indexInHand;
          if (prevType === 1) {
            if (handOptions.cHand[i3] < prevHand[3]) continue;
          }
          valid.push(actionIndices.fourCardIndices[i0][i1][i2][i3]);
        }
      }
    }
  }

  return valid.length ? valid : -1;
}

export function fiveCardOptions(handOptions, prevHand = [], prevType = 0, actionIndices) {
  // prevType:
  // 0 any
  // 1 straight
  // 2 flush
  // 3 full house
  // 4 four of a kind (+ kicker)
  // 5 straight flush
  const valid = [];
  const cardInds = new Array(5).fill(0);

  const prevSorted = (prevHand && prevHand.length) ? [...prevHand].sort((a, b) => a - b) : [];
  const prevSFHigh = (prevType === 5) ? straightHighId5(prevSorted) : -1;

  // ----------------------------
  // 1) STRAIGHTS (only if prevType <= 1)
  // ----------------------------
  if (prevType <= 1) {
    if (handOptions.straights.length > 0) {
      for (const straight of handOptions.straights) {
        const nC = straight.length;

        for (let i1 = 0; i1 < nC - 4; i1++) {
          const val1 = handOptions.cards[straight[i1]].value;
          cardInds[0] = handOptions.cards[straight[i1]].indexInHand;

          for (let i2 = i1 + 1; i2 < nC - 3; i2++) {
            const val2 = handOptions.cards[straight[i2]].value;
            if (val1 === val2) continue;
            if (val2 > val1 + 1) break;
            cardInds[1] = handOptions.cards[straight[i2]].indexInHand;

            for (let i3 = i2 + 1; i3 < nC - 2; i3++) {
              const val3 = handOptions.cards[straight[i3]].value;
              if (val3 === val2) continue;
              if (val3 > val2 + 1) break;
              cardInds[2] = handOptions.cards[straight[i3]].indexInHand;

              for (let i4 = i3 + 1; i4 < nC - 1; i4++) {
                const val4 = handOptions.cards[straight[i4]].value;
                if (val4 === val3) continue;
                if (val4 > val3 + 1) break;
                cardInds[3] = handOptions.cards[straight[i4]].indexInHand;

                for (let i5 = i4 + 1; i5 < nC; i5++) {
                  const val5 = handOptions.cards[straight[i5]].value;
                  if (val5 === val4) continue;
                  if (val5 > val4 + 1) break;
                  cardInds[4] = handOptions.cards[straight[i5]].indexInHand;

                  if (prevType === 1) {
                    // Henry-style straight compare uses the highest id
                    const hb = cardInds.map((ii) => handOptions.cHand[ii]).sort((a,b)=>a-b);
                    if (straightHighId5(hb) <= straightHighId5(prevSorted)) continue;
                  }

                  valid.push(
                    actionIndices.fiveCardIndices[cardInds[0]][cardInds[1]][cardInds[2]][cardInds[3]][cardInds[4]]
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // ----------------------------
  // 2) FLUSHES + STRAIGHT FLUSHES
  // We always enumerate flush-sets because straight flush lives here too.
  // ----------------------------
  if (handOptions.flushes.length > 0) {
    for (const flush of handOptions.flushes) {
      const nC = flush.length;

      for (let i1 = 0; i1 < nC - 4; i1++) {
        cardInds[0] = handOptions.cards[flush[i1]].indexInHand;

        for (let i2 = i1 + 1; i2 < nC - 3; i2++) {
          cardInds[1] = handOptions.cards[flush[i2]].indexInHand;

          for (let i3 = i2 + 1; i3 < nC - 2; i3++) {
            cardInds[2] = handOptions.cards[flush[i3]].indexInHand;

            for (let i4 = i3 + 1; i4 < nC - 1; i4++) {
              cardInds[3] = handOptions.cards[flush[i4]].indexInHand;

              for (let i5 = i4 + 1; i5 < nC; i5++) {
                cardInds[4] = handOptions.cards[flush[i5]].indexInHand;

                // indices must be increasing for the lookup
                const inds = [...cardInds].sort((a, b) => a - b);
                const hb = inds.map((ii) => handOptions.cHand[ii]).sort((a, b) => a - b);

                const isSF = isStraight(hb); // in a flush-set, straight => straight flush
                const isF  = true;

                // If prev was straight flush: ONLY straight flush can respond, and must beat it.
                if (prevType === 5) {
                  if (!isSF) continue;
                  if (straightHighId5(hb) <= prevSFHigh) continue;
                }
                // If prev was four-kind: ONLY straight flush can respond.
                else if (prevType === 4) {
                  if (!isSF) continue;
                }
                // If prev was full house: allow straight flush (and flushes DO NOT beat full house)
                else if (prevType === 3) {
                  if (!isSF) continue;
                }
                // If prev was flush: allow higher flush, or any straight flush
                else if (prevType === 2) {
                  if (!isSF) {
                    // flush vs flush: suit first
                    const mySuit = flushSuitRank5(hb);
                    const prevSuit = flushSuitRank5(prevSorted);

                    if (mySuit < prevSuit) continue;

                    // if same suit, use highest id as tiebreak
                    if (mySuit === prevSuit) {
                      if (straightHighId5(hb) <= straightHighId5(prevSorted)) continue;
                    }
                  }
                }
                // If prev was straight or control/any: flush is ok (and SF is ok)

                valid.push(actionIndices.fiveCardIndices[inds[0]][inds[1]][inds[2]][inds[3]][inds[4]]);
              }
            }
          }
        }
      }
    }
  }

  // ----------------------------
  // 3) FULL HOUSES (only if prevType <= 3)
  // ----------------------------
  if (prevType <= 3) {
    const prevFH = (prevType === 3) ? isFullHouse(prevSorted) : { ok: false, threeVal: null };
    const prevThreeVal = prevFH.ok ? prevFH.threeVal : null;

    const nPairs = handOptions.nPairs;
    const nThree = handOptions.nThreeOfAKinds;

    if (nPairs > 0 && nThree > 0) {
      for (const pair of handOptions.pairs) {
        const pVal = handOptions.cards[pair[0]].value;

        for (const three of handOptions.threeOfAKinds) {
          const tVal = handOptions.cards[three[0]].value;
          if (tVal === pVal) continue;

          // Build the 5 indices (order doesn’t matter for actionIndices lookup, but must be ascending)
          const inds = [
            handOptions.cards[three[0]].indexInHand,
            handOptions.cards[three[1]].indexInHand,
            handOptions.cards[three[2]].indexInHand,
            handOptions.cards[pair[0]].indexInHand,
            handOptions.cards[pair[1]].indexInHand,
          ].sort((a, b) => a - b);

          if (prevType === 3 && prevThreeVal != null) {
            if (tVal <= prevThreeVal) continue; // compare by trip value
          }

          valid.push(actionIndices.fiveCardIndices[inds[0]][inds[1]][inds[2]][inds[3]][inds[4]]);
        }
      }
    }
  }

  return valid.length ? valid : -1;
}


// ----------------------------
// Mask builder (returnAvailableActions)
// ----------------------------

export function returnAvailableActions({
  currentHand,       // henry ids sorted asc
  control = 0,       // 0/1
  prevHand = null,   // henry ids of previous played hand (or null/[])
  actionIndices,
  isFirstMove = false,
} = {}) {
  const available = new Int8Array(ACTION_DIM);

  // No previous hand → control
  if (!prevHand || prevHand.length === 0) control = 1;

  if (control === 0) {
    available[passInd] = 1;

    const nCardsToBeat = prevHand.length;
    let handOptions = null;
    if (nCardsToBeat > 1) handOptions = new HandsAvailable(currentHand);

    let options;
    if (nCardsToBeat === 1) {
      options = oneCardOptions(currentHand, prevHand[0], 1);
    } else if (nCardsToBeat === 2) {
      options = twoCardOptions(handOptions, prevHand, 1, actionIndices);
    } else if (nCardsToBeat === 3) {
      options = threeCardOptions(handOptions, prevHand, 1, actionIndices);
    } else if (nCardsToBeat === 4) {
      /*options = isFourOfAKind(prevHand)
        ? fourCardOptions(handOptions, prevHand, 2, actionIndices)
        : fourCardOptions(handOptions, prevHand, 1, actionIndices);*/

      // 4-card hands disabled in rules, can only pass when required to beat 4 cards
      return available;
    } else {
      const prevSorted = [...prevHand].sort((a, b) => a - b);

      if (isStraight(prevSorted) && isFlush(prevSorted)) {
        // straight flush
        options = fiveCardOptions(handOptions, prevSorted, 5, actionIndices);
      } else if (fourKindInfo5(prevSorted).ok) {
        // four of a kind + kicker
        options = fiveCardOptions(handOptions, prevSorted, 4, actionIndices);
      } else if (isFlush(prevSorted)) {
        options = fiveCardOptions(handOptions, prevSorted, 2, actionIndices);
      } else if (isFullHouse(prevSorted).ok) {
        options = fiveCardOptions(handOptions, prevSorted, 3, actionIndices);
      } else {
        // straight (or fallback)
        options = fiveCardOptions(handOptions, prevSorted, 1, actionIndices);
      }
    }

    if (typeof options === "number") return available;
    for (const opt of options) available[getIndex(opt, nCardsToBeat)] = 1;
    return available;
  }

  // control === 1
  const handOptions = new HandsAvailable(currentHand);
  const o1 = oneCardOptions(currentHand);
  const o2 = twoCardOptions(handOptions, [], 0, actionIndices);
  const o3 = threeCardOptions(handOptions, [], 0, actionIndices);
  //const o4 = fourCardOptions(handOptions, [], 0, actionIndices);
  const o5 = fiveCardOptions(handOptions, [], 0, actionIndices);

  for (const opt of o1) available[getIndex(opt, 1)] = 1;
  if (typeof o2 !== "number") for (const opt of o2) available[getIndex(opt, 2)] = 1;
  if (typeof o3 !== "number") for (const opt of o3) available[getIndex(opt, 3)] = 1;
  //if (typeof o4 !== "number") for (const opt of o4) available[getIndex(opt, 4)] = 1;
  if (typeof o5 !== "number") for (const opt of o5) available[getIndex(opt, 5)] = 1;

  // very first move must include 3♦ 
  if (isFirstMove) {
    const THREE_DIAMONDS = 1; // Henry ID for 3♦

    // cannot pass on first move
    available[passInd] = 0;

    for (let a = 0; a < available.length; a++) {
      if (available[a] !== 1) continue;

      const { option, nCards } = getOptionNC(a);
      if (nCards === 0) {
        available[a] = 0;
        continue;
      }

      let pickIdx;
      if (nCards === 1) pickIdx = [option];
      else if (nCards === 2) pickIdx = actionIndices.inverseTwo[option];
      else if (nCards === 3) pickIdx = actionIndices.inverseThree[option];
      else if (nCards === 4) pickIdx = actionIndices.inverseFour[option];
      else pickIdx = actionIndices.inverseFive[option];

      const contains3D = pickIdx?.some(
        (i) => currentHand[i] === THREE_DIAMONDS
      );

      if (!contains3D) available[a] = 0;
    }
  }

  return available;
}

export function availableToLogitsMask(available, illegalPenalty = -1e9) {
  const mask = new Float32Array(available.length);
  for (let i = 0; i < available.length; i++) mask[i] = available[i] ? 0 : illegalPenalty;
  return mask;
}

export function toHenryHand(cards) {
  // cards = [{suit, rank}, ...] in your game format
  return cards.map(toHenryId).sort((a, b) => a - b);
}
