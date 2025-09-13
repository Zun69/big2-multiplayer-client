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
    

    // Use positions[] to overwrite placeholders in self.cards,
    // flip them to front, animate to pile, then remove those indices.
    async playServerHand(gameDeck, turn, serverHand, positions, roomCode, socket) {
      const placeCardAudio = new Audio("src/audio/flipcard.mp3");
      const self = this;

      // (optional) tiny stagger
      await new Promise(r => setTimeout(r, 200));

      const anims = [];
      const toRemoveIdx = [];

      for (let i = 0; i < serverHand.length; i++) {
        const idx = positions[i];           // placeholder index in this player's hand
        const real = serverHand[i];         // { rank, suit }
        const card = self.cards[idx];       // select placeholder cards based on positions (4 of spades) 
        if (!card) continue;                // keep it lean; skip if somehow missing
        
        // 1) overwrite placeholder to match server card
        card.rank = real.rank;
        card.suit = real.suit;
        card.setRankSuit(card.rank, card.suit);
        card.setSide('front');

        // 1) promote to common layer so we share the same coords
        //self.promoteCardToLayer(card);

        const p = new Promise(res => {
          card.animateTo({
            delay: i * 50,
            duration: 150,
            ease: 'linear',
            rot: 0,
            x: Math.round(self.pileXBySeat[turn]((i * 15) - (gameDeck.length * 0.25))),
            y: Math.round(self.pileYBySeat[turn](gameDeck.length * 0.25)),
            onComplete: () => {
              card.$el.style.zIndex = gameDeck.length;
              gameDeck.push(card);
              placeCardAudio.play();
              toRemoveIdx.push(idx);
              res();
            }
          });
        });
        anims.push(p);
      }

      await Promise.all(anims);

      // 3) remove those exact cards from this player's hand (desc order to avoid reindex issues)
      toRemoveIdx.sort((a, b) => b - a).forEach(idx => {
        if (self.cards[idx]) self.cards.splice(idx, 1);
      });

      return serverHand.length;
    }

}