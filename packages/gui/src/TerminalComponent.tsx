import React, { useEffect, useRef, useCallback } from "react";
import { Terminal, ITerminalOptions, IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import useWsConnection from "./WsConnection";
import "@xterm/xterm/css/xterm.css";

interface TerminalComponentProps {
  id: string;
}

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 40;
const DEFAULT_FONT_SIZE = 16;

export default function TerminalComponent({ id }: TerminalComponentProps) {
  const terminalElRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  const sendInput = useWsConnection((s) => s.sendInput);
  const resizeTerminal = useWsConnection((s) => s.resizeTerminal);
  const updateFontSize = useWsConnection((s) => s.updateFontSize);
  const requestHistory = useWsConnection((s) => s.requestHistory);
  const registerTerminalCallbacks = useWsConnection(
    (s) => s.registerTerminalCallbacks
  );
  const scrollHistory = useWsConnection((s) => s.scrollHistory);
  const exitHistoryView = useWsConnection((s) => s.exitHistoryView);

  // Pull persisted font size or use default
  const persistedFontSize = useWsConnection((s) => s.terminals[id]?.fontSize);
  const initialFontSize = persistedFontSize ?? DEFAULT_FONT_SIZE;

  const handleWheel = useCallback(
    (event: WheelEvent): boolean => {
      if (event.shiftKey) {
        const term = terminalInstanceRef.current;
        const fit = fitAddonRef.current;
        if (!term || !fit) return false;
        const opts = term.options as Required<ITerminalOptions>;
        const current = opts.fontSize;
        let next = current;
        if (event.deltaY < 0) next = Math.min(MAX_FONT_SIZE, current + 1);
        else if (event.deltaY > 0) next = Math.max(MIN_FONT_SIZE, current - 1);

        if (next !== current) {
          term.options.fontSize = next;
          try {
            fit.fit();
            resizeTerminal(id, term.cols, term.rows);
            updateFontSize(id, next);
            return false;
          } catch (e) {
            console.error(`Terminal ${id}: zoom fit error`, e);
          }
        }
      }
      return true;
    },
    [id, resizeTerminal, updateFontSize]
  );

  const handleResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const term = terminalInstanceRef.current;
    if (fit && term) {
      try {
        fit.fit();
        resizeTerminal(id, term.cols, term.rows);
      } catch (e: any) {
        if (!e.message.includes("invalid"))
          console.error(`Terminal ${id}: resize error`, e);
      }
    }
  }, [id, resizeTerminal]);

  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (ev.shiftKey) {
        if (ev.key === "ArrowUp") {
          ev.preventDefault();
          scrollHistory(id, "up");
        } else if (ev.key === "ArrowDown") {
          ev.preventDefault();
          scrollHistory(id, "down");
        }
        return false;
      } else if (ev.key === "Escape") {
        if (useWsConnection.getState().terminals[id]?.isHistoryView) {
          ev.preventDefault();
          exitHistoryView(id);
        }
        return false;
      }
      return true;
    },
    [id, scrollHistory, exitHistoryView]
  );

  useEffect(() => {
    const container = terminalElRef.current;
    if (!container || terminalInstanceRef.current) return;

    let initOK = false;
    let unregister: (() => void) | null = null;

    try {
      // 1. Create terminal with persisted font
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: 0,
        fontSize: initialFontSize,
        fontFamily: "monospace",
        theme: { background: "#000" },
        allowProposedApi: true,
      });
      terminalInstanceRef.current = term;

      term.attachCustomWheelEventHandler(handleWheel);
      term.attachCustomKeyEventHandler(handleKeyDown);

      // 2. Fit addon
      const fit = new FitAddon();
      fitAddonRef.current = fit;
      term.loadAddon(fit);

      // 3. Mount
      term.open(container);

      // 4. Initial fit + history fetch
      const tmo = setTimeout(() => {
        const ct = terminalInstanceRef.current!;
        fit.fit();
        resizeTerminal(id, ct.cols, ct.rows);
        // fetch last 'rows' worth of history
        requestHistory(id, ct.rows);
      }, 0);
      disposablesRef.current.push({ dispose: () => clearTimeout(tmo) });

      // 5. WS callbacks
      unregister = registerTerminalCallbacks(
        id,
        (data) => terminalInstanceRef.current?.write(data),
        (err) => console.error(`Terminal ${id} WS error`, err),
        (evt) => console.log(`Terminal ${id} WS evt`, evt)
      );

      // 6. User input
      disposablesRef.current.push(term.onData((d) => sendInput(id, d)));

      // 7. Resize observer
      const ro = new ResizeObserver(handleResize);
      ro.observe(container);
      resizeObserverRef.current = ro;

      // focusable
      container.setAttribute("tabindex", "0");

      initOK = true;
    } catch (e) {
      console.error(`Terminal ${id} init failed`, e);
    }

    return () => {
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
      if (initOK && unregister) unregister();
      disposablesRef.current.forEach((d) => d.dispose());
      terminalInstanceRef.current?.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      disposablesRef.current = [];
    };
  }, [
    id,
    handleWheel,
    handleKeyDown,
    handleResize,
    initialFontSize,
    resizeTerminal,
    requestHistory,
    registerTerminalCallbacks,
    sendInput,
  ]);

  return (
    <div
      ref={terminalElRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "black",
        padding: "2px",
        outline: "none",
      }}
    />
  );
}
