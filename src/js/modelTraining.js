// ModelTraining.js
const tf = require('@tensorflow/tfjs-node-gpu'); // Import TensorFlow.js (choose GPU or CPU version)
const PPO = require('ppo-tfjs'); // Import ppo-tfjs

export default class PpoModel {
    constructor(gameState) {
        this.actionSpace = {
            //discrete action space, since Big 2 involves discrete actions
            'class': 'Discrete',
            'n': 5,
        }
        this.observationSpace = {
            'class': 'Discrete',
        }
    }
    async step(action){
        //do i use the gameStates here?

    }
}
