export default class Player{ 
    constructor(name, cards = []){ // Player object, which will contain name, cards, wonRound & wonGame & pass status, point tally 
        this.name = name;
        this.cards = cards;
        this.wonRound = false;
        this.wonGame = false;
        this.passed = false;
        this.clientId = null; // Set to null initially, will set later in the lobbyMenu
        this.playerDiv = null;
        this.points = 0;
        this.wins = 0;
        this.seconds = 0;
        this.thirds = 0;
        this.losses = 0;
    }

    get numberOfCards() { 
        return this.cards.length;
    }

    addCard(card){
        //add cards to hand
        this.cards.push(card);
    }

    // Function to remove all cards from player
    removeAllCards() {
        this.cards = [];
    }

    //return card from given card id
    searchCard(cardId){
        for(let i = 0; i < this.numberOfCards; i++){
            if(cardId == this.cards[i].suit + this.cards[i].value){
                return this.cards[i];
            }
        }
    }

    //sort player's cards
    sortHand(){
        let deck = new Deck();
        deck.sort();
        let cardMap = deck.cardHash();

        //bubble sort using cardMap to compare card values
        for(var i = 0; i < this.numberOfCards; i++){
            for(var j = 0; j < (this.numberOfCards - i - 1); j++){
                //use current card as a key to cardMap using position value to compare and sort the cards, cant use object as a key
                if(cardMap.get(this.cards[j].suit + " " + this.cards[j].rank) > cardMap.get(this.cards[j + 1].suit + " " + this.cards[j + 1].rank)){
                    let temp = this.cards[j];
                    this.cards[j] = this.cards[j+1];
                    this.cards[j+1] = temp;
                }
            }
        }
    }

    //sort hand that user has selected
    sortHandArray(hand){
        let deck = new Deck();
        deck.sort()
        let cardMap = deck.cardHash();
        
        //bubble sort using cardMap to compare card values
        for(var i = 0; i < hand.length; i++){
            for(var j = 0; j < (hand.length - i - 1); j++){
                //use current card as a key to cardMap using position value to compare and sort the cards (e.g. key pair = 0 3 (diamonds, 3))
                if(cardMap.get(hand[j]) > cardMap.get(hand[j + 1])){ 
                    let temp = hand[j];
                    hand[j] = hand[j+1];
                    hand[j+1] = temp;
                }
            }
        }
        console.log("currrent hand: " + hand);
    }

    sortingAnimationY(index, playerNum){
        switch(playerNum){
            //player 1 Y coordinates (began sorting cards at this Y coordinate)
            case 0:
                return 230;
            case 1:
                return -240 + index * 40;
            case 2:
                return -250;
            case 3:
                return 242 - index * 40;
        }
    }

    sortingAnimationX(index, playerNum) {
        // Calculate the new X position based on the index
        switch(playerNum){
            //player 1 X coordinates (began sorting cards at this X coordinate)
            case 0:
                return -212 + index * 40;
            case 1:
                return -425;
            case 2:
                return 261 - index * 40;
            case 3:
                return 440;
        }
    }
      
    sortingAnimationZ(index, playerNum) {
        // Calculate the new z-index based on the index
        switch (playerNum) {
            case 0:
                return index * 4;
            case 1:
                return 1 + index * 4;
            case 2:
                return 2 + index * 4;
            case 3:
                return 3 + index * 4;
        }
    }

    sortingAnimationRotation(playerNum) {
        // Calculate the new z-index based on the index
        switch(playerNum){
            //player 1 card rotation when sorting
            case 0:
                return 0;
            case 1:
                return 270;
            case 2:
                return 0; 
            case 3:
                return 270; 
        }
    }

    //return rotateSideways boolean based on player number
    sortingRotateSidewaysBoolean(playerNum) {
        switch(playerNum){
            //player 1 card rotation when sorting
            case 0:
                return false;
            case 1:
                return true;
            case 2:
                return false; 
            case 3:
                return true; 
        }
    }

