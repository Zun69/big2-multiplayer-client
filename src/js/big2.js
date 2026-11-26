import Player from "./player.js"
import Opponent from "./opponent.js"
import spOpponent, { loadPolicyModel } from "./spOpponent.js";
import PocketBase, { BaseAuthStore } from "https://cdn.jsdelivr.net/npm/pocketbase@0.27.0/dist/pocketbase.es.mjs";
import { resetHenryObsMemory } from "./henryObs.js";
import { setStatus, showToast, formatHand, getComboEmoji } from "./ui.js";

// helpers: rank/suit to Unicode playing card glyphs ---
const SUIT_BASES = {
  // your mapping: 0 ♦, 1 ♣, 2 ♥, 3 ♠  (server enforces first move contains 3♦)
  0: 0x1F0C0, // Diamonds
  1: 0x1F0D0, // Clubs
  2: 0x1F0B0, // Hearts
  3: 0x1F0A0, // Spades
};

// Global flag: are we resuming a paused game?
window.isResume = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let currentProfileUsername = null;

let isJoiningRoom = false;

const PB_URL = 'https://big2.kbcardgames.xyz/pb/'//http://127.0.0.1:8090
// store key "pb_auth" in sessionStorage (per tab), not localStorage (shared across tabs)

class SessionAuthStore extends BaseAuthStore {
    constructor(key = "pb_auth") {
        super();
        this.key = key;

        // hydrate from sessionStorage
        const raw = sessionStorage.getItem(this.key);
        if (raw) {
        try {
            const { token, model } = JSON.parse(raw);
            super.save(token, model);
        } catch { sessionStorage.removeItem(this.key); }
        }
    }

    save(token, model) {
        super.save(token, model);
        try { sessionStorage.setItem(this.key, JSON.stringify({ token, model })); } catch {}
    }

    clear() {
        super.clear();
        try { sessionStorage.removeItem(this.key); } catch {}
    }
}

// Initialize the PocketBase client with your custom store
const pb = new PocketBase(PB_URL, new SessionAuthStore("pb_auth"));

function pbAvatarUrl(pbId, file, thumb='64x64') {
    if (!pbId || !file) return '';
    return pb.files.getURL({ collectionId: '_pb_users_auth_', id: pbId }, file, { thumb });
}

let _spModelPromise = null;

function ensureSpPolicyLoaded() {
  if (!_spModelPromise) {
    _spModelPromise = loadPolicyModel("src/js/policy/model.json");
  }
  return _spModelPromise;
}

//GameModule object encapsulate players, deck, gameDeck, finishedDeck (it represents the local gameState)
const GameModule = (function() {
    //let initialPlayer1 = new Player();
    let player1 = new Player();
    let player2 = new Opponent(); //ai player that will mirror other player's real time moves
    let player3 = new Opponent();
    let player4 = new Opponent();
    let _currentLoopToken = null;
    let deckInstance = null;
    let passTracker = 0;
    let lastPlayedBy = null;
    let sortMode = "asc";

    // GameModule properties
    let players = [player1, player2, player3, player4];
    let gameDeck = [];
    let playersFinished = []; //stores finishing order
    let lastHand = []; //stores last hand played
    let playedHistory = [] //stores played card history
    let isFirstMove = true;

    let lastValidHand; //stores a number that lets program know if last turn was a pass or turn
    let turn;
    let finishedDeck = [];
    let playedHand = 0; //stores returned hand length from playCard function
    let losingPlayer;

    let turnClientId = null; // whose turn it is (server-authoritative)

    // reset everything except points, wins, seconds, etc (next game)
    function reset() {
        players.forEach(player => {
            // Reset player properties
            player.cards = [];
            player.wonRound = false;
            player.finishedGame = false;
            player.passed = false;
            player.readyState = false;
        });
        (GameModule.gameDeck || []).length = 0;
        (GameModule.playersFinished || []).length = 0;
        (GameModule.lastHand || []).length = 0;
        (GameModule.playedHistory || []).length = 0;
        (GameModule.finishedDeck || []).length = 0;
        
        // clear exported properties instead of just local vars
        GameModule.finishedDeck.length = 0;
        GameModule.turn = undefined;
        GameModule.lastValidHand = undefined; 
        GameModule.losingPlayer = undefined;
        GameModule.playedHand = 0;
        GameModule.turnClientId = null;   
        GameModule.isFirstMove = true;
        GameModule.passTracker = 0;
        GameModule.lastPlayedBy = null;

        // automatically unmount deck when resetting
        unmountDeck();
    }

    // -------------------------------------------------
    // deck lifecycle helpers
    // -------------------------------------------------
    function setDeck(d) {
        deckInstance = d;
    }

    function getDeck() {
        return deckInstance;
    }

    function unmountDeck() {
        if (deckInstance) {
            try {
                deckInstance.unmount();
            } catch (e) {
                console.warn("GameModule: deck unmount failed", e);
            }
            deckInstance = null;
        }
    }

    //return GameModule properties
    return {
        players,
        gameDeck,
        playersFinished,
        lastHand,
        playedHistory,
        finishedDeck,
        turn, // Expose turn
        lastValidHand, // Expose lastValidHand
        playedHand, // Expose playedHand
        losingPlayer, // Expose losingPlayer   
        turnClientId,
        passTracker,
        lastPlayedBy,
        isFirstMove,
        _currentLoopToken,
        // getters/setters
        get sortMode() { return sortMode; },
        set sortMode(v) { sortMode = v || "asc"; },
        get deck() { return getDeck(); },
        set deck(d) { setDeck(d); },
        unmountDeck,
        reset,
    };
})();

function gmCancelToken(ctx='') {
  if (GameModule._currentLoopToken && !GameModule._currentLoopToken.canceled) {
    GameModule._currentLoopToken.canceled = true;
    //console.log('[loopToken] canceled', ctx);
  } else {
    //console.log('[loopToken] no active loop to cancel', ctx ? `(${ctx})` : '');
  }
}

function gmNewToken(ctx='') {
  GameModule._currentLoopToken = { canceled: false };
  //console.log('[loopToken] new token', ctx);
  return GameModule._currentLoopToken;
}

function gmHasCancel() {
  return !!(GameModule._currentLoopToken && GameModule._currentLoopToken.canceled);
}

let shadowSeeded = false;

// seeds fake sort order for opponent placeholders once at game start
function seedShadowKeysOnce() {
    if (shadowSeeded) return;
    shadowSeeded = true;

    GameModule.players.forEach((player, seatIndex) => {
        if (seatIndex !== 0) {
        const N = player.cards.length;
        player.cards.forEach((card, i) => {
            card.meta = card.meta || {};
            card.meta.shadowKey = i;
        });
        }
    });
}

// Sorts everybody's cards and plays the animation, resolves when animations finish
async function spSortHands(){ 
    // 1) sort ai by asc, player by asc(defaul), or value carried over from last game
    GameModule.players.forEach((p, i) => {
        if (i === 0) {
            switch (GameModule.sortMode) {
                case "desc":  p.sortHandDesc();  break;
                case "suit":  p.sortHandSuit();  break;
                case "combo": p.sortHandCombo(); break;
                default:      p.sortHand();      break;
            }
        } else {
            p.sortHand(); // opponents can stay default
        }
    });

    // 2) animate all seats in parallel
    await Promise.all(
        GameModule.players.map((p, i) => p.sortingAnimation(i))
    );

    return new Promise(resolve => {
        // resolve when sorting animation is complete
        resolve('sortComplete');
    });
}

// Sorts everybody's cards and plays the animation, resolves when animations finish
async function sortHands(socket, roomCode){ 
    // 1) sort everyone locally (keeps DOM/z-order consistent)
    GameModule.players.forEach((p, i) => {
        if (i === 0) {
            switch (GameModule.sortMode) {
                case "desc":  p.sortHandDesc();  break;
                case "suit":  p.sortHandSuit();  break;
                case "combo": p.sortHandCombo(); break;
                default:      p.sortHand();      break;
            }
        } else if (typeof p.initialSort === "function") {
            p.initialSort(i); // sort opponent's initial hands
        } else {
            p.sortHand(); // fallback
        }
    });

    // 2) animate all seats in parallel
    await Promise.all(
        GameModule.players.map((p, i) => p.sortingAnimation(i))
    );

    return new Promise(resolve => {
        socket.once('allSortingComplete', () => {
            //console.log('All players have completed sorting their hands.');
            resolve('sortComplete');
        });
        socket.emit('sortHandsComplete', roomCode);
    });
}

async function sortPlayerHandAfterTurn(socket, roomCode, actorIdx) {
    //console.log("ACTORIDX" + actorIdx)
    //console.log(GameModule.sortMode);
    const p = GameModule.players[actorIdx];
    
    switch (GameModule.sortMode) {
                case "desc":  p.sortHandDesc();  break;
                case "suit":  p.sortHandSuit();  break;
                case "combo": p.sortHandCombo(); break;
                default:      p.sortHand();      break;
            }

    // Animate the current player's cards into position
    await GameModule.players[actorIdx].sortingAnimation(actorIdx);

    // Wait for server confirmation before resolving
    return new Promise(resolve => {
        socket.once('sortAfterTurnComplete', () => {
            //console.log('After turn sorting complete for all clients');
            resolve('sortAfterTurnComplete');
        });

        // Emit only after listener is set up
        socket.emit('sortPlayerHandAfterTurn', roomCode);
    });
}

const clickSounds = [
    new Howl({ src: ["src/audio/click_01.ogg"], volume: 0.6 }),
    new Howl({ src: ["src/audio/click_02.ogg"], volume: 0.6 }),
    new Howl({ src: ["src/audio/click_03.ogg"], volume: 0.6 }),
    new Howl({ src: ["src/audio/click_04.ogg"], volume: 0.6 }),
];

const sfxReadyOn  = new Howl({ src: ['src/audio/ready_on.ogg'],  volume: 0.3 });
const sfxReadyOff = new Howl({ src: ['src/audio/ready_off.ogg'], volume: 0.3 });
let prevMyReady = null;

// Shuffle sounds
const shuffleSounds = [
  new Howl({ src: ["src/audio/shuffle_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle_02.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle_04.wav"], volume: 0.9 })
];

// Shuffle sounds
const shuffleSounds2 = [
  new Howl({ src: ["src/audio/shuffle2_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle2_02.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle2_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle2_04.wav"], volume: 0.9 })
];

const shuffleSounds3 = [
  new Howl({ src: ["src/audio/shuffle3_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle3_02.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle3_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle3_04.wav"], volume: 0.9 })
];

const shuffleSounds4 = [
  new Howl({ src: ["src/audio/shuffle4_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle4_02.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle4_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/shuffle4_04.wav"], volume: 0.9 })
];

const shuffleSets = [shuffleSounds, shuffleSounds2, shuffleSounds3, shuffleSounds4];

// Wait for deck.shuffle() animations to truly finish using the deck's own queue
function shuffleSpDeckAsync(deck, times, delayBetweenShuffles) {
  return new Promise((resolve) => {
    // select shuffleSound set to use
    const activeShuffleSet = shuffleSets[Math.floor(Math.random() * shuffleSets.length)];

    for (let i = 0; i < times; i++) {
      // Each call to shuffle() is queued and only starts after the previous finishes
      deck.shuffle(); // this completes (calls next) when all card animations are done

      // play the ith shuffle sound
      deck.queue((next) => {
        activeShuffleSet[i % activeShuffleSet.length].play();
        next();
      });

      // Optional gap between shuffle runs (except after the last one)
      if (delayBetweenShuffles > 0 && i < times - 1) {
        deck.queue((next) => {
          setTimeout(next, delayBetweenShuffles);
        });
      }
    }

    // After the last queued action, resolve
    deck.queue((next) => {
      resolve('shuffleComplete');
      next();
    });
  });
}

// Wait for deck.shuffle() animations to truly finish using the deck's own queue
function shuffleDeckAsync(deck, times, delayBetweenShuffles, serverDeck) {
  return new Promise((resolve) => {
    // select shuffleSound set to use
    const activeShuffleSet = shuffleSets[Math.floor(Math.random() * shuffleSets.length)];

    for (let i = 0; i < times; i++) {
      // Each call to shuffle() is queued and only starts after the previous finishes
      deck.shuffle(); // this completes (calls next) when all card animations are done

      // play the ith shuffle sound
      deck.queue((next) => {
        activeShuffleSet[i % activeShuffleSet.length].play();
        next();
      });

      // Optional gap between shuffle runs (except after the last one)
      if (delayBetweenShuffles > 0 && i < times - 1) {
        deck.queue((next) => {
          setTimeout(next, delayBetweenShuffles);
        });
      }
    }

    // Re-skin the 52 cards to match the server array EXACTLY (incl. duplicates)
    // Use the queued version so it happens in sequence after the shuffles.
    if (typeof deck.hydrateExactFromArray === 'function') {
        deck.hydrateExactFromArray(serverDeck);   
    } else if (typeof deck.setExactFromArray === 'function') {
        // Fallback: wrap the immediate setter in a queue step
        deck.queue((next) => { deck.setExactFromArray(serverDeck); next(); });
    } 

    // After the last queued action, resolve
    deck.queue((next) => {
      resolve('shuffleComplete');
      next();
    });
  });
}

// deal card sounds
// Base volume lowered (was 0.9) — full-volume clips firing every 60ms were
// summing/clipping against each other, which read as "harsh".
const DEAL_SOUND_BASE_VOLUME = 0.9;

const dealCardSounds = [
  new Howl({ src: ["src/audio/dealcard_01.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_02.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_03.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_04.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_05.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_06.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_07.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_08.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_09.wav"], volume: DEAL_SOUND_BASE_VOLUME }),
  new Howl({ src: ["src/audio/dealcard_10.wav"], volume: DEAL_SOUND_BASE_VOLUME })
];

const finishCardSounds = [
    new Howl({ src: ["src/audio/finishcard_01.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_02.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_03.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_04.wav"], volume: 0.9 })
]

let finishSoundIndex = 0;

let lastDealSoundIndex = -1;

function dealNextCardSounds() {
    if (!dealCardSounds.length) return;

    let idx;
    do {
        idx = Math.floor(Math.random() * dealCardSounds.length);
    } while (idx === lastDealSoundIndex);

    lastDealSoundIndex = idx;

    const sound = dealCardSounds[idx];

    // Slight per-hit volume variation so every card doesn't land at
    // identical loudness (real dealing has natural velocity variance).
    const vol = DEAL_SOUND_BASE_VOLUME * (0.85 + Math.random() * 0.3); // ~0.47–0.71

    // Slight pitch/rate variation so the same 10 samples cycling in rapid
    // succession don't sound as repetitive/mechanical.
    const rate = 0.94 + Math.random() * 0.14; // ~0.94–1.06

    const id = sound.play();
    sound.volume(vol, id);
    sound.rate(rate, id);

    // Cut the tail short before the next card's sound fires ~60ms later,
    // so decay tails stop overlapping/stacking into a harsh, muddy blur.
    sound.fade(vol, 0, 70, id);

    ////console.log("Random sound index:", idx);
}

function dealNextFinishCardSounds() {
    finishCardSounds[finishSoundIndex].play();  // play current sound
    //console.log("Sound index" + finishSoundIndex);
    finishSoundIndex = (finishSoundIndex + 1) % finishCardSounds.length; // move to next (wrap around)
}

function gcToLocal(xGC, yGC, parentEl) {
    const gc = document.getElementById('gameContainer');
    const gcRect = gc.getBoundingClientRect();
    const pRect  = parentEl.getBoundingClientRect();
    // translate GC-relative pixels → parent-relative pixels
    return {
        x: Math.round(xGC - (pRect.left - gcRect.left)),
        y: Math.round(yGC - (pRect.top  - gcRect.top)),
    };
}

function gcToLocalCentered(xGC, yGC, parentEl, cardEl) {
    const { x, y } = gcToLocal(xGC, yGC, parentEl);
    const w = cardEl?.offsetWidth  || 0;
    const h = cardEl?.offsetHeight || 0;
    return { x: x - w / 2, y: y - h / 2 };
}

// ---- Dealing layout (percent-of-container, no seat divs) ----
const DEAL_ANCHORS = [
    // seat 0 (bottom; fan along X →)
    { leftPct: 0.50, topPct: 0.84, axis: 'x', dir: +1, rot: 0 },
    // seat 1 (left; fan down ↓)
    { leftPct: 0.06, topPct: 0.50, axis: 'y', dir: +1, rot: 90 },
    // seat 2 (top; fan along X ←)
    { leftPct: 0.50, topPct: 0.1, axis: 'x', dir: -1, rot: 0 },
    // seat 3 (right; fan up ↑)
    { leftPct: 0.940, topPct: 0.50, axis: 'y', dir: -1, rot: 90 },
];

// Build pose functions (off → x,y) directly in gameContainer space
function buildGCPosesFromPercents(anchors, stridePx, baseBias = [0,10,20,30]) {
    const gc = document.getElementById('gameContainer');
    const r  = gc.getBoundingClientRect();

    return anchors.map((cfg, seat) => {
        const anchorX = r.width  * cfg.leftPct;
        const anchorY = r.height * cfg.topPct;
        return (off) => {
        const x = (cfg.axis === 'x') ? (anchorX + cfg.dir * off) : anchorX;
        const y = (cfg.axis === 'y') ? (anchorY + cfg.dir * off) : anchorY;
        return { rot: cfg.rot, x: Math.round(x), y: Math.round(y) };
        };
    });
}

// Animate and assign cards to GameModule.players
async function dealCards(serverDeck, socket, roomCode, firstDealClientId) {
  return new Promise(function (resolve) {
    // Build deck (server-supplied), mount to DOM, and shuffle/arrange
    let deck = Deck(false, serverDeck);
    GameModule.deck = deck; // store globally
    const shufflePromise = shuffleDeckAsync(deck, 4, 35, serverDeck);
    deck.mount(document.getElementById('gameDeck'));

    // First recipient is the host seat (clientId matches firstDealClientId)
    let playerIndex = GameModule.players.findIndex(
        p => Number(p.clientId) === Number(firstDealClientId)
    );

    //console.log("local player dealt to first: " + playerIndex);

    // Deterministic spacing (identical on all clients)
    const playersCount = GameModule.players.length || 4;
    const STRIDE = 10 * playersCount;      // 40px per card per seat (matches old look)
    const SEAT_BASE = [0, 10, 20, 30];     // fixed bias per local seat (no host-dependent bias)

    // Pose builders per seat
    const poseBySeat = buildGCPosesFromPercents(DEAL_ANCHORS);

    shufflePromise.then(function (value) {
      if (value !== "shuffleComplete") return;

      const animationPromises = [];
      const perSeatCount = [0, 0, 0, 0]; // how many dealt to each seat
      
      deck.cards.reverse().forEach((card, dealIndex) => {
        card.setSide('back'); // make sure everything starts back-side before any animation
        const seat  = playerIndex;               // lock seat for this card
        const k     = perSeatCount[seat];        // 0..12 within THIS seat
        const delay = 150 + dealIndex * 60;       // delay after a card is animated
        const totalCards = 13; // fixed for Big 2, or compute dynamically
        const mid = (totalCards - 1) / 2;
        const off = SEAT_BASE[seat] + (k - mid) * STRIDE;

        const { rot, x: xGC, y: yGC } = poseBySeat[seat](off);

        // compute coords for the card’s *current* parent (deck is mounted in #gameDeck)
        const deckParent = card.$el.parentElement || document.getElementById('gameDeck');
        const { x: xLocal, y: yLocal } = gcToLocalCentered(xGC, yGC, deckParent, card.$el);

        const localSeat = 0; // you

        const p = new Promise((cardResolve) => {
          setTimeout(() => {
            card.animateTo({
              delay: 0,
              duration: 50,
              ease: 'linear',
              rot,
              x: xLocal,
              y: yLocal,
              onStart: function () {
                dealNextCardSounds();
              },
              onComplete: function () {
                // mount first, then set side to avoid any flicker
                //card.mount(mountDiv);

                if (seat === localSeat) {
                    card.setSide('front');    // only your cards flip on arrival
                } else {
                    card.setSide('back');     // others stay hidden
                }
                cardResolve();
              }
            });
          }, delay);
        });

        animationPromises.push(p);
        GameModule.players[seat].addCard(card);

        // Seat 'seat' just received a card; bump that seat’s personal count.
        // We use this number (0,1,2,...) to space/fan THAT seat’s cards.
        perSeatCount[seat] += 1;
        
        // Advance the dealer to the next seat in round-robin order.
        // The % wraps us back to 0 after the last seat (e.g., 3→0 when playersCount=4).
        playerIndex = (playerIndex + 1) % playersCount; 
      });

      Promise.all(animationPromises).then(() => {
        //deck.unmount();
        socket.emit('dealComplete', roomCode, GameModule.players[0]);
        deck = null;
        resolve(socket);
      });
    });
  });
}

