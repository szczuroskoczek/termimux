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
  WsToClientScene,
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
    if (raw) return JSON.parse(raw);
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
  x: number;
  y: number;
  w: number;
  h: number;
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
  requestHistory: (id: string, linesBack: number) => void;
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
      reconnectTimer = setTimeout(() => {
        if (get().connectionState === WebSocket.CLOSED) get().connect();
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
      ws = new WebSocket(get().url);

      ws.onopen = () => {
        set({ connectionState: WebSocket.OPEN });
        clearReconnectTimer();
        sendMessage({ type: "giveScene" });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data.toString()) as WsToClient;
          const state = get();

          switch (msg.type) {
            case "scene": {
              const persisted = loadLayouts();
              set((cur) => {
                const newTerms: Record<string, TerminalState> = {};
                msg.data.terminals.forEach((t) => {
                  const ex = cur.terminals[t.id];
                  const p = persisted[t.id] || {};
                  newTerms[t.id] = {
                    ...t,
                    x: ex?.x ?? p.x ?? 0,
                    y: ex?.y ?? p.y ?? 0,
                    w: ex?.w ?? p.w ?? 6,
                    h: ex?.h ?? p.h ?? 4,
                    fontSize: ex?.fontSize ?? p.fontSize ?? DEFAULT_FONT_SIZE,
                    isHistoryView: ex?.isHistoryView ?? false,
                    scrollbackOffset: ex?.scrollbackOffset ?? 0,
                  };
                });
                // cleanup callbacks
                Object.keys(cur.terminals).forEach((id) => {
                  if (!newTerms[id]) terminalCallbacks.delete(id);
                });
                // persist
                const toSave: Record<string, PersistedLayout> = {};
                Object.entries(newTerms).forEach(([id, t]) => {
                  toSave[id] = {
                    x: t.x,
                    y: t.y,
                    w: t.w,
                    h: t.h,
                    fontSize: t.fontSize,
                  };
                });
                saveLayouts(toSave);
                return { terminals: newTerms };
              });
              break;
            }

            case "output": {
              const ts = state.terminals[msg.id];
              if (ts && !ts.isHistoryView) {
                terminalCallbacks.get(msg.id)?.onData(msg.data);
              }
              break;
            }

            case "historyChunk": {
              const cb = terminalCallbacks.get(msg.id);
              if (cb) {
                set((s) => ({
                  terminals: {
                    ...s.terminals,
                    [msg.id]: {
                      ...s.terminals[msg.id]!,
                      scrollbackOffset: msg.linesBack,
                      isHistoryView: msg.linesBack > 0,
                    },
                  },
                }));
                cb.onData(msg.data);
              }
              break;
            }

            default:
              console.warn("WS: Unknown message", msg);
          }
        } catch (e) {
          console.error("WS: msg parse error", e);
        }
      };

      ws.onerror = (e) => console.error("WS error", e);
      ws.onclose = (ev) => {
        ws = null;
        set({ connectionState: WebSocket.CLOSED, terminals: {} });
        terminalCallbacks.clear();
        if (!ev.wasClean) scheduleReconnect();
      };
    },

    disconnect: () => {
      clearReconnectTimer();
      if (ws) ws.close(1000, "User disconnected");
      ws = null;
      set({ connectionState: WebSocket.CLOSED, terminals: {} });
      terminalCallbacks.clear();
    },

    createTerminal: () => sendMessage({ type: "create" }),
    closeTerminal: (id) => sendMessage({ type: "close", id }),
    sendInput: (id, data) => sendMessage({ type: "input", id, data }),

    resizeTerminal: (id, cols, rows) => {
      if (cols > 0 && rows > 0) {
        sendMessage({ type: "resize", id, cols, rows });
        set((s) => ({
          terminals: {
            ...s.terminals,
            [id]: { ...s.terminals[id]!, cols, rows },
          },
        }));
      }
    },

    updateTerminalLayout: (id, layout) => {
      set((s) => {
        if (!s.terminals[id]) return {};
        const updated = {
          ...s.terminals,
          [id]: { ...s.terminals[id], ...layout },
        };
        // persist
        const toSave: Record<string, PersistedLayout> = {};
        Object.entries(updated).forEach(([tid, t]) => {
          toSave[tid] = {
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            fontSize: t.fontSize,
          };
        });
        saveLayouts(toSave);
        return { terminals: updated };
      });
    },

    updateFontSize: (id, fontSize) => {
      set((s) => {
        if (!s.terminals[id]) return {};
        const updated = {
          ...s.terminals,
          [id]: { ...s.terminals[id], fontSize },
        };
        // persist
        const toSave: Record<string, PersistedLayout> = {};
        Object.entries(updated).forEach(([tid, t]) => {
          toSave[tid] = {
            x: t.x,
            y: t.y,
            w: t.w,
            h: t.h,
            fontSize: t.fontSize,
          };
        });
        saveLayouts(toSave);
        return { terminals: updated };
      });
    },

    requestHistory: (id, linesBack) => {
      sendMessage({ type: "requestHistory", id, linesBack });
    },

    enterHistoryView: (id) => {
      set((s) => ({
        terminals: {
          ...s.terminals,
          [id]: {
            ...s.terminals[id]!,
            isHistoryView: true,
            scrollbackOffset: 1,
          },
        },
      }));
      sendMessage({ type: "requestHistory", id, linesBack: 1 });
    },

    exitHistoryView: (id) => {
      set((s) => ({
        terminals: {
          ...s.terminals,
          [id]: {
            ...s.terminals[id]!,
            isHistoryView: false,
            scrollbackOffset: 0,
          },
        },
      }));
      sendMessage({ type: "requestHistory", id, linesBack: 0 });
    },

    scrollHistory: (id, dir) => {
      const ts = get().terminals[id];
      if (!ts) return;
      let offset = ts.scrollbackOffset;
      const step = Math.max(1, Math.floor(ts.rows / 2));

      if (!ts.isHistoryView) {
        offset = dir === "up" ? step : 0;
        if (offset === 0) return;
        set((s) => ({
          terminals: {
            ...s.terminals,
            [id]: { ...ts, isHistoryView: true },
          },
        }));
      } else {
        offset = dir === "up" ? offset + step : offset - step;
      }
      offset = Math.max(0, offset);
      if (offset === ts.scrollbackOffset && ts.isHistoryView) return;
      if (offset === 0) {
        get().exitHistoryView(id);
      } else {
        set((s) => ({
          terminals: {
            ...s.terminals,
            [id]: { ...ts, isHistoryView: true, scrollbackOffset: offset },
          },
        }));
        sendMessage({ type: "requestHistory", id, linesBack: offset });
      }
    },

    registerTerminalCallbacks: (id, onData, onError, onOtherEvents) => {
      terminalCallbacks.set(id, { onData, onError, onOtherEvents });
      return () => terminalCallbacks.delete(id);
    },
  };
});

export default useWsConnection;
