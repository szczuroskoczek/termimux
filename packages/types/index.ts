// --- Messages from GUI (Client) → Server ---

/** Request the current scene state from the server */
interface WsToServerGiveScene {
  type: "giveScene";
}

/** Request the server to create a new terminal instance */
interface WsToServerCreateTerminal {
  type: "create";
}

/** Send user input data (e.g., keystrokes) to a specific terminal */
export interface WsToServerInput { // Keep export if used directly elsewhere
  type: "input";
  id: string;
  data: string;
}

/** Notify the server about terminal resize */
export interface WsToServerResize {
  type: "resize";
  id: string;
  cols: number;
  rows: number;
}

/** Request the server to close/kill a specific terminal */
export interface WsToServerClose {
  type: "close";
  id: string;
}

/** Request a specific historical view of a terminal */
export interface WsToServerRequestHistory {
  type: "requestHistory";
  id: string;
  /** Number of lines back from the end of the buffer to view.
   *  0 indicates the latest/live view. */
  linesBack: number;
}

/** Union type for all messages sent from Client to Server */
export type WsToServer =
  | WsToServerGiveScene
  | WsToServerCreateTerminal
  | WsToServerInput
  | WsToServerResize
  | WsToServerClose
  | WsToServerRequestHistory; // Added

// --- Messages from Server → GUI (Client) ---

/** Sends the complete current state of all terminals */
export interface WsToClientScene { // Keep export if used directly elsewhere
  type: "scene";
  data: TermiMuxScene;
}

/** Sends live output data from a specific terminal */
export interface WsToClientOutput { // Keep export if used directly elsewhere
  type: "output";
  id: string;
  /** Raw output data (bytes/string) from the PTY process */
  data: string;
}

/** Sends a requested chunk of historical terminal data */
export interface WsToClientHistoryChunk {
    type: "historyChunk";
    id: string;
    /** The requested historical data chunk (potentially including screen clear codes) */
    data: string;
    /** The actual linesBack offset this chunk represents (confirmation) */
    linesBack: number;
}


/** Union type for all messages sent from Server to Client */
export type WsToClient =
    | WsToClientScene
    | WsToClientOutput
    | WsToClientHistoryChunk; // Added

// --- Shared Data Structures ---

/** Represents a single terminal instance within the scene */
export interface TermiMuxTerminal {
  id: string;
  name?: string;
  rows: number;
  cols: number;
}

/** Represents the overall state, containing all active terminals */
export interface TermiMuxScene {
  terminals: TermiMuxTerminal[];
}