// Animate and assign cards to GameModule.players
async function dealSinglePlayerCards() {
  return new Promise(function (resolve) {
    // Build deck (server-supplied), mount to DOM, and shuffle/arrange
    let deck = Deck(false);
    GameModule.deck = deck; // store globally
    const shufflePromise = shuffleSpDeckAsync(deck, 4, 35);
    deck.mount(document.getElementById('gameDeck'));

    // Choose index of player to start dealing to
    let playerIndex = 0

    ////console.log("local player dealt to first: " + playerIndex);

    // Deterministic spacing (identical on all clients)
    const playersCount = GameModule.players.length || 4;
    const STRIDE = 10 * playersCount;      // 40px per card per seat (matches old look)
    const SEAT_BASE = [0, 10, 20, 30];     // fixed bias per local seat (no host-dependent bias)

    // Pose builders per seat
    const poseBySeat = buildGCPosesFromPercents(DEAL_ANCHORS);

    shufflePromise.then(function (value) {
      if (value !== "shuffleComplete") return;

      const animationPromises = [];
      const perSeatCount = [0, 0, 0, 0]; // how many dealt to each seat
      
      deck.cards.reverse().forEach((card, dealIndex) => {
        card.setSide('back'); // make sure everything starts back-side before any animation
        const seat  = playerIndex;               // lock seat for this card
        const k     = perSeatCount[seat];        // 0..12 within THIS seat
        const delay = 150 + dealIndex * 60;       // delay after a card is animated
        const totalCards = 13; // fixed for Big 2, or compute dynamically
        const mid = (totalCards - 1) / 2;
        const off = SEAT_BASE[seat] + (k - mid) * STRIDE;

        const { rot, x: xGC, y: yGC } = poseBySeat[seat](off);

        // compute coords for the card’s *current* parent (deck is mounted in #gameDeck)
        const deckParent = card.$el.parentElement || document.getElementById('gameDeck');
        const { x: xLocal, y: yLocal } = gcToLocalCentered(xGC, yGC, deckParent, card.$el);

        const localSeat = 0; // you

        const p = new Promise((cardResolve) => {
          setTimeout(() => {
            card.animateTo({
              delay: 0,
              duration: 50,
              ease: 'linear',
              rot,
              x: xLocal,
              y: yLocal,
              onStart: function () {
                dealNextCardSounds();
              },
              onComplete: function () {
                // mount first, then set side to avoid any flicker
                //card.mount(mountDiv);

                if (seat === localSeat) {
                    card.setSide('front');    // only your cards flip on arrival
                } else {
                    card.setSide('back');     // others stay hidden
                }
                cardResolve();
              }
            });
          }, delay);
        });

        animationPromises.push(p);
        GameModule.players[seat].addCard(card);

        // Seat 'seat' just received a card; bump that seat’s personal count.
        // We use this number (0,1,2,...) to space/fan THAT seat’s cards.
        perSeatCount[seat] += 1;
        
        // Advance the dealer to the next seat in round-robin order.
        // The % wraps us back to 0 after the last seat (e.g., 3→0 when playersCount=4).
        playerIndex = (playerIndex + 1) % playersCount; 
      });

      Promise.all(animationPromises).then(() => {
        //deck.unmount();
        // find who has 3♦ (suit 0, rank 3)
        const threeDiamondSeat = GameModule.players.findIndex(p =>
          (p.cards || []).some(c => c.suit === 0 && c.rank === 3)
        );

        const threeDiamondClientId = threeDiamondSeat !== -1 ? GameModule.players[threeDiamondSeat].clientId : null;

        deck = null;

        // resolve 3 of dimaonds player's clientId
        resolve(threeDiamondClientId);
      });
    });
  });
}

// remove and add a border to playerInfo element based on turn
function displayTurn(turn) {
    const playerInfo = document.getElementsByClassName("playerInfo");

    for (let i = 0; i < playerInfo.length; i++) {
        // Reset all player boxes to their default color
        playerInfo[i].style.border = "none";
        playerInfo[i].style.boxShadow = "none";
        playerInfo[i].style.transition = "border-color 0.25s ease, box-shadow 0.25s ease";
    }

    // Highlight the current player's box with a contrasting fill
    const active = playerInfo[turn];
    
    // modern blue accent
    active.style.border = "2px solid #3b82f6"; // Tailwind blue-500
    active.style.boxShadow =
        "0 0 0 2px rgba(59,130,246,0.35), " +
        "0 6px 16px rgba(59,130,246,0.25)";
}

async function localPlayerHand(socket, roomCode) {
    const outcome = await GameModule.players[GameModule.turn].playCard(
        GameModule.gameDeck,
        GameModule.lastValidHand,
        GameModule.playersFinished,
        roomCode,
        socket,
        GameModule.isFirstMove
    );

    const sortSelect = document.getElementById("sortSelect");
    GameModule.sortMode = sortSelect.value; //store selected sort value in GameModule

    if (outcome.payload.type === 'play') {
        GameModule.playedHand = outcome.payload.cards.length;

        const actorIdx = 0;                              // who actually played (for sorting)
        const nextTurnClientId = outcome.payload.nextTurn;             // STASH – don’t flip yet

        // sync server-authoritative state now
        GameModule.lastValidHand = outcome.payload.lastValidHand;

        // mirror passed flags
        if (Array.isArray(outcome.payload.players)) {
        outcome.payload.players.forEach(sp => {
            const lp = GameModule.players.find(p => p.clientId === sp.id);
            if (lp) lp.passed = !!sp.passed;
        });
        }

        // ACK barrier: attach first, then emit
        await new Promise((resolve) => {
        const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
        });

        // post-turn local sort/anim just for the actor
        await sortPlayerHandAfterTurn(socket, roomCode, actorIdx);

        // now that animations are done room-wide, flip the visible turn
        const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
        if (localIdx >= 0) {
        GameModule.turn = localIdx;
        displayTurn(GameModule.turn);
        }
        return;
    }

    if (outcome.payload.type === 'pass') {
        GameModule.playedHand = 0;

        // mark the passer
        const passedPlayer = GameModule.players.find(p => p.clientId === outcome.payload.passedBy);
        if (passedPlayer) passedPlayer.passed = true;

        const nextTurnClientId = outcome.payload.nextTurn;            // STASH
        GameModule.lastValidHand = outcome.payload.lastValidHand;

        await new Promise((resolve) => {
        const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
        });

        // Flip after barrier
        const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
        if (localIdx >= 0) {
        GameModule.turn = localIdx;
        displayTurn(GameModule.turn);
        }
        return;
    }

    // passWonRound: clear pile, leader gets free turn
    if (outcome.payload.type === 'passWonRound') {
        GameModule.playedHand = 0;

        // sync flags + last hand from server
        GameModule.lastValidHand = outcome.payload.lastValidHand;
        outcome.payload.players.forEach(sp => {
        const lp = GameModule.players.find(p => p.clientId === sp.id);
        if (!lp) return;
        lp.passed       = !!sp.passed;
        lp.wonRound     = !!sp.wonRound;
        lp.finishedGame = !!sp.finishedGame;
        });

        // who leads next (server tells you)
        const nextTurnClientId = outcome.payload.nextTurn;            // STASH

        await new Promise((resolve) => {
        const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
        });

        // everyone clears the pile together
        await finishDeckAnimation(socket, roomCode);

        // Flip after clear-pile animation
        const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
        if (localIdx >= 0) {
        GameModule.turn = localIdx;
        displayTurn(GameModule.turn);
        }
        return;
    }
}

const passSound = new Howl({ src: ["src/audio/pass.wav"], volume: 0.9 });

function receivePlayerHand(socket, roomCode) {
  return new Promise((resolve) => {
    const cleanup = () => {
      socket.off('cardsPlayed', onCardsPlayed);
      socket.off('passedTurn', onPassedTurn);
      socket.off('wonRound', onWonRound);
      socket.off('allHandAckComplete', onAllHandDone);
    };

    const onAllHandDone = () => { cleanup(); resolve(); };

    const onCardsPlayed = async (payload) => {
        const {
            clientId,          // who played (by clientId)
            cards,             // the actual cards for the table
            positions = [],    // (optional) fallback for older servers
            nextTurn,          // server-authoritative next actor (clientId)
            lastValidHand,     // updated target hand
            players,           // public flags: passed/wonRound/finished per seat
            isFirstMove,
        } = payload;

        GameModule.isFirstMove = isFirstMove; // set to false after a hand has been played
        GameModule.playedHand = cards.length;

        const toNum = (v) => Number(v);
        const actorIdx = GameModule.players.findIndex(p => toNum(p.clientId) === toNum(clientId));
        const nextTurnClientId = nextTurn;

        // animate mirror for the player who acted (use actorIdx for pile seat math)
        const actor = GameModule.players[actorIdx];
        const actorName = actorIdx === 0 ? 'You' : (actor?.username ?? 'Someone');
        const willFinish = actor && cards.length === actor.cards.length;
        if (!willFinish) {
            showToast(`${actorName} played ${formatHand(cards)}${getComboEmoji(cards)}`);
        }
        if (actor) {
            //console.log("POSITIONS")
            //console.log(positions);

            await actor.playServerHand(GameModule.gameDeck, cards, positions);
        }

        // sync authoritative state
        GameModule.lastValidHand = lastValidHand;
        if (Array.isArray(players)) {
            players.forEach(sp => {
            const lp = GameModule.players.find(p => p.clientId === sp.id);
            if (lp) lp.passed = !!sp.passed;
            });
        }

        // barrier → sort → THEN flip turn
        const handler = async () => {
            socket.off('allHandAckComplete', handler);
            await sortPlayerHandAfterTurn(socket, roomCode, actorIdx);
            //console.log('[POST-PLAY SORT]', { actorCid: clientId, actorIdx, turnAtReceive: GameModule.turn });

            const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
            if (localIdx >= 0) {
            GameModule.turn = localIdx;
            displayTurn(GameModule.turn);
            }

            onAllHandDone();
        };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
    };

    const onPassedTurn = (payload) => {
        GameModule.playedHand = 0;

        const passedPlayer = GameModule.players.find(p => p.clientId === payload.passedBy);
        if (passedPlayer) passedPlayer.passed = true;

        const passedIdx = GameModule.players.findIndex(p => p.clientId === payload.passedBy);
        const passedName = passedIdx === 0 ? 'You' : (passedPlayer?.username ?? 'Someone');
        showToast(`${passedName} passed`);

        const nextTurnClientId = payload.nextTurn;  // STASH           
        GameModule.lastValidHand = payload.lastValidHand;

        passSound.play();

        const handler = () => {
            socket.off('allHandAckComplete', handler);

            const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
            if (localIdx >= 0) {
            GameModule.turn = localIdx;
            displayTurn(GameModule.turn);
            }

            onAllHandDone();
        };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
    };

    const onWonRound = (payload) => {
        GameModule.playedHand = 0;
        GameModule.lastValidHand = payload.lastValidHand;

        // mirror flags
        payload.players.forEach(sp => {
            const lp = GameModule.players.find(p => p.clientId === sp.id);
            if (!lp) return;
            lp.passed       = !!sp.passed;
            lp.wonRound     = !!sp.wonRound;
            lp.finishedGame = !!sp.finishedGame;
        });

        // leader for free turn (server authoritative)
        const nextTurnClientId = payload.players.find(p => p.wonRound)?.id;  // STASH

        const winnerIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
            const winnerName = winnerIdx === 0 ? 'You' : (GameModule.players[winnerIdx]?.username ?? 'Someone');
            showToast(`${winnerName} won the round!`);

        passSound.play();

        // ack → clear pile → THEN flip
        const handler = async () => {
            socket.off('allHandAckComplete', handler);
            await finishDeckAnimation(socket, roomCode);

            const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
            if (localIdx >= 0) {
            GameModule.turn = localIdx;
            displayTurn(GameModule.turn);
            }

            onAllHandDone();
        };
        socket.on('allHandAckComplete', handler);
        socket.emit('playHandAck', roomCode);
    };

    socket.on('cardsPlayed', onCardsPlayed);
    socket.on('passedTurn', onPassedTurn);
    socket.on('wonRound', onWonRound);
  });
}

// Helpers 
function _getGCMeta() {
    const gc = document.getElementById('gameContainer');
    if (!gc) throw new Error('#gameContainer not found');
    const rect = gc.getBoundingClientRect();
    return { el: gc, rect };
}

function _cardCenterInGC(cardEl, meta) {
    const cr = cardEl.getBoundingClientRect();
    return {
        cx: (cr.left - meta.rect.left) + cr.width  / 2,
        cy: (cr.top  - meta.rect.top ) + cr.height / 2,
    };
}

// after round ends, adds all played cards into finished deck and animates them as well
async function spFinishDeckAnimation() {
    // ---- anchor config: % within gameContainer ----
    const PCT_LEFT  = 0.75;     
    const PCT_TOP   = 0.35;     
    const STACK_DRIFT = 0.25;   // same subtle stagger as your original
    
    // compute once per run
    const meta = _getGCMeta();
    const anchorX = meta.rect.width  * PCT_LEFT;
    const anchorY = meta.rect.height * PCT_TOP;

    // keep animating until gameDeck is empty
    while (GameModule.gameDeck.length > 0) {
        // loop through all game deck cards (consume one at a time)
        let card = GameModule.gameDeck.shift();
        card.setSide('back');

        // measure this card’s current visual center (relative to GC)
        const { cx, cy } = _cardCenterInGC(card.$el, meta);

        // delta to land the card’s center exactly on the anchor
        const dx = anchorX - cx;
        const dy = anchorY - cy;

        // keep your original stagger look using finishedDeck length
        const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
        const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);
                
        // wait until each card is finished animating
        await new Promise((cardResolve) => {
            setTimeout(function () {
                card.animateTo({
                delay: 0,
                duration: 50,
                ease: 'linear',
                rot: 0,
                x: Math.round(card.x + dx + offX),
                y: Math.round(card.y + dy - offY),
                onStart: () => {
                    GameModule.finishedDeck.push(card); // push gameDeck card into finishedDeck
                    // keep z stacking consistent as the pile grows
                    card.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
                },
                onComplete: function () {
                    dealNextCardSounds();
                    cardResolve(); // resolve, so next card can animate
                }
            });
            }, 10);
        });
    }
}

// after round ends, adds all played cards into finished deck and animates them as well
async function finishDeckAnimation(socket, roomCode) {
    // ---- anchor config: % within gameContainer ----
    const PCT_LEFT  = 0.75;     
    const PCT_TOP   = 0.35;     
    const STACK_DRIFT = 0.25;   // same subtle stagger as your original
    
    // compute once per run
    const meta = _getGCMeta();
    const anchorX = meta.rect.width  * PCT_LEFT;
    const anchorY = meta.rect.height * PCT_TOP;

    // keep animating until gameDeck is empty
    while (GameModule.gameDeck.length > 0) {
        // loop through all game deck cards (consume one at a time)
        let card = GameModule.gameDeck.shift();
        card.setSide('back');

        // measure this card’s current visual center (relative to GC)
        const { cx, cy } = _cardCenterInGC(card.$el, meta);

        // delta to land the card’s center exactly on the anchor
        const dx = anchorX - cx;
        const dy = anchorY - cy;

        // keep your original stagger look using finishedDeck length
        const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
        const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);
                
        // wait until each card is finished animating
        await new Promise((cardResolve) => {
            setTimeout(function () {
                card.animateTo({
                delay: 0,
                duration: 50,
                ease: 'linear',
                rot: 0,
                x: Math.round(card.x + dx + offX),
                y: Math.round(card.y + dy - offY),
                onStart: () => {
                    GameModule.finishedDeck.push(card); // push gameDeck card into finishedDeck
                    // keep z stacking consistent as the pile grows
                    card.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
                },
                onComplete: function () {
                    dealNextCardSounds();
                    cardResolve(); // resolve, so next card can animate
                }
            });
            }, 10);
        });
    }

    // tell server we're done animating this clear
    socket.emit('finishDeckAnimation', roomCode);

    // wait for all clients to finish
    await new Promise((resolve) => {
        socket.once('finishDeckAnimationComplete', resolve);
    });
}

// How long to show the losing player's remaining cards, face-up, before
// they get swept into the finished deck. Shared by both the single-player
// and multiplayer finish animations below.
const LOSER_REVEAL_MS = 2500;

async function finishSpGameAnimation(gameDeck, losingPlayer) {
  return new Promise(async function (resolve) {

    const PCT_LEFT  = 0.75;
    const PCT_TOP   = 0.35;
    const STACK_DRIFT = 0.25;

    const meta = _getGCMeta();
    const anchorX = meta.rect.width  * PCT_LEFT;
    const anchorY = meta.rect.height * PCT_TOP;

    // 1) Reveal the losing player's hand face-up and hold, BEFORE any sweeping
    const player = losingPlayer
      ? GameModule.players.find(p => p.clientId === losingPlayer.clientId)
      : null;

    if (player && player.cards && player.cards.length > 0) {
        player.cards.forEach(card => card.setSide('front'));
        await sleep(LOSER_REVEAL_MS);
    }

    // 2) Sweep the pile AND the loser's cards together, as one combined batch
    const toSweep = [...gameDeck, ...((player && player.cards) || [])];

    for (let i = 0; i < toSweep.length; i++) {
      const card = toSweep[i];
      card.setSide('back');

      const { cx, cy } = _cardCenterInGC(card.$el, meta);
      const dx = anchorX - cx;
      const dy = anchorY - cy;

      const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
      const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);

      await new Promise((cardResolve) => {
        setTimeout(() => {
          card.animateTo({
            delay: 0, duration: 50, ease: 'linear', rot: 0,
            x: Math.round(card.x + dx + offX),
            y: Math.round(card.y + dy - offY),
            onStart: () => {
              GameModule.finishedDeck.push(card);
              card.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
            },
            onComplete: () => { dealNextFinishCardSounds(); cardResolve(); }
          });
        }, 20);
      });
    }

    await sleep(200);
    resolve();
  });
}

