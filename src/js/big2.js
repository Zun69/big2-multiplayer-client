import Player from "./player.js"
import Opponent from "./opponent.js"
import GameState from "./gameState.js"

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

//GameModule object encapsulate players, deck, gameDeck, finishedDeck 
const GameModule = (function() {
    // Initial values
    //let initialPlayer1 = new Player();
    let player1 = new Player();
    let player2 = new Opponent(); //ai player
    let player3 = new Opponent();
    let player4 = new Opponent();
    
    // Current values
    let players = [player1, player2, player3, player4];
    let gameDeck = [];
    let finishedDeck = Deck();

    // reset everything except points, wins, seconds, etc (next game)
    function reset() {
        players.forEach(player => {
            // Reset player properties
            player.cards = [];
            player.wonRound = false;
            player.wonGame = false;
            player.passed = false;
            player.readyState = false;
        });
        gameDeck.length = 0;
        finishedDeck = Deck();
    }

    // reset everything (quit game)
    function resetAll() {
        players.forEach(player => {
            // Reset player properties
            player.cards = [];
            player.wonRound = false;
            player.wonGame = false;
            player.passed = false;
            player.readyState = false;
            player.points = 0;
            player.wins = 0;
            player.seconds = 0;
            player.thirds = 0;
            player.losses = 0;
        });
        gameDeck.length = 0;
        finishedDeck = Deck();
    }

    //return GameModule properties
    return {
        players,
        gameDeck,
        finishedDeck,
        reset,
        resetAll
    };
})();

async function sortPlayerHandAfterTurn(players,turn){
    const animationPromises = [];

    //sort player's card after turn
    //players[turn].sortHand();

    console.log("TURN: " + turn);
    // Push the animation promise into the array
    animationPromises.push(players[turn].sortingAnimationAfterTurn(turn));

    // Wait for all animation promises to resolve
    await Promise.all(animationPromises);

    console.log("hand sorted after turn")

    // return resolve, to let game loop know that player's cards have been sorted
    return Promise.resolve('sortAfterTurnComplete');
}

//function sorts everybody's cards and plays the animation, resolves when animations finish
async function sortHands(players){ 
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

    // You can return a resolved promise if needed
    return Promise.resolve('sortComplete');
}

//purpose is to wait for shuffle animation finish before resolving promise back to dealCards function
function shuffleDeckAsync(deck, times, delayBetweenShuffles) {
    return new Promise((resolve) => {
      const shufflePromises = [];
  
      for (let i = 0; i < times; i++) {
        shufflePromises.push(
          new Promise((innerResolve) => {
            setTimeout(() => {
              deck.shuffle();
              innerResolve();
            }, i * delayBetweenShuffles);
          })
        );
      }
  
      Promise.all(shufflePromises).then(() => {
        setTimeout(() => {
          resolve('shuffleComplete');
        }, 300); //default 2100 7 shuffles  (3 shuffles = 850, etc)
      });
    });
}

async function dealCards(players) {
    return new Promise(function (resolve, reject) {
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

        // Display the deck in an HTML container
        let deck = Deck();
        let $container = document.getElementById('gameDeck');
        deck.mount($container);
        console.log("deck mounted")

        let shufflePromise = shuffleDeckAsync(deck, 1, 0);

        // Use a for...of loop to iterate over the cards with asynchronous behavior
        var playerIndex = 0;

        shufflePromise.then(function(value) {
            if(value == "shuffleComplete"){
                const animationPromises = []; // Array to store animation promises

                deck.cards.reverse().forEach(function (card, i) {
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
                            players[playerIndex].addCard(card); //add card to player's hand
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

                    //Remove reference to the deck instance
                    deck = null; 
                    resolve('dealingComplete');
                });
            }
        });       
    });
}

async function determineTurn(players) {
    // Loop through all player's cards to check for 3 of diamonds, if they have it, they have the 1st turn
    let promise = new Promise((resolve, reject) => {
      players.some((player, index) => {
        if (player.cards.some(card => card.suit == '0' && card.rank == '3')) {
          resolve(index);
          return true; // Stop looping once the first player with 3 of diamonds is found
        }
      });
    });
  
    return await promise;
}

