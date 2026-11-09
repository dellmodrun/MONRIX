import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pages = ['/', '/guide.html', '/app.html', '/terminal.html', '/download.html', '/privacy.html', '/vault.html', '/exchange.html', '/agent.html', '/network.html'];
const tabs = await fetch('http://127.0.0.1:9333/json').then((response) => response.json());
const tab = tabs.find((item) => item.type === 'page');
if (!tab) throw new Error('No Chrome debugging tab is available');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const call = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});

await call('Page.enable');
await call('Runtime.enable');
const results = [];
for (const path of pages) {
  await call('Page.navigate', { url: `http://127.0.0.1:4391${path}` });
  await new Promise((resolve) => setTimeout(resolve, path === '/app.html' ? 5000 : 2500));
  const evaluated = await call('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      bodyLength: document.body?.innerText?.length || 0,
      scripts: document.scripts.length,
      brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src),
      hasHeader: Boolean(document.querySelector('#header')),
      hasFooter: Boolean(document.querySelector('#footer'))
    })`,
    returnByValue: true,
  });
  results.push(JSON.parse(evaluated.result.result.value));
  if (path === '/') {
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(tmpdir(), 'moneyero-local-home.png'), Buffer.from(screenshot.result.data, 'base64'));
  }
}
socket.close();
console.log(JSON.stringify(results, null, 2));