async function finishGameAnimation(roomCode, socket, gameDeck, losingPlayer, losingPlayerCards){
    return new Promise(async function (resolve, reject) {
        // anchor config: % within gameContainer
        const PCT_LEFT  = 0.75;     
        const PCT_TOP   = 0.35;     
        const STACK_DRIFT = 0.25;   // same subtle stagger as your original
        
        // compute once per run
        const meta = _getGCMeta();
        const anchorX = meta.rect.width  * PCT_LEFT;
        const anchorY = meta.rect.height * PCT_TOP;

        // Find player who came last
        const lastPlacePlayer = GameModule.players.find(p => p.username === losingPlayer);

        // --------------------------------------------------
        // 1) Reveal the losing player's hand face-up and hold, BEFORE any
        //    sweeping starts (so nothing is mid-flight while it's shown)
        // --------------------------------------------------
        if (lastPlacePlayer && lastPlacePlayer.cards && lastPlacePlayer.cards.length > 0) {
            // overwrite placeholders with the real cards the server sent (same
            // trick opponent.js uses in playServerHand), so the reveal below
            // shows the loser's actual hand instead of the "4 of spades" mask
            if (Array.isArray(losingPlayerCards)) {
                lastPlacePlayer.cards.forEach((card, i) => {
                    const real = losingPlayerCards[i];
                    if (!real) return;
                    card.rank = real.rank;
                    card.suit = real.suit;
                    card.setRankSuit(card.rank, card.suit);
                });
            }

            lastPlacePlayer.cards.forEach(card => card.setSide('front'));
            await sleep(LOSER_REVEAL_MS);
        }

        // --------------------------------------------------
        // 2) Sweep the last round's pile AND the loser's cards into the
        //    finished deck together, as one combined batch
        // --------------------------------------------------
        const toSweep = [...gameDeck, ...((lastPlacePlayer && lastPlacePlayer.cards) || [])];

        for (let i = 0; i < toSweep.length; i++) {
            let card = toSweep[i];
            card.setSide('back');

            // measure this card's current visual center (relative to GC)
            const { cx, cy } = _cardCenterInGC(card.$el, meta);

            // delta to land the card's center exactly on the anchor
            const dx = anchorX - cx;
            const dy = anchorY - cy;

            // keep your original stagger look using finishedDeck length
            const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
            const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);
            
            //wait until each card is finished animating
            await new Promise((cardResolve) => {
                setTimeout(function () {
                    card.animateTo({
                        delay: 0,
                        duration: 50,
                        ease: 'linear',
                        rot: 0,
                        x: Math.round(card.x + dx + offX),
                        y: Math.round(card.y + dy - offY),
                        onStart: () => {
                            GameModule.finishedDeck.push(card); // push gameDeck card into finishedDeck
                            // keep z stacking consistent as the pile grows
                            card.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
                        },
                        onComplete: function () {
                            dealNextFinishCardSounds();
                            cardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 20);
            });
        }

        await sleep(200); // delay 200ms after last card is placed into finishedDeck

        socket.emit('finishGameAnimation', roomCode);
        
        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve();
    });
}

// Listen for finishGameAnimationComplete event when all 4 clients finishedDeck animation has finished
async function finishedGame(socket) {
    return new Promise((resolve) => {
        const listener = () => {
            // Remove the listener after updating the status
            socket.off('finishGameAnimationComplete', listener);
                        
            resolve();
        };

        socket.on('finishGameAnimationComplete', listener);
    });
}

// Toast wording + emoji for a finishing position. 1st is the actual winner;
// 2nd/3rd just finished; the 4th (never empties their hand, since the game
// ends once 3 players are done) is the loser.
function placeCallout(name, place) {
    if (place === 1) return `🏆 ${name} won the game!`;
    if (place === 2) return `🥈 ${name} finished 2nd!`;
    if (place === 3) return `🥉 ${name} finished 3rd!`;
    return `💀 ${name} lost!`;
}



function getSpLastHand(gameDeck, lastValidHand) {
  const deck = Array.isArray(gameDeck) ? gameDeck : [];
  const n = Math.max(0, Math.min(deck.length, Number(lastValidHand) || 0));
  return deck.slice(deck.length - n);
}

// Ask server for the current last hand; resolves only when server replies.
function getLastHand(socket, roomCode) {
  return new Promise((resolve) => {
    const handler = (serverLastHand) => {
      socket.off('gotLastHand', handler);
      const last = Array.isArray(serverLastHand) ? serverLastHand : [];
      resolve(last);
    };
    socket.once('gotLastHand', handler);   // 1) listen first
    socket.emit('getLastHand', roomCode);  // 2) then emit
  });
}

function subscribePlayerFinished(socket) {
  const handler = ({ clientId, playersFinished }) => {
    // mark local flag
    const player = GameModule.players.find(p => p.clientId === clientId);
    if (player) player.finishedGame = true;

    // mirror server’s authoritative array
    GameModule.playersFinished = [...playersFinished];

    const place = GameModule.playersFinished.length;
    const finisherIdx = GameModule.players.findIndex(p => p.clientId === clientId);
    const finisherName = finisherIdx === 0 ? 'You' : (player?.username ?? 'Someone');
    showToast(placeCallout(finisherName, place));

    //console.log("playerFinished:", clientId, "order:", GameModule.playersFinished);
  };

  socket.on("playerFinished", handler);

  // return cleanup so you can call it at game end
  return () => socket.off("playerFinished", handler);
}

// Listen ONCE for "gameHasFinished", run animations, then resolve results
function waitForGameHasFinished(socket) {
   return new Promise((resolve) => {
    const handler = (playersFinished, losingPlayer, losingPlayerCards) => {
        GameModule.playersFinished = [...playersFinished];
        GameModule.losingPlayer = losingPlayer;
        socket.off('gameHasFinished', handler);
        
        // Just resolve data; do NOT animate here.
        resolve({ playersFinished, losingPlayer, losingPlayerCards });
    };
    socket.on('gameHasFinished', handler);
  });
}

async function applySpTurnOutcome({ actorIndex, outcome, gameOver }) {
  const actor = GameModule.players[actorIndex];

  if (outcome === 'passed') {
    ////console.log('PASSED');
    actor.passed = true;
    GameModule.playedHand = 0;
    // do NOT change gameDeck / lastValidHand on pass
    GameModule.passTracker += 1;
  } 
  else {
    // clear all pass flags because a new "pass streak" starts after a play
    for (const p of GameModule.players) {
        p.passed = false;
    }
    actor.wonRound = false;
    GameModule.playedHand = outcome;   // number of cards just played
    GameModule.isFirstMove = false;
    GameModule.passTracker = 0; // if someone plays a card, reset passTracker
    GameModule.lastPlayedBy = actorIndex;

    // If actor emptied hand, mark finished
    if (actor.cards.length === 0) {
        actor.finishedGame = true;
        GameModule.playersFinished.push(actor.clientId);

        const place = GameModule.playersFinished.length; // 1, 2, or 3
        const finisherName = actorIndex === 0 ? 'You' : (actor?.username ?? 'Someone');
        console.log(finisherName);
        showToast(placeCallout(finisherName, place));

        // prevent stale pass state from messing with next lead
        GameModule.players.forEach(p => { p.passed = false; });
        GameModule.passTracker = 0; // if someone plays a card, reset passTracker
        
        // if third player has finished, send signal that game is over
        if(GameModule.playersFinished.length == 3){
            gameOver = true;
        }
    }
    }

    // advance turn to next non-finished player
    GameModule.turn = nextActiveSeat(actorIndex);
    return gameOver;
}

function trickEnded() {
  if (GameModule.lastPlayedBy == null) {
    ////console.log('[TRICK] no leader yet');
    return false;
  }

  const leaderIndex = GameModule.lastPlayedBy;
  const leader = GameModule.players[leaderIndex];

  const activePlayers = GameModule.players.filter(p => !p.finishedGame);
  const activeCount = activePlayers.length;

  const passesNeeded = activeCount - (leader.finishedGame ? 0 : 1);

  /*console.groupCollapsed(
    `%c[TRICK CHECK]`,
    'color:#4caf50;font-weight:bold'
  );

  //console.log('leaderIndex:', leaderIndex);
  //console.log('leader:', {
    clientId: leader.clientId,
    finishedGame: leader.finishedGame,
    wonRound: leader.wonRound
  });

  //console.log('activeCount:', activeCount);
  //console.log(
    'activePlayers:',
    activePlayers.map(p => ({
      clientId: p.clientId,
      finishedGame: p.finishedGame,
      passed: p.passed
    }))
  );

  //console.log('passTracker:', GameModule.passTracker);
  //console.log('passesNeeded:', passesNeeded);*/

  const ended =
    passesNeeded > 0 &&
    GameModule.passTracker >= passesNeeded;

  /*//console.log('TRICK ENDED?', ended);

  console.groupEnd();*/

  return ended;
}

function getLosingPlayerWithCards() {
    // When 3 players have finished, exactly 1 player remains not-finished.
    const loser = GameModule.players.find(p => !p.finishedGame);

    if (!loser) return null;

    return {
        clientId: loser.clientId,
        cardsRemaining: Array.isArray(loser.cards) ? loser.cards.length : 0,
    };
}

function nextActiveSeat(fromIndex) {
  const n = GameModule.players.length;
  for (let step = 1; step <= n; step++) {
    const j = (fromIndex + step) % n;
    if (!GameModule.players[j].finishedGame) return j;
  }
  return fromIndex; // fallback
}

//Actual game loop, 1 loop represents a turn
const spGameLoop = async (firstTurnClientId) => {
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const clearButton = document.getElementById("clear");
    const sortSelect = document.getElementById("sortSelect");

    //sort all player's cards, it will resolve once all 4 clients sorting animations are complete
    let sortResolve = await spSortHands(); 

    // after you get firstTurnClientId from dealSinglePlayerCards()
    GameModule.turn = GameModule.players.findIndex(p => p.clientId === firstTurnClientId);

    if(sortResolve === 'sortComplete'){
        ////console.log("TURN IS: " + GameModule.turn);

        // listen for server event notifying that 3 players have finished
        // ONE-SHOT waiter + quick flag to know when to break the loop
        let gameOver = false;

        //GAME LOOP, each loop represents a single turn
        for(let i = 0; i < 100; i++){
            playButton.disabled = true; //disable play button because no card is selected which is an invalid move
            clearButton.disabled = true;
            passButton.disabled = true

            /*log gameState values
            //console.log("GameState isFirstMove:", GameModule.isFirstMove);
            //console.log("GameState Players:", GameModule.players);
            //console.log("GameState Game Deck:", GameModule.gameDeck);
            //console.log("GameState Last Hand:", GameModule.lastHand);
            //console.log("GameState Turn:", GameModule.turn);
            //console.log("GameState Finished Deck:", GameModule.finishedDeck);
            //console.log("GameState Players Finished:", GameModule.playersFinished);
            //console.log("GameState playedHand:", GameModule.playedHand);
            //console.log("GameState passTracker:", GameModule.passTracker);*/

            // return last hand (that wasn't a pass)
            GameModule.lastHand = GameModule.playedHand > 0
            ? GameModule.gameDeck.slice(GameModule.gameDeck.length - GameModule.playedHand)
            : GameModule.lastHand; // unchanged on pass
            
            // print out last played hand in status bar
            setStatus(formatHand(GameModule.lastHand));

            //Change turn here
            displayTurn(GameModule.turn);
            
            // inside spGameLoop, after displayTurn(GameModule.turn)
            const actorIndex = GameModule.turn;
            const actor = GameModule.players[actorIndex];

            if (trickEnded()) {
                // reset pass state for new trick
                GameModule.players.forEach(p => { p.passed = false; });
                GameModule.passTracker = 0;
                GameModule.playedHand = 0;     // optional: clear pile size

                await spFinishDeckAnimation();

                actor.wonRound = true;

                const winnerName = actorIndex === 0 ? 'You' : (actor?.username ?? 'Someone');
                showToast(`${winnerName} won the round!`);
            }

            let outcome;
            if (actor.clientId === GameModule.players[0].clientId) {
                outcome = await GameModule.players[0].spPlayCard(
                    GameModule.gameDeck,
                    GameModule.lastHand,
                    GameModule.playersFinished,
                    GameModule.isFirstMove
                );
            } else {
                outcome = await actor.spPlayCard(
                    GameModule.gameDeck,
                    GameModule.lastHand,
                    GameModule.players,
                    GameModule.turn,
                    GameModule.isFirstMove,
                    GameModule.lastPlayedBy
                );
            }

            // apply flags in one place, return gameOver if 3 players have finished
            gameOver = await applySpTurnOutcome({ actorIndex, outcome, gameOver });

            // toast feedback for this turn's action (ported from Shithead)
            const actorName = actorIndex === 0 ? 'You' : (actor?.username ?? 'Someone');
            if (GameModule.playedHand >= 1 && GameModule.playedHand <= 5) {
                if (!actor.finishedGame) {
                    const justPlayed = GameModule.gameDeck.slice(GameModule.gameDeck.length - GameModule.playedHand);
                    showToast(`${actorName} played ${formatHand(justPlayed)}${getComboEmoji(justPlayed)}`);
                }
            } else if (GameModule.playedHand === 0) {
                showToast(`${actorName} passed`);
            }

            ////console.log("Played Hand Length: " + GameModule.playedHand)

            //if player played a valid hand
            if(GameModule.playedHand >= 1 && GameModule.playedHand <= 5){
                //GameModule.playedHistory.push(GameModule.lastHand); //push last valid hand into playedHistory array
                ////console.log("played hand debug: " + GameModule.playedHand);

                // store sortMode for next game 
                GameModule.sortMode = sortSelect.value;
                
                // check if game ended this loop 
                if (gameOver) {
                    // return other 3 player's clientIds and remaining cards
                    const losingPlayer = getLosingPlayerWithCards();

                    // let the "X finished 3rd!" toast actually be seen before it's replaced
                    await sleep(400);

                    const loserIdx = GameModule.players.findIndex(p => p.clientId === losingPlayer?.clientId);
                    const loserName = loserIdx === 0 ? 'You' : (GameModule.players[loserIdx]?.username ?? 'Someone');
                    showToast(placeCallout(loserName, 4));

                    // play finish game animation
                    await finishSpGameAnimation(GameModule.gameDeck, losingPlayer);

                    // return final finishing positions (array of clientIds in order)
                    const resultsOut = [
                        ...GameModule.playersFinished,
                        losingPlayer.clientId
                    ];

                    GameModule.reset();
                    return resultsOut;
                }
            }
            else if(GameModule.playedHand == 0){ //else if player passed
                continue;
            }
        }
    }
}

//Actual game loop, 1 loop represents a turn
const gameLoop = async (roomCode, socket, firstTurnClientId, onResume) => {
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const clearButton = document.getElementById("clear");
    const sortSelect = document.getElementById("sortSelect");

    //console.log('gameLoop() entered', { onResume, hasToken: !!GameModule._currentLoopToken, canceled: gmHasCancel() });

    if (!GameModule._currentLoopToken || gmHasCancel()) {
        //console.log('[gameLoop] canceled or no token at entry — aborting');
        return;
    }
    
    if (onResume === false) {
        // fresh game start
        GameModule.turn = GameModule.players.findIndex(p => Number(p.clientId) === Number(firstTurnClientId));
    } else {
        // resume game, don’t override turn, it was already set from resume payload
        //console.log("Resuming game, keeping existing GameModule.turn:", GameModule.turn);
    }

    seedShadowKeysOnce();
    //sort all player's cards, it will resolve once all 4 clients sorting animations are complete
    let sortResolve = await sortHands(socket, roomCode); 

    if(sortResolve === 'sortComplete'){
        //console.log("TURN IS: " + GameModule.turn);

        // listen for server event notifying that a player has finished
        const unsubscribePlayerFinished  = subscribePlayerFinished(socket);

        // listen for server event notifying that 3 players have finished
        // ONE-SHOT waiter + quick flag to know when to break the loop
        let gameOver = false;
        const gameOverPromise = waitForGameHasFinished(socket);
        const gameOverFlagHandler = () => { gameOver = true; };
        socket.on('gameHasFinished', gameOverFlagHandler);

        //GAME LOOP, each loop represents a single turn
        for(let i = 0; i < 100; i++){
            if (!GameModule._currentLoopToken || gmHasCancel()) {
                //console.log('[gameLoop] canceled during iteration — exiting early');
                return;
            }
            playButton.disabled = true; //disable play button because no card is selected which is an invalid move
            clearButton.disabled = true;
            passButton.disabled = true

            //log gameState values
            //console.log("GameState isFirstMove:", GameModule.isFirstMove);
            //console.log("GameState Players:", GameModule.players);
            //console.log("GameState Game Deck:", GameModule.gameDeck);
            //console.log("GameState Last Hand:", GameModule.lastHand);
            //console.log("GameState Turn:", GameModule.turn);
            //console.log("GameState Finished Deck:", GameModule.finishedDeck);
            //console.log("GameState Players Finished:", GameModule.playersFinished);
            //console.log("GameState playedHand:", GameModule.playedHand);

            const last = await getLastHand(socket, roomCode);

            // local mirror
            GameModule.lastHand = last;                  
            setStatus(formatHand(last));

            //Change turn here
            displayTurn(GameModule.turn);
            
            // If local client's turn then play local turn and update turn, lastvalidhand, and playedHand from server payload
            if(GameModule.players[GameModule.turn].clientId === GameModule.players[0].clientId) {
                await localPlayerHand(socket, roomCode);
                //set won round back to false after player has won round and has played their free turn
            } else {
                // mirror move from other clients using their sent payload
                await receivePlayerHand(socket, roomCode);
            }
            //console.log("Played Hand Length: " + GameModule.playedHand)

            //if player played a valid hand
            if(GameModule.playedHand >= 1 && GameModule.playedHand <= 5){
                //GameModule.playedHistory.push(GameModule.lastHand); //push last valid hand into playedHistory array
                //console.log("played hand debug: " + GameModule.playedHand);

                // do a new function here input current turn, instead so theres only one animation per turn instead of all cards being sorted after each turn
                //if player or ai play a valid hand, sort their cards

                 // ---- check if game ended this tick ----
                if (gameOver) {
                    // clean up listeners added for this loop
                    socket.off('gameHasFinished', gameOverFlagHandler);
                    unsubscribePlayerFinished();

                    // Get final data (playersFinished, losingPlayer)
                    const { playersFinished, losingPlayer, losingPlayerCards } = await gameOverPromise;

                    await sleep(900); // let the 3rd-place finish toast be seen first

                    const loserIdx = GameModule.players.findIndex(p => p.username === losingPlayer);
                    const loserName = loserIdx === 0 ? 'You' : (GameModule.players[loserIdx]?.username ?? 'Someone');
                    showToast(placeCallout(loserName, 4));
                    //console.log(losingPlayer);

                    // Now it's safe to animate: all clients have acked the last hand,
                    // and gameDeck includes those last cards, unmount finishedDeck after animations, and reset gameState
                    // Now it's safe to animate: all clients have acked the last hand,
                    // and gameDeck includes those last cards…
                    await finishGameAnimation(roomCode, socket, GameModule.gameDeck, losingPlayer, losingPlayerCards);
                    await finishedGame(socket);

                    // Make sure no late events from this round can fire
                    detachGameEvents(socket);          // turn/round events (cardsPlayed/passed/wonRound/ACKs/etc.)
                    removeAllGameElements();           // hide HUD & clear any leftover DOM (safe after finish)

                    // Hand back a clean copy (avoid shared reference)
                    const resultsOut = [...playersFinished];
                    GameModule.reset();
                    return resultsOut;
                }
            }
            else if(GameModule.playedHand == 0){ //else if player passed
                continue;
            }
        }
    }
}

function resetButtonListeners(...buttons) {
    return buttons.map((btn) => {
        if (!btn) return btn;                   // keep null/undefined as-is
        const clone = btn.cloneNode(true);      // true = copy attributes, not listeners
        btn.replaceWith(clone);
        return clone;                           // IMPORTANT: return the live node
    });
}


// menu that allows users to enter a valid username and password to establish a connection with the server
async function loginMenu() {
    const loginMenu = document.getElementById("loginMenu");
    const userNameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    let loginButton   = document.getElementById("loginButton");
    let createAccountButton = document.getElementById("createAccountButton");
    let lostPasswordButton  = document.getElementById("lostPasswordButton");
    let spButton = document.getElementById("singlePlayerButton");
    const errorMessage1 = document.getElementById("errorMessage1");

    // reset & rebind references
    [loginButton, createAccountButton, lostPasswordButton] = resetButtonListeners(loginButton, createAccountButton, lostPasswordButton);

    setHiddenSafe(loginMenu, false);
    clearLoginErrors(); 
    
    // disable button when fields empty
    function updateLoginButtonState() {
        const hasUsername = userNameInput.value.trim().length > 0;
        const hasPassword = passwordInput.value.trim().length > 0;
        loginButton.disabled = !(hasUsername && hasPassword);
    }

    function clearLoginErrors() {
        errorMessage1.textContent = '';
        userNameInput.setCustomValidity('');
    }
    
    updateLoginButtonState();
    userNameInput.addEventListener("input", updateLoginButtonState);
    passwordInput.addEventListener("input", updateLoginButtonState);

    // Enter in either field logs in (the form has no submit button). Property, not listener, so re-entering the menu doesn't stack them.
    const onLoginEnter = (e) => {
        if (e.key === 'Enter' && !loginButton.disabled) { e.preventDefault(); loginButton.click(); }
    };
    userNameInput.onkeydown = onLoginEnter;
    passwordInput.onkeydown = onLoginEnter;

    return new Promise((resolve) => {
        let settled = false;
        function settle(v) { if (!settled) { settled = true; resolve(v); } }

        async function handleClick() {
        loginButton.disabled = true;

        // capture
        const usernameInput = userNameInput.value.trim();
        const password = passwordInput.value;

        // clear password field (basic hygiene)
        passwordInput.value = "";
        updateLoginButtonState();

        try {
            // 1) PB auth
            const authData = await pb.collection('users').authWithPassword(usernameInput, password);

            // BLOCK if not verified
            if (!authData?.record?.verified) {
                // clean up any session
                pb.authStore.clear();

                // explain + offer resend
                errorMessage1.innerHTML = `
                    Your email isn’t verified yet.
                    <button type="button" id="resendVerifyBtn" class="btn-link">Resend verification email</button>
                `;

                // wire "Resend"
                const resendBtn = document.getElementById('resendVerifyBtn');
                if (resendBtn) {
                    resendBtn.onclick = async () => {
                    try {
                        await pb.collection('users').requestVerification(usernameInput);
                        errorMessage1.textContent = "Verification email sent. Check your inbox.";
                    } catch (e) {
                        const msg = e?.data?.message || "Failed to send verification email.";
                        errorMessage1.textContent = msg;
                    }
                    };
                }

                // re-enable button and bail
                loginButton.disabled = false;
                
                return; // don’t proceed to socket connect
            }

            // authed, get username to resolve
            const displayName = authData?.record?.name || usernameInput;

            // if account verified then socket connect with token
            const socket = io('https://big2.kbcardgames.xyz', { //'http://localhost:3000'
                auth: { pbToken: pb.authStore.token },
                username: displayName, // export username
                transports: ['polling','websocket'],
            });

            let authed = false;

            const onAuthed = () => {
                if (authed) return;
                authed = true;
                socket.off('authenticated', onAuthed);
                clearLoginErrors(); 
                setHiddenSafe(loginMenu, true);
                settle({ type: 'login', socket, username: displayName });
            };
            socket.on('authenticated', onAuthed);
            socket.on('connect', onAuthed);

            socket.on('connect_error', (error) => {
                const msg = (error && error.message) || 'Authentication failed';
                if (msg === 'Email not verified') {
                    errorMessage1.innerHTML = `
                        Your email isn’t verified yet.
                        <button type="button" id="resendVerifyBtn" class="btn-link">Resend verification email</button>
                    `;
                    document.getElementById('resendVerifyBtn')?.addEventListener('click', async () => {
                    try {
                        await pb.collection('users').requestVerification(userNameInput.value.trim());
                        errorMessage1.textContent = "Verification email sent. Check your inbox.";
                    } catch (e) {
                        errorMessage1.textContent = "Failed to send verification email.";
                    }
                    });
                } else {
                    errorMessage1.innerText = (msg === 'Authentication failed')
                    ? 'Invalid username or password.'
                    : msg;
                }

                setHiddenSafe(loginMenu, false);
                updateLoginButtonState();
                userNameInput.setCustomValidity(msg);
                userNameInput.reportValidity();
                loginButton.disabled = false;
            });
        } catch (e) {
            const msg = e?.data?.message || 'Login failed';
            const identityMsg = e?.data?.data?.identity?.message;
            const passwordMsg = e?.data?.data?.password?.message;
            // PocketBase answers a wrong email/password with a generic 400 "Failed to authenticate."
            const friendly = e?.status === 400 ? 'Incorrect email or password.'
                : e?.status === 0 ? "Can't reach the server. Check your connection and try again."
                : msg;
            errorMessage1.innerText = identityMsg || passwordMsg || friendly;
            loginButton.disabled = false;
        }
        }

        // buttons
        loginButton.addEventListener("click", () => {
            try { deck.unmount(); } catch (e) { /* already unmounted */ }
            clickSounds[0].play();
            const u = userNameInput.value.trim();
            const p = passwordInput.value.trim();
            if (!u || !p) {
                errorMessage1.innerText = !u && !p
                ? "Enter your email and password."
                : (!u ? "Enter your email." : "Enter your password.");
                return;
            }
            handleClick();
        });

        spButton.addEventListener("click", () => {
            try { deck.unmount(); } catch (e) { /* already unmounted */ }
            clickSounds[0].play();
            setHiddenSafe(loginMenu, true);
            settle({ type: "singlePlayer" });
            },
            { once: true }
        );

        createAccountButton.addEventListener(
            "click",
            () => {
                try { deck.unmount(); } catch (e) { /* already unmounted */ }
                clickSounds[0].play();
                clearLoginErrors(); 
                setHiddenSafe(loginMenu, true);
                settle({ type: "createAccount" });
            },
            { once: true }
        );

        // Route: Forgot Password (optional menu below)
        lostPasswordButton.addEventListener("click", () => {
            try { deck.unmount(); } catch (e) { /* already unmounted */ }
            clickSounds[0].play();
            clearLoginErrors(); 
            settle({ type: 'forgotPassword' });
        });
    });
}

async function createAccountMenu() {
    const loginMenu = document.getElementById("loginMenu");
    const caMenu  = document.getElementById("createAccountMenu");
    const form = caMenu.querySelector("form");
    const emailInput = document.getElementById("email");
    const usernameInput = document.getElementById("usernameRegistration");
    const passInput = document.getElementById("caPassword");
    const pass2Input = document.getElementById("caRepeatPassword");
    const err = document.getElementById("errorMessageCA");
    const backBtn = document.getElementById("caBackButton");
    const registerBtn = form.querySelector('button[type="submit"]');

    setHiddenSafe(caMenu, false); //show create account menu
    
    const showError = (msg) => { if (err) err.textContent = msg || ''; };

    // username validation (letters/numbers/underscores only, 3–12 chars)
    const MAX_USERNAME_LEN = 12;
    const USERNAME_REGEX = /^[A-Za-z0-9_]+$/;

    function validateUsername() {
        const value = usernameInput.value.trim();

        if (value.length === 0) {
            usernameInput.setCustomValidity("Username is required.");
        } else if (value.length < 3) {
            usernameInput.setCustomValidity("Username must be at least 3 characters.");
        } else if (value.length > MAX_USERNAME_LEN) {
            usernameInput.setCustomValidity(`Username must be ${MAX_USERNAME_LEN} characters or fewer.`);
        } else if (!USERNAME_REGEX.test(value)) {
            usernameInput.setCustomValidity("Only letters, numbers, and underscores are allowed.");
        } else {
            usernameInput.setCustomValidity("");
        }
    }
    usernameInput.addEventListener('input', () => {
        validateUsername();
        updateRegisterButton();
    });

    // Clear any errors / custom validity as soon as the user edits
    const clearErrorsOnInput = () => {
        showError('');
        emailInput.setCustomValidity('');
        usernameInput.setCustomValidity('');
        passInput.setCustomValidity('');
        pass2Input.setCustomValidity('');
    };

    [emailInput, usernameInput, passInput, pass2Input].forEach(inp => {
        inp.addEventListener('input', clearErrorsOnInput);
    });

    function resetCAForm() {
        form.reset();
        emailInput.setCustomValidity('');
        usernameInput.setCustomValidity('');
        passInput.setCustomValidity('');
        pass2Input.setCustomValidity('');
        showError('');
    }

    // disable Register button while invalid 
    const updateRegisterButton = () => {
        registerBtn.disabled = !form.checkValidity();
    };
    form.addEventListener('input', updateRegisterButton);
    updateRegisterButton();  // initialize state on load

    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,64}$/;

    function validatePasswords() {
        // strength on first field
        if (!strongPassword.test(passInput.value)) {
            passInput.setCustomValidity("8–64 chars incl. upper, lower, number, symbol.");
        } else {
            passInput.setCustomValidity("");
        }

        // match on second field
        if (pass2Input.value && pass2Input.value !== passInput.value) {
            pass2Input.setCustomValidity("Passwords do not match");
        } else {
            pass2Input.setCustomValidity("");
        }
    }

    // run on every edit and re-evaluate button state
    [passInput, pass2Input].forEach(inp => {
        inp.addEventListener('input', () => { validatePasswords(); updateRegisterButton(); });
    });

    // initial evaluation
    validatePasswords();
    updateRegisterButton();

    // Wrap in a Promise so onload can truly wait here
    return new Promise((resolve) => {
        backBtn?.addEventListener("click", () => {
            resetCAForm();
            // back to login
            setHiddenSafe(caMenu, true);

            setHiddenSafe(loginMenu, false);
            resolve("back");
        }, { once: true });

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            showError('');

            if (!form.checkValidity()) { form.reportValidity(); return; }
            if (passInput.value !== pass2Input.value) {
                pass2Input.setCustomValidity("Passwords do not match");
                pass2Input.reportValidity();
                pass2Input.addEventListener('input', () => pass2Input.setCustomValidity(''), { once: true });
                return;
            }
            if (passInput.value.length < 8) {
                passInput.setCustomValidity("Use at least 8 characters");
                passInput.reportValidity();
                passInput.addEventListener('input', () => passInput.setCustomValidity(''), { once: true });
                return;
            }

            registerBtn.disabled = true;
            registerBtn.classList.add('opacity-60', 'cursor-not-allowed');
            try {
                await pb.collection('users').create({
                    email: emailInput.value.trim().toLowerCase(),
                    emailVisibility: true,
                    password: passInput.value,
                    passwordConfirm: pass2Input.value,
                    name: usernameInput.value.trim()
                });
                await pb.collection('users').requestVerification(emailInput.value.trim());

                // bounce to login with prefill + message
                caMenu.classList.add("hidden");
                setHiddenSafe(loginMenu, false);
                const loginEmail = document.getElementById("username");
                const loginErr   = document.getElementById("errorMessage1");
                if (loginEmail) loginEmail.value = emailInput.value.trim();
                if (loginErr) { loginErr.textContent = "Verification email sent — please verify, then log in."; loginErr.style.display = "block"; }

                resolve("registered");
            } catch (e) {
                const msg = e?.data?.message || e?.message || "Registration failed";
                const emailMsg = e?.data?.data?.email?.message;
                const userMsg  = e?.data?.data?.name?.message;
                const passMsg  = e?.data?.data?.password?.message;
                showError(emailMsg || userMsg || passMsg || msg);
            } finally {
                registerBtn.disabled = false;
                registerBtn.classList.remove('opacity-60', 'cursor-not-allowed');
            }
        }, { once: true });
    });
}

