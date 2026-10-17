# Watch Party 2.0

A beginner-friendly real-time watch-party web app. This upgraded version adds a sample movie catalogue with fuzzy title search, genre filters, sorting and recommendations; persisted room playlists, polls and playback state; host-only playback controls; drift correction; room capacity and input validation; and automated tests.

## Requirements

- Node.js 18 or newer
- npm
- A modern browser

## Run locally

1. Extract the ZIP.
2. Open a terminal in the `watch_party_project` folder.
3. Install dependencies: `npm install`
4. Start the server: `npm start`
5. Open `http://localhost:3000`.

Open a second browser/device to try two or more users. The health endpoint is `http://localhost:3000/health`.

## Movie discovery

The built-in sample catalogue is available from `/api/movies`. Search is fuzzy against movie titles and supports genre and sorting parameters, for example:

- `/api/movies?q=incepton` (fuzzy match)
- `/api/movies?genre=Comedy&sort=rating`
- `/api/movies?sort=year-new`

This is a sample catalogue, not a live movie database. Selecting Add copies the movie title into the playlist form; users must supply a direct, accessible video URL to actually play it. A movie recommendation is not itself a media licence or streaming link.

## Persistence

Room state is stored in `data/rooms.json`. Playlists, poll question/options/vote counts, selected video and playback position survive a server restart. Active participants and host socket IDs are intentionally not persisted because they belong to live connections. Poll vote eligibility resets after restart. The app writes through a temporary file before replacing the JSON data file.

## Playback and host permissions

Only the current host can set the shared video, seek, play/pause through server synchronization, or start a playlist item. If the host disconnects, the next connected participant becomes host. Drift is corrected by seeking when it is large and briefly adjusting playback speed when it is small. Browser autoplay policies, buffering, media duration and network latency can still affect synchronization.

Use direct MP4/WebM URLs that you own or are allowed to access. YouTube watch, youtu.be, shorts, live and embed links are also supported through the official YouTube IFrame Player API. Some videos disable embedding, and browser autoplay restrictions may require a viewer to press play. The app does not bypass DRM, subscriptions or access controls; subscription streaming services need their own permitted integrations.

## Capacity, validation and security notes

- Maximum 20 connected users per room and 100 playlist items.
- Room codes allow 1–40 letters, numbers, underscores or hyphens.
- URLs must use HTTP(S); chat, title, poll and option lengths are bounded.
- A participant can vote once per poll during a running server session.
- Chat is rendered as text-safe escaped content.
- This is still a learning/demo project, not production-ready. Before public deployment add authentication, rate limiting, CSRF/origin policy appropriate to the deployment, abuse reporting, HTTPS, database transactions, and operational monitoring. Do not expose it directly to the public without those controls.

## Automated tests

Run:

```bash
npm install
npm test
```

Tests exercise fuzzy movie search, genre filtering, URL/room validation, 10 concurrent clients, room joining, chat delivery, host-only controls, and room capacity. Latency tests report request-response timings under the local test environment; those timings are not a guarantee of internet performance. Test conditions and limitations are documented in `TEST_REPORT.md`.

## Project structure

```text
watch_party_project/
  server.js
  package.json
  README.md
  TEST_REPORT.md
  data/rooms.json
  tests/watch-party.test.js
  public/
    index.html
    styles.css
    app.js
```
