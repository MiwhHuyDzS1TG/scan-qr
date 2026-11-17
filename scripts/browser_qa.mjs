import { writeFile } from "node:fs/promises";

const list = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = list.find((item) => item.type === "page");
if (!page) throw new Error("No Chrome page target found");
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:8000";
const qaUsername = process.env.QA_USERNAME;
const qaPassword = process.env.QA_PASSWORD;
if (!qaUsername || !qaPassword) throw new Error("QA_USERNAME and QA_PASSWORD are required");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const issues = [];
let scanPostCount = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") issues.push(message.params.exceptionDetails.text);
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") issues.push(message.params.entry.text);
  if (message.method === "Network.requestWillBeSent" && message.params.request.method === "POST" && message.params.request.url.endsWith("/api/scan")) scanPostCount += 1;
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(path) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Network.clearBrowserCookies");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: baseUrl });
await waitFor("document.readyState === 'complete'");
await waitFor("document.querySelector('#login-view') && !document.querySelector('#login-view').hidden");
await screenshot("tests/qa-login-desktop.png");

await evaluate(`(() => {
  document.querySelector('#username').value = ${JSON.stringify(qaUsername)};
  document.querySelector('#password').value = ${JSON.stringify(qaPassword)};
  document.querySelector('#login-form').requestSubmit();
})()`);
await waitFor("document.querySelector('#app-view') && !document.querySelector('#app-view').hidden");
await waitFor("document.querySelectorAll('.member-row').length > 0");
const expectedMemberCount = await evaluate("fetch('/api/members').then(response => response.json()).then(data => data.members.length)");
await waitFor(`document.querySelectorAll('.member-row').length === ${expectedMemberCount}`);
await waitFor("document.querySelector('#system-status')?.innerText.trim() !== 'Đang kiểm tra'");
await screenshot("tests/qa-dashboard-desktop.png");

const desktop = await evaluate(`({
  viewport: [innerWidth, innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  members: document.querySelectorAll('.member-row').length,
  buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).length,
  status: document.querySelector('#system-status')?.innerText.trim()
})`);

await evaluate("document.querySelector('#theme-toggle').click()");
await waitFor("document.documentElement.dataset.theme === 'light'");
await screenshot("tests/qa-dashboard-light.png");
const lightTheme = await evaluate(`({
  theme: document.documentElement.dataset.theme,
  background: getComputedStyle(document.body).backgroundColor,
  text: getComputedStyle(document.body).color
})`);
await evaluate("document.querySelector('#theme-toggle').click()");
await waitFor("document.documentElement.dataset.theme === 'dark'");

await evaluate("document.querySelector('#select-visible').click()");
await waitFor(`document.querySelector('#scan-button').innerText.includes('${expectedMemberCount}')`);
const selectAll = await evaluate(`({
  selected: [...document.querySelectorAll('.member-checkbox')].filter(input => input.checked).length,
  scanLabel: document.querySelector('#scan-button').innerText.trim(),
  aliases: [...document.querySelectorAll('.member-row')].map(row => row.dataset.memberId)
})`);
await evaluate("document.querySelector('#scan-button').click()");
await waitFor("!document.querySelector('#modal-backdrop').hidden");
const confirmation = await evaluate("document.querySelector('#dialog-title').innerText");
await evaluate("document.querySelector('[data-dialog-confirm]').click()");
await waitFor("document.querySelector('#dialog-title')?.innerText.includes('Hoàn tất')");
const processed = await evaluate("document.querySelector('#dialog').innerText.includes('Đã xử lý')");
await screenshot("tests/qa-dashboard-results.png");
await evaluate("document.querySelector('[data-dialog-close]').click()");

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await new Promise((resolve) => setTimeout(resolve, 250));
await screenshot("tests/qa-dashboard-mobile.png");
const mobile = await evaluate(`({
  viewport: [innerWidth, innerHeight],
  scrollWidth: document.documentElement.scrollWidth,
  sidebarHidden: getComputedStyle(document.querySelector('#sidebar')).transform !== 'none',
  visibleRows: document.querySelectorAll('.member-row').length,
  scanLabel: document.querySelector('#scan-button').innerText.trim()
})`);

const responsive = [];
for (const [width, height] of [[1920, 1080], [1366, 768], [768, 900], [390, 844], [320, 700]]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  responsive.push(await evaluate(`({
    viewport: [innerWidth, innerHeight],
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth
  })`));
  if (width === 320) await screenshot("tests/qa-dashboard-mobile-320.png");
}

console.log(JSON.stringify({ expectedMemberCount, desktop, mobile, lightTheme, responsive, selectAll, scanPostCount, confirmation, processed, issues }, null, 2));
socket.close();
