import type { IncomingMessage, ServerResponse } from "node:http";

import type { SessionAuthenticator, WorkHttpJournalPort } from "./index.ts";

export interface RemoteWorkEventStreamInput {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly work: WorkHttpJournalPort;
  readonly sessions: SessionAuthenticator;
  readonly authorization: string | undefined;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly after: number;
  readonly pollIntervalMs: number;
}

/**
 * Durable Work SSE across independently connected PostgreSQL instances.
 *
 * Polling is an optimization, not event authority: each new event and the
 * replay cursor are reconstructed from the canonical Work journal. This
 * supports resuming after listener disconnect or process restart even if
 * a poll was missed. Every poll also rechecks current session, workspace,
 * and explicit Work participation against their authoritative providers.
 *
 * Unlike LISTEN/NOTIFY alone, polling cannot lose committed operations
 * while an API instance is disconnected. Do not call this push transport
 * instantaneous; it is bounded periodic polling with a resumable cursor.
 */
export function openRemoteWorkEventStream(input: RemoteWorkEventStreamInput): void {
  const {
    request, response, work, sessions, authorization,
    principalId, workspaceId, workInstanceId,
  } = input;
  let sequence = input.after;
  let closed = false;
  let pumping = false;
  let lastHeartbeat = Date.now();

  response.on("close", close);
  request.on("aborted", close);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "connection": "keep-alive",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-accel-buffering": "no",
  });
  send(": connected\n\n");
  const interval = setInterval(() => { void pump(); }, input.pollIntervalMs);
  interval.unref();
  void pump();

  async function pump(): Promise<void> {
    if (closed || pumping) return;
    pumping = true;
    try {
      const principal = await sessions.resolve(authorization);
      if (closed) return;
      if (principal?.id !== principalId) { close(); return; }

      // Do not trust the initial authorization at connection time. Recheck
      // active workspace membership and explicit Work participation on
      // every poll, including polls that have no new operations.
      await work.workInstance({ principalId, workspaceId, id: workInstanceId });
      if (closed) return;
      const history = await work.history({ principalId, workspaceId });
      if (closed) return;

      for (const operation of history) {
        if (closed) return;
        if (operation.workInstanceId !== workInstanceId || operation.ledgerSequence <= sequence) continue;
        // Never silently skip a valid Work operation when a subscriber's
        // connection is backpressured. The client can reconnect with the
        // last successfully delivered ledger cursor.
        if (!send(`id: ${operation.ledgerSequence}\nevent: work-operation\ndata: ${JSON.stringify({ operation })}\n\n`)) {
          return;
        }
        sequence = operation.ledgerSequence;
      }
      if (Date.now() - lastHeartbeat >= 15_000) {
        if (!send(": heartbeat\n\n")) return;
        lastHeartbeat = Date.now();
      }
    } catch {
      // Broken database, corrupt history or lost authority always closes
      // the stream instead of implicitly granting stale access.
      close();
    } finally {
      pumping = false;
    }
  }

  function send(frame: string): boolean {
    if (closed || response.destroyed || response.writableEnded) {
      close();
      return false;
    }
    try {
      if (!response.write(frame)) {
        // TCP backpressure is not an authorization to buffer without bound.
        close();
        return false;
      }
      return true;
    } catch {
      close();
      return false;
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    response.off("close", close);
    request.off("aborted", close);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
