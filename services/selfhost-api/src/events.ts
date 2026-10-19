import type { IncomingMessage, ServerResponse } from "node:http";

import type { DurableWorkJournal } from "../../durable-work/index.ts";

/**
 * Local, replay-backed Server-Sent Events. A notification only wakes the
 * subscriber; every delivered operation comes from the canonical Work ledger.
 */
export function openWorkEventStream(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly work: DurableWorkJournal;
  readonly sessions: {
    resolve(authorization: string | undefined): { readonly id: string } | undefined;
  };
  readonly authorization: string | undefined;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly workInstanceId: string;
  readonly after: number;
}): void {
  const {
    request, response, work, sessions, authorization,
    principalId, workspaceId, workInstanceId,
  } = input;
  let sequence = input.after;
  let closed = false;

  // Bind the subscription before reading the journal, avoiding the
  // snapshot-to-subscribe gap. Work notifications run after a durable commit.
  const unsubscribe = work.subscribeChanges(pump);
  const heartbeat = setInterval(() => {
    if (!authorized()) {
      close();
      return;
    }
    send(": heartbeat\n\n");
  }, 15_000);
  heartbeat.unref();

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
  pump();

  function authorized(): boolean {
    if (closed) return false;
    try {
      if (sessions.resolve(authorization)?.id !== principalId) return false;
      // The latest workspace membership and explicit Work participation
      // are rechecked for every notification and heartbeat.
      work.workInstance({ principalId, workspaceId, id: workInstanceId });
      return true;
    } catch {
      return false;
    }
  }

  function pump(): void {
    if (!authorized()) {
      close();
      return;
    }
    try {
      const history = work.history({ principalId, workspaceId });
      for (const operation of history) {
        if (operation.workInstanceId !== workInstanceId || operation.ledgerSequence <= sequence) continue;
        const event = `id: ${operation.ledgerSequence}\nevent: work-operation\ndata: ${JSON.stringify({ operation })}\n\n`;
        if (!send(event)) return;
        sequence = operation.ledgerSequence;
      }
    } catch {
      close();
    }
  }

  function send(text: string): boolean {
    if (closed || response.destroyed || response.writableEnded) {
      close();
      return false;
    }
    try {
      // Fail closed on backpressure instead of buffering an unbounded stream.
      if (!response.write(text)) {
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
    clearInterval(heartbeat);
    unsubscribe();
    response.off("close", close);
    request.off("aborted", close);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
