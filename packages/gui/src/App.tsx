import { useState, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import './App.css';

function App() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal>();
  const wsRef = useRef<WebSocket>();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Inicjalizacja terminala
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    // Połączenie WebSocket
    const ws = new WebSocket(`wss://psychic-capybara-r445p6q57x53pv5p-3000.app.github.dev/`);

    ws.onopen = () => {
      term.writeln('Połączono z serwerem TermiMux...');
    };

    ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        if (type === 'output') {
          term.write(data);
        }
      } catch (err) {
        console.error('Błąd przetwarzania wiadomości:', err);
      }
    };

    ws.onclose = () => {
      term.writeln('\r\nPołączenie z serwerem zostało zamknięte.');
    };

    // Wysyłanie danych wejściowych do serwera
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Obsługa zmiany rozmiaru okna
    window.addEventListener('resize', () => fitAddon.fit());

    termRef.current = term;
    wsRef.current = ws;

    return () => {
      term.dispose();
      ws.close();
    };
  }, []);

  return (
    <div className="app-container">
      <div className="terminal-container" ref={terminalRef} />
    </div>
  );
}

export default App;
