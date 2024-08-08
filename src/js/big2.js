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
        reset,
        resetAll,
    };
})();

// Sorts everybody's cards and plays the animation, resolves when animations finish
async function sortHands(players, socket, roomCode){ 
    const animationPromises = [];

    players.forEach(function(player){
        player.sortHand();
    });
    
    for (let i = 0; i < 4; i++) {
        // Push the animation promise into the array
        animationPromises.push(players[i].sortingAnimation(i));
    }

    // Wait for all animation promises to resolve
    await Promise.all(animationPromises);    

    // Emit local player's sorted cards to the server to update room's gameState
    socket.emit('sortHandsComplete',roomCode, GameModule.players[0]);

    // Return a promise that resolves when all sorting is complete
    return new Promise(resolve => {
        socket.on('allSortingComplete', () => {
            console.log('All players have completed sorting their hands.');
            resolve('sortComplete');
        });
    });
}

async function sortPlayerHandAfterTurn(socket, roomCode){
    const animationPromises = [];
    
    // When player plays their hand, its already sorted so no need to sort, just animate cards to new index positions
    // Push the animation promise into the array
    animationPromises.push(GameModule.players[GameModule.turn].sortingAnimationAfterTurn(GameModule.turn));

    // Wait for all animation promises to resolve
    await Promise.all(animationPromises);

    // Emit player's sorted cards after their turn to the server to update room's gameState
    // Only the host's emitted player will update the gameState
    socket.emit('sortPlayerHandAfterTurn',roomCode, GameModule.players[GameModule.turn]);

     // Return a promise that resolves when all sorting is complete
    return new Promise(resolve => {
        socket.on('sortAfterTurnComplete', () => {
            console.log('After turn sorting complete for all clients');
            resolve('sortAfterTurnComplete');
        });
    });
}

// Purpose is to wait for shuffle animation finish before resolving promise back to dealCards function
function shuffleDeckAsync(deck, times, delayBetweenShuffles, serverDeck) {
    return new Promise((resolve) => {
      const shufflePromises = [];
  
      for (let i = 0; i < times; i++) {
        shufflePromises.push(
          new Promise((innerResolve) => {
            setTimeout(() => {
              deck.copyDeck(serverDeck);
              innerResolve();
            }, i * delayBetweenShuffles);
          })
        );
      }
  
      Promise.all(shufflePromises).then(() => {
        setTimeout(() => {
          resolve('shuffleComplete');
        }, 850); //default 2100 7 shuffles  (3 shuffles = 850, etc)
      });
    });
}

