// henryObs.js
// 1:1 observation encoder + debug GUI modeled after Henry Charlesworth's big2_PPOalgorithm.
//
// IMPORTANT 1: This matches Henry's 412-length layout exactly.
// IMPORTANT 2: The "Cards Played (Q K A 2)" block is persistent memory in Henry's code.
//              We replicate that with a module-level Set. Call resetHenryObsMemory() per new game.

import { toHenryId, henryValue, henrySuit } from "./henryCardId.js";

/** Persistent memory for "Cards Played (Q K A 2)" (ids 37..52 only). */
const _seenQKA2 = new Set();

/** Per-opponent persistent memory (seat index 0..3) */
const _oppCardsOfNote = Array.from({ length: 4 }, () => new Set()); // ids 45..52
const _oppPlayedFlags = Array.from({ length: 4 }, () => ({
  pair: false,
  three: false,
  twoPair: false,
  straight: false,
  flush: false,
  fullHouse: false,
}));

/** Call this at the start of each new game. */
export function resetHenryObsMemory() {
  _seenQKA2.clear();
  for (let i = 0; i < 4; i++) {
    _oppCardsOfNote[i].clear();
    _oppPlayedFlags[i] = {
      pair: false,
      three: false,
      twoPair: false,
      straight: false,
      flush: false,
      fullHouse: false,
    };
  }
}

// ------------------------------------------------------------
// Helpers for current-hand features (NO wrap straights, like Henry)
// ------------------------------------------------------------
function computeGroupFlags(ids) {
  const byValue = {};
  ids.forEach((id) => {
    const v = henryValue(id);
    (byValue[v] ??= []).push(id);
  });

  const inPair = new Set();
  const inThree = new Set();
  const inFour = new Set();

  Object.values(byValue).forEach((group) => {
    if (group.length >= 2) group.forEach((id) => inPair.add(id));
    if (group.length >= 3) group.forEach((id) => inThree.add(id));
    if (group.length >= 4) group.forEach((id) => inFour.add(id));
  });

  return { inPair, inThree, inFour };
}

function computeStraightFlags(ids) {
  const byValue = {};
  ids.forEach((id) => {
    const v = henryValue(id);
    (byValue[v] ??= []).push(id);
  });

  const values = Object.keys(byValue).map(Number).sort((a, b) => a - b);
  const inStraight = new Set();

  for (let i = 0; i < values.length; i++) {
    let j = i;
    while (values[j + 1] === values[j] + 1) j++;

    // mark any 5-long windows inside this consecutive run
    if (j - i + 1 >= 5) {
      for (let s = i; s <= j - 4; s++) {
        for (let k = s; k < s + 5; k++) {
          byValue[values[k]].forEach((id) => inStraight.add(id));
        }
      }
    }

    i = j;
  }

  return inStraight;
}

function computeFlushFlags(ids) {
  const bySuit = {};
  ids.forEach((id) => {
    const s = henrySuit(id);
    (bySuit[s] ??= []).push(id);
  });

  const inFlush = new Set();
  Object.values(bySuit).forEach((group) => {
    if (group.length >= 5) group.forEach((id) => inFlush.add(id));
  });

  return inFlush;
}

// ------------------------------------------------------------
// Helpers for PREV hand classification (Henry rules, no wrap)
// ------------------------------------------------------------
function byValCount(ids) {
  const m = new Map();
  ids.forEach((id) => {
    const v = henryValue(id);
    m.set(v, (m.get(v) || 0) + 1);
  });
  return m;
}

function isStraight5(ids) {
  if (ids.length !== 5) return false;

  const vals = Array.from(new Set(ids.map((id) => henryValue(id))))
    .sort((a, b) => a - b);

  if (vals.length !== 5) return false;

  for (let i = 1; i < 5; i++) {
    if (vals[i] !== vals[0] + i) return false;
  }
  return true;
}

function isFlush5(ids) {
  if (ids.length !== 5) return false;
  const s0 = henrySuit(ids[0]);
  for (let i = 1; i < 5; i++) {
    if (henrySuit(ids[i]) !== s0) return false;
  }
  return true;
}

