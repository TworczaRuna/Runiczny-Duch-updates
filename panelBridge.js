export async function clientPanelRequest({ api, device, saveOwnerKey }, route, data = {}) {
  const { ch, name, icon, mode, value } = data;
  let result;
  switch (route) {
    case '/api/state': result = await api.state(); break;
    case '/api/esp-name': result = await api.name(name); break;
    case '/api/rename': result = await api.rename(ch, name); break;
    case '/api/icon': result = await api.icon(ch, icon); break;
    case '/api/mode': result = await api.command('mode', ch, mode); break;
    case '/api/power': result = await api.command('power', ch, value); break;
    case '/api/slots': result = await api.command('slots', ch, data.rows); break;
    case '/api/light':
      result = await api.command('light', ch,
        [data.dawnFrom, data.dawnTo, data.duskFrom, data.duskTo].join('|'));
      break;
    case '/api/time': result = await api.command('time', 0, data.epoch); break;
    case '/api/wifi-scan': return api.scan();
    case '/api/wifi': return api.wifi(data.ssid, data.pwd);
    case '/client-account':
      await saveOwnerKey(device, await api.account(data.user, data.password));
      return { ok: true };
    default: throw new Error('Ta funkcja wymaga trybu producenta.');
  }
  const homeNetwork = device.host !== '192.168.4.1';
  return {
    ...result,
    espName: result.name,
    sta: homeNetwork,
    activeSsid: homeNetwork ? 'Wi-Fi domowe' : 'Wi-Fi słoja',
    clock: result.clockValid ? 'Zsynchronizowano' : '',
    build: device.firmware,
    otaSupported: false,
    channels: result.channels.map(channel => ({
      ...channel, pwm: channel.type === 1 || channel.type === 3,
    })),
  };
}
