import Player from "./player.js"

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
    new Howl({ src: ["src/audio/playcard_10.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_11.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_12.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_13.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_14.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_15.wav"], volume: 0.9 }),
    new Howl({ src: ["src/audio/playcard_16.wav"], volume: 0.9 })
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

      // always invert for opponents on first layout
      const invert = true;

      this.cards.sort((a, b) => {
        const ak = a.meta.shadowKey, bk = b.meta.shadowKey;
        return invert ? (bk - ak) : (ak - bk);
      });
    }

    // Use positions[] to overwrite placeholders in self.cards,
    // flip them to front, animate to pile, then remove those indices.
    async playServerHand(gameDeck, serverHand, positions) {
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

        // PRIME the front so the final flip doesn't hitch/flicker
        card.setSide('front');
        card.$el.offsetHeight;   // force layout/paint
        card.setSide('back');

        let rotationOffset = Math.random() * 5 + -5; // Calculate a new rotation offset for each card
        console.log("ROTATIONAL OFFSET: " + rotationOffset)
        
        // get middle card index to center pairs, triples, and combos correctly
        const { gx, gy } = self.getGameCenterXY();
        const mid = (serverHand.length - 1) / 2;
        let stackInterval = 0.25;

        // simple, global target for everyone
        const offX = ((i - mid) * 15) - (gameDeck.length * stackInterval);
        const offY = (gameDeck.length * stackInterval);

        const { cx, cy } = self.getCardCenterInGC(card.$el);

        // delta needed to land the card’s center on the anchor:
        const dx = (gx - cx);
        const dy = (gy - cy);

        const p = new Promise(res => {
          card.animateTo({
            delay: i * 50,
            duration: 150,
            ease: 'linear',
            rot: rotationOffset,
            x: Math.round(card.x + dx + offX),
            y: Math.round(card.y + dy - offY),
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