// Shared status bar / toast helpers — used by big2.js, player.js,
// opponent.js, and spOpponent.js.
export function setStatus(text) {
    const el = document.getElementById('gameInfo');
    if (el) el.textContent = text;
}

// lookup table for printing suit icon in last played hand
const suitLookup = {
    0: '♦', // Diamonds
    1: '♣', // Clubs
    2: '♥', // Hearts
    3: '♠', // Spades
};

// lookup table for printing actual rank in last played hand
const rankLookup = {
    1: 'A',
    2: '2',
    3: '3',
    4: '4',
    5: '5',
    6: '6',
    7: '7',
    8: '8',
    9: '9',
    10: '10',
    11: 'J',
    12: 'Q',
    13: 'K',
};

let toastTimer = null;
export function showToast(text, ms = 1700) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => { el.hidden = true; }, 300);
    }, ms);
}

// Returns flair emoji for notably strong combos, appended to formatHand's
// wording in toasts. Kept separate from formatHand (rather than reusing its
// internals) so this stays low-risk against formatHand's already-correct
// straight/flush edge-case handling (A2345, JQKA2, etc).
export function getComboEmoji(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return '';

    const byRank = new Map();
    const bySuit = new Map();
    for (const c of cards) {
        byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
        bySuit.set(c.suit, (bySuit.get(c.suit) || 0) + 1);
    }
    const counts = [...byRank.values()].sort((a, b) => b - a);
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const isFive = cards.length === 5;
    const isFlush = isFive && bySuit.size === 1;
    const isStraight = (() => {
        if (!isFive || ranks.length !== 5) return false;
        const consec = ranks.every((v, i, a) => i === 0 || v - a[i - 1] === 1);
        if (consec) return true;
        const a2345 = ranks[0]===1 && ranks[1]===2 && ranks[2]===3 && ranks[3]===4 && ranks[4]===5;
        const jqka2 = ranks[0]===1 && ranks[1]===2 && ranks[2]===11 && ranks[3]===12 && ranks[4]===13;
        return a2345 || jqka2;
    })();

    if (isStraight && isFlush)                        return ' 🔥🔥🔥🔥'; // straight flush
    if (counts[0] === 4)                               return ' 🔥🔥🔥💣'; // quad bomb
    if (isFive && counts[0] === 3 && counts[1] === 2)  return ' 🔥🔥';    // full house
    if (isFlush)                                       return ' 🔥🔥';    // flush
    if (isStraight)                                    return ' 🔥';      // straight
    if (cards.length === 3)                            return ' 🔥';      // triple
    return '';
}

