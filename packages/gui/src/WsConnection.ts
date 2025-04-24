import { create } from "zustand";
import {
  TermiMuxTerminal,
  WsToServer,
  WsToClient,
  WsToServerResize,
  WsToServerInput,
  WsToServerClose,
  WsToServerRequestHistory, // Added
  WsToClientHistoryChunk, // Added
  WsToClientOutput,
  WsToClientScene
} from "@termimux/types";

// --- Callbacks & State Types --- 

interface TerminalCallbacks {
  onData: (data: string) => void;
  onError: (err: Event) => void;
  onOtherEvents: (evt: MessageEvent) => void;
}

export interface TerminalState extends TermiMuxTerminal {
  x: number; y: number; w: number; h: number; // Layout
  isHistoryView: boolean; // Is the user viewing scrollback?
  scrollbackOffset: number; // How many lines back from the end?
}

interface TermiMuxState {
  url: string;
  connectionState:
    | WebSocket["CONNECTING"]
    | WebSocket["OPEN"]
    | WebSocket["CLOSING"]
    | WebSocket["CLOSED"];
  terminals: Record<string, TerminalState>;
  connect: () => void;
  disconnect: () => void;
  createTerminal: () => void;
  closeTerminal: (id: string) => void;
  sendInput: (id: string, data: string) => void;
  resizeTerminal: (id: string, cols: number, rows: number) => void;
  updateTerminalLayout: (
    id: string,
    layout: { x: number; y: number; w: number; h: number }
  ) => void;
  // History actions
  enterHistoryView: (id: string) => void;
  exitHistoryView: (id: string) => void;
  scrollHistory: (id: string, direction: "up" | "down") => void;
  // Callback registration
  registerTerminalCallbacks: (
    id: string,
    onData: (data: string) => void,
    onError: (err: Event) => void,
    onOtherEvents: (evt: MessageEvent) => void
  ) => () => void;
}

// --- Utility --- 

const SCROLL_LINES_PER_SCREEN = 10; // How many lines to jump when scrolling history

// --- Zustand Store --- 

