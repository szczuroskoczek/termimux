import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import os from "os";
import {
  TermiMuxScene,
  WsToClient,
  WsToServer,
  TermiMuxTerminal,
  WsToServerResize,
  WsToServerClose,
  WsToServerInput,
  WsToServerRequestHistory,
  WsToClientHistoryChunk,
  WsToClientOutput,
  WsToClientScene
} from "@termimux/types";

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);
const wss = new WebSocketServer({ server });

const MAX_BUFFER_LINES = 5000; // Max lines to store per terminal buffer

// Store PTY process, config, and output buffer per terminal ID
interface PtyInstance {
    ptyProcess: pty.IPty;
    terminalConfig: TermiMuxTerminal;
    outputBuffer: string[]; // Store lines of output
    currentLineFragment: string; // Handle data chunks not ending in newline
}
const ptyMap = new Map<string, PtyInstance>();

// Minimal logging helper
const log = (level: "INFO" | "WARN" | "ERROR", message: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    // Simple stringification for logging complex objects if needed
    const details = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    console.log(`[${timestamp}] [${level}] ${message} ${details}`);
}

// Broadcast helper (only for non-history messages like scene updates)
function broadcast(msg: WsToClientScene) { // Restrict to scene for now
  const raw = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw, (err) => {
          if (err) {
              log("ERROR", `Broadcast failed for a client:`, err.message);
          }
      });
    }
  });
}

// Send message to a single client
function send(ws: WebSocket, msg: WsToClient) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg), (err) => {
        if (err) {
            log("ERROR", `Send failed to client ${ws.url || 'unknown'}:`, err.message);
        }
    });
  } else {
      // This can be noisy, maybe only log if state is unexpected (e.g., not CLOSED)
      // log("WARN", `Cannot send message, socket state is ${ws.readyState}.`);
  }
}

// Update scene data used for broadcasts
function updateScene(): TermiMuxScene {
    const terminals: TermiMuxTerminal[] = [];
    ptyMap.forEach(instance => {
        terminals.push(instance.terminalConfig);
    });
    return { terminals };
}

function createAndRegisterTerminal(): PtyInstance | null {
  const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
  const initialCols = 80;
  const initialRows = 24;
  let ptyProcess: pty.IPty | null = null;

  try {
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: initialCols,
      rows: initialRows,
      cwd: process.env.HOME || process.cwd(),
      env: { ...process.env } as { [key: string]: string },
      // handleFlowControl: true, // Consider if needed
      encoding: 'utf8' // Ensure UTF8 encoding
    });

    const pid = ptyProcess.pid.toString();
    const terminalConfig: TermiMuxTerminal = {
      id: pid,
      name: `Terminal ${pid}`,
      cols: initialCols,
      rows: initialRows,
    };

    const ptyInstance: PtyInstance = {
        ptyProcess,
        terminalConfig,
        outputBuffer: [],
        currentLineFragment: "",
    };

    log("INFO", `Created terminal ${pid} (${shell}) ${initialCols}x${initialRows}`);
    ptyMap.set(pid, ptyInstance);

    // --- PTY Event Handlers ---
    ptyProcess.onData((data: string) => {
        // 1. Broadcast live output immediately
        const outputMsg: WsToClientOutput = { type: "output", id: pid, data };
        wss.clients.forEach(client => {
            // Send live data only if client is OPEN
            if (client.readyState === WebSocket.OPEN) {
                send(client, outputMsg)
            }
        });

        // 2. Process data for the line buffer
        let currentData = ptyInstance.currentLineFragment + data;
        const lines = currentData.split('\n');

        // Check if the data ends with a newline
        if (currentData.endsWith('\n')) {
            ptyInstance.currentLineFragment = "";
            // Add all lines except the last empty one if it ends with newline
            ptyInstance.outputBuffer.push(...lines.slice(0, -1));
        } else {
            // Last element is an incomplete line
            ptyInstance.currentLineFragment = lines.pop() || "";
            // Add the complete lines
            ptyInstance.outputBuffer.push(...lines);
        }

        // 3. Trim buffer if it exceeds the maximum size
        if (ptyInstance.outputBuffer.length > MAX_BUFFER_LINES) {
            const excess = ptyInstance.outputBuffer.length - MAX_BUFFER_LINES;
            ptyInstance.outputBuffer.splice(0, excess);
        }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      log("INFO", `PTY process ${pid} exited. Code: ${exitCode}, Signal: ${signal}`);
      ptyMap.delete(pid);
      const newScene = updateScene();
      log("INFO", `Removed terminal ${pid}. Broadcasting updated scene.`);
      broadcast({ type: "scene", data: newScene }); // Broadcast scene change on exit
    });

    return ptyInstance;

  } catch (error: unknown) {
    log("ERROR", "Failed to spawn PTY process:", error);
    if (ptyProcess?.pid) {
        ptyMap.delete(ptyProcess.pid.toString()); // Cleanup map if partially added
    }
    return null;
  }
}

