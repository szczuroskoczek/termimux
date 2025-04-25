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
  // --- Refs ---
  const terminalElRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  // --- Zustand Store Access ---
  const sendInput = useWsConnection((state) => state.sendInput);
  const resizeTerminal = useWsConnection((state) => state.resizeTerminal);
  const updateFontSize = useWsConnection((state) => state.updateFontSize);
  const registerTerminalCallbacks = useWsConnection(
    (state) => state.registerTerminalCallbacks
  );
  const scrollHistory = useWsConnection((state) => state.scrollHistory);
  const exitHistoryView = useWsConnection((state) => state.exitHistoryView);

  // --- Retrieve persisted font size ---
  const persistedFontSize = useWsConnection(
    (state) => state.terminals[id]?.fontSize
  );
  const initialFontSize = persistedFontSize ?? DEFAULT_FONT_SIZE;

  // --- Event Handlers ---

  const handleWheel = useCallback(
    (event: WheelEvent): boolean => {
      if (event.shiftKey) {
        const term = terminalInstanceRef.current;
        const fitAddon = fitAddonRef.current;
        if (!term || !fitAddon) return false;
        const termOptions = term.options as Required<ITerminalOptions>;
        const currentSize = termOptions.fontSize;
        let newSize = currentSize;
        if (event.deltaY < 0) {
          newSize = Math.min(MAX_FONT_SIZE, currentSize + 1);
        } else if (event.deltaY > 0) {
          newSize = Math.max(MIN_FONT_SIZE, currentSize - 1);
        }
        if (newSize !== currentSize) {
          term.options.fontSize = newSize;
          try {
            fitAddon.fit();
            resizeTerminal(id, term.cols, term.rows);
            updateFontSize(id, newSize);
            return false;
          } catch (fitError) {
            console.error(
              `Terminal ${id}: Error fitting after zoom:`,
              fitError
            );
          }
        }
      }
      return true;
    },
    [id, resizeTerminal, updateFontSize]
  );

  const handleResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalInstanceRef.current;
    if (fitAddon && term) {
      try {
        fitAddon.fit();
        resizeTerminal(id, term.cols, term.rows);
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes("invalid")) {
          console.error(`Terminal ${id}: ResizeObserver fit error:`, err);
        }
      }
    }
  }, [id, resizeTerminal]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.shiftKey) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          scrollHistory(id, "up");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          scrollHistory(id, "down");
        }
        return false;
      } else if (event.key === "Escape") {
        const inHistory =
          useWsConnection.getState().terminals[id]?.isHistoryView;
        if (inHistory) {
          event.preventDefault();
          exitHistoryView(id);
        }
        return false;
      }
      return true;
    },
    [id, scrollHistory, exitHistoryView]
  );

  useEffect(() => {
    const terminalContainer = terminalElRef.current;
    if (!terminalContainer) {
      console.error(
        `Terminal ${id}: Container element ref is null during useEffect.`
      );
      return;
    }
    if (terminalInstanceRef.current) {
      console.warn(`Terminal ${id}: Attempted re-initialization.`);
      return;
    }
    console.log(`[Init] Terminal ${id}`);

    let initSuccess = false;
    let observerAttached = false;
    let unregisterWsCallbacks: (() => void) | null = null;

    try {
      // 1. Create Terminal Instance with persisted font size
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        scrollback: 0,
        fontSize: initialFontSize,
        fontFamily: "monospace",
        theme: { background: "#000000" },
        allowProposedApi: true,
      });
      terminalInstanceRef.current = term;

      term.attachCustomWheelEventHandler(handleWheel);
      term.attachCustomKeyEventHandler(handleKeyDown);

      // 2. Load Addons
      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);

      // 3. Mount Terminal in DOM
      term.open(terminalContainer);

      // 4. Initial Fit
      const initialFitTimeout = setTimeout(() => {
        const currentTerm = terminalInstanceRef.current;
        const currentFitAddon = fitAddonRef.current;
        if (currentTerm && currentFitAddon) {
          try {
            currentFitAddon.fit();
            console.log(
              `[Fit] Terminal ${id} initial: ${currentTerm.cols}x${currentTerm.rows}`
            );
            resizeTerminal(id, currentTerm.cols, currentTerm.rows);
          } catch (fitErr) {
            console.error(`Terminal ${id}: Error during initial fit:`, fitErr);
          }
        }
      }, 0);
      disposablesRef.current.push({
        dispose: () => clearTimeout(initialFitTimeout),
      });

      // 5. Register WebSocket Callbacks
      unregisterWsCallbacks = registerTerminalCallbacks(
        id,
        (data) => terminalInstanceRef.current?.write(data),
        (err) => console.error(`Terminal ${id}: WebSocket error:`, err),
        (evt) => console.log(`Terminal ${id}: Unhandled WebSocket event:`, evt)
      );

      // 6. Handle User Input
      const dataListener = term.onData((data) => {
        sendInput(id, data);
      });
      disposablesRef.current.push(dataListener);

      // 7. Handle Container Resizing
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(terminalContainer);
      resizeObserverRef.current = resizeObserver;
      observerAttached = true;

      // 9. Set Focusable for Keyboard Events
      terminalContainer.setAttribute("tabindex", "0");

      initSuccess = true;
    } catch (initError) {
      console.error(
        `Terminal ${id}: Failed during initialization phase:`,
        initError
      );
      if (observerAttached) resizeObserverRef.current?.disconnect();
      unregisterWsCallbacks?.();
      disposablesRef.current.forEach((d) => d.dispose());
      terminalInstanceRef.current?.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      resizeObserverRef.current = null;
      disposablesRef.current = [];
    }

    return () => {
      console.log(`[Cleanup] Terminal ${id}`);
      const observer = resizeObserverRef.current;
      const instance = terminalInstanceRef.current;

      observer?.disconnect();
      if (initSuccess && unregisterWsCallbacks) {
        unregisterWsCallbacks();
      }
      disposablesRef.current.forEach((d) => d.dispose());
      instance?.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      resizeObserverRef.current = null;
      disposablesRef.current = [];
    };
  }, [id, handleWheel, handleKeyDown, handleResize, initialFontSize]);

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
      tabIndex={0}
    />
  );
}