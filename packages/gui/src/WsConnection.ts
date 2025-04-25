import { create } from "zustand";
import {
  TermiMuxTerminal,
  WsToServer,
  WsToClient,
  WsToServerResize,
  WsToServerInput,
  WsToServerClose,
  WsToServerRequestHistory,
  WsToClientHistoryChunk,
  WsToClientOutput,
  WsToClientScene
} from "@termimux/types";

// --- Layout & Style Persistence Helpers ---
const LAYOUTS_KEY = "termimux_layouts";
interface PersistedLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
}
function loadLayouts(): Record<string, PersistedLayout> {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load layouts from localStorage:", err);
  }
  return {};
}
function saveLayouts(layouts: Record<string, PersistedLayout>): void {
  try {
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  } catch (err) {
    console.error("Failed to save layouts to localStorage:", err);
  }
}

const DEFAULT_FONT_SIZE = 16;

// --- Callbacks & State Types --- 

interface TerminalCallbacks {
  onData: (data: string) => void;
  onError: (err: Event) => void;
  onOtherEvents: (evt: MessageEvent) => void;
}

export interface TerminalState extends TermiMuxTerminal {
  x: number; y: number; w: number; h: number;
  fontSize: number;
  isHistoryView: boolean;
  scrollbackOffset: number;
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
  updateFontSize: (id: string, fontSize: number) => void;
  enterHistoryView: (id: string) => void;
  exitHistoryView: (id: string) => void;
  scrollHistory: (id: string, direction: "up" | "down") => void;
  registerTerminalCallbacks: (
    id: string,
    onData: (data: string) => void,
    onError: (err: Event) => void,
    onOtherEvents: (evt: MessageEvent) => void
  ) => () => void;
}