// Animate and assign cards to GameModule.players
async function dealCards(players, serverDeck, socket, roomCode) {
    return new Promise(function (resolve) {
        //assign each player's div's so cards can be mounted to them
        var p1Div = document.getElementById('0');
        var p2Div = document.getElementById('1');
        var p3Div = document.getElementById('2');
        var p4Div = document.getElementById('3');

        //hold each player's animation promises
        let p1Promise;
        let p2Promise;
        let p3Promise;
        let p4Promise;

        // Create deck, pass in serverDeck, then copy in serverDeck to the new deck, then display the deck in an HTML container
        let deck = Deck(false, serverDeck);
        let $container = document.getElementById('gameDeck');
        deck.mount($container);

        // change this to an await??
        let shufflePromise = shuffleDeckAsync(deck, 3, 0, serverDeck);

        // Use a for...of loop to iterate over the cards with asynchronous behavior
        var playerIndex = 0;

        //start dealing at player with clientId 0
        GameModule.players.forEach(function (player, index) {
            if(player.clientId == 0){
                console.log("PLAYER INDEX: " + index);
                playerIndex = index; //if player has clientId of 0, start the playerIndex at the player's index in the GameModule.players array
            }
        });

        shufflePromise.then(function(value) {
            if(value == "shuffleComplete"){
                const animationPromises = []; // Array to store animation promises

                deck.cards.reverse().forEach(function (card, i) {
                    //keeps playerIndex within a 0-3 range
                    if (playerIndex == 4) {
                        playerIndex = 0;
                    }

                    //play different dealing animations depending on player index
                    switch (playerIndex) {
                        case 0:
                            card.setSide('front');
                            p1Promise = new Promise((cardResolve) => {
                                setTimeout(function() {
                                    card.animateTo({
                                        delay: 0, // wait 1 second + i * 2 ms
                                        duration: 100,
                                        ease: 'linear',
                                        rot: 0,
                                        x: -212 + (i * 10),
                                        y: 230,
                                        onComplete: function () {
                                            card.mount(p1Div);
                                            cardResolve();
                                        }
                                    })                                  
                                },50 + i * 28);
                            });
                            animationPromises.push(p1Promise); //add animation promise to promise array
                            GameModule.players[playerIndex].addCard(card); //add card to player's hand
                            playerIndex++;
                            break;
                        case 1:
                            card.setSide('front')
                            p2Promise = new Promise((cardResolve) => {
                                setTimeout(function() {
                                    card.animateTo({
                                        delay: 0 , // wait 1 second + i * 2 ms
                                        duration: 100,
                                        ease: 'linear',
                                        rot: 90,
                                        x: -425,
                                        y: -250 + (i * 10),
                                        onComplete: function () {
                                            card.mount(p2Div);
                                            cardResolve();
                                        }
                                    })                                   
                                },50 + i * 28)
                                animationPromises.push(p2Promise);
                                players[playerIndex].addCard(card);
                                playerIndex++;
                            });
                            break;
                        case 2:
                            card.setSide('front')
                            p3Promise = new Promise((cardResolve) => {
                                setTimeout(function() {
                                    card.animateTo({
                                        delay: 0 , // wait 1 second + i * 2 ms
                                        duration: 100,
                                        ease: 'linear',
                                        rot: 0,
                                        x: 281 - (i * 10),
                                        y: -250,
                                        onComplete: function () { 
                                            card.mount(p3Div);                                      
                                            cardResolve();
                                        }
                                    })
                                },50 + i * 28)
                                animationPromises.push(p3Promise);
                                players[playerIndex].addCard(card);
                                playerIndex++;
                            });
                            break;
                        case 3:
                            card.setSide('front')
                            p4Promise = new Promise((cardResolve) => {
                                setTimeout(function() {
                                    card.animateTo({
                                        delay: 0 , // wait 1 second + i * 2 ms
                                        duration: 100,
                                        ease: 'linear',
                                        rot: 90,
                                        x: 440,
                                        y: 272 - (i * 10),
                                        onComplete: function () {
                                            card.mount(p4Div);
                                            cardResolve();
                                        }
                                    })                                    
                                },50 + i * 28)
                                animationPromises.push(p4Promise);
                                players[playerIndex].addCard(card);
                                playerIndex++;
                            });
                            break;
                        }
                    })
                // Wait for all card animations to complete
                Promise.all(animationPromises).then(() => {
                    //Unmount the deck from the DOM
                    deck.unmount();

                    // Let server know client has finished dealing and update player's server side cards
                    socket.emit('dealComplete', roomCode, GameModule.players[0]);

                    //Remove reference to the deck instance
                    deck = null; 
                    resolve(socket);
                });
            }
        });       
    });
}

// Get clientId of player with 3 of diamonds and return index of player with matching clientId
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

// Reset wonRound status of players using info from players array sent from server
function resetWonRoundStatus(socket) {
    return new Promise((resolve) => {
        const listener = (serverPlayer) => {
            const clientPlayer = GameModule.players.find(p => p.clientId === serverPlayer.clientId);

            if(clientPlayer) {
                clientPlayer.wonRound = serverPlayer.wonRound;
                console.log("reset wonRound status for local player");
            }
            else {
                console.log("wonRoundReset player not found");
            }

            // Remove the listener after updating the status
            socket.off('wonRoundReset', listener);
            // Resolve the promise after updating the status
            resolve();
        };

        socket.on('wonRoundReset', listener);
    });
}

// Reset passed status of players if server emits wonRound event
function checkThreePasses(socket) {
    return new Promise((resolve) => {
        const wonRoundListener = () => {
            // Reset the passed status for all players
            GameModule.players.forEach(player => player.passed = false);

            socket.off('wonRound', wonRoundListener); // Remove the listener
            resolve('wonRound'); // Resolve the promise indicating animation start
        };

        // If there are no three passed properties resolve the promise
        const noWonRoundListener = () => {
            socket.off('noWonRound', noWonRoundListener); // Remove the listener
            resolve('noWonRound'); // Resolve the promise indicating no won round
        };

        socket.on('wonRound', wonRoundListener);
        socket.on('noWonRound', noWonRoundListener);
    });
}

// Update local player's wonRound property and local gameDeck to match server
function finishWonRound(socket) {
    return new Promise((resolve) => {
        const listener = (serverWonRoundPlayer, serverGameDeck) => {
            // Find corresponding local player and change wonRound property to true so they can have a free turn
            const localPlayer = GameModule.players.find(p => p.clientId === serverWonRoundPlayer.clientId);

            if (localPlayer) {
                localPlayer.wonRound = serverWonRoundPlayer.wonRound;
                console.log("set wonRound status to true");
            }

            GameModule.gameDeck.length = serverGameDeck.length;
            
            // Remove the listener after updating the status
            socket.off('finishDeckComplete', listener);
            // Resolve the promise after updating the status
            resolve();
        };

        socket.on('finishDeckComplete', listener);
    });
}

