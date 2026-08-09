# Big 2 Multiplayer Client

A browser-based Big 2 card game ecosystem, built with HTML, vanilla JavaScript, and CSS. Play head-to-head over real-time multiplayer, practice solo against a custom-trained AI opponent, or grind out a game of Shithead while you wait for a table.

## Features

- **Real-time multiplayer** — play Big 2 with friends over Socket.io, with room creation/resume, live hand updates, and reconnect support.
- **Single-player mode** — a standalone mode for solo play.
- **AI opponent** — a custom-trained PyTorch PPO model, deployed to the browser via TensorFlow.js, tuned specifically to this project's house rules.
- **Polished feedback loop** — toast/status messaging, animated card reveals, and a position-based card fan for natural-looking hands.
- **Authentication** — user accounts and sessions via PocketBase.

## House Rules

This implementation deviates from "standard" Big 2 in a few deliberate ways (and the AI opponent is trained against these specifically):

- Play continues past the first player finishing — it's not winner-takes-all-and-done.
- Four-card hands are not legal.
- Four-of-a-kind + kicker counts as a legal five-card bomb.

## Tech Stack

| Layer | Tech |
|---|---|
| Client | JavaScript (ES modules), HTML/CSS |
| Styling | Tailwind CSS v4, PostCSS, Autoprefixer |
| Real-time transport | Socket.io |
| Auth | PocketBase |
| Audio | Howler.js |
| AI training | Python, PyTorch (PPO) |
| AI inference (browser) | TensorFlow.js |

## Project Structure

```
.
├── big2.js          # Main multiplayer game logic
├── player.js         # Player state & card mechanics
├── opponent.js        # Multiplayer AI opponent logic
├── spOpponent.js       # Single-player AI opponent logic
├── src/
│  └── js/
│    └── ui.js       # Shared UI helpers (toasts, status, hand formatting)
├── main.css          # Styling
├── server/           # [Socket.io server, room management, etc.]
├── ai/              # [Python/PyTorch training pipeline]
└── ...
```

## Getting Started

### Prerequisites

- Node.js [version]
- A PocketBase instance (local or hosted) for auth
- [Any other services / env requirements]

### Installation

```bash
git clone https://github.com/Zun69/big2-multiplayer-client.git
cd big2-multiplayer-client
npm install
```

This installs `socket.io` for the real-time server/client, plus the Tailwind CSS build toolchain (`@tailwindcss/cli`, `postcss`, `autoprefixer`).

### Configuration

Create a `.env` file with:

```
POCKETBASE_URL=
SOCKET_SERVER_URL=
[other env vars]
```

### Building CSS

```bash
npx @tailwindcss/cli -i [input.css] -o [output.css] --watch
```

### Running locally

> No `npm run server` / `npm run dev` scripts are currently defined in `package.json` — add them, or run these directly:

```bash
# Start the Socket.io server
node [server entry file].js

# Serve the client (e.g. via a static file server, or open index.html directly)
```

Then open `http://localhost:[port]` in your browser.

## AI Opponent

The AI is a PPO agent trained in PyTorch against this project's specific house rules, then exported to TensorFlow.js for in-browser inference. Training code and notes live in [`/ai`](./ai).

Key design decisions from training:
- Reward crediting tracks `activePlayers` and a `justFinished` notification, rather than a fixed "look back N rows" window — this was necessary once players start dropping out of the turn rotation as they finish.
- Observation space and model I/O are matched exactly to house rules (no 4-card hands, 4-of-a-kind+kicker as a 5-card bomb).


## License

ISC

## Links

- [Repository](https://github.com/Zun69/big2-multiplayer-client)
- [Issues](https://github.com/Zun69/big2-multiplayer-client/issues)

## Acknowledgements

- AI baseline architecture inspired by Henry Charlesworth's [`big2_PPOalgorithm`](https://github.com/henrycharlesworth/big2_PPOalgorithm) (since replaced by a custom-trained model matching this project's house rules).
