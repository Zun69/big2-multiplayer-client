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

const passSound = new Howl({ src: ["src/audio/passcard.wav"], volume: 0.9 });

let lastSoundIndex = -1;

function playRandomCardSound() {
    let idx;
    do {
        idx = (Math.random() * playCardSounds.length) | 0;
    } while (playCardSounds.length > 1 && idx === lastSoundIndex);
    lastSoundIndex = idx;
    console.log("playCard sound")
    console.log(idx);
    playCardSounds[idx].play();
}

const INITIAL_HAND_SIZE = 13;
const INITIAL_HALF = (INITIAL_HAND_SIZE - 1) / 2;

export default class Player{ 
    constructor(username, cards = []){ // Player object, which will contain name, cards, wonRound & finishedGame & pass status, point tally 
        this.username = username;
        this.cards = cards;
        this.wonRound = false;
        this.finishedGame = false;
        this.passed = false;
        this.clientId = null; // Set to null initially, will set later in the lobbyMenu
        this.socketId = null; //unique socketId from server
        this.pbId = null; // PocketBase user id, set during lobby or snapshot
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

    // Sort this player's cards in-place by Deck.cardHash() order
    sortHand() {
        const deck = new Deck();
        deck.sort();
        const cardMap = deck.cardHash();

        const keyOf = (c) => `${c.suit} ${c.rank}`;

        // Stable in modern engines → preserves relative order of equals (like bubble sort)
        this.cards.sort((a, b) => {
            const va = cardMap.get(keyOf(a));
            const vb = cardMap.get(keyOf(b));
            return va - vb; // ascending
        });
    }

    // Sort an array of selected hand keys in-place (keys are already "suit rank" strings)
    sortHandArray(hand) {
        const deck = new Deck();
        deck.sort();
        const cardMap = deck.cardHash();

        hand.sort((ka, kb) => {
            const va = cardMap.get(ka);
            const vb = cardMap.get(kb);
            return va - vb; // ascending
        });

        console.log("currrent hand: " + hand);
    }

    // ---- GC-relative sorting anchors (percent-of-container) ----
    // axis: which axis the hand fans along; dir: +/- spread direction; rot: card face orientation
    SORT_ANCHORS = [
        { leftPct: 0.50, topPct: 0.85, axis: 'x', dir: +1, rot: 0,   sideways: false }, // seat 0 (you, bottom)
        { leftPct: 0.06, topPct: 0.50, axis: 'y', dir: +1, rot: 270, sideways: true  }, // seat 1 (left)
        { leftPct: 0.50, topPct: 0.1, axis: 'x', dir: -1, rot: 0,   sideways: false }, // seat 2 (top)
        { leftPct: 0.952, topPct: 0.50, axis: 'y', dir: -1, rot: 270, sideways: true  }, // seat 3 (right)
    ];

    // convert a GC-space (x,y) into the local space of `parentEl`
    gcToLocal(xGC, yGC, parentEl) {
        const gc = document.getElementById('gameContainer');
        const gcRect = gc.getBoundingClientRect();
        const pRect  = parentEl.getBoundingClientRect();
        return {
            x: Math.round(xGC - (pRect.left - gcRect.left)),
            y: Math.round(yGC - (pRect.top  - gcRect.top)),
        };
    }

    // resolve an anchor (in GC pixels) for a seat
    getSeatAnchorGC(seatIndex) {
        const gc = document.getElementById('gameContainer');
        const r  = gc.getBoundingClientRect();
        const a  = this.SORT_ANCHORS[seatIndex] || this.SORT_ANCHORS[0];
        return {
            ax: a.leftPct * r.width,
            ay: a.topPct  * r.height,
            cfg: a
        };
    }

    sortingAnimation(playerNum, { rotateAfterTurn = false, duration = 200, stagger = 0 } = {}) {
        const promises = [];
        const STEP = 40; // fan spacing (px) – tweak to taste

        const N   = Math.max(1, this.cards.length);
        const mid = (N - 1) / 2;

        const { ax, ay, cfg } = this.getSeatAnchorGC(playerNum);
        const rotTarget = rotateAfterTurn ? 0 : cfg.rot;

        this.cards.forEach((card, i) => {
            promises.push(new Promise(resolve => {
            try {
                // compute GC-space target for this index
                const spread = (i - mid) * STEP * cfg.dir;
                const xGC = cfg.axis === 'x' ? (ax + spread) : ax;
                const yGC = cfg.axis === 'y' ? (ay + spread) : ay;

                // convert to the card's current parent's local space before animating
                const parentEl = card.$el.parentElement || document.getElementById('gameDeck');
                const { x, y } = this.gcToLocal(xGC, yGC, parentEl);

                // zIndex: near edge on top for left/up fans
                const invert = (cfg.dir < 0);
                const rank   = invert ? (N - 1 - i) : i;
                const z      = (cfg.zBase || 0) + rank * 4;

                let finished = false;
                const finish = () => {
                if (finished) return;
                finished = true;
                card.$el.style.zIndex = z;
                resolve();
                };

                card.animateTo({
                delay: (stagger ? i * stagger : 0),
                duration,
                ease: 'linear',
                rot: rotTarget,
                rotateSideways: !!cfg.sideways,
                x, y,
                onComplete: finish
                });

                setTimeout(finish, duration + 100); // safety
            } catch (e) {
                console.warn('[sortingAnimation] error animating card', e);
                resolve();
            }
            }));
        });

        return Promise.all(promises);
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

        // Build a quick rank histogram for the 5 cards
        const ranks = [splitCard1[1], splitCard2[1], splitCard3[1], splitCard4[1], splitCard5[1]];
        const rankCounts = ranks.reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m; }, {});
        const isFourKind = Object.values(rankCounts).includes(4);