const useWsConnection = create<TermiMuxState>((set, get) => {
  let ws: WebSocket | null = null;
  const terminalCallbacks = new Map<string, TerminalCallbacks>();
  let reconnectTimer: NodeJS.Timeout | null = null;
  const reconnectDelay = 5000;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    clearReconnectTimer();
    if (get().connectionState === WebSocket.CLOSED) {
      console.log(`WS: Scheduling reconnect in ${reconnectDelay / 1000}s...`);
      reconnectTimer = setTimeout(() => {
        if (get().connectionState === WebSocket.CLOSED) {
           get().connect();
        }
      }, reconnectDelay);
    }
  };

  // Helper to send messages safely
  const sendMessage = (message: WsToServer) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    } else {
      console.warn(`WS: Cannot send ${message.type}, connection not open.`);
      return false;
    }
  };

  return {
    url: import.meta.env.VITE_WS_URL || "ws://localhost:3000",
    connectionState: WebSocket.CLOSED,
    terminals: {},

    // --- Connection Management ---
    connect: () => {
      if (ws && ws.readyState !== WebSocket.CLOSED) return;
      clearReconnectTimer();
      set({ connectionState: WebSocket.CONNECTING });
      console.log(`WS: Connecting to ${get().url}...`);

      try {
        const socket = new WebSocket(get().url);
        ws = socket;

        socket.onopen = () => {
          console.log("WS: Connected.");
          set({ connectionState: WebSocket.OPEN });
          clearReconnectTimer();
          sendMessage({ type: "giveScene" });
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data.toString()) as WsToClient;
            const state = get(); // Get current state for checks

            switch (msg.type) {
              case "scene": {
                const serverTerminals = msg.data.terminals;
                set((currentState) => {
                  const existingTerminals = currentState.terminals;
                  const newTerminals: Record<string, TerminalState> = {};
                  serverTerminals.forEach((serverTerm) => {
                    const existing = existingTerminals[serverTerm.id];
                    newTerminals[serverTerm.id] = {
                      x: existing?.x ?? 0,
                      y: existing?.y ?? 0,
                      w: existing?.w ?? 6,
                      h: existing?.h ?? 4,
                      ...serverTerm,
                      // Reset history view on scene update (simplification)
                      isHistoryView: existing?.isHistoryView ?? false, // Keep if possible?
                      scrollbackOffset: existing?.scrollbackOffset ?? 0,
                    };
                  });
                  Object.keys(existingTerminals).forEach(id => {
                      if (!newTerminals[id]) terminalCallbacks.delete(id);
                  });
                  return { terminals: newTerminals };
                });
                break;
              }
              case "output": {
                const termState = state.terminals[msg.id];
                // Only process output if NOT in history view for this terminal
                if (termState && !termState.isHistoryView) {
                  const cb = terminalCallbacks.get(msg.id);
                  cb?.onData(msg.data);
                } else {
                  // console.log(`WS: Ignoring live output for ${msg.id} (history view)`);
                }
                break;
              }
              case "historyChunk": {
                const cb = terminalCallbacks.get(msg.id);
                if (cb) {
                  // Update the offset in state to match what server sent
                  set(s => ({
                    terminals: {
                      ...s.terminals,
                      [msg.id]: s.terminals[msg.id] ? {
                        ...s.terminals[msg.id],
                        scrollbackOffset: msg.linesBack,
                        isHistoryView: msg.linesBack > 0 // Ensure history mode if offset > 0
                      } : undefined
                    }
                  }));
                  // Write the historical data (includes screen clear)
                  cb.onData(msg.data);
                } else {
                   console.warn(`WS: Received history chunk for unknown terminal ${msg.id}`);
                }
                break;
              }
              default: {
                console.warn("WS: Received unknown message type:", msg);
              }
            }
          } catch (err) {
            console.error("WS: Error processing message:", err, event.data);
          }
        };

        socket.onerror = (err) => {
          console.error("WS: Error:", err);
        };

        socket.onclose = (event) => {
          console.log(`WS: Closed. Code: ${event.code}, Clean: ${event.wasClean}`);
          ws = null;
          set({ connectionState: WebSocket.CLOSED, terminals: {} });
          terminalCallbacks.clear();
          if (!event.wasClean) {
             scheduleReconnect();
          }
        };
      } catch (error) {
        console.error("WS: Failed to create WebSocket:", error);
        set({ connectionState: WebSocket.CLOSED });
        ws = null;
        scheduleReconnect();
      }
    },

    disconnect: () => {
        clearReconnectTimer();
        if (ws) {
            console.log("WS: Closing connection.");
            ws.close(1000, "User disconnected");
            ws = null;
        }
        set({ connectionState: WebSocket.CLOSED, terminals: {} });
        terminalCallbacks.clear();
    },

    // --- Terminal Actions ---
    createTerminal: () => sendMessage({ type: "create" }),
    closeTerminal: (id: string) => sendMessage({ type: "close", id }),
    sendInput: (id: string, data: string) => sendMessage({ type: "input", id, data }),
    resizeTerminal: (id: string, cols: number, rows: number) => {
      if (cols > 0 && rows > 0) {
        sendMessage({ type: "resize", id, cols, rows });
        // Update local state immediately for responsiveness?
        set(state => ({
            terminals: {
                ...state.terminals,
                [id]: state.terminals[id] ? { ...state.terminals[id], cols, rows } : undefined
            }
        }));
      }
    },
    updateTerminalLayout: (id, layout) => {
      set((state) => {
        if (!state.terminals[id]) return {};
        return {
          terminals: {
            ...state.terminals,
            [id]: { ...state.terminals[id], ...layout },
          },
        };
      });
    },

    // --- History Actions ---
    enterHistoryView: (id: string) => {
        console.log(`History: Entering view for ${id}`);
        set(state => {
            if (!state.terminals[id]) return {};
            return {
                terminals: {
                    ...state.terminals,
                    [id]: { ...state.terminals[id], isHistoryView: true, scrollbackOffset: 1 } // Start 1 line back
                }
            };
        });
        // Request the first page of history
        sendMessage({ type: "requestHistory", id, linesBack: 1 });
    },

    exitHistoryView: (id: string) => {
        console.log(`History: Exiting view for ${id}`);
        set(state => {
            if (!state.terminals[id] || !state.terminals[id].isHistoryView) return {}; // Only exit if in history view
            return {
                terminals: {
                    ...state.terminals,
                    [id]: { ...state.terminals[id], isHistoryView: false, scrollbackOffset: 0 }
                }
            };
        });
        // Request the live view (latest screen)
        sendMessage({ type: "requestHistory", id, linesBack: 0 });
    },

    scrollHistory: (id: string, direction: "up" | "down") => {
        const termState = get().terminals[id];
        if (!termState) return;

        let newOffset = termState.scrollbackOffset;
        const linesToScroll = Math.max(1, Math.floor(termState.rows / 2)); // Scroll half screen
        // const linesToScroll = SCROLL_LINES_PER_SCREEN;

        if (!termState.isHistoryView) {
            // If not in history view, entering via scroll starts near the end
            newOffset = direction === 'up' ? linesToScroll : 0; // Start scrolling up from near end
            if (newOffset === 0) return; // Don't scroll down if already at live
            set(state => ({ terminals: { ...state.terminals, [id]: { ...termState, isHistoryView: true } } }));
            console.log(`History: Entering view via scroll (${direction}) for ${id}`);
        } else {
            if (direction === 'up') {
                newOffset += linesToScroll;
            } else {
                newOffset -= linesToScroll;
            }
        }

        // Clamp offset (cannot be negative)
        newOffset = Math.max(0, newOffset);

        // Don't send request if offset didn't change or trying to scroll past live view
        if (newOffset === termState.scrollbackOffset && termState.isHistoryView) return;

        // If the new offset is 0, exit history mode
        if (newOffset === 0) {
            get().exitHistoryView(id);
        } else {
             // Update offset optimistically? Server confirms via historyChunk.
             set(state => ({ terminals: { ...state.terminals, [id]: { ...termState, isHistoryView: true, scrollbackOffset: newOffset } } }));
             console.log(`History: Scrolling ${direction} for ${id}, requesting linesBack: ${newOffset}`);
             sendMessage({ type: "requestHistory", id, linesBack: newOffset });
        }
    },

    // --- Callback Registration ---
    registerTerminalCallbacks: (id, onData, onError, onOtherEvents) => {
      terminalCallbacks.set(id, { onData, onError, onOtherEvents });
      return () => {
        terminalCallbacks.delete(id);
      };
    },
  };
});

export default useWsConnection;