async function lostPasswordMenu() {
    const loginMenu = document.getElementById("loginMenu");
    const fpMenu = document.getElementById("lostPasswordMenu");
    const emailInput = document.getElementById("forgotEmail");
    const err = document.getElementById("errorMessageFP");
    const info = document.getElementById("infoMessageFP");
    const sendBtn = document.getElementById("sendResetBtn");
    const backBtn = document.getElementById("fpBackButton");

    const show = () => {
        setHiddenSafe(fpMenu, false);
    };

    const hide = () => {
        setHiddenSafe(fpMenu, true);
    };

    // Show forgot-password menu, hide login menu
    show();
    setHiddenSafe(loginMenu, true);

    // Clear messages
    err.textContent = "";
    info.textContent = "";

    return new Promise((resolve) => {
        const onSubmit = async () => {
        err.textContent = ""; info.textContent = "";
        const email = emailInput.value.trim().toLowerCase();
        if (!email) { err.textContent = "Email is required."; return; }

        try {
            // This sends an email containing your configured reset URL + token
            await pb.collection('users').requestPasswordReset(email);
            info.textContent = "Reset link sent. Check your inbox.";
        } catch (e) {
            err.textContent = e?.data?.message || "Failed to send reset link.";
        }
        };

        sendBtn.addEventListener("click", onSubmit);
        backBtn.addEventListener("click", () => {
        hide();
        setHiddenSafe(loginMenu, false);
        resolve("back");
        }, { once: true });
    });
}

// When the user lands on your app with a token, show new-password form and confirm it
async function resetPasswordMenu(token) {
    const loginMenu = document.getElementById("loginMenu");
    const rpMenu = document.getElementById("resetPasswordMenu");
    const p1 = document.getElementById("rpPassword");
    const p2 = document.getElementById("rpPassword2");
    const err = document.getElementById("errorMessageRP");
    const info = document.getElementById("infoMessageRP");
    const setBtn = document.getElementById("setNewPasswordBtn");
    const backBtn = document.getElementById("rpBackButton");

    const show = () => {
        setHiddenSafe(rpMenu, false);
    };

    const hide = () => {
        setHiddenSafe(rpMenu, true);
    };

    // Show reset-password menu, hide login menu
    show();
    setHiddenSafe(loginMenu, true);

    // Clear messages
    err.textContent = "";
    info.textContent = "";

    return new Promise((resolve) => {
        const onSubmit = async () => {
        err.textContent = ""; info.textContent = "";

        if (!p1.value || !p2.value) { err.textContent = "Please fill both fields."; return; }
        if (p1.value !== p2.value)   { err.textContent = "Passwords do not match."; return; }
        if (p1.value.length < 8)     { err.textContent = "Use at least 8 characters."; return; }

        try {
            // Confirm with the token + new password
            await pb.collection('users').confirmPasswordReset(token, p1.value, p2.value);
            info.textContent = "Password updated. You can log in now.";
        } catch (e) {
            err.textContent = e?.data?.message || "Reset failed.";
        }
        };

        setBtn.addEventListener("click", onSubmit);
        backBtn.addEventListener("click", () => {
        hide();
        setHiddenSafe(loginMenu, false);
        resolve("back");
        }, { once: true });
    });
}

// fetch the full player_stats record for the authed user.
// returns null if not found or not authed.
async function fetchPlayerStats(pb, username) {
    if (!username) return null;

    try {
        const query = username.includes('-') 
        ? `user.id="${username}"`
        : `user.name="${username}"`;

        const rec = await pb.collection('player_stats').getFirstListItem(query);

        // Normalize + safe defaults
        const s = {
            id: rec.id,
            user: rec.user,                              // relation id
            games_played: rec.games_played ?? 0,
            wins: rec.wins ?? 0,
            seconds: rec.seconds ?? 0,
            thirds: rec.thirds ?? 0,
            fourths: rec.fourths ?? 0,
            avg_finish: typeof rec.avg_finish === 'number' ? rec.avg_finish : null,
            streak_wins: rec.streak_wins ?? 0,
            streak_losses: rec.streak_losses ?? 0,
            last_game: rec.last_game ?? null,           // relation id
            updated: rec.updated ?? null,
        };

        // Derived metrics
        const gp = s.games_played || 0;
        s.win_rate = gp ? s.wins / gp : 0;
        s.top2 = s.wins + s.seconds;
        s.top2_rate = gp ? s.top2 / gp : 0;

        return s;
    } catch (err) {
        console.error('Failed to fetch player_stats:', err);
        return null;
    }
}

// Fetch paginated game_results for a username
async function fetchGameResultsForUsername(pb, username, { page = 1, perPage = 10, sort = '-created' } = {}) {
    if (!username) return { items: [], page, perPage, totalPages: 1, totalItems: 0 };

    const user = await getUserByName(username);
    const uid = user?.id;
    if (!uid) return { items: [], page, perPage, totalPages: 1, totalItems: 0 };

    const filter = [
        `first.id="${uid}"`,
        `second.id="${uid}"`,
        `third.id="${uid}"`,
        `fourth.id="${uid}"`
    ].join(' || ');

    const res = await pb.collection('game_results').getList(page, perPage, {
        filter,
        expand: 'first,second,third,fourth',
        sort
    });

    const items = res.items.map(it => {
        const pickName = (rec) => rec ? (rec.name || rec.username || rec.id) : '';
        const first  = pickName(it.expand?.first);
        const second = pickName(it.expand?.second);
        const third  = pickName(it.expand?.third);
        const fourth = pickName(it.expand?.fourth);

        return {
        id: it.id,
        created: it.created,
        first, second, third, fourth
        };
    });

    return {
        items,
        page: res.page,
        perPage: res.perPage,
        totalPages: res.totalPages,
        totalItems: res.totalItems,
    };
}

// return appropriate font colour for profile average score display
function getAvgTier(avg) {
    if (avg == null) {
        return {
        label: '—',
        text: 'text-gray-400',
        bg: 'bg-gray-100',
        border: 'border-gray-400/30',
        ring: '',
        title: 'No data'
        };
    }

    if (avg <= 1.75) {
        return {
        label: 'Mythic',
        text: 'text-emerald-600 dark:text-emerald-300',
        bg: 'bg-emerald-50 dark:bg-emerald-900/25',
        border: 'border-emerald-300/60 dark:border-emerald-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(16,185,129,.12)]',
        title: 'Mythic (≤ 1.75)'
        };
    } else if (avg <= 2.0) {
        return {
        label: 'Legendary',
        text: 'text-cyan-600 dark:text-cyan-300',
        bg: 'bg-cyan-50 dark:bg-cyan-900/25',
        border: 'border-cyan-300/60 dark:border-cyan-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(8,145,178,.12)]',
        title: 'Legendary (≤ 2.00)'
        };
    } else if (avg <= 2.5) {
        return {
        label: 'Epic',
        text: 'text-violet-600 dark:text-violet-300',
        bg: 'bg-violet-50 dark:bg-violet-900/25',
        border: 'border-violet-300/60 dark:border-violet-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(139,92,246,.12)]',
        title: 'Epic (≤ 2.50)'
        };
    } else if (avg <= 3.0) {
        return {
        label: 'Rare',
        text: 'text-amber-600 dark:text-amber-300',
        bg: 'bg-amber-50 dark:bg-amber-900/25',
        border: 'border-amber-300/60 dark:border-amber-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(245,158,11,.12)]',
        title: 'Rare (≤ 3.00)'
        };
    } else if (avg <= 3.5) {
        return {
        label: 'Uncommon',
        text: 'text-orange-600 dark:text-orange-300',
        bg: 'bg-orange-50 dark:bg-orange-900/25',
        border: 'border-orange-300/60 dark:border-orange-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(234,88,12,.12)]',
        title: 'Uncommon (≤ 3.50)'
        };
    }

    return {
        label: 'Common',
        text: 'text-rose-600 dark:text-rose-300',
        bg: 'bg-rose-50 dark:bg-rose-900/25',
        border: 'border-rose-300/60 dark:border-rose-400/40',
        ring: 'shadow-[0_0_0_2px_rgba(244,63,94,.12)]',
        title: 'Common (> 3.50)'
    };
}