// Receive playerHand from server and return playedHand length
function receivePlayerHand(socket, turn) {
    return new Promise((resolve) => {
        const listener = async (serverHand, serverPlayer, serverGameDeck, serverPlayersFinished) => {
            let opponentHandLength;
            console.log("server hand: " + serverHand);
            // If received hand is not from local client
            if(GameModule.players[turn].clientId !== GameModule.players[0].clientId) {
                // Receive other client's hand and make appropriate opponent play that hand

                // Find corresponding opponent and update to serverPlayer properties 
                for (let localOpponent of GameModule.players) {
                    if (localOpponent.clientId === serverPlayer.clientId) {
                        console.log("found corresponding opponent");
                        
                        // Make opponent AI play serverHand received from corresponding client
                        opponentHandLength = await localOpponent.playCard(GameModule.gameDeck, GameModule.turn, serverHand);

                        // This might not be needed because cards will already be the same
                        //localOpponent.cards = serverPlayer.cards; // this might cause an error
                        break;
                    }
                }
                // Update local gameState to server gameState
                GameModule.playersFinished = serverPlayersFinished; 
                
                // Remove the listener after updating the status
                socket.off('receivePlayerHand', listener);
                // Resolve the promise with serverHand length
                resolve(opponentHandLength);
            } 
            // Else if its local client's hand
            else {
                // Find corresponding local player and update to serverPlayer properties 
                for (let localPlayer of GameModule.players) {
                    if (localPlayer.clientId === serverPlayer.clientId) {
                        console.log("found local client's hand");
                        console.log(serverHand);

                        // This might not be needed because cards will already be the same
                        //localPlayer.cards = serverPlayer.cards;
                        break;
                    }
                }
                // Update local gameState to server gameState
                GameModule.playersFinished = serverPlayersFinished; 
                
                // Remove the listener after updating the status
                socket.off('receivePlayerHand', listener);
                // Resolve the promise with serverHand length
                resolve(serverHand.length);
            }
            
            
        };

        socket.on('receivePlayerHand', listener);
    });
}

// Reset passed property of players using info from players array sent from server
function resetPlayersPassed(socket) {
    return new Promise((resolve) => {
        const listener = (players) => {
            //const players = data.players; // Access the players array

            // Loop through received players and update passed property of GameModule.players
            for (let serverPlayer of players) {
                for (let localPlayer of GameModule.players) {
                    if (localPlayer.clientId === serverPlayer.clientId) {
                        console.log("reset passed status");
                        localPlayer.passed = serverPlayer.passed;
                        break;
                    }
                }
            }

            // Remove the listener after updating the status
            socket.off('resetPassedComplete', listener);
            // Resolve the promise after updating the status
            resolve();
        };

        socket.on('resetPassedComplete', listener);
    });
}

// Update GameModule.playedHand and lastPlayedHand to server values
function setValidHand(socket) {
    return new Promise((resolve) => {
        const listener = (serverPlayedHand, serverLastValidHand) => {
            GameModule.playedHand = serverPlayedHand;
            GameModule.lastValidHand = serverLastValidHand;

            // Remove the listener after updating the status
            socket.off('setLastValidHandComplete', listener);
            // Resolve the promise after updating the status
            resolve();
        };

        socket.on('setLastValidHandComplete', listener);
    });
}

function finishedGameCheckComplete(socket) {
    console.log("reached finishedGame")
    return new Promise((resolve) => {
        // If server has 4 clientId's in playersFinished array, update local playersFinished array & resolve gameFinished
        const gameFinishedListener = (serverPlayersFinished, serverLosingPlayer) => {
            GameModule.playersFinished = serverPlayersFinished;
            GameModule.losingPlayer = serverLosingPlayer;

            // Remove the listener after updating the status
            socket.off('gameHasFinished', gameFinishedListener);

            // Resolve the promise after updating the status
            resolve("gameFinished");
        };

        // If server's playersFinished array has more than 1 clientId
        const gameNotFinishedListener = (serverPlayersFinished) => {
            GameModule.playersFinished = serverPlayersFinished;

            // Remove the listener after updating the status
            socket.off('gameHasNotFinished', gameNotFinishedListener);

            // Resolve the promise after updating the status
            resolve("gameNotFinished");
        }

        // If server's playersFinished array has more than 1 clientId
        const noClientHasFinishedListener = (serverPlayersFinished) => {
            // Update local playersFinished array to reflect server
            GameModule.playersFinished = serverPlayersFinished;

            // Remove the listener after updating the status
            socket.off('noClientHasFinished', gameNotFinishedListener);

            // Resolve the promise after updating the status
            resolve("gameNotFinished");
        }

        socket.on('gameHasFinished', gameFinishedListener);
        socket.on('gameHasNotFinished', gameNotFinishedListener);
        socket.on('noClientHasFinished', noClientHasFinishedListener);
    });
}

