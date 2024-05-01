import Player from "./player.js"

//lookup table to identify a straight
//keys are card ranks 
const cardRankLookupTable = {
  "3": 1,
  "4": 2,
  "5": 3,
  "6": 4,
  "7": 5,
  "8": 6,
  "9": 7,
  "10": 8, 
  "11": 9, //jack
  "12": 10, //queen
  "13": 11, //king
  "1": 12, //ace
  "2": 13 //two
};

export default class Opponent extends Player {
    constructor(cards = []) {
      super(cards);
      this.isOpponent = true;
    }

    findTwos() {
      const twos = [];
  
      for (let i = 0; i < this.numberOfCards; i++) {
        const currentCard = this.cards[i];
  
        if (currentCard.rank == '2') {
          twos.push(currentCard);
        }
      }
  
      return twos;
    }

    findDoubles() {
      var doubles = [];
    
      for (let i = 0; i < this.numberOfCards - 1; i++) {
        var currentCard = this.cards[i];
        var nextCard = this.cards[i + 1];
        
        if (currentCard.rank === nextCard.rank) {
          // check if cards have the same rank but different suits
          if (currentCard.suit !== nextCard.suit) {
            doubles.push([currentCard.suit + " " + currentCard.rank, nextCard.suit + " " + nextCard.rank]);
            i++; // skip the next card since it has already been considered as a double
          }
        }
      }
      
      console.log(doubles)
      return doubles;
    }

    findTriples() {
      var triples = [];
    
      for (let i = 0; i < this.numberOfCards - 2; i++) {
        var currentCard = this.cards[i];
        var nextCard = this.cards[i + 1];
        var thirdCard = this.cards[i + 2];
    
        if (currentCard.rank === nextCard.rank &&
          nextCard.rank === thirdCard.rank
        ) {
          // check if cards have the same rank but different suits
          if (currentCard.suit !== nextCard.suit &&
            nextCard.suit !== thirdCard.suit
          ) {
            triples.push([currentCard.suit + " " + currentCard.rank, nextCard.suit + " " + nextCard.rank, thirdCard.suit + " " + thirdCard.rank]);
          }
        }
      }

      return triples;
    }

    findFlushes() {
      var flushes = [];

      for(let i = 0; i < this.numberOfCards; i++){
        var potentialFlush = [this.cards[i].suit + " " +this.cards[i].rank];
        var currentSuit = this.cards[i].suit;

        //if next card has the same suit as first card in potential flush
        for(let j = i + 1; j < this.numberOfCards; j++) {
          if(this.cards[j].suit == currentSuit) {
            potentialFlush.push(this.cards[j].suit + " " + this.cards[j].rank);
          }
        }

        if (potentialFlush.length == 5) {
          //push array of 5 cards into flushes array
          flushes.push(potentialFlush);
        }
      }

      console.log("FLUSHES");
      console.log(flushes);
      return flushes;
    }

    //find all straights (except A 2 3 4 5 and 2 3 4 5 6)
    findStraights() {
      var straights = [];
    
      for (let i = 0; i < this.numberOfCards; i++) {
        var potentialStraight = [this.cards[i].suit + " " + this.cards[i].rank];
        var currentValue = cardRankLookupTable[this.cards[i].rank]; //e.g 'K' = 11
    
        //compare adjacent card ranks
        for (let j = i + 1; j < this.numberOfCards; j++) {
          // Dont take into account special case: check for straight with ranks 3, 4, 5, 6, and 2
          
          //if next card rank minus current card rank = 1, then add card to potential straight array
          if (cardRankLookupTable[this.cards[j].rank] - currentValue === 1) {
            potentialStraight.push(this.cards[j].suit + " " + this.cards[j].rank);
            currentValue = cardRankLookupTable[this.cards[j].rank];
          }
          else if (cardRankLookupTable[this.cards[j].rank] !== currentValue) {
            // Break the straight if the current card rank is not consecutive
            break;
          }
        }
        
        if (potentialStraight.length === 5) {
          // Push array of 5 cards into straights array
          straights.push(potentialStraight);
        }
      }
    
      console.log("STRAIGHTS");
      console.log(straights);
      return straights;
    }

    findFullHouses() {
      const fullHouses = [];
  
      // Find triples
      const triples = this.findTriples();
  
      // Find doubles
      const doubles = this.findDoubles();
  
      // Iterate through triples and doubles to find potential full houses
      for (const triple of triples) {
          for (const double of doubles) {
              // Check if the ranks of the triple and double are different
              if (triple[0].split(' ')[1] !== double[0].split(' ')[1]) {
                  // Create a potentialFullHouse array to store the combination
                  const potentialFullHouse = [...triple, ...double];
                  // Add the potentialFullHouse to the fullHouses array
                  fullHouses.push(potentialFullHouse);
              }
          }
      }
  
      console.log("POTENTIAL FULL HOUSES")
      console.log(fullHouses);
      return fullHouses;
   }