async function finishGameAnimation(gameDeck, finishedDeck, players, losingPlayer){
    return new Promise(async function (resolve, reject) {
        let finishedDeckDiv = document.getElementById("finishedDeck");

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
        for (let i = 0; i < players[losingPlayer].numberOfCards; i++){
            let losingCard = players[losingPlayer].cards[i];
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

        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve('finishGameComplete');
    });
}

//after round ends, adds all played cards into finished deck and animates them as well
async function finishDeckAnimation(gameDeck) {
    return new Promise(async function (resolve, reject) {
        let finishedDeckDiv = document.getElementById("finishedDeck");

        for (let i = 0; i < gameDeck.length; i++) {
            //loop through all game deck cards
            let card = gameDeck[i];
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

        // All card animations are complete, mount finishedDeck to finish deck div and return resolve
        resolve('finishDeckComplete');
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

function findMissingPlayer(playersFinished) {
    // Create an array to hold all players from 0 to 3
    let allPlayers = [0, 1, 2, 3];

    // Loop through the playersFinished array to remove players who have finished
    for (let i = 0; i < playersFinished.length; i++) {
        let index = allPlayers.indexOf(playersFinished[i]);
        if (index !== -1) {
            allPlayers.splice(index, 1); // Remove the player who has finished
        }
    }

    // Return the missing player
    return allPlayers[0];
}

//point arrow at player with 3 of diamonds
function initialAnimateArrow(playerIndex) {
    const arrowImg = document.querySelector('#arrow img');
    console.log("ROTATE TURN: " + playerIndex);

    // store initial rotation based on turn
    let initialRotation;
    
    // Adjust arrow rotation based on player index
    switch (playerIndex) {
      case 0: // Down
        initialRotation = 90;
        break;
      case 1: // Left
        initialRotation = 180;
        break;
      case 2: // Up
        initialRotation = 270;
        break;
      case 3: // Right
        initialRotation = 0;
        break;
    }
    
    //rotate arrow towards player with 3 of diamonds
    arrowImg.style.transform = `rotate(${initialRotation}deg)`;

    //return rotation so that the actual function that takes care of animating the arrow can increment on it by 90
    return initialRotation;
}

function animateArrow(rotation){
    // Set the new rotation angle
    const arrowImg = document.querySelector('#arrow img');

    //increase initial rotation by 90
    rotation += 90;

    console.log("ROTATE: " + rotation);
    
    //rotate arrow by 90 degrees
    arrowImg.style.transform = `rotate(${rotation}deg)`;

    //return rotation so I can feed it back into this function to keep increasing rotation by 90
    return rotation;
}

//Actual game loop, 1 loop represents a turn
const gameLoop = async _ => {
    // Empty the finished deck of all its cards, so it can store post round cards
    GameModule.finishedDeck.cards.forEach(function (card) {
        card.unmount();
    });
    GameModule.finishedDeck.cards = [];

    let sortResolve = await sortHands(GameModule.players); //sort all player's cards
    if(sortResolve === 'sortComplete'){
        let playedHand = 0; //stores returned hand length from playCard function
        let lastValidHand; //stores a number that lets program know if last turn was a pass or turn
        let turn = await determineTurn(GameModule.players); //return player number of player who has 3d
        let rotation = initialAnimateArrow(turn); //return initial Rotation so I can use it to animate arrow
        let gameInfoDiv = document.getElementById("gameInfo");
        let playersFinished = []; //stores finishing order
        let lastHand = []; //stores last hand played
        let playedHistory = [] //stores played card history

        const gameState = new GameState(GameModule.players, GameModule.gameDeck, lastHand, turn, lastValidHand, GameModule.finishedDeck, playersFinished, playedHistory, playedHand);

        //GAME LOOP, each loop represents a single turn
        for(let i = 0; i < 100; i++){
            //used for displaying last played hand with actual suit icons 
            lastHand = printLastPlayedHand(GameModule.gameDeck, lastValidHand);
            
            // Update gameState properties with new values
            gameState.lastHand = lastHand;
            gameState.lastValidHand = lastValidHand;
            gameState.turn = turn;
            gameState.playedHistory = playedHistory;
            gameState.playedHand = playedHand;

            //log gameState values
            console.log("GameState Players:", gameState.players);
            console.log("GameState Game Deck:", gameState.gameDeck);
            console.log("GameState Last Hand:", gameState.lastHand);
            console.log("GameState Turn:", gameState.turn);
            console.log("GameState Finished Deck:", gameState.finishedDeck);
            console.log("GameState Players Finished:", gameState.playersFinished);
            console.log("GameState playedHand:", gameState.playedHand);

            gameInfoDiv.innerHTML = "Last Played: " + lastHand + "<br>Current Turn: " + GameModule.players[turn].name;

            //animate arrow by incrementing rotation found initially by 90
            rotation = animateArrow(rotation);

            //reset all player's wonRound status
            for(let i = 0; i < GameModule.players.length; i++) {
                GameModule.players[i].wonRound = false;
            }

            // All players have passed, perform necessary actions
            if (GameModule.players.filter(player => player.passed).length === 3) {
                console.log("Three players have passed. Resetting properties:");
                // Reset all players' passed properties to false
                GameModule.players.forEach(player => {
                    player.passed = false;
                });

                //wait for finish deck animations
                let finishDeckResolve = await finishDeckAnimation(GameModule.gameDeck, finishedDeck);

                if(finishDeckResolve == "finishDeckComplete"){
                    GameModule.players[turn].wonRound = true; //if player has won the round, make wonRound property true
                    console.log("Player " + gameState.turn + " has won the round, has a free turn");
                    GameModule.gameDeck.length = 0; //clear the game deck because player has won round, like in real life TODO: record the gameDeck before resetting (to show card's played)
                }
            }
            
            //if opponent's turn
            if(GameModule.players[turn].isOpponent){
                //playedHand = resolved hand.length, function also validates hand
                playedHand = await GameModule.players[turn].playCard(GameModule.gameDeck, turn, lastValidHand, GameModule.players);
            }
            //else if user's turn
            else{
                playedHand = await GameModule.players[turn].playCard(GameModule.gameDeck, lastValidHand, playersFinished);
            }

            //if player played a valid hand
            if(playedHand >= 1 && playedHand <= 5){
                playedHistory.push(lastHand); //push last valid hand into playedHistory array

                console.log("played hand debug: " + playedHand);

                //once a player plays a valid hand, pass tracker should be reset to 0, so all players pass property should reset to false
                GameModule.players.forEach(player => {
                    player.passed = false;
                });

                // do a new function here input current turn, instead so theres only one animation per turn instead of all cards being sorted after each turn
                //if player or ai play a valid hand, sort their cards
                let resolve = await sortPlayerHandAfterTurn(GameModule.players,turn);
                
                if(resolve == 'sortAfterTurnComplete'){
                    lastValidHand = playedHand; //store last played hand length, even after a player passes (so I dont pass 0 into the card validate function in player class)
    
                    //check if current player has 0 cards
                    if (GameModule.players[turn].numberOfCards == 0){
                        //add player number to playersFinished array
                        GameModule.players[turn].wonGame = true;
                        playersFinished.push(turn);
                    
                        //if 3 players have no cards left, means game is over
                        if(playersFinished.length == 3){
                            //find the player that came last (0-3)
                            let losingPlayer = findMissingPlayer(playersFinished);
                            //push losing player to playersFinished array (used for leaderboard)
                            playersFinished.push(losingPlayer);

                            let finishGameResolve = await finishGameAnimation(GameModule.gameDeck, finishedDeck, GameModule.players, losingPlayer);
                            
                            if(finishGameResolve == "finishGameComplete")
                            {
                                //reset arrow image back to original rotation
                                const arrowImg = document.querySelector('#arrow img');
                                arrowImg.style.transform = 'rotate(0deg)';

                                return new Promise(resolve => {
                                    //unmount finishedDeck
                                    GameModule.finishedDeck.unmount();
                                    
                                    //return results of game in playersFinished array e.g [0, 2, 1, 3] (player 1, player 3, player 2, player 4)
                                    resolve(playersFinished);
                                });
                            }   
                        }
                    }
                    //go to next player's turn
                    turn += 1;

                    //go back to player 1's turn after player 4's turn
                    if (turn > 3) turn = 0; 
                }
            }
            else if(playedHand == 0){ //else if player passed
                GameModule.players[turn].passed = true; //if player passes, set passed property to true
                turn += 1;
                console.log("Player passed");
                if (turn > 3) turn = 0;
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
                resolve(socket);
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
    const joinRoomMenu = document.getElementById("joinRoomMenu");
    const availableRoomsDiv = document.getElementById('availableRooms');
    const joinRoomButton = document.getElementById("joinRoomButton");
    const roomCodeInput = document.getElementById("roomCode");
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
                const roomElement = document.createElement('p');
                roomElement.textContent = `${roomCode} - ${numClients}/4`;
                availableRoomsDiv.appendChild(roomElement);
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

    return new Promise((resolve) => {
        // Define the click event listener function
        function handleClick() {
            //remove the click event listener for joinRoom button
            joinRoomButton.removeEventListener("click", handleClick);

            // Validate and sanitize the room code
            let roomCode = sanitizeInput(roomCodeInput.value);
            roomCode = roomCode.slice(0, 6); // Limit to 6 characters

            roomCodeInput.value = roomCode;

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

        // Add a click event listener to the join room button
        joinRoomButton.addEventListener("click", () => {
            // Input box validation
            if (roomCodeInput.value.trim() === '') {
                errorMessage2.innerText = "Room code is required.";
                errorMessage2.style.display = "block";
                return;
            }

            if (roomCodeInput.value.length > 6) {
                errorMessage2.innerText = "Room code should be 6 characters or less.";
                errorMessage2.style.display = "block";
                return;
            }

            handleClick();
        });
    });
}

async function lobbyMenu(socket, roomCode){
    const lobbyMenu = document.getElementById("lobbyMenu");
    const connectedClientsDiv = document.getElementById("connectedClients");
    const messageContainer = document.getElementById("messageContainer");
    const messageInput = document.getElementById("messageInput");
    const sendMessageButton = document.getElementById("sendMessageButton");
    const readyButton = document.getElementById("readyButton");
    let isReady = false; // Track the local client's ready state

    // Display lobbyMenu
    lobbyMenu.style.display = "block";

    // Function to request clients and update the connectedClientsDiv
    function refreshClientList() {
        // Request client list
        socket.emit('getClientList', { roomCode: roomCode });
    }
    
    // Function to update the client list, takes in clientList event from server
    function updateClientList(clientList) {
        // Update the local client list
        localClientList = clientList;

        // Extract usernames from clientList
        const usernames = clientList.map(client => client.username);

        // Clear the existing content and add the heading
        connectedClientsDiv.innerHTML = `<h3>Players in Room ${roomCode}</h3>`;
        
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
        socket.emit('sendMessage', { roomCode, message });
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
        socket.emit('toggleReadyState', { roomCode, isReady });
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
                readyButton.removeEventListener("click", toggleReadyState);
                sendMessageButton.removeEventListener('click', sendMessage);
                messageInput.removeEventListener('keydown', handleEnterKey);
                lobbyMenu.style.display = "none";
                clearInterval(refreshInterval);
                socket.off('clientList', updateClientList);
                resolve(socket);
            }
        });
    });
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

async function startGame(socket, roomCode){
    //emit startGame, put client usernames into server gameState object, and then receive gameState object
    socket.emit('startGame', { roomCode });
    
    //unhide buttons and gameInfo divs
    const playButton = document.getElementById("play");
    const passButton = document.getElementById("pass");
    const gameInfo = document.getElementById("gameInfo");

    playButton.style.display = "block";
    passButton.style.display = "block";
    gameInfo.style.display = "block";

    // deal cards to all players and return resolve when animations are complete
    let dealResolve = await dealCards(GameModule.players);

    if(dealResolve === 'dealingComplete'){
        // Cards have been dealt and animations are complete
        console.log('Dealing complete');
        let results = await gameLoop();
        return results; //return results
    }
    
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
    let endMenuResolve;

    // require username and password to establish connection to socket.io server and resolve the connected socket object
    let loginMenuResolve = await loginMenu()

    // once client has established connection to the server, require room code to join a game lobby and then resolve the socket thats connected to a room
    const { socket: joinedRoomSocket, roomCode } = await joinRoomMenu(loginMenuResolve);

    // a lobby room where clients wait and can chat with each other until 4 clients join, where they can then start the game, might allow bots as filler
    let lobbyMenuResolve = await lobbyMenu(joinedRoomSocket, roomCode);

    // once code reaches here, it means 4 clients have readied up
    let results = await startGame(lobbyMenuResolve, roomCode);

    /*while(true){
        //if user quits game
        if(endMenuResolve=="quitGame"){
            //reset everything including player points
            console.log('Game quit');
            GameModule.resetAll();
            //return to main menu
            joinRoomMenuResolve = await joinRoomMenu();
        }

        // start the game and return results of game
        let results = await startGame(lobbyMenuResolve);

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
        }
    }*/
};