async function finishGameAnimation(roomCode, socket, gameDeck, players, losingPlayer){
    return new Promise(async function (resolve, reject) {
        let finishedDeckDiv = document.getElementById("finishedDeck");

        // Find player who came last
        const lastPlacePlayer = GameModule.players.find(p => p.clientId === losingPlayer);

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
                            cardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 80);
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
                            losingCardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 80);
            });
        }

        
        // Let server know that client has finished deck animation and send player who won the round, finishedDeck, and GameDeck
        // Server will only accept the player and arrays from the host, but clients will still increment finishedDeck count
        socket.emit('finishGameAnimation', roomCode, players, gameDeck, GameModule.finishedDeck);
        
        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve();
    });
}

//after round ends, adds all played cards into finished deck and animates them as well
async function finishDeckAnimation(socket, roomCode) {
    return new Promise(async function (resolve, reject) {
        let finishedDeckDiv = document.getElementById("finishedDeck");

        for (let i = 0; i < GameModule.gameDeck.length; i++) {
            //loop through all game deck cards
            let card = GameModule.gameDeck[i];
            card.setSide('back');
            
            //wait until each card is finished animating
            await new Promise((cardResolve) => {
                setTimeout(function () {
                    card.animateTo({
                        delay: 0,
                        duration: 50,
                        ease: 'linear',
                        rot: 0,
                        x: 240 - GameModule.finishedDeck.cards.length * 0.25, //stagger the cards when they pile up, imitates original deck styling
                        y: -150 - GameModule.finishedDeck.cards.length * 0.25,
                        onComplete: function () {
                            GameModule.finishedDeck.cards.push(card); //push gameDeck card into finshedDeck
                            card.$el.style.zIndex = GameModule.finishedDeck.cards.length; //change z index of card to the length of finished deck
                            GameModule.finishedDeck.mount(finishedDeckDiv); //mount finishedDeck to div
                            card.mount(GameModule.finishedDeck.$el);  //mount card to the finishedDeck div
                            cardResolve(); //resolve, so next card can animate
                        }
                    });
                }, 10);
            });
        }

        // Let server know that client has finished deck animation and send player who won the round, finishedDeck, and GameDeck
        // Server will only accept the player and arrays from the host, but clients will still increment finishedDeck count
        socket.emit('finishDeckAnimation', roomCode, GameModule.players[GameModule.turn], GameModule.finishedDeck);

        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve('finishDeckComplete');
    });
}

function incrementedTurn(socket) {
    return new Promise((resolve) => {
        const listener = (serverCurrentTurnClientId) => {
            // Find index of player who's turn it is using the clientId from the server
            const clientPlayerIndex = GameModule.players.findIndex(p => p.clientId === serverCurrentTurnClientId);

            if (clientPlayerIndex !== -1) {
                // Update local gameState turn to match server's turn
                GameModule.turn = clientPlayerIndex;

                //go back to player 1's turn after player 4's turn
                if (GameModule.turn > 3) GameModule.turn = 0;

                // Remove the listener after updating the status
                socket.off('turnIncremented', listener);

                // Resolve the promise after updating the status
                resolve();
            } else {
                console.log('Client player not found');
            }
        };

        socket.on('turnIncremented', listener);
    });
}