function esc(v) { return String(v).replace(/"/g, '\\"'); }

// escape text before putting it into an HTML template string (usernames are player-chosen)
function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// tier colour as a plain hex, for elements styled by menus.css (which overrides Tailwind text colours)
const TIER_HEX = { Mythic: '#059669', Legendary: '#0891b2', Epic: '#7c3aed', Rare: '#d97706', Uncommon: '#ea580c', Common: '#e11d48' };
const PLACE_LABELS = ['1st', '2nd', '3rd', '4th'];

// little "1st"/"2nd"... badge element
function makePlaceBadge(place) {
    const b = document.createElement('span');
    b.className = `place-badge place-${place}`;
    b.textContent = PLACE_LABELS[place - 1] ?? String(place);
    return b;
}

async function getUserByName(name) {
    return await pb.collection('users').getFirstListItem(`name="${esc(name)}"`);
}

function getSortForMetric(metric) {
    switch (metric) {
        case 'wins':     return '-win_pct, -games_played';
        case 'games':    return '-games_played, -win_pct';
        case 'losses':   return '-loss_pct, -games_played';  // higher loss% first
        case 'seconds':  return '-second_pct, -games_played';
        case 'thirds':   return '-third_pct, -games_played';
        case 'avg':
        default:         return 'avg_finish, -games_played';
    }
}

async function fetchLeaderboardPage(pb, { page = 1, perPage = 10, metric = 'avg' } = {}) {
  const sort = getSortForMetric(metric);
  const res = await pb.collection('player_stats').getList(page, perPage, {
    filter: 'games_played > 0',
    sort,
    expand: 'user',
  });

  const items = res.items.map((row) => {
    const u = row.expand?.user;
    const name = u?.name || u?.username || '(unknown)';
    const avatar = (u?.id && u?.avatar)
      ? pbAvatarUrl(u.id, u.avatar, '100x100')
      : 'src/css/avatars/avatar-placeholder.png';
    const games = row.games_played ?? 0;
    const wins  = row.wins ?? 0;
    const fourths = row.fourths ?? null; // explicit “losses” if tracked
    const losses = (fourths != null) ? fourths : Math.max(0, games - wins); // fallback if fourths missing

    return {
      id: row.id,
      userId: u?.id || null,
      name,
      avatar,
      games,
      wins,
      seconds: row.seconds ?? 0,
      thirds:  row.thirds  ?? 0,
      fourths,
      losses,
      avg:       (typeof row.avg_finish === 'number') ? row.avg_finish : null,
      winPct:    row.win_pct    ?? 0,
      secondPct: row.second_pct ?? 0,
      thirdPct:  row.third_pct  ?? 0,
      lossPct:   row.loss_pct   ?? 0,
      updated: row.updated ?? null,
    };
  });

  return {
    items,
    page: res.page,
    perPage: res.perPage,
    totalPages: res.totalPages,
    totalItems: res.totalItems,
  };
}

function metricHeader(metric) {
    switch (metric) {
        case 'wins':     return 'Wins';
        case 'games':    return 'Games';
        case 'losses':   return 'Losses';
        case 'seconds':  return 'Seconds';
        case 'thirds':   return 'Thirds';
        case 'avg':
        default:         return 'Average';
    }
}

function metricCellValue(row, metric) {
    switch (metric) {
        case 'wins':     return row.wins ?? 0;
        case 'games':    return row.games ?? 0;
        case 'losses':   return row.losses ?? 0;             // from fourths or fallback
        case 'seconds':  return row.seconds ?? 0;
        case 'thirds':   return row.thirds ?? 0;
        case 'avg':
        default:         return (row.avg == null) ? '—' : row.avg.toFixed(3);
    }
}

function td(cls, text) {
  const c = document.createElement('td');
  c.className = cls;
  c.textContent = (text ?? '—').toString();
  return c;
}

// leaderboard "rank by" tabs: metric -> button id
const LB_TABS = {
    avg:     'lbAvgOption',
    wins:    'lbWinsOption',
    seconds: 'lbSecondsOption',
    thirds:  'lbThirdsOption',
    losses:  'lbLossOption',
    games:   'lbGamesOption',
};

const LB_SUBTITLES = {
    avg:     'Ranked by average finish — lower is better',
    wins:    'Ranked by win rate',
    seconds: 'Ranked by 2nd-place rate',
    thirds:  'Ranked by 3rd-place rate',
    losses:  'Ranked by loss rate',
    games:   'Ranked by games played',
};

function setLeaderboardTab(metric) {
    for (const [m, id] of Object.entries(LB_TABS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        const on = m === metric;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const sub = document.getElementById('lbSubtitle');
    if (sub) sub.textContent = LB_SUBTITLES[metric] || LB_SUBTITLES.avg;
}

function bindLeaderboardTabs() {
    for (const [m, id] of Object.entries(LB_TABS)) {
        const el = document.getElementById(id);
        if (!el || el.dataset.bound) continue;
        el.dataset.bound = '1';
        el.addEventListener('click', () => {
            try { clickSounds?.[0]?.play(); } catch {}
            renderLeaderboardMenu(m);
        });
    }
}

// shared First / Prev / [info] / Next / Last footer for paged tables
function makePager() {
    const footer = document.createElement('div');
    footer.className = 'pager';

    const info = document.createElement('span');

    const mk = (label, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.title = title;
        b.className = 'btn btn-secondary btn-sm';
        b.textContent = label;
        return b;
    };
    const firstBtn = mk('« First', 'First page');
    const prevBtn  = mk('‹ Prev', 'Previous page');
    const nextBtn  = mk('Next ›', 'Next page');
    const lastBtn  = mk('Last »', 'Last page');

    const btns = document.createElement('div');
    btns.className = 'pager-buttons';
    btns.append(firstBtn, prevBtn, nextBtn, lastBtn);
    footer.append(info, btns);

    return { footer, info, firstBtn, prevBtn, nextBtn, lastBtn };
}

async function renderLeaderboardMenu(metric = 'avg') {
    const body = document.getElementById('leaderboardMenuBody');
    if (!body) return;

    bindLeaderboardTabs();
    setLeaderboardTab(metric);

    body.replaceChildren();

    const wrapper = document.createElement('div');
    wrapper.id = 'leaderboardWrapper';
    wrapper.className = 'data-table-wrap';
    body.appendChild(wrapper);

    const colOrder = {
        wins:    ['gp', 'win',  'second', 'third',  'loss'],
        seconds: ['gp', 'second', 'win',  'third',  'loss'],
        thirds:  ['gp', 'third',  'win',  'second', 'loss'],
        losses:  ['gp', 'loss',   'win',  'second', 'third'],
        avg:     ['gp', 'avg',    'win',  'second', 'third', 'loss'],
        games:   ['gp', 'win', 'second', 'third', 'loss'],
    };
    const sortedCol = { avg: 'avg', wins: 'win', seconds: 'second', thirds: 'third', losses: 'loss', games: 'gp' }[metric] || 'avg';
    const colLabels = { gp: 'Games', avg: 'Avg finish', win: 'Win %', second: '2nd %', third: '3rd %', loss: 'Loss %' };
    const cols = colOrder[metric] || colOrder.avg;

    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const th = (text, cls = '') => { const t = document.createElement('th'); t.className = cls; t.textContent = text; return t; };
    htr.append(th('#', ''), th('Player', ''));
    cols.forEach(c => htr.appendChild(th(colLabels[c], 'num' + (c === sortedCol ? ' is-sorted' : ''))));
    htr.firstChild.style.width = '56px';
    thead.appendChild(htr);

    const tbody = document.createElement('tbody');
    const pager = makePager();

    table.append(thead, tbody);
    wrapper.append(table, pager.footer);

    const myId = pb?.authStore?.model?.id;
    let page = 1;
    const perPage = 10;

    async function renderPage() {
        const res = await fetchLeaderboardPage(pb, { page, perPage, metric });
        tbody.replaceChildren();

        if (!res.items.length) {
            const tr = document.createElement('tr');
            tr.className = 'empty-row';
            tr.innerHTML = `<td colspan="8">No games played yet — finish a game to get on the board.</td>`;
            tbody.appendChild(tr);
        } else {
            const rankStart = (res.page - 1) * res.perPage + 1;

            res.items.forEach((row, i) => {
                const rank = rankStart + i;
                const tr = document.createElement('tr');
                if (myId && row.userId === myId) tr.classList.add('is-me');

                // rank
                const rankTd = document.createElement('td');
                const rankEl = document.createElement('span');
                rankEl.className = 'rank-num' + (rank <= 3 ? ` place-${rank}` : '');
                rankEl.textContent = rank;
                rankTd.appendChild(rankEl);
                tr.appendChild(rankTd);

                // player (avatar + name → opens their profile)
                const playerTd = document.createElement('td');
                const cell = document.createElement('div');
                cell.className = 'player-cell';

                const img = document.createElement('img');
                img.src = row.avatar;
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.className = 'avatar avatar-sm';

                const nameBtn = document.createElement('button');
                nameBtn.type = 'button';
                nameBtn.className = 'name-link';
                nameBtn.textContent = row.name;
                nameBtn.addEventListener('click', async () => {
                    try { clickSounds?.[2]?.play(); } catch {}
                    const profileMenu = document.getElementById('profileMenu');
                    setHiddenSafe(profileMenu, false);
                    await renderProfileHeader(row.name);
                    await renderProfileTable(row.name);
                });

                cell.append(img, nameBtn);
                if (myId && row.userId === myId) {
                    const you = document.createElement('span');
                    you.className = 'you-tag';
                    you.textContent = 'You';
                    cell.appendChild(you);
                }
                playerTd.appendChild(cell);
                tr.appendChild(playerTd);

                // stat columns in metric-dependent order
                const pct = (n) => n != null ? (n * 100).toFixed(1) + '%' : '—';
                const value = {
                    gp:     row.games ?? 0,
                    win:    pct(row.winPct),
                    second: pct(row.secondPct),
                    third:  pct(row.thirdPct),
                    loss:   pct(row.lossPct),
                    avg:    row.avg != null ? row.avg.toFixed(3) : '—',
                };
                cols.forEach(c => tr.appendChild(td('num' + (c === sortedCol ? ' is-sorted' : ''), value[c])));

                tbody.appendChild(tr);
            });
        }

        pager.info.textContent = `Page ${res.page} of ${Math.max(1, res.totalPages)} · ${res.totalItems} players`;

        pager.firstBtn.disabled = res.page <= 1;
        pager.prevBtn.disabled  = res.page <= 1;
        pager.nextBtn.disabled  = res.page >= res.totalPages;
        pager.lastBtn.disabled  = res.page >= res.totalPages;

        const click = () => { try { clickSounds?.[0]?.play(); } catch {} };
        pager.firstBtn.onclick = () => { click(); page = 1; renderPage(); };
        pager.prevBtn.onclick  = () => { click(); if (page > 1) page -= 1; renderPage(); };
        pager.nextBtn.onclick  = () => { click(); if (page < res.totalPages) page += 1; renderPage(); };
        pager.lastBtn.onclick  = () => { click(); page = res.totalPages; renderPage(); };
    }

    await renderPage();
}

async function renderProfileHeader(name) {
    const header = profileMenu.querySelector('#profileHeader');
    const body = profileMenu.querySelector('#profileBody');
    if (!header) return;

    // Get pocketbase player object via querying with name given by server on auth
    const u = await getUserByName(name);
    const username = u?.name || u?.username || 'Player';

    currentProfileUsername = username;

    // Fetch stats via username query
    const stats = await fetchPlayerStats(pb, username) || {};
    const avg = stats?.avg_finish ?? null;
    const tier = getAvgTier(avg);
    const tierHex = TIER_HEX[tier.label] || '#9ca3af';

    // ---- header: avatar, name, tier | average finish (tinted with the tier colour)
    header.className = [tier.bg, tier.border].join(' ');
    header.replaceChildren();

    const left = document.createElement('div');
    left.className = 'profile-id';

    const img = document.createElement('img');
    if (u?.id && u?.avatar) {
        const url1x = pbAvatarUrl(u.id, u.avatar, '100x100');
        const url2x = pbAvatarUrl(u.id, u.avatar, '200x200');
        img.src = url1x;
        img.srcset = `${url1x} 1x, ${url2x} 2x`;
        img.sizes = '64px';
    } else {
        img.src = 'src/css/avatars/avatar-placeholder.png';
    }
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'avatar avatar-lg';

    const idText = document.createElement('div');
    idText.style.minWidth = '0';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'profile-name';
    nameDiv.textContent = username;
    const tierWrap = document.createElement('div');
    tierWrap.className = 'profile-tier';
    const tierPill = document.createElement('span');
    tierPill.className = 'pill';
    tierPill.style.background = 'rgba(255,255,255,0.8)';
    tierPill.style.color = tierHex;
    tierPill.textContent = avg == null ? 'Unranked' : `${tier.label} tier`;
    tierPill.title = tier.title;
    tierWrap.appendChild(tierPill);
    idText.append(nameDiv, tierWrap);
    left.append(img, idText);

    const score = document.createElement('div');
    score.className = 'profile-score';
    score.title = tier.title;
    const scoreValue = document.createElement('div');
    scoreValue.className = 'profile-score-value';
    scoreValue.style.color = tierHex;
    scoreValue.textContent = avg !== null ? avg.toFixed(3) : '—';
    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'profile-score-label';
    scoreLabel.textContent = 'Avg finish';
    score.append(scoreValue, scoreLabel);

    header.append(left, score);

    // ---- stat tiles: count + share of games for each placing
    const gp = stats.games_played ?? 0;
    const wins = stats.wins ?? 0;
    const seconds = stats.seconds ?? 0;
    const thirds = stats.thirds ?? 0;
    const fourths = stats.fourths ?? 0;        // treated as "Losses"
    const top2 = (wins + seconds) | 0;
    const pct = (n) => gp ? ((n / gp) * 100).toFixed(1) + '%' : '—';

    const grid = document.createElement('div');
    grid.id = 'profileStatsStrip';
    grid.className = 'stat-grid';

    const tile = (label, value, sub) => {
        const t = document.createElement('div');
        t.className = 'stat-tile';
        const l = document.createElement('div'); l.className = 'stat-label'; l.textContent = label;
        const v = document.createElement('div'); v.className = 'stat-value'; v.textContent = value;
        const s2 = document.createElement('div'); s2.className = 'stat-sub'; s2.textContent = sub;
        t.append(l, v, s2);
        return t;
    };

    grid.append(
        tile('Games', gp, 'played'),
        tile('1st', wins, pct(wins)),
        tile('2nd', seconds, pct(seconds)),
        tile('3rd', thirds, pct(thirds)),
        tile('4th', fourths, pct(fourths)),
        tile('Top 2', pct(top2), `${top2} games`),
    );

    if (body) body.replaceChildren(grid);
    else header.insertAdjacentElement('afterend', grid);
}

async function renderProfileTable(username) {
    const body = document.getElementById("profileBody");
    if (!body) return;

    document.getElementById("profileStatsTable")?.remove();

    const section = document.createElement("div");
    section.id = "profileStatsTable";

    const title = document.createElement("div");
    title.className = "menu-section-title";
    title.textContent = "Recent games";

    const wrap = document.createElement("div");
    wrap.className = "data-table-wrap";

    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Result</th>
                <th>1st</th>
                <th>2nd</th>
                <th>3rd</th>
                <th>4th</th>
                <th></th>
            </tr>
        </thead>`;
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    const pager = makePager();
    wrap.append(table, pager.footer);
    section.append(title, wrap);
    body.appendChild(section);

    // Pagination state
    let page = 1;
    const perPage = 8;

    function fmtDate(iso) {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    // name cell: the profile owner is plain bold text, everyone else links to their profile
    function nameCell(name) {
        const c = document.createElement("td");
        if (!name) { c.textContent = "—"; return c; }
        if (name === username) {
            const s1 = document.createElement("span");
            s1.className = "name-self";
            s1.textContent = name;
            c.appendChild(s1);
        } else {
            const a = document.createElement("a");
            a.href = "#";
            a.className = "name-link";
            a.dataset.username = name;
            a.textContent = name;
            c.appendChild(a);
        }
        return c;
    }

    async function renderPage() {
        const res = await fetchGameResultsForUsername(pb, username, {
            page,
            perPage,
            sort: "-created",
        });

        tbody.replaceChildren();
        if (!res.items.length) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No games yet</td></tr>`;
        } else {
            res.items.forEach((row) => {
                const tr = document.createElement("tr");

                const dateTd = document.createElement("td");
                dateTd.textContent = fmtDate(row.created);

                const order = [row.first, row.second, row.third, row.fourth];
                const place = order.indexOf(username) + 1;
                const resultTd = document.createElement("td");
                if (place > 0) resultTd.appendChild(makePlaceBadge(place));
                else resultTd.textContent = "—";

                const viewTd = document.createElement("td");
                viewTd.className = "num";
                const view = document.createElement("a");
                view.href = "#";
                view.className = "btn-link";
                view.dataset.gameId = row.id;
                view.textContent = "View game ›";
                viewTd.appendChild(view);

                tr.append(dateTd, resultTd, ...order.map(nameCell), viewTd);
                tbody.appendChild(tr);
            });
        }

        pager.info.textContent = `Page ${res.page} of ${Math.max(1, res.totalPages)} · ${res.totalItems} games`;

        pager.firstBtn.disabled = res.page <= 1;
        pager.prevBtn.disabled = res.page <= 1;
        pager.nextBtn.disabled = res.page >= res.totalPages;
        pager.lastBtn.disabled = res.page >= res.totalPages;

        pager.firstBtn.onclick = () => { clickSounds[0].play(); page = 1; renderPage(); };
        pager.prevBtn.onclick = () => { clickSounds[0].play(); if (page > 1) page -= 1; renderPage(); };
        pager.nextBtn.onclick = () => { clickSounds[2].play(); if (page < res.totalPages) page += 1; renderPage(); };
        pager.lastBtn.onclick = () => { clickSounds[2].play(); page = res.totalPages; renderPage(); };
    }

    await renderPage();
}

document.body.addEventListener("click", async (e) => {
    const userLink = e.target.closest("a[data-username]");
    const gameLink = e.target.closest("a[data-game-id]");
    if (userLink) {
        e.preventDefault();
        const clicked = userLink.dataset.username?.trim();
        const showing = currentProfileUsername || document.getElementById("profileHeader")?.getAttribute("data-profile");
        if (clicked && showing && clicked === showing) return;

        document.getElementById("profileHeader")?.replaceChildren();
        document.getElementById("profileStatsTable")?.remove();
        document.getElementById("profileStatsStrip")?.remove();
        document.getElementById("profileStatsPercentageStrip")?.remove();

        clickSounds[2].play();
        await renderProfileHeader(clicked);
        await renderProfileTable(clicked);
        return;
    }

    if (gameLink) {
        e.preventDefault();
        const gameId = gameLink.dataset.gameId;
        const gameProfileMenu = document.getElementById("gameProfileMenu");
        if (gameProfileMenu) {
            setHiddenSafe(gameProfileMenu, false);
            // (we’ll populate its content next step)
            clickSounds[2].play();
            //await renderGameProfileBody
            openGameProfile(gameId, gameProfileMenu);
        }
    }
});

// helper: safe avatar url (uses your pbAvatarUrl if present)
function getAvatarUrl(user) {
    if (!user) return "src/css/avatars/avatar-placeholder.png";
    try {
        // pbAvatarUrl returns '' when the user has no avatar → fall through to the placeholder
        const url = typeof pbAvatarUrl === "function" ? pbAvatarUrl(user.id, user.avatar, "100x100") : '';
        if (url) return url;
    } catch (_) {}
    // Fallback PocketBase thumb URL shape (adjust if your helper differs)
    if (user?.collectionId && user?.avatar) {
        return `${pb.baseUrl}/api/files/${user.collectionId}/${user.id}/${user.avatar}?thumb=100x100`;
    }
    return "src/css/avatars/avatar-placeholder.png";
}

// compact finishing-order card for the game detail view
function playerCard(place, user) {
    const name = user?.name ?? "—";

    const wrap = document.createElement('div');
    wrap.className = "game-player";

    const img = document.createElement('img');
    img.src = getAvatarUrl(user);
    img.alt = '';
    img.className = "avatar avatar-sm";
    img.loading = "lazy";

    const nameDiv = document.createElement('div');
    nameDiv.className = "game-player-name";
    nameDiv.textContent = name;

    wrap.append(makePlaceBadge(place), img, nameDiv);
    return wrap;
}

// Convert your numeric rank to a display symbol in Big 2 order
function rankToSymbol(r) {
    if (r === 1) return 'A';
    if (r === 11) return 'J';
    if (r === 12) return 'Q';
    if (r === 13) return 'K';
    if (r === 2) return '2';
    return String(r); // 3–10
}

// Map the display symbol to the Unicode “nibble” used by the Playing Cards block
// (10 -> 0xA, J -> 0xB, Q -> 0xD, K -> 0xE; C is the Knight which we skip)
const NIBBLE = {
    'A': 0x1,
    '2': 0x2, '3': 0x3, '4': 0x4, '5': 0x5, '6': 0x6, '7': 0x7, '8': 0x8, '9': 0x9,
    '10': 0xA, 'J': 0xB, 'Q': 0xD, 'K': 0xE,
};

// Render one card to a glyph like 🃑. Falls back to text badge if something’s off.
function cardGlyph({ rank, suit }) {
    const sym = rankToSymbol(Number(rank));
    const nib = NIBBLE[sym] ?? NIBBLE[String(sym)] ?? null;
    const base = SUIT_BASES[suit];
    if (base && nib != null) {
        try {
        return String.fromCodePoint(base + nib);
        } catch {
        // noop → fallback below
        }
    }
    // Fallback: e.g., "A♦"
    const suitChar = ['♦','♣','♥','♠'][suit] ?? '?';
    return `${sym}${suitChar}`;
}

// one card glyph in the turn history
function cardSpan(card) {
    const sym = rankToSymbol(Number(card.rank));
    const suitChar = ['♦','♣','♥','♠'][card.suit] ?? '?';
    const label = `${sym}${suitChar}`;
    const isRed = card.suit === 0 || card.suit === 2;
    return `<span class="history-card${isRed ? ' red' : ''}" title="${label}" aria-label="${label}">${cardGlyph(card)}</span>`;
}

// one played hand: number, who played it, the cards
function historyRow(h, idx) {
    const who = h?.username ?? `Seat ${h?.seat ?? '?'}`;
    const cards = Array.isArray(h?.cards) ? h.cards.map(cardSpan).join('') : '';
    return `
        <div class="history-row">
            <span class="history-num">${idx + 1}</span>
            <span class="history-who" title="${escapeHtml(who)}">${escapeHtml(who)}</span>
            <div class="history-cards">${cards || '<span class="history-num">—</span>'}</div>
        </div>`;
}

// Build the turn history list
function renderHistoryAsCards(playedHistory, cap = 200) {
    const total = Array.isArray(playedHistory) ? playedHistory.length : 0;
    const rows = (playedHistory || [])
        .slice(0, cap)
        .map((h, i) => historyRow(h, i))
        .join('');
    const more = total > cap ? `<div class="history-empty">…and ${total - cap} more</div>` : '';
    return `<div class="history">${rows || '<div class="history-empty">No turns recorded</div>'}${more}</div>`;
}

// function handles opening another player's profile from gameProfileMenu
async function openGameProfile(gameId, container = document.getElementById("gameProfileMenu")) {
    if (!container) return;
    const body = container.querySelector('#gameProfileBody');
    if (!body) return;

    // Unhide + loading state (only the body, keep the close button intact)
    setHiddenSafe(container, false);
    body.innerHTML = `<div class="history-empty">Loading game…</div>`;

    try {
        const game = await pb.collection("game_results").getOne(gameId, {
            expand: "first,second,third,fourth",
        });

        const playedHistory = Array.isArray(game?.playedHistory) ? game.playedHistory : [];
        const createdStr = game?.created
            ? new Date(game.created).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : "—";

        body.innerHTML = `
            <div class="game-head">
                <div class="menu-title">Game details</div>
                <div class="menu-subtitle">${escapeHtml(createdStr)} · ${playedHistory.length} plays · ID ${escapeHtml(game.id)}</div>
            </div>
            <div class="menu-section-title">Finishing order</div>
            <div id="playersGrid" class="game-players"></div>
            <div class="menu-section-title">Turn history</div>
            ${renderHistoryAsCards(playedHistory)}
        `;

        body.querySelector('#playersGrid').append(
            playerCard(1, game.expand?.first ?? null),
            playerCard(2, game.expand?.second ?? null),
            playerCard(3, game.expand?.third ?? null),
            playerCard(4, game.expand?.fourth ?? null),
        );

        return { game, playedHistory };
    } catch (err) {
        console.error("Failed to fetch game:", err);
        body.innerHTML = `<div class="history-empty" style="color:var(--m-danger)">Couldn't load this game. Please try again.</div>`;
        throw err;
    }
}

//menu that allows users to enter a room number to join an available room
async function joinRoomMenu(socket, username) {
    return new Promise((resolve, reject) => {
        const joinRoomMenu = document.getElementById("joinRoomMenu");
        const availableRoomsDiv = document.getElementById('availableRooms');
        const errorMessage2 = document.getElementById("errorMessage2");
        const profileMenu = document.getElementById('profileMenu');
        const gameProfileMenu = document.getElementById('gameProfileMenu');
        const leaderboardMenu = document.getElementById('leaderboardMenu');

        let roomsClickBound = false;
        let onRoomsClick = null;

        // remove old listeners first
        const profileBtn = document.getElementById('jrProfileButton')
        const avatarBtn = document.getElementById('avatarButton');
        const jrLeaderboardButton = document.getElementById('jrLeaderboardButton');
        const closeProfileButton = document.getElementById('closeProfileButton');
        const closeGameProfileButton = document.getElementById('closeGameProfileButton');
        const closeLeaderboardButton = document.getElementById('closeLeaderboardButton');

        const newCloseProfileButton = closeProfileButton.cloneNode(true);
        const newCloseGameProfileButton = closeGameProfileButton.cloneNode(true);
        const newCloseLeaderboardButton = closeLeaderboardButton.cloneNode(true);
        const newAvatarBtn = avatarBtn.cloneNode(true);
        const newProfileBtn = profileBtn.cloneNode(true);
        const newJrLeaderboardButton = jrLeaderboardButton.cloneNode(true);

        profileBtn.parentNode.replaceChild(newProfileBtn, profileBtn);
        avatarBtn.parentNode.replaceChild(newAvatarBtn, avatarBtn);
        closeProfileButton.parentNode.replaceChild(newCloseProfileButton, closeProfileButton);
        closeGameProfileButton.parentNode.replaceChild(newCloseGameProfileButton, closeGameProfileButton);
        closeLeaderboardButton.parentNode.replaceChild(newCloseLeaderboardButton, closeLeaderboardButton);
        jrLeaderboardButton.parentNode.replaceChild(newJrLeaderboardButton, jrLeaderboardButton);

        const img = document.getElementById('jrAvatarImg');

        // who's signed in, and clear any error left from last time
        const jrUsernameEl = document.getElementById('jrUsername');
        if (jrUsernameEl) jrUsernameEl.textContent = username || pb?.authStore?.model?.name || 'Player';
        errorMessage2.textContent = '';


        async function openProfile() {
            // show popup above everything
            clickSounds[2].play();
            setHiddenSafe(profileMenu, false);
            await renderProfileHeader(username); // populate header from PB, will update to get profile via username
            await renderProfileTable(username);
        }

        async function openLeaderboard() {
            clickSounds[2].play();
            setHiddenSafe(leaderboardMenu, false);
            await renderLeaderboardMenu('avg');
        }

        function closeProfile() {
            clickSounds[0].play();
            setHiddenSafe(profileMenu, true);
        }

        function closeGameProfile() {
            clickSounds[0].play();
            setHiddenSafe(gameProfileMenu, true);
        }

        function closeLeaderboard() {
            clickSounds[0].play();
            setHiddenSafe(leaderboardMenu, true);
        }

        // delegated handler on the TOP BAR container (no buildup)
        function onProfileButtonClick(e) {
            // Only open when the actual "Profile" button is clicked
            if (e.target.closest('#jrProfileButton')) {
                openProfile();
            }
        }

        // delegated handler on the TOP BAR container (no buildup)
        function onLeaderboardButtonClick(e) {
            // Only open when the actual "Profile" button is clicked
            if (e.target.closest('#jrLeaderboardButton')) {
                openLeaderboard();
            }
        }
        
        // close button for profile menu
        function onCloseProfileClick() {
            closeProfile();
        }

        // close button for gameProfile menu
        function onCloseGameProfileClick() {
            closeGameProfile();
        }

        function onCloseLeaderboardClick() {
            closeLeaderboard();
        }

        function addListenerRoomButton() {
            if (roomsClickBound) return;
            roomsClickBound = true;

            onRoomsClick = (e) => {
                const btn = e.target.closest('.room-button');
                if (!btn || btn.disabled || !availableRoomsDiv.contains(btn)) return;
                handleJoinRoomFor(btn);
            };
            availableRoomsDiv.addEventListener('click', onRoomsClick);
        }

        function removeListenerRoomButton() {
            if (!roomsClickBound) return;
                roomsClickBound = false;
            if (onRoomsClick) {
                availableRoomsDiv.removeEventListener('click', onRoomsClick);
                onRoomsClick = null;
            }
        }

        // Display joinRoomMenu
        setHiddenSafe(joinRoomMenu, false);

        // bind once to the FRESHLY-CLONED nodes
        newProfileBtn.addEventListener('click', onProfileButtonClick);
        newJrLeaderboardButton.addEventListener('click', onLeaderboardButtonClick)
        newCloseProfileButton.addEventListener('click', onCloseProfileClick);
        newCloseGameProfileButton.addEventListener('click', onCloseGameProfileClick);
        newCloseLeaderboardButton.addEventListener('click', onCloseLeaderboardClick);
        

        (async function syncJoinRoomAvatar() {
            // Load current user's avatar like playerInfo
            const u = pb?.authStore?.model;
            if (u?.id && u?.avatar) {
                const url1x = pbAvatarUrl(u.id, u.avatar, '100x100');
                const url2x = pbAvatarUrl(u.id, u.avatar, '200x200');
                img.src = url1x;
                img.srcset = `${url1x} 1x, ${url2x} 2x`;
                img.sizes = '4.5rem'; // crisp at ~32px like playerInfo
            } else {
                img.src = 'src/css/avatars/avatar-placeholder.png';
                img.removeAttribute('srcset');
                img.removeAttribute('sizes');
            }

            // Click handler to open your avatar picker (stub for now)
            newAvatarBtn.addEventListener('click', async () => {
                // Guard: must be logged in
                const u = pb?.authStore?.model;
                if (!u?.id) {
                    console.warn('Not logged in; cannot set avatar.');
                    return;
                }

                // 1) Ask for an image (web file picker)
                const file = await (async function pickImageFile() {
                    return new Promise((resolve) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    // hint camera on mobile; browsers may ignore
                    input.capture = 'environment';
                    setHiddenSafe(input, true);
                    document.body.appendChild(input);
                    input.addEventListener('change', () => {
                        const f = input.files && input.files[0] ? input.files[0] : null;
                        input.remove();
                        resolve(f || null);
                    }, { once: true });
                    input.click();
                    });
                })();

                if (!file) return;

                // 2) Validate (type + size)
                const okTypes = new Set(['image/png','image/jpeg','image/webp','image/jpg']);
                if (!okTypes.has(file.type)) {
                    console.warn('Unsupported file type:', file.type);
                    errorMessage2.textContent = 'Please choose a PNG, JPG or WebP image.';
                    return;
                }
                if (file.size > 2 * 1024 * 1024) { // 2 MB
                    console.warn('File too large (>2MB).');
                    errorMessage2.textContent = 'That image is over 2 MB. Please pick a smaller one.';
                    return;
                }
                errorMessage2.textContent = '';

                // 3) Preview immediately
                try {
                    const blobUrl = URL.createObjectURL(file);
                    img.src = blobUrl;          // show preview in the 48×48 avatar
                    img.removeAttribute('srcset');
                    img.sizes = getComputedStyle(img).width || '48px';
                    // optional decode to avoid flicker
                    img.decode?.().catch(()=>{});
                } catch {}

                // 4) Upload to PocketBase
                try {
                    const authed = pb.authStore.model;
                    if (!authed?.id) throw new Error('Not authenticated');

                    const fd = new FormData();
                    fd.append('avatar', file);
                    fd.append('name', authed.name); // your schema requires name (min 3)

                    // capture the returned record
                    const updated = await pb.collection('users').update(authed.id, fd);

                    // keep authStore in sync so future calls use the latest avatar/name
                    pb.authStore.save(pb.authStore.token, updated);

                    // refresh thumbs
                    const url1x = pbAvatarUrl(updated.id, updated.avatar, '100x100');
                    const url2x = pbAvatarUrl(updated.id, updated.avatar, '200x200');
                    if (url1x) {
                        img.src = url1x;
                        img.srcset = `${url1x} 1x, ${url2x} 2x`;
                        img.sizes = getComputedStyle(img).width || '48px';
                    }

                    socket.emit('user:profile:update', {
                        pbId: pb.authStore.model.id,
                        avatar: pb.authStore.model.avatar,      // new PB filename
                        username: pb.authStore.model.name || pb.authStore.model.username
                    });
                } catch (e) {
                    // PB puts useful info here:
                    const status  = e?.status ?? e?.data?.code;
                    const message = e?.data?.message || e?.message;
                    const fieldErrs = e?.data?.data ? JSON.stringify(e.data.data, null, 2) : '';
                    console.error('Avatar upload failed:', { status, message, fieldErrs });
                    console.error(`Avatar upload failed: ${message}\n${fieldErrs}`);
                    errorMessage2.textContent = "Couldn't update your picture. Please try again.";
                }
            });
        })();

        // Handler for updating available rooms
        function updateAvailableRooms(availableRooms) {
            availableRoomsDiv.replaceChildren();

            // "N playing" pill next to the heading
            const onlineEl = document.getElementById('jrOnlineCount');
            const playing = (availableRooms || []).reduce((n, r) => n + (r.numClients || 0), 0);
            if (onlineEl) {
                onlineEl.textContent = `${playing} playing now`;
                onlineEl.hidden = playing === 0;
            }

            if (!availableRooms?.length) {
                const p = document.createElement('div');
                p.className = 'room-empty';
                p.textContent = 'No rooms available right now.';
                availableRoomsDiv.appendChild(p);
                return;
            }

            availableRooms.forEach(({ roomCode, numClients, usernames = [] }) => {
                const full = numClients >= 4;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.roomCode = roomCode;
                btn.disabled = full;
                btn.className = 'room-button room-card';

                const main = document.createElement('div');
                main.className = 'room-card-main';
                const title = document.createElement('div');
                title.className = 'room-card-title';
                title.textContent = `Room ${roomCode}`;
                const names = document.createElement('div');
                names.className = 'room-card-names' + (usernames.length ? '' : ' is-empty');
                names.textContent = usernames.length ? usernames.join(', ') : 'Empty: be the first to sit down';
                main.append(title, names);

                // one dot per seat
                const dots = document.createElement('div');
                dots.className = 'seat-dots';
                dots.title = `${numClients} of 4 seats taken`;
                for (let i = 0; i < 4; i++) {
                    const d = document.createElement('span');
                    if (i < numClients) d.className = 'on';
                    dots.appendChild(d);
                }

                let end;
                if (full) {
                    end = document.createElement('span');
                    end.className = 'pill pill-red';
                    end.textContent = 'Full';
                } else {
                    end = document.createElement('span');
                    end.className = 'room-card-chevron';
                    end.textContent = '›';
                }

                btn.append(main, dots, end);
                availableRoomsDiv.appendChild(btn);
            });
        }
        
        // call once during setup
        addListenerRoomButton();

        // One-shot snapshot, then live pushes from server
        socket.emit('getAvailableRooms');
        socket.off('availableRooms', updateAvailableRooms);
        socket.on('availableRooms', updateAvailableRooms);

        function handleJoinRoomFor(btn) {
            clickSounds[2].play();

            if (isJoiningRoom) return; // guard
            isJoiningRoom = true;

            const roomCode = btn.dataset.roomCode;

            // Ask server to join
            socket.emit('joinRoom', { roomCode });

            // --- one-shot settle pattern ---
            let settled = false;
            const cleanup = () => {
                socket.off('availableRooms', updateAvailableRooms);
                socket.off('errorMessage', onError);
                socket.off('rejoin', onRejoin);   // in case .once didn't fire
                socket.off('joinedRoom', onJoined);   // in case .once didn't fire
                removeListenerRoomButton();
                isJoiningRoom = false;
            };

            const settle = (result) => {
                if (settled) return;
                settled = true;
                cleanup();

                // Hide the join menu exactly once
                setHiddenSafe(joinRoomMenu, true);

                resolve(result);
            };

            const onError = (message) => {
                if (settled) return;
                
                isJoiningRoom = false;
                // Show the error but keep menu visible so user can try again
                errorMessage2.innerText = message;
                errorMessage2.style.display = 'block';
                setHiddenSafe(joinRoomMenu, false);
            };

            const onRejoin = () => {
                //console.log("successfully rejoined");
                settle({ socket, roomCode, isRejoin: true });
            };

            const onJoined = () => {
                //console.log("Joined room successfully");
                settle({ socket, roomCode, isRejoin: false });
            };

            // Only one of these should win; the other is removed in cleanup().
            socket.once('rejoin', onRejoin);
            socket.once('joinedRoom', onJoined);

            // errors can happen multiple times across attempts, keep as .on but removed in cleanup()
            socket.on('errorMessage', onError);
        }
    });
}

async function spEndMenu(results) {
    const endMenu     = document.getElementById("endMenu");
    const continueBtn = document.getElementById("continueButton");
    const backBtn     = document.getElementById("backToJoinRoomButton2");
    const gameInfo     = document.getElementById("gameInfo");
    const sortSelect     = document.getElementById("sortSelect");

    let resolver;

    // --- hide in-game UI ---
    hideButton("play");
    hideButton("pass");
    hideButton("clear");
    setHiddenSafe(gameInfo, true);
    setHiddenSafe(sortSelect, true);

    for (let div of document.getElementsByClassName("playerInfo")) {
        setHiddenSafe(div, true);
    }

    // always rebuild resultsContainer so single-player can never rely on stale DOM
    const resultsContainer = endMenu.querySelector("#resultsContainer");
    if (!resultsContainer) {
        console.warn("[spEndMenu] #resultsContainer not found inside #endMenu");
    } else {
        resultsContainer.innerHTML = `
            <div class="results-head">
                <div class="menu-title">Results</div>
                <div class="menu-subtitle">Solo match vs AI</div>
            </div>
            <div id="endMenuSummary" class="results-note"></div>
            <div class="results-cols"><span>Player</span><span>Points</span></div>
            <ul id="endMenuLeaderboard" class="results-list"></ul>
        `;
    }

    const ul = document.getElementById("endMenuLeaderboard");
    const summary = document.getElementById("endMenuSummary");

    if (!ul) {
        console.warn("[spEndMenu] #endMenuLeaderboard not found (DOM rebuild failed?)");
    } else {
        ul.innerHTML = "";
    }

    const placeToPoints = (place) => (place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0);

    // Identify "me"
    const me =
        GameModule?.players?.find(p => p?.isClient) ||
        GameModule?.players?.[0] ||
        null;

    const playerName =
        currentProfileUsername ||
        me?.username ||
        me?.name ||
        "Player";

    // results = array of clientIds in finishing order
    const finishOrderIds = Array.isArray(results) ? results : [];

    // map clientId -> Player object (finishing order)
    let finishOrderPlayers = finishOrderIds
        .map(cid => GameModule.players.find(p => String(p.clientId) === String(cid)))
        .filter(Boolean);

    // if only top 3 are returned, append the missing last player
    if (GameModule.players.length === 4 && finishOrderPlayers.length < 4) {
        const seen = new Set(finishOrderPlayers.map(p => String(p.clientId)));
        const missing = GameModule.players.find(p => !seen.has(String(p.clientId)));
        if (missing) finishOrderPlayers.push(missing);
    }

    // Ensure points exists
    for (const p of GameModule.players) {
        if (typeof p.points !== "number") p.points = 0;
    }

    // 1) Earned THIS GAME (by finishing order) + add into player.points
    const earnedByClientId = new Map(); // clientId -> earnedThisGame
    for (let i = 0; i < finishOrderPlayers.length; i++) {
        const p = finishOrderPlayers[i];
        const earned = placeToPoints(i + 1);
        earnedByClientId.set(String(p.clientId), earned);
        p.points += earned;
    }

    // 2) Build rows sorted by TOTAL points (desc), show +earnedThisGame
    const rows = GameModule.players.map(p => {
        const name = (p?.username || p?.name || `Player ${p?.clientId ?? "?"}`).toString();
        const earned = Number(earnedByClientId.get(String(p.clientId)) || 0);
        return { player: p, name, total: p.points, earned };
    });

    rows.sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;     // total desc
        if (b.earned !== a.earned) return b.earned - a.earned; // tie-break: earned desc
        return a.name.localeCompare(b.name);
    });

    // ---- match rules
    const TARGET_POINTS = 12;
    const WIN_BY = 2;

    // returns winner row or null
    function getMatchWinner(sortedRows) {
        if (!sortedRows || sortedRows.length === 0) return null;

        const leader = sortedRows[0];
        const runnerUp = sortedRows[1] || null;

        if (leader.total < TARGET_POINTS) return null;

        // if no runner up (shouldn't happen with 4 players), treat as win
        if (!runnerUp) return leader;

        const lead = leader.total - runnerUp.total;
        return lead >= WIN_BY ? leader : null;
    }

    const matchWinner = getMatchWinner(rows);

    // render
    if (ul) {
        for (let i = 0; i < rows.length; i++) {
        const { player: p, name, total, earned } = rows[i];

        const li = document.createElement("li");
        const isMe = me && p === me;
        li.className = "results-row" + (isMe ? " is-me" : "");

        const img = document.createElement("img");
        img.alt = "";
        img.className = "avatar avatar-sm";

        const nameEl = document.createElement("span");
        nameEl.className = "results-name";
        nameEl.textContent = name;
        if (isMe) {
            const you = document.createElement("span");
            you.className = "you-tag";
            you.textContent = "You";
            nameEl.appendChild(you);
        }

        const valueEl = document.createElement("span");
        valueEl.className = "results-value";
        valueEl.textContent = String(total);
        const earnedEl = document.createElement("span");
        earnedEl.className = "results-delta" + (earned > 0 ? " down" : "");
        earnedEl.textContent = `+${earned}`;
        valueEl.appendChild(earnedEl);

        li.append(makePlaceBadge(i + 1), img, nameEl, valueEl);

        img.src = `src/css/avatars/${p.avatar}`;
        img.onerror = () => {
            img.onerror = null;
            img.src = "src/css/avatars/player.png";
        };

        ul.appendChild(li);
        }
    }

    // summary for the human player
    let playerPlace = 0;
    if (me?.clientId != null) {
        playerPlace = finishOrderPlayers.findIndex(p => String(p.clientId) === String(me.clientId)) + 1;
    }
    if (playerPlace === 0) {
        playerPlace = finishOrderPlayers.findIndex(p => (p?.username || p?.name) === playerName) + 1;
    }

    const myEarned = (me?.clientId != null) ? Number(earnedByClientId.get(String(me.clientId)) || 0) : 0;
    const myTotal  = (typeof me?.points === "number") ? me.points : 0;

    if (summary) {
        const base =
            playerPlace > 0
            ? `You finished ${PLACE_LABELS[playerPlace - 1] ?? '#' + playerPlace}: +${myEarned} pts (total ${myTotal})`
            : `+${myEarned} pts (total ${myTotal})`;

        summary.replaceChildren();
        const line1 = document.createElement('div');
        line1.textContent = base;
        const line2 = document.createElement('div');
        if (matchWinner) {
            const strong = document.createElement('strong');
            strong.textContent = `Match over: ${matchWinner.name} wins!`;
            line2.appendChild(strong);
        } else {
            line2.textContent = `First to ${TARGET_POINTS} points (win by ${WIN_BY})`;
        }
        summary.append(line1, line2);
    }

    // --- buttons
    continueBtn.classList.remove('is-on');
    continueBtn.title = '';
    continueBtn.textContent = matchWinner ? "New match" : "Next game";
    backBtn.textContent = "Back to menu";

    const handleContinue = () => {
        clickSounds?.[0]?.play?.();
        cleanup();
        setHiddenSafe(endMenu, true);

        if (matchWinner) {
            // Reset points for a fresh match
            for (const p of GameModule.players) p.points = 0;
            resolver?.({ action: "newMatch", winnerClientId: matchWinner.player?.clientId });
        } else {
            resolver?.({ action: "continue" });
        }
    };


    const handleBack = () => {
        clickSounds?.[0]?.play?.();
        cleanup();
        setHiddenSafe(endMenu, true);

        // reset SP points when leaving SP
        for (const p of GameModule.players) p.points = 0;

        resolver?.({ action: "back" });
    };

    function cleanup() {
        continueBtn.removeEventListener("click", handleContinue);
        backBtn.removeEventListener("click", handleBack);
    }

    continueBtn.addEventListener("click", handleContinue);
    backBtn.addEventListener("click", handleBack);

    setHiddenSafe(endMenu, false);
    return new Promise((resolve) => { resolver = resolve; });
}


