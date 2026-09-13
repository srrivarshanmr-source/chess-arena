# Goofy Chess

A retro pixel-game styled real-time multiplayer chess website.

## Included
- Unique username + password accounts
- Passwords stored as secure scrypt hashes
- Returning-player login and automatic browser session resume
- Persistent JSON data file (`goofy-chess-data.json`)
- Online players and real-time challenges
- Inviter is always White and moves first
- 1/3/5/10/15/30 minute matches
- Multiple board themes and piece styles with unlock progression
- Server-side chess validation using chess.js
- Ratings / Goofy Points, XP, levels, tasks and 500 badges
- First badge: Pawn Awakening
- Badge every 5 wins after the first badge
- Leaderboard and match history
- Profile photo upload
- Animated pixel-game UI and result screens
- User-provided welcome, win and loss images
- Button/move/capture/result sound effects generated in-browser

## Run locally
```bash
npm install
npm start
```
Then open `http://localhost:3000`.

## Render
Create a Web Service connected to this repository.
- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`

For durable profile data on a host without persistent local storage, configure a persistent disk and set `DATA_DIR` to that disk path. Otherwise the JSON database can reset on redeploy/restart.
