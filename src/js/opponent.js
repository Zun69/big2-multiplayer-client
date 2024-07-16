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

    // Play hand based on corresponding clientId's playedHand from server
    async playCard(gameDeck, turn, serverHand) {
        var placeCardAudio = new Audio("audio/flipcard.mp3");
        var passAudio = new Audio("audio/pass.mp3");
        var self = this; //assign player to self
        
        //function to find all possible combos, find outlier cards
        //if lowest card in ai hand(thats not part of a combo) is larger than last played card(only single for now)
        //select cpu hand function based on previous played cards, current combos, etc, insert cards into hand, then play the animation
        //const hand = this.selectCard(lastValidHand, gameDeck);\

        // Hand is received hand emitted by server (if opponent has corresponding clientId then play the hand)
        const hand = serverHand;
        
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