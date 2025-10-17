import Player from "./player.js"

// ---------------------------
// Global sound setup
// ---------------------------
const playCardSounds = [
  new Howl({ src: ["src/audio/playcard_03.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/playcard_04.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/playcard_07.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/playcard_08.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/playcard_09.wav"], volume: 0.9 }),
  new Howl({ src: ["src/audio/playcard_10.wav"], volume: 0.9 })
];

let lastSoundIndex = -1;

function playRandomCardSound() {
  let idx;
  do {
    idx = (Math.random() * playCardSounds.length) | 0;
  } while (playCardSounds.length > 1 && idx === lastSoundIndex);
  lastSoundIndex = idx;
  playCardSounds[idx].play();
}

export default class Opponent extends Player {
    constructor(cards = []) {
      super(cards);
      this.isOpponent = true;
    }
    
    // Run only for the very first layout after dealing
    initialSort(seatIndex) {
      this.cards.forEach((c, i) => {
        c.meta = c.meta || {};
        if (typeof c.meta.shadowKey !== 'number') c.meta.shadowKey = i;
      });

      // Old: only invert if fan is left/up
      // const cfg = this.SEAT?.[seatIndex] || this.SEAT?.[0] || { stepX: 0, stepY: 0 };
      // const invert = (cfg.stepX < 0) || (cfg.stepY < 0);

      // always invert for opponents on first layout
      const invert = true;

      this.cards.sort((a, b) => {
        const ak = a.meta.shadowKey, bk = b.meta.shadowKey;
        return invert ? (bk - ak) : (ak - bk);
      });
    }

    // Use positions[] to overwrite placeholders in self.cards,
    // flip them to front, animate to pile, then remove those indices.
    async playServerHand(gameDeck, turn, serverHand, positions, roomCode, socket) {
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
        card.setSide('back');
        

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
            onStart: () => {
              gameDeck.push(card);
              card.$el.style.zIndex = gameDeck.length;
              playRandomCardSound();
            },
            onComplete: () => {
              card.setSide('front');
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