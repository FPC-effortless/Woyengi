import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const browserPath = browserExecutable();
const appPort = 43817;
const debugPort = 43818;
const baseUrl = `http://127.0.0.1:${appPort}`;
const profile = await mkdtemp(join(tmpdir(), "woyengi-shell-qa-"));
const outputRoot = process.env.WOYENGI_VISUAL_UPDATE === "1"
  ? new URL("../artifacts/", import.meta.url)
  : pathToFileURL(`${join(profile, "artifacts")}${sep}`);
const app = spawn(process.execPath, [fileURLToPath(new URL("../src/demo.ts", import.meta.url))], {
  env: { ...process.env, WOYENGI_SHELL_PORT: String(appPort) },
  stdio: ["ignore", "pipe", "pipe"],
});
const appDiagnostics = captureProcessOutput(app);
let browser;

try {
  await waitForHttp(baseUrl, { process: app, diagnostics: appDiagnostics, timeoutMs: 30_000 });
  const browserArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-sync",
    "--no-first-run",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "about:blank",
  ];
  // Hosted CI is an isolated ephemeral test runner. Chrome's Linux sandbox can
  // itself stall during extreme node:test process contention, before CDP binds.
  // Disable it only there; local visual QA keeps the browser's normal sandbox.
  if (process.env.CI === "true") browserArgs.splice(1, 0, "--no-sandbox", "--disable-setuid-sandbox");
  browser = spawn(browserPath, browserArgs, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const browserDiagnostics = captureProcessOutput(browser);
  const browserError = new Promise((_, reject) => browser.once("error", reject));
  await Promise.race([
    waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, {
      process: browser,
      diagnostics: browserDiagnostics,
      timeoutMs: 60_000,
    }),
    browserError,
  ]);
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(baseUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const critical = [];
  cdp.on("Runtime.exceptionThrown", (event) => critical.push(`exception: ${event.exceptionDetails?.text ?? "unknown"}`));
  cdp.on("Runtime.consoleAPICalled", (event) => { if (event.type === "error") critical.push(`console: ${event.args?.[0]?.value ?? "error"}`); });
  cdp.on("Log.entryAdded", (event) => { if (event.entry?.level === "error") critical.push(`log: ${event.entry.text}`); });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Accessibility.enable");
  await cdp.send("Page.navigate", { url: baseUrl });
  await delay(750);
  await mkdir(outputRoot, { recursive: true });

  const scenarios = [
    { name: "shell-1280-light.png", width: 1280, height: 900, theme: "light" },
    { name: "shell-375-light.png", width: 375, height: 812, theme: "light" },
    { name: "shell-1280-dark.png", width: 1280, height: 900, theme: "dark" },
    { name: "shell-375-dark.png", width: 375, height: 812, theme: "dark" },
  ];

  for (const scenario of scenarios) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: scenario.width < 600 });
    await cdp.send("Runtime.evaluate", { expression: `document.documentElement.dataset.theme=${JSON.stringify(scenario.theme)};localStorage.setItem('woyengi-shell-theme',${JSON.stringify(scenario.theme)})` });
    await delay(250);
    const state = await evaluate(cdp, `({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,inspectHidden:document.querySelector('[data-inspect-panel]').hidden,primary:[...document.querySelectorAll('nav[aria-label="Primary"] a')].map(a=>a.textContent.trim()),title:document.title})`);
    assert.equal(state.viewport, scenario.width);
    assert.ok(state.documentWidth <= scenario.width, `${scenario.name} overflows horizontally: ${state.documentWidth}px`);
    assert.equal(state.inspectHidden, true, `${scenario.name} exposes inspect mode by default`);
    assert.deepEqual(state.primary.map((label) => label.replace(/\d+$|⌘ K$/g, "").trim()), ["⌂Home", "◫Work", "◇Apps", "○Inbox", "⌕Search"]);
    assert.match(state.title, /Woyengi/);

    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(new URL(scenario.name, outputRoot), Buffer.from(screenshot.data, "base64"));
  }

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft" });
  assert.equal(await evaluate(cdp, "document.activeElement?.id"), "intent-input", "Ctrl+K must focus the universal intent bar");

  const axTree = await cdp.send("Accessibility.getFullAXTree");
  const interactive = new Set(["button", "link", "combobox", "textbox"]);
  const unnamed = axTree.nodes.filter((node) => interactive.has(node.role?.value) && !(node.name?.value ?? "").trim());
  assert.equal(unnamed.length, 0, `unnamed interactive accessibility nodes: ${unnamed.map((node) => node.nodeId).join(", ")}`);
  assert.deepEqual(critical, [], `critical browser errors: ${critical.join("; ")}`);
  cdp.close();
  console.log(`Visual QA passed: ${scenarios.map((scenario) => new URL(scenario.name, outputRoot).pathname).join(", ")}`);
} finally {
  app.kill();
  browser?.kill();
  await delay(400);
  try { await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } catch (error) { console.warn(`Temporary browser profile cleanup deferred: ${error.message}`); }
}

function browserExecutable() {
  const configured = process.env.WOYENGI_BROWSER?.trim();
  if (configured) return configured;

  const candidates = process.platform === "win32"
    ? [
        process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge",
          "/usr/bin/microsoft-edge-stable",
          "/snap/bin/chromium",
        ];
  const found = candidates.filter(Boolean).find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error("No Chromium-family browser was found. Set WOYENGI_BROWSER to its executable.");
  }
  return found;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function captureProcessOutput(child) {
  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
    if (output.length > 16_384) output = output.slice(-16_384);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output.trim();
}

async function waitForHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const delayMs = options.delayMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (options.process?.exitCode !== null && options.process?.exitCode !== undefined) {
      const diagnostics = options.diagnostics?.();
      throw new Error(`Process exited with code ${options.process.exitCode} before ${url} became ready${diagnostics ? `\n${diagnostics}` : ""}`);
    }
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(delayMs);
  }
  const diagnostics = options.diagnostics?.();
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}${diagnostics ? `\nProcess diagnostics:\n${diagnostics}` : ""}`);
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return createCdp(socket);
}

function createCdp(socket) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (message) => {
    const value = JSON.parse(message.data);
    if (value.id !== undefined) {
      const request = pending.get(value.id);
      if (!request) return;
      pending.delete(value.id);
      value.error ? request.reject(new Error(value.error.message)) : request.resolve(value.result);
      return;
    }
    for (const listener of listeners.get(value.method) ?? []) listener(value.params ?? {});
  });
  return {
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? [];
      methodListeners.push(listener);
      listeners.set(method, methodListeners);
    },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}
