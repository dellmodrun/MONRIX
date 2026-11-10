const targetUrl = process.env.MONRIX_URL || 'http://127.0.0.1:4391/app.html';
const walletType = process.env.MONRIX_WALLET || 'phantom';
const tabs = await fetch('http://127.0.0.1:9333/json').then((response) => response.json());
const tab = tabs.find((item) => item.type === 'page');
if (!tab) throw new Error('No Chrome debugging tab is available');

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

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
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    const walletType = ${JSON.stringify(walletType)};
    window.__walletConnectCalls = 0;
    window.__walletSignCalls = 0;
    const key = { toString: () => '11111111111111111111111111111111' };
    const provider = {
      isPhantom: walletType === 'phantom',
      isSolflare: walletType === 'solflare',
      isBackpack: walletType === 'backpack',
      isCoinbaseWallet: walletType === 'coinbase',
      publicKey: null,
      connect: async function () {
        window.__walletConnectCalls += 1;
        this.publicKey = key;
        return { publicKey: key };
      },
      signTransaction: async function (transaction) {
        window.__walletSignCalls += 1;
        return transaction;
      },
      disconnect: async function () {
        this.publicKey = null;
      }
    };
    if (walletType === 'phantom') Object.defineProperty(window, 'phantom', { configurable: true, value: { solana: provider } });
    if (walletType === 'solflare') Object.defineProperty(window, 'solflare', { configurable: true, value: provider });
    if (walletType === 'backpack') Object.defineProperty(window, 'backpack', { configurable: true, value: { solana: provider } });
    if (walletType === 'coinbase') Object.defineProperty(window, 'coinbaseSolana', { configurable: true, value: provider });
  `,
});
await call('Page.navigate', { url: `${targetUrl}?wallet-qa=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 6000));

const before = await call('Runtime.evaluate', {
  expression: `JSON.stringify({
    button: [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'connect wallet')?.textContent.trim() || null,
    installButton: [...document.querySelectorAll('button')].some((item) => item.textContent.trim() === 'install wallet'),
    installDisabled: [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'install wallet')?.disabled ?? null,
    buttonTexts: [...document.querySelectorAll('button')].map((item) => item.textContent.trim()),
    injected: Boolean(window.phantom?.solana)
  })`,
  returnByValue: true,
});
const beforeState = JSON.parse(before.result.result.value);
if (walletType === 'none') {
  socket.close();
  if (!beforeState.installButton || beforeState.installDisabled) {
    throw new Error(`No-wallet fallback is not usable: ${JSON.stringify(beforeState)}`);
  }
  console.log(JSON.stringify({ ok: true, provider: 'none', fallback: 'enabled install wallet button' }, null, 2));
  process.exit(0);
}
if (beforeState.button !== 'connect wallet' || beforeState.installButton) {
  throw new Error(`Injected wallet was not detected: ${JSON.stringify(beforeState)}`);
}

await call('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'connect wallet').click()`,
});
await new Promise((resolve) => setTimeout(resolve, 2500));

const after = await call('Runtime.evaluate', {
  expression: `JSON.stringify({
    connectCalls: window.__walletConnectCalls,
    connected: document.body.innerText.includes('1111'),
    disconnectButton: [...document.querySelectorAll('button')].some((item) => item.textContent.trim() === 'disconnect'),
    legacyInstallPrompt: /install phantom to trade/i.test(document.body.innerText)
  })`,
  returnByValue: true,
});
const result = JSON.parse(after.result.result.value);
socket.close();

if (result.connectCalls !== 1 || !result.connected || !result.disconnectButton || result.legacyInstallPrompt) {
  throw new Error(`Wallet QA failed: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify({ ok: true, provider: `simulated ${walletType} injection`, ...result }, null, 2));

