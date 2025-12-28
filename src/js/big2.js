import Player from "./player.js"
import Opponent from "./opponent.js"
import spOpponent, { loadPolicyModel } from "./spOpponent.js";
import PocketBase, { BaseAuthStore } from "https://cdn.jsdelivr.net/npm/pocketbase@0.21.1/dist/pocketbase.es.mjs";
import { resetHenryObsMemory } from "./henryObs.js";

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

// lookup table for printing suit icon in last played hand
const suitLookup = {
    0: '♦', // Diamonds
    1: '♣', // Clubs
    2: '♥', // Hearts
    3: '♠', // Spades
};

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

const PB_URL = 'http://127.0.0.1:8090';
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
    return pb.files.getUrl({ collectionId: '_pb_users_auth_', id: pbId }, file, { thumb });
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
        get deck() { return getDeck(); },
        set deck(d) { setDeck(d); },
        unmountDeck,
        reset,
    };
})();

function gmCancelToken(ctx='') {
  if (GameModule._currentLoopToken && !GameModule._currentLoopToken.canceled) {
    GameModule._currentLoopToken.canceled = true;
    console.log('[loopToken] canceled', ctx);
  } else {
    console.log('[loopToken] no active loop to cancel', ctx ? `(${ctx})` : '');
  }
}

function gmNewToken(ctx='') {
  GameModule._currentLoopToken = { canceled: false };
  console.log('[loopToken] new token', ctx);
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
    // 1) sort everyone locally (keeps DOM/z-order consistent)
    GameModule.players.forEach((p, i) => {
        p.sortHand(); // local player normal sort
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
            p.sortHand(); // local player normal sort
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
            console.log('All players have completed sorting their hands.');
            resolve('sortComplete');
        });
        socket.emit('sortHandsComplete', roomCode);
    });
}

