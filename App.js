import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ImageBackground, Linking, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { client, discover } from './clientProtocol';

const storageKey = 'rd_client_device_v1';
const types = { 1: 'Światło', 2: 'Mgła', 3: 'Pompa' };
const icons = [
  require('./assets/neurony/swiatlo.jpg'), require('./assets/neurony/kropla.jpg'),
  require('./assets/neurony/wodospad.jpg'), require('./assets/neurony/rzeka.jpg'),
  require('./assets/neurony/deszcz.jpg'), require('./assets/neurony/mgla.jpg'),
];
const themes = [
  require('./assets/motywy/fiolet.jpg'), require('./assets/motywy/las.jpg'),
  require('./assets/motywy/kosmos.jpg'),
];
const toTime = minutes => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
  String(minutes % 60).padStart(2, '0');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function Button({ title, onPress, disabled }) {
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button"
    style={[styles.button, disabled && { opacity: 0.45 }]}>
    <Text style={styles.buttonText}>{title}</Text>
  </Pressable>;
}

function Field({ label, value, onChangeText, password, maxLength }) {
  return <View>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} value={value}
      onChangeText={onChangeText} secureTextEntry={password} maxLength={maxLength}
      autoCapitalize="none" autoCorrect={false} />
  </View>;
}

function Slider({ value, disabled, save }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const [width, setWidth] = useState(0);
  const position = event => Math.max(0, Math.min(100,
    Math.round(100 * event.nativeEvent.locationX / Math.max(width, 1))));
  return <View>
    <Text style={styles.label}>Moc · {draft}%</Text>
    <View style={styles.track} onLayout={event => setWidth(event.nativeEvent.layout.width)}
      accessible accessibilityRole="adjustable" accessibilityLabel="Moc"
      accessibilityValue={{ min: 0, max: 100, now: draft }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        if (!disabled) save(Math.max(0, Math.min(100, draft +
          (event.nativeEvent.actionName === 'increment' ? 5 : -5))));
      }}
      onStartShouldSetResponder={() => !disabled} onResponderGrant={event => setDraft(position(event))}
      onResponderMove={event => setDraft(position(event))}
      onResponderTerminate={() => setDraft(value)}
      onResponderRelease={event => {
        const next = position(event);
        setDraft(next);
        save(next);
      }}>
      <View pointerEvents="none" style={[styles.fill, { width: draft + '%' }]} />
    </View>
  </View>;
}

