# Chess Arena

Full-stack online multiplayer chess.

## Features
- Unique profile creation and profile resume
- Persistent JSON data for users, ratings, wins, losses, draws and game history
- Live online players
- Challenge / accept / decline
- Server-side chess rules with chess.js
- Correct white/black pieces and square board
- 5-minute server-controlled clock
- Resign, checkmate, draw and disconnect handling
- Rating changes: win +20, loss -15, draw +3
- Level and 20-win milestone badges

## Run locally
```bash
npm install
npm start
```
Then open http://localhost:3000

This version intentionally uses only JavaScript/Node packages, so it does NOT require Visual Studio or C++ Build Tools.

## Render
Build Command: npm install
Start Command: npm start

For persistent data on Render, set DATA_DIR to a folder on a Render persistent disk (for example `/var/data`) and attach that disk to the service.
