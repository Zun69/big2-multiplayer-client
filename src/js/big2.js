import Player from "./player.js"
import Opponent from "./opponent.js"

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

//GameModule object encapsulate players, deck, gameDeck, finishedDeck (it represents the local gameState)
const GameModule = (function() {
    //let initialPlayer1 = new Player();
    let player1 = new Player();
    let player2 = new Opponent(); //ai player that will mirror other player's real time moves
    let player3 = new Opponent();
    let player4 = new Opponent();

    // GameModule properties
    let players = [player1, player2, player3, player4];
    let gameDeck = [];
    let playersFinished = []; //stores finishing order
    let lastHand = []; //stores last hand played
    let playedHistory = [] //stores played card history

    let lastValidHand; //stores a number that lets program know if last turn was a pass or turn
    let turn;
    let finishedDeck = Deck();
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
        gameDeck.length = 0;
        playersFinished.length = 0;
        lastHand.length = 0;
        playedHistory.length = 0;
        finishedDeck = Deck();
        turn = undefined;
        lastValidHand = undefined; 
        losingPlayer = undefined;
        playedHand = 0;
        turnClientId = null;   
    }

    // reset everything (quit game)
    function resetAll() {
        players.forEach(player => {
            // Reset player properties
            player.cards = [];
            player.wonRound = false;
            player.finishedGame = false;
            player.passed = false;
            player.readyState = false;
            player.points = 0;
            player.wins = 0;
            player.seconds = 0;
            player.thirds = 0;
            player.losses = 0;
        });
        gameDeck.length = 0;
        playersFinished.length = 0;
        lastHand.length = 0;
        playedHistory.length = 0;
        finishedDeck = Deck();
        turn = undefined;
        lastValidHand = undefined;
        losingPlayer = undefined;
        playedHand = 0;   
        turnClientId = null;   
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
        reset,
        resetAll,
    };
})();

