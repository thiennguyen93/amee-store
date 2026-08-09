// A server-sent-events broadcaster, which is the whole of the harness's
// live-reload transport.
//
// SSE rather than a WebSocket because EventSource is built into every browser
// and needs no library on either side — this repository has no dependencies
// and this file is not the place to start. It also reconnects on its own, so
// restarting dev.mjs re-attaches an already-open harness page without the
// developer touching it.

/// Long enough to stay out of the way, short enough that a proxy or a sleeping
/// laptop's dead connection is noticed rather than hanging forever.
const HEARTBEAT_MS = 25_000;

export function createBroadcaster() {
  /** @type {Set<import("node:http").ServerResponse>} */
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, HEARTBEAT_MS);
  // Never hold the process open on our own account.
  heartbeat.unref?.();

  return {
    get size() {
      return clients.size;
    },

    /// Attaches `res` as a client and sends `hello` immediately, so a page that
    /// connected after a change still learns the current resolution.
    attach(req, res, hello) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Node buffers small writes on some paths; this makes each event land
        // as it is written rather than when a buffer happens to fill.
        "X-Accel-Buffering": "no",
      });
      res.write(": connected\n\n");
      clients.add(res);
      if (hello !== undefined) send(res, hello);

      const drop = () => clients.delete(res);
      req.on("close", drop);
      req.on("error", drop);
      res.on("error", drop);
    },

    send(payload) {
      for (const res of clients) send(res, payload);
    },

    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

function send(res, payload) {
  // JSON can't contain a raw newline, so one data: line is always enough.
  res.write(`data:${JSON.stringify(payload)}\n\n`);
}