function isFullHouse5(ids) {
  if (ids.length !== 5) return false;
  const counts = Array.from(byValCount(ids).values()).sort((a, b) => a - b);
  return counts.length === 2 && counts[0] === 2 && counts[1] === 3;
}

// ------------------------------------------------------------
// Main encoder (412)
// ------------------------------------------------------------
export function buildHenryObs({
  players,         // GameModule.players (length 4)
  turnIndex,       // 0..3
  lastPlayedHand,  // array of card objects (your format) - [] if none
  passCount,       // 0,1,2 (Henry uses 3-pass => Control flag, passCount resets)
  control = false, // set true when current player has control (everyone else passed)
  lastPlayedBy = null,
} = {}) {
  const obs = new Int32Array(412);

  // Layout (from big2Game.py / generateGUI.py)
  const HAND = 0;       // 22*13 = 286
  const N1 = 286;       // +27
  const N2 = 313;       // +27
  const N3 = 340;       // +27
  const GLOBAL = 367;   // +16 (Q,K,A,2 grid)
  const PREV = 383;     // +29 (17 hiVal + 12 type/pass)

  // -----------------------------
  // Current player's 13 card-slots (each slot = 22)
  // -----------------------------
  const myIds = (players?.[turnIndex]?.cards || []).map(toHenryId).sort((a, b) => a - b);

  const { inPair, inThree, inFour } = computeGroupFlags(myIds);
  const inStraight = computeStraightFlags(myIds);
  const inFlush = computeFlushFlags(myIds);

  for (let i = 0; i < myIds.length; i++) {
    const id = myIds[i];
    const base = HAND + i * 22;

    // value (13)
    obs[base + (henryValue(id) - 1)] = 1;

    // suit (4) in Henry order: D,C,H,S maps to indices 13..16
    // henrySuit is 1..3 or 0 (spades) in Henry code paths.
    const s = henrySuit(id);
    obs[base + 13 + (s === 0 ? 3 : s - 1)] = 1;

    // flags (5): inPair,inThree,inFour,inStraight,inFlush at 17..21
    if (inPair.has(id)) obs[base + 17] = 1;
    if (inThree.has(id)) obs[base + 18] = 1;
    if (inFour.has(id)) obs[base + 19] = 1;
    if (inStraight.has(id)) obs[base + 20] = 1;
    if (inFlush.has(id)) obs[base + 21] = 1;
  }

  // -----------------------------
  // Next / Next^2 / Next^3 blocks (each 27):
  //  - 13 one-hot nCards
  //  - 8  cards of note: AD..AS,2D..2S (from prevHand intersect 45..52)
  //  - 6  hasPlayed flags: playedPair, playedThree, playedTwoPair, playedStraight, playedFlush, playedFullHouse
  //
  // Henry "bug": the nCards one-hot uses *current player's* hand size (cPlayer),
  // not the next players' sizes. Replicate exactly.
  // -----------------------------
  const seats = [
    (turnIndex + 3) % 4, // next player (to match your earlier convention)
    (turnIndex + 2) % 4,
    (turnIndex + 1) % 4,
  ];
  const blocks = [N1, N2, N3];

  const prevIds = (lastPlayedHand || []).map(toHenryId);

  // --- update per-opponent memory ---
  if (lastPlayedBy !== null && prevIds.length > 0) {
    const seat = lastPlayedBy;

    // cards of note: AD..AS,2D..2S (45..52)
    prevIds.forEach((id) => {
      if (id >= 45 && id <= 52) _oppCardsOfNote[seat].add(id);
    });

    const n = prevIds.length;
    const flags = _oppPlayedFlags[seat];

    if (n === 2) flags.pair = true;
    else if (n === 3) flags.three = true;
    else if (n === 4) flags.twoPair = true;
    else if (n === 5) {
      if (isStraight5(prevIds)) flags.straight = true;
      if (isFlush5(prevIds)) flags.flush = true;
      else if (isFullHouse5(prevIds)) flags.fullHouse = true;
    }
  }

  const nPrev = prevIds.length;

  // ------------------------------------------------------------
  // Next / Next^2 / Next^3 blocks (each 27) — FIXED
  // ------------------------------------------------------------
  for (let bi = 0; bi < 3; bi++) {
    const start = blocks[bi];
    const seat = seats[bi];

    // ---- nCards (REAL opponent hand size) ----
    for (let i = 0; i < 13; i++) obs[start + i] = 0;
    const nCards = players?.[seat]?.cards?.length ?? 0;
    if (nCards >= 1 && nCards <= 13) obs[start + (nCards - 1)] = 1;

    // ---- cards of note (8): AD..AS,2D..2S ----
    for (let i = 0; i < 8; i++) obs[start + 13 + i] = 0;
    for (const id of _oppCardsOfNote[seat]) {
      obs[start + 13 + (id - 45)] = 1;
    }

    // ---- hasPlayed flags (6) ----
    for (let i = 0; i < 6; i++) obs[start + 21 + i] = 0;
    const f = _oppPlayedFlags[seat];
    if (f.pair)      obs[start + 21] = 1;
    if (f.three)     obs[start + 22] = 1;
    if (f.twoPair)   obs[start + 23] = 1;
    if (f.straight)  obs[start + 24] = 1;
    if (f.flush)     obs[start + 25] = 1;
    if (f.fullHouse) obs[start + 26] = 1;
  }


  // -----------------------------
  // GLOBAL: Cards Played (Q K A 2) (16)
  // big2Game.py sets this from prevHand intersect 37..52 and NEVER clears it.
  // We replicate via _seenQKA2.
  // -----------------------------
  for (let id = 37; id <= 52; id++) {
    if (prevIds.includes(id)) _seenQKA2.add(id);
  }
  for (let id = 37; id <= 52; id++) {
    obs[GLOBAL + (id - 37)] = _seenQKA2.has(id) ? 1 : 0;
  }

  // -----------------------------
  // PREV HAND block (29):
  //  - 17 hiVal (13 ranks + 4 suits)
  //  - 12 type/pass:
  //      [0]=Control, [1]=Single, [2]=Pair, [3]=Three, [4]=TwoPair, [5]=FourOfAKind,
  //      [6]=Straight, [7]=Flush, [8]=FullHouse, [9]=No passes, [10]=One pass, [11]=Two pass
  // -----------------------------
  // clear PREV block
  for (let i = 0; i < 29; i++) obs[PREV + i] = 0;

  // Type indices relative to PREV (matching big2Game.py phInd offsets):
  // phInd = PREV
  // control      => phInd+17
  // single       => phInd+18
  // pair         => phInd+19
  // three        => phInd+20
  // twoPair      => phInd+21
  // fourOfAKind  => phInd+22
  // straight     => phInd+23
  // flush        => phInd+24
  // fullHouse    => phInd+25
  // no passes    => phInd+26
  // one pass     => phInd+27
  // two pass     => phInd+28

  const setPrevType = (phOffset) => { obs[PREV + phOffset] = 1; };

  if (control) {
    // control state (no previous hand to beat)
    setPrevType(17); // Control
    // Henry does not set pass flags in control state path here (it resets prev block)
  } else if (nPrev > 0) {
    // Determine "high card" used by Henry:
    // big2Game.py uses prevHand[1]/[2]/[3]/[4] depending on nCards, and for full house uses prevHand[2].
    // It assumes prevHand is sorted.
    const sortedPrev = [...prevIds].sort((a, b) => a - b);

    let highId = sortedPrev[0];
    let suit = highId % 4;

    if (nPrev === 1) {
      highId = sortedPrev[0];
      suit = highId % 4;
      setPrevType(18); // SingleCard
    } else if (nPrev === 2) {
      highId = sortedPrev[1];
      suit = highId % 4;
      setPrevType(19); // Pair
    } else if (nPrev === 3) {
      highId = sortedPrev[2];
      suit = highId % 4;
      setPrevType(20); // Three
    } else if (nPrev === 4) {
      highId = sortedPrev[3];
      suit = highId % 4;

      // big2Game.py sets prev type TwoPair if isTwoPair else FourOfAKind
      // We'll implement a minimal isTwoPair for 4-card: counts {2,2} vs {4}.
      const counts = Array.from(byValCount(sortedPrev).values()).sort((a, b) => a - b);
      const isTwoPair4 = (counts.length === 2 && counts[0] === 2 && counts[1] === 2);
      if (isTwoPair4) setPrevType(21); // TwoPair
      else setPrevType(22);            // FourOfAKind
    } else if (nPrev === 5) {
      // Straight / Flush / FullHouse per big2Game.py ordering
      if (isStraight5(sortedPrev)) {
        highId = sortedPrev[4];
        suit = highId % 4;
        setPrevType(23); // Straight
      }
      if (isFlush5(sortedPrev)) {
        highId = sortedPrev[4];
        suit = highId % 4;
        setPrevType(24); // Flush
      } else if (isFullHouse5(sortedPrev)) {
        // big2Game.py uses prevHand[2] for full house high value and suit=-1
        highId = sortedPrev[2];
        suit = -1;
        setPrevType(25); // FullHouse
      }
    } else {
      // shouldn't happen in Henry rules, but keep safe
      highId = sortedPrev[0];
      suit = highId % 4;
      setPrevType(18);
    }

    // hiVal (13 ranks)
    obs[PREV + (henryValue(highId) - 1)] = 1;

    // suit flags (4) at PREV+13..+16 using big2Game.py mapping:
    // suit == 1 => +13, suit==2 => +14, suit==3 => +15, suit==0 => +16
    if (suit === 1) obs[PREV + 13] = 1;
    else if (suit === 2) obs[PREV + 14] = 1;
    else if (suit === 3) obs[PREV + 15] = 1;
    else if (suit === 0) obs[PREV + 16] = 1;
    // suit=-1 for full house -> no suit flag set (matches Henry)

    // pass flags:
    // big2Game.py sets "no passes" on a successful play, and updatePass sets one/two pass.
    if (passCount === 0) setPrevType(26);       // No passes
    else if (passCount === 1) setPrevType(27);  // One pass
    else setPrevType(28);                        // Two pass
  }

  return obs;
}

