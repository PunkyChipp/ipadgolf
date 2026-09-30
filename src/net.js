// Online play between two devices on any networks. Both devices connect to
// free public MQTT brokers over secure WebSockets and exchange small JSON
// messages on a topic named after the 4-letter game code. Two brokers are used
// at once so the game keeps working if one is down; duplicates are dropped.

const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const TOPIC = 'pocketlinks/v1/';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function cleanCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

let libPromise = null;
function loadLib() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/mqtt.min.js', import.meta.url).href;
      s.onload = () => (window.mqtt ? resolve(window.mqtt) : reject(new Error('mqtt missing')));
      s.onerror = () => {
        libPromise = null;
        reject(new Error('Could not load the online library'));
      };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

export class Link {
  constructor(code, { id, version = 0, onMessage, onStatus }) {
    this.code = code;
    this.version = version;
    this.id = id || Math.random().toString(36).slice(2, 10);
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.clients = [];
    this.seen = new Set();
    this.seenOrder = [];
    this.connected = 0;
    this.closed = false;
  }

  async connect() {
    const mqtt = await loadLib();
    const override = new URLSearchParams(location.search).get('broker');
    const urls = override ? [override] : BROKERS;
    const topic = TOPIC + this.code;
    this.onStatus?.('connecting');
    for (const url of urls) {
      let client;
      try {
        client = mqtt.connect(url, {
          clientId: 'pl_' + this.id + '_' + Math.random().toString(36).slice(2, 6),
          clean: true,
          keepalive: 20,
          reconnectPeriod: 2500,
          connectTimeout: 8000,
        });
      } catch {
        continue;
      }
      client.isUp = false;
      client.on('connect', () => {
        client.isUp = true;
        client.subscribe(topic, { qos: 1 });
        this.refresh();
      });
      client.on('close', () => {
        client.isUp = false;
        this.refresh();
      });
      client.on('offline', () => {
        client.isUp = false;
        this.refresh();
      });
      client.on('error', () => {});
      client.on('message', (_t, payload) => this.receive(payload));
      this.clients.push(client);
    }
    // Resolve once any broker is up, or fail after a while.
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (this.closed) return reject(new Error('closed'));
        if (this.connected > 0) return resolve();
        if (Date.now() - start > 12000) return reject(new Error('Could not reach the game server. Check the internet connection.'));
        setTimeout(check, 150);
      };
      check();
    });
  }

  refresh() {
    this.connected = this.clients.filter((c) => c.isUp).length;
    this.onStatus?.(this.connected > 0 ? 'online' : 'offline');
  }

  receive(payload) {
    let msg;
    try {
      msg = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (!msg || msg.from === this.id || !msg.mid) return;
    if (this.seen.has(msg.mid)) return;
    this.seen.add(msg.mid);
    this.seenOrder.push(msg.mid);
    if (this.seenOrder.length > 500) this.seen.delete(this.seenOrder.shift());
    this.onMessage?.(msg);
  }

  send(msg) {
    const body = JSON.stringify({ ...msg, pv: this.version, from: this.id, mid: this.id + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
    const topic = TOPIC + this.code;
    let sent = false;
    for (const c of this.clients) {
      if (c.isUp) {
        c.publish(topic, body, { qos: 1 });
        sent = true;
      }
    }
    return sent;
  }

  close() {
    this.closed = true;
    for (const c of this.clients) {
      try {
        c.end(true);
      } catch {}
    }
    this.clients = [];
  }
}
