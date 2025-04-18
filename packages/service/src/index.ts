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
            const { cols, rows } = msg;
            const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
            const term = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols,
                rows,
                cwd: process.cwd(),
                env: process.env as any,
            });
            terminals.set(id, term);

            term.onData((data) => {
                broadcast({ type: 'output', id, data });
            });

            broadcast({ type: 'created', data: { id, cols, rows } });
        }

        else if (msg.type === 'input' && msg.id) {
            const term = terminals.get(msg.id);
            if (term) term.write(msg.data);
        }

        else if (msg.type === 'resize' && msg.id) {
            const term = terminals.get(msg.id);
            if (term) {
                term.resize(msg.cols, msg.rows);
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