// ------------------------------------------------------------
// Debug console + GUI
// ------------------------------------------------------------
export function debugObs(obs, label = "", { gui = true } = {}) {
  const nonZero = Array.from(obs).reduce((a, v) => a + (v !== 0), 0);
  console.group(`OBS DEBUG ${label}`);
  console.log("Length:", obs.length);
  console.log("Non-zero count:", nonZero);
  console.groupEnd();

  if (gui) showObsGUI(obs, label);
}

// ------------------------------------------------------------
// GUI in separate window (re-used & live-updating)
// ------------------------------------------------------------
let _obsWin = null;

function _openObsWindow() {
  if (_obsWin && !_obsWin.closed) return _obsWin;

  _obsWin = window.open("", "ObsDebugWindow", "width=1280,height=820");
  if (!_obsWin) {
    console.warn("[obs] Popup blocked. Allow popups for this site.");
    return null;
  }

  _obsWin.document.open();
  _obsWin.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Neural Network Input</title>
  <style>
    body { margin:0; background:#0f0f0f; color:#ddd; font-family: system-ui, Segoe UI, Arial; }
    .topbar {
      position: sticky; top: 0; z-index: 10;
      display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px; background:#111; border-bottom:1px solid #333;
    }
    .title { font-size:18px; font-weight:700; color:#fff; }
    .meta { font-size:12px; color:#bbb; margin-top:2px; }
    .btns { display:flex; gap:8px; }
    button {
      padding:6px 10px; border-radius:8px; border:1px solid #444;
      background:#222; color:#ddd; cursor:pointer;
    }
    button:hover { background:#2a2a2a; }
    #obsRoot { padding:14px 14px 18px; }

    .gridTop {
      display:grid;
      grid-template-columns: 1.65fr 1fr 1fr 1fr 1fr;
      gap:14px;
      align-items:start;
    }

    .sec { border:1px solid #2a2a2a; border-radius:12px; padding:10px; background:#101010; }
    .secTitle { font-weight:700; margin-bottom:8px; color:#fff; }
    .tbl { display:grid; gap:2px; align-items:center; }

    .hdr { font-size:10px; text-align:center; color:#bbb; }
    .rowHdr { width:90px; font-size:11px; color:#bbb; padding-right:6px; text-align:right; }
    .cell {
      width:16px; height:16px;
      border-radius:3px;
      border:1px solid #2a2a2a;
      background:#161616;
      display:flex; align-items:center; justify-content:center;
      font-size:10px; color:#000; user-select:none;
    }
    .cell18 { width:18px; height:18px; }
    .on { background:#3a8; }

    .note { margin-top:10px; font-size:12px; color:#888; }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="title" id="obsTitle">Neural Network Input</div>
      <div class="meta" id="obsMeta"></div>
    </div>
    <div class="btns">
      <button id="btnCopy">Copy obs</button>
      <button id="btnClose">Close</button>
    </div>
  </div>
  <div id="obsRoot"></div>

  <script>
    window.__lastObs = null;

    window.__setObs = (arr, label, meta) => {
      window.__lastObs = arr;
      document.getElementById('obsTitle').textContent = label ? ('Neural Network Input — ' + label) : 'Neural Network Input';
      document.getElementById('obsMeta').textContent = meta || '';
    };

    document.getElementById('btnClose').onclick = () => window.close();

    document.getElementById('btnCopy').onclick = async () => {
      try {
        if (!window.__lastObs) throw new Error('no obs');
        await navigator.clipboard.writeText(JSON.stringify(window.__lastObs));
        const b = document.getElementById('btnCopy');
        b.textContent = 'Copied!';
        setTimeout(() => b.textContent = 'Copy obs', 800);
      } catch {
        const b = document.getElementById('btnCopy');
        b.textContent = 'Copy failed';
        setTimeout(() => b.textContent = 'Copy obs', 1000);
      }
    };
  </script>
</body>
</html>
  `);
  _obsWin.document.close();
  return _obsWin;
}

function _el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _cell(doc, v, size18 = false) {
  return _el(doc, "div", `cell${size18 ? " cell18" : ""}${v ? " on" : ""}`, v ? "1" : "");
}

export function showObsGUI(obs, label = "") {
  const win = _openObsWindow();
  if (!win) return;

  const doc = win.document;
  const root = doc.getElementById("obsRoot");
  if (!root) return;

  const nonZero = Array.from(obs).reduce((a, v) => a + (v !== 0), 0);
  win.__setObs(Array.from(obs), label, `len=412 • nonZero=${nonZero}`);

  root.innerHTML = "";

  const HAND = 0;
  const N1 = 286, N2 = 313, N3 = 340;
  const GLOBAL = 367;
  const PREV = 383;

  const section = (title) => {
    const sec = _el(doc, "div", "sec");
    sec.appendChild(_el(doc, "div", "secTitle", title));
    return sec;
  };

  // ----- top grid -----
  const top = _el(doc, "div", "gridTop");

  // Current Player's Cards (22x13 layout)
  {
    const sec = section("Current Player's Cards");
    const colHeaders = Array.from({ length: 13 }, (_, i) => `C${i + 1}`);
    const rowHeaders = [
      "3","4","5","6","7","8","9","10","J","Q","K","A","2",
      "D","C","H","S",
      "inPair","inThree","inFour","inStraight","inFlush",
    ];

    const tbl = _el(doc, "div", "tbl");
    tbl.style.gridTemplateColumns = `auto repeat(${colHeaders.length}, 16px)`;

    tbl.appendChild(_el(doc, "div", "", "")); // corner
    colHeaders.forEach((h) => tbl.appendChild(_el(doc, "div", "hdr", h)));

    rowHeaders.forEach((rh, r) => {
      tbl.appendChild(_el(doc, "div", "rowHdr", rh));
      for (let c = 0; c < 13; c++) {
        const base = HAND + c * 22;
        tbl.appendChild(_cell(doc, obs[base + r] | 0));
      }
    });

    sec.appendChild(tbl);
    top.appendChild(sec);
  }

  // Opponent blocks: show EXACTLY like Tk GUI:
  // columns: (left numeric row) | nCards | hasPlayed | (right label)
  function opp(title, start) {
    const sec = section(title);

    // rows 1..14 (because hasPlayed has 14 entries)
    const leftRows = Array.from({ length: 14 }, (_, i) => (i < 13 ? `${i + 1}` : ""));
    const rightLabels = [
      "AD","AC","AH","AS","2D","2C","2H","2S",
      "playedPair","playedThree","playedTwoPair","playedStraight","playedFlush","playedFullHouse",
    ];

    const tbl = _el(doc, "div", "tbl");
    tbl.style.gridTemplateColumns = `auto 40px 60px auto`;

    // header row
    tbl.appendChild(_el(doc, "div", "", ""));
    tbl.appendChild(_el(doc, "div", "hdr", "nCards"));
    tbl.appendChild(_el(doc, "div", "hdr", "hasPlayed"));
    tbl.appendChild(_el(doc, "div", "", ""));

    for (let r = 0; r < 14; r++) {
      tbl.appendChild(_el(doc, "div", "rowHdr", leftRows[r]));

      // nCards column (only 13 rows)
      if (r < 13) tbl.appendChild(_cell(doc, obs[start + r] | 0, true));
      else tbl.appendChild(_el(doc, "div", "", ""));

      // hasPlayed column (14 rows)
      tbl.appendChild(_cell(doc, obs[start + 13 + r] | 0, true));

      // right label
      tbl.appendChild(_el(doc, "div", "", rightLabels[r]));
    }

    sec.appendChild(tbl);
    return sec;
  }

  top.appendChild(opp("Next Player's Cards", N1));
  top.appendChild(opp("Next^2 Player's Cards", N2));
  top.appendChild(opp("Next^3 Player's Cards", N3));

  // Previous Hand: two blocks in Tk GUI (HighVal + Type)
  {
    const sec = section("Previous Hand");

    const leftHdrs = [
      "3","4","5","6","7","8","9","10","J","Q","K","A","2","D","C","H","S",
    ];
    const typeHdrs = [
      "Control","SingleCard","Pair","Three","TwoPair","FourOfAKind",
      "Straight","Flush","FullHouse",
      "No passes","One pass","Two pass",
    ];

    const wrap = _el(doc, "div", "");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "1fr 1fr";
    wrap.style.gap = "12px";

    // HighVal column
    {
      const tbl = _el(doc, "div", "tbl");
      tbl.style.gridTemplateColumns = "auto 18px";
      tbl.appendChild(_el(doc, "div", "", ""));
      tbl.appendChild(_el(doc, "div", "hdr", "HighVal"));

      leftHdrs.forEach((rh, i) => {
        tbl.appendChild(_el(doc, "div", "rowHdr", rh));
        tbl.appendChild(_cell(doc, obs[PREV + i] | 0, true));
      });

      wrap.appendChild(tbl);
    }

    // Type column
    {
      const tbl = _el(doc, "div", "tbl");
      tbl.style.gridTemplateColumns = "auto 18px";
      tbl.appendChild(_el(doc, "div", "", ""));
      tbl.appendChild(_el(doc, "div", "hdr", "Type"));

      typeHdrs.forEach((rh, i) => {
        tbl.appendChild(_el(doc, "div", "rowHdr", rh));
        tbl.appendChild(_cell(doc, obs[PREV + 17 + i] | 0, true));
      });

      wrap.appendChild(tbl);
    }

    sec.appendChild(wrap);
    top.appendChild(sec);
  }

  root.appendChild(top);

  // Cards Played (Q K A 2) grid (16) like Tk shared memory display
  {
    const sec = section("Cards Played (Q K A 2)");
    const ranks = ["Q", "K", "A", "2"];
    const suits = ["D", "C", "H", "S"];

    const tbl = _el(doc, "div", "tbl");
    tbl.style.gridTemplateColumns = "auto repeat(4, 18px)";

    tbl.appendChild(_el(doc, "div", "", ""));
    ranks.forEach((r) => tbl.appendChild(_el(doc, "div", "hdr", r)));

    suits.forEach((s, sr) => {
      tbl.appendChild(_el(doc, "div", "rowHdr", s));
      ranks.forEach((_, rc) => {
        const idx = GLOBAL + (rc * 4 + sr);
        tbl.appendChild(_cell(doc, obs[idx] | 0, true));
      });
    });

    sec.appendChild(tbl);
    sec.appendChild(_el(doc, "div", "note", "Tip: keep this window open — it updates live each turn."));
    root.appendChild(sec);
  }
}