// --- Express Health Check ---
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", activeTerminals: ptyMap.size });
});

// --- WebSocket Server Logic ---
wss.on("connection", (ws: WebSocket) => {
  log("INFO", "Client connected");

  // Send initial scene immediately
  send(ws, { type: "scene", data: updateScene() });

  ws.on("message", (message: Buffer | string) => {
    let msg: WsToServer;
    const rawMessage = message.toString();

    try {
      msg = JSON.parse(rawMessage);
    } catch (e) {
      log("ERROR", "Invalid JSON received:", rawMessage, e);
      return;
    }

    // Ensure the connection is still open before processing
    if (ws.readyState !== WebSocket.OPEN) {
        log("WARN", `Ignoring message type ${msg.type} from non-open client state: ${ws.readyState}`);
        return;
    }

    // Get the relevant PTY instance (if applicable for the message type)
    // Use optional chaining ?. for safer access
    const ptyInstance = (msg as any)?.id ? ptyMap.get((msg as any).id) : undefined;

    try {
      // Log the received message type for easier debugging
      // log("INFO", `Received message type: ${msg.type}`, msg);

      switch (msg.type) {
        case "giveScene":
          log("INFO", "Client requested scene.");
          send(ws, { type: "scene", data: updateScene() });
          break;

        case "create":
          log("INFO", "Client requested new terminal.");
          const newInstance = createAndRegisterTerminal();
          if (newInstance) {
            broadcast({ type: "scene", data: updateScene() }); // Broadcast updated scene
          } else {
            log("ERROR", "Failed to create terminal on client request.");
            // Optionally notify the requesting client of the failure
            // send(ws, { type: 'error', message: 'Failed to create terminal' });
          }
          break;

        case "input": {
          const inputMsg = msg as WsToServerInput;
          if (ptyInstance) {
            ptyInstance.ptyProcess.write(inputMsg.data);
          } else {
            log("WARN", `Input for non-existent PTY ID: ${inputMsg.id}`);
          }
          break;
        }

        case "resize": {
          const resizeMsg = msg as WsToServerResize;
          if (!ptyInstance) {
            log("WARN", `Resize for non-existent PTY ID: ${resizeMsg.id}`);
            break;
          }
          try {
            const cols = Math.max(1, Math.floor(resizeMsg.cols));
            const rows = Math.max(1, Math.floor(resizeMsg.rows));

            // Check if resize is actually needed
            if (ptyInstance.terminalConfig.cols !== cols || ptyInstance.terminalConfig.rows !== rows) {
                ptyInstance.ptyProcess.resize(cols, rows);
                ptyInstance.terminalConfig.cols = cols;
                ptyInstance.terminalConfig.rows = rows;
                log("INFO", `Resized terminal ${resizeMsg.id} PTY to ${cols}x${rows}.`);
                // Don't broadcast scene on resize, client updates optimistically
            } else {
                // log("INFO", `Resize skipped for ${resizeMsg.id}, dimensions unchanged (${cols}x${rows})`);
            }
          } catch (resizeError) {
            log("ERROR", `Failed to resize PTY ${resizeMsg.id}:`, resizeError);
          }
          break;
        }

        case "close": {
            const closeMsg = msg as WsToServerClose;
            if (!ptyInstance) {
                log("WARN", `Close request for non-existent PTY ID: ${closeMsg.id}`);
                break;
            }
            log("INFO", `Client requested closing terminal ${closeMsg.id}. Sending kill signal...`);
            try {
                ptyInstance.ptyProcess.kill(); // This should trigger the 'onExit' handler for cleanup
            } catch (killError) {
                log("ERROR", `Failed to send kill signal to PTY ${closeMsg.id}:`, killError);
                // Force cleanup map and broadcast if kill fails
                ptyMap.delete(closeMsg.id);
                broadcast({ type: "scene", data: updateScene() });
            }
            break;
        }

        // *** THIS IS THE CORRECTED CASE PLACEMENT ***
        case "requestHistory": {
            const historyMsg = msg as WsToServerRequestHistory;
            if (!ptyInstance) {
                log("WARN", `History request for non-existent PTY ID: ${historyMsg.id}`);
                break;
            }

            const { outputBuffer, terminalConfig } = ptyInstance;
            // Ensure linesBack is non-negative
            const linesBack = Math.max(0, historyMsg.linesBack);
            const termRows = Math.max(1, terminalConfig.rows); // Ensure rows >= 1
            const bufferLen = outputBuffer.length;

            // Calculate slice indices relative to the end of the buffer
            // endIdx is the index *after* the last line to include
            const endIdx = bufferLen - linesBack;
            const startIdx = Math.max(0, endIdx - termRows);

            // Ensure indices are within buffer bounds
            const safeStartIdx = Math.max(0, Math.min(startIdx, bufferLen));
            const safeEndIdx = Math.max(safeStartIdx, Math.min(endIdx, bufferLen));

            const historyLines = outputBuffer.slice(safeStartIdx, safeEndIdx);

            // Prepend ANSI escape codes: Clear Screen, Move Cursor to Home (1,1)
            const historyData = "\x1b[2J\x1b[H" + historyLines.join('\n');

            log("INFO", `Sending history chunk for ${historyMsg.id}, lines ${safeStartIdx}-${safeEndIdx} of ${bufferLen} (requested linesBack: ${linesBack}, actual offset: ${bufferLen - safeEndIdx})`);

            const chunkMsg: WsToClientHistoryChunk = {
                type: "historyChunk",
                id: historyMsg.id,
                data: historyData,
                linesBack: bufferLen - safeEndIdx // Confirm the actual offset from end used
            };
            send(ws, chunkMsg); // Send only to the requesting client
            break;
        }

        default:
          // Use exhaustive check pattern
          const unhandledMsg: never = msg;
          log("WARN", `Received unhandled message type: ${(unhandledMsg as any)?.type}`);
      }
    } catch (error) {
      log("ERROR", "Error processing message:", msg, error);
      // Optionally send an error back to the client
      // send(ws, { type: 'error', message: 'Internal server error processing message' });
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    log("INFO", `Client disconnected. Code: ${code}, Reason: ${reason.toString().substring(0,100)}`);
    // No specific PTY cleanup needed per client disconnect - PTYs persist
  });

  ws.on("error", (error: Error) => {
    log("ERROR", "WebSocket client error:", error.message);
    // Attempt to terminate the connection if it's in a problematic state
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
    }
  });
});

