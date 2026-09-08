# Chess Arena Online

A full-stack starter for a realtime online chess platform.

## Included

- Game-name entry screen
- Live list of connected players
- Challenge any available player
- Realtime Socket.IO game sessions
- Legal chess moves through `chess.js`
- 1/3/5/10/15/30 minute clocks
- 5 selectable board colour combinations
- Positive/negative rating changes (+20 win, -15 loss, +3 draw)
- Levels derived from rating
- Tasks/challenges dashboard
- Badge progression UI
- Responsive desktop/mobile layout

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Important production notes

This is a working multiplayer starter, not a production-grade chess service. For deployment, add authentication, a database (PostgreSQL/Redis), persistent ratings/tasks/badges, matchmaking, reconnect handling, anti-cheat validation, server-authoritative clocks, rate limiting, HTTPS, and moderation. For multiple server instances, use a Socket.IO Redis adapter.
