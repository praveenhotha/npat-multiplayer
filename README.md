# 🎯 Name, Place, Animal, Thing — Multiplayer

Real-time multiplayer word game where players compete simultaneously from their own devices.

## How to Play

1. One player **creates a room** and gets a 4-letter code
2. Other players **join** using that code
3. Each round, a random letter appears — everyone types answers simultaneously
4. 30 seconds to answer, then scores are revealed
5. **10 points** for unique answers, **5 points** for duplicates, **0** for wrong/empty

## Quick Start

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser. Share the URL with other players on the same network.

## Architecture

```
npat-multiplayer/
├── server.js              # Express + Socket.IO server
├── game/
│   └── GameRoom.js        # Server-side game state (serializable)
├── public/
│   ├── index.html         # Client UI
│   ├── styles.css         # Styling
│   └── client.js          # Socket.IO client logic
├── package.json
└── README.md
```

**Persistence-ready**: `GameRoom.toJSON()` serializes the entire game state. To add persistence later, store/restore this JSON to any database.

## Features

- 2-8 players per room
- Real-time synchronized timer
- Auto-submit on timeout
- Host controls (start, next round, end game, play again)
- Graceful disconnect handling (host transfer)
- Room auto-cleanup after 30 min inactivity