// Convert an array of card objects into a human-readable string
export function formatHand(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return '—';

    // --- lookups (client-side) ---
    const rankToWord = {
        1:'Ace', 2:'Two', 3:'Three', 4:'Four', 5:'Five',
        6:'Six', 7:'Seven', 8:'Eight', 9:'Nine', 10:'Ten',
        11:'Jack', 12:'Queen', 13:'King'
    };
    const suitName = ['Diamonds','Clubs','Hearts','Spades']; // 0..3
    const plural = (w) => w === 'Six' ? 'Sixes'
                        : w === 'Ace' ? 'Aces'
                        : w === 'Two' ? 'Twos'
                        : w + 's';

    // --- helpers ---
    const byRank = new Map(); // rank -> suits[]
    const bySuit = new Map(); // suit -> count
    for (const c of cards) {
        if (!byRank.has(c.rank)) byRank.set(c.rank, []);
        byRank.get(c.rank).push(c.suit);
        bySuit.set(c.suit, (bySuit.get(c.suit) || 0) + 1);
    }
    const ranks = [...byRank.keys()].map(Number).sort((a,b)=>a-b);
    const countsDesc = [...byRank.values()].map(v=>v.length).sort((a,b)=>b-a);
    const topSuitName = (suits) => suitName[Math.max(...suits)];

    // Big 2 straights: handle A2345 and JQKA2 as valid 5-card sequences
    const isFive = cards.length === 5;
    const isFlush = isFive && (bySuit.size === 1);
    // helper: Big 2 rank order (2 highest, then A)
    const big2Order = (r) => (r === 2 ? 15 : r === 1 ? 14 : r);

    const isStraight = (() => {
        if (!isFive) return false;
        const uniq = [...new Set(ranks)];
        if (uniq.length !== 5) return false;

        // regular consecutive
        const consec = uniq.every((v,i,a)=> i===0 || v - a[i-1] === 1);
        if (consec) return true;

        // A2345 sorted -> [1,2,3,4,5]
        // JQKA2 sorted -> [1,2,11,12,13]
        const a2345 = uniq[0]===1 && uniq[1]===2 && uniq[2]===3 && uniq[3]===4 && uniq[4]===5;
        const jqka2 = uniq[0]===1 && uniq[1]===2 && uniq[2]===11 && uniq[3]===12 && uniq[4]===13;
        return a2345 || jqka2;
    })();

    // --- singles / pairs / trips (unchanged behavior) ---
    if (cards.length === 1) {
        const c = cards[0];
        return `${rankLookup[c.rank]} of ${suitName[c.suit]}`; // e.g., "3 hearts"
    }
    if (cards.length === 2 && byRank.size === 1) {
        const r = ranks[0];
        // show the higher suit for flavor, like "double 3 hearts"
        return `Double ${rankLookup[r]} ${topSuitName(byRank.get(r))}`;
    }
    if (cards.length === 3 && byRank.size === 1) {
        const r = ranks[0];
        return `Triple ${plural(rankToWord[r])}`;
    }

    // --- five-card combos ---
    if (isFive) {
        // Straight flush
        if (isStraight && isFlush) {
            const onlySuit = cards[0].suit;
            const uniq = [...new Set(ranks)];
            const a2345 = uniq[0]===1 && uniq[1]===2 && uniq[2]===3 && uniq[3]===4 && uniq[4]===5;
            const jqka2 = uniq[0]===1 && uniq[1]===2 && uniq[2]===11 && uniq[3]===12 && uniq[4]===13;

            let hi;
            if (a2345)      hi = cards.find(c => c.rank === 5);
            else if (jqka2) hi = cards.find(c => c.rank === 2);
            else            hi = cards.reduce((best, c) =>
                                big2Order(c.rank) > big2Order(best.rank) ? c : best
                            , cards[0]);

            return `Straight Flush ${rankLookup[hi.rank]} of ${suitName[onlySuit]}`;
        }

        // Four of a kind (+ kicker). In Big 2 this is a 5-card bomb.
        if (countsDesc[0] === 4) {
            const quadRank = [...byRank.entries()].find(([,s]) => s.length === 4)[0];
            return `Quad ${plural(rankToWord[quadRank])}`;
        }

        // Full house (works for both 333-55 and 33-555)
        if (countsDesc[0] === 3 && countsDesc[1] === 2) {
            const tripleRank = [...byRank.entries()].find(([,s]) => s.length === 3)[0];
            return `Full House ${plural(rankToWord[tripleRank])}`;
        }

        // Flush
        if (isFlush) {
            const onlySuit = cards[0].suit;
            // pick the highest-ranked card by Big 2 order
            const hi = cards.reduce((best, c) =>
            big2Order(c.rank) > big2Order(best.rank) ? c : best , cards[0]);

            // e.g. "flush 9 hearts" or "flush A spades" or "flush 2 clubs"
            return `${rankLookup[hi.rank]} Of ${suitName[onlySuit]} Flush`;
        }

        // Straight
        if (isStraight) {
            const uniq = [...new Set(ranks)];
            const a2345 = uniq[0]===1 && uniq[1]===2 && uniq[2]===3 && uniq[3]===4 && uniq[4]===5;
            const jqka2 = uniq[0]===1 && uniq[1]===2 && uniq[2]===11 && uniq[3]===12 && uniq[4]===13;

            let hi;
            if (a2345)      hi = cards.find(c => c.rank === 5);
            else if (jqka2) hi = cards.find(c => c.rank === 2);
            else            hi = cards.reduce((best, c) =>
                                big2Order(c.rank) > big2Order(best.rank) ? c : best
                            , cards[0]);

            return `${rankLookup[hi.rank]} of ${suitName[hi.suit]} Straight`;
        }
    }

    // fallback, show raw symbols like "3♦ 3♥"
    return cards.map(c => `${rankLookup[c.rank]}${suitLookup[c.suit]}`).join(' ');
}