async function endMenu(socket, roomCode, results) {
    const endMenu   = document.getElementById("endMenu");
    const continueBtn = document.getElementById("continueButton");         
    const backBtn     = document.getElementById("backToJoinRoomButton2"); 

    let isReady = false;
    let resolver;

    // hide play/pass/gameInfo/playerInfo
    hideButton("play");
    hideButton("pass");
    hideButton("clear");
    setHiddenSafe(gameInfo, true);

    for (let div of document.getElementsByClassName("playerInfo")) {
        setHiddenSafe(div, true);
    }

    // Results: finishing order with each player's average finish (and how this game moved it)
    const resultsContainer = endMenu.querySelector("#resultsContainer");
    resultsContainer.innerHTML = `
        <div class="results-head">
            <div class="menu-title">Game results</div>
            <div class="menu-subtitle">Average finish after this game: lower is better</div>
        </div>
        <div class="results-cols"><span>Player</span><span>Avg finish</span></div>
        <ul id="resultsList" class="results-list"></ul>
    `;

    const ul = resultsContainer.querySelector("#resultsList");
    const preMap = getPreGameAvgMap(); // { [pbId]: avg_before }
    const myName = pb?.authStore?.model?.name || '';

    backBtn.textContent = 'Leave';
    continueBtn.classList.remove('is-on');

    // populate endMenu results container
    for (let i = 0; i < results.length; i++) {
        const name = results[i];
        const place = i + 1;

        // try PB avatar, and also capture pbId for stats
        let avatar = "src/css/avatars/avatar-placeholder.png";
        let pbId = null;
        try {
        const user = await getUserByName(name);
        if (user?.id) {
            pbId = user.id;
            if (user.avatar) avatar = pbAvatarUrl(user.id, user.avatar, "100x100");
        }
        } catch (_) {}

        let pointsHtml = '—'; // will become avg + (delta)
        try {
            const latest = await fetchPlayerStatsByUserId(pb, pbId);
            const avgNow = Number(latest?.avg_finish ?? NaN);
            if (Number.isFinite(avgNow)) {
                const avgBefore = Number(preMap[pbId] ?? NaN);
                if (Number.isFinite(avgBefore)) {
                const delta = avgNow - avgBefore;
                const sgn = delta >= 0 ? '+' : '';
                // a higher average finish is worse, so up = red, down = green
                const dir = delta > 0.0005 ? 'up' : delta < -0.0005 ? 'down' : '';
                pointsHtml = `${avgNow.toFixed(3)}<span class="results-delta ${dir}">${sgn}${delta.toFixed(3)}</span>`;
                } else {
                // no snapshot → just show current
                pointsHtml = `${avgNow.toFixed(3)}`;
                }
            }
        } catch (e) {
        console.warn('avg render failed for', name, pbId, e);
        }

        const li = document.createElement("li");
        li.className = "results-row" + (name && name === myName ? " is-me" : "");

        const img = document.createElement("img");
        img.src = avatar;
        img.alt = "";
        img.className = "avatar avatar-sm";

        const nameEl = document.createElement("span");
        nameEl.className = "results-name";
        nameEl.textContent = name ?? "—";
        if (name && name === myName) {
            const you = document.createElement("span");
            you.className = "you-tag";
            you.textContent = "You";
            nameEl.appendChild(you);
        }

        const valueEl = document.createElement("span");
        valueEl.className = "results-value";
        valueEl.innerHTML = pointsHtml; // numeric HTML we generate

        li.append(makePlaceBadge(place), img, nameEl, valueEl);

        ul.appendChild(li);
    }

    setHiddenSafe(endMenu, false);

    // label helper
    const setContinueLabel = (count) => {
        continueBtn.classList.toggle('is-on', isReady);
        continueBtn.textContent = isReady
        ? `✓ Ready (${count}/4)`
        : `Play again (${count}/4)`;
        continueBtn.title = isReady ? 'Tap again to cancel' : '';
    };

    // toggle my ready state; server will rebroadcast counts
    const toggleReadyState = () => {
        isReady = !isReady; // optimistic local toggle
        socket.emit('toggleReadyState', roomCode, isReady);
    };

    // leave to join room
    const handleBackClick = () => {
        clickSounds[0].play();
        // Clear chat messages only — wiping the whole #chatBox would also
        // delete the input/send button elements that lobbyMenu() relies on.
        const messageContainerEl = document.getElementById('messageContainer');
        if (messageContainerEl) messageContainerEl.innerHTML = '';
        socket.emit('leaveRoom', roomCode);
        cleanup();
        setHiddenSafe(endMenu, true);
        resolver && resolver('goBackToJoinRoomMenu');
    };

    // update counts/label from server
    const onUpdateReadyState = (clientList) => {
        const readyPlayersCount = clientList.filter(c => c.isReady).length;
        const me = clientList.find(c =>
            c.clientId === socket.id || c.id === socket.id || c.socketId === socket.id
        );
        const myReadyNow = !!me?.isReady;

        if (prevMyReady !== null && myReadyNow !== prevMyReady) {
            (myReadyNow ? sfxReadyOn : sfxReadyOff).play();
        }
        prevMyReady = myReadyNow;
    
        setContinueLabel(readyPlayersCount);
    };

    // game started → clean up and resolve
    const onGameStarted = () => {
        cleanup();
        setHiddenSafe(endMenu, true);
        resolver && resolver("continue");
    };

    // cleanup all listeners bound in endMenu
    function cleanup() {
        continueBtn.removeEventListener("click", toggleReadyState);
        backBtn.removeEventListener("click", handleBackClick);
        socket.off('updateReadyState', onUpdateReadyState);
        socket.off('gameStarted', onGameStarted);
    }

    // wire up
    continueBtn.addEventListener("click", toggleReadyState);
    backBtn.addEventListener("click", handleBackClick);
    socket.on('updateReadyState', onUpdateReadyState);
    socket.once('gameStarted', onGameStarted);

    // initial label until first update arrives
    setContinueLabel(0);

    // resolve on start/leave
    return new Promise((resolve) => { resolver = resolve; });
}