const SCROLL_LINES_PER_SCREEN = 10;

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
            const state = get();

            switch (msg.type) {
              case "scene": {
                const serverTerminals = msg.data.terminals;
                const persistedLayouts = loadLayouts();
                set((currentState) => {
                  const existingTerminals = currentState.terminals;
                  const newTerminals: Record<string, TerminalState> = {};

                  serverTerminals.forEach((serverTerm) => {
                    const existing = existingTerminals[serverTerm.id];
                    const persisted = persistedLayouts[serverTerm.id];
                    newTerminals[serverTerm.id] = {
                      x: existing?.x ?? persisted?.x ?? 0,
                      y: existing?.y ?? persisted?.y ?? 0,
                      w: existing?.w ?? persisted?.w ?? 6,
                      h: existing?.h ?? persisted?.h ?? 4,
                      fontSize: existing?.fontSize ?? persisted?.fontSize ?? DEFAULT_FONT_SIZE,
                      ...serverTerm,
                      isHistoryView: existing?.isHistoryView ?? false,
                      scrollbackOffset: existing?.scrollbackOffset ?? 0,
                    };
                  });

                  Object.keys(currentState.terminals).forEach((id) => {
                    if (!newTerminals[id]) terminalCallbacks.delete(id);
                  });

                  const layoutsToSave: Record<string, PersistedLayout> = {};
                  Object.entries(newTerminals).forEach(([tid, term]) => {
                    layoutsToSave[tid] = { x: term.x, y: term.y, w: term.w, h: term.h, fontSize: term.fontSize };
                  });
                  saveLayouts(layoutsToSave);

                  return { terminals: newTerminals };
                });
                break;
              }

              case "output": {
                const termState = state.terminals[msg.id];
                if (termState && !termState.isHistoryView) {
                  const cb = terminalCallbacks.get(msg.id);
                  cb?.onData(msg.data);
                }
                break;
              }

              case "historyChunk": {
                const cb = terminalCallbacks.get(msg.id);
                if (cb) {
                  set((s) => ({
                    terminals: {
                      ...s.terminals,
                      [msg.id]: s.terminals[msg.id]
                        ? {
                            ...s.terminals[msg.id],
                            scrollbackOffset: msg.linesBack,
                            isHistoryView: msg.linesBack > 0,
                          }
                        : undefined,
                    },
                  }));
                  cb.onData(msg.data);
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

    createTerminal: () => sendMessage({ type: "create" }),
    closeTerminal: (id: string) => sendMessage({ type: "close", id }),
    sendInput: (id: string, data: string) => sendMessage({ type: "input", id, data }),

    resizeTerminal: (id: string, cols: number, rows: number) => {
      if (cols > 0 && rows > 0) {
        sendMessage({ type: "resize", id, cols, rows });
        set((state) => ({
          terminals: {
            ...state.terminals,
            [id]: state.terminals[id] ? { ...state.terminals[id], cols, rows } : undefined,
          },
        }));
      }
    },

    updateTerminalLayout: (id, layout) => {
      set((state) => {
        if (!state.terminals[id]) return {};
        const updated: Record<string, TerminalState> = {
          ...state.terminals,
          [id]: { ...state.terminals[id], ...layout },
        };
        const layoutsToSave: Record<string, PersistedLayout> = {};
        Object.entries(updated).forEach(([tid, term]) => {
          layoutsToSave[tid] = { x: term.x, y: term.y, w: term.w, h: term.h, fontSize: term.fontSize };
        });
        saveLayouts(layoutsToSave);
        return { terminals: updated };
      });
    },

    updateFontSize: (id: string, fontSize: number) => {
      set((state) => {
        if (!state.terminals[id]) return {};
        const updatedTerminals: Record<string, TerminalState> = {
          ...state.terminals,
          [id]: { ...state.terminals[id], fontSize },
        };
        const layoutsToSave: Record<string, PersistedLayout> = {};
        Object.entries(updatedTerminals).forEach(([tid, term]) => {
          layoutsToSave[tid] = { x: term.x, y: term.y, w: term.w, h: term.h, fontSize: term.fontSize };
        });
        saveLayouts(layoutsToSave);
        return { terminals: updatedTerminals };
      });
    },

    enterHistoryView: (id: string) => {
      console.log(`History: Entering view for ${id}`);
      set((state) => {
        if (!state.terminals[id]) return {};
        return {
          terminals: {
            ...state.terminals,
            [id]: { ...state.terminals[id], isHistoryView: true, scrollbackOffset: 1 },
          },
        };
      });
      sendMessage({ type: "requestHistory", id, linesBack: 1 });
    },

    exitHistoryView: (id: string) => {
      console.log(`History: Exiting view for ${id}`);
      set((state) => {
        if (!state.terminals[id] || !state.terminals[id].isHistoryView) return {};
        return {
          terminals: {
            ...state.terminals,
            [id]: { ...state.terminals[id], isHistoryView: false, scrollbackOffset: 0 },
          },
        };
      });
      sendMessage({ type: "requestHistory", id, linesBack: 0 });
    },

    scrollHistory: (id: string, direction: "up" | "down") => {
      const termState = get().terminals[id];
      if (!termState) return;

      let newOffset = termState.scrollbackOffset;
      const linesToScroll = Math.max(1, Math.floor(termState.rows / 2));

      if (!termState.isHistoryView) {
        newOffset = direction === 'up' ? linesToScroll : 0;
        if (newOffset === 0) return;
        set((state) => ({ terminals: { ...state.terminals, [id]: { ...termState, isHistoryView: true } } }));
        console.log(`History: Entering view via scroll (${direction}) for ${id}`);
      } else {
        if (direction === 'up') {
          newOffset += linesToScroll;
        } else {
          newOffset -= linesToScroll;
        }
      }

      newOffset = Math.max(0, newOffset);
      if (newOffset === termState.scrollbackOffset && termState.isHistoryView) return;

      if (newOffset === 0) {
        get().exitHistoryView(id);
      } else {
        set((state) => ({
          terminals: { ...state.terminals, [id]: { ...termState, isHistoryView: true, scrollbackOffset: newOffset } },
        }));
        console.log(`History: Scrolling ${direction} for ${id}, requesting linesBack: ${newOffset}`);
        sendMessage({ type: "requestHistory", id, linesBack: newOffset });
      }
    },

    registerTerminalCallbacks: (id, onData, onError, onOtherEvents) => {
      terminalCallbacks.set(id, { onData, onError, onOtherEvents });
      return () => {
        terminalCallbacks.delete(id);
      };
    },
  };
});

export default useWsConnection;