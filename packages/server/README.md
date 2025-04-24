# TermiMux Server

This package contains the Node.js backend service for TermiMux, refactored to use uWebSockets.js for WebSocket & HTTP, and Node’s `net` module for raw TCP connections, with a universal `MessageRouter` for handling streaming connections.

## Key Features

- **Universal Message Router**: Define message types and handlers cleanly via a `MessageRouter` class.
- **Protocol-Agnostic**: Supports both WebSocket (`ws://localhost:3000`) and raw TCP (`localhost:3001`).
- **High Performance**: Uses [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) for ultra-fast WebSocket & HTTP.
- **PTY Management**: Spawns and manages pseudo-terminals (`node-pty`), broadcasting I/O.
- **HTTP Health Check**: `GET /health` returns JSON with `status` and `activeTerminals`.
- **Clean Shutdown**: Handles PTY exits and client disconnects gracefully.

## Configuration

Environment variables:

- `PORT` (default: `3000`): HTTP/WebSocket server port.
- `TCP_PORT` (default: `3001`): Raw TCP server port.

## Running

Install dependencies and start in development (watch & reload):

```bash
pnpm --filter service install
pnpm --filter service dev
```

For production:

```bash
pnpm --filter service build
pnpm --filter service start
```

## Message Protocol

### Client → Server (`WsToServer`)

- `giveScene`: Request current scene.
- `create`: Create new terminal.
- `input`: Send user input (`{ type: 'input', id: string, data: string }`).
- `resize`: Terminal resize (`{ type: 'resize', id: string, cols: number, rows: number }`).
- `close`: Close terminal (`{ type: 'close', id: string }`).

### Server → Client (`WsToClient`)

- `scene`: Complete `TermiMuxScene` update.
- `output`: Terminal output (`{ type: 'output', id: string, data: string }`).

Handlers are registered in `src/index.ts` via:

```ts
router.on('giveScene', (conn) => { ... });
router.on('create', (conn) => { ... });
...
```

See `src/index.ts` for full implementation.