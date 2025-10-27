import Player from "./player.js"
import Opponent from "./opponent.js"
import PocketBase from "https://cdn.jsdelivr.net/npm/pocketbase@0.21.1/dist/pocketbase.es.mjs";

// Lookup table for printing actual rank in last played hand
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

// Lookup table for printing suit icon in last played hand
const suitLookup = {
    0: '♦', // Diamonds
    1: '♣', // Clubs
    2: '♥', // Hearts
    3: '♠', // Spades
};

// Global flag: are we resuming a paused game?
window.isResume = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let isJoiningRoom = false;

const PB_URL = 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

function pbAvatarUrl(pbId, file, thumb='64x64') {
    if (!pbId || !file) return '';
    return pb.getFileUrl({ collectionId: '_pb_users_auth_', id: pbId }, file, { thumb });
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

    // GameModule properties
    let players = [player1, player2, player3, player4];
    let gameDeck = [];
    let playersFinished = []; //stores finishing order
    let lastHand = []; //stores last hand played
    let playedHistory = [] //stores played card history
    let isFirstMove = null;

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
        GameModule.isFirstMove = null;

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
    { leftPct: 0.50, topPct: 0.85, axis: 'x', dir: +1, rot: 0 },
    // seat 1 (left; fan down ↓)
    { leftPct: 0.06, topPct: 0.50, axis: 'y', dir: +1, rot: 90 },
    // seat 2 (top; fan along X ←)
    { leftPct: 0.50, topPct: 0.1, axis: 'x', dir: -1, rot: 0 },
    // seat 3 (right; fan up ↑)
    { leftPct: 0.952, topPct: 0.50, axis: 'y', dir: -1, rot: 90 },
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
    // target divs for each seat (0: you, 1: left, 2: top, 3: right)
    const p1Div = document.getElementById('0');
    const p2Div = document.getElementById('1');
    const p3Div = document.getElementById('2');
    const p4Div = document.getElementById('3');

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

// remove and add a border to playerInfo element based on turn
function displayTurn(turn) {
    const playerInfo = document.getElementsByClassName("playerInfo");

    for (let i = 0; i < playerInfo.length; i++) {
        // Reset all player boxes to their default color
        playerInfo[i].style.backgroundColor = "white";
        playerInfo[i].style.color = ""; // reset text color
    }

    // Highlight the current player's box with a contrasting fill
    const active = playerInfo[turn];
    active.style.backgroundColor = "#ffcc33"; // gold works beautifully on green felt
    active.style.color = "#000"; // ensure text stays readable
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

async function finishGameAnimation(roomCode, socket, gameDeck, players, losingPlayer){
    return new Promise(async function (resolve, reject) {
        // ---- anchor config: % within gameContainer ----
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
            await new Promise(() => {
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

function clearFinishedDeck() {
  const finishedDeckDiv = document.getElementById("finishedDeck");

  // remove all card elements from DOM
  finishedDeckDiv.querySelectorAll(".card").forEach(cardEl => cardEl.remove());

  // reset the data array
  GameModule.finishedDeck.length = 0;
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
            console.log("GameState LastValidHand:", GameModule.lastValidHand);
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
                    let finshedResults = playersFinished;
                    console.log(losingPlayer);

                    // Now it's safe to animate: all clients have acked the last hand,
                    // and gameDeck includes those last cards, unmount finishedDeck after animations, and reset gameState
                    await finishGameAnimation(roomCode, socket, GameModule.gameDeck, GameModule.players, losingPlayer);
                    await finishedGame(socket);

                    clearFinishedDeck(); //unmount finishedDeck cards

                    console.log(finshedResults);

                    GameModule.reset()
                    return finshedResults;
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
    const createAccountMenu  = document.getElementById("createAccountMenu");
    const form = createAccountMenu.querySelector("form");
    const emailInput = document.getElementById("email");
    const usernameInput = document.getElementById("usernameRegistration");
    const passInput = document.getElementById("caPassword");
    const pass2Input = document.getElementById("caRepeatPassword");
    const err = document.getElementById("errorMessageCA");
    const backBtn = document.getElementById("caBackButton");
    const registerBtn = form.querySelector('button[type="submit"]');

    createAccountMenu.classList.remove("hidden"); // also remove Tailwind's .hidden

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
            createAccountMenu.style.display = "none";
            createAccountMenu.classList.add("hidden");
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
                createAccountMenu.style.display = "none";
                createAccountMenu.classList.add("hidden");
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

//menu that allows users to enter a room number to join an available room
async function joinRoomMenu(socket) {
    return new Promise((resolve, reject) => {
        const joinRoomMenu = document.getElementById("joinRoomMenu");
        const availableRoomsDiv = document.getElementById('availableRooms');
        const errorMessage2 = document.getElementById("errorMessage2");
        let roomsClickBound = false;
        let onRoomsClick = null;

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

        // Function to request available rooms and update the available rooms div
        function refreshAvailableRooms() {
            // Request available rooms
            socket.emit('getAvailableRooms');
        }

        // Handler for updating available rooms
        function updateAvailableRooms(availableRooms) {
            //console.log('Available rooms:', availableRooms);

            // Clear the existing content and add the heading
            availableRoomsDiv.innerHTML = '<h3>Available Rooms</h3>';

            if (availableRooms.length === 0) {
                const noRoomsElement = document.createElement('p');
                noRoomsElement.textContent = 'No available rooms';
                availableRoomsDiv.appendChild(noRoomsElement);
            } else {
                availableRooms.forEach(({ roomCode, numClients }) => {
                    const roomButton = document.createElement('button');
                    roomButton.textContent = `${roomCode}: ${numClients}/4`;
                    roomButton.classList.add('room-button'); // Optional: Add a class for styling purposes
                    roomButton.dataset.roomCode = roomCode; // Assign roomCode to dataset
                    roomButton.disabled = numClients >= 4;
                    availableRoomsDiv.appendChild(roomButton);
                });
            }
        }
        
        // call once during setup
        addListenerRoomButton();

        // Initial request for available rooms, to immediately populate the UI with the current list of available rooms
        refreshAvailableRooms();

        // Set interval to refresh available rooms every 3 seconds and activate the following lines of code
        const refreshInterval = setInterval(refreshAvailableRooms, 3000);

        // Ensure the existing event listener is removed before adding a new one, these lines are activated when the setInterval goes off
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
                clearInterval(refreshInterval);
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

    const tbody = endMenu.querySelector("#resultsTbody");
    tbody.innerHTML = "";
    results.forEach((name, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i + 1}</td><td>${name}</td>`;
        if (i === 0) tr.style.fontWeight = "700";   // winner
        if (i === 3) tr.style.opacity = "0.85";     // 4th
        tbody.appendChild(tr);
    });

    endMenu.style.display = "block";

    // label helper
    const setContinueLabel = (count) => {
        continueBtn.textContent = isReady
        ? `Uncontinue ${count}/4`
        : `Continue ${count}/4`;
    };

    // toggle my ready state; server will rebroadcast counts
    const toggleReadyState = () => {
        isReady = !isReady;
        socket.emit('toggleReadyState', roomCode, isReady);
    };

    // leave to join room
    const handleBackClick = () => {
        socket.emit('leaveRoom', roomCode);
        cleanup();
        endMenu.style.display = "none";
        resolver && resolver('goBackToJoinRoomMenu');
    };

    // update counts/label from server
    const onUpdateReadyState = (clientList) => {
        const readyPlayersCount = clientList.filter(c => c.isReady).length;
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
    const messageContainer = document.getElementById("messageContainer");
    const messageInput = document.getElementById("messageInput");
    const sendMessageButton = document.getElementById("sendMessageButton");
    const readyButton = document.getElementById("readyButton");
    const backToJoinRoomButton = document.getElementById("backToJoinRoomButton");

    let isReady = false; // Track the local client's ready state

    // Display lobbyMenu
    lobbyMenu.style.display = "block";

    // Function to request clients and update the connectedClientsDiv
    function refreshClientList() {
        // Request client list
        socket.emit('getClientList', roomCode);
    }
    
    // Function to update the client list, takes in clientList event from server
    function updateClientList(clientList) {
       // Clear the existing content and add the heading
        connectedClientsDiv.innerHTML = `<h3>Players in Room ${roomCode}</h3>`;

        // Extract usernames from clientList & create an array to hold usernames with (host) tag if applicable
        const usernames = clientList.map(client => {
            return client.username;
        });
        
        // Display usernames in a single line
        const clientElement = document.createElement('p');
        clientElement.textContent = usernames.join(', '); // Join usernames with a comma and space
        connectedClientsDiv.appendChild(clientElement);
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

    // Initial request for clients in the room, to immediately populate the UI with the current list of clients
    refreshClientList();

    // Set interval to refresh available rooms every 0.5 seconds and activate the following lines of code
    const refreshInterval = setInterval(refreshClientList, 500);

    // Ensure the existing event listener is removed before adding a new one
    socket.off('clientList', updateClientList);
    socket.on('clientList', updateClientList);

    //If the client is readied up the text content of the button should change to ('unready up 1/4' and then if the client clicks the button again the button should read 'ready up 0/4')
    function toggleReadyState() {
        isReady = !isReady;
        socket.emit('toggleReadyState',roomCode, isReady);
    }

    readyButton.addEventListener("click", toggleReadyState);

    return new Promise((resolve) => {
        socket.on('updateReadyState', (clientList) => {
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
            backToJoinRoomButton.removeEventListener('click', handleBackClick); // <-- add this

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('gameStarted');
        
            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";
            clearInterval(refreshInterval);

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
            clearInterval(refreshInterval);

            resolve('goBackToJoinRoomMenu');
        }
    });
}

function renderPlayerInfo(el, player, i) {
    if (!el) return;

    // Compact, self-sized container
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '0.5rem';
    el.style.borderRadius = '0.5rem';
    el.style.padding = '0.2rem 0.3rem';
    el.style.backgroundColor = 'rgba(255,255,255,0.9)';
    el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    el.style.width = 'fit-content';     // keeps it only as wide as needed
    el.style.minWidth = '0';            // prevents flex weirdness if nested
    el.style.justifyContent = 'center'; // centers contents horizontally

    // Clear previous content
    el.textContent = '';

    // --- Avatar (exact 32x32 render, 100x100 intrinsic) ---
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

    // Tailwind + inline tweaks for perfect 32x32 render
    img.className = 'w-7 h-7 object-cover border border-gray-300 rounded-md box-border';
    img.style.aspectRatio = '1 / 1';   // force square cropping
    img.style.flexShrink = '0';
    img.alt = player.username || `Player ${i + 1}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // --- Username text ---
    const name = document.createElement('div');
    name.className = 'font-medium text-gray-800 dark:text-white text-center';
    name.textContent = player.username || `Player ${i + 1}`;
    name.style.whiteSpace = 'nowrap';   // keeps name on one line

    // --- Append both ---
    el.append(img, name);
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

        // Nshow names here from prior lobby state
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

                // Update UI labels
                for (let i = 0; i < playerInfo.length; i++) {
                    const p = GameModule.players[i];
                    renderPlayerInfo(playerInfo[i], p, i);
                }
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

// --- Shared layout (matches dealCards) ---
const LAYOUT = {
    STRIDE: 10 * (GameModule.players?.length || 4), // 40px with 4 players
    BASE:   [0, 10, 20, 30],
    POSE: [
        (off) => ({ rot: 0,  x: -212 + off, y:  230 }), // seat 0 (you)
        (off) => ({ rot: 90, x: -425,       y: -250 + off }),
        (off) => ({ rot: 0,  x:  281 - off, y: -250 }),
        (off) => ({ rot: 90, x:  440,       y:  272 - off }),
    ]
};

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

    // keep a live copy of the client list (the server already emits this)
    socket.off?.('updateReadyState');
    socket.on('updateReadyState', (clientList) => {
        lastClientList = clientList || [];
        paintClientList(lastClientList);
    });

    function paintClientList(clients){
        listEl.innerHTML = clients.map(c =>
        `<li class="pause-pill">${c.username}${c.isReady ? ' ✅' : ''}</li>`
        ).join('');
    }

    socket.off?.('room:paused');
    socket.off?.('room:resumed');
    socket.off?.('room:forceReset');
    
    // when room is paused (caused by disconnect)
    socket.on('room:paused', async ({ reason, pausedUntil, disconnectedUsernames }) => {
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

        // refresh client list on change and then paint the change in pause menu
        socket.emit('getClientList', roomCode);

        const onClientList = (clients) => {
            lastClientList = clients || [];
            // Paint current clients
            paintClientList(lastClientList);            
        };

        socket.off?.('clientList'); // avoid dupes if multiple pauses
        socket.on('clientList', onClientList);

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
    });

    socket.on('room:resumed', async ({ players, turnClientId, finishedDeck, gameDeck, hand, me, isFirstMove, lastValidHand }) => {
        // remove pause menu
        overlay.classList.add('pause-hidden');
        document.body.classList.remove('is-paused');
        clearInterval(tick);

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

        if (localPlayerIndex !== -1) {
            // Rotate server order so local player is index 0 in GameModule
            players.forEach((p, index) => {
                const gameModuleIndex = (index - localPlayerIndex + 4) % 4; // Calculate GameModule index
                GameModule.players[gameModuleIndex].username = p.username;
                GameModule.players[gameModuleIndex].clientId = p.clientId;
                GameModule.players[gameModuleIndex].socketId = p.socketId;
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
            playerInfo[i].style.display = 'block';
            playerInfo[i].innerHTML = GameModule.players[i].username + " " + GameModule.players[i].clientId; //maybe add points here as well?
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
    });

    // listen for force reset emit from server (means 1 player left in server)
    socket.on('room:forceReset', ({ reason }) => {
        console.log(reason);
        GameModule.reset(); // reset game before leaving it
        // clear all dom elements
        removeAllGameElements();
        socket.emit('leaveRoom');               // inform server we’ve left this room
        window.dispatchEvent(new CustomEvent('forceReset'));
    });   
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
    preventScrollAndZoom('gameContainer');

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
        let loginMenuSocket, username;

        // require username and password to establish connection to socket.io server and resolve the connected socket object
        const authResult = await loginMenu();

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

        while (true) {
            // Once client has established connection to the server, require room code to join a game lobby and then resolve the socket that's connected to a room, also check if its a rejoining player
            const { socket, roomCode: rc, isRejoin: rejoinFlag } = await joinRoomMenu(loginMenuSocket);
            joinedRoomSocket = socket;
            roomCode = rc;
            isRejoin = rejoinFlag;

            // if rejoining player, skip lobby menu, but still listen for pause menu
            if (isRejoin) {
                window.isResume = true; // use global flag to stop safeStartGame from running in onload race
                setupPauseModal(joinedRoomSocket, roomCode);
                break;
            }

            // Hook pause/resume for this room (covers lobby + in-game)
            setupPauseModal(joinedRoomSocket, roomCode);

            // A lobby room where clients wait and can chat with each other until 4 clients join, where they can then start the game, might allow bots as filler
            let lobbyMenuResolve = await lobbyMenu(joinedRoomSocket, roomCode);

            if (lobbyMenuResolve !== "goBackToJoinRoomMenu") {
                break; // Exit the inner loop if not going back to join room menu
            }
        }

        while (true) {
            const startOutcome = await Promise.race([
                startGameSafe(joinedRoomSocket, roomCode, username), // becomes a no-op during resume
                waitForForceResetOnce(),
                waitForResumedResultsOnce(),                       // fires during a resume cycle
            ]);
            
            if (startOutcome === 'forceReset') {
                // clear the busy flag to avoid the warning
                startGame._busy = false;
                // jump back to join flow
                break;
            }

            if (startOutcome === '__START_ERR__') {
                // startGame threw; just loop again to wait properly
                continue;
            }

            // must be the results array at this point
            if (!Array.isArray(startOutcome)) {
                console.warn('Non-results outcome, waiting again…', startOutcome);
                continue;
            }
            const results = startOutcome; // real results from startGame

            // Race endMenu vs force reset
            const endOutcome = await Promise.race([
                endMenu(joinedRoomSocket, roomCode, results),
                waitForForceResetOnce(),
            ]);

            if (endOutcome === 'forceReset') {
                break; // back to join flow
            }

            if (endOutcome === 'continue'){
                startGame._busy = false;

                // set rejoined clients back to normal status, so startGameSafe can run
                window.isResume = false;
                // play another game
                continue; 
            } 
            if (endOutcome === 'goBackToJoinRoomMenu') break;   // to join flow
        }
    }
};