    //function for sorting animation, extends into opponent class (no need to reimplement in opponent class)
    sortingAnimation(playerNum) {
        // Create an array to store all the animation promises
        const animationPromises = [];
        
        // Update the cards' positions and z-index
        this.cards.forEach((card, i) => {
            const animationPromise = new Promise((resolve) => {
                card.animateTo({
                    delay: 0,
                    duration: 200,
                    rot: this.sortingAnimationRotation(playerNum),
                    ease: 'linear',
                    x: this.sortingAnimationX(i, playerNum),  // Calculate the new X position based on index
                    y: this.sortingAnimationY(i, playerNum),
        
                    onComplete: () => {
                        card.$el.style.zIndex = this.sortingAnimationZ(i, playerNum);
                        resolve(); // Resolve the promise when this animation is completed
                      },
                });
            });
            animationPromises.push(animationPromise);
        });

        // Use Promise.all to wait for all animation promises to resolve
        return Promise.all(animationPromises);
    }

    //function for sorting animation, extends into opponent class (no need to reimplement in opponent class)
    sortingAnimationAfterTurn(playerNum) {
        // Create an array to store all the animation promises
        const animationPromises = [];
        
        // Update the cards' positions and z-index
        this.cards.forEach((card, i) => {
            const animationPromise = new Promise((resolve) => {
                card.animateTo({
                    delay: 0,
                    duration: 200,
                    rotateSideways: this.sortingRotateSidewaysBoolean(playerNum), // Set to true to rotate the card sideways
                    rot: 0,
                    ease: 'linear',
                    x: this.sortingAnimationX(i, playerNum),  // Calculate the new X position based on index
                    y: this.sortingAnimationY(i, playerNum),
        
                    onComplete: () => {
                        card.$el.style.zIndex = this.sortingAnimationZ(i, playerNum);
                        console.log("rotate after turn") //why does it remove the rotate property after two turns wtf?
                        resolve(); // Resolve the promise when this animation is completed
                      },
                });
            });
            animationPromises.push(animationPromise);
        });

        // Use Promise.all to wait for all animation promises to resolve
        return Promise.all(animationPromises);
    }
    
