import express from 'express';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { createServer } from 'http';

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store all active terminals (by id)
const terminals: Map<string, pty.IPty> = new Map();

// Store terminal layout information
const terminalLayouts: Map<string, { cols: number; rows: number; x: number; y: number }> = new Map();

// Broadcast helper
function broadcast(msg: any) {
    const raw = JSON.stringify(msg);
    wss.clients.forEach((c) => {
        if (c.readyState === c.OPEN) c.send(raw);
    });
}

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

wss.on('connection', (ws) => {
    // Send existing terminal IDs on connect
    ws.send(JSON.stringify({ type: 'terminals', data: Array.from(terminals.keys()) }));

    // Send existing terminal layouts on connect
    ws.send(JSON.stringify({ type: 'layouts', data: Array.from(terminalLayouts.entries()) }));

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message.toString());
        } catch {
            return;
        }

        if (msg.type === 'create') {
            // spawn new PTY with requested size
            const id = Math.random().toString(36).slice(2);
            const { cols, rows, x, y } = msg;
            const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
            const term = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols,
                rows,
                cwd: process.cwd(),
                env: process.env as any,
            });
            terminals.set(id, term);
            terminalLayouts.set(id, { cols, rows, x, y });

            term.onData((data) => {
                broadcast({ type: 'output', id, data });
            });

            broadcast({ type: 'created', data: { id, cols, rows, x, y } });
        }

        else if (msg.type === 'input' && msg.id) {
            const term = terminals.get(msg.id);
            if (term) term.write(msg.data);
        }

        else if (msg.type === 'resize' && msg.id) {
            const term = terminals.get(msg.id);
            if (term) {
                term.resize(msg.cols, msg.rows);
                const layout = terminalLayouts.get(msg.id);
                if (layout) {
                    layout.cols = msg.cols;
                    layout.rows = msg.rows;
                }
                broadcast({ type: 'resized', id: msg.id, cols: msg.cols, rows: msg.rows });
            }
        }

        else if (msg.type === 'move' && msg.id) {
            const layout = terminalLayouts.get(msg.id);
            if (layout) {
                layout.x = msg.x;
                layout.y = msg.y;
                broadcast({ type: 'moved', id: msg.id, x: msg.x, y: msg.y });
            }
        }

        else if (msg.type === 'close' && msg.id) {
            const term = terminals.get(msg.id);
            if (term) {
                term.kill();
                terminals.delete(msg.id);
                terminalLayouts.delete(msg.id);
                broadcast({ type: 'closed', id: msg.id });
            }
        }
    });

    ws.on('close', () => {
        // no per-connection cleanup now
    });
});

server.listen(port, () => {
    console.log(`TermiMux service listening on port ${port}`);
});
