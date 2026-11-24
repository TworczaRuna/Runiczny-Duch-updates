import { sha256Hex } from './sha256';

const bytes = value => Uint8Array.from(unescape(encodeURIComponent(value)), char => char.charCodeAt(0));
const fromHex = hex => Uint8Array.from(hex.match(/../g), part => parseInt(part, 16));
const hex = data => Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');

export function mac(key, message) {
  const secret = fromHex(key);
  const data = bytes(message);
  const inner = new Uint8Array(64 + data.length).fill(0x36, 0, 64);
  const outer = new Uint8Array(96).fill(0x5c, 0, 64);
  secret.forEach((byte, index) => {
    inner[index] ^= byte;
    outer[index] ^= byte;
  });
  inner.set(data, 64);
  outer.set(fromHex(sha256Hex(inner)), 64);
  return sha256Hex(outer);
}

const accountKey = (id, login, password) =>
  sha256Hex(bytes(['RD-CLIENT-LOGIN-V1', id, login, password].join('\n')));

async function request(host, route, fields, headers, timeout = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch('http://' + host + '/client/' + route, {
      method: fields ? 'POST' : 'GET',
      headers: {
        ...headers,
        ...(fields && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      body: fields && Object.entries(fields).map(([key, value]) =>
        encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&'),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'ESP: HTTP ' + response.status);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function discover(localAddress, savedHost, expectedId) {
  const probe = async host => {
    try {
      const info = await request(host, 'info', null, {}, 700);
      if (typeof info.deviceId === 'string' && typeof info.ready === 'boolean' &&
          (!expectedId || info.deviceId === expectedId)) return { host, ...info };
    } catch {}
    return null;
  };
  for (const host of [...new Set([savedHost, '192.168.4.1'].filter(Boolean))]) {
    const result = await probe(host);
    if (result) return result;
  }
  if (!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(localAddress)) return null;
  const prefix = localAddress.split('.').slice(0, 3).join('.');
  const candidates = Array.from({ length: 254 }, (_, index) => prefix + '.' + (index + 1));
  let foundDevice = null;
  for (let index = 0; index < candidates.length; index += 24) {
    const found = (await Promise.all(candidates.slice(index, index + 24).map(probe))).filter(Boolean);
    for (const device of found) {
      if (foundDevice && foundDevice.deviceId !== device.deviceId) {
        throw new Error('Znaleziono kilka słojów. Połącz telefon z Wi-Fi swojego słoja.');
      }
      if (expectedId) return device;
      foundDevice = device;
    }
  }
  return foundDevice;
}

export function client(device, initialOwnerKey) {
  const { host, deviceId } = device;
  let ownerKey = initialOwnerKey;
  let pending = Promise.resolve();
  function sequential(task) {
    const next = pending.then(task);
    pending = next.catch(() => {});
    return next;
  }
  async function challenge() {
    const result = await request(host, 'challenge');
    if (result.deviceId !== deviceId || !/^[a-f0-9]{32}$/.test(result.nonce)) {
      throw new Error('ESP odpowiedział nieprawidłowym identyfikatorem.');
    }
    return result.nonce;
  }
  function send(route, message, fields) {
    return sequential(async () => {
      const nonce = await challenge();
      return request(host, route, fields, {
        'X-RD-Nonce': nonce,
        'X-RD-Proof': mac(ownerKey, nonce + '\n' + message),
      });
    });
  }
  return {
    pair: (login, password) => sequential(async () => {
      const nonce = await challenge();
      const key = accountKey(deviceId, login, password);
      await request(host, 'pair', { nonce, user: login, proof: mac(key, nonce + '\npair\n' + deviceId) });
      ownerKey = mac(key, 'owner|' + deviceId);
      return ownerKey;
    }),
    state: () => send('state', 'state'),
    command: (op, ch, value) => send('cmd', [op, ch, value].join('\n'), { op, ch, value }),
    rename: (ch, name) => send('rename', ['rename', ch, name].join('\n'), { ch, name }),
    icon: (ch, icon) => send('icon', ['icon', ch, icon].join('\n'), { ch, icon }),
    name: name => send('esp-name', 'esp-name\n' + name, { name }),
    scan: () => send('wifi-scan', 'wifi-scan'),
    wifi: (ssid, pass) => send('wifi', ['wifi', ssid, pass].join('\n'), { ssid, pass }),
    account: (user, password) => sequential(async () => {
      const nonce = await challenge();
      const key = accountKey(deviceId, user, password);
      const raw = fromHex(key);
      const mask = fromHex(mac(ownerKey, nonce + '\naccount-mask\n' + user));
      const auth = hex(raw.map((byte, index) => byte ^ mask[index]));
      await request(host, 'account', { user, auth }, {
        'X-RD-Nonce': nonce,
        'X-RD-Proof': mac(ownerKey, [nonce, 'account', user, auth].join('\n')),
      });
      ownerKey = mac(key, 'owner|' + deviceId);
      return ownerKey;
    }),
  };
}
