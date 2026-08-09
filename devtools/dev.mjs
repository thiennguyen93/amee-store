#!/usr/bin/env node
// The Amee skin preview harness: a local dev server that mounts a skin the way
// Amee mounts it, against a mock SDK with real audio.
//
//   node devtools/dev.mjs                          # pick a package in the browser
//   node devtools/dev.mjs examples/react-skin      # straight into one
//   node devtools/dev.mjs examples/react-skin --build-watch
//   node devtools/dev.mjs examples/hello-skin --port 4321 --no-open
//   node devtools/dev.mjs registry/skins/amee-v2 --audio ~/Music/track.mp3
//
// Zero dependencies, like everything else in this repository — node:http, a
// recursive fs.watch, and server-sent events. It is deliberately NOT a bundler
// or a framework dev server: the entry file is served as text and imported
// from a blob URL, exactly as Amee does it, so a bare `import "react"` fails
// here for the same reason it fails after install instead of being silently
// rewritten. See devtools/README.md.
//
// This file lives outside tools/ on purpose. tools/*.mjs is executed by
// publish.yml alongside the index signing key and is CODEOWNERS-gated for that
// reason; the harness has no business anywhere near it.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, exists } from "../tools/lib.mjs";
import { buildHint, listPackages, resolveAsset, resolvePackage } from "./lib/resolve.mjs";
import { harnessMime } from "./lib/mime.mjs";
import { createBroadcaster } from "./lib/sse.mjs";
import { watchPackage } from "./lib/watch.mjs";

const DEVTOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(DEVTOOLS_DIR, "web");
const TYPES_FILE = path.join(REPO_ROOT, "types", "amee-sdk.d.ts");

const DEFAULT_PORT = 4173;
/// How far to walk up from the default port before giving up. A pinned --port
/// never walks: silently drifting off a port someone wrote down is worse than
/// refusing to start.
const PORT_SCAN = 20;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    dir: null,
    port: DEFAULT_PORT,
    portPinned: false,
    host: "127.0.0.1",
    open: process.env.BROWSER !== "none",
    buildWatch: false,
    audio: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--port":
        opts.port = Number(argv[++i]);
        opts.portPinned = true;
        if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
          throw new Error(`--port expects a port number, got ${JSON.stringify(argv[i])}`);
        }
        break;
      case "--host":
        opts.host = "0.0.0.0";
        break;
      case "--no-open":
        opts.open = false;
        break;
      case "--build-watch":
        opts.buildWatch = true;
        break;
      case "--audio":
        opts.audio = path.resolve(argv[++i] ?? "");
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
        if (opts.dir) throw new Error("only one package directory can be previewed at a time");
        opts.dir = arg;
    }
  }
  return opts;
}

