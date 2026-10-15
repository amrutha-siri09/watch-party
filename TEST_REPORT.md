# Automated test and latency report

## Test coverage included

- Fuzzy movie title search, genre filtering and rating sorting.
- HTTP/HTTPS URL and room-code validation.
- Ten simultaneous WebSocket clients joining one room.
- Chat broadcast delivery to all ten clients.
- Room capacity boundary (20 accepted, the next participant rejected).
- Host-only shared-video permission.
- JSON persistence round-trip for playlist and poll vote counts.
- Local chat broadcast response timing, printed by `npm test`.

## Test conditions

The concurrency test uses Node's `node:test` runner, Socket.IO WebSocket transport, a server bound to an ephemeral localhost port, and clients running on the same machine. It broadcasts one chat message to ten connected clients and measures elapsed wall-clock time until all ten receive it. This measures local event handling and delivery, not internet latency or media buffering. Results vary by machine and load.

## Execution status for this packaged copy

Source syntax was checked with Node.js 22.16.0. The full automated integration suite could not be executed in the packaging environment because the npm dependencies were not present and dependency installation timed out. No latency number is claimed here. After extracting the ZIP with internet access, run:

```bash
npm install
npm test
```

The test output prints the observed local latency. If any test fails, fix it before reporting the project as fully verified.
