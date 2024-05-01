class GameState {
    constructor(players, gameDeck, lastHand, turn, lastValidHand, finishedDeck, playersFinished, playedHistory, playedHand) {
      this.players = players;
      this.gameDeck = gameDeck;
      this.lastHand = lastHand;
      this.turn = turn;
      this.lastValidHand = lastValidHand;
      this.finishedDeck = finishedDeck;
      this.playersFinished = playersFinished;
      this.playedHistory = playedHistory;
      this.playedHand = playedHand; //storing last played hand length
    }
  }
  export default GameState;