    findFoks(spareCards) {
      const foks = [];
    
      for (let i = 0; i < this.numberOfCards; i++) {
        var potentialFok = [this.cards[i].suit + " " + this.cards[i].rank];
        var currentRank = this.cards[i].rank;
    
        // Check for three more cards with the same rank
        let count = 1; // Count includes the current card
        for (let j = i + 1; j < this.numberOfCards; j++) {
          if (this.cards[j].rank == currentRank) {
            potentialFok.push(this.cards[j].suit + " " + this.cards[j].rank);
            count++;
          }
    
          if (count === 4) {
            // Found four cards with the same rank, add a copy of the lowest spare card, add them to foks array
            potentialFok.push(spareCards[0]); // Creating a copy of the spare card
            foks.push([...potentialFok]);
            break;
          }
        }
      }
    
      console.log("FOKS");
      console.log(foks);
      return foks;
    }
    
    findStraightFlush() {
      var straightFlushes = [];
    
      for (let i = 0; i < this.numberOfCards; i++) {
        var potentialStraightFlush = [this.cards[i].suit + " " + this.cards[i].rank];
        var currentSuit = this.cards[i].suit;
        var currentValue = cardRankLookupTable[this.cards[i].rank];
    
        // Check for four more consecutive cards with the same suit
        let count = 1; // Count includes the current card
        for (let j = i + 1; j < this.numberOfCards; j++) {
          if (this.cards[j].suit === currentSuit && cardRankLookupTable[this.cards[j].rank] - currentValue === 1) {
            potentialStraightFlush.push(this.cards[j].suit + " " + this.cards[j].rank);
            currentValue = cardRankLookupTable[this.cards[j].rank];
            count++;
          }
    
          if (count === 5) {
            // Found five consecutive cards with the same suit, add them to straightFlushes array
            straightFlushes.push(potentialStraightFlush);
            break;
          }
        }
      }
    
      return straightFlushes;
    }

    findSpareCards(doubles, triples, straights, flushes) {
      const spareCards = [];
    
      for (let i = 0; i < this.cards.length; i++) {
        const cardToCheck = this.cards[i];
    
        // Helper function to check if a card is part of any combo
        const isPartOfCombo = (combo) => combo.some(c => c === cardToCheck.suit + " " + cardToCheck.rank);
    
        if (
          !doubles.some(isPartOfCombo) &&
          !triples.some(isPartOfCombo) &&
          !straights.some(isPartOfCombo) &&
          !flushes.some(isPartOfCombo)
        ) {
          spareCards.push(cardToCheck.suit + " " + cardToCheck.rank);
        }
      }
    
      console.log("SPARE CARDS")
      console.log(spareCards);
      return spareCards;
    }
    
    isSpareCard(card, cardMap, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes) {
      const cardRepresentation = card.suit + " " + card.rank;
    
      // Helper function to check if a card is part of any combo
      const isPartOfCombo = (combo) => combo.some(c => c === cardRepresentation);
    
      return (
        cardMap.get(cardRepresentation) > cardMap.get(lastPlayedHand[0]) &&
        !doubles.some(isPartOfCombo) &&
        !triples.some(isPartOfCombo) &&
        !straights.some(isPartOfCombo) &&
        !flushes.some(isPartOfCombo) &&
        !foks.some(isPartOfCombo) &&
        !straightFlushes.some(isPartOfCombo)
      );
    }

    isSpareDouble(double, triples, straights, flushes, foks, straightFlushes) {
      // Helper function to check if any card in double is part of any combo
      const isPartOfCombo = (combo) => double.some(card => combo.flat().includes(card));
    
      return (
        !triples.some(isPartOfCombo) &&
        !straights.some(isPartOfCombo) &&
        !flushes.some(isPartOfCombo) &&
        !foks.some(isPartOfCombo) &&
        !straightFlushes.some(isPartOfCombo)
      );
    }

    isSpareTriple(triple, doubles, straights, flushes, foks, straightFlushes) {
      // Helper function to check if any card in triple is part of any combo
      const isPartOfCombo = (combo) => triple.some(card => combo.flat().includes(card));
    
      return (
        !doubles.some(isPartOfCombo) &&
        !straights.some(isPartOfCombo) &&
        !flushes.some(isPartOfCombo) &&
        !foks.some(isPartOfCombo) &&
        !straightFlushes.some(isPartOfCombo)
      );
    }