// Sorts everybody's cards and plays the animation, resolves when animations finish
async function sortHands(socket, roomCode){ 
    GameModule.players[0].sortHand();
    
    // Animate the current player's cards into position
    await GameModule.players[0].sortingAnimation(0);

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

// play card sounds
const dealCardSounds = [
  new Howl({ src: ["src/audio/dealcard_01.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/dealcard_02.wav"], volume: 0.9 })
];

const finishCardSounds = [
    new Howl({ src: ["src/audio/finishcard_01.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_02.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_03.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/finishcard_04.wav"], volume: 0.9 })
]

let soundIndex = 0;
let finishSoundIndex = 0;

function dealNextCardSounds() {
  dealCardSounds[soundIndex].play();  // play current sound
  console.log("Sound index" + soundIndex);
  soundIndex = (soundIndex + 1) % dealCardSounds.length; // move to next (wrap around)
}

function dealNextFinishCardSounds() {
  finishCardSounds[finishSoundIndex].play();  // play current sound
  console.log("Sound index" + finishSoundIndex);
  finishSoundIndex = (finishSoundIndex + 1) % finishCardSounds.length; // move to next (wrap around)
}

// Animate and assign cards to GameModule.players
async function dealCards(serverDeck, socket, roomCode, firstDealClientId) {
  return new Promise(function (resolve) {
    // target divs for each seat (0: you, 1: left, 2: top, 3: right)
    const p1Div = document.getElementById('0');
    const p2Div = document.getElementById('1');
    const p3Div = document.getElementById('2');
    const p4Div = document.getElementById('3');
    const targetDivs = [p1Div, p2Div, p3Div, p4Div];

    // Build deck (server-supplied), mount to DOM, and shuffle/arrange
    let deck = Deck(false, serverDeck);
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
    const poseBySeat = [
      (off) => ({ rot: 0,  x: -212 + off, y:  230, }),  // seat 0 (you)
      (off) => ({ rot: 90, x: -425,       y: -250 + off,  }), // seat 1 (left)
      (off) => ({ rot: 0,  x:  281 - off, y: -250,       }), // seat 2 (top)
      (off) => ({ rot: 90, x:  440,       y:  272 - off, }), // seat 3 (right)
    ];

    shufflePromise.then(function (value) {
      if (value !== "shuffleComplete") return;

      const animationPromises = [];
      const perSeatCount = [0, 0, 0, 0]; // how many dealt to each seat
      

      deck.cards.reverse().forEach((card, dealIndex) => {
        card.setSide('back'); // make sure everything starts back-side before any animation
        const seat  = playerIndex;               // lock seat for this card
        const k     = perSeatCount[seat];        // 0..12 within THIS seat
        const delay = 150 + dealIndex * 70;       // delay after a card is animated
        const off   = SEAT_BASE[seat] + k * STRIDE;

        const mountDiv = targetDivs[seat];
        const { rot, x, y } = poseBySeat[seat](off);

        const localSeat = 0; // you

        const p = new Promise((cardResolve) => {
          setTimeout(() => {
            card.animateTo({
              delay: 0,
              duration: 50,
              ease: 'linear',
              rot, x, y,
              onComplete: function () {
                // mount first, then set side to avoid any flicker
                card.mount(mountDiv);
                dealNextCardSounds();

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
        deck.unmount();
        socket.emit('dealComplete', roomCode, GameModule.players[0]);
        deck = null;
        resolve(socket);
      });
    });
  });
}

// Get clientId of player with 3 of diamonds from server and return index of player with matching clientId
function getFirstTurn(socket) {
    return new Promise((resolve) => {
        const listener = (clientId) => {
            // Find the index of the player with the matching clientId
            for (let i = 0; i < GameModule.players.length; i++) {
                if (GameModule.players[i].clientId === clientId) {
                    socket.off('firstTurnClientId', listener); // Remove the listener
                    resolve(i); // Resolve the promise with the turn value
                }
            }
        };

        socket.on('firstTurnClientId', listener);
    });
}

// remove and add a border to playerInfo element based on turn
function displayTurn(turn) {
    const playerInfo = document.getElementsByClassName("playerInfo");

    // Remove border from all playerInfo elements
    for (let i = 0; i < playerInfo.length; i++) {
        playerInfo[i].style.border = "none";
    }

    // Set border for the player whose turn it is
    playerInfo[turn].style.border = "2px solid black"; // Adjust the border style as needed
}

async function localPlayerHand(socket, roomCode) {
    const outcome = await GameModule.players[GameModule.turn].playCard(GameModule.gameDeck, GameModule.lastValidHand, GameModule.playersFinished, roomCode, socket);

    if(outcome.payload.type == 'play'){
        // payload.cards is guaranteed to be a valid, server-approved hand
        GameModule.playedHand = outcome.payload.cards.length;

        const actorIdx = GameModule.turn;  // ← save who actually played

        console.log("Current turn " + GameModule.turn)

        // Server's next turn is the clientId of the player whose turn it is, use it to assign next turn to corresponding opponent
        const localPlayerIdx = GameModule.players.findIndex(p => p.clientId === outcome.payload.nextTurn);

        GameModule.turn = localPlayerIdx;

        console.log("Next turn " + GameModule.turn)

        // update local lastValidHand from the payload (authoritative from server)
        GameModule.lastValidHand = outcome.payload.lastValidHand;
        
        // foreach GameModule.players.passed = outcome.payload.players.passed 
        if (Array.isArray(outcome.payload.players)) {
            outcome.payload.players.forEach(sp => {
                const lp = GameModule.players.find(p => p.clientId === sp.id);
                if (!lp) return;
                lp.passed = !!sp.passed;
            });
        }

        await new Promise((resolve) => {
            const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
            socket.on('allHandAckComplete', handler);
            socket.emit('playHandAck', roomCode);
        });

        // now sort the actor’s remaining cards
        await sortPlayerHandAfterTurn(socket, roomCode, actorIdx);
            
        return; // same as just returning the promise above
    } 
    else if(outcome.payload.type == 'pass') {
        GameModule.playedHand = 0; // player passed, last hand length is 0

        // Find corresponding local player using server payload and sync their passed property with the server (to true)
        const passedSeat = outcome.payload.passedBy;
        const passedPlayer = GameModule.players.find(p => p.clientId === passedSeat);
        passedPlayer.passed = true;

        // Server's next turn is the clientId of the player whose turn it is, use it to assign next turn to corresponding opponent
        const localPlayerIdx = GameModule.players.findIndex(p => p.clientId === outcome.payload.nextTurn);
        GameModule.turn = localPlayerIdx;

        // update local lastValidHand from the payload (authoritative from server)
        GameModule.lastValidHand = outcome.payload.lastValidHand;

        await new Promise((resolve) => {
            const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
            socket.on('allHandAckComplete', handler);
            socket.emit('playHandAck', roomCode);
        });

        return;
    }
    // reset all player's passed property and set player that won round property to true
    else if(outcome.payload.type == 'passWonRound'){
        GameModule.playedHand = 0; // player passed, last hand length is 0

        // update local lastValidHand from the payload (authoritative from server)
        GameModule.lastValidHand = outcome.payload.lastValidHand;

        // 2) Mirror server player flags onto local gamestate players
        // server 'players' shape from publicisePlayers: { id, seat, cardCount, passed, finished, wonRound }
        outcome.payload.players.forEach(sp => {
            const lp = GameModule.players.find(p => p.clientId === sp.id);
            if (!lp) return;
            lp.passed     = !!sp.passed;
            lp.wonRound   = !!sp.wonRound;
            lp.finishedGame = !!sp.finishedGame;
        });

        // 3) Who leads? (the one with wonRound === true)
        const leaderServerSeat = outcome.payload.players.find(p => p.wonRound)?.id;
        const leaderLocalIdx = GameModule.players.findIndex(p => p.clientId === leaderServerSeat);
        GameModule.turn = leaderLocalIdx;  // leader gets free turn

        await new Promise((resolve) => {
            const handler = () => { socket.off('allHandAckComplete', handler); resolve(); };
            socket.on('allHandAckComplete', handler);
            socket.emit('playHandAck', roomCode);
        });

        // transfer game deck to finishedDeck
        await finishDeckAnimation(socket, roomCode);

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

    const onAllHandDone = () => {
      cleanup();
      resolve();
    };

    const onCardsPlayed = async (payload) => {
        const { clientId, cards, positions, nextTurn, lastValidHand } = payload;

        // mirror hand length and animate the opponent play
        GameModule.playedHand = cards.length;

        // whoever is showing as "turn" right now is the actor for sorting
        const actorIdx = GameModule.turn;

        const player = GameModule.players.find(p => p.clientId === clientId);
        if (player) {
            await player.playServerHand(GameModule.gameDeck, GameModule.turn, cards, positions);
        }

        // sync local state from server
        GameModule.lastValidHand = lastValidHand;
        GameModule.turn = GameModule.players.findIndex(p => p.clientId === nextTurn);

        // foreach GameModule.players.passed = outcome.payload.players.passed 
        if (Array.isArray(payload.players)) {
            payload.players.forEach(sp => {
                const lp = GameModule.players.find(p => p.clientId === sp.id);
                if (!lp) return;
                lp.passed = !!sp.passed;
            });
        }

      // attach listener first, then ack (prevents missing the barrier if we're #4)
      const handler = async () => {
        socket.off('allHandAckComplete', handler);
        await sortPlayerHandAfterTurn(socket, roomCode, actorIdx);
        onAllHandDone();
      };
      socket.on('allHandAckComplete', handler);
      socket.emit('playHandAck', roomCode);
    };

    const onPassedTurn = (payload) => {
      GameModule.playedHand = 0;

      const passedSeat = payload.passedBy;
      const passedPlayer = GameModule.players.find(p => p.clientId === passedSeat);
      if (passedPlayer) passedPlayer.passed = true;

      GameModule.turn = GameModule.players.findIndex(p => p.clientId === payload.nextTurn);
      GameModule.lastValidHand = payload.lastValidHand;

      // play pass sound on other client pass
      passSound.play();

      const handler = () => {
        socket.off('allHandAckComplete', handler);
        onAllHandDone();
      };
      socket.on('allHandAckComplete', handler);
      socket.emit('playHandAck', roomCode);
    };

    const onWonRound = async (payload) => {
        GameModule.playedHand = 0;
        GameModule.lastValidHand = payload.lastValidHand;

        // mirror server flags
        payload.players.forEach(sp => {
            const lp = GameModule.players.find(p => p.clientId === sp.id);
            if (!lp) return;
            lp.passed       = !!sp.passed;
            lp.wonRound     = !!sp.wonRound;
            lp.finishedGame = !!sp.finishedGame;
        });

        // leader gets the free turn
        const leaderServerSeat = payload.players.find(p => p.wonRound)?.id;
        const leaderLocalIdx = GameModule.players.findIndex(p => p.clientId === leaderServerSeat);
        GameModule.turn = leaderLocalIdx;

        // play pass sound on other client pass
        passSound.play();

        // ack barrier first
        const handler = async () => {
            socket.off('allHandAckComplete', handler);
            // then all clients run the clear-pile animation
            await finishDeckAnimation(socket, roomCode);
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

async function finishGameAnimation(roomCode, socket, gameDeck, players, losingPlayer){
    return new Promise(async function (resolve, reject) {
        let finishedDeckDiv = document.getElementById("finishedDeck");

        // Find player who came last
        const lastPlacePlayer = GameModule.players.find(p => p.username === losingPlayer);

        for (let i = 0; i < gameDeck.length; i++) {
            //loop through all game deck cards
            let card = gameDeck[i];
            card.setSide('back');
            
            //wait until each card is finished animating
            await new Promise((cardResolve) => {
                setTimeout(function () {
                    card.animateTo({
                        delay: 0,
                        duration: 80,
                        ease: 'linear',
                        rot: 0,
                        x: 240 - GameModule.finishedDeck.cards.length * 0.25, //stagger the cards when they pile up, imitates original deck styling
                        y: -150 - GameModule.finishedDeck.cards.length * 0.25,
                        onComplete: function () {
                            GameModule.finishedDeck.cards.push(card); //push gameDeck card into finshedDeck
                            card.$el.style.zIndex = GameModule.finishedDeck.cards.length; //change z index of card to the length of finished deck
                            GameModule.finishedDeck.mount(finishedDeckDiv); //mount finishedDeck to div
                            card.mount(GameModule.finishedDeck.$el);  //mount card to the finishedDeck div
                            //dealNextCardSounds();
                            dealNextFinishCardSounds();
                            cardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 10);
            });
        }

        //loop through losing player's cards
        for (let i = 0; i < lastPlacePlayer.numberOfCards; i++){
            let losingCard = lastPlacePlayer.cards[i];
            losingCard.setSide('back');
            
            //wait until each card is finished animating
            await new Promise((losingCardResolve) => {
                setTimeout(function () {
                    losingCard.animateTo({
                        delay: 0,
                        duration: 80,
                        ease: 'linear',
                        rot: 0,
                        x: 240 - GameModule.finishedDeck.cards.length * 0.25, //stagger the cards when they pile up, imitates original deck styling
                        y: -150 - GameModule.finishedDeck.cards.length * 0.25,
                        onComplete: function () {
                            GameModule.finishedDeck.cards.push(losingCard); //push gameDeck card into finshedDeck
                            losingCard.$el.style.zIndex = GameModule.finishedDeck.cards.length; //change z index of card to the length of finished deck
                            GameModule.finishedDeck.mount(finishedDeckDiv); //mount finishedDeck to div
                            losingCard.mount(GameModule.finishedDeck.$el);  //mount card to the finishedDeck div
                            //dealNextCardSounds();
                            dealNextFinishCardSounds();
                            losingCardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 10);
            });
        }


        socket.emit('finishGameAnimation', roomCode);
        
        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve();
    });
}

// after round ends, adds all played cards into finished deck and animates them as well
async function finishDeckAnimation(socket, roomCode) {
    let finishedDeckDiv = document.getElementById("finishedDeck");

    // keep animating until gameDeck is empty
    while (GameModule.gameDeck.length > 0) {
        // loop through all game deck cards (consume one at a time)
        let card = GameModule.gameDeck.shift();
        card.setSide('back');
                
        // wait until each card is finished animating
        await new Promise((cardResolve) => {
            setTimeout(function () {
                card.animateTo({
                delay: 0,
                duration: 50,
                ease: 'linear',
                rot: 0,
                x: 240 - GameModule.finishedDeck.cards.length * 0.25, // stagger the cards when they pile up, imitates original deck styling
                y: -150 - GameModule.finishedDeck.cards.length * 0.25,
                onComplete: function () {
                    GameModule.finishedDeck.cards.push(card); // push gameDeck card into finishedDeck
                    card.$el.style.zIndex = GameModule.finishedDeck.cards.length; // change z index of card to the length of finished deck
                    GameModule.finishedDeck.mount(finishedDeckDiv); // mount finishedDeck to div
                    card.mount(GameModule.finishedDeck.$el);  // mount card to the finishedDeck div
                    dealNextCardSounds();
                    cardResolve(); // resolve, so next card can animate
                }
            });
            }, 100);
        });
    }

    // tell server we're done animating this clear
    socket.emit('finishDeckAnimation', roomCode);

    // wait for all clients to finish
    await new Promise((resolve) => {
        socket.once('finishDeckAnimationComplete', resolve);
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
// Drop-in replacement
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
            return `Four Of A Kind ${plural(rankToWord[quadRank])}`;
        }

        // Full house (works for both 333-55 and 33-555)
        if (countsDesc[0] === 3 && countsDesc[1] === 2) {
            const tripleRank = [...byRank.entries()].find(([,s]) => s.length === 3)[0];
            const pairRank   = [...byRank.entries()].find(([,s]) => s.length === 2)[0];
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
            return `Straight`;
        }
    }

    // (Optional) Don’t treat 4-card quads as valid (your current rules reject case 4) :contentReference[oaicite:2]{index=2}

    // Fallback → show raw symbols like "3♦ 3♥"
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


//Actual game loop, 1 loop represents a turn
const gameLoop = async (roomCode, socket, firstTurnClientId) => {
    console.log("reached here")
    GameModule.turn = GameModule.players.findIndex(p => Number(p.clientId) === Number(firstTurnClientId));
    
    // Empty the finished deck of all its cards, so it can store post round cards
    GameModule.finishedDeck.cards.forEach(function (card) {
        card.unmount();
    });
    GameModule.finishedDeck.cards = [];

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
            //log gameState values
            console.log("GameState LastValidHand:", GameModule.lastValidHand);
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
                    GameModule.finishedDeck.unmount();

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

// Function to sanitize the input
function sanitizeInput(input) {
    // Replace all non-alphanumeric characters with an empty string
    return input.replace(/[^a-zA-Z0-9]/g, '');
}

//menu that allows users to enter a valid username and password to establish a connection with the server
async function loginMenu() {
    const loginMenu = document.getElementById("loginMenu");
    const userNameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginButton = document.getElementById("loginButton");
    const errorMessage1 = document.getElementById("errorMessage1");

    //display the loginMenu(login menu)
    loginMenu.style.display = "block";

    return new Promise((resolve) => {
        function handleClick() {
            //remove the click event listener for login button
            loginButton.removeEventListener("click", handleClick);

            // Validate and sanitize the player name
            let username = sanitizeInput(userNameInput.value);
            
            // Validate and sanitize the room code
            let password = sanitizeInput(passwordInput.value);
            
            // Update input fields with sanitized values
            userNameInput.value = username;
            passwordInput.value = password;

            const socket = io('http://localhost:3000', {
                auth: {
                    username: username,
                    password: password
                }
            });

            // Emit authentication event to server
            socket.emit('authenticate', { username, password });

            // Attempt authentication by connecting to the server
            socket.connect();

            // Handle authentication failure (custom error from middleware)
            socket.on('connect_error', (error) => {
                if (error.message === 'Authentication failed') {
                    errorMessage1.innerText = 'Invalid username or password.';
                    errorMessage1.style.display = 'block';
                    // Re-show the login menu if authentication fails
                    loginMenu.style.display = 'block';
                }
            });

            // Handle successful authentication
            socket.on('authenticated', () => {
                console.log('Authentication successful');
                // Hide the loginMenu
                loginMenu.style.display = "none";

                // Resolve the promise with the socket instance
                resolve({ socket, username });
            });
        }

        loginButton.addEventListener("click", () => {
            //input box validation
            if (userNameInput.value.trim() === '' || passwordInput.value.trim() === '') {
                errorMessage1.innerText = "Both username and password are required.";
                errorMessage1.style.display = "block";
                return;
            }

            if(userNameInput.value.trim() === '') {
                errorMessage1.innerText = "Username is required.";
                errorMessage1.style.display = "block";
                return;
            }

            if (passwordInput.value.trim() === '') {
                errorMessage1.innerText = "Password is required.";
                errorMessage1.style.display = "block";
                return;
            }

            handleClick();
        });
    });
}

//menu that allows users to enter a room number to join an available room
async function joinRoomMenu(socket) {
    return new Promise((resolve, reject) => {
        const joinRoomMenu = document.getElementById("joinRoomMenu");
        const availableRoomsDiv = document.getElementById('availableRooms');
        const errorMessage2 = document.getElementById("errorMessage2");

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

                    // Disable button if there are already 4 clients
                    if (numClients >= 4) {
                        roomButton.disabled = true;
                    }
                    roomButton.addEventListener('click', handleJoinRoom);
                    availableRoomsDiv.appendChild(roomButton);
                });
            }
        }

        // Initial request for available rooms, to immediately populate the UI with the current list of available rooms
        refreshAvailableRooms();

        // Set interval to refresh available rooms every 3 seconds and activate the following lines of code
        const refreshInterval = setInterval(refreshAvailableRooms, 3000);

        // Ensure the existing event listener is removed before adding a new one, these lines are activated when the setInterval goes off
        socket.off('availableRooms', updateAvailableRooms);
        socket.on('availableRooms', updateAvailableRooms);

        // Define the click event listener function
        function handleJoinRoom(event) {
            // Remove all button click listeners here to avoid multiple click handling issues
            const roomButtons = document.querySelectorAll('.room-button');
            roomButtons.forEach(button => {
                button.removeEventListener('click', handleJoinRoom);
            });

            const roomCode = event.target.dataset.roomCode; // Retrieve roomCode from dataset

            // Emit joinRoom event to server
            socket.emit('joinRoom', { roomCode });

            // Handle invalid room code error from server
            socket.on('errorMessage', (message) => {
                errorMessage2.innerText = message;
                errorMessage2.style.display = 'block';
                // Re-show the room menu if joining fails
                joinRoomMenu.style.display = 'block';
            });

            // Handle successful room join
            socket.on('joinedRoom', () => {
                console.log('Joined room successfully');
                // Hide the joinRoomMenu
                joinRoomMenu.style.display = "none";

                // Clear the refresh interval
                clearInterval(refreshInterval);

                // Remove the event listener for available rooms
                socket.off('availableRooms', updateAvailableRooms);

                // Resolve the promise with the socket and roomCode
                resolve({ socket, roomCode });
            });
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

            // Update readyPlayersCount
            const readyPlayersCount = clientList.filter(client => client.isReady).length; // Updated to get the actual ready count

            // Update the button text
            readyButton.textContent = isReady ? `Unready up ${readyPlayersCount}/4` : `Ready up ${readyPlayersCount}/4`; // Update button text
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
        backToJoinRoomButton.addEventListener('click', () => {
            handleBackClick();
        });

        // Function to handle clean up of event listeners and sockets
        function handleBackClick() {
            // Emit leave room event, will return updated clientList event
            socket.emit('leaveRoom', roomCode);

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

// once all four clients toggle toggleReadyState, call startGameForRoom function on server and update local gamestate to match server generated one 
async function startGame(socket, roomCode){
    //unhide buttons and gameInfo divs
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const gameInfo = document.getElementById("gameInfo");
    const playerInfo = document.getElementsByClassName("playerInfo");
    let firstDealClientId;
    
    playButton.style.display = "block";
    passButton.style.display = "block";
    gameInfo.style.display = "block";

    // Remove any existing event listeners for these events to avoid multiple listeners
    socket.off('clientSocketId');      // NEW: not used by server, but safe to clear
    socket.off('initialGameState');    // NEW: not used by server, but safe to clear
    socket.off('dealHand');           
    socket.off('firstTurnClientId');
    socket.off('visualDealDeck');      // avoid dupes on hot-reload

    // NEW: defensively guard against accidental re-entry (optional)
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

        // NEW: wait for playersSnapshot (replacement for initialGameState)
        const playersSnapshotPromise = new Promise(resolve => {
            socket.once('playersSnapshot', ({ players }) => {
                // Using unique socket id, assign the appropriate index
                const localPlayerIndex = players.findIndex(p => p.socketId === GameModule.players[0].socketId);
                console.log("LOCAL PLAYER INDEX:", localPlayerIndex);

                if (localPlayerIndex !== -1) {
                // Rotate server order so local player is index 0 in GameModule
                players.forEach((p, index) => {
                    const gameModuleIndex = (index - localPlayerIndex + 4) % 4; // Calculate GameModule index
                    GameModule.players[gameModuleIndex].username     = p.username;
                    GameModule.players[gameModuleIndex].clientId = p.clientId;
                    GameModule.players[gameModuleIndex].socketId = p.socketId;
                });
                }

                // Update UI labels
                for (let i = 0; i < playerInfo.length; i++) {
                playerInfo[i].style.display = 'block';
                playerInfo[i].innerHTML = GameModule.players[i].username + " " + GameModule.players[i].clientId; //maybe add points here as well?
                }
                resolve();
            });
        });

        // Ensure seat-mapping is complete BEFORE we deal (dealCards uses clientId==0 to pick start seat)
        await playersSnapshotPromise;

        // Ask server who has first turn (3♦) and await the reply
        const firstTurnClientId = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('firstTurnClientId timeout')), 8000);
            socket.once('firstTurnClientId', (clientId) => {
                clearTimeout(t);
                resolve(clientId);
            });
        });

        // Wait for the server-provided 52-card "visual" deck for THIS client.
        // We fully finish the dealing animation BEFORE starting gameLoop (prevents races).
        await new Promise((resolve, reject) => {
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

        // Main game loop, returns array of usernames in finishing order
        const results = await gameLoop(roomCode, socket, firstTurnClientId);
        return results;

    } finally {
        // NEW: cleanup (mostly no-op because we used .once, but safe on hot-reloads)
        socket.off('clientSocketId');
        socket.off('initialGameState');
        socket.off('dealHand');
        socket.off('firstTurnClientId');
        socket.off('visualDealDeck');

        // NEW: allow re-entry for the next game
        startGame._busy = false;
    }
}




window.onload = async function() {
    // require username and password to establish connection to socket.io server and resolve the connected socket object
    const { socket: loginMenuSocket, username }  = await loginMenu()

    while (true) {
        let endMenuResolve;
        let joinedRoomSocket, roomCode;

        while (true) {
            // Once client has established connection to the server, require room code to join a game lobby and then resolve the socket that's connected to a room
            const joinRoomResult = await joinRoomMenu(loginMenuSocket);
            joinedRoomSocket = joinRoomResult.socket;
            roomCode = joinRoomResult.roomCode;

            // A lobby room where clients wait and can chat with each other until 4 clients join, where they can then start the game, might allow bots as filler
            let lobbyMenuResolve = await lobbyMenu(joinedRoomSocket, roomCode);

            if (lobbyMenuResolve !== "goBackToJoinRoomMenu") {
                break; // Exit the inner loop if not going back to join room menu
            }
        }

        while (true) {
            // Once code reaches here, it means 4 clients have readied up
            const results = await startGame(joinedRoomSocket, roomCode, username);

            // 1) Render the results nicely in the end menu
            // display results, add the continue button here, if player continues, reload the lobbyMenu, and allow players to emit StartGame again
            endMenuResolve = await endMenu(joinedRoomSocket, roomCode, results);
            
            if (endMenuResolve === "continue") {
                // 👇 This repeats the exact line again:
                // const results = await startGame(joinedRoomSocket, roomCode, username);
                // (i.e., loop back to BEFORE that const line)
                continue;
            }

            if (endMenuResolve === "goBackToJoinRoomMenu") {
                // break to room-selection loop
                break;
            }
        }
    }
};

