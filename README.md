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
- [Packages](#packages)
  - [server](#server-package)
  - [gui](#gui-package)
  - [types](#types-package)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)
- [Roadmap](#roadmap)

---

## Introduction

TermiMux is a lightweight, browser-based terminal multiplexer. It allows you to spawn and manage multiple shell sessions (bash, PowerShell, etc.) through a unified web interface. Built as a monorepo using pnpm workspaces, it separates concerns into distinct packages:

-   **`packages/server`**: A Node.js backend service using Express, ws, and node-pty to spawn and manage shell processes, handling WebSocket communication.
-   **`packages/gui`**: A Vite + React frontend that renders terminals using xterm.js and communicates with the server via a single WebSocket connection.
-   **`packages/types`**: Shared TypeScript interfaces for communication between the server and GUI.

## Motivation

Traditional terminal multiplexers are powerful but limited to text-based interfaces. TermiMux brings multiplexing to the web, offering:

-   **Accessibility**: Access your terminals from any device with a modern web browser.
-   **Modern UI**: Leverage web technologies for a richer user experience.
-   **Simplicity**: Provides essential multiplexing features in an easy-to-use interface.

## Features

-   Spawn multiple independent shell sessions (bash, PowerShell, etc.).
-   Close terminals individually from the UI.
-   Real-time, bidirectional communication via WebSockets.
-   Browser-based terminal rendering with xterm.js.
-   Terminal resizing synchronization (GUI ↔ Server ↔ PTY).
-   Visual scaling (zoom) of individual terminals in the UI.
-   Responsive terminal grid layout.
-   Clean separation of concerns (backend/frontend/types).
-   Graceful shutdown of server and terminal processes.
-   Basic auto-reconnect mechanism in the GUI.

## Architecture

```plaintext
termimux/                # Monorepo root
├── packages/
│   ├── types/         # Shared TypeScript interfaces (DTOs)
│   ├── server/        # Node.js backend (Express + ws + node-pty)
│   └── gui/           # Vite + React frontend (xterm.js)
├── pnpm-workspace.yaml  # Defines workspaces
├── package.json         # Root scripts (dev, build, start)
└── tsconfig.json        # Root TS config (references packages)
```

1.  **Server**: Listens for WebSocket connections (e.g., `ws://localhost:3000`). Manages the `TermiMuxScene` (list of active terminals) and underlying `node-pty` processes.
2.  **GUI**: Connects to the server's WebSocket endpoint. Receives `scene` updates and terminal `output`. Sends `create`, `input`, `resize`, and `close` requests.
3.  **Types**: Ensures type safety for messages exchanged between server and GUI.

## Tech Stack

| Area         | Technology                                      |
| :----------- | :---------------------------------------------- |
| **Monorepo** | pnpm Workspaces                                 |
| **Backend**  | Node.js, TypeScript, Express, ws, node-pty      |
| **Frontend** | React, TypeScript, Vite, xterm.js, CSS          |
| **Types**    | TypeScript                                      |
| **Tooling**  | ESLint, nodemon, concurrently                   |

## Getting Started

### Prerequisites

-   Node.js (v18 or later recommended)
-   pnpm (v8 or later recommended)

### Installation

```bash
# Clone the repository
git clone <your-repo-url> termimux
cd termimux

# Install dependencies for all packages
pnpm install
```

### Development

Starts both the server and GUI in development mode with hot-reloading.

```bash
pnpm dev
```

-   **Server** runs on `http://localhost:3000` (WebSocket on `ws://localhost:3000`)
-   **GUI** runs on `http://localhost:5173` (access via browser)

### Building

Builds all packages (types, server, gui) for production.

```bash
pnpm build
```

This will:

1.  Compile TypeScript in `types` and `server` to JavaScript in their respective `dist` folders.
2.  Bundle the `gui` application into its `dist` folder.

### Running

Starts the backend server using the compiled code. The GUI needs to be served separately (e.g., using `pnpm --filter gui preview` or a static file server pointing to `packages/gui/dist`).

```bash
# Start only the backend server
pnpm start

# To preview the built GUI (in another terminal)
pnpm --filter gui preview
```

## Project Structure

```plaintext
termimux/
├── .gitignore
├── package.json            # Root package.json with workspace scripts
├── pnpm-workspace.yaml     # Defines pnpm workspaces
├── tsconfig.json           # Root TypeScript configuration
├── README.md               # This file
└── packages/
    ├── types/
    │   ├── src/index.ts    # Shared TypeScript definitions
    │   ├── package.json
    │   └── tsconfig.json
    ├── server/
    │   ├── src/index.ts    # Main backend application logic
    │   ├── package.json
    │   └── tsconfig.json
    │   └── README.md
    └── gui/
        ├── src/
        │   ├── App.tsx     # Main React component
        │   ├── main.tsx    # React entry point
        │   ├── TerminalComponent.tsx # Individual terminal rendering
        │   └── App.css     # Styles
        ├── index.html      # HTML template
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        └── README.md
```

## Packages

### `server` Package

-   **Purpose**: Handles backend logic, PTY management, and WebSocket communication.
-   **Key Files**: `src/index.ts`
-   **Details**: See `packages/server/README.md`.

### `gui` Package

-   **Purpose**: Provides the user interface for interacting with terminals.
-   **Key Files**: `src/App.tsx`, `src/main.tsx`, `src/TerminalComponent.tsx`
-   **Details**: Uses `xterm.js` for terminal emulation and `FitAddon` for resizing.

### `types` Package

-   **Purpose**: Defines shared TypeScript interfaces used for communication.
-   **Key Files**: `src/index.ts`
-   **Details**: Contains definitions for `WsToServer`, `WsToClient`, `TermiMuxScene`, `TermiMuxTerminal`.

## Configuration

Environment variables can be used (e.g., in a `.env` file at the root, though it's gitignored by default):

```dotenv
# Server configuration
PORT=3000

# GUI Development Server Port (Vite)
# VITE_PORT=5173 # Note: Vite uses its own config/CLI flags primarily
```

The server listens on `process.env.PORT` (defaulting to 3000).

## Contributing

Contributions are welcome! Please follow standard fork-and-pull-request workflows. Ensure code passes linting and maintains project conventions.

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/your-feature`).
3.  Commit your changes (`git commit -m 'Add some feature'`).
4.  Push to the branch (`git push origin feature/your-feature`).
5.  Open a Pull Request.

## License

This project is licensed under the MIT License.

## Roadmap

-   [ ] Persist terminal sessions (optional, requires backend storage).
-   [ ] Improve terminal grid layout/management (drag, resize panes).
-   [ ] Authentication/Authorization.
-   [ ] Configuration for shell type, CWD, etc. per terminal.
-   [ ] Testing (unit, integration, e2e).
-   [ ] Electron packaging for a desktop app version.
-   [ ] Enhance UI/UX (theming, better controls).