const HELP = `
Amee skin preview harness

  node devtools/dev.mjs [package-dir] [options]

  package-dir       examples/<id> or registry/<kind>/<id>.
                    Omitted: pick one in the browser.

  --port <n>        Port to bind. Default ${DEFAULT_PORT}, which walks up to
                    ${DEFAULT_PORT + PORT_SCAN} when busy; a pinned port never walks.
  --host            Bind 0.0.0.0 instead of 127.0.0.1. Exposes the package's
                    files to your network — see devtools/README.md.
  --no-open         Don't open a browser.
  --build-watch     Run the package's own \`dev\` script and stream its output
                    into the harness. Only for packages declaring store.build.
  --audio <file>    Play your own audio instead of the built-in synth.
`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`amee dev: ${err.message}`);
    console.error(HELP);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // Package state, re-resolved in place when manifest.json or store.json
  // changes so `entry` and `build` can be edited without a restart.
  let pkg = null;
  let stopWatching = () => {};
  const bus = createBroadcaster();

  async function selectPackage(dirArg) {
    stopWatching();
    pkg = await resolvePackage(dirArg);
    stopWatching = watchPackage(pkg, async ({ kind, paths }) => {
      if (kind === "manifest") {
        try {
          pkg = await resolvePackage(pkg.dir);
        } catch (err) {
          bus.send({ type: "error", message: `manifest reload failed: ${err.message}` });
          return;
        }
        bus.send({ type: "manifest", resolution: describe(pkg) });
      }
      bus.send({ type: "reload", reason: kind, paths: paths.slice(0, 8) });
    });
    return pkg;
  }

  if (opts.dir) {
    try {
      await selectPackage(opts.dir);
    } catch (err) {
      console.error(`amee dev: ${err.message}`);
      process.exit(1);
    }
  }

  if (opts.audio && !(await exists(opts.audio))) {
    console.error(`amee dev: --audio file not found: ${opts.audio}`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: err.message });
    });
  });

  async function handle(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams;

    switch (url.pathname) {
      case "/":
        return sendFile(res, path.join(WEB_DIR, "index.html"));

      case "/stage.html":
        return sendFile(res, path.join(WEB_DIR, "stage.html"));

      case "/__amee/packages":
        return sendJson(res, 200, {
          packages: await listPackages(),
          selected: pkg ? pkg.rel : null,
        });

      case "/__amee/select": {
        // Switching packages from the picker, without restarting the server.
        const dir = q.get("pkg");
        if (!dir) return sendJson(res, 400, { error: "pkg is required" });
        try {
          await selectPackage(path.resolve(REPO_ROOT, dir));
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
        return sendJson(res, 200, { resolution: describe(pkg) });
      }

      case "/__amee/manifest": {
        const target = await pkgFor(q.get("pkg"));
        if (!target) return sendJson(res, 404, { error: "no package selected" });
        return sendJson(res, 200, {
          manifest: target.manifest,
          store: target.store,
          resolution: describe(target),
        });
      }

      case "/__amee/entry": {
        const target = await pkgFor(q.get("pkg"));
        if (!target) return sendJson(res, 404, { error: "no package selected" });
        // text/plain, never text/javascript, and never referenced as a
        // <script src>. The harness fetches this as a string and builds its own
        // blob URL from it. Serving it as a script would let the browser
        // resolve relative imports against http://localhost:PORT/ — which the
        // real loader cannot do, so the harness would quietly accept modules
        // Amee will reject.
        const source = await fs.readFile(target.entryPath, "utf8").catch(() => null);
        if (source === null) {
          return sendJson(res, 404, {
            error: `entry ${target.entry} not found`,
            hint: buildHint(target),
          });
        }
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        return res.end(source);
      }

      case "/__amee/asset": {
        const target = await pkgFor(q.get("pkg"));
        if (!target) return sendJson(res, 404, { error: "no package selected" });
        const result = await resolveAsset(target, q.get("path") ?? "");
        return sendJson(res, result.error ? 404 : 200, result);
      }

      case "/__amee/events": {
        const target = await pkgFor(q.get("pkg"));
        return bus.attach(req, res, {
          type: "hello",
          resolution: target ? describe(target) : null,
        });
      }

      case "/__amee/audio": {
        if (!opts.audio) return sendJson(res, 404, { error: "no --audio file was given" });
        return sendFile(res, opts.audio);
      }

      case "/__amee/types/amee-sdk.d.ts":
        return sendFile(res, TYPES_FILE, "text/plain; charset=utf-8");

      default: {
        if (!url.pathname.startsWith("/web/")) return notFound(res);
        // Exact-prefix static serving, resolved and then re-checked, so no
        // amount of encoding gymnastics in the path escapes devtools/web/.
        const target = path.resolve(WEB_DIR, "." + url.pathname.slice("/web".length));
        if (target !== WEB_DIR && !target.startsWith(WEB_DIR + path.sep)) return notFound(res);
        return sendFile(res, target);
      }
    }
  }

  /// Resolves the `pkg` query parameter, falling back to the selected package.
  /// A parameter naming a *different* package is honoured — that is what lets
  /// `openSkinWindow` open a second stage — but it is still resolved through
  /// parsePackageDir, so it can only ever name a real package directory.
  async function pkgFor(rel) {
    if (!rel) return pkg;
    if (pkg && rel === pkg.rel) return pkg;
    try {
      return await resolvePackage(path.resolve(REPO_ROOT, rel));
    } catch {
      return null;
    }
  }

  const port = await listen(server, opts);
  const origin = `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${port}`;

  await banner(pkg, origin, opts);

  let stopBuild = () => {};
  if (opts.buildWatch) stopBuild = startBuildWatch(pkg, bus);

  if (opts.open) openBrowser(origin);

  const shutdown = () => {
    stopBuild();
    stopWatching();
    bus.close();
    server.close(() => process.exit(0));
    // A held-open SSE socket would otherwise keep the process alive.
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function describe(pkg) {
  return {
    pkg: pkg.rel,
    id: pkg.id,
    entry: pkg.entry,
    entryPath: path.relative(REPO_ROOT, pkg.entryPath),
    assetRoot: path.relative(REPO_ROOT, pkg.assetRoot) || ".",
    entryExists: pkg.entryExists,
    buildDeclared: !!pkg.build,
    hasStoreJson: !!pkg.store,
    manifest: pkg.manifest,
    hint: buildHint(pkg),
  };
}

function listen(server, opts) {
  return new Promise((resolve, reject) => {
    let port = opts.port;
    let attempts = 0;

    server.on("error", (err) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      if (opts.portPinned) {
        return reject(new Error(`port ${port} is already in use (it was pinned with --port)`));
      }
      if (++attempts > PORT_SCAN) {
        return reject(new Error(`ports ${opts.port}-${opts.port + PORT_SCAN} are all in use`));
      }
      server.listen(++port, opts.host);
    });

    server.on("listening", () => resolve(server.address().port));
    server.listen(port, opts.host);
  });
}

async function banner(pkg, origin, opts) {
  console.log("");
  console.log(`  Amee skin harness   ${origin}`);
  console.log("");

  if (!pkg) {
    console.log("  No package given — pick one in the browser.");
  } else {
    console.log(`  package     ${pkg.rel}`);
    console.log(`  entry       ${path.relative(REPO_ROOT, pkg.entryPath)}`);
    console.log(`  assets      ${path.relative(REPO_ROOT, pkg.assetRoot) || "."}`);
    if (!pkg.store) {
      console.log("");
      console.log("  ! no store.json — fine for previewing, required to publish.");
    }
    const stale = path.join(pkg.dir, "src", "amee-sdk.d.ts");
    if (await exists(stale)) {
      console.log("");
      console.log("  ! this package ships its own src/amee-sdk.d.ts.");
      console.log("    The canonical types live in types/amee-sdk.d.ts — see types/README.md.");
    }
    const hint = buildHint(pkg);
    if (hint) {
      console.log("");
      for (const line of hint.split("\n")) console.log(`  ${line}`);
      console.log("");
      console.log("  Serving anyway — the page picks it up as soon as the file appears.");
    }
  }

  if (opts.host === "0.0.0.0") {
    console.log("");
    console.log("  ! bound to 0.0.0.0: every file in the package directory is readable");
    console.log("    by anything on your network, as data: URIs. Use 127.0.0.1 unless");
    console.log("    you specifically need another device to reach this.");
  }
  console.log("");
}

/// Runs the package's own `dev` script and streams it into the harness.
///
/// Opt-in via --build-watch and decided before the socket binds, so nothing
/// reachable over HTTP can ever cause a process to be spawned. What the script
/// does is arbitrary, which is the same trust assumption `tools/build.mjs`
/// already makes about a package's declared build — but there it is a CI job
/// with a read-only token, and here it is your laptop, so it stays opt-in.
function startBuildWatch(pkg, bus) {
  if (!pkg) {
    console.warn("! --build-watch needs a package directory; ignoring it.");
    return () => {};
  }
  if (!pkg.build) {
    console.warn(`! ${pkg.rel} declares no build in store.json; ignoring --build-watch.`);
    return () => {};
  }

  const pm = pkg.build.packageManager ?? "npm";
  const script = "dev";
  console.log(`  running \`${pm} run ${script}\` in ${pkg.rel}`);
  console.log("");

  const child = spawn(pm, ["run", script], {
    cwd: pkg.dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  const pipe = (stream, level) => {
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        console.log(`  [${pm}] ${line}`);
        bus.send({ type: "build-log", level, line });
      }
    });
  };
  pipe(child.stdout, "info");
  pipe(child.stderr, "error");

  child.on("error", (err) => {
    console.warn(`! could not run \`${pm} run ${script}\`: ${err.message}`);
    bus.send({ type: "build-log", level: "error", line: err.message });
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      bus.send({ type: "build-log", level: "error", line: `${pm} run ${script} exited ${code}` });
    }
  });

  return () => child.kill();
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // No browser to open is not a reason to fail; the URL is on stdout.
  }
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function sendFile(res, file, contentType) {
  let body;
  try {
    body = await fs.readFile(file);
  } catch {
    return notFound(res);
  }
  res.writeHead(200, {
    "Content-Type": contentType ?? harnessMime(file),
    // Every response is uncached. The harness is a dev tool whose entire job is
    // to show you the file you just saved.
    "Cache-Control": "no-store",
    "Content-Length": body.length,
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("not found\n");
}

// Only start a server when run directly, so importing this file (for a test, or
// from a future wrapper) can never bind a port as a side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
