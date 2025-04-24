import { useEffect } from "react";
import "./App.css";
import useWsConnection from "./WsConnection";
import { Terminals } from "./Terminals";

const connectionStateMap: Record<number, string> = {
  [WebSocket.CONNECTING]: "connecting",
  [WebSocket.OPEN]: "connected",
  [WebSocket.CLOSING]: "closing",
  [WebSocket.CLOSED]: "disconnected",
};

export default function App() {
  const connect = useWsConnection((state) => state.connect);
  const connectionState = useWsConnection((state) => state.connectionState);
  const createTerminal = useWsConnection((state) => state.createTerminal);

  useEffect(() => {
    // Attempt connection only if not already connected or connecting
    if (connectionState === WebSocket.CLOSED) {
      connect();
    }
    // No cleanup needed here as the connection logic is handled in the store
  }, [connect, connectionState]);

  const statusText = connectionStateMap[connectionState] || "unknown";

  return (
    <div className="app-container">
      <div className="control-pane">
        {connectionState === WebSocket.OPEN ? (
          <button onClick={createTerminal}>Create Terminal</button>
        ) : (
          <button
            onClick={connect}
            disabled={connectionState === WebSocket.CONNECTING}
          >
            {connectionState === WebSocket.CONNECTING ? "Connecting..." : "Connect"}
          </button>
        )}
        <div className={`status ${statusText}`}>{statusText}</div>
      </div>
      <div className="main-content">
        {connectionState === WebSocket.OPEN ? (
          <Terminals />
        ) : (
          <div className="connection-status-message">
            <p>{statusText === 'connecting' ? 'Connecting...' : 'Disconnected. Attempting to reconnect...'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
