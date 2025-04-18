import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import ControlPane from './components/ControlPane';
import 'xterm/css/xterm.css';
import './App.css';

interface TermInfo {
  id: string;
  term: Terminal;
  fit: FitAddon;
  ref: HTMLDivElement | null;
}

function App() {
  const [terms, setTerms] = useState<TermInfo[]>([]);
  const wsRef = useRef<WebSocket>();

  // initialize WS
  useEffect(() => {
    const ws = new WebSocket(`wss://psychic-capybara-r445p6q57x53pv5p-3000.app.github.dev/`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to TermiMux service');
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'terminals') {
        // existing terminal IDs
        msg.data.forEach((id: string) => addTermSlot(id));
      }
      else if (msg.type === 'created') {
        addTermSlot(msg.data.id);
      }
      else if (msg.type === 'output') {
        const t = terms.find((t) => t.id === msg.id);
        if (t) t.term.write(msg.data);
      }
      else if (msg.type === 'layouts') {
        msg.data.forEach(([id, layout]: [string, { cols: number; rows: number; x: number; y: number }]) => {
          addTermSlot(id);
          const term = terms.find((t) => t.id === id);
          if (term) {
            term.fit.fit();
            // Apply layout (e.g., position and size)
          }
        });
      }
      else if (msg.type === 'resized') {
        const term = terms.find((t) => t.id === msg.id);
        if (term) {
          term.fit.fit();
        }
      }
      else if (msg.type === 'moved') {
        // Handle terminal move (e.g., update UI position)
      }
    };

    return () => {
      ws.close();
    };
  }, [terms]);

  // helper to add new terminal slot
  const addTermSlot = useCallback((id: string) => {
    setTerms((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      const term = new Terminal({ cursorBlink: true, theme: { background: '#1e1e1e', foreground: '#fff' } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      return [...prev, { id, term, fit, ref: null }];
    });
  }, []);

  // wire terminals to DOM
  useEffect(() => {
    terms.forEach((t) => {
      if (t.ref && !t.term.element) {
        t.term.open(t.ref);
        t.fit.fit();
        t.term.onData((data) => {
          wsRef.current?.send(JSON.stringify({ type: 'input', id: t.id, data }));
        });
        window.addEventListener('resize', () => t.fit.fit());
      }
    });
  }, [terms]);

  const handleSplit = () => {
    // measure last slot size
    const last = terms[terms.length - 1];
    const cols = last?.term.cols || 80;
    const rows = last?.term.rows || 24;
    wsRef.current?.send(JSON.stringify({ type: 'create', cols, rows }));
  };

  return (
    <div className="app-container">
      <ControlPane onSplit={handleSplit} />
      <div className="terminal-grid">
        {terms.map((t) => (
          <div
            key={t.id}
            className="terminal-cell"
            ref={(el) => { t.ref = el; }}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