    //check if card is contained in array (combo)
    findSubarrayBySuitAndRank(arr, targetSuit, targetRank) {
      for (let i = 0; i < arr.length; i++) {
        const subarray = arr[i];
        for (let j = 0; j < subarray.length; j++) {
          const card = subarray[j];
          
          if (parseInt(card.charAt(0)) === targetSuit && parseInt(card.charAt(2)) === targetRank) {
            console.log('Found subarray:', subarray); // Log the subarray
            return subarray; // Found the card, return the subarray
          }
        }
      }
      return null; // Card not found
    }

    //compare first element of combo arrays to find individual combo/s
    findIndividualCombos(straights, flushes, fullHouses, foks, straightFlushes) {
      const allCombos = [].concat(straights, flushes, fullHouses, foks, straightFlushes);
      const individualCombos = [];
    
      for (let i = 0; i < allCombos.length; i++) {
        let isIndividual = true;
    
        for (let j = 0; j < allCombos.length; j++) {
          if (i !== j && allCombos[i][0] === allCombos[j][0]) {
            // If the first element is the same in another combo, it's not individual
            isIndividual = false;
            break;
          }
        }
    
        if (isIndividual) {
          individualCombos.push(allCombos[i]);
        }
      }
      
      console.log("Individual Combos");
      console.log(individualCombos);
      return individualCombos;
    }
    
    // Helper function to check if two arrays have an intersection
    hasIntersection(arr1, arr2) {
      return arr1.some(element => arr2.includes(element));
    }

    //select correct hand on free turn
    freeHandSelector(hand, doubles, triples, spareCards, straights, flushes, fullHouses, foks, straightFlushes, gameDeck){
      const individualCombos = this.findIndividualCombos(straights, flushes, fullHouses, foks, straightFlushes);
      //
      if(this.numberOfCards == 0){
        hand.length = 0;
        return hand;
      }

      //if player has 3 of diamonds
      if(gameDeck.length == 0 && this.wonRound == false){
        //search for 3 of diamond combos, doubles, and triples
        let straightFlushes3d = this.findSubarrayBySuitAndRank(straightFlushes, 0, 3);
        let fok3d = this.findSubarrayBySuitAndRank(foks, 0, 3);
        let straight3d = this.findSubarrayBySuitAndRank(straights, 0, 3);
        let flush3d = this.findSubarrayBySuitAndRank(flushes, 0, 3);
        //fullhouse is glitchede for some reason
        let fh3d = this.findSubarrayBySuitAndRank(fullHouses, 0, 3);
        let double3d = this.findSubarrayBySuitAndRank(doubles, 0, 3);
        let triple3d = this.findSubarrayBySuitAndRank(triples, 0, 3);
        
        //play 3 of diamond combos, or triple and double if combo doesnt exist
        if(straightFlushes3d){
          return straightFlushes3d;
        }
        else if(fok3d){
          return fok3d;
        }
        else if(straight3d){
          return straight3d;
        }
        else if(flush3d){
          return flush3d;
        }
        else if(fh3d){
          return fh3d;
        }
        else if(triple3d) {
          return triple3d;
        }
        else if(double3d) {
          return double3d;
        }
        else{
          console.log("starting round, play 3 of diamonds");
          hand.push(this.cards[0].suit + " " + this.cards[0].rank);
          return hand;
        }
      }
      //if opponent has won round, check if i have combos that dont intersect, play lower one, else just play a combo, triple, double, and finally single
      else if(gameDeck.length == 0 && this.wonRound == true){
        console.log("opponent won round")
        if(this.numberOfCards == 0){
          hand.length = 0;
          return hand;
        }
        if(individualCombos.length > 0){
          return individualCombos[0];
        }
        else if(straights.length > 0){
          return straights[0];
        }
        else if(flushes.length > 0){
          return flushes[0];
        }
        else if(fullHouses.length > 0){
          return fullHouses[0];
        }
        else if(foks.length > 0){
          return foks[0];
        }
        else if(straightFlushes.length > 0){
          return straightFlushes[0];
        }
        else if(triples.length > 0){
          return triples[0];
        }
        else if(spareCards.length > 0){
          //if spare card is J or higher dont play it, play a low double (if it exists) instead
          if(cardRankLookupTable[spareCards[0].split(' ')[1]] >= 9){
            console.log("BUG HERE")
            //if double exists and is 10 or below, play it
            if(doubles.length > 0 && cardRankLookupTable[doubles[0][1].split(' ')[1]] <= 8){
              console.log("low doubles found: " + doubles[0][1].split(' ')[1])
              return doubles[0];
            }
            else{
              hand.push(spareCards[0]);
              return hand;
            }
          }
          //else if spare card is below jack, play the spare card 
          else if(spareCards.length > 0){
            if(doubles.length > 0 && cardRankLookupTable[doubles[0][1].split(' ')[1]] <= 4){
              console.log("low doubles found: " + doubles[0][1].split(' ')[1])
              return doubles[0];
            }
            else{
              hand.push(spareCards[0]);
              return hand;
            }
          }
        }
        //else if no spare cards, play doubles
        else if(doubles.length > 0){
          return doubles[0];
        }
      }
    }