wss.on("error", (error: Error) => {
    log("ERROR", "WebSocket Server error:", error);
});

server.listen(port, () => {
  log("INFO", `TermiMux service listening on ws://localhost:${port}`);
});

// --- Graceful Shutdown --- 
const shutdown = (signal: string) => {
  log("INFO", `${signal} received. Shutting down...`);

  // 1. Close WebSocket connections gracefully
  log("INFO", `Closing ${wss.clients.size} client connections...`);
  wss.close(() => {
      log("INFO", "WebSocket server closed.");

      // 2. Terminate PTY processes
      log("INFO", `Terminating ${ptyMap.size} PTY processes...`);
      const killPromises = Array.from(ptyMap.values()).map(instance => {
          return new Promise<void>(resolve => {
              instance.ptyProcess.onExit(() => resolve());
              instance.ptyProcess.kill();
              // Add a timeout in case onExit doesn't fire
              setTimeout(resolve, 1000);
          });
      });

      Promise.all(killPromises).then(() => {
          log("INFO", "PTY processes terminated.");
          ptyMap.clear();

          // 3. Close HTTP server
          server.close(() => {
            log("INFO", "HTTP server closed. Shutdown complete.");
            process.exit(0);
          });
      });
  });

  // Force exit after a timeout
  setTimeout(() => {
    log("ERROR", "Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 5000); // 5 second timeout
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("INFO", "Server process started.");
