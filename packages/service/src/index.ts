import express from 'express';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import { createServer } from 'http';

const app = express();
const port = process.env.PORT || 3000;

// Utworzenie serwera HTTP
const server = createServer(app);

// Konfiguracja WebSocket
const wss = new WebSocketServer({ server });

// Przechowywanie aktywnych terminali
const terminals: Map<string, pty.IPty> = new Map();

// Endpoint sprawdzający stan serwera
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Obsługa połączeń WebSocket
wss.on('connection', (ws, req) => {
  const terminalId = Math.random().toString(36).substring(2, 15);
  
  // Utworzenie nowego terminala
  const term = pty.spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env as { [key: string]: string }
  });

  terminals.set(terminalId, term);

  // Przesyłanie danych z terminala do klienta
  term.onData((data) => {
    ws.send(JSON.stringify({ type: 'output', data }));
  });

  // Obsługa danych przychodzących od klienta
  ws.on('message', (message) => {
    try {
      const { type, data } = JSON.parse(message.toString());
      if (type === 'input') {
        term.write(data);
      }
    } catch (err) {
      console.error('Błąd przetwarzania wiadomości:', err);
    }
  });

  // Sprzątanie po zamknięciu połączenia
  ws.on('close', () => {
    const term = terminals.get(terminalId);
    if (term) {
      term.kill();
      terminals.delete(terminalId);
    }
  });
});

// Uruchomienie serwera
server.listen(port, () => {
  console.log(`Serwer TermiMux uruchomiony na porcie ${port}`);
});