    //return combo string based on hand array
    validateCombo(hand){
        if(hand.length == 0 || hand.length == 1 || hand.length == 2 || hand.length == 3){
            return "N/A";
        }
        var splitCard1 = hand[0].split(' '); //output: splitCard1[0] = suit | splitCard[1] = value
        var splitCard2 = hand[1].split(' ');
        var splitCard3 = hand[2].split(' ');
        var splitCard4 = hand[3].split(' ');
        var splitCard5 = hand[4].split(' ');
        var straight = true;

        //start from 5th card in hand
        for(let i = 3; i >= 0; i--){
            var currentRank = +hand[i].split(' ')[1]; // Convert to number
            var nextRank = +hand[i + 1].split(' ')[1]; // Convert to number
            

            //if nextRank - currentRank value not 1, means card values are not exactly one rank higher
            if(nextRank - currentRank != 1){
                console.log("CURRENT RANK: " + currentRank + "NEXT RANK: " + nextRank + "i value: " + i);
                // J Q K A 2, make transition from king (current rank) to A (next rank) a valid straight
                if(i == 3 && currentRank == 13 && nextRank == 1){
                    console.log("10 J Q K A")
                    continue;
                }
                if(i == 2 && currentRank == 13 && nextRank == 1){
                    console.log("J Q K A 2")
                    continue;
                }
                //if i == 1 (2 card) AND currentRank == 13 (2 rank card) AND nextrank = 1 (3 rank card), means hand is A 2 3 4 5, continue to ace card
                //straight is lowest as it is A,2,3,4,5
                if(i == 1 && currentRank == 2 && nextRank == 3){
                    continue;
                }
                //if i == 0 (2 card) AND currentRank == 13 (2 rank card) AND nextrank = 1 (3 rank card), means hand is 2 3 4 5 6, continue to validate as straight
                //straight is second lowests as it is 2,3,4,5,6
                if(i == 0 && currentRank == 2 && nextRank == 3){
                    continue;
                }
                straight = false; //if hand of 5 does not contain a straight break out of for loop
                break; 
            }
        }
        
        //if straight flush with 3 of diamonds (3d 4d 5d 6d 7d || Ad 2d 3d 4d 5d || 2d 3d 4d 5d 6d)
        for (let i = 0; i < hand.length; i++) {
            if(hand[i] == "0 3" && straight && hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){
                return "straightFlush3d";
            }
        }
        //if player has won previous round and plays a straight flush
        if(this.wonRound && straight && hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){
            return "straightFlushWonRound";
        }
        if(straight && hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){
            return "straightFlush";
        }
        //if hand contains a straight with a 3 of diamonds, return this first because if(straight) is first it will return "straight" instead of straight3d
        for (let i = 0; i < hand.length; i++) {
            if (hand[i] == "0 3" && straight) {
                return "straight3d";
            }
        }
        //if player won round and hand contains a straight 
        if(this.wonRound && straight){
            return "straightWonRound";
        }
        //if hand contains straight
        if(straight){
            return "straight";
        }
        //if first card is 3 of diamonds and every card in hand has the same suit as the first card in hand
        if(hand[0] == "0 3" && hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){ 
            return "flush3d";
        }
        //if player has won previous round and plays flush
        if(this.wonRound && hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){
            return "flushWonRound";
        }
        //if hand contains flush
        if(hand.every(card => card.slice(0, 1) === hand[0].slice(0,1))){
            return "flush";
        }
        //if hand is 333 55, or 33 555 format
        if((hand[0] == "0 3" && hand[1].includes("3") && hand[2].includes("3") && splitCard4[1] == splitCard5[1] 
            || hand[0] == "0 3" && hand[1].includes("3") && splitCard3[1] == splitCard4[1] && splitCard3[1] == splitCard5[1] && splitCard4[1] == splitCard5[1])){
            return "fullHouse3d";
        }
        //if player has won previous round and plays fullhouse(in either 44 222 or 333 22 format) 
        if((this.wonRound && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1] && splitCard4[1] == splitCard5[1] 
            || this.wonRound && splitCard1[1] == splitCard2[1] && splitCard3[1] == splitCard4[1] && splitCard3[1] == splitCard5[1] && splitCard4[1] == splitCard5[1])) { 
            return "fullHouseWonRound";
        }
        //if hand contains full house
        if((splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1] && splitCard4[1] == splitCard5[1] 
            || splitCard1[1] == splitCard2[1] && splitCard3[1] == splitCard4[1] && splitCard3[1] == splitCard5[1] && splitCard4[1] == splitCard5[1])){
            return "fullHouse";
        } 
        //(four of a kind + kicker) if 3 of diamonds and first 4 cards are the same, then last card doesnt matter
        if(hand[0] == "0 3" && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard3[1] == splitCard4[1]){ 
            return "fok3d";
        }
        //if prev round won and fok
        if(this.wonRound && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard3[1] == splitCard4[1]
            || this.wonRound && splitCard2[1] == splitCard3[1] && splitCard3[1] == splitCard4[1] && splitCard4[1] == splitCard5[1]){
            return "fokWonRound";
        }
        //if hand contains fok
        if(splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard3[1] == splitCard4[1] 
            || splitCard2[1] == splitCard3[1] && splitCard3[1] == splitCard4[1] && splitCard4[1] == splitCard5[1]){
            return "fok";
        }
        else{
            return "invalid combo";
        }
    }

    detectUniqueStraights(hand){
        let splitCard1 = hand[0].split(' ');
        let splitCard2 = hand[1].split(' ');
        let splitCard3 = hand[2].split(' ');
        let splitCard4 = hand[3].split(' ');
        let splitCard5 = hand[4].split(' ');

        //if hand contains 3 4 5 A 2 change to A 2 3 4 5 
        if(splitCard1[1] == 3 && splitCard2[1] == 4 && splitCard3[1] == 5 && splitCard4[1] == 1 && splitCard5[1] == 2){
                let aceCard = hand[3];
                let twoCard = hand[4];
                hand.splice(4, 1); //remove 2 from hand
                hand.splice(3, 1); //remove Ace from hand
                hand.unshift(aceCard, twoCard); //add ace card and two to start of hand
                console.log(hand);
        }
        //else if hand contains 3 4 5 6 2 change to 2 3 4 5 6
        else if(splitCard1[1] == 3 && splitCard2[1] == 4 && splitCard3[1] == 5 && splitCard4[1] == 6 && splitCard5[1] == 2){
            var twoCard = hand[4];
            hand.splice(4, 1); //remove 2 from hand
            hand.unshift(twoCard);
            console.log(hand);
        } 
        else {
            console.log("not a unique straight");
            return;
        }
    }

    //return true if played card || combo is valid, else return false
    cardLogic(gameDeck, hand, lastValidHand, playersFinished){ 
        let deck = new Deck();
        deck.sort(); //sort in big 2 ascending order
        var cardMap = deck.cardHash();
        var lastPlayedHand = []; //card array holds the hand that we will use to validate
        var lastPlayedHandIndex = gameDeck.length - lastValidHand;

        //loop from last hand played until end of gamedeck
        for(let i = lastPlayedHandIndex; i < gameDeck.length; i++){
            //if i less than 0 (happens after user wins a round, because gamedeck length is 0 and lastValidHand stores length of winning hand)
            if(i < 0){
                continue; //don't insert cards into last played hand and continue out of loop
            }
            //insert last played cards into array ['0 3', '1 3'] (as a string to use with comboValidate function)
            lastPlayedHand.push(gameDeck[i].suit + " " + gameDeck[i].rank); 
        }

        //switch case using hand length
        switch(hand.length) {
            //validate single card
            case 1:
                //if gamedeck is empty TO DO program it to detect after round has been won, pass in passTracker
                if(gameDeck.length == 0){ 
                    if(hand[0] == "0 3"){
                        return true;
                    }
                    //if player has won the previous hand, allow them to place any single card down 
                    else if(this.wonRound){ 
                        return true;
                    }
                    //else if opponent/s have won already and game deck is empty
                    else if(playersFinished.length > 0){
                        return true;
                    }
                    else {
                        return false;
                    }
                }

                //if gamedeck not empty and last played hand was also 1 card
                if(gameDeck.length > 0){
                    if(lastPlayedHand.length == 1){
                        //if single card is larger value than last played card, using deck hash to compare card values
                        if(cardMap.get(hand[0]) > cardMap.get(lastPlayedHand[0])) { 
                            return true;
                        } 
                        else{
                            return false;
                        }
                    }
                }
                break;
            //validate doubles
            case 2:
                var splitCard1 = hand[0].split(' '); //output: splitCard1[0] = suit | splitCard[1] = rank
                var splitCard2 = hand[1].split(' '); 
                if(gameDeck.length == 0){
                    //if gamedeck is empty and hand contains a 3 of diamonds and another 3 card, return valid as its a valid double
                    if(hand[0] == "0 3" && hand[1].includes("3")){
                        return true;
                    }
                    //else if player has won previous round and hand contains a valid double, return true 
                    else if(this.wonRound && splitCard1[1] == splitCard2[1]) { 
                        return true;
                    }
                    else if(playersFinished.length > 0 && splitCard1[1] == splitCard2[1]){
                        return true;
                    }
                    else 
                    {
                        return false;
                    }
                }

                if(gameDeck.length > 0){
                    if(lastPlayedHand.length == 2){
                        //(higher same value pair) if hand cards have same value AND first card in hand has same value as first last played card 
                        //AND second card in hand is greater than last played second card return true
                        //(higher value pair) OR if first hand and second card values have same value AND if first card in hand is greater than first card in last playedHand 
                        //AND second hand card is greater than 2nd card in last played hand return true
                        if(splitCard1[1] == splitCard2[1] && splitCard1[1] == lastPlayedHand[0].value  && cardMap.get(hand[1]) > cardMap.get(lastPlayedHand[1]) ||
                           splitCard1[1] == splitCard2[1] && cardMap.get(hand[1]) > cardMap.get(lastPlayedHand[1])){
                            return true;
                        } 
                        else {
                            return false;
                        }
                    }
                }
                break;
            //validate triples
            case 3:
                var splitCard1 = hand[0].split(' '); 
                var splitCard2 = hand[1].split(' ');
                var splitCard3 = hand[2].split(' ');

                if(gameDeck.length == 0){
                    //if gamedeck is empty and hand contains a 3 of diamonds and two other 3 cards, return valid as its a valid triple to start game with
                    if(hand[0] == "0 3" && hand[1].includes("3") && hand[2].includes("3")){
                        return true;
                    } 
                    //else if player has won previous round and hand contains a valid triple, return true
                    else if(this.wonRound && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1]) { 
                        return true;
                    }
                    else if(playersFinished.length > 0 && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1]){
                        return true;
                    }
                    else {
                        return false;
                    }
                }

                if(gameDeck.length > 0){
                    if(lastPlayedHand.length == 3){
                        //check if hand contains a triple and return true if triple is bigger than previous triple
                        if(splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1] && cardMap.get(hand[0]) > cardMap.get(lastPlayedHand[0]) 
                            && cardMap.get(hand[1]) > cardMap.get(lastPlayedHand[1]) && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])){
                            return true;
                        } else {
                        return false;
                        }
                    }
                }
                break;
            //validate quads? i dont know if these are allowed (leaning towards not allowed for the moment)
            case 4:
                return false;
            //validate straights, flushes, full houses, 4 of a kinds + kickers, straight flushes (in order of least to most valuable)
            case 5:
                //if hand contains a unique straight(3 4 5 A 2 || 3 4 5 6 2) change it to ascending order, else do nothing to hand
                this.detectUniqueStraights(hand);
                //return player's current combo
                var combo = this.validateCombo(hand);
                console.log("current combo: " + combo);

                //TODO clean this up
                if(gameDeck.length == 0){
                    //else if 3 of diamonds and hand contains a straight
                    if(combo == "straight3d"){
                        return true;
                    }
                    //else if player has won round and hand contains a straight
                    else if(combo == "straightWonRound"){
                        return true;
                    }
                    //else if player has won round
                    //(flush) else if every card in hand has the same suit as the first card in hand, return true
                    else if(combo == "flush3d"){ 
                        return true;
                    }
                    //else if player has won previous round and plays flush
                    else if(combo == "flushWonRound"){
                        return true;
                    } 
                    //full house, if you have triple 3 (including 3 of D) and 4th and 5th cards have the same value (triple and a double), return true
                    else if(combo == "fullHouse3d"){
                        return true;
                    }
                    //else if player has won previous round and plays fullhouse(in either 44 222 or 333 22 format) 
                    else if(combo == "fullHouseWonRound") { 
                        return true;
                    }
                    //(FoK + kicker) else if 3 of diamonds AND first 4 cards are the same, then last card does not matter
                    else if(combo == "fok3d"){ 
                        return true;
                    }
                    //else if prev round won and fok
                    else if(combo == "fokWonRound"){
                        return true;
                    }
                    //else if player hand contains straight flush starting from 3d
                    else if(combo == "straightFlush3d"){
                        return true;
                    }
                    //else if player won round and hand contains a straight flush
                    else if(combo == "straightFlushWonRound"){
                        return true;
                    }
                    else if(playersFinished.length > 0 && combo == "straight" || playersFinished.length > 0 && combo == "straightWonRound"
                    || playersFinished.length > 0 && combo == "flush" || playersFinished.length > 0 && combo == "flushWonRound"
                    || playersFinished.length > 0 && combo == "fullHouse" || playersFinished.length > 0 && combo == "fullHouseWonRound"
                    || playersFinished.length > 0 && combo == "fok" || playersFinished.length > 0 && combo == "fokWonRound"
                    || playersFinished.length > 0 && combo == "straightFlush" || playersFinished.length > 0 && combo == "straightFlushWonRound"){
                        return true;
                    }
                    else {
                        return false;
                    }
                }

                //return true if combo played meets conditions
                if(gameDeck.length > 0){
                    if(lastPlayedHand.length == 5){
                        var lastPlayedCombo = this.validateCombo(lastPlayedHand);
                        console.log("last played combo: " + lastPlayedCombo);
                        //console.log(" 3 4 5 6 2 combo: " + lastPlayedHand[3].slice(-1) + " " + lastPlayedHand[4].slice(-1))
        
                        //TO DO clean this whole section up (make all if statements a function)
                        //if last played combo is straight (all variants) and hand combo is higher straight(done) or flush(done), or full house(done), or fok(done), or straight flush(done)
                        if(lastPlayedCombo == "straight3d" && combo == "straight" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4]) 
                        || lastPlayedCombo == "straightWonRound" && combo == "straight" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])
                        || lastPlayedCombo == "straight" && combo == "straight" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4]) 
                        || lastPlayedCombo == "straight3d" && combo == "flush" || lastPlayedCombo == "straightWonRound" && combo == "flush" 
                        || lastPlayedCombo == "straight" && combo == "flush" || lastPlayedCombo == "straight3d" && combo == "fullHouse" 
                        || lastPlayedCombo == "straightWonRound" && combo == "fullHouse" || lastPlayedCombo == "straight" && combo == "fullHouse" 
                        || lastPlayedCombo == "straight3d" && combo == "fok" || lastPlayedCombo == "straightWonRound" && combo == "fok" 
                        || lastPlayedCombo == "straight" && combo == "fok" || lastPlayedCombo == "straight3d" && combo == "straightFlush" 
                        || lastPlayedCombo == "straightWonRound" && combo == "straightFlush" || lastPlayedCombo == "straight" && combo == "straightFlush"){
                            return true;
                        }
                        //if last played combo is flush and hand contains higher flush (flush with same suit and higher top card(done), flush with different suit and higher top card(done)), 
                        //or full house(done), or fok(done), or straight flush(done)
                        if(lastPlayedCombo == "flush3d" && combo == "flush" && hand[0].slice(0,1) == lastPlayedHand[0].slice(0,1) && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])
                        || lastPlayedCombo == "flush3d" && combo == "flush" && hand[0].slice(0,1) > lastPlayedHand[0].slice(0,1)
                        || lastPlayedCombo == "flush3d" && combo == "fullHouse" || lastPlayedCombo == "flushWonRound" && combo == "fullHouse"
                        || lastPlayedCombo == "flushWonRound" && combo == "flush" && hand[0].slice(0,1) == lastPlayedHand[0].slice(0,1) && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])
                        || lastPlayedCombo == "flushWonRound" && combo == "flush" && hand[0].slice(0,1) > lastPlayedHand[0].slice(0,1)
                        || lastPlayedCombo == "flushWonRound" && combo == "fok" || lastPlayedCombo == "flush" && combo == "fok" || lastPlayedCombo == "flush3d" && combo == "straightFlush" 
                        || lastPlayedCombo == "flushWonRound" && combo == "straightFlush" || lastPlayedCombo == "flush" && combo == "straightFlush"
                        || lastPlayedCombo == "flush" && combo == "flush" && hand[0].slice(0,1) > lastPlayedHand[0].slice(0,1)
                        || lastPlayedCombo == "flush" && combo == "flush" && hand[0].slice(0,1) == lastPlayedHand[0].slice(0,1) && cardMap.get(hand[4]) > cardMap.get(lastHandPlayed[4])
                        || lastPlayedCombo == "flush" && combo == "fullHouse" || lastPlayedCombo == "flush3d" && combo == "fok"){
                            return true;
                        }
                        //if last played hand is fullhouse and playedhand is higher fullhouse(done), or fok(done), or straight flush(done)
                        //comparing 3rd card in hand and last played hand because the one of triple cards will always be in the third position in array
                        if(lastPlayedCombo == "fullHouse3d" && combo == "fullHouse" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2]) 
                        || lastPlayedCombo == "fullHouseWonRound" && combo == "fullHouse" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2]) 
                        || lastPlayedCombo == "fullHouse" && combo == "fullHouse" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2]) 
                        || lastPlayedCombo == "fullHouse3d" && combo == "fok" || lastPlayedCombo == "fullHouseWonRound" && combo == "fok" || lastPlayedCombo == "fullHouse" && combo == "fok"
                        || lastPlayedCombo == "fullHouse3d" && combo == "straightFlush" || lastPlayedCombo == "fullHouseWonRound" && combo == "straightFlush" || lastPlayedCombo == "fullHouse" && combo == "straightFlush"){
                                return true;
                            }
                        //if last played hand is fok and hand contains higher fok (compare 3rd card in hand with 3rd last played hand)(done), or straight flush(done)
                        if(lastPlayedCombo == "fok3d" && combo == "fok" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])
                        || lastPlayedCombo == "fok3d" && combo == "fokWonRound" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])
                        || lastPlayedCombo == "fok" && combo == "fok" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])
                        || lastPlayedCombo == "fok3d" && combo == "straightFlush" || lastPlayedCombo == "fokWonRound" && combo == "straightFlush" 
                        || lastPlayedCombo == "fok" && combo == "straightFlush"){
                                return true;
                            }
                        //if last played hand is straight flush and played hand is higher straight flush(done)
                        if(lastPlayedCombo == "straightFlush3d" && combo == "straightFlush" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])
                        || lastPlayedCombo == "straightFlushWonRound" && combo == "straightFlush" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])
                        || lastPlayedCombo == "straightFlush" && combo == "straightFlush" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])){
                            return true;
                        }
                    }
                }
                break;
        }
    }

    //return card element through using cardId as a key
    findCardObject(cardId){
        for(let i = 0; i < this.numberOfCards; i++){
            let currentCard = this.cards[i];

            if(currentCard.suit + " " + currentCard.rank == cardId){
                return currentCard;
            }
        }
    }

    //function takes care of selecting cards and inserting cards into hand, sorting the hand, validating move and inserting the hand onto the game deck, and returning promise
    async playCard(gameDeck, lastValidHand, playersFinished, roomCode, socket){
        var playButton = document.getElementById("play"); //set player class to active if its their turn
        var passButton = document.getElementById("pass");
        var placeCardAudio = new Audio("audio/flipcard.mp3");
        var passAudio = new Audio("audio/pass.mp3");
        var self = this; //assign player to self
        var hand = []; //hand array holds selected cards
        var cardValidate;
        playButton.disabled = true; //disable play button because no card is selected which is an invalid move
        
        //disable pass button because you can't pass on first move or on a wonRound
        if(gameDeck.length == 0) {
            passButton.disabled = true; 
        } else {
            passButton.disabled = false;
        }

        //function when player clicks on card
        var cardClickListener = function(card) {
            console.log('Card clicked:', card.$el);

            //id the clicked card
            let cardId = card.suit + " " + card.rank;
            console.log(cardId);

            if(hand.includes(cardId)) { 
                //remove checked class
                hand = hand.filter(id => id !== cardId); //fremove card from hand if you click on it again
                card.animateTo({
                    delay: 0, // wait 1 second + i * 2 ms
                    duration: 100,
                    ease: 'linear',
                    rot: 0,
                    x: card.x,
                    y: card.y + 10,
                })
                console.log("unclicked");
                console.log("currrent hand: " + hand);
                console.log("currrent hand length: " + hand.length);
            } else if (!hand.includes(cardId) && hand.length < 5){ //else if card isnt in hand array && hand length is less than 5
                console.log("clicked");
                hand.push(cardId); //insert clicked on card into hand
                //add checked css class for styling
                card.animateTo({
                    delay: 0, // wait 1 second + i * 2 ms
                    duration: 100,
                    ease: 'linear',
                    rot: 0,
                    x: card.x,
                    y: card.y - 10,
                })
                console.log("currrent hand length: " + hand.length);
            }

            self.sortHandArray(hand);
            cardValidate = self.cardLogic(gameDeck, hand, lastValidHand, playersFinished); //return valid if played card meets requirements
            console.log("card validation: " + cardValidate);

            //if current hand is validated, enable play button, else disable it because its an invalid move
            if(cardValidate) {
                playButton.disabled = false;
            } else {
                playButton.disabled = true;
            }
        };

        //add event listeners on cards
        this.cards.forEach(function(card) {
            //add click listener for every card
            var clickListener = function() {
                cardClickListener(card);
            };

            // Add click listener for every card
            card.$el.addEventListener('click', clickListener);

            // Store the click listener reference on the card object
            card.clickListener = clickListener;
        });

        //resolve promise when player clicks on play button or pass button
        var myPromise = new Promise((resolve) => {
            let animationPromises = []; //holds all animation promises
            let cardsToRemove = []; //holds indexes of cards to be removed
            let i = 0; //for staggered placing down animations (remove if i dont like it)

            //if player has no cards left, automatically pass
            if(this.numberOfCards == 0){
                //remove all selected cards, play pass audio and resolve 0
                hand.length = 0
                passAudio.play();
                resolve(0); 
            }

            var playClickListener = function() {
                let rotationOffset = Math.random() * 7 + -7; // Calculate a new rotation offset for each card
                console.log("ROTATIONAL OFFSET: " + rotationOffset)

                hand.forEach(cardId => {
                    //return index of player's card that matches a cardId in hand array
                    let cardIndex = self.cards.findIndex(card => card.suit + " " + card.rank == cardId);
                    let card = self.findCardObject(cardId); //return card object using cardId to search
                    
                    //animate card object to gameDeck position (//can use turn to slightly stagger the cards like uno on ios)
                    let p1Promise = new Promise((cardResolve) => {
                        card.animateTo({
                            delay: 0, // wait 1 second + i * 2 ms
                            duration: 150,
                            ease: 'linear',
                            rot: 0  + rotationOffset,
                            x: 20 + (i * 15),
                            y: -10,
                            onComplete: function () {
                                if (cardIndex !== -1) {
                                    card.$el.style.zIndex = gameDeck.length; //make it equal gameDeck.length
                                    gameDeck.push(self.cards[cardIndex]); //insert player's card that matches cardId into game deck
                                    console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                                    cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank); //add card index into cardsToRemove array, so I can remove all cards at same time after animations are finished
                                    console.log("Cards to remove: " + cardsToRemove);
                                    placeCardAudio.play();
                                }
                                //card.mount(gameDeckDiv);
                                cardResolve(); //only resolve promise when animation is complete
                            }
                        })                                  
                    });
                    animationPromises.push(p1Promise); //add animation promise to promise array
                    i++;
                })
                // Wait for all card animations to complete
                Promise.all(animationPromises).then(() => {
                    cardsToRemove.forEach(cardToRemove => {
                        const indexToRemove = self.cards.findIndex(card => {
                            return card.suit + ' ' + card.rank === cardToRemove;
                        });
                
                        if (indexToRemove !== -1) {
                            console.log("removed card: " + self.cards[indexToRemove].suit + self.cards[indexToRemove].rank);
                            self.cards.splice(indexToRemove, 1);
                        }
                    });
                        
                    // emit hand played, and update server side cards, and gameDeck maybe?
                    socket.emit('playedHand', roomCode, hand, self, gameDeck, playersFinished);
                    hand.length = 0; //clear hand after playing it
                    resolve(); //return amount of cards played, to move forward for loop
                });

                //remove click listener on card, so they dont stack up
                self.cards.forEach(function(card) {
                    card.$el.removeEventListener('click', card.clickListener);
                });

                //remove playButton event listener to prevent propogation
                playButton.removeEventListener('click', playClickListener);
                
                //remove pass button listener, when player passes so event listeners dont propogate
                passButton.removeEventListener('click', passClickListener);
            }

            //call playClickListener function when playButton is clicked, the function will remove event listener after its called
            playButton.addEventListener("click", playClickListener, { once: true });
                
            //when player passes
            var passClickListener = function() {
                //remove click listeners on all cards 
                self.cards.forEach(function(card) {
                    card.$el.removeEventListener('click', card.clickListener);
                });

                //animate cards in selected hand back to original position
                hand.forEach(function (cardId) {
                    let card = self.findCardObject(cardId); 
                    card.animateTo({
                        delay: 0, // wait 1 second + i * 2 ms
                        duration: 100,
                        ease: 'linear',
                        rot: 0,
                        x: card.x,
                        y: card.y + 10,
                    })  
                });

                //remove passButton event listener after pass button functions are completed
                passButton.removeEventListener('click', passClickListener);

                //remove play button listener, when player passes so event listeners dont propogate
                playButton.removeEventListener('click', playClickListener); 


                //remove all selected cards, play pass audio and resolve 0
                hand.length = 0

                // emit that player passed (hand.length = 0)
                socket.emit('playedHand', roomCode, hand, self, gameDeck, playersFinished);

                passAudio.play(); 
                resolve(0); 
            }

            //call passClickListener function when passButton is clicked, the function will remove event listener after its called
            passButton.addEventListener("click", passClickListener, { once: true });
        });

        return myPromise;
    }
}