    singleSelector(hand, lastPlayedHand, doubles, triples, spareCards, straights, flushes, fullHouses, foks, straightFlushes, cardMap, twos){
      //if player has finished game, pass turn
      if(this.numberOfCards == 0){
        hand.length = 0;
        return hand;
      }

      for(let i = 0; i < this.numberOfCards; i++){
        //TO DO: if cardToCheck is a 2, and player has a low combo they need to get rid of (e.g 3-7 straight, flush), play the 2
        var cardToCheck = this.cards[i];
        
        switch(twos.length){
          case 0:
            console.log("0 two");
            //find first card thats higher than last played card AND is not part of any doubles, triples, straights, flushes, straight flush and put it in hand and return it
            if (this.isSpareCard(cardToCheck, cardMap, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes)){
              hand.push(this.cards[i].suit + " " + this.cards[i].rank);
              return hand;
            }
            //else if card is higher rank than last played card and card is a 2 of diamonds or clubs and player has a straight or flush
            //else if i cant find card thats higher than previously played card (TO DO: add a check to check if card is part of combo), pass
            else if(i == this.numberOfCards - 1){
              console.log("pass");
              hand.length = 0;
              return hand;
            }
            break;
            case 1:
              console.log("1 two " + twos.length);
              //if player has a 2 card and has a spare card, or combo, play the 2 (WIP)
              if (this.isSpareCard(cardToCheck, cardMap, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes)){
                console.log("CARD TO CHECK: " + cardToCheck.suit + " " + cardToCheck.rank);

                if(lastPlayedHand[0].split(' ')[1] != 2 && spareCards.length > 0 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0])
                  || lastPlayedHand[0].split(' ')[1] != 2 && straights.length > 0 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0])
                  || lastPlayedHand[0].split(' ')[1] != 2 && flushes.length > 0 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0])
                  || lastPlayedHand[0].split(' ')[1] != 2 && fullHouses.length > 0 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0])){
                  //if player has one 2 card only, check if player has any other combo or spare cards
                  hand.push(cardToCheck.suit + " " + cardToCheck.rank);
                  return hand;
                }
                else{
                  //if not a 2 card, play the card
                  hand.push(cardToCheck.suit + " " + cardToCheck.rank);
                  return hand;
                }
              }
              //else if 2 is part of a combo but player has multiple doubles, and last card was not 2, play the 2
              else if(cardToCheck.rank == 2 && doubles.length>=2  && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0] && lastPlayedHand[0].split(' ')[1] != 2) ){
                hand.push(cardToCheck.suit + " " + cardToCheck.rank);
                return hand;
              }
              //else if card is higher rank than last played card and card is a 2 of diamonds or clubs and player has a straight or flush
              //else if i cant find card thats higher than previously played card (TO DO: add a check to check if card is part of combo), pass
              else if(i == this.numberOfCards - 1){
                console.log("pass");
                hand.length = 0;
                return hand;
              }
              break;
              case 2:
              case 3:
              case 4:
                //if player has 2 or more 2's and has combos, play the two
                if(lastPlayedHand[0].split(' ')[1] != 2 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0]) && straights.length > 0
                || lastPlayedHand[0].split(' ')[1] != 2 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0]) && flushes.length > 0
                || lastPlayedHand[0].split(' ')[1] != 2 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0]) && fullHouses.length > 0
                || lastPlayedHand[0].split(' ')[1] != 2 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0]) && spareCards.length > 0
                || lastPlayedHand[0].split(' ')[1] != 2 && cardToCheck.rank == 2 && cardMap.get(cardToCheck.suit + " " + cardToCheck.rank) > cardMap.get(lastPlayedHand[0]) && doubles.length > 0
                || lastPlayedHand[0].split(' ')[1] != 2 && this.isSpareCard(cardToCheck, cardMap, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes)) {
                    //if player has one 2 card only, check if player has any other combo or spare cards
                    hand.push(cardToCheck.suit + " " + cardToCheck.rank);
                    return hand;
                }
                else if(i == this.numberOfCards - 1){
                  console.log("pass");
                  hand.length = 0;
                  return hand;
                }
                break;
        }
      }
    }

    doubleSelector(hand, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes, cardMap){
      switch(doubles.length){
        case 0:
          //if no doubles, pass turn
          console.log("pass");
          hand.length = 0;
          return hand;
        case 1:
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          console.log("1 double left")
          //check if i have 1 triple left as well(means i have a fullhouse and i should not play this double)
          if(triples.length >= 1){
            console.log("1 double and triple left")
            console.log("pass");
            hand.length = 0;
            return hand;
          }
          //TO DO if double is 2 dont play it
          
          if(this.isSpareDouble(doubles[0], triples, straights, flushes, foks, straightFlushes)){
            //if double is a spare double and is greater than last played double, and isn't a double 2, play the double
            if(cardMap.get(doubles[0][1]) > cardMap.get(lastPlayedHand[1]) && doubles[0][1].slice(2,3) != 2){
              console.log("PUSHED DOUBLES")
              hand.push(...doubles[0]);
              return hand;
            }
            if(cardMap.get(doubles[0][1]) > cardMap.get(lastPlayedHand[1]) && doubles[0][1].slice(2,3) == 2 ){
              //if player will have 2 cards left and they are a double, play the 2s OR if player will have one card left play the 2s
              if(this.numberOfCards == 4 && doubles.length == 2 || this.numberOfCards == 3){
                hand.push(...doubles[0]);
                return hand;
              }
            }
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          console.log("2 or more doubles left")
          if(triples.length >= 2){
            console.log("multiple doubles and 2 triples left")
            console.log("pass");
            hand.length = 0;
            return hand;
          }
          for(let i = 0; i < doubles.length ; i++){
            //if double is a spare double and is greater than last played double, play the double
            if(this.isSpareDouble(doubles[i], triples, straights, flushes, foks, straightFlushes)){
              if(cardMap.get(doubles[i][1]) > cardMap.get(lastPlayedHand[1]) && doubles[i][1].slice(2,3) != 2){
                console.log("PUSHED DOUBLES")
                hand.push(...doubles[i]);
                return hand;
              }
              if(cardMap.get(doubles[i][1]) > cardMap.get(lastPlayedHand[1]) && doubles[i][1].slice(2,3) == 2 ){
                //if player will have 2 cards left and they are a double, play the 2s OR if player will have one card left play the 2s
                if(this.numberOfCards == 4 && doubles.length == 2 || this.numberOfCards == 3){
                  hand.push(...doubles[i]);
                  return hand;
                }
              }
            }
          }
          console.log("pass");
          hand.length = 0;
          return hand;
      }
    }

    tripleSelector(hand, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes, cardMap){
      switch(triples.length){
        case 0:
          //if no triples, pass turn
          console.log("pass");
          hand.length = 0;
          return hand;
        case 1:
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          console.log("1 triple left")
          //check if i have 1 triple left as well(means i have a fullhouse and i should not play this double)
          if(doubles.length >= 1){
            console.log("1 triple and double left")
            console.log("pass");
            hand.length = 0;
            return hand;
          }
          //if triple is a spare triple and is greater than last played triple, play the double
          if(this.isSpareTriple(triples[0], doubles, straights, flushes, foks, straightFlushes)){
            if(cardMap.get(triples[0][2]) > cardMap.get(lastPlayedHand[2])){
              console.log("PUSHED TRIPLES")
              hand.push(...triples[0]);
              return hand;
            }
            if(cardMap.get(triples[0][2]) > cardMap.get(lastPlayedHand[2]) && triples[0][2].slice(2,3) == 2 ){
              //if player will have 2 cards left and they are a double, play the 2s OR if player will have one card left play the 2s
              if(this.numberOfCards == 5 && doubles.length == 1 || this.numberOfCards == 6 && triples.length == 2 || this.numberOfCards == 4){
                hand.push(...triples[i]);
                return hand;
              }
            }
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case 2:
        case 3:
        case 4:
        case 5:
        case 6:
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          console.log("2 or more triples left")
          if(doubles.length >= 2){
            console.log("multiple triples and 2 doubles left")
            console.log("pass");
            hand.length = 0;
            return hand;
          }
          for(let i = 0; i < triples.length ; i++){
            //if double is a spare double and is greater than last played double, play the double
            if(this.isSpareDouble(doubles[i], triples, straights, flushes, foks, straightFlushes)){
              if(cardMap.get(triples[i][2]) > cardMap.get(lastPlayedHand[2])){
                console.log("PUSHED TRIPLES")
                hand.push(...triples[i]);
                return hand;
              }
              if(cardMap.get(triples[i][2]) > cardMap.get(lastPlayedHand[2]) && triples[i][2].slice(2,3) == 2 ){
                //if player will have 2 cards left and they are a double, play the 2s OR if player will have one card left play the 2s
                if(this.numberOfCards == 5 && doubles.length == 1 || this.numberOfCards == 6 && triples.length == 2 || this.numberOfCards == 4){
                  hand.push(...triples[i]);
                  return hand;
                }
              }
            }
          }
          console.log("pass");
          hand.length = 0;
          return hand;
      }
    }

    //compare all the combos with each other and return the best combo to play depending on the game situation
    comboSelector(hand, lastPlayedHand, straights, flushes, foks, straightFlushes, fullHouses, cardMap, ) {
      const lastPlayedCombo = this.validateCombo(lastPlayedHand, this.wonRound);
      console.log("LAST PLAYED COMBO: " + lastPlayedCombo);

      //strategy depending on last played combo
      switch(lastPlayedCombo){
        case "straight":
        case "straight3d":
        case "straightWonRound":
          //play higher straight if available
          console.log("LAST COMBO WAS STRAIGHT")
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          if(straights.length >= 1){
            for(let i = 0; i < straights.length; i++){
              if(cardMap.get(straights[i][4]) > cardMap.get(lastPlayedHand[4])){
                return straights[i];
              }
            }
            // If straight isn't found, it will continue to the next conditions
          }
          //else play higher combo
          if(flushes.length >=1){
            console.log("LAST COMBO WAS STRAIGHT AND I HAVE FLUSH")
            return flushes[0];
          }
          else if(fullHouses.length >=1){
            console.log("LAST COMBO WAS STRAIGHT AND I HAVE FH")
            return fullHouses[0];
          }
          else if(foks.length >=1){
            hand.push(foks[0]);
            return hand;
          }
          else if(straightFlushes.length >=1){
            hand.push(straightFlushes[0]);
            return hand;
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case "flush":
        case "flush3d":
        case "flushWonRound":
          console.log("LAST COMBO WAS FLUSH")
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          //play higher straight if available
          if(flushes.length >= 1){
            for(let i = 0; i < flushes.length; i++){
              //if last card in flush is a higher value, plpay the flush
              if(flushes[i][0].slice(0,1) > lastPlayedHand[0].slice(0,1)
              || flushes[i][0].slice(0,1) == lastPlayedHand[0].slice(0,1) && cardMap.get(flushes[i][4]) > cardMap.get(lastPlayedHand[4])){
                console.log("last combo was flush, playing higher flush")
                return flushes[i];
              }
            }
          }
          if(fullHouses.length >=1){
            console.log("last combo was flush, playing fullhouse")
            return fullHouses[0];
          }
          else if(foks.length >=1){
            return foks[0];
          }
          else if(straightFlushes.length >=1){
            return straightFlushes[0];
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case "fullHouse":
        case "fullHouse3d":
        case "fullHouseWonRound":
          //if fullhouse's last card is larger than previous full house, play the card
          console.log("LAST COMBO WAS FULLHOUSE")
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          if(fullHouses.length >= 1){
            for(let i = 0; i < fullHouses.length; i++){
              //compare 3rd card with last played hand because 3rd card will always be part of the triple e.g (44 4 55 || 33 A AA)(99 9 JJ || 88 Q QQ)
              if(cardMap.get(fullHouses[i][2]) > cardMap.get(lastPlayedHand[2])){
                console.log("LAST COMBO WAS FULLHOUSE AND I HAVE HIGHER FH")
                return fullHouses[i];
              }
            }
          }
          if(foks.length >=1){
            return foks[0];
          }
          else if(straightFlushes.length >=1){
            return straightFlushes[0];
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case "fok":
        case "fok3d":
        case "fokWonRound":
          console.log("LAST COMBO WAS FOK")
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          if(foks.length >= 1){
            for(let i = 0; i < foks.length; i++){
              //compare 3rd card with last played hand because 3rd card will always be part of the fok e.g (4444 5 || 3 AAAA)
              if(cardMap.get(foks[i][3]) > cardMap.get(lastPlayedHand[3])){
                console.log("LAST COMBO WAS FOK AND I HAVE HIGHER FOK")
                return foks[i];
              }
            }
          }
          if(straightFlushes.length >=1){
            return straightFlushes[0];
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
        case "straightFlush":
        case "straightFlush3d":
        case "straightFlushWonRound":
          console.log("LAST COMBO WAS FOK")
          if(this.numberOfCards == 0){
            hand.length = 0;
            return hand;
          }
          if(straightFlushes.length >= 1){
            for(let i = 0; i < foks.length; i++){
              //if 5th card of straight flush is higher than other straight flushes 5th card, then you can play the straight flush
              if(cardMap.get(straightFlushes[i][4]) > cardMap.get(lastPlayedHand[4])){
                console.log("LAST COMBO WAS SF AND I HAVE HIGHER SF")
                return straightFlushes[i];
              }
            }
          }
          else{
            console.log("pass");
            hand.length = 0;
            return hand;
          }
          break;
      }
    }

    //this function takes into account previously played card/s and returns a hand array to the playCard function
    selectCard(lastValidHand, gameDeck){
      const lastPlayedHandIndex = gameDeck.length - lastValidHand;
      const lastPlayedHand = [];
      let hand = []; // hand array holds selected cards
      const deck = new Deck();
      deck.sort();
      const cardMap = deck.cardHash();
      const twos = this.findTwos();
      const doubles = this.findDoubles();      
      const triples = this.findTriples();    
      const straights = this.findStraights();
      const flushes = this.findFlushes();
      const fullHouses = this.findFullHouses();
      const straightFlushes = this.findStraightFlush();
      const spareCards = this.findSpareCards(doubles, triples, straights, flushes);
      const foks = this.findFoks(spareCards);

      for(let i = lastPlayedHandIndex; i < gameDeck.length; i++){
        //if i less than 0 (happens after user wins a round, because gamedeck length is 0 and lastValidHand stores length of winning hand)
        if(i < 0){
            continue; //don't insert cards into last played hand and continue out of loop
        }
        lastPlayedHand.push(gameDeck[i].suit + " " + gameDeck[i].rank); //insert last played cards into array (as a string to use with comboValidate function)
      }
      console.log("lastPLAYEDHANDLENGTH: " + lastPlayedHand.length)
      console.log("TWOS LENGTH " + twos.length);
      console.log("FLUSHES LENGTH: " + flushes.length);
      console.log("STRAIGHTS LENGTH: " + straights.length);
      console.log("FULLHOUSES LENGTH: " + fullHouses.length);
      console.log("FOK LENGTH: " + foks.length);
      console.log("STRAIGHT FLUSH LENGTH: " + straightFlushes.length);
      
      switch(lastPlayedHand.length){
        //FIRST TURN / FREE TURN LOGIC
        case 0:
          hand = this.freeHandSelector(hand, doubles, triples, spareCards, straights, flushes, fullHouses, foks, straightFlushes, gameDeck);
          console.log("Value of hand before returning:", hand);
          console.log("Length of hand before returning:", hand.length);
          return hand;
        //SINGLE CARD LOGIC
        case 1:
          //return a single card based on hand combo situation
            hand = this.singleSelector(hand, lastPlayedHand, doubles, triples, spareCards, straights, flushes, fullHouses, foks, straightFlushes, cardMap, twos);
            console.log("Value of hand before returning:", hand);
            console.log("Length of hand before returning:", hand.length);
            return hand;
          //DOUBLE CARD LOGIC
        case 2:
          hand = this.doubleSelector(hand, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes, cardMap);
          return hand;
          //TRIPLE CARD LOGIC
        case 3:
          hand = this.tripleSelector(hand, lastPlayedHand, doubles, triples, straights, flushes, foks, straightFlushes, cardMap);
          return hand;
        //COMBO LOGIC
        case 5:
          hand = this.comboSelector(hand, lastPlayedHand, straights, flushes, foks, straightFlushes, fullHouses, cardMap);
          return hand;
      }
    }

    async playCard(gameDeck, turn, lastValidHand, players) {
        var placeCardAudio = new Audio("audio/flipcard.mp3");
        var passAudio = new Audio("audio/pass.mp3");
        var self = this; //assign player to self
        
        //function to find all possible combos, find outlier cards
        //if lowest card in ai hand(thats not part of a combo) is larger than last played card(only single for now)
        //select cpu hand function based on previous played cards, current combos, etc, insert cards into hand, then play the animation
        const hand = this.selectCard(lastValidHand, gameDeck);
        
        var myPromise = new Promise(async (resolve) => {
          let rotationOffset = Math.random() * 4 - 2; // Calculate a new rotation offset for each card to create a random rotation
          console.log("ROTATIONAL OFFSET: " + rotationOffset)
          var animationPromises = []; //holds all animation promises
          var cardsToRemove = []; //holds indexes of cards to be removed
          let i = 0; //for staggered placing down animations (remove if i dont like it)

          await new Promise(resolve => setTimeout(resolve, 500)); // wait 1 second before placing cards
            
          console.log('Value of hand:', hand + "hand length: " + hand.length)
          if(hand.length == 0){
            resolve(hand.length);
            //passAudio.play();
          }
          hand.forEach(cardId=> {
            //return index of player's card that matches card in hand (different than player class, because hand contains card object)
            let cardIndex = self.cards.findIndex(card => card.suit + " " + card.rank == cardId);
            let card = self.findCardObject(cardId); //return card object using cardId to search

            //animations are different, depending on current opponent (TO DO: This is probably redundant since player 4 animations work for player 1)
              if(turn == 0){
                //animate card object to gameDeck position (//can use turn to slightly stagger the cards like uno on ios)
                let p1Promise = new Promise((cardResolve) => {
                  card.animateTo({
                      delay: 0, // wait 1 second + i * 2 ms
                      duration: 25,
                      ease: 'linear',
                      rot: 0 + rotationOffset,
                      x: 26 + (i * 15),
                      y: 0,
                      onComplete: function () {
                        if (cardIndex !== -1) {
                          card.setSide('front');
                          card.$el.style.zIndex = gameDeck.length; //make it equal gameDeck.length
                          gameDeck.push(self.cards[cardIndex]); //insert player's card that matches cardId into game deck
                          console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                          //add card index into cardsToRemove array, so I can remove all cards at same time after animations are finished
                          //insert cardIndex at beginning so that when im sorting the array in reverse the higher index will be processed first
                          cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank);
                          console.log("Cards to remove: " + cardsToRemove);
                          placeCardAudio.play();
                        }
                        
                        cardResolve(); //only resolve promise when animation is complete
                      } 
                  })                                 
                }); 
                animationPromises.push(p1Promise); //add animation promise to promise array 
              }
              else if(turn == 1){
                //animate card object to gameDeck position (//can use turn to slightly stagger the cards like uno on ios)
                let p2Promise = new Promise((cardResolve) => {
                  card.animateTo({
                      delay: 0, // wait 1 second + i * 2 ms
                      duration: 25,
                      ease: 'linear',
                      rot: 0 + rotationOffset,
                      x: 12 + (i * 15),
                      y: 0,
                      onComplete: function () {
                        if (cardIndex !== -1) {
                          card.setSide('front');
                          card.$el.style.zIndex = gameDeck.length; //make it equal gameDeck.length
                          gameDeck.push(self.cards[cardIndex]); //insert player's card that matches cardId into game deck
                          console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                          //add card index into cardsToRemove array, so I can remove all cards at same time after animations are finished
                          //insert cardIndex at beginning so that when im sorting the array in reverse the higher index will be processed first
                          cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank);
                          console.log("Cards to remove: " + cardsToRemove);
                          placeCardAudio.play();
                        }
                        
                        cardResolve(); //only resolve promise when animation is complete
                      } 
                  })                                 
                }); 
                animationPromises.push(p2Promise); //add animation promise to promise array 
              }
              //else if player 3
              else if(turn == 2){
                let p3Promise = new Promise((cardResolve) => {
                  card.animateTo({
                      delay: 0, 
                      duration: 25,
                      ease: 'linear',
                      rot: 0 + rotationOffset,
                      x: 12 + (i * 15),
                      y: 0,
                      onComplete: function () {
                        if (cardIndex !== -1) {
                          card.setSide('front');
                          card.$el.style.zIndex = gameDeck.length; 
                          gameDeck.push(self.cards[cardIndex]); 
                          console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                          cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank); 
                          console.log("Cards to remove: " + cardsToRemove);
                          placeCardAudio.play();
                        }
                        cardResolve(); 
                      } 
                  })                                 
                }); 
                animationPromises.push(p3Promise); //add animation promise to promise array 
              }
              //else player 4
              else {
                let p4Promise = new Promise((cardResolve) => {
                  card.animateTo({
                      delay: 0, // wait 1 second + i * 2 ms
                      duration: 25,
                      ease: 'linear',
                      rot: 0 + rotationOffset,
                      x: 12 + (i * 15),
                      y: 0,
                      onComplete: function () {
                        if (cardIndex !== -1) {
                          card.setSide('front');
                          card.$el.style.zIndex = gameDeck.length; //make it equal gameDeck.length
                          gameDeck.push(self.cards[cardIndex]); //insert player's card that matches cardId into game deck
                          console.log("card inserted: " + self.cards[cardIndex].suit + self.cards[cardIndex].rank);
                          cardsToRemove.unshift(self.cards[cardIndex].suit + " " + self.cards[cardIndex].rank); 
                          console.log("Cards to remove: " + cardsToRemove);
                          placeCardAudio.play();
                        }
                        cardResolve(); //only resolve promise when animation is complete
                      } 
                  })                                 
                }); 
                animationPromises.push(p4Promise); //add animation promise to promise array  
              }
              i++;
            })

            await Promise.all(animationPromises);

            //loop through cardsToRemove array which contains card indexes to be removed
            cardsToRemove.forEach(cardToRemove => {
              const indexToRemove = self.cards.findIndex(card => {
                  return card.suit + ' ' + card.rank === cardToRemove;
              });
      
              if (indexToRemove !== -1) {
                  console.log("removed card: " + self.cards[indexToRemove].suit + self.cards[indexToRemove].rank);
                  self.cards.splice(indexToRemove, 1);
              }
            });

            console.log("returning hand.length" + hand.length)
            //could just sort hand here
            resolve(hand.length); //return amount of cards played
            hand.length = 0; //clear hand after playing it
        });

        return myPromise;
    }
}