function passedTurn(socket) {
    return new Promise((resolve) => {
        const listener = (serverPlayer, serverCurrentTurnClientId) => {
            console.log("server player")
            console.log(serverPlayer);
            // Find index of player who's turn it is server side, using the clientId from the server
            const clientPlayerIndex = GameModule.players.findIndex(p => p.clientId === serverCurrentTurnClientId);
            
            if (clientPlayerIndex !== -1) {
                // update local equivalent to match server 
                GameModule.players[clientPlayerIndex].passed = serverPlayer.passed;

                // Update local gameState turn to match server's turn
                GameModule.turn = clientPlayerIndex;

                //go back to player 1's turn after player 4's turn
                if (GameModule.turn > 3) GameModule.turn = 0;
                console.log("Player passed");

                // Remove the listener after updating the status
                socket.off('passedTurn', listener);

                // Resolve the promise after updating the status
                resolve();
            } else {
                console.log('Client player not found');
            }
        };

        socket.on('passedTurn', listener);
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

//return last played hand as an array of card rank + suit
function printLastPlayedHand(gameDeck, lastValidHand){
    const lastPlayedHand = []; //card array holds the hand that we will use to validate
    const lastPlayedHandIndex = gameDeck.length - lastValidHand;
    console.log("last played hand index: " + lastPlayedHandIndex);

    //loop from last hand played until end of gamedeck
    for(let i = lastPlayedHandIndex; i < gameDeck.length; i++){
        //if i less than 0 (happens after user wins a round, because gamedeck length is 0 and lastValidHand stores length of winning hand)
        if(i < 0){
            continue; //no cards played
        }
        //make a lookup table that converts the suit to icon and rank to actual rank (eg [0, 13] will turn to [♦, K]) because this function is just for printing no validating
        lastPlayedHand.push(rankLookup[gameDeck[i].rank] + suitLookup[gameDeck[i].suit]); 
    }

    return lastPlayedHand;
}

function gotLastHand(socket) {
    return new Promise((resolve) => {
        const listener = (serverLastHand) => {
            if(serverLastHand.length > 0){
                GameModule.lastHand = serverLastHand;

                // Remove the listener after updating the status
                socket.off('gotLastHand', listener);

                // Resolve the promise after updating the status
                resolve();
            }
            else {
                // Remove the listener after updating the status
                socket.off('gotLastHand', listener);

                // Resolve the promise after updating the status
                resolve();
            }
        };

        socket.on('gotLastHand', listener);
    });
}

//Actual game loop, 1 loop represents a turn
const gameLoop = async (roomCode, socket) => {
    // Empty the finished deck of all its cards, so it can store post round cards
    GameModule.finishedDeck.cards.forEach(function (card) {
        card.unmount();
    });
    GameModule.finishedDeck.cards = [];

    //sort all player's cards, it will resolve once all 4 clients sorting animations are complete
    let sortResolve = await sortHands(GameModule.players, socket, roomCode); 

    if(sortResolve === 'sortComplete'){
        socket.emit('getFirstTurn', roomCode);

        GameModule.turn = await getFirstTurn(socket);
        console.log("TURN IS: " + GameModule.turn);

        //let rotation = initialAnimateArrow(turn); //return initial Rotation so I can use it to animate arrow
        let gameInfoDiv = document.getElementById("gameInfo");

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

            // Emit the last played hand array (it will be the rank + appropriate suit icon)
            const lastHand = printLastPlayedHand(GameModule.gameDeck, GameModule.lastValidHand)
            
            socket.emit('getLastHand', roomCode, lastHand);
            
            await gotLastHand(socket);

            gameInfoDiv.innerHTML = "Last Hand: " + GameModule.lastHand;

            //Change turn here
            displayTurn(GameModule.turn);
            
            // Send message to server to change client's wonRound status to false
            socket.emit('resetPlayerWonRoundStatus', roomCode) 

            // Update local GameModule players with info from server
            await resetWonRoundStatus(socket);

            // Check with the server if three players have passed
            socket.emit('checkWonRound', roomCode)

            // Reset passed property to false if three players have passed and resolve wonRound
            let checkWonRound = await checkThreePasses(socket);

            console.log(checkWonRound);
            
            // All players have passed, perform necessary actions
            // If player has won a round, play finishDeck animation,
            // and set gameDeck length to 0 which gives player a free turn
            if (checkWonRound == "wonRound") {
                console.log("reached here");
                //wait for finish deck animations, and send local gameDeck and finishedDeck to sever so it can emit it to all clients
                await finishDeckAnimation(socket, roomCode);

                // Update player who won the round's wonRound to true and update local gameDeck, and finishedDeck to match server 
                await finishWonRound(socket);

                console.log("Player " + GameModule.turn + " has won the round, has a free turn");
                console.log(GameModule.players[GameModule.turn].wonRound);
            }
            
            // If local client's turn then emit hand, else wait to receive other clients hand
            if(GameModule.players[GameModule.turn].clientId === GameModule.players[0].clientId) {
                await GameModule.players[GameModule.turn].playCard(GameModule.gameDeck, GameModule.lastValidHand, GameModule.playersFinished, roomCode, socket);
            }

            // Return playedHand length from server (if its not clients turn then they will listen for other clients hand emit and then mirror move with opponent)
            GameModule.playedHand = await receivePlayerHand(socket, GameModule.turn);

            console.log("Played Hand Length: " + GameModule.playedHand)

            //if player played a valid hand
            if(GameModule.playedHand >= 1 && GameModule.playedHand <= 5){
                //GameModule.playedHistory.push(GameModule.lastHand); //push last valid hand into playedHistory array

                console.log("played hand debug: " + GameModule.playedHand);

                // Each client sets their passed property to false and emits to server gamestate
                socket.emit('resetPlayersPassed', roomCode, GameModule.players[0].clientId);

                //once a player plays a valid hand, pass tracker should be reset to 0, so all players pass property should reset to false
                // Update passed status to server gameState values
                await resetPlayersPassed(socket);

                // do a new function here input current turn, instead so theres only one animation per turn instead of all cards being sorted after each turn
                //if player or ai play a valid hand, sort their cards
                // WORKS UP TO HERE
                await sortPlayerHandAfterTurn(socket, roomCode);

                //GameModule.lastValidHand = GameModule.playedHand; //store last played hand length, even after a player passes (so I dont pass 0 into the card validate function in player class)
                // emit this change to server and then receive it from server
                socket.emit('setLastValidHand', roomCode, GameModule.playedHand);

                // Update GameModule.playedHand and lastPlayedHand to server values
                await setValidHand(socket);
                
                // if current turn's player has no cards left, add their clientId to playersFinished array
                if (GameModule.players[GameModule.turn].numberOfCards === 0) {
                    GameModule.players[GameModule.turn].finishedGame = true;
                    GameModule.playersFinished.push(GameModule.players[GameModule.turn].clientId);
                }

                console.log("PLAYERS FINISHED LENGTH: " + GameModule.playersFinished.length)
                // Emit current turn's player to server and check if they have 0 cards left so server can check if game is over
                socket.emit('checkIfPlayerHasFinished', roomCode, GameModule.players[GameModule.turn], GameModule.playersFinished)
                
                // Return appropriate resolve based on gameFinished checks from the server
                let checkFinishedGame = await finishedGameCheckComplete(socket);

                // If server returns a full playersFinished array
                if(checkFinishedGame == "gameFinished") {
                    // send an emit to server once client finish game animation has finished
                    await finishGameAnimation(roomCode, socket, GameModule.gameDeck, GameModule.players, GameModule.losingPlayer);
                        
                    // await response from server once all 4 clients have finished their animations and resolve the results back to startGame function
                    await finishedGame(socket);

                    // emit here to let server know that game is over and to get the results
                    return new Promise(resolve => {
                        //unmount finishedDeck
                        GameModule.finishedDeck.unmount();
                        
                        //return results of game in GameModule.playersFinished array e.g [0, 2, 1, 3] (player 1, player 3, player 2, player 4)
                        resolve(GameModule.playersFinished);
                    });
                }
                // Else if game has not finished yet
                else {
                    // clients will emit the clientId of current player's turn (server will only accept hosts clientId emit)
                    socket.emit('incrementTurn', roomCode, GameModule.players[GameModule.turn].clientId); //server counts 4 emits, then socket.on clientside to increment turn
                    
                    await incrementedTurn(socket);
                }
            }
            else if(GameModule.playedHand == 0){ //else if player passed
                // clients will emit the clientId of current player's turn (server will only accept hosts clientId emit)
                socket.emit('passTurn', roomCode, GameModule.players[GameModule.turn].clientId); //server counts 4 emits, then socket.on clientside to increment turn
                    
                await passedTurn(socket);

                console.log(GameModule.players[GameModule.turn].clientId + " clientId passed");
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

// Handles the lobbyMenu, which allows players in the same room to chat and ready up for the game, once all players are ready it will resolve socket
async function lobbyMenu(socket, roomCode){
    const lobbyMenu = document.getElementById("lobbyMenu");
    const connectedClientsDiv = document.getElementById("connectedClients");
    const messageContainer = document.getElementById("messageContainer");
    const messageInput = document.getElementById("messageInput");
    const sendMessageButton = document.getElementById("sendMessageButton");
    const readyButton = document.getElementById("readyButton");
    const startGameButton = document.getElementById("startGameButton");
    const backToJoinRoomButton = document.getElementById("backToJoinRoomButton");

    startGameButton.disabled = true; //disable startGameButton until 4 players are ready and current client is the host of the room
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
            if (client.isHost) {
                return `${client.username} (host)`;
            } else {
                return client.username;
            }
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

    //TO DO I want the text content of the ready button to update when player clicks on the ready up button ('ready up 1/4', the server should keep track of clients ready state)
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
            
            if (readyPlayersCount === 4) {
                //if player is host enable start button
                // Request to check if the client is the host of a room
                socket.emit('checkHost', roomCode);
            }
        });

        // When 4 players are ready and current client is the host, enable startGameButton
        socket.on('hostStatus', ({ isHost, error }) => {
            if (error) {
                console.error(error);
            } else {
                if (isHost) {
                    console.log('You are the host of the room.');
                    startGameButton.disabled = false;

                    startGameButton.addEventListener("click", () => {
                        handleStartClick();
                    });
                    
                } else {
                    console.log('You are not the host of the room.');
                }
            }
        });

        // Client performs clean up and resolves socket when host starts the game
        socket.on('gameStarted', () => {
            //remove all event listeners and sockets
            startGameButton.removeEventListener("click", handleStartClick);
            readyButton.removeEventListener("click", toggleReadyState);
            sendMessageButton.removeEventListener('click', sendMessage);
            messageInput.removeEventListener('keydown', handleEnterKey);

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('hostStatus');
            socket.off('gameStarted');
        
            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";
            clearInterval(refreshInterval);

            resolve(socket);
        });

        // if client(host) clicks on startGameButton
        function handleStartClick() {
            //emit startGame, put client usernames into server gameState object, and then receive gameState object
            socket.emit('startGame', roomCode);

            //remove all event listeners and sockets
            startGameButton.removeEventListener("click", handleStartClick);
            readyButton.removeEventListener("click", toggleReadyState);
            sendMessageButton.removeEventListener('click', sendMessage);
            messageInput.removeEventListener('keydown', handleEnterKey);

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('hostStatus');
            socket.off('gameStarted');
        
            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";
            clearInterval(refreshInterval);

            resolve(socket);
        }

        // Handles clean up and resolves the promise when backToJoinRoomButton is clicked
        backToJoinRoomButton.addEventListener('click', () => {
            handleBackClick();
        });

        // Function to handle clean up of event listeners and sockets
        function handleBackClick() {
            // Emit leave room event, will return updated clientList event
            socket.emit('leaveRoom', roomCode);

            startGameButton.removeEventListener("click", handleStartClick);
            readyButton.removeEventListener("click", toggleReadyState);
            sendMessageButton.removeEventListener('click', sendMessage);
            messageInput.removeEventListener('keydown', handleEnterKey);
            backToJoinRoomButton.removeEventListener('click', handleBackClick);

            socket.off('clientList', updateClientList);
            socket.off('updateReadyState');
            socket.off('receiveMessage');
            socket.off('hostStatus');
            socket.off('gameStarted');

            // Hide the lobby menu and clear the interval
            lobbyMenu.style.display = "none";
            clearInterval(refreshInterval);

            resolve('goBackToJoinRoomMenu');
        }
    });
}

async function startGame(socket, roomCode, username){
    //unhide buttons and gameInfo divs
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const gameInfo = document.getElementById("gameInfo");
    const playerInfo = document.getElementsByClassName("playerInfo");
    let serverDeck;
    
    playButton.style.display = "block";
    passButton.style.display = "block";
    gameInfo.style.display = "block";


    // Remove any existing event listeners for these events to avoid multiple listeners
    socket.off('clientSocketId');
    socket.off('shuffledDeck');
    socket.off('initialGameState');
    socket.off('allDealsComplete');

    // Assign local player with unique socket id
    const socketIdPromise = new Promise(resolve => {
        socket.on('clientSocketId', (clientId) => {
            console.log('Received client ID from server:', clientId);
            GameModule.players[0].socketId = clientId;
            resolve();
        })
    });

    await socketIdPromise;

    // Set up a promise to wait for the initial game state event
    const initialGamestatePromise = new Promise(resolve => {
        socket.on('initialGameState', ({ gameState }) => {

            // Using unique socket id, assign the appropriate index
            const localPlayerIndex = gameState.players.findIndex(player => player.socketId === GameModule.players[0].socketId);
            console.log("LOCAL PLAYER INDEX:" + localPlayerIndex)

            if (localPlayerIndex !== -1) {
                // Iterate over gameState.players and assign each player to GameModule.players based on local player's position in gameState array
                // every local client will have a different gameModule.players order (e.g. if local player(players[0]) is clientId3, players[1]=clientId1, players[2]=clientId2, etc)
                gameState.players.forEach((gsPlayer, index) => {
                    const gameModuleIndex = (index - localPlayerIndex + 4) % 4; // Calculate GameModule index

                    GameModule.players[gameModuleIndex].name = gsPlayer.name;
                    GameModule.players[gameModuleIndex].clientId = gsPlayer.clientId;
                });
            }

            // Loop through the playerInfo elements and set their display property to block and appropriate player name to elements
            for (var i = 0; i < playerInfo.length; i++) {
                playerInfo[i].style.display = 'block';
                playerInfo[i].innerHTML = GameModule.players[i].name + " " + GameModule.players[i].clientId; //maybe add points here as well?
            }

            resolve();
        });
    });
 
    // Set up a promise to wait for the shuffledDeck event
    const shuffledDeckPromise = new Promise(resolve => {
        socket.on('shuffledDeck', ({ cards }) => {
            serverDeck = cards;
            resolve(); // Resolve the promise when serverDeck is set
        });
    });

    
    await initialGamestatePromise;
    console.log(GameModule.players);
    await shuffledDeckPromise;
    
    
    // deal cards to all players and return resolve when animations are complete
    await dealCards(GameModule.players, serverDeck, socket, roomCode);

    // Set up a promise to wait for the allDealsComplete event
    const allDealsCompletePromise = new Promise(resolve => {
        socket.on('allDealsComplete', () => {
            resolve(); // Resolve the promise when allDealsComplete event is received
        });
    });

    await allDealsCompletePromise;

    // Cards have been dealt and animations are complete
    console.log('Dealing complete');
    let results = await gameLoop(roomCode, socket);
    return results; //return results
}

async function endMenu() {
    const endMenu = document.getElementById("endMenu");
    const nextGameButton = document.getElementById("nextGameButton");
    const quitGameButton = document.getElementById("quitGameButton");

    //hide buttons and gameInfo divs
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const gameInfo = document.getElementById("gameInfo");

    playButton.style.display = "none";
    passButton.style.display = "none";
    gameInfo.style.display = "none";

    endMenu.style.display = "block";

    return new Promise((resolve) => {
         // Define the click event listener function for nextGameButton
         function handleNextGameClick() {
            // Remove the click event listener for nextGameButton
            nextGameButton.removeEventListener("click", handleNextGameClick);
            // Hide the menu
            endMenu.style.display = "none";
            // Resolve the promise with the value "nextGame"
            resolve("nextGame");
        }

        // Define the click event listener function for quitGameButton
        function handleQuitGameClick() {
            // Remove the click event listener for quitGameButton
            quitGameButton.removeEventListener("click", handleQuitGameClick);
            // Hide the menu
            endMenu.style.display = "none";
            // Resolve the promise with the value "quitGame"
            resolve("quitGame");
        }

        // Add click event listeners to the buttons
        nextGameButton.addEventListener("click", handleNextGameClick);
        quitGameButton.addEventListener("click", handleQuitGameClick);
    });
}

//take in results array and assign points to each player
function calculatePoints(results) {
    //1st - 3 points, 2nd - 2 points, 3rd - 1 points, 4th - 0 points

    //increment points and win property for player who came first
    GameModule.players[results[0]].points += 3;
    GameModule.players[results[0]].wins += 1;

    GameModule.players[results[1]].points += 2;
    GameModule.players[results[1]].seconds += 1;

    GameModule.players[results[2]].points += 1;
    GameModule.players[results[2]].thirds += 1;

    GameModule.players[results[3]].points += 0;
    GameModule.players[results[3]].losses += 1;
}

//update leaderboard standings based on points (maybe add a picture, wins, seconds, thirds, losses columns)
function updateLeaderboard() {
    const leaderboardBody = document.getElementById("leaderboard-body");

    // Clear existing leaderboard rows
    leaderboardBody.innerHTML = "";

    // Sort players array by points (descending order)
    const sortedPlayers = GameModule.players.slice().sort((a, b) => b.points - a.points);

    // Create a leaderboard row for each player
    sortedPlayers.forEach((player) => {
        //create new row for each player (each row will contain name, points, wins, seconds, etc)
        const row = document.createElement("tr");

        const playerNameCell = document.createElement("td");
        playerNameCell.textContent = player.name;
        row.appendChild(playerNameCell);

        const playerPointsCell = document.createElement("td");
        playerPointsCell.textContent = player.points;
        row.appendChild(playerPointsCell);

        const playerWinsCell = document.createElement("td");
        playerWinsCell.textContent = player.wins;
        row.appendChild(playerWinsCell);

        const playerSecondsCell = document.createElement("td");
        playerSecondsCell.textContent = player.seconds;
        row.appendChild(playerSecondsCell);

        const playerThirdsCell = document.createElement("td");
        playerThirdsCell.textContent = player.thirds;
        row.appendChild(playerThirdsCell);

        const playerLossesCell = document.createElement("td");
        playerLossesCell.textContent = player.losses;
        row.appendChild(playerLossesCell);

        //append row to leaderboard body
        leaderboardBody.appendChild(row);
    });
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

        // Once code reaches here, it means 4 clients have readied up
        let results = await startGame(joinedRoomSocket, roomCode, username);

        console.log(results);
    }
    
    /* Return user choice from main menu
    let startMenuResolve = await startMenu();
    let endMenuResolve;

    while(true){

        //if user quits game
        if(endMenuResolve=="quitGame"){
            //reset everything including player points
            console.log('Game quit');
            GameModule.resetAll();
            //return to main menu
            startMenuResolve = await startMenu();
        }

        // start the game and return results of game
        let results = await startGame(startMenuResolve);

        if(results.length == 4){
            console.log('Game complete!');
            console.log(results);
            //calculate points based on results
            calculatePoints(results);
            // Call updateLeaderboard function whenever needed, such as after calculating points
            updateLeaderboard();

            endMenuResolve = await endMenu();

            if(endMenuResolve == "nextGame"){
                GameModule.reset();
                console.log("Game Reset")
            }
        }*/
};

