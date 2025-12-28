import Player from "./player.js";
import { buildHenryObs, debugObs } from "./henryObs.js";

import {
  ACTION_DIM,
  passInd,
  getOptionNC,
  returnAvailableActions,
  availableToLogitsMask,
  toHenryHand,
} from "./henryLegal.js";
import { toHenryId } from "./henryCardId.js";
import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm";

const USE_GREEDY_AI = true;

let _actionIndices = null;
let _actionIndicesPromise = null;

// Optional TFJS policy model (GraphModel). Load once.
let _policyModel = null;

export async function loadPolicyModel(modelUrl) {
  _policyModel = await tf.loadGraphModel(modelUrl);
  return _policyModel;
}

// Builds inverse*Indices the way Henry's actionIndices.pkl provides them.
// We choose the first (canonical) combo encountered for each option.
function _buildInverseFromForward(forward) {
  const { twoCardIndices, threeCardIndices, fourCardIndices, fiveCardIndices } = forward;

  const inverseTwo = Array(33).fill(null);
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      const opt = twoCardIndices[i][j];
      if (inverseTwo[opt] == null) inverseTwo[opt] = [i, j];
    }
  }

  const inverseThree = Array(31).fill(null);
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      for (let k = j + 1; k < 13; k++) {
        const opt = threeCardIndices[i][j][k];
        if (inverseThree[opt] == null) inverseThree[opt] = [i, j, k];
      }
    }
  }

  const inverseFour = Array(330).fill(null);
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      for (let k = j + 1; k < 13; k++) {
        for (let l = k + 1; l < 13; l++) {
          const opt = fourCardIndices[i][j][k][l];
          if (inverseFour[opt] == null) inverseFour[opt] = [i, j, k, l];
        }
      }
    }
  }

  const inverseFive = Array(1287).fill(null);
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) {
      for (let k = j + 1; k < 13; k++) {
        for (let l = k + 1; l < 13; l++) {
          for (let m = l + 1; m < 13; m++) {
            const opt = fiveCardIndices[i][j][k][l][m];
            if (inverseFive[opt] == null) inverseFive[opt] = [i, j, k, l, m];
          }
        }
      }
    }
  }

  return { ...forward, inverseTwo, inverseThree, inverseFour, inverseFive };
}

export async function loadActionIndices() {
  // NOTE: this path must match where you host the JSON in your game build.
  // In your local dev, you're currently fetching from ./src/js/actionIndices.json.
  // If you move it, update this one place.
  const res = await fetch("./src/js/policy/actionIndices.json");
  const json = await res.json();
  return _buildInverseFromForward(json);
}

export async function ensureActionIndicesLoaded() {
  if (_actionIndices) return _actionIndices;
  if (!_actionIndicesPromise) {
    _actionIndicesPromise = loadActionIndices().then((ai) => (_actionIndices = ai));
  }
  return _actionIndicesPromise;
}

function _sampleFromMaskedLogits(maskedLogits) {
  // maskedLogits: Float32Array length ACTION_DIM
  // We do a stable softmax sample. If all logits are -inf-ish, fall back to first legal.
  let max = -Infinity;
  for (let i = 0; i < maskedLogits.length; i++) if (maskedLogits[i] > max) max = maskedLogits[i];
  if (!isFinite(max)) {
    // no legal actions?
    return passInd;
  }
  // softmax
  let sum = 0;
  const exps = new Float64Array(maskedLogits.length);
  for (let i = 0; i < maskedLogits.length; i++) {
    const v = maskedLogits[i];
    if (!isFinite(v)) {
      exps[i] = 0;
      continue;
    }
    const e = Math.exp(v - max);
    exps[i] = e;
    sum += e;
  }
  if (sum <= 0) return passInd;
  let r = Math.random() * sum;
  for (let i = 0; i < exps.length; i++) {
    r -= exps[i];
    if (r <= 0) return i;
  }
  return exps.length - 1;
}

// return best weighted option
function _argmaxMasked(maskedLogits) {
  let bestIdx = passInd;
  let bestVal = -Infinity;

  for (let i = 0; i < maskedLogits.length; i++) {
    const v = maskedLogits[i];
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }

  return bestIdx;
}


function _pickRandomLegal(available) {
  const legal = [];
  for (let i = 0; i < available.length; i++) if (available[i] === 1) legal.push(i);
  if (legal.length === 0) return passInd;
  return legal[(Math.random() * legal.length) | 0];
}