// Handles the lobbyMenu, which allows players in the same room to chat and ready up for the game, once all players are ready it will resolve socket
async function lobbyMenu(socket, roomCode){
    const lobbyMenu = document.getElementById("lobbyMenu");
    const connectedClientsDiv = document.getElementById("connectedClients");
    const lobbyHeadingEl = document.getElementById('lobbyHeading');
    const messageContainer = document.getElementById("messageContainer");
    const messageInput = document.getElementById("messageInput");
    const sendMessageButton = document.getElementById("sendMessageButton");
    const readyButton = document.getElementById("readyButton");
    const backToJoinRoomButton = document.getElementById("backToJoinRoomButton");

    let isReady = false; // Track the local client's ready state

    lobbyHeadingEl.textContent = 'Room ' + roomCode;
    const lobbySubEl = document.getElementById('lobbySubheading');
    if (lobbySubEl) lobbySubEl.textContent = 'Waiting for players…';
    readyButton.classList.remove('is-on');
    readyButton.textContent = 'Ready up (0/4)';

    // Display lobbyMenu
    setHiddenSafe(lobbyMenu, false);
    
    // Four seats, always: taken seats show avatar + ready state, the rest are open
    function updateClientList(clientList = []) {
        connectedClientsDiv.replaceChildren();

        const myId = pb?.authStore?.model?.id;

        for (let i = 0; i < 4; i++) {
            const c = clientList[i];
            const seat = document.createElement('div');

            if (!c) {
                seat.className = 'seat is-open';
                const icon = document.createElement('div');
                icon.className = 'seat-open-icon';
                icon.textContent = '+';
                const name = document.createElement('div');
                name.className = 'seat-name';
                name.textContent = 'Open seat';
                seat.append(icon, name);
                connectedClientsDiv.appendChild(seat);
                continue;
            }

            seat.className = 'seat' + (c.isReady ? ' is-ready' : '');

            // If this entry is ME, prefer my freshly-synced authStore record
            const isMe = (c.pbId && myId && String(c.pbId) === String(myId));
            const freshAvatarFile = isMe ? pb.authStore.model.avatar : c.avatar;

            const img = document.createElement('img');
            const url1x = pbAvatarUrl(c.pbId, freshAvatarFile, '100x100');
            const url2x = pbAvatarUrl(c.pbId, freshAvatarFile, '200x200');
            if (url1x) {
                img.src = url1x;
                img.srcset = `${url1x} 1x, ${url2x} 2x`;
                img.sizes = '52px';
            } else {
                img.src = 'src/css/avatars/avatar-placeholder.png';
            }
            img.alt = '';
            img.className = 'avatar';

            const name = document.createElement('div');
            name.className = 'seat-name';
            name.textContent = c.username;
            name.title = c.username;

            const badge = document.createElement('span');
            badge.className = c.isReady ? 'pill pill-green' : 'pill';
            badge.textContent = c.isReady ? '✓ Ready' : 'Not ready';

            seat.append(img, name, badge);
            connectedClientsDiv.appendChild(seat);
        }
    }


    // Function to append a message to the message container
    function appendMessage(message) {
        const myName = pb?.authStore?.model?.name || pb?.authStore?.model?.username || '';

        // Messages arrive as "Username: text" — split so we can style sender vs. text
        const separatorIndex = message.indexOf(':');
        const hasSender = separatorIndex > -1;
        const sender = hasSender ? message.slice(0, separatorIndex).trim() : '';
        const text = hasSender ? message.slice(separatorIndex + 1).trim() : message;
        const isMine = hasSender && myName && sender === myName;

        const row = document.createElement('div');
        row.className = `chat-row ${isMine ? 'chat-row--mine' : 'chat-row--theirs'}`;

        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${isMine ? 'chat-bubble--mine' : 'chat-bubble--theirs'}`;

        if (hasSender && !isMine) {
            const senderEl = document.createElement('div');
            senderEl.className = 'chat-sender';
            senderEl.textContent = sender;
            bubble.appendChild(senderEl);
        }

        const textEl = document.createElement('div');
        textEl.className = 'chat-text';
        textEl.textContent = text;
        bubble.appendChild(textEl);

        row.appendChild(bubble);
        messageContainer.appendChild(row);
        messageContainer.scrollTop = messageContainer.scrollHeight; // Auto scroll to the bottom
    }

    // Clears all chat messages from the message container
    function clearMessages() {
        messageContainer.innerHTML = '';
    }

    // Function to send a message
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message === '') {
            return; // Do not send empty messages
        }

        if (message.length > 100) {
            alert("Message is too long!");
            return;
        }

        // Send the message to the server
        socket.emit('sendMessage', roomCode, message);
        messageInput.value = ''; // Clear the input field
        sendMessageButton.disabled = true; // Disable the button until there's input again
    }

    // Event listener for pressing Enter key in the message input
    function handleEnterKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent the default action (form submission, etc.)
            sendMessage();
        }
    }

    // Event listener for send message button, have to remove this event listener as well
    sendMessageButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', handleEnterKey);

    // Enable send button only if there's input
    messageInput.addEventListener('input', () => {
        sendMessageButton.disabled = messageInput.value.trim() === '';
    });

    // Listener for receiving messages
    socket.on('receiveMessage', (message) => {
        appendMessage(message);
    });

    //If the client is readied up the text content of the button should change to ('unready up 1/4' and then if the client clicks the button again the button should read 'ready up 0/4')
    function toggleReadyState() {
        isReady = !isReady;
        socket.emit('toggleReadyState',roomCode, isReady);
    }

    readyButton.addEventListener("click", toggleReadyState);

    return new Promise((resolve) => {
        socket.on('updateReadyState', (clientList) => {
            // no polling; roster is driven by server pushes:
            // joinRoom/leaveRoom/toggleReadyState all trigger `updateReadyState`
            // we’ll render the player list inside that handler
            updateClientList(clientList);

            // figure out *your* current ready state from the list
            const me = clientList.find(c =>
                c.clientId === socket.id || c.id === socket.id || c.socketId === socket.id
            );
            const myReadyNow = !!me?.isReady;

            // play sound only when *your* state flips
            if (prevMyReady !== null && myReadyNow !== prevMyReady) {
            (myReadyNow ? sfxReadyOn : sfxReadyOff).play();
                // If iOS/Safari ever blocks, resume once on a user gesture elsewhere:
                // if (Howler.ctx?.state === 'suspended') Howler.ctx.resume();
            }
            prevMyReady = myReadyNow;


            // update counts + label
            const readyPlayersCount = clientList.filter(c => c.isReady).length;
            readyButton.classList.toggle('is-on', myReadyNow);
            readyButton.title = myReadyNow ? 'Tap again to cancel' : '';
            readyButton.textContent = myReadyNow
                ? `✓ Ready (${readyPlayersCount}/4)`
                : `Ready up (${readyPlayersCount}/4)`;

            // status line under the room name
            if (lobbySubEl) {
                const n = clientList.length;
                lobbySubEl.textContent =
                    n < 4 ? `${n}/4 players · waiting for ${4 - n} more`
                    : readyPlayersCount === 4 ? 'Everyone is ready. Starting…'
                    : `${readyPlayersCount}/4 ready · the game starts when everyone is ready`;
            }
            
        });

        // Client performs clean up and resolves socket when host starts the game
        socket.on('gameStarted', () => {
            //remove all event listeners and sockets
            readyButton.removeEventListener("click", toggleReadyState);
            sendMessageButton.removeEventListener('click', sendMessage);
            messageInput.removeEventListener('keydown', handleEnterKey);
            backToJoinRoomButton.removeEventListener('click', handleBackClick); 

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('gameStarted');

            // Clear chat so old messages don't carry into the next lobby visit
            clearMessages();

            // Hide the lobby menu and clear the interval
            setHiddenSafe(lobbyMenu, true);

            resolve(socket);
        });

        // Handles clean up and resolves the promise when backToJoinRoomButton is clicked
        backToJoinRoomButton.addEventListener('click', handleBackClick);

        // Function to handle clean up of event listeners and sockets
        function handleBackClick() {
            // Emit leave room event, will return updated clientList event
            socket.emit('leaveRoom', roomCode);
            clickSounds[0].play();

            readyButton.removeEventListener("click", toggleReadyState);
            sendMessageButton.removeEventListener('click', sendMessage);
            messageInput.removeEventListener('keydown', handleEnterKey);
            backToJoinRoomButton.removeEventListener('click', handleBackClick);

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('gameStarted');

            // Clear chat so old messages don't carry into the next lobby visit
            clearMessages();

            // Hide the lobby menu and clear the interval
            setHiddenSafe(lobbyMenu, true);

            resolve('goBackToJoinRoomMenu');
        }
    });
}

function renderSinglePlayerInfo(el, player, i) {
    if (!el) return;

    setHiddenSafe(el, false);

    // container
    el.style.display = 'flex';
    el.style.flexDirection = 'column'; // stack vertically
    el.style.alignItems = 'center';
    el.style.gap = '0.2rem';
    el.style.borderRadius = '0.5rem';
    el.style.padding = '0.25rem 0.35rem';
    
    // glass effect — white, still transparent
    el.style.background = 'rgba(255,255,255,0.6)'; // white but translucent
    el.style.backdropFilter = 'blur(10px)';
    el.style.webkitBackdropFilter = 'blur(10px)';

    // subtle definition
    el.style.border = '1px solid rgba(255,255,255,0.45)';
    el.style.boxShadow =
        '0 4px 10px rgba(0,0,0,0.08), ' +
        'inset 0 1px 0 rgba(255,255,255,0.65)';

    el.style.width = 'fit-content';
    el.style.minWidth = '0';
    el.style.justifyContent = 'center';

    // reset content
    el.textContent = '';

    // avatar
    const img = document.createElement('img');

    const fallback = `avatars/avatar-placeholder.png`;

    const localAvatarPath = player?.avatar
        ? `src/css/avatars/${player.avatar}`
        : fallback;

    img.src = localAvatarPath;

    img.onerror = () => {
        img.onerror = null;
        img.src = fallback;
    };

    img.className = 'w-12 h-12 object-cover border border-gray-300 rounded-md box-border';
    img.style.aspectRatio = '1 / 1';
    img.style.flexShrink = '0';
    img.alt = player.username || `Player ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // name (under avatar)
    const name = document.createElement('div');
    name.className = 'font-medium text-gray-800';
    name.textContent = player.username || `Player ${i + 1}`;
    name.style.whiteSpace = 'nowrap';
    name.style.fontSize = '0.5rem';
    name.style.lineHeight = '1';
    name.style.textAlign = 'center';
    

    // assemble
    el.append(img, name);
}


function renderPlayerInfo(el, player, i) {
    if (!el) return;

    setHiddenSafe(el, false); // ✅ IMPORTANT: undo removeAllGameElements() hiding

    // container
    el.style.display = 'flex';
    el.style.flexDirection = 'column'; // stack vertically
    el.style.alignItems = 'center';
    el.style.gap = '0.2rem';
    el.style.borderRadius = '0.5rem';
    el.style.padding = '0.25rem 0.35rem';
    
    // glass effect — white, still transparent
    el.style.background = 'rgba(255,255,255,0.6)'; // white but translucent
    el.style.backdropFilter = 'blur(10px)';
    el.style.webkitBackdropFilter = 'blur(10px)';

    // subtle definition
    el.style.border = '1px solid rgba(255,255,255,0.45)';
    el.style.boxShadow =
        '0 4px 10px rgba(0,0,0,0.08), ' +
        'inset 0 1px 0 rgba(255,255,255,0.65)';

    el.style.width = 'fit-content';
    el.style.minWidth = '0';
    el.style.justifyContent = 'center';

    // reset content
    el.textContent = '';

    // avatar
    const img = document.createElement('img');
    const url1x = pbAvatarUrl(player.pbId, player.avatar, '100x100');
    const url2x = pbAvatarUrl(player.pbId, player.avatar, '200x200');
    const fallback = `/avatars/default${i + 1}.png`;
    if (url1x) {
        img.src = url1x;
        img.srcset = `${url1x} 1x, ${url2x} 2x`;
        img.sizes = '32px';
    } else {
        img.src = fallback;
    }
    img.className = 'w-12 h-12 object-cover border border-gray-300 rounded-md box-border';
    img.style.aspectRatio = '1 / 1';
    img.style.flexShrink = '0';
    img.alt = player.username || `Player ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // name (under avatar)
    const name = document.createElement('div');
    name.className = 'font-medium text-gray-800';
    name.textContent = player.username || `Player ${i + 1}`;
    name.style.whiteSpace = 'nowrap';
    name.style.fontSize = '0.5rem';
    name.style.lineHeight = '1';
    name.style.textAlign = 'center';

    // assemble
    el.append(img, name);
}

async function fetchPlayerStatsByUserId(pb, userId) {
    if (!userId) return null;
    try {
        return await pb.collection('player_stats').getFirstListItem(`user.id="${userId}"`);
    } catch { return null; }
}

async function cachePreGameAvgsForRoom(pb, players) {
    // players: array with .pbId populated from playersSnapshot
    const entries = await Promise.all(players.map(async (p) => {
        const s = await fetchPlayerStatsByUserId(pb, p.pbId);
        return [p.pbId, Number(s?.avg_finish ?? 0)];
    }));
    const map = Object.fromEntries(entries); // { [pbId]: avg_before }
    sessionStorage.setItem('preGameAvgMap', JSON.stringify(map));
    return map;
}

function getPreGameAvgMap() {
    try { return JSON.parse(sessionStorage.getItem('preGameAvgMap') || '{}'); }
    catch { return {}; }
}


async function spLoop(spContinue) {
    // unhide buttons and gameInfo divs
    const gameInfo = document.getElementById("gameInfo");
    const sortSelect = document.getElementById("sortSelect");
    const playerInfo = document.getElementsByClassName("playerInfo");

    // make sure gameInfo starts blank/neutral
    if (gameInfo) {
        gameInfo.textContent = '—';
    }

    // unhide buttons and game elements using a consistent hide/show system
    showButton("play");
    showButton("pass");
    showButton("clear");
    //setHiddenSafe(gameInfo, false);
    setHiddenSafe(sortSelect, false);

    // show names here 
    for (let i = 0; i < playerInfo.length; i++) {
        setHiddenSafe(playerInfo[i], false);
    }

    // single-player opponent ai name pool
    const namePool = [
        'Jason',
        'Ivan',
        'Kulin',
        'Wong',
        'Josh',
    ];

    // if its the first time spLoop, generate bot and player info
    if(!spContinue) {
        // shuffle & take 3 unique names
        const shuffledNames = [...namePool].sort(() => Math.random() - 0.5);
        const botNames = shuffledNames.slice(0, 3);

        const bots = botNames.map((name, i) => {
            const bot = new spOpponent();
            bot.username = name;
            bot.clientId = `sp-${i + 1}`;
            bot.socketId = `sp-${i + 1}`; // keeps existing code happy
            bot.isSinglePlayer = true;
            bot.avatar = `${name.toLowerCase().trim()}.png`;
            return bot;
        });

        GameModule.players[0].username = 'Player';
        GameModule.players[0].clientId = 'sp-0';
        GameModule.players[0].socketId = 'sp-0';
        GameModule.players[0].avatar   = 'player.png';

        // replace GameModule opponents with singlePlayerOpponents
        GameModule.players.splice(1, 3, ...bots);

        await ensureSpPolicyLoaded(); // make sure that tensorflow ppo policy has been loaded
    }

    // if continuing new game, just continue with the loop
    // Update UI labels
    for (let i = 0; i < playerInfo.length; i++) {
        const p = GameModule.players[i];
        renderSinglePlayerInfo(playerInfo[i], p, i);
    }

    resetHenryObsMemory();

    // create deck, shuffle, and deal animation, returns client id of player with 3 of diamonds when all animations are complete
    const firstTurnClientId = await dealSinglePlayerCards();

    // main single player game loop, return results array
    const results = await spGameLoop(firstTurnClientId);
    
    //console.log(results);
    return results;
}


// once all four clients toggle toggleReadyState, call startGameForRoom function on server and update local gamestate to match server generated one 
async function startGame(socket, roomCode){
    //unhide buttons and gameInfo divs
    const gameInfo = document.getElementById("gameInfo");
    const playerInfo = document.getElementsByClassName("playerInfo");
    const sortSelect = document.getElementById("sortSelect");
    let firstDealClientId;

    // make sure gameInfo starts blank/neutral
    if (gameInfo) {
        gameInfo.textContent = '—';
    }
    
    // show buttons
    showButton("play");
    showButton("pass");
    showButton("clear");
    //setHiddenSafe(gameInfo, false);
    setHiddenSafe(sortSelect, false);

    // Remove any existing event listeners for these events to avoid multiple listeners
    socket.off('clientSocketId');      //  not used by server, but safe to clear
    socket.off('initialGameState');    //  not used by server, but safe to clear
    socket.off('dealHand');           
    socket.off('visualDealDeck');      // avoid dupes on hot-reload

    // defensively guard against accidental re-entry (optional)
    if (startGame._busy) {
        console.warn('startGame already running; ignoring duplicate call.');
        return;
    }
    startGame._busy = true;

    try {
        // set my socket id directly (server doesn't emit clientSocketId)
        GameModule.players[0].socketId = socket.id;

        // show names here from prior lobby state
        for (let i = 0; i < playerInfo.length; i++) {
            setHiddenSafe(playerInfo[i], false);
        }

        // wait for playersSnapshot (replacement for initialGameState)
        const playersSnapshotPromise = new Promise(resolve => {
            socket.once('playersSnapshot', ({ players, isFirstMove }) => {
                // set isFirstMove to true
                GameModule.isFirstMove = isFirstMove;
                // Using unique socket id, assign the appropriate index
                const localPlayerIndex = players.findIndex(p => p.socketId === GameModule.players[0].socketId);
                //console.log("LOCAL PLAYER INDEX:", localPlayerIndex);

                if (localPlayerIndex !== -1) {
                    // Rotate server order so local player is index 0 in GameModule
                    players.forEach((p, index) => {
                        const gameModuleIndex = (index - localPlayerIndex + 4) % 4; // Calculate GameModule index
                        const gp = GameModule.players[gameModuleIndex];
                        gp.username = p.username;
                        gp.clientId = p.clientId;
                        gp.socketId = p.socketId;
                        gp.pbId     = p.pbId || null;
                        gp.avatar   = p.avatar || null;
                    });
                }

                //console.log()

                // Update UI labels
                for (let i = 0; i < playerInfo.length; i++) {
                    const p = GameModule.players[i];
                    renderPlayerInfo(playerInfo[i], p, i);
                }

                cachePreGameAvgsForRoom(pb, GameModule.players).catch(e =>
                    console.warn('Failed to cache pre-game avgs for room:', e)
                );
                resolve();
            });
        });

        // Ask server who has first turn (3♦) and await the reply
        const firstTurnPromise  = new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('firstTurnClientId timeout')), 8000);
            socket.once('firstTurnClientId', (clientId) => {
                clearTimeout(t);
                resolve(clientId);
            });
        });

        // Wait for the server-provided 52-card "visual" deck for THIS client.
        // We fully finish the dealing animation BEFORE starting gameLoop (prevents races).
        const visualDealPromise = new Promise((resolve, reject) => {
            // Optional safety timeout so we don't hang forever if nothing arrives
            const t = setTimeout(() => {
                console.warn('Timed out waiting for visualDealDeck. Check server start flow.');
                reject(new Error('visualDealDeck timeout'));
            }, 15000); // 15s guard; adjust if you like

            socket.once('visualDealDeck', async ({ cards, dealStartSeat }) => {
                clearTimeout(t);
                try {
                    // light validation avoids weird payloads breaking your animation
                    if (!Array.isArray(cards) || cards.length !== 52) {
                        console.warn('visualDealDeck payload invalid. Expected 52 items.');
                        return reject(new Error('Bad visualDealDeck payload'));
                    }

                    firstDealClientId = dealStartSeat;

                    let reversedServerDeck = cards.reverse();

                    // run your existing dealing animation using the server-specified order
                    await dealCards(reversedServerDeck, socket, roomCode, firstDealClientId);

                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });

        // listeners are now attached, tell server we’re ready to receive
        socket.emit('readyForStart', roomCode);
        //console.log("emitted readyForStart");

        // wait for data to flow in
        await playersSnapshotPromise;
        const firstTurnClientId = await firstTurnPromise;
        await visualDealPromise;

        // Main game loop, returns array of usernames in finishing order
        // before calling gameLoop
        gmCancelToken('startGame');
        gmNewToken('startGame');
        const results = await gameLoop(roomCode, socket, firstTurnClientId, false);
        
        //console.log(results);
        return results;

    } finally {
        // NEW: cleanup (mostly no-op because we used .once, but safe on hot-reloads)
        socket.off('clientSocketId');
        socket.off('initialGameState');
        socket.off('dealHand');
        socket.off('visualDealDeck');

        // allow re-entry for the next game
        startGame._busy = false;
    }
}

// 1) Optional: clean up library-level objects (if you keep references)
function cleanupDeckObjects() {
    try {
        // - A deck on your GameModule:
        if (window.GameModule?.deck?.cards) {
            window.GameModule.deck.cards.forEach(c => c.unmount?.());
            window.GameModule.deck.cards.length = 0;
        }

        // - Any requestAnimationFrame / timeouts you saved:
        if (window._animFrameId) {
            cancelAnimationFrame(window._animFrameId);
            window._animFrameId = null;
        }
        if (window._dealTimeoutId) {
            clearTimeout(window._dealTimeoutId);
            window._dealTimeoutId = null;
        }
    } catch (e) {
        console.warn('cleanupDeckObjects() warning:', e);
    }
}

// 2) DOM: remove all .card nodes from every relevant container
function unmountAllCardsDOM() {
    const roots = [
        '0','1','2','3',          // seat containers
        'gameDeck',               // table pile
        'finishedDeck',           // finished pile
        'gameContainer'           // top-level game area (if you have it)
    ]
    .map(id => document.getElementById(id))
    .filter(Boolean);

    // remove just the cards (keeps labels/frames if you want to keep them)
    roots.forEach(root => {
        root.querySelectorAll('.card').forEach(cardEl => {
        // If you attached listeners directly to cardEl, this is enough:
        cardEl.remove();
        // (If you’re paranoid about lingering listeners, you could do:
        // const clone = cardEl.cloneNode(false); cardEl.replaceWith(clone); clone.remove();
        // but `.remove()` already detaches them with the node.)
        });
    });
}

// Call both as part of your nuke:
function unmountAllCards() {
    cleanupDeckObjects();
    unmountAllCardsDOM();
}

function setMessage(el, msg = '') {
    if (!el) return;
    const text = (msg ?? '').toString();
    el.textContent = text;
    setHiddenSafe(el, !text); // hide when empty
}

function setHiddenSafe(el, hidden) {
    if (!el) return;

    // If we're hiding and focus is inside, clear it first
    const active = document.activeElement;
    if (hidden && active && (el === active || el.contains(active))) {
        active.blur();
    }

    el.hidden = hidden;
}

function hideButton(id) {
    setHiddenSafe(document.getElementById(id), true);
}

function showButton(id) {
    setHiddenSafe(document.getElementById(id), false);
}

function removeAllGameElements() {
    const gameInfo = document.getElementById("gameInfo");
    const sortSelect = document.getElementById("sortSelect");

    // 0) Cards are dynamic → nuke them from the DOM
    unmountAllCards();

    // just hide buttons, listener clean up is handled in player.js
    hideButton('play');
    hideButton('pass');
    hideButton('clear');
    setHiddenSafe(gameInfo, true);
    setHiddenSafe(sortSelect, true);

    // 2) Game info HUD → hide + CLEAR TEXT
    const gi = document.getElementById('gameInfo');
    if (gi) { 
        gi.textContent = '';        // ensure no stale text
    }

    // 3) Player panels → hide & clear any turn styling
    const panels = document.getElementsByClassName('playerInfo');
    for (let i = 0; i < panels.length; i++) {
        setHiddenSafe(panels[i], true);
        panels[i].style.border = 'none';
        // panels[i].textContent = ''; // optional: if you also want to clear labels
    }

    // 4) Make sure pause overlay isn’t left on
    const overlay = document.getElementById('pauseOverlay');
    if (overlay) overlay.classList.add('pause-hidden');
    document.body.classList.remove('is-paused');
    const pauseCnt = document.getElementById('pauseCountdown');
    if (pauseCnt) pauseCnt.textContent = '';
    const pauseMsg = document.getElementById('pauseMsg');
    if (pauseMsg) pauseMsg.textContent = 'Game paused';
}


// build Deck.js Card objects from rank,suit
function buildCardsFromArray(cardsArr) {
    return cardsArr.map((c, idx) => {
        const card = Deck.Card(idx);        // create a card
        card.rank = c.rank;
        card.suit = c.suit;
        card.setRankSuit(c.rank, c.suit);   // refresh CSS face
        return card;
    });
}

// GC to local helper (explicitly to gameDeck)
function gcToGameDeck(xGC, yGC) {
    const gc = document.getElementById('gameContainer');
    const gd = document.getElementById('gameDeck');
    const gr = gc.getBoundingClientRect();
    const dr = gd.getBoundingClientRect();
    // translate GC space to gameDeck's local space
    return { x: xGC - (dr.left - gr.left), y: yGC - (dr.top - gr.top) };
}

function centerXY(x, y, cardEl) {
  const w = cardEl?.offsetWidth  || 0;
  const h = cardEl?.offsetHeight || 0;
  return { x: x - w / 2, y: y - h / 2 };
}

// mount cards into gameDeck using the SAME pose function as dealing
function mountCardsInGC(cards, seatIdx, faceUp = false) {
    const gameDeck = document.getElementById('gameDeck');

    const total = cards.length;
    const mid   = (total - 1) / 2;

    // (DEAL_ANCHORS are percents; poseBySeat returns GC pixel coords + rot)
    const poseBySeat = buildGCPosesFromPercents(DEAL_ANCHORS);
    const STRIDE     = 10 * (GameModule.players?.length || 4); // same as dealing
    const SEAT_BASE  = [0, 10, 20, 30];                        // same as dealing

    cards.forEach((card, i) => {
        // Deck.js needs the element in the DOM before animateTo
        if (card.$el.parentElement !== gameDeck) gameDeck.appendChild(card.$el);

        // offset index along the seat’s “rail” — identical to dealCards
        const off = SEAT_BASE[seatIdx] + (i - mid) * STRIDE;

        // pose in GC space (pixels), e.g. { x, y, rot }
        const { x: xGC, y: yGC, rot } = poseBySeat[seatIdx](off);

        // convert GC → gameDeck local space
        const { x, y } = gcToGameDeck(xGC, yGC);
        const pos = centerXY(x, y, card.$el);

        card.setSide(faceUp ? 'front' : 'back');
        card.animateTo({
            delay: 0,
            duration: 0,
            ease: 'linear',
            rot,
            x: pos.x,
            y: pos.y,
            z: i + 1 
        });

        // keep your local state in sync
        if (GameModule.players?.[seatIdx]) GameModule.players[seatIdx].addCard?.(card);
    });
}

function detachGameEvents(socket) {
    // Everything that can be attached during a turn or round clear
    const EVTS = [
        // per-turn
        'cardsPlayed',
        'passedTurn',
        'wonRound',
        'allHandAckComplete',

        // sorting / animations
        'sortAfterTurnComplete',
        'sortHandsComplete',
        'finishDeckAnimationComplete',
        'finishGameAnimationComplete',

        // end-of-game signals that might linger
        'gameHasFinished',
        'playerFinished',
    ];

    EVTS.forEach(evt => {
        socket.off?.(evt);                 // v4+ friendly
        socket.removeAllListeners?.(evt);  // belt & braces
    });
}

// display pause/disconnect screen when a client disconnects
function setupPauseModal(socket, roomCode){
    const overlay   = document.getElementById('pauseOverlay');
    const msg       = document.getElementById('pauseMsg');
    const countdown = document.getElementById('pauseCountdown');
    const listEl    = document.getElementById('pauseClientList');

    let tick = null;
    let lastClientList = [];

    // Scoped handlers so we can remove exactly ours later
    const onUpdateReadyStatePause = (clientList=[]) => {
    lastClientList = clientList;
    paintClientList(lastClientList);
    };
    socket.on('updateReadyState', onUpdateReadyStatePause);

    function paintClientList(clients){
        listEl.textContent = ""; // clear
        clients.forEach(c => {
            const li = document.createElement("li");
            li.className = "pause-pill";
            li.textContent = c.username + (c.isReady ? " ✅" : "");
            listEl.appendChild(li);
        });
    }

    const cleanupPauseBindings = () => {
        clearInterval(tick);
        socket.off?.('clientList', onClientListOnceOrStream);
        socket.off?.('updateReadyState', onUpdateReadyStatePause);
    };

    const onClientListOnceOrStream = (clients=[]) => {
        lastClientList = clients;
        paintClientList(lastClientList);
    };
        
    // when room is paused (caused by disconnect)
    const onRoomPaused = async ({ reason, pausedUntil, disconnectedUsernames }) => {
        gmCancelToken('room:paused');
        await Promise.resolve();           // let any awaits wake and exit
        detachGameEvents(socket); // remove all sockets from gameLoop
        GameModule.reset(); // reset gamestate and hide all game elements
        removeAllGameElements();
        // Message
        const who = (Array.isArray(disconnectedUsernames) && disconnectedUsernames.length ? disconnectedUsernames.join(', ') : (reason?.name || 'player'));
        msg.textContent = `Waiting for ${who} to reconnect…`;

        // Show overlay & lock scroll
        overlay.classList.remove('pause-hidden');
        document.body.classList.add('is-paused');

        socket.emit('getClientList', roomCode);
        socket.off?.('clientList', onClientListOnceOrStream);
        socket.on('clientList', onClientListOnceOrStream);

        // Rejoin countdown
        clearInterval(tick);
        const deadline = typeof pausedUntil === 'number' ? pausedUntil : Date.now() + 30000;
        const step = () => {
        const ms = Math.max(0, deadline - Date.now());
        countdown.textContent = ms ? `Auto action in ${Math.ceil(ms/1000)}s` : '…';
        if (!ms) clearInterval(tick);
        };
        step();
        tick = setInterval(step, 250);
    };

    // Make sure we don't double-bind our own pause handlers on reentry
    socket.off?.('room:paused', onRoomPaused);
    socket.on('room:paused', onRoomPaused);

    const onRoomResumed = async ({ players, turnClientId, finishedDeck, gameDeck, hand, me, isFirstMove, lastValidHand }) => {
        // remove pause menu
        overlay.classList.add('pause-hidden');
        document.body.classList.remove('is-paused');
        cleanupPauseBindings(); // clears tick + listeners

        //unhide buttons and gameInfo divs
        const gameInfo = document.getElementById("gameInfo");
        const playerInfo = document.getElementsByClassName("playerInfo");

        // make sure gameInfo starts blank/neutral
        if (gameInfo) {
            gameInfo.textContent = '—';
        }
    
        showButton("play");
        showButton("pass");
        showButton("clear");
        //setHiddenSafe(gameInfo, false);

        GameModule.isFirstMove = isFirstMove;
        GameModule.lastValidHand = lastValidHand;

        //console.log("isFirstMove")
        //console.log(GameModule.isFirstMove)

        // 3) Ensure our local player has the current socket id
        GameModule.players[0].socketId = socket.id;

        const localPlayerIndex = players.findIndex(p => p.socketId === GameModule.players[0].socketId);

        //console.log("LOCAL PLAYER INDEX:", localPlayerIndex);

        // repopulate gamemodule players with info from server emit
        if (localPlayerIndex !== -1) {
            // Rotate server order so local player is index 0 in GameModule 
            players.forEach((p, index) => {
                const gameModuleIndex = (index - localPlayerIndex + 4) % 4; // Calculate GameModule index
                GameModule.players[gameModuleIndex].username = p.username;
                GameModule.players[gameModuleIndex].clientId = p.clientId;
                GameModule.players[gameModuleIndex].socketId = p.socketId;
                GameModule.players[gameModuleIndex].pbId     = p.pbId;
                GameModule.players[gameModuleIndex].avatar   = p.avatar;
            });

            players.forEach(sp => {
                const i = GameModule.players.findIndex(lp => lp.clientId === sp.clientId);
                if (i !== -1) {
                    Object.assign(GameModule.players[i], {
                        passed: !!sp.passed,
                        finishedGame: !!sp.finishedGame,
                        wonRound: !!sp.wonRound,
                    });
                }
            });
        }

        // Update UI labels
        for (let i = 0; i < playerInfo.length; i++) {
            const p = GameModule.players[i];
            renderPlayerInfo(playerInfo[i], p, i);
        }

        // set turn to appopriate player index based off server's current turn client id
        GameModule.turn = GameModule.players.findIndex(p => p.clientId === turnClientId);
        //console.log(GameModule.turn);
        // 1) Find my local seat
        const mySeat = GameModule.players.findIndex(p => p.clientId === me);

        // 2) Mount my real hand face-up
        const myCards = buildCardsFromArray(Array.isArray(hand) ? hand : []);
        mountCardsInGC(myCards, mySeat, true);

        // 3) For other seats, mount face-down placeholders using their cardCount
        players.forEach((sp) => {
            const localSeat = GameModule.players.findIndex(p => p.clientId === sp.clientId);
            if (localSeat === mySeat) return;
            const count = typeof sp.cardCount === 'number' ? sp.cardCount : 13;
            const ph = buildCardsFromArray(Array.from({length: count}, () => ({rank:4, suit:3})));
            mountCardsInGC(ph, localSeat, false);
        });

        // 4) Recreate finishedDeck pile from server snapshot
        if (Array.isArray(finishedDeck) && finishedDeck.length > 0) {
            const stage = document.getElementById('gameDeck');
            GameModule.finishedDeck.length = 0;

            // Same anchor as your live finishDeckAnimation
            const PCT_LEFT = 0.75;
            const PCT_TOP  = 0.35;
            const STACK_DRIFT = 0.25;

            const { rect } = _getGCMeta();
            const anchorXGC = rect.width  * PCT_LEFT;
            const anchorYGC = rect.height * PCT_TOP;

            finishedDeck.forEach((c, i) => {
                const card = Deck.Card(i);
                card.rank = c.rank;
                card.suit = c.suit;
                card.setRankSuit(c.rank, c.suit);
                card.setSide('back');

                // Put card into main stage, same as finishDeckAnimation
                stage.appendChild(card.$el);
                GameModule.finishedDeck.push(card);

                // stagger the pile slightly like live animation
                const xGC = anchorXGC - (i * STACK_DRIFT);
                const yGC = anchorYGC - (i * STACK_DRIFT);

                // convert GC to gameDeck local space
                const { x: xLocal, y: yLocal } = gcToLocalCentered(xGC, yGC, stage, card.$el);

                card.animateTo({
                    delay: 0,
                    duration: 0,
                    ease: 'linear',
                    rot: 0,
                    x: xLocal,
                    y: yLocal,
                    z: i + 1,
                });
            });
        }

        // recreate the gameDeck pile from server snapshot
        if (Array.isArray(gameDeck) && gameDeck.length > 0) {
            GameModule.gameDeck.length = 0;
            const stage = document.getElementById('gameDeck');

            // width of each row = size of the last valid hand (fallback 1)
            const n = (Array.isArray(lastValidHand) && lastValidHand.length) ? lastValidHand.length : 1;
            const mid = (n - 1) / 2;

            // same spacing/drift you use when playing a hand
            const CARD_GAP_X = 15;
            const STACK_DRIFT = 0.25;

            // GC center to stage local
            const { rect } = _getGCMeta();                      
            const centerGC = { x: rect.width * 0.5, y: rect.height * 0.5 };
            
            // Build the first card up front so we have a real, DOM-attached card
            // element to measure width/height from for centering
            const firstCard = Deck.Card(0);
            firstCard.rank = gameDeck[0].rank;
            firstCard.suit = gameDeck[0].suit;
            firstCard.setRankSuit(gameDeck[0].rank, gameDeck[0].suit);
            firstCard.setSide('front');
            stage.appendChild(firstCard.$el);
            GameModule.gameDeck.push(firstCard);

            const centerLocal = gcToLocalCentered(centerGC.x, centerGC.y, stage, firstCard.$el);

            gameDeck.forEach((c, i) => {
                const card = i === 0 ? firstCard : Deck.Card(i);
                if (i !== 0) {
                    card.rank = c.rank;
                    card.suit = c.suit;
                    card.setRankSuit(c.rank, c.suit);
                    card.setSide('front');
                    stage.appendChild(card.$el);
                    GameModule.gameDeck.push(card);
                }

                // lay out into rows of size n, centered on the table
                const col = i % n;                    // index within this hand
                const row = Math.floor(i / n);        // which prior hand (0,1,2,...)

                // offsets identical in spirit to your player.js:
                // x: spread around center; y: small downward drift per stacked hand
                const offX = ((col - mid) * CARD_GAP_X) - (row * STACK_DRIFT);
                const offY = (row * STACK_DRIFT);

                const x = centerLocal.x + offX;
                const y = centerLocal.y + offY;
                const rot = Math.random() * 2 - 1; 

                card.animateTo({
                    delay: 0,
                    duration: 0,
                    ease: 'linear',
                    rot,
                    x,
                    y,
                    z: GameModule.gameDeck.length,
                });
            });
        }

        // restart game here and use info from payload that server will send in room:resumed emit, then window dispatch to send results like normal
        gmCancelToken('room:resumed');   // safe even if none

        // nuke every listener tied to the old game loop, regardless of what state
        // it was suspended in — the cancel token alone can't interrupt an in-flight
        // await, so this guarantees no duplicate listeners after a reconnect
        socket.off('cardsPlayed');
        socket.off('passedTurn');
        socket.off('wonRound');
        socket.off('allHandAckComplete');
        socket.off('playerFinished');
        socket.off('gameHasFinished');
        socket.off('finishGameAnimationComplete');
        socket.off('gotLastHand');

        await Promise.resolve();         // give the old loop a tick to exit
        gmNewToken('room:resumed');
        const results = await gameLoop(roomCode, socket, null, true);

        // hand results to the onload window
        window.dispatchEvent(new CustomEvent('resumedResults', { detail: results }));
    };

    socket.off?.('room:resumed', onRoomResumed);
    socket.on('room:resumed', onRoomResumed);

    // listen for force reset emit from server (means 1 player left in server)
    const onRoomForceReset = ({ reason }) => {
        //console.log('Force reset:', reason);

        cleanupPauseBindings();
        gmCancelToken('forceReset');
        detachGameEvents(socket);

        GameModule.reset();
        removeAllGameElements();
        
        socket.emit('leaveRoom'); // inform server we’ve left this room
        window.dispatchEvent(new CustomEvent('forceReset'));
    };
    socket.off?.('room:forceReset', onRoomForceReset);
    socket.on('room:forceReset', onRoomForceReset);
}

// if socket.force
function waitForForceResetOnce() {
  return new Promise((resolve) => {
    const h = () => { window.removeEventListener('forceReset', h); resolve('forceReset'); };
    window.addEventListener('forceReset', h, { once: true });
  });
}

function startGameSafe(socket, roomCode, username) {
    if (window.isResume) {
        // Do not arm startGame at all; Promise.race will ignore this branch.
        //console.log("not arming")
        
        return new Promise(() => {});
    }
    // Do NOT block on resume; it just suppresses arming.
    return startGame(socket, roomCode, username).catch(() => '__START_ERR__');
}

function waitForResumedResultsOnce() {
    return new Promise((resolve) => {
        const h = (e) => {
        window.removeEventListener('resumedResults', h);
        resolve(e.detail);               // detail is the results array
        };
        window.addEventListener('resumedResults', h, { once: true });
    });
}

window.onload = async function() {
    // If the user came via email link
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token') || url.hash.replace(/^#.*token=/, '').split('token=')[1];
    if (token) {
        await resetPasswordMenu(token);
        // optional: clean URL
        history.replaceState({}, document.title, location.pathname);
    }

    while (true) {
        let joinedRoomSocket, roomCode, isRejoin;
        // declare ALL the vars you’ll assign to
        let loginMenuSocket, username, spResults;
        let spEndMenuResolve = null; 
        let spContinue = false;

        // require username and password to establish connection to socket.io server and resolve the connected socket object
        const authResult = await loginMenu();

        if (authResult?.type === 'singlePlayer') {
            // single player branch here, return results (containing clientIds)
            while (spEndMenuResolve?.action !== 'back') 
            {
                spResults = await spLoop(spContinue);
                spEndMenuResolve = await spEndMenu(spResults);

                if(spEndMenuResolve.action === 'newMatch') {
                    spContinue = false; // let spLoop know to start new game with new opponents (spLoop alredy reset player points)
                }

                if(spEndMenuResolve.action === 'continue') {
                    spContinue = true; //let spLoop know that its a continued game
                }
            }

            continue; // go back to loginMenu()
        }

        // Go to registration
        if (authResult?.type === 'createAccount') {
            await createAccountMenu();   // returns when account created or user cancels
            continue;                    // go back to login
        }

        // Lost password flow (request link)
        if (authResult?.type === 'forgotPassword') {
            await lostPasswordMenu();
            continue;
        }

        // success path
        loginMenuSocket = authResult.socket;
        username = authResult.username;

        // one loop that contains both joinRoomMenu and the game cycle
        while (true) {
            const { socket, roomCode: rc, isRejoin: rejoinFlag } = await joinRoomMenu(loginMenuSocket, username);
            joinedRoomSocket = socket;
            roomCode = rc;
            isRejoin = rejoinFlag;

            setupPauseModal(joinedRoomSocket, roomCode);

            if (!isRejoin) {
                const lobbyResult = await lobbyMenu(joinedRoomSocket, roomCode);
                if (lobbyResult === 'goBackToJoinRoomMenu') {
                // back button for lobby room
                continue;
                }
            } else {
                window.isResume = true;
            }

            // game cycle 
            while (true) {
                const startOutcome = await Promise.race([
                    startGameSafe(joinedRoomSocket, roomCode, username),
                    waitForForceResetOnce(),
                    waitForResumedResultsOnce(),
                ]);

                // if three players leave, kick player back to joinRoomMenu
                if (startOutcome === 'forceReset') {
                    startGame._busy = false;
                    // break to the OUTERMOST loop (which shows login),
                    break;
                }

                if (startOutcome === '__START_ERR__') continue;
                if (!Array.isArray(startOutcome)) continue;

                const results = startOutcome;
                //console.log(results);
                
                const endOutcome = await Promise.race([
                    endMenu(joinedRoomSocket, roomCode, results),
                    waitForForceResetOnce(),
                ]);

                if (endOutcome === 'forceReset') {
                    // Exit the inner game loop → back to joinRoomMenu
                    break;
                }

                if (endOutcome === 'continue') {
                    startGame._busy = false;
                    window.isResume = false;
                    // Play again in same room or rejoin flow (your choice); here we loop and show join again
                    continue;
                }

                if (endOutcome === 'goBackToJoinRoomMenu') {
                    // User chose to leave to room list
                    break;  // break inner game loop, then continue outer join+game loop
                }
            }

            // After breaking inner game loop (back button), show Join Rooms again
            continue;
        }
    }
};