        // 3♦ detection (adjust if your card id format differs)
        const has3d = hand.includes("0 3");

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
        // four of a kind + 3♦ kicker (first-turn unlock)
        if (has3d && isFourKind) {
            return "fok3d";
        }

        // won previous round + four of a kind
        if (this.wonRound && isFourKind) {
            return "fokWonRound";
        }

        // generic four of a kind
        if (isFourKind) {
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
    cardLogic(gameDeck, hand, serverLastValidHand, playersFinished, isFirstMove){ 
        let deck = new Deck();
        deck.sort(); //sort in big 2 ascending order
        var cardMap = deck.cardHash();

        console.log("gameDeck length: " + gameDeck.length);
        console.log("serverLastValidHand: " + serverLastValidHand);

        // Normalize to the string format your validator expects ("suit rank")
        const lastPlayedHand = (serverLastValidHand || []).map(c => `${c.suit} ${c.rank}`);

        //switch case using hand length
        switch(hand.length) {
            //validate single card
            case 1:
                //if gamedeck is empty TO DO program it to detect after round has been won, pass in passTracker
                if(gameDeck.length == 0){ 
                    if(hand[0] == "0 3" && isFirstMove){
                        console.log('first round 3 of diamonds validation true')
                        console.log(isFirstMove);
                        return true;
                    }
                    //if player has won the previous hand, allow them to place any single card down 
                    else if(this.wonRound){ 
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
                    if(hand[0] == "0 3" && splitCard2[1] == 3 && isFirstMove){
                        return true;
                    }
                    //else if player has won previous round and hand contains a valid double, return true 
                    else if(this.wonRound && splitCard1[1] == splitCard2[1]) { 
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
                    if(hand[0] == "0 3" && splitCard2[1] == 3 && splitCard3[1] == 3 && isFirstMove){
                        return true;
                    } 
                    //else if player has won previous round and hand contains a valid triple, return true
                    else if(this.wonRound && splitCard1[1] == splitCard2[1] && splitCard2[1] == splitCard3[1] && splitCard1[1] == splitCard3[1]) { 
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

                        // add:
                        const normalize = (s) => (s || '').replace('WonRound','');
                        // if you also want to collapse “3d” lead variants when comparing types:
                        const normalize5 = (s) => normalize(s).replace('3d','');
                        console.log("last played combo: " + lastPlayedCombo);

                        // then use these for all your 5-card type comparisons:
                        const L = normalize5(lastPlayedCombo);
                        const C = normalize5(combo);
        
                        //TO DO clean this whole section up (make all if statements a function)
                        //if last played combo is straight (all variants) and hand combo is higher straight(done) or flush(done), or full house(done), or fok(done), or straight flush(done)
                        if(L === "straight" && C === "straight" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4]) 
                            || L === "straight" && (C == "straightFlush" || C === "flush" || C === "fullHouse" || C === "fok")
                        ){
                            return true;
                        }
                        // if both combos are flushes, compare by suit and if its the same suit use ranks
                        if (L === "flush" && C === "flush") {
                            const [s1] = hand[4].split(" ");
                            const [s2] = lastPlayedHand[4].split(" ");

                            // compare suit
                            if (+s1 > +s2) return true;
                            if (+s1 < +s2) return false;

                            // same suit → compare highest rank using cardMap
                            if (cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])) return true;

                            return false;
                        }
                        // if fh, fok, straightFlush selected on a flush return true
                        if (L === "flush" && (C === "fullHouse" || C === "fok" || C === "straightFlush")) {
                            return true;
                        }
                        //if last played hand is fullhouse and playedhand is higher fullhouse(done), or fok(done), or straight flush(done)
                        //comparing 3rd card in hand and last played hand because the one of triple cards will always be in the third position in array
                        if(L == "fullHouse" && C == "fullHouse" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])
                        || L == "fullHouse" && C == "fok"
                        || L == "fullHouse" && C == "straightFlush"){
                                return true;
                            }
                        //if last played hand is fok and hand contains higher fok (compare 3rd card in hand with 3rd last played hand)(done), or straight flush(done)
                        if(L == "fok" && C == "fok" && cardMap.get(hand[2]) > cardMap.get(lastPlayedHand[2])
                        || L == "fok" && C == "straightFlush"){
                                return true;
                            }
                        //if last played hand is straight flush and played hand is higher straight flush(done)
                        if(L == "straightFlush" && C == "straightFlush" && cardMap.get(hand[4]) > cardMap.get(lastPlayedHand[4])){
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

    waitForTurnOutcome(socket) {
        return new Promise((resolve, reject) => {
            const onPlayed  = (payload) => { cleanup(); resolve({ type: 'played',    payload }); };
            const onPassed  = (payload) => { cleanup(); resolve({ type: 'passed',    payload }); };
            const onWon     = (payload) => { cleanup(); resolve({ type: 'wonRound',  payload }); };
            const onReject  = (payload) => { cleanup(); reject(Object.assign(new Error(payload?.reason || 'playRejected'), { payload })); };

            function cleanup() {
            socket.off('cardsPlayed', onPlayed);
            socket.off('passedTurn', onPassed);
            socket.off('wonRound', onWon);
            socket.off('playRejected', onReject);
            }

            socket.once('cardsPlayed',   onPlayed);
            socket.once('passedTurn',    onPassed);
            socket.once('wonRound',      onWon);
            socket.once('playRejected',  onReject);
        });
    }

    // get center of gameContainer
    getGameCenterXY() {
        const gc = document.getElementById('gameContainer');
        const r = gc.getBoundingClientRect();
        // card.x / card.y are already in this space, so origin is gc’s top-left:
        return { gx: r.width / 2, gy: r.height / 2 };
    }

    // get center of card/s being played to correctly animate it to center of gameContainer
    getCardCenterInGC(cardEl) {
        const gc = document.getElementById('gameContainer');
        const gcR = gc.getBoundingClientRect();
        const cr  = cardEl.getBoundingClientRect();
        return {
            cx: (cr.left - gcR.left) + cr.width  / 2,
            cy: (cr.top  - gcR.top ) + cr.height / 2,
        };
    }

    //function takes care of selecting cards and inserting cards into hand, sorting the hand, validating move and inserting the hand onto the game deck, and returning promise
    async playCard(gameDeck, serverLastValidHand, playersFinished, roomCode, socket, isFirstMove){
        var playButton = document.getElementById("play"); //set player class to active if its their turn
        var passButton = document.getElementById("pass");
        var clearButton = document.getElementById("clear");
        var self = this; //assign player to self
        var hand = []; //hand array holds selected cards
        var cardValidate;
        playButton.disabled = true; //disable play button because no card is selected which is an invalid move
        clearButton.disabled = true;

        //disable pass button because you can't pass on first move or on a wonRound
        if(gameDeck.length == 0) {
            passButton.disabled = true; 
        } else {
            passButton.disabled = false;
        }

        // clean up any old handlers before arming again ---
        if (this._playHandler) playButton.removeEventListener("click", this._playHandler);
        if (this._passHandler) passButton.removeEventListener("click", this._passHandler);
        if (this._clearHandler) passButton.removeEventListener("click", this._clearHandler);
        this._playHandler = null;
        this._passHandler = null;
        this._clearHandler = null;

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
            cardValidate = self.cardLogic(gameDeck, hand, serverLastValidHand, playersFinished, isFirstMove); //return valid if played card meets requirements
            console.log("card validation: " + cardValidate);

            //if current hand is validated, enable play button, else disable it because its an invalid move
            if(cardValidate) {
                playButton.disabled = false;
            } else {
                playButton.disabled = true;
            }

            if(hand.length > 0) {
                clearButton.disabled = false;
            } else {
                clearButton.disabled = true;
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

            var playClickListener = async function() {
                // clean up immediately
                playButton.removeEventListener("click", self._playHandler);
                passButton.removeEventListener("click", self._passHandler);
                clearButton.removeEventListener("click", self._clearHandler);
                self._playHandler = self._passHandler = self._clearHandler = null;

                // convert hand containing cardId's to format that server can read to validate the hand
                const serverValidateCards = hand.map(id => {
                    const [suitStr, rankStr] = id.split(" ");
                    return { suit: Number(suitStr), rank: Number(rankStr) };
                });

                // positions relative to current on-screen order
                const selectedCardPositions = hand.map(id =>
                    self.cards.findIndex(c => (c.suit + " " + c.rank) === id)
                );

                // tell server "I want to play these"
                socket.emit("playCards", {
                    type: "play",
                    roomCode,
                    cards: serverValidateCards,    // [{suit, rank}, ...]
                    positions: selectedCardPositions   // [0, 2, 7, 8, 9] for example
                });

                // then wait for verdict
                const outcome = await self.waitForTurnOutcome(socket);

                console.log("Outcome Played Cards");
                console.log(outcome);

                

                if(outcome.payload.verdict === "validated"){
                    // get middle card index to center pairs, triples, and combos correctly
                    const { gx, gy } = self.getGameCenterXY();
                    const n = hand.length;
                    const mid = (n - 1) / 2;

                    hand.forEach(cardId => {
                        //return index of player's card that matches a cardId in hand array
                        let cardIndex = self.cards.findIndex(card => card.suit + " " + card.rank == cardId);
                        let card = self.findCardObject(cardId); //return card object using cardId to search
                        let stackInterval = 0.25;

                        let rotationOffset = Math.random() * 5 + -5; // Calculate a new rotation offset for each card
                        console.log("ROTATIONAL OFFSET: " + rotationOffset)

                        // simple, global target for everyone
                        // set x coord as center of middle card
                        const offX = ((i - mid) * 15) - (gameDeck.length * stackInterval);
                        const offY = (gameDeck.length * stackInterval);

                        const { cx, cy } = self.getCardCenterInGC(card.$el);

                        // delta needed to land the card’s center on the anchor:
                        const dx = (gx - cx);
                        const dy = (gy - cy);

                        //animate card object to gameDeck position (//can use turn to slightly stagger the cards like uno on ios)
                        let p1Promise = new Promise((cardResolve) => {
                            card.animateTo({
                                delay: i * 30, // wait 1 second + i * 2 ms
                                duration: 150,
                                ease: 'linear',
                                rot: rotationOffset,
                                x: Math.round(card.x + dx + offX),
                                y: Math.round(card.y + dy - offY),
                                onStart: function() {
                                    gameDeck.push(self.cards[cardIndex]); //insert player's card that matches cardId into game deck
                                    card.$el.style.zIndex = gameDeck.length; //make it equal gameDeck.length
                                    playRandomCardSound();
                                },
                                
                                onComplete: function () {
                                    if (cardIndex !== -1) {
                                        
                                        console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                                        cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank); //add card index into cardsToRemove array, so I can remove all cards at same time after animations are finished
                                        console.log("Cards to remove: " + cardsToRemove);
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

                        hand.length = 0; //clear hand after playing it
                        resolve(outcome); 
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
                else {
                    /*cheating attempt detected, emit (cheaterDetected) and then disconnect client from room
                    const reason = outcome?.payload?.reason || "Unknown reason";
                    console.warn("[PLAY REJECTED]", reason, serverValidateCards);

                    // show a visible error to the user
                    if (typeof self.showErrorBanner === "function") {
                        self.showErrorBanner(`Play rejected: ${reason}`);
                    } else {
                        // simple fallback UI
                        alert(`Play rejected: ${reason}`);
                    }

                    // Always notify server for telemetry (room + who + attempted cards)
                    socket.emit("cheaterDetected", {
                        roomCode,
                        reason,
                        attemptedCards: serverValidateCards, // what the client tried to submit
                        clientId: self.clientId,             // if you have it on the client
                    });*/
                    console.log("Cheater detected")
                }
            }
                
            //when player passes
            var passClickListener = async function() {
                // clean up immediately
                playButton.removeEventListener("click", self._playHandler);
                passButton.removeEventListener("click", self._passHandler);
                clearButton.removeEventListener("click", self._clearHandler);
                self._playHandler = self._passHandler = self._clearHandler = null;
                
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

                // Let server know that player passed
                socket.emit('passTurn', roomCode);

                // then wait for payload that contains server gamestate
                const outcome = await self.waitForTurnOutcome(socket);

                console.log("Outcome Played Cards");
                console.log(outcome);

                passSound.play(); 
                resolve(outcome); 
            }

            var clearClickListener = async function() {
                clearButton.disabled = true; // lock immediately
                playButton.disabled = true; // disable play button as it stays active if cleared hand was valid

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

                //remove all selected cards, play pass audio and resolve 0
                hand.length = 0
                
                // dont remove listener here, remove clear listener if player plays cards or passes
            }

            // --- store refs so we can clean up next turn ---
            this._playHandler = playClickListener;
            this._passHandler = passClickListener;
            this._clearHandler = clearClickListener;

            //call playClickListener function when playButton is clicked, the function will remove event listener after its called
            playButton.addEventListener("click", this._playHandler, { once: true });
            //call passClickListener function when passButton is clicked, the function will remove event listener after its called
            passButton.addEventListener("click", this._passHandler, { once: true });
            clearButton.addEventListener("click", this._clearHandler);
        });

        return myPromise;
    }
}