function _decodeActionToCards(actionIndex, sortedHenryHand, originalCards, ai) {
  const { option, nCards } = getOptionNC(actionIndex);
  if (nCards === 0) return { pass: true, cards: [] };

  // Map option -> indices in the CURRENT HAND (sorted)
  let pickIdx;
  if (nCards === 1) pickIdx = [option];
  else if (nCards === 2) pickIdx = ai.inverseTwo[option];
  else if (nCards === 3) pickIdx = ai.inverseThree[option];
  else if (nCards === 4) pickIdx = ai.inverseFour[option];
  else pickIdx = ai.inverseFive[option];

  if (!pickIdx || pickIdx.some((x) => x == null)) {
    // Should not happen if actionIndices are correct.
    return { pass: true, cards: [] };
  }

  const chosenHenryIds = pickIdx.map((i) => sortedHenryHand[i]);

  // Convert henry ids back to actual card objects in this.cards.
  // We match by henryId (stable) rather than suit/rank strings.
  const byHenry = new Map();
  for (const c of originalCards) {
    const hid = toHenryId(c);
    if (!byHenry.has(hid)) byHenry.set(hid, []);
    byHenry.get(hid).push(c);
  }
  const chosenCards = [];
  for (const hid of chosenHenryIds) {
    const arr = byHenry.get(hid);
    if (!arr || arr.length === 0) continue;
    chosenCards.push(arr.pop());
  }
  return { pass: false, cards: chosenCards };
}

// ---------------------------
// Global sound setup
// ---------------------------
const playCardSounds = [
    new Howl({ src: ["src/audio/playcard_01.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_02.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_03.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_04.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_05.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_06.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_07.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_08.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_09.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_10.wav"], volume: 0.9 })
];

const passSound = new Howl({ src: ["src/audio/pass.wav"], volume: 0.9 });

let lastSoundIndex = -1;

function playRandomCardSound() {
  let idx;
  do {
    idx = (Math.random() * playCardSounds.length) | 0;
  } while (playCardSounds.length > 1 && idx === lastSoundIndex);
  lastSoundIndex = idx;
  playCardSounds[idx].play();
}

function _logSoftmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;

  let sumExp = 0;
  for (const v of logits) {
    if (v > -1e8) sumExp += Math.exp(v - max);
  }

  const logSumExp = Math.log(sumExp) + max;
  return logits.map(v => v - logSumExp);
}

function logAllAvailableActions({
  masked,
  available,
  currHenryHand,
  ai,
  topK = null, // set to e.g. 10 if you only want top-K
}) {
  const logProbs = _logSoftmax(masked);

  const rows = [];

  for (let a = 0; a < masked.length; a++) {
    if (available[a] !== 1) continue;

    const prob = Math.exp(logProbs[a]);
    const { option, nCards } = getOptionNC(a);

    let pickIdx = [];
    if (nCards === 1) pickIdx = [option];
    else if (nCards === 2) pickIdx = ai.inverseTwo[option];
    else if (nCards === 3) pickIdx = ai.inverseThree[option];
    else if (nCards === 4) pickIdx = ai.inverseFour[option];
    else if (nCards === 5) pickIdx = ai.inverseFive[option];

    const henryIds = pickIdx.map(i => currHenryHand[i]);

    rows.push({
      action: a,
      nCards,
      prob,
      logit: masked[a],
      cards: henryIds,
    });
  }

  rows.sort((a, b) => b.prob - a.prob);

  const display = (topK != null) ? rows.slice(0, topK) : rows;

  console.table(
    display.map(r => ({
      action: r.action,
      nCards: r.nCards,
      prob: r.prob.toFixed(11),
      logit: r.logit.toFixed(6),
      cards: r.cards.join(", "),
    }))
  );
}


export default class Opponent extends Player {
    constructor(cards = []) {
      super(cards);
      this.isOpponent = true;
    }
    
    // Run only for the very first layout after dealing
    initialSort() {
      this.cards.forEach((c, i) => {
        c.meta = c.meta || {};
        if (typeof c.meta.shadowKey !== 'number') c.meta.shadowKey = i;
      });

      // always invert for opponents on first layout
      const invert = true;

      this.cards.sort((a, b) => {
        const ak = a.meta.shadowKey, bk = b.meta.shadowKey;
        return invert ? (bk - ak) : (ak - bk);
      });
    }

    derivePassCount(players, actorIndex) {
      return players.filter(
        (p, i) => i !== actorIndex && !p.finishedGame && p.passed
      ).length;
    }
    

