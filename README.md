# Goofy Chess 2.0

Retro pixel multiplayer chess with persistent accounts, Goofy Coins, 100 boards, Board Royale, badges, quests, profile photos, animated transitions and real-time games.

## Local run
1. Install Node.js 18+ and PostgreSQL.
2. Create a database named `goofy_chess`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The server creates its tables automatically. Existing JSON data from an older Goofy Chess build is imported once when a database is available and the database has no users.

## Render deployment
Keep the existing Render Web Service. Add a Render PostgreSQL database, copy its Internal Database URL into the web service environment variable `DATABASE_URL`, then deploy the final GitHub commit. Build command: `npm install`. Start command: `npm start`. Root Directory stays blank.

The application refuses to use the old JSON store on Render, so account progress cannot silently disappear because of an ephemeral filesystem.

### Board colour system
Every board controls its own light square, dark square, accent, and piece colours. Pieces are not a separate unlockable style: when a board is selected, both players automatically see pieces using that board's colour family. Named boards have curated palettes; the remaining boards receive deterministic palettes derived from their board IDs so every board remains visually distinct.

## Storage
- Local testing works without `DATABASE_URL` using the JSON development fallback.
- Render/production requires `DATABASE_URL` and uses PostgreSQL.
- Do not deploy production without attaching a PostgreSQL database and setting `DATABASE_URL`.
