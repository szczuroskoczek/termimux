# TermiMux

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://example.com) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> A browser-based terminal multiplexer: spawn and manage multiple shells (bash/PowerShell) from anywhere through a sleek web GUI.

---

## 📖 Table of Contents

- [Introduction](#introduction)
- [Motivation](#motivation)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development](#development)
  - [Building](#building)
  - [Running](#running)
- [Project Structure](#project-structure)
- [Service Package](#service-package)
  - [Functionality](#functionality)
  - [API & WebSockets](#api--websockets)
- [GUI Package](#gui-package)
  - [Structure](#structure)
  - [Integration with Service](#integration-with-service)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)
- [Roadmap](#roadmap)
- [Synchronization and Layout Management](#synchronization-and-layout-management)

---

## Introduction

TermiMux is a lightweight, browser-based terminal multiplexer. It allows you to spawn and manage multiple shell sessions (bash, PowerShell, etc.) through a unified web interface. Built as a monorepo, it separates concerns into two packages:

- **service**: A Node.js background service that spawns and bridges shells via WebSockets.
- **gui**: A Vite + React front-end that renders terminals in the browser using xterm.js.

This README is organized with clear section headings, code examples, and explicit workflows so that both developers and language models can parse and reason about the project structure and functionality.

---

## Motivation

Traditional terminal multiplexers are constrained to TTY windows. TermiMux embraces the web:

- **Remote access**: Connect from any device with a browser.
- **Extensibility**: Add authentication, logging, and custom UI features.
- **Modular architecture**: Backend and frontend evolve independently.

---

## Features

- Spawn multiple shell sessions concurrently
- Real-time I/O forwarding via WebSockets
- Browser-based terminal emulation (xterm.js)
- Monorepo setup for streamlined development
- Future-ready for Electron packaging

---

## Architecture

```plaintext
termimux/                # Monorepo root
├── packages/
│   ├── service/         # Node.js service (Express + ws + node-pty)
│   └── gui/             # Vite + React GUI (xterm.js)
├── pnpm-workspace.yaml  # Defines workspaces
└── package.json         # Root scripts (dev, build, start)
```

1. **Service** listens on HTTP/WebSocket endpoints (e.g., `ws://localhost:3000/terminals`).
2. **GUI** connects to the service, opens one WebSocket per pane, and renders terminals.

---

## Tech Stack

| Layer     | Technology                   |
|-----------|------------------------------|
| Backend   | Node.js, Express, ws, node-pty |
| Frontend  | Vite, React, TypeScript, xterm.js |
| Tooling   | pnpm, TypeScript, nodemon, concurrently |

---

## Getting Started

### Prerequisites

- Node.js v18+
- pnpm v8+

### Installation

```bash
git clone https://github.com/your-org/termimux.git
cd termimux
pnpm install
```

### Development

Start both service and GUI in watch mode:

```bash
pnpm dev
```

- **Service** on `http://localhost:3000`
- **GUI** on `http://localhost:5173`

### Building

Compile TypeScript and bundle the GUI:

```bash
pnpm build
```

### Running

After build, run the service standalone (serves static GUI on `/public`):

```bash
pnpm start
```

---

## Project Structure

```plaintext
termimux/
├── packages/
│   ├── service/
│   │   ├── src/
│   │   │   └── index.ts     # Entrypoint: Express + WebSocket + node-pty
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── gui/
│       ├── src/
│       │   ├── main.tsx    # React entrypoint
│       │   └── App.tsx     # UI with xterm panes
│       ├── vite.config.ts
│       └── package.json
├── pnpm-workspace.yaml
└── package.json            # Root scripts & workspace config
```

---

## Service Package

### Functionality

- **Shell spawning**: Uses `node-pty` to spawn OS shells.
- **WebSockets**: Broadcasts `pty.onData` over `/terminals/:id` and receives `input` events to write into thepty.

### API & WebSockets

- **HTTP**
  - `GET /health` → 200 OK
- **WebSocket**
  - `ws://<host>/terminals/:id`
    - **Client → Server**: `{ type: 'input', data: 'ls -la\n' }`
    - **Server → Client**: `{ type: 'output', data: '<output bytes>' }`

---

## GUI Package

### Structure

- **React + Vite**: Fast HMR and TypeScript support.
- **xterm.js**: Renders terminal emulator in each pane.
- **State**: Manages multiple terminal sessions by ID.

### Integration with Service

1. On mount, `new Terminal()` for each pane.
2. Open WebSocket to `/terminals/:id`.
3. Pipe `term.onData` → WS `input` messages.
4. Render WS `output` messages via `term.write()`.

---

## Configuration

Create a `.env` file at the monorepo root:

```dotenv
SERVICE_PORT=3000
GUI_PORT=5173

enableAuth=false            # future
```

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/foo`)
3. Commit your changes (`git commit -am 'Add foo'`)
4. Push to your branch (`git push origin feature/foo`)
5. Open a Pull Request

Please follow the code style and include tests for new features.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Roadmap

- [ ] Window resizing & layout controls
- [ ] Authentication & user sessions
- [ ] Integrated logging & metrics
- [ ] Electron packaging for desktop

---

## Synchronization and Layout Management

TermiMux now supports full synchronization of terminal sessions and layout management. This means:

- **Shared Sessions**: All connected users see the same terminal sessions, including their sizes and positions.
- **Dynamic Layout**: The server manages terminal sizes and positions, ensuring consistent layout across all clients.
- **Future Features**: Resize, move, and zoom controls for terminals will be added soon.

This functionality ensures that the server maintains a single source of truth for terminal states, enabling seamless collaboration and advanced layout features.

---

## Metadata for LLM

This README uses clear, hierarchically structured headings (`##`, `###`), code blocks for examples, and explicit lists. It defines:

- **Terminology**: What is "service" vs. "gui"
- **APIs**: Endpoints and message formats
- **Commands**: `pnpm dev`, `pnpm build`, `pnpm start`
- **Structure**: File tree and roles

A language model can parse these sections to answer questions about setup, dependencies, architecture, and usage without ambiguity.