function Channel({ channel, api, run, busy }) {
  const { ch, type } = channel;
  const [name, setName] = useState(channel.name);
  const [expanded, setExpanded] = useState(false);
  const [slots, setSlots] = useState([]);
  const [light, setLight] = useState([]);
  function open() {
    setName(channel.name);
    setSlots(channel.slots.map(slot => ({
      from: toTime(slot.from), to: toTime(slot.to), power: String(slot.power),
    })));
    setLight([channel.dawnFrom, channel.dawnTo, channel.duskFrom, channel.duskTo].map(toTime));
    setExpanded(!expanded);
  }
  return <View style={styles.card}>
    <Text style={styles.heading}>{channel.name || types[type]}</Text>
    <View style={styles.row}>
      {['Wyłącz', 'Auto', 'Włącz'].map((label, mode) => <Button key={label}
        title={(channel.mode === mode ? '✓ ' : '') + label} disabled={busy}
        onPress={() => run(() => api.command('mode', ch, mode))} />)}
    </View>
    {type !== 2 && <Slider value={channel.power} disabled={busy}
      save={value => run(() => api.command('power', ch, value))} />}
    <Button title={expanded ? 'Zwiń ustawienia' : 'Nazwa, ikona i harmonogram'} onPress={open} />
    {expanded && <>
      <Field label="Nazwa" value={name} onChangeText={setName} maxLength={48} />
      <Button title="Zapisz nazwę" disabled={busy || !name.trim()}
        onPress={() => run(() => api.rename(ch, name.trim()))} />
      <Text style={styles.label}>Ikona</Text>
      <View style={styles.row}>
        {icons.map((source, id) => <Pressable key={id} disabled={busy}
          accessibilityRole="button" accessibilityLabel={'Ikona ' + (id + 1)}
          accessibilityState={{ selected: channel.icon === id }}
          onPress={() => run(() => api.icon(ch, id))}>
          <ImageBackground source={source} style={[styles.icon, channel.icon === id && styles.selected]} />
        </Pressable>)}
      </View>
      {type === 1 ? <>
        {['Początek świtu', 'Koniec świtu', 'Początek zmierzchu', 'Koniec zmierzchu'].map((label, index) =>
          <Field key={label} label={label} value={light[index]} maxLength={5}
            onChangeText={value => setLight(current => current.map((item, i) => i === index ? value : item))} />)}
        <Button title="Zapisz świt i zmierzch" disabled={busy}
          onPress={() => run(() => api.command('light', ch, light.join('|')))} />
      </> : <>
        {slots.map((slot, index) => <View key={index} style={styles.card}>
          {['from', 'to', ...(type === 3 ? ['power'] : [])].map((key, position) =>
            <Field key={key} label={['Od (GG:MM)', 'Do (GG:MM)', 'Moc (%)'][position]}
              value={slot[key]} maxLength={key === 'power' ? 3 : 5}
              onChangeText={value => setSlots(items => items.map((item, i) =>
                i === index ? { ...item, [key]: value } : item))} />)}
          <Button title="Usuń godzinę" onPress={() => setSlots(items => items.filter((_, i) => i !== index))} />
        </View>)}
        <Button title="Dodaj godzinę" disabled={slots.length >= 24}
          onPress={() => setSlots(items => [...items, { from: '08:00', to: '09:00', power: '100' }])} />
        <Button title="Zapisz harmonogram" disabled={busy} onPress={() =>
          run(() => api.command('slots', ch, slots.map(slot =>
            [slot.from, slot.to, type === 2 ? '100' : slot.power].join('|')).join(';')))} />
      </>}
    </>}
  </View>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState(0);
  const [section, setSection] = useState('');
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [networks, setNetworks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const saveSession = (device, ownerKey) =>
    SecureStore.setItemAsync(storageKey, JSON.stringify({ device, ownerKey }));
  async function run(task, success = '') {
    setBusy(true);
    setMessage('');
    try {
      const result = await task();
      if (Array.isArray(result?.channels)) {
        setState(result);
        setTitle(result.name);
      }
      setMessage(success);
    } catch (error) {
      setMessage(error.message || 'Nie udało się wykonać polecenia.');
    } finally {
      setBusy(false);
    }
  }

  async function connect(credentials) {
    const stored = await SecureStore.getItemAsync(storageKey);
    const previous = stored ? JSON.parse(stored) : null;
    if (!credentials && !previous) return;
    const local = await Network.getIpAddressAsync();
    const device = await discover(local, previous?.device.host, previous?.device.deviceId);
    if (!device) throw new Error('Nie znaleziono słoja. Połącz telefon z jego Wi-Fi lub z tą samą siecią domową.');
    if (!device.ready) throw new Error('Słój wymaga konfiguracji przez producenta.');
    const api = client(device, previous?.ownerKey);
    const ownerKey = credentials ? await api.pair(credentials.login, credentials.password) : previous.ownerKey;
    const current = await api.state();
    await saveSession(device, ownerKey);
    setSession({ device, api });
    setPassword('');
    return current;
  }
  useEffect(() => { run(() => connect()); }, []);

  function openSection(next) {
    setSection(section === next ? '' : next);
    if (next === 'wifi' && section !== next) {
      run(async () => {
        for (let attempt = 0; attempt < 18; attempt++) {
          const result = await session.api.scan();
          if (result.status === 'done') { setNetworks(result.networks); return; }
          await wait(800);
        }
        throw new Error('Skanowanie trwa zbyt długo. Możesz wpisać nazwę sieci.');
      });
    }
  }

  return <ImageBackground source={themes[theme]} style={styles.background}>
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{state?.name || 'Runiczny Duch Klient'}</Text>
        {busy && <ActivityIndicator color="#d8bdff" />}
        {!!message && <Text accessibilityRole="alert" style={styles.status}>{message}</Text>}
        {!session ? <View style={styles.card}>
          <Field label="Login klienta" value={login} onChangeText={setLogin} />
          <Field label="Hasło klienta" value={password} onChangeText={setPassword} password />
          <Button title="Zaloguj" disabled={busy || !login || !password}
            onPress={() => run(() => connect({ login, password }))} />
          <Button title="Ustawienia Wi-Fi telefonu" onPress={() => Linking.sendIntent('android.settings.WIFI_SETTINGS')} />
        </View> : <>
          <View style={styles.row}>
            <Button title="Wi-Fi" disabled={busy} onPress={() => openSection('wifi')} />
            <Button title="Aktualizacje" disabled={busy} onPress={() => openSection('updates')} />
            <Button title="Motyw" onPress={() => setTheme(value => (value + 1) % themes.length)} />
            <Button title="Odśwież" disabled={busy} onPress={() => run(() => connect())} />
          </View>
          {section === 'wifi' && <View style={styles.card}>
            {networks.map((network, index) => <Button key={network.ssid + index}
              title={network.ssid + ' · ' + network.rssi + ' dBm'} onPress={() => setSsid(network.ssid)} />)}
            <Field label="Sieć Wi-Fi" value={ssid} onChangeText={setSsid} />
            <Field label="Hasło Wi-Fi" value={wifiPassword} onChangeText={setWifiPassword} password />
            <Button title="Zapisz i połącz" disabled={busy || !ssid || wifiPassword.length < 8}
              onPress={() => run(async () => {
                await session.api.wifi(ssid, wifiPassword);
                setWifiPassword('');
              }, 'ESP zmienia sieć. Połącz telefon z wybraną siecią i wybierz Odśwież.')} />
          </View>}
          {section === 'updates' && <View style={styles.card}>
            <Text style={styles.label}>Instalowanie aktualizacji przez klienta jest jeszcze niedostępne w tej wersji testowej.</Text>
            <Field label="Nowy login" value={login} onChangeText={setLogin} maxLength={32} />
            <Field label="Nowe hasło" value={password} onChangeText={setPassword} password maxLength={63} />
            <Button title="Zmień login i hasło" disabled={busy || !/^[A-Za-z0-9_.-]{3,32}$/.test(login) || password.length < 8}
              onPress={() => run(async () => {
                const ownerKey = await session.api.account(login, password);
                await saveSession(session.device, ownerKey);
                setPassword('');
              }, 'Zapisano nowe dane klienta.')} />
          </View>}
          <View style={styles.card}>
            <Field label="Nazwa słoja" value={title} onChangeText={setTitle} maxLength={64} />
            <Button title="Zapisz nazwę słoja" disabled={busy || !title.trim()}
              onPress={() => run(() => session.api.name(title.trim()))} />
          </View>
          {state?.channels.filter(channel => types[channel.type]).map(channel =>
            <Channel key={channel.ch} channel={channel} api={session.api} run={run} busy={busy} />)}
        </>}
      </ScrollView>
    </SafeAreaView>
  </ImageBackground>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#26133a' },
  screen: { flex: 1, backgroundColor: '#170d29c9' },
  body: { padding: 18, paddingTop: 45, gap: 12 },
  title: { color: '#f5ebff', fontSize: 28, fontWeight: '700' },
  heading: { color: '#f5ebff', fontSize: 20, fontWeight: '700' },
  card: { backgroundColor: '#25173beb', padding: 13, borderRadius: 14, gap: 9 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: { backgroundColor: '#663aa0', borderRadius: 8, padding: 10 },
  buttonText: { color: '#fff', fontWeight: '600' },
  label: { color: '#eadcff', marginBottom: 5 },
  input: { backgroundColor: '#170f24', color: '#fff', padding: 9, borderRadius: 8 },
  status: { color: '#f2dbff', backgroundColor: '#382259', borderRadius: 8, padding: 9 },
  track: { height: 28, borderRadius: 14, backgroundColor: '#4b3561', overflow: 'hidden' },
  fill: { height: 28, backgroundColor: '#b384f4', borderRadius: 14 },
  icon: { width: 42, height: 42, borderRadius: 7, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  selected: { borderColor: '#e7c5ff' },
});