    // Use positions[] to overwrite placeholders in self.cards,
    // flip them to front, animate to pile, then remove those indices.
    async spPlayCard(gameDeck, lastPlayedHand, players, turn, isFirstMove, lastPlayedBy) {
      const self = this;
      const passCount = self.derivePassCount(players, turn);
      const control = self.wonRound;

      const obs = buildHenryObs({
        players,
        turnIndex: turn,
        lastPlayedHand,
        lastPlayedBy,
        passCount,
        control
      });

      // Load actionIndices once (includes inverse* lookups).
      const ai = await ensureActionIndicesLoaded();

      //log full obs in console
      
      //debugObs(obs, 'SP OPPONENT TURN', { gui: true });

      // ------------------------------------------------------------
      // 1) Build Henry-legal available actions
      // ------------------------------------------------------------
      const currHenryHand = (self.cards || []).map(toHenryId).sort((a, b) => a - b);
      const prevHenryHand = toHenryHand(lastPlayedHand || []);
      const available = returnAvailableActions({
        currentHand: currHenryHand,
        control: control ? 1 : 0,
        prevHand: prevHenryHand,
        actionIndices: ai,
        isFirstMove: isFirstMove,
      });

      // ------------------------------------------------------------
      // 2) Choose action
      //    - If policy model is loaded, use it
      //    - Otherwise fall back to random legal (still uses Henry legality)
      // ------------------------------------------------------------
      let chosenAction = passInd;
      if (_policyModel) {
        // GraphModel signature varies by export; we support the common case:
        // input: [1,412] (int/float) -> output logits/probs: [1,1695]
        const obsT = tf.tensor(obs, [1, obs.length], 'int32').toFloat();
        let out = _policyModel.predict(obsT);
        // Some exports return a dict or array; normalize.
        if (Array.isArray(out)) out = out[0];
        const logitsT = out;

        const logits = await logitsT.data();
        obsT.dispose();
        logitsT.dispose();

        const mask = availableToLogitsMask(available);
        const masked = new Float32Array(ACTION_DIM);
        for (let i = 0; i < ACTION_DIM; i++) masked[i] = logits[i] + mask[i];

        logAllAvailableActions({
          masked,
          available,
          currHenryHand,
          ai,
          // topK: 10, // uncomment if you only want top 10
        });

        chosenAction = USE_GREEDY_AI
          ? _argmaxMasked(masked)
          : _sampleFromMaskedLogits(masked);
      } else {
        chosenAction = _pickRandomLegal(available);
      }

      // ------------------------------------------------------------
      // 3) Decode action -> concrete cards in-hand
      // ------------------------------------------------------------
      const decoded = _decodeActionToCards(chosenAction, currHenryHand, self.cards, ai);
      if (decoded.pass) {
        // tiny stagger
        await new Promise(r => setTimeout(r, 600));
        passSound.play(); 
        self.passed = true;
        return 'passed'; // resolve 'passed' to let big2.js know
      }
      self.passed = false;

      const cardsToPlay = decoded.cards;
      if (!cardsToPlay || cardsToPlay.length === 0) {
        // If decoding failed, be safe and pass.
        await new Promise(r => setTimeout(r, 600));
        passSound.play(); 
        self.passed = true;
        return 'passed'; // resolve 'passed' to let big2.js know
      }

      // tiny stagger
      await new Promise(r => setTimeout(r, 600));

      const anims = [];
      const toRemoveIdx = [];

      console.log(
        "AI action:",
        chosenAction,
        "legal:",
        available[chosenAction] === 1
      );

      // play the selected cards (same animation)
      for (let i = 0; i < cardsToPlay.length; i++) {
        const card = cardsToPlay[i];
        const idx = self.cards.indexOf(card);
        if (idx < 0 || !card) continue;
        
        card.setSide('back');

        let rotationOffset = Math.random() * 5 + -5; // Calculate a new rotation offset for each card
        console.log("ROTATIONAL OFFSET: " + rotationOffset)
        
        // get middle card index to center pairs, triples, and combos correctly
        const { gx, gy } = self.getGameCenterXY();
        const mid = (cardsToPlay.length - 1) / 2;
        let stackInterval = 0.25;

        // simple, global target for everyone
        const offX = ((i - mid) * 15) - (gameDeck.length * stackInterval);
        const offY = (gameDeck.length * stackInterval);

        const { cx, cy } = self.getCardCenterInGC(card.$el);

        // delta needed to land the card’s center on the anchor:
        const dx = (gx - cx);
        const dy = (gy - cy);

        const p = new Promise(res => {
          card.animateTo({
            delay: i * 50,
            duration: 150,
            ease: 'linear',
            rot: rotationOffset,
            x: Math.round(card.x + dx + offX),
            y: Math.round(card.y + dy - offY),
            onStart: () => {
              gameDeck.push(card);
              card.$el.style.zIndex = gameDeck.length;
              playRandomCardSound();
            },
            onComplete: () => {
              card.setSide('front');
              toRemoveIdx.push(idx);
              res();
            }
          });
        });
        anims.push(p);
      }

      await Promise.all(anims);

      // 3) remove those exact cards from this player's hand (desc order to avoid reindex issues)
      toRemoveIdx.sort((a, b) => b - a).forEach(idx => {
        if (self.cards[idx]) self.cards.splice(idx, 1);
      });

      self.sortHand();
      await self.sortingAnimation(turn, { duration: 200, stagger: 10 });

      return cardsToPlay.length;
    }

}