async function sortPlayerHandAfterTurn(socket, roomCode, actorIdx) {
    console.log("ACTORIDX" + actorIdx)
    GameModule.players[actorIdx].sortHand();

    // Animate the current player's cards into position
    await GameModule.players[actorIdx].sortingAnimation(actorIdx);

    // Wait for server confirmation before resolving
    return new Promise(resolve => {
        socket.once('sortAfterTurnComplete', () => {
            console.log('After turn sorting complete for all clients');
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
const dealCardSounds = [
  new Howl({ src: ["src/audio/dealcard_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_02.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_04.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_05.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_06.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_07.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_08.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_09.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_10.wav"], volume: 0.9 })
];

const finishCardSounds = [
    new Howl({ src: ["src/audio/finishcard_01.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_02.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_03.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_04.wav"], volume: 0.9 })
]

let finishSoundIndex = 0;

function dealNextCardSounds() {
    // Pick a random index from 0 → dealCardSounds.length - 1
  const randomIndex = Math.floor(Math.random() * dealCardSounds.length);
  dealCardSounds[randomIndex].play();  // play current sound
   console.log("Random sound index: " + randomIndex);
  //console.log("Sound index" + soundIndex);
  //soundIndex = (soundIndex + 1) % dealCardSounds.length; // move to next (wrap around)
}

function dealNextFinishCardSounds() {
  finishCardSounds[finishSoundIndex].play();  // play current sound
  console.log("Sound index" + finishSoundIndex);
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


// ---- Dealing layout (percent-of-container, no seat divs) ----
const DEAL_ANCHORS = [
    // seat 0 (bottom; fan along X →)
    { leftPct: 0.50, topPct: 0.83, axis: 'x', dir: +1, rot: 0 },
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

    console.log("local player dealt to first: " + playerIndex);

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
        const { x: xLocal, y: yLocal } = gcToLocal(xGC, yGC, deckParent);

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

    console.log("local player dealt to first: " + playerIndex);

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
        const { x: xLocal, y: yLocal } = gcToLocal(xGC, yGC, deckParent);

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

    // ✅ Now that animations are done room-wide, flip the visible turn
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

    // ✅ Flip after barrier
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

    // ✅ Flip after clear-pile animation
    const localIdx = GameModule.players.findIndex(p => p.clientId === nextTurnClientId);
    if (localIdx >= 0) {
      GameModule.turn = localIdx;
      displayTurn(GameModule.turn);
    }
    return;
  }
}

const passSound = new Howl({ src: ["src/audio/passcard.wav"], volume: 0.6 });

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
        if (actor) {
            console.log("POSITIONS")
            console.log(positions);

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
            console.log('[POST-PLAY SORT]', { actorCid: clientId, actorIdx, turnAtReceive: GameModule.turn });

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

      const nextTurnClientId = payload.nextTurn;              // STASH
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

async function finishSpGameAnimation(gameDeck, losingPlayer) {
  return new Promise(async function (resolve) {

    // anchor config: % within gameContainer
    const PCT_LEFT  = 0.75;
    const PCT_TOP   = 0.35;
    const STACK_DRIFT = 0.25;

    // compute once per run
    const meta = _getGCMeta();
    const anchorX = meta.rect.width  * PCT_LEFT;
    const anchorY = meta.rect.height * PCT_TOP;

    // --------------------------------------------------
    // 1) Animate all cards already in the game deck
    // --------------------------------------------------
    for (let i = 0; i < gameDeck.length; i++) {
      const card = gameDeck[i];
      card.setSide('back');

      const { cx, cy } = _cardCenterInGC(card.$el, meta);
      const dx = anchorX - cx;
      const dy = anchorY - cy;

      const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
      const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);

      await new Promise((cardResolve) => {
        setTimeout(() => {
          card.animateTo({
            delay: 0,
            duration: 50,
            ease: 'linear',
            rot: 0,
            x: Math.round(card.x + dx + offX),
            y: Math.round(card.y + dy - offY),
            onStart: () => {
              GameModule.finishedDeck.push(card);
              card.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
            },
            onComplete: () => {
              dealNextFinishCardSounds();
              cardResolve();
            }
          });
        }, 20);
      });
    }
    // --------------------------------------------------
    // 2) Animate remaining cards from JUST the losing player
    // --------------------------------------------------
    if (!losingPlayer) {
      await sleep(200);
      resolve();
      return;
    }

    const player = GameModule.players.find(p => p.clientId === losingPlayer.clientId);
    if (player && player.cards && player.cards.length > 0) {
        for (let i = 0; i < player.cards.length; i++) {
            const losingCard = player.cards[i];
            losingCard.setSide('back');

            const { cx, cy } = _cardCenterInGC(losingCard.$el, meta);
            const dx = anchorX - cx;
            const dy = anchorY - cy;

            const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
            const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);

            await new Promise((cardResolve) => {
            setTimeout(() => {
                losingCard.animateTo({
                delay: 0,
                duration: 50,
                ease: 'linear',
                rot: 0,
                x: Math.round(losingCard.x + dx + offX),
                y: Math.round(losingCard.y + dy - offY),
                onStart: () => {
                    GameModule.finishedDeck.push(losingCard);
                    losingCard.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
                },
                onComplete: () => {
                    dealNextFinishCardSounds();
                    cardResolve();
                }
                });
            }, 20);
            });
        }
    }

    await sleep(200);
    resolve();
  });
}


async function finishGameAnimation(roomCode, socket, gameDeck, losingPlayer){
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

        for (let i = 0; i < gameDeck.length; i++) {
            //loop through all game deck cards
            let card = gameDeck[i];
            card.setSide('back');

            // measure this card’s current visual center (relative to GC)
            const { cx, cy } = _cardCenterInGC(card.$el, meta);

            // delta to land the card’s center exactly on the anchor
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
                        duration: 80,
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

        //loop through losing player's cards
        for (let i = 0; i < lastPlacePlayer.numberOfCards; i++){
            let losingCard = lastPlacePlayer.cards[i];
            losingCard.setSide('back');

            // measure this card’s current visual center (relative to GC)
            const { cx, cy } = _cardCenterInGC(losingCard.$el, meta);

            // delta to land the card’s center exactly on the anchor
            const dx = anchorX - cx;
            const dy = anchorY - cy;

            // keep your original stagger look using finishedDeck length
            const offX = -(GameModule.finishedDeck.length * STACK_DRIFT);
            const offY =  (GameModule.finishedDeck.length * STACK_DRIFT);
            
            //wait until each card is finished animating
            await new Promise((cardResolve) => {
                setTimeout(function () {
                    losingCard.animateTo({
                        delay: 0,
                        duration: 80,
                        ease: 'linear',
                        rot: 0,
                        x: Math.round(losingCard.x + dx + offX),
                        y: Math.round(losingCard.y + dy - offY),
                        onStart: () => {
                            GameModule.finishedDeck.push(losingCard); // push gameDeck card into finishedDeck
                            // keep z stacking consistent as the pile grows
                            losingCard.$el.style.zIndex = String(GameModule.finishedDeck.length + 1);
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

// Convert an array of card objects into a human-readable string
function formatHand(cards) {
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
    const ranks = [...byRank.keys()].sort((a,b)=>a-b);
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
            const hi = cards.reduce((best, c) =>
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
            const hi = cards.reduce((best, c) =>
                big2Order(c.rank) > big2Order(best.rank) ? c : best
            , cards[0]);

            return `${rankLookup[hi.rank]} of ${suitName[hi.suit]} Straight `;
        }
    }

    // fallback, show raw symbols like "3♦ 3♥"
    return cards.map(c => `${rankLookup[c.rank]}${suitLookup[c.suit]}`).join(' ');
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

    console.log("playerFinished:", clientId, "order:", GameModule.playersFinished);
  };

  socket.on("playerFinished", handler);

  // return cleanup so you can call it at game end
  return () => socket.off("playerFinished", handler);
}

// Listen ONCE for "gameHasFinished", run animations, then resolve results
function waitForGameHasFinished(socket) {
   return new Promise((resolve) => {
    const handler = (playersFinished, losingPlayer) => {
        GameModule.playersFinished = [...playersFinished];
        GameModule.losingPlayer = losingPlayer;
        socket.off('gameHasFinished', handler);
        
        // Just resolve data; do NOT animate here.
        resolve({ playersFinished, losingPlayer });
    };
    socket.on('gameHasFinished', handler);
  });
}

async function applySpTurnOutcome({ actorIndex, outcome, gameOver }) {
  const actor = GameModule.players[actorIndex];

  if (outcome === 'passed') {
    console.log('PASSED');
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
    console.log('[TRICK] no leader yet');
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

  console.log('leaderIndex:', leaderIndex);
  console.log('leader:', {
    clientId: leader.clientId,
    finishedGame: leader.finishedGame,
    wonRound: leader.wonRound
  });

  console.log('activeCount:', activeCount);
  console.log(
    'activePlayers:',
    activePlayers.map(p => ({
      clientId: p.clientId,
      finishedGame: p.finishedGame,
      passed: p.passed
    }))
  );

  console.log('passTracker:', GameModule.passTracker);
  console.log('passesNeeded:', passesNeeded);*/

  const ended =
    passesNeeded > 0 &&
    GameModule.passTracker >= passesNeeded;

  /*console.log('TRICK ENDED?', ended);

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

    //sort all player's cards, it will resolve once all 4 clients sorting animations are complete
    let sortResolve = await spSortHands(); 

    // after you get firstTurnClientId from dealSinglePlayerCards()
    GameModule.turn = GameModule.players.findIndex(p => p.clientId === firstTurnClientId);

    if(sortResolve === 'sortComplete'){
        console.log("TURN IS: " + GameModule.turn);

        //let rotation = initialAnimateArrow(turn); //return initial Rotation so I can use it to animate arrow
        let gameInfoDiv = document.getElementById("gameInfo");

        // listen for server event notifying that 3 players have finished
        // ONE-SHOT waiter + quick flag to know when to break the loop
        let gameOver = false;

        //GAME LOOP, each loop represents a single turn
        for(let i = 0; i < 100; i++){
            playButton.disabled = true; //disable play button because no card is selected which is an invalid move
            clearButton.disabled = true;
            passButton.disabled = true

            //log gameState values
            console.log("GameState isFirstMove:", GameModule.isFirstMove);
            console.log("GameState Players:", GameModule.players);
            console.log("GameState Game Deck:", GameModule.gameDeck);
            console.log("GameState Last Hand:", GameModule.lastHand);
            console.log("GameState Turn:", GameModule.turn);
            console.log("GameState Finished Deck:", GameModule.finishedDeck);
            console.log("GameState Players Finished:", GameModule.playersFinished);
            console.log("GameState playedHand:", GameModule.playedHand);
            console.log("GameState passTracker:", GameModule.passTracker);

            // return last hand (that wasn't a pass)
            GameModule.lastHand = GameModule.playedHand > 0
            ? GameModule.gameDeck.slice(GameModule.gameDeck.length - GameModule.playedHand)
            : GameModule.lastHand; // unchanged on pass
            
            // print out last played hand
            gameInfoDiv.textContent = `${formatHand(GameModule.lastHand)}`;

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

            console.log("Played Hand Length: " + GameModule.playedHand)

            //if player played a valid hand
            if(GameModule.playedHand >= 1 && GameModule.playedHand <= 5){
                //GameModule.playedHistory.push(GameModule.lastHand); //push last valid hand into playedHistory array
                console.log("played hand debug: " + GameModule.playedHand);
                
                // check if game ended this loop 
                if (gameOver) {
                    // return other 3 player's clientIds and remaining cards
                    const losingPlayer = getLosingPlayerWithCards();

                    // see last card played for a bit
                    await sleep(100); 

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

    console.log('gameLoop() entered', { onResume, hasToken: !!GameModule._currentLoopToken, canceled: gmHasCancel() });

    if (!GameModule._currentLoopToken || gmHasCancel()) {
        console.log('[gameLoop] canceled or no token at entry — aborting');
        return;
    }
    
    if (onResume === false) {
        // fresh game start
        GameModule.turn = GameModule.players.findIndex(p => Number(p.clientId) === Number(firstTurnClientId));
    } else {
        // resume game, don’t override turn, it was already set from resume payload
        console.log("Resuming game, keeping existing GameModule.turn:", GameModule.turn);
    }

    seedShadowKeysOnce();
    //sort all player's cards, it will resolve once all 4 clients sorting animations are complete
    let sortResolve = await sortHands(socket, roomCode); 

    if(sortResolve === 'sortComplete'){
        console.log("TURN IS: " + GameModule.turn);

        //let rotation = initialAnimateArrow(turn); //return initial Rotation so I can use it to animate arrow
        let gameInfoDiv = document.getElementById("gameInfo");

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
                console.log('[gameLoop] canceled during iteration — exiting early');
                return;
            }
            playButton.disabled = true; //disable play button because no card is selected which is an invalid move
            clearButton.disabled = true;
            passButton.disabled = true

            //log gameState values
            console.log("GameState isFirstMove:", GameModule.isFirstMove);
            console.log("GameState Players:", GameModule.players);
            console.log("GameState Game Deck:", GameModule.gameDeck);
            console.log("GameState Last Hand:", GameModule.lastHand);
            console.log("GameState Turn:", GameModule.turn);
            console.log("GameState Finished Deck:", GameModule.finishedDeck);
            console.log("GameState Players Finished:", GameModule.playersFinished);
            console.log("GameState playedHand:", GameModule.playedHand);

            const last = await getLastHand(socket, roomCode);

            // local mirror
            GameModule.lastHand = last;                  
            gameInfoDiv.textContent = `${formatHand(last)}`;

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
            console.log("Played Hand Length: " + GameModule.playedHand)

            //if player played a valid hand
            if(GameModule.playedHand >= 1 && GameModule.playedHand <= 5){
                //GameModule.playedHistory.push(GameModule.lastHand); //push last valid hand into playedHistory array
                console.log("played hand debug: " + GameModule.playedHand);

                // do a new function here input current turn, instead so theres only one animation per turn instead of all cards being sorted after each turn
                //if player or ai play a valid hand, sort their cards

                 // ---- check if game ended this tick ----
                if (gameOver) {
                    // clean up listeners added for this loop
                    socket.off('gameHasFinished', gameOverFlagHandler);
                    unsubscribePlayerFinished();

                    // Get final data (playersFinished, losingPlayer)
                    const { playersFinished, losingPlayer } = await gameOverPromise;
                    console.log(losingPlayer);

                    // Now it's safe to animate: all clients have acked the last hand,
                    // and gameDeck includes those last cards, unmount finishedDeck after animations, and reset gameState
                    // Now it's safe to animate: all clients have acked the last hand,
                    // and gameDeck includes those last cards…
                    await finishGameAnimation(roomCode, socket, GameModule.gameDeck, losingPlayer);
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

    loginMenu.style.display = "block";
    clearLoginErrors(); 
    
    // disable button when fields empty
    function updateLoginButtonState() {
        const hasUsername = userNameInput.value.trim().length > 0;
        const hasPassword = passwordInput.value.trim().length > 0;
        loginButton.disabled = !(hasUsername && hasPassword);
    }

    function clearLoginErrors() {
        errorMessage1.textContent = '';
        errorMessage1.style.display = 'none';
        userNameInput.setCustomValidity('');
    }
    
    updateLoginButtonState();
    userNameInput.addEventListener("input", updateLoginButtonState);
    passwordInput.addEventListener("input", updateLoginButtonState);

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
                    <button type="button" id="resendVerifyBtn" class="underline">Resend verification email</button>
                `;
                errorMessage1.style.display = 'block';

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
            const socket = io(import.meta.env?.VITE_WS_URL || 'http://localhost:3000', {
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
                loginMenu.style.display = "none";
                settle({ type: 'login', socket, username: displayName });
            };
            socket.on('authenticated', onAuthed);
            socket.on('connect', onAuthed);

            socket.on('connect_error', (error) => {
                const msg = (error && error.message) || 'Authentication failed';
                if (msg === 'Email not verified') {
                    errorMessage1.innerHTML = `
                        Your email isn’t verified yet.
                        <button type="button" id="resendVerifyBtn" class="underline">Resend verification email</button>
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

                errorMessage1.style.display = 'block';
                loginMenu.style.display = 'block';
                updateLoginButtonState();
                userNameInput.setCustomValidity(msg);
                userNameInput.reportValidity();
                loginButton.disabled = false;
            });
        } catch (e) {
            const msg = e?.data?.message || 'Login failed';
            const identityMsg = e?.data?.data?.identity?.message;
            const passwordMsg = e?.data?.data?.password?.message;
            errorMessage1.innerText = identityMsg || passwordMsg || msg;
            errorMessage1.style.display = 'block';
            loginButton.disabled = false;
        }
        }

        // buttons
        loginButton.addEventListener("click", () => {
            clickSounds[0].play();
            const u = userNameInput.value.trim();
            const p = passwordInput.value.trim();
            if (!u || !p) {
                errorMessage1.innerText = !u && !p
                ? "Both username and password are required."
                : (!u ? "Username is required." : "Password is required.");
                errorMessage1.style.display = "block";
                return;
            }
            handleClick();
        });

        spButton.addEventListener("click", () => {
            clickSounds[0].play();
            loginMenu.style.display = "none";
            settle({ type: "singlePlayer" });
            },
            { once: true }
        );

        createAccountButton.addEventListener(
            "click",
            () => {
                clickSounds[0].play();
                clearLoginErrors(); 
                loginMenu.style.display = "none";
                settle({ type: "createAccount" });
            },
            { once: true }
        );

        // Route: Forgot Password (optional menu below)
        lostPasswordButton.addEventListener("click", () => {
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

    caMenu.classList.remove("hidden"); // also remove Tailwind's .hidden
    
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
            caMenu.classList.add("hidden");
            loginMenu.style.display = "block";
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
                loginMenu.style.display = "block";
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

    const show = () => { fpMenu.classList.remove("hidden"); fpMenu.style.display = "block"; };
    const hide = () => { fpMenu.style.display = "none"; fpMenu.classList.add("hidden"); };

    show(); loginMenu.style.display = "none";
    err.textContent = ""; info.textContent = "";

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
        loginMenu.style.display = "block";
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

    const show = () => { rpMenu.classList.remove("hidden"); rpMenu.style.display = "block"; };
    const hide = () => { rpMenu.style.display = "none"; rpMenu.classList.add("hidden"); };

    show(); loginMenu.style.display = "none";
    err.textContent = ""; info.textContent = "";

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
        loginMenu.style.display = "block";
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

async function getUserByName(name) {
    return await pb.collection('users').getFirstListItem(`name="${esc(name)}"`);
}

function getSortForMetric(metric) {
    switch (metric) {
        case 'wins':     return '-wins, -games_played';      // more is better
        case 'games':    return '-games_played, -wins';      // more is better
        case 'losses':   return 'fourths, -games_played';    // fewer is better
        case 'seconds':  return '-seconds, -games_played';   // more seconds
        case 'thirds':   return '-thirds, -games_played';    // more thirds
        case 'avg':
        default:         return 'avg_finish, -games_played'; // lower is better
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
      : '/src/css/background/avatar-placeholder.png';
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
      avg: (typeof row.avg_finish === 'number') ? row.avg_finish : null,
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

function setDropdownActive(metric) {
    const map = {
        avg:     document.getElementById('lbAvgOption'),
        wins:    document.getElementById('lbWinsOption'),
        games:   document.getElementById('lbGamesOption'),
        losses:  document.getElementById('lbLossOption'),
        seconds: document.getElementById('lbSecondsOption'),
        thirds:  document.getElementById('lbThirdsOption'),
    };

    document.querySelectorAll('#dropdown a').forEach(el => {
        el.classList.remove('bg-gray-600', 'dark:bg-gray-600');
    });

    const el = map[metric];
    if (el) el.classList.add('bg-gray-600', 'dark:bg-gray-600');

    const dropdownButton = document.getElementById('dropdownDefaultButton');
    if (dropdownButton) {
        const label = metricHeader(metric);
        if (dropdownButton.childNodes && dropdownButton.childNodes[0]) {
        dropdownButton.childNodes[0].textContent = label + ' ';
        } else {
        dropdownButton.textContent = label + ' ';
        }
    }
}

function bindDropdownHandlers() {
    const bind = (id, metric) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            try { clickSounds?.[0]?.play(); } catch {}
            renderLeaderboardMenu(metric);

            // Correctly close via Flowbite API
            const dropdownEl = document.getElementById('dropdown');
            const buttonEl   = document.getElementById('dropdownDefaultButton');

            // Try to get Flowbite’s existing controller instance
            let dropdownInstance = Flowbite?.Dropdown?.getInstance?.(dropdownEl);

            // If Flowbite hasn’t created one yet, create it
            if (!dropdownInstance && typeof Dropdown !== 'undefined') {
            dropdownInstance = new Dropdown(dropdownEl, buttonEl);
            }

            // Ask Flowbite to close it (keeps internal state synced)
            dropdownInstance?.hide();
        });
        }
    };
    bind('lbAvgOption',     'avg');
    bind('lbWinsOption',    'wins');
    bind('lbGamesOption',   'games');
    bind('lbLossOption',    'losses');
    bind('lbSecondsOption', 'seconds');   
    bind('lbThirdsOption',  'thirds');  
}

async function renderLeaderboardMenu(metric = 'avg') {
    const container = document.getElementById('leaderboardMenu');
    const dropdownButton = document.getElementById('dropdownDefaultButton');
    if (!container || !dropdownButton) return;

    container.classList.remove('hidden');

    // ensure dropdown items are wired
    bindDropdownHandlers();

    // mark active + update button text
    setDropdownActive(metric);

    // remove prior table
    const existing = document.getElementById('leaderboardWrapper');
    if (existing) existing.remove();

    // wrapper after the dropdown
    const wrapper = document.createElement('div');
    wrapper.id = 'leaderboardWrapper';
    wrapper.className = 'mt-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden';
    dropdownButton.insertAdjacentElement('afterend', wrapper);

    // table
    const table = document.createElement('table');
    table.className = 'min-w-full table-fixed text-sm text-left';

    const thead = document.createElement('thead');
    thead.className = 'bg-emerald-600 text-gray-800 dark:text-gray-100';
    thead.innerHTML = `
        <tr>
        <th class="px-4 py-3 font-semibold w-14">#</th>
        <th class="px-4 py-3 font-semibold">Player</th>
        <th class="px-4 py-3 font-semibold text-right w-28">${metricHeader(metric)}</th>
        </tr>
    `;

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900';

    // footer pager
    const footer = document.createElement('div');
    footer.className = 'flex items-center justify-between gap-3 px-4 py-3 bg-gray-100 border-t border-gray-300 dark:border-gray-700';
    const info = document.createElement('span');
    info.className = 'text-xs text-gray-700 dark:text-gray-400';

    function makeBtn(label, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = title || label;
        btn.className = 'px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium shadow-sm transition';
        btn.textContent = label;
        return btn;
    }
    const firstBtn = makeBtn('« First', 'First page');
    const prevBtn  = makeBtn('‹ Prev',  'Previous page');
    const nextBtn  = makeBtn('Next ›',  'Next page');
    const lastBtn  = makeBtn('Last »',  'Last page');

    const pager = document.createElement('div');
    pager.className = 'flex items-center gap-2';
    pager.append(firstBtn, prevBtn, info, nextBtn, lastBtn);

    footer.append(pager);

    table.append(thead, tbody);
    wrapper.append(table, footer);

    // pagination state
    let page = 1;
    const perPage = 10;

    async function renderPage() {
        const res = await fetchLeaderboardPage(pb, { page, perPage, metric });
        tbody.innerHTML = '';

        if (!res.items.length) {
        const empty = document.createElement('tr');
        empty.innerHTML = `<td colspan="3" class="px-4 py-6 text-center text-gray-500 dark:text-gray-400 italic">No players yet</td>`;
        tbody.appendChild(empty);
        } else {
        const rankStart = (res.page - 1) * res.perPage + 1;

        res.items.forEach((row, i) => {
            const tr = document.createElement('tr');
            tr.className =
            (i % 2 === 0 ? 'bg-gray-200' : 'bg-white dark:bg-gray-900') +
            ' hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors';

            // position
            tr.appendChild(td('px-4 py-2 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap', rankStart + i));

            // player (avatar + name)
            const playerTd = document.createElement('td');
            playerTd.className = 'px-4 py-2';
            const rowDiv = document.createElement('div');
            rowDiv.className = 'flex items-center gap-3';

            const img = document.createElement('img');
            img.src = row.avatar;
            img.alt = row.name;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.className = 'w-8 h-8 rounded-md object-cover border border-gray-300 dark:border-gray-600';
            img.style.aspectRatio = '1 / 1';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'font-semibold text-gray-900 dark:text-gray-100 truncate';
            nameSpan.textContent = row.name;

            rowDiv.append(img, nameSpan);
            playerTd.appendChild(rowDiv);
            tr.appendChild(playerTd);

            // metric cell (right aligned)
            const value = metricCellValue(row, metric);
            tr.appendChild(td('px-4 py-2 text-right tabular-nums', value));

            tbody.appendChild(tr);
        });
        }

        info.textContent = `Page ${res.page} of ${res.totalPages} • ${res.totalItems} players`;

        firstBtn.disabled = res.page <= 1;
        prevBtn.disabled  = res.page <= 1;
        nextBtn.disabled  = res.page >= res.totalPages;
        lastBtn.disabled  = res.page >= res.totalPages;

        const click = () => { try { clickSounds?.[0]?.play(); } catch {} };
        firstBtn.onclick = () => { click(); page = 1; renderPage(); };
        prevBtn.onclick  = () => { click(); if (page > 1) page -= 1; renderPage(); };
        nextBtn.onclick  = () => { click(); if (page < res.totalPages) page += 1; renderPage(); };
        lastBtn.onclick  = () => { click(); page = res.totalPages; renderPage(); };
    }

    await renderPage();
}

async function renderProfileHeader(name) {
    const header = profileMenu.querySelector('#profileHeader');
    if (!header) return;

    // Get pocketbase player object via querying with name given by server on auth
    const u = await getUserByName(name);
    const username = u?.name || u?.username || 'Player';

    currentProfileUsername = username;

    // Fetch stats via username query
    const stats = await fetchPlayerStats(pb, username) || {};
    const avg = stats?.avg_finish ?? null;

    // Create elements
    const img = document.createElement('img');
    const nameDiv = document.createElement('div');
    const avgDiv = document.createElement('div');
    const leftWrapper = document.createElement('div');

    // Avatar
    if (u?.id && u?.avatar) {
        const url1x = pbAvatarUrl(u.id, u.avatar, '100x100');
        const url2x = pbAvatarUrl(u.id, u.avatar, '200x200');
        img.src = url1x;
        img.srcset = `${url1x} 1x, ${url2x} 2x`;
        img.sizes = '4rem';
    } else {
        img.src = '/src/css/background/avatar-placeholder.png';
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
    }

    img.alt = username;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'w-16 h-16 object-cover rounded-md border border-gray-300 dark:border-gray-600 shadow-sm';
    img.style.aspectRatio = '1 / 1';

    // Username
    nameDiv.textContent = username;
    nameDiv.className = 'text-xl font-semibold text-gray-900 dark:text-white truncate ml-3';

    // Left side (avatar + name)
    leftWrapper.className = 'flex items-center gap-3';
    leftWrapper.append(img, nameDiv);

    const tier = getAvgTier(avg);

    avgDiv.textContent = avg !== null ? avg.toFixed(3) : '—';
    avgDiv.className = [
        // core badge look
        'px-4 py-1 rounded-lg tracking-wider whitespace-nowrap font-extrabold text-3xl',
        'border shadow-md', tier.ring,
        // dynamic colors
        tier.text, tier.bg, tier.border
    ].join(' ');

    // Inject into header
    header.innerHTML = '';
    header.className = [
        "flex items-center justify-between p-2 rounded-lg border shadow-sm",
        // use tier’s bg + border color for contrast
        tier.bg, tier.border,
        // fallback for text and dark mode
        "dark:text-gray-100 transition-colors"
    ].join(" ");
    header.append(leftWrapper, avgDiv);

    // stats strip
    // remove an existing strip if present
    const oldStrip = profileMenu.querySelector('#profileStatsStrip');
    if (oldStrip) oldStrip.remove();

    const oldPctStrip = profileMenu.querySelector('#profileStatsPercentageStrip');
    if (oldPctStrip) oldPctStrip.remove();

    // Helpers
    const gp = stats.games_played ?? 0;
    const wins = stats.wins ?? 0;
    const seconds = stats.seconds ?? 0;
    const thirds = stats.thirds ?? 0;
    const fourths = stats.fourths ?? 0;        // treated as "Losses"
    const top2 = (wins + seconds) | 0;
    const winRate = gp ? (wins / gp) : 0;
    const top2Rate = gp ? (top2 / gp) : 0;
    const pct = (x) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');

    const statsStrip = document.createElement('div');
    statsStrip.id = 'profileStatsStrip';
    statsStrip.className = `
        mt-5
        bg-gray-50
        border border-gray-200 dark:border-gray-700
        rounded-lg shadow-sm
        overflow-x-auto
    `;

    const statsPercentageStrip = document.createElement('div');
    statsPercentageStrip.id = 'profileStatsPercentageStrip';
    statsPercentageStrip.className = `
        mt-2
        bg-gray-50
        border border-gray-200 dark:border-gray-700
        rounded-lg shadow-sm
        overflow-x-auto
    `;

    const row = document.createElement('div');
    row.className = `
        flex gap-2 p-2
        min-w-full
        justify-between
    `;

    // --- Second row: percentage stats ---
    const row2 = document.createElement('div');
        row2.className = `
        flex gap-2 p-2
        min-w-full
        justify-between
    `;

    // Pill builder
    const makePill = (label, value, title = '') => {
        const wrap = document.createElement('div');
        wrap.className = `
            flex flex-col items-center justify-center
            w-20 
            px-1 py-1 rounded-md
            bg-gray-50 dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            shrink-0
        `;
        if (title) wrap.title = title;

        const v = document.createElement('div');
        v.className = 'text-[16px] font-semibold text-gray-900 dark:text-gray-100 leading-none';
        v.textContent = value;

        const l = document.createElement('div');
        l.className = 'text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-1';
        l.textContent = label;

        wrap.append(v, l);
        return wrap;
    };

    // thinner pill builder (percentages)
    const makePill2 = (label, value, title = '') => {
        const wrap = document.createElement('div');
        wrap.className = `
            flex flex-col items-center justify-center
            w-20
            px-1 py-1 rounded-md   /* thinner */
            bg-gray-50 dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            shrink-0
        `;
        if (title) wrap.title = title;

        const v = document.createElement('div');
        v.className = 'text-[16px] font-semibold text-gray-900 dark:text-gray-100 leading-none';
        v.textContent = value;

        const l = document.createElement('div');
        l.className = 'text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5';
        l.textContent = label;

        wrap.append(v, l);
        return wrap;
    };

    row.append(
        makePill('Games', gp),
        makePill('Wins', wins),
        makePill('Seconds', seconds),
        makePill('Thirds', thirds),
        makePill('Losses', fourths)
    );

    // individual rates (safe if gp === 0)
    const winPct    = pct(winRate);
    const secondPct = pct(gp ? seconds / gp : 0);
    const thirdPct  = pct(gp ? thirds / gp : 0);
    const lossPct   = pct(gp ? fourths / gp : 0);
    const top2Pct   = pct(top2Rate);

    row2.append(
        makePill2('Top 2 %', top2Pct),
        makePill2('Win %', winPct),
        makePill2('Second %', secondPct),
        makePill2('Third %', thirdPct),
        makePill2('Loss %', lossPct),
    );

    statsStrip.append(row);
    statsPercentageStrip.append(row2);

    // Insert strip *below* the header
    header.insertAdjacentElement('afterend', statsStrip);
    statsStrip.insertAdjacentElement('afterend', statsPercentageStrip);
}

async function renderProfileTable(username) {
    const statsPercentageStrip = document.getElementById("profileStatsPercentageStrip");
    if (!statsPercentageStrip) {
        console.warn("profileStatsPercentageStrip not found");
        return;
    }

    document.getElementById("profileStatsTable")?.remove();

    const wrapper = document.createElement("div");
    wrapper.id = "profileStatsTable";
    wrapper.className =
        "mt-5 overflow-x-auto rounded-xl border border-gray-300 dark:border-gray-700 shadow-md bg-white dark:bg-gray-900";
    const table = document.createElement("table");
    table.className =
        "min-w-full text-sm text-left divide-y divide-gray-200 dark:divide-gray-700";

    // Header
    const thead = document.createElement("thead");
    thead.className =
        "bg-emerald-600 dark:bg-emerald-700 text-white dark:text-gray-100 uppercase text-xs tracking-wider";
    thead.innerHTML = `
        <tr>
            <th class="px-4 py-3 font-semibold">Game ID</th>
            <th class="px-4 py-3 font-semibold">First</th>
            <th class="px-4 py-3 font-semibold">Second</th>
            <th class="px-4 py-3 font-semibold">Third</th>
            <th class="px-4 py-3 font-semibold">Fourth</th>
            <th class="px-4 py-3 font-semibold">Date</th>
        </tr>
    `;

    // Body
    const tbody = document.createElement("tbody");
    tbody.className =
        "divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900";

    // Footer / Pager
    const footer = document.createElement("div");
    footer.className =
        "flex items-center justify-between gap-3 px-4 py-3 bg-gray-100 border-t border-gray-300 dark:border-gray-700 rounded-b-xl";

    const info = document.createElement("span");
    info.className = "text-xs text-gray-700 dark:text-gray-400";

    function makeBtn(label, title) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = title || label;
        btn.className =
            "px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium shadow-sm transition";
        btn.textContent = label;
        return btn;
    }

    const firstBtn = makeBtn("« First", "First page");
    const prevBtn = makeBtn("‹ Prev", "Previous page");
    const nextBtn = makeBtn("Next ›", "Next page");
    const lastBtn = makeBtn("Last »", "Last page");

    const pager = document.createElement("div");
    pager.className = "flex items-center gap-2";
    pager.append(firstBtn, prevBtn, info, nextBtn, lastBtn);

    footer.append(pager);

    table.append(thead, tbody);
    wrapper.append(table, footer);
    statsPercentageStrip.insertAdjacentElement("afterend", wrapper);

    // Pagination state
    let page = 1;
    const perPage = 6;

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

    async function renderPage() {
        const res = await fetchGameResultsForUsername(pb, username, {
            page,
            perPage,
            sort: "-created",
        });

        tbody.innerHTML = "";
        if (!res.items.length) {
            tbody.innerHTML =
                `<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500 dark:text-gray-400 italic">No games yet</td></tr>`;
        } else {
            res.items.forEach((row, i) => {
                const tr = document.createElement("tr");
                tr.className =
                (i % 2 === 0 ? "bg-gray-200" : "bg-white dark:bg-gray-900") +
                " hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors";

                // helpers
                const td = (cls, text) => {
                    const c = document.createElement("td");
                    c.className = cls;
                    c.textContent = text; // << safe
                    return c;
                };

                tr.append(
                    td("px-4 py-2 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap", row.id),
                    td("px-4 py-2 text-xs truncate", row.first  ?? "—"),
                    td("px-4 py-2 text-xs truncate", row.second ?? "—"),
                    td("px-4 py-2 text-xs truncate", row.third  ?? "—"),
                    td("px-4 py-2 text-xs truncate", row.fourth ?? "—"),
                    td("px-4 py-2 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap", fmtDate(row.created))
                );

                tbody.appendChild(tr);
            });
        }

        info.textContent = `Page ${res.page} of ${res.totalPages} • ${res.totalItems} games`;

        firstBtn.disabled = res.page <= 1;
        prevBtn.disabled = res.page <= 1;
        nextBtn.disabled = res.page >= res.totalPages;
        lastBtn.disabled = res.page >= res.totalPages;

        firstBtn.onclick = () => { clickSounds[0].play(); page = 1; renderPage(); };
        prevBtn.onclick = () => { clickSounds[0].play(); if (page > 1) page -= 1; renderPage(); };
        nextBtn.onclick = () => { clickSounds[2].play(); page += 1; renderPage(); };
        lastBtn.onclick = () => { clickSounds[2].play(); page = res.totalPages; renderPage(); };

        // Turn Game IDs in column 1 into clickable links
        tbody.querySelectorAll("td:nth-child(1)").forEach(td => {
            const id = td.textContent.trim();
            if (id) {
                const a = document.createElement("a");
                a.href = "#";
                a.dataset.gameId = id;
                a.textContent = id;
                a.className = "text-current no-underline hover:underline"; // inherit font + color
                td.textContent = "";
                td.appendChild(a);
            }
        });

        // Turn names in columns 2–5 into clickable links
        tbody.querySelectorAll("td:nth-child(2), td:nth-child(3), td:nth-child(4), td:nth-child(5)")
        .forEach(td => {
            const name = td.textContent.trim();
            if (name && name !== "—") {
                const a = document.createElement("a");
                a.href = "#";
                a.dataset.username = name;
                a.textContent = name;
                a.className = "text-blue-700 dark:text-blue-400 hover:underline";
                td.textContent = "";
                td.appendChild(a);
            }
        });
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
            gameProfileMenu.classList.remove("hidden");
            // (we’ll populate its content next step)
            clickSounds[2].play();
            //await renderGameProfileBody
            openGameProfile(gameId, gameProfileMenu);
        }
    }
});

// helper: safe avatar url (uses your pbAvatarUrl if present)
function getAvatarUrl(user) {
    if (!user) return "/src/css/background/avatar-placeholder.png";
    try {
        if (typeof pbAvatarUrl === "function") {
        return pbAvatarUrl(user.id, user.avatar, "100x100");
        }
    } catch (_) {}
    // Fallback PocketBase thumb URL shape (adjust if your helper differs)
    if (user?.collectionId && user?.avatar) {
        return `${pb.baseUrl}/api/files/${user.collectionId}/${user.id}/${user.avatar}?thumb=100x100`;
    }
    return "/src/css/background/avatar-placeholder.png";
}

// tiny badge style for places
function placeBadge(place) {
    const styles = {
        "1st": "bg-yellow-100 text-yellow-800 border-yellow-200",
        "2nd": "bg-gray-100 text-gray-800 border-gray-200",
        "3rd": "bg-amber-100 text-amber-800 border-amber-200",
        "Loser": "bg-rose-100 text-rose-800 border-rose-200",
    };
    return `inline-block text-[10px] px-1.5 py-0.5 rounded border ${styles[place] || "bg-gray-100 text-gray-700 border-gray-200"}`;
}

// compact player card (similar vibe to lobby cards, minus “ready”)
function playerCard(placeLabel, user) {
    const name = user?.name ?? "—";
    const avatar = getAvatarUrl(user);

    const wrap = document.createElement('div');
    wrap.className = "flex flex-col items-center space-y-1 mb-2";

    const img = document.createElement('img');
    img.src = avatar;
    img.alt = name;
    img.className = "w-12 h-12 rounded-md object-cover border border-gray-200 dark:border-gray-700";
    img.loading = "lazy";

    const nameDiv = document.createElement('div');
    nameDiv.className = "text-xs font-medium text-gray-900 dark:text-gray-100";
    nameDiv.textContent = name;

    const badge = document.createElement('span');
    badge.className = placeBadge(placeLabel);
    badge.textContent = placeLabel;

    wrap.append(img, nameDiv, badge);
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

// 1) Make each card a fixed-size box so every glyph occupies same visual slot
function cardSpan(card) {
    const sym = rankToSymbol(Number(card.rank));
    const suitChar = ['♦','♣','♥','♠'][card.suit] ?? '?';
    const label = `${sym}${suitChar}`;
    const glyph = cardGlyph(card);
    const isRed = card.suit === 0 || card.suit === 2;

    return `
        <span
        class="inline-flex w-20 h-22 items-center justify-center text-[4rem] leading-none
                ${isRed ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}
                align-middle select-none"
        title="${label}" aria-label="${label}">
        ${glyph}
        </span>
    `;
}

// 2) Use a two-column grid so the cards always start at the same x-position
function historyRow(h, idx) {
    const who = h?.username ?? `Seat ${h?.seat ?? '?'}`;
    const action = h?.action ?? 'play';
    const cards = Array.isArray(h?.cards) ? h.cards.map(cardSpan).join('') : '';

    return `
        <div class="grid grid-cols-[12rem,1fr] gap-3 py-1.5 px-2
                    hover:bg-gray-100/70 dark:hover:bg-gray-800/60 rounded">
        <div class="min-w-0">
            <div class="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
            ${idx + 1}. ${who} <span class="opacity-70">(${action})</span>
            </div>
        </div>

        <div class="flex flex-wrap gap-x-1 gap-y-1">
            ${cards || `<span class="text-xs opacity-70">—</span>`}
        </div>
        </div>
    `;
}

// Build the scrollable HTML
function renderHistoryAsCards(playedHistory, cap = 200) {
    const total = Array.isArray(playedHistory) ? playedHistory.length : 0;
    const rows = (playedHistory || [])
        .slice(0, cap)
        .map((h, i) => historyRow(h, i))
        .join('');
    const more = total > cap ? `<div class="px-2 py-1 text-[11px] opacity-70">…and ${total - cap} more</div>` : '';
    return `
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div class="max-h-[21rem] overscroll-contain overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
            ${rows || `<div class="px-3 py-2 text-xs opacity-70">No turns recorded</div>`}
            ${more}
            </div>
        </div>
        </div>`;
}

// function handles opening another player's profile from gameProfileMenu
async function openGameProfile(gameId, container = document.getElementById("gameProfileMenu")) {
    if (!container) return;
    const body = container.querySelector('#gameProfileBody');
    if (!body) return;

    // Unhide + loading state (only the body, keep header/close button intact)
    container.classList.remove("hidden");
    body.innerHTML = `
        <div class="p-4 text-sm text-gray-600 dark:text-gray-300">Loading game ${gameId}…</div>
    `;

    try {
        const game = await pb.collection("game_results").getOne(gameId, {
            expand: "first,second,third,fourth",
        });

        // keep playedHistory handy for the next step
        const playedHistory = Array.isArray(game?.playedHistory) ? game.playedHistory : [];

        const createdStr = game?.created ? new Date(game.created).toLocaleString() : "—";
        const first  = game.expand?.first   ?? null;
        const second = game.expand?.second  ?? null;
        const third  = game.expand?.third   ?? null;
        const fourth = game.expand?.fourth  ?? null; // loser

        // Header row (like your profile header vibe, but lightweight)
        const header = `
        <div class="px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="flex items-center gap-3">
            <div class="text-base font-semibold text-gray-900 dark:text-gray-100">Game <span class="text-blue-600 dark:text-blue-400">${game.id}</span></div>
            </div>
            <div class="text-xs text-gray-600 dark:text-gray-300">Played: ${createdStr}</div>
        </div>
        `;

        // Players grid — mirrors the lobby’s compact card feel
        const playersSectionHtml = `
            <div class="mt-4 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg mb-6 border 
                        border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 shadow-inner">
                <div id="playersGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-3"></div>
            </div>
            `;

        // 
        const historyPreview = renderHistoryAsCards(playedHistory);

        // inject the strings, then append the card nodes
        body.innerHTML = `${header}${playersSectionHtml}${historyPreview}`;

        const grid = body.querySelector('#playersGrid');
        grid.append(
            playerCard("1st", first),
            playerCard("2nd", second),
            playerCard("3rd", third),
            playerCard("Loser", fourth),
        );

        // return for any follow-up logic
        return { game, playedHistory };
    } catch (err) {
        console.error("Failed to fetch game:", err);
        body.innerHTML = `
        <div class="p-4 text-red-500">Error loading game data.</div>
        `;
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
        

        async function openProfile() {
            // show popup above everything
            clickSounds[2].play();
            profileMenu.classList.remove('hidden');
            await renderProfileHeader(username); // populate header from PB, will update to get profile via username
            await renderProfileTable(username);
        }

        async function openLeaderboard() {
            clickSounds[2].play();
            leaderboardMenu.classList.remove('hidden');
            await renderLeaderboardMenu('avg');
        }

        function closeProfile() {
            clickSounds[0].play();
            profileMenu.classList.add('hidden');
        }

        function closeGameProfile() {
            clickSounds[0].play();
            gameProfileMenu.classList.add('hidden');
        }

        function closeLeaderboard() {
            clickSounds[0].play();
            leaderboardMenu.classList.add('hidden');
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
        joinRoomMenu.style.display = "block";

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
                img.src = '/src/css/background/avatar-placeholder.png';
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
                    input.style.display = 'none';
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
                    return;
                }
                if (file.size > 2 * 1024 * 1024) { // 2 MB
                    console.warn('File too large (>2MB).');
                    return;
                }

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
                }
            });
        })();

        // Handler for updating available rooms
        function updateAvailableRooms(availableRooms) {
            availableRoomsDiv.innerHTML = `
                <h3 class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-2">
                Available Rooms
                </h3>
            `;

            if (!availableRooms?.length) {
                const p = document.createElement('p');
                p.className = 'text-sm text-gray-500 dark:text-gray-400';
                p.textContent = 'No available rooms';
                availableRoomsDiv.appendChild(p);
                return;
            }

            availableRooms.forEach(({ roomCode, numClients, usernames = [] }) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.roomCode = roomCode;
                btn.disabled = numClients >= 4;

                btn.className = [
                    'room-button', 
                    'w-full text-left select-none',
                    'rounded-xl border border-gray-200 dark:border-gray-700',
                    'bg-white dark:bg-gray-900',
                    'hover:bg-indigo-50 dark:hover:bg-gray-800',       // soft background tint on hover
                    'hover:border-indigo-300 dark:hover:border-indigo-500', // subtle border glow
                    'hover:shadow-md dark:hover:shadow-lg',             // lift effect
                    'transition-all duration-200 ease-out',             // smooth animation
                    'active:scale-[0.98]',                              // click press feedback
                    'px-4 py-3 shadow-sm',
                    'cursor-pointer',
                    'disabled:opacity-60 disabled:cursor-not-allowed'
                ].join(' ');

                const names = usernames.length ? usernames.join(', ') : '—';
                const capacityBadge =
                numClients >= 4
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';

                btn.innerHTML = `
                    <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">Room ${roomCode}</span>
                        <span class="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${capacityBadge}">
                            ${numClients}/4
                        </span>
                        </div>
                        <div id="roomNames" class="flex-1 text-right truncate text-xs text-gray-600 dark:text-gray-400"></div>
                    </div>
                `;
                btn.querySelector('#roomNames').textContent = names; 

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
                joinRoomMenu.style.display = "none";

                resolve(result);
            };

            const onError = (message) => {
                if (settled) return;
                
                isJoiningRoom = false;
                // Show the error but keep menu visible so user can try again
                errorMessage2.innerText = message;
                errorMessage2.style.display = 'block';
                joinRoomMenu.style.display = 'block';
            };

            const onRejoin = () => {
                console.log("successfully rejoined");
                settle({ socket, roomCode, isRejoin: true });
            };

            const onJoined = () => {
                console.log("Joined room successfully");
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

    let resolver;

    // --- hide in-game UI ---
    document.getElementById("play").style.display = "none";
    document.getElementById("clear").style.display = "none";
    document.getElementById("pass").style.display = "none";
    document.getElementById("gameInfo").style.display = "none";

    const playerInfoDivs = document.getElementsByClassName("playerInfo");
    for (let div of playerInfoDivs) div.style.display = "none";

    // always rebuild resultsContainer so single-player can never rely on stale DOM
    const resultsContainer = endMenu.querySelector("#resultsContainer");
    if (!resultsContainer) {
        console.warn("[spEndMenu] #resultsContainer not found inside #endMenu");
    } else {
        resultsContainer.innerHTML = `
        <div class="bg-gray-50  shadow-md rounded-md p-4 mx-auto max-w-sm w-full mt-2 mb-6
            border border-gray-100">
            <h2 class="text-xl font-semibold mb-3 text-gray-900 text-center">Single Player Results</h2>
            <div id="endMenuSummary" class="text-center text-sm text-gray-700 mb-3"></div>
            <ul id="endMenuLeaderboard" class="divide-y divide-gray-200"></ul>
        </div>
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
        li.className = "flex items-center justify-between py-2";

        li.innerHTML = `
            <div class="flex items-center">
            <span class="place text-lg font-semibold mr-4 text-gray-700"></span>
            <img class="player-avatar w-8 h-8 rounded-md border border-gray-300 mr-4 object-cover" alt="avatar">
            <span class="name text-gray-800 font-semibold"></span>
            </div>
            <span class="player-avg text-gray-800 font-semibold"></span>
        `;

        li.querySelector(".place").textContent = String(i + 1);
        li.querySelector(".name").textContent = name;
        li.querySelector(".player-avg").textContent = `${total} (+${earned})`;

        const img = li.querySelector(".player-avatar");
        img.src = `/src/css/background/${p.avatar}`;
        img.onerror = () => {
            img.onerror = null;
            img.src = "/src/css/background/player.png";
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
            ? `You placed #${playerPlace} — +${myEarned} pts (Total: ${myTotal})`
            : `+${myEarned} pts (Total: ${myTotal})`;

        if (matchWinner) {
            const wName = matchWinner.name;
            summary.textContent = `${base} • MATCH OVER: ${wName} wins!`;
        } else {
            // optional: show match target reminder
            summary.textContent = `${base} • First to ${TARGET_POINTS} (win by ${WIN_BY})`;
        }
    }

    // --- buttons
    continueBtn.textContent = "Play Again";
    backBtn.textContent = "Back";

    const handleContinue = () => {
        clickSounds?.[0]?.play?.();
        cleanup();
        endMenu.style.display = "none";

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
        endMenu.style.display = "none";

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

    endMenu.style.display = "block";
    return new Promise((resolve) => { resolver = resolve; });
}


async function endMenu(socket, roomCode, results) {
    const endMenu   = document.getElementById("endMenu");
    const continueBtn = document.getElementById("continueButton");         
    const backBtn     = document.getElementById("backToJoinRoomButton2"); 

    let isReady = false;
    let resolver;

    // hide play/pass/gameInfo/playerInfo
    document.getElementById("play").style.display = "none";
    document.getElementById('clear').style.display = "none";
    document.getElementById("pass").style.display = "none";
    document.getElementById("gameInfo").style.display = "none";

    const playerInfoDivs = document.getElementsByClassName("playerInfo");
    for (let div of playerInfoDivs) {
        div.style.display = "none";
    }

    // Create a clean leaderboard layout
    const resultsContainer = endMenu.querySelector("#resultsContainer");
    resultsContainer.innerHTML = `
    <div class="bg-gray-50 shadow-md rounded-md p-4 mx-auto max-w-sm w-full mt-2 mb-12
        border border-gray-100">
        <h2 class="text-xl font-semibold mb-4 text-gray-900 text-center">Game Results</h2>
        <ul id="resultsList" class="divide-y divide-gray-200"></ul>
    </div>
    `;

    const ul = resultsContainer.querySelector("#resultsList");
    const preMap = getPreGameAvgMap(); // { [pbId]: avg_before }

    // populate endMenu results container
    for (let i = 0; i < results.length; i++) {
        const name = results[i];
        const place = i + 1;

        // try PB avatar, and also capture pbId for stats
        let avatar = "/src/css/background/avatar-placeholder.png";
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
                const color = delta >= 0 ? 'text-rose-500' : 'text-emerald-500'; // make avg delta text red if plus and green if minus
                pointsHtml = `<span class="font-semibold">${avgNow.toFixed(3)}</span> <span class="${color}">(${sgn}${delta.toFixed(3)})</span>`;
                } else {
                // no snapshot → just show current
                pointsHtml = `<span class="font-semibold">${avgNow.toFixed(3)}</span>`;
                }
            }
        } catch (e) {
        console.warn('avg render failed for', name, pbId, e);
        }

        const li = document.createElement("li");
        li.className = "flex items-center justify-between py-2";
        if (i !== results.length - 1) {
            li.classList.add("border-b", "border-gray-200");
        }

        li.innerHTML = `
        <div class="flex items-center">
            <span class="place text-lg font-semibold mr-4 text-gray-700"></span>
            <img src="${avatar}" alt="" class="w-8 h-8 rounded-md border border-gray-300 mr-4 object-cover">
            <span class="name text-gray-800 font-semibold"></span>
        </div>
        <span class="player-avg">${pointsHtml}</span> <!-- numeric HTML we generate -->
        `;

        // set dynamic string fields safely
        li.querySelector('.place').textContent = String(place);
        li.querySelector('.name').textContent  = name ?? "—";

        ul.appendChild(li);
    }

    endMenu.style.display = "block";

    // label helper
    const setContinueLabel = (count) => {
        continueBtn.textContent = isReady
        ? `Uncontinue ${count}/4`
        : `Continue ${count}/4`;
    };

    // toggle my ready state; server will rebroadcast counts
    const toggleReadyState = () => {
        isReady = !isReady; // optimistic local toggle
        socket.emit('toggleReadyState', roomCode, isReady);
    };

    // leave to join room
    const handleBackClick = () => {
        clickSounds[0].play();
        socket.emit('leaveRoom', roomCode);
        cleanup();
        endMenu.style.display = "none";
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
        endMenu.style.display = "none";
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

    // Display lobbyMenu
    lobbyMenu.style.display = "block";
    
    function updateClientList(clientList = []) {
        // 1) reset the container each render
        connectedClientsDiv.innerHTML = ``;

        if (!clientList.length) {
            const p = document.createElement('p');
            p.className = 'm-0 text-sm text-gray-500 dark:text-gray-400';
            p.textContent = 'No players connected';
            connectedClientsDiv.appendChild(p);
            return;
        }

        // 2) build a fresh grid
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-4 gap-3 mt-2 justify-items-center';

        clientList.forEach(c => {
            const wrapper = document.createElement('div');
            wrapper.className = 'flex flex-col items-center space-y-1 mb-2';

            // avatar
            const img = document.createElement('img');

            // If this entry is ME, prefer my freshly-synced authStore record
            const isMe = (c.pbId && pb?.authStore?.model?.id && String(c.pbId) === String(pb.authStore.model.id));
            const freshAvatarFile = isMe ? pb.authStore.model.avatar : c.avatar;

            const url1x = pbAvatarUrl(c.pbId, freshAvatarFile, '100x100');
            const url2x = pbAvatarUrl(c.pbId, freshAvatarFile, '200x200');
            if (url1x) {
                img.src = url1x;
                img.srcset = `${url1x} 1x, ${url2x} 2x`;
                img.sizes = '48px';
            } else {
                img.src = '/src/css/background/avatar-placeholder.png';
            }
            img.className = [
            'w-12 h-12 object-cover rounded-md border shadow-sm',
            c.isReady ? 'border-emerald-500 dark:border-emerald-400'
                        : 'border-gray-300 dark:border-gray-600 opacity-80'
            ].join(' ');
            img.alt = c.username;

            // username
            const name = document.createElement('div');
            name.className = 'text-xs font-medium text-gray-700 dark:text-gray-300 text-center';
            name.textContent = c.username;

            // ready badge
            const badge = document.createElement('div');
            badge.className = [
            'text-[10px] px-2 py-[1px] rounded-full mt-0.5',
            c.isReady ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-gray-200 text-gray-500 dark:text-gray-400'
            ].join(' ');
            badge.textContent = c.isReady ? '✅ Ready' : '💤 Waiting';

            wrapper.append(img, name, badge);
            grid.appendChild(wrapper);
        });

        // 3) append exactly one grid per render
        connectedClientsDiv.appendChild(grid);
    }


    // Function to append a message to the message container
    function appendMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.textContent = message;
        messageContainer.appendChild(messageElement);
        messageContainer.scrollTop = messageContainer.scrollHeight; // Auto scroll to the bottom
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
            readyButton.textContent = myReadyNow
                ? `Unready up ${readyPlayersCount}/4`
                : `Ready up ${readyPlayersCount}/4`;
            
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
        
            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";

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

            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";

            resolve('goBackToJoinRoomMenu');
        }
    });
}

function renderSinglePlayerInfo(el, player, i) {
    if (!el) return;

    // container
    el.style.display = 'flex';
    el.style.flexDirection = 'column'; // 👈 stack vertically
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

    const fallback = `/avatars/default${i + 1}.png`;

    const localAvatarPath = player?.avatar
        ? `./src/css/background/${player.avatar}`
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

    // container
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '0.25rem';
    el.style.borderRadius = '0.5rem';
    el.style.padding = '0.2rem 0.3rem';
    el.style.backgroundColor = 'rgba(255,255,255,0.9)';
    el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    el.style.width = 'fit-content';
    el.style.minWidth = '0';
    el.style.justifyContent = 'center';

    // mirror p3 (right side)
    const mirrored = i === 3;
    el.style.flexDirection = mirrored ? 'row-reverse' : 'row';

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
    img.className = 'w-8 h-8 object-cover border border-gray-300 rounded-md box-border';
    img.style.aspectRatio = '1 / 1';
    img.style.flexShrink = '0';
    img.alt = player.username || `Player ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // name
    const name = document.createElement('div');
    name.className = 'font-medium text-gray-800 dark:text-gray-800';
    name.textContent = player.username || `Player ${i + 1}`;
    name.style.whiteSpace = 'nowrap';
    name.style.textAlign = mirrored ? 'right' : 'left';

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
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const clearButton = document.getElementById("clear");
    const gameInfo = document.getElementById("gameInfo");
    const playerInfo = document.getElementsByClassName("playerInfo");

    // make sure gameInfo starts blank/neutral
    if (gameInfo) {
        gameInfo.textContent = '—';
    }

    playButton.style.display = "block";
    passButton.style.display = "block";
    clearButton.style.display = "block";
    gameInfo.style.display = "block";

    // show names here 
    for (let i = 0; i < playerInfo.length; i++) {
        playerInfo[i].style.display = 'block';
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

        GameModule.players[0].username = 'player';
        GameModule.players[0].clientId = 'sp-0';
        GameModule.players[0].socketId = 'sp-0';
        GameModule.players[0].avatar   = 'player.png';

        // replace GameModule opponents with singlePlayerOpponents
        GameModule.players.splice(1, 3, ...bots);

        await loadPolicyModel("./src/js/policy/model.json");
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
    
    console.log(results);
    return results;

    //implement continue menu copying the multiplayer one
}


// once all four clients toggle toggleReadyState, call startGameForRoom function on server and update local gamestate to match server generated one 
async function startGame(socket, roomCode){
    //unhide buttons and gameInfo divs
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const clearButton = document.getElementById("clear");
    const gameInfo = document.getElementById("gameInfo");
    const playerInfo = document.getElementsByClassName("playerInfo");
    let firstDealClientId;

    // make sure gameInfo starts blank/neutral
    if (gameInfo) {
        gameInfo.textContent = '—';
    }
    
    playButton.style.display = "block";
    passButton.style.display = "block";
    clearButton.style.display = "block";
    gameInfo.style.display = "block";

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
            playerInfo[i].style.display = 'block';
        }

        // wait for playersSnapshot (replacement for initialGameState)
        const playersSnapshotPromise = new Promise(resolve => {
            socket.once('playersSnapshot', ({ players, isFirstMove }) => {
                // set isFirstMove to true
                GameModule.isFirstMove = isFirstMove;
                // Using unique socket id, assign the appropriate index
                const localPlayerIndex = players.findIndex(p => p.socketId === GameModule.players[0].socketId);
                console.log("LOCAL PLAYER INDEX:", localPlayerIndex);

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

                console.log()

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
        console.log("emitted readyForStart");

        // wait for data to flow in
        await playersSnapshotPromise;
        const firstTurnClientId = await firstTurnPromise;
        await visualDealPromise;

        // Main game loop, returns array of usernames in finishing order
        // before calling gameLoop
        gmCancelToken('startGame');
        gmNewToken('startGame');
        const results = await gameLoop(roomCode, socket, firstTurnClientId, false);
        
        console.log(results);
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


function hideButton(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
}

function removeAllGameElements() {
    // 0) Cards are dynamic → nuke them from the DOM
    unmountAllCards();

    // just hide buttons, listener clean up is handled in player.js
    hideButton('play');
    hideButton('pass');
    hideButton('clear');

    // 2) Game info HUD → hide + CLEAR TEXT
    const gi = document.getElementById('gameInfo');
    if (gi) { 
        gi.style.display = 'none';
        gi.textContent = '';        // ensure no stale text
    }

    // 3) Player panels → hide & clear any turn styling
    const panels = document.getElementsByClassName('playerInfo');
    for (let i = 0; i < panels.length; i++) {
        panels[i].style.display = 'none';
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

        card.setSide(faceUp ? 'front' : 'back');
        card.animateTo({ delay: 0, duration: 0, ease: 'linear', rot, x, y, z: i + 1 });

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
        socket.off?.('room:paused', onRoomPaused);
        socket.off?.('room:resumed', onRoomResumed);
        socket.off?.('room:forceReset', onRoomForceReset);
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
        const playButton = document.getElementById("play");
        const passButton = document.getElementById("pass");
        const clearButton = document.getElementById("clear");
        const gameInfo = document.getElementById("gameInfo");
        const playerInfo = document.getElementsByClassName("playerInfo");

        // make sure gameInfo starts blank/neutral
        if (gameInfo) {
            gameInfo.textContent = '—';
        }
    
        playButton.style.display = "block";
        passButton.style.display = "block";
        clearButton.style.display = "block";
        gameInfo.style.display = "block";

        GameModule.isFirstMove = isFirstMove;
        GameModule.lastValidHand = lastValidHand;

        console.log("isFirstMove")
        console.log(GameModule.isFirstMove)

        // 3) Ensure our local player has the current socket id
        GameModule.players[0].socketId = socket.id;

        const localPlayerIndex = players.findIndex(p => p.socketId === GameModule.players[0].socketId);

        console.log("LOCAL PLAYER INDEX:", localPlayerIndex);

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
        console.log(GameModule.turn);
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
                const yGC = anchorYGC + (i * STACK_DRIFT);

                // convert GC to gameDeck local space
                const { x, y } = gcToLocal(xGC, yGC, stage);

                card.animateTo({
                    delay: 0,
                    duration: 0,
                    ease: 'linear',
                    rot: 0,
                    x,
                    y,
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
            const centerLocal = gcToLocal(centerGC.x, centerGC.y, stage);

            gameDeck.forEach((c, i) => {
                const card = Deck.Card(i);
                card.rank = c.rank;
                card.suit = c.suit;
                card.setRankSuit(c.rank, c.suit);
                card.setSide('front');
                stage.appendChild(card.$el);
                GameModule.gameDeck.push(card);

                // lay out into rows of size n, centered on the table
                const col = i % n;                    // index within this hand
                const row = Math.floor(i / n);        // which prior hand (0,1,2,...)

                // offsets identical in spirit to your player.js:
                // x: spread around center; y: small downward drift per stacked hand
                const offX = ((col - mid) * CARD_GAP_X) - (row * STACK_DRIFT);
                const offY = (row * STACK_DRIFT);

                const x = centerLocal.x + offX;
                const y = centerLocal.y + offY;
                const rot = Math.random() * 5 + -5;

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
        console.log('Force reset:', reason);

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
        console.log("not arming")
        
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

function preventScrollAndZoom(targetId = 'gameContainer') {
    const el = document.getElementById(targetId);
    if (!el) return;

    let lastTouchEnd = 0;

    // Block double-tap scroll
    el.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) e.preventDefault();
        lastTouchEnd = now;
    }, { passive: false });

    // Block any dragging / edge scroll
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    // Block legacy pinch gestures (older iOS)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
}


window.onload = async function() {
    // finally lock scrolling/zoom for mobile
    //preventScrollAndZoom('gameContainer');

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
                console.log(results);
                
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

