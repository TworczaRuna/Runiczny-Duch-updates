import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { client, discover } from './clientProtocol';
import { clientPanelRequest } from './panelBridge';
import originalClientPanel from './originalClientPanel';
import { buildWebAppearance } from './themeEngine';

const storageKey = 'rd_client_device_v1';
const appearanceKey = 'rd_client_appearance_v1';
const themes = ['cosmos', 'forest', 'violet'];
const origin = 'https://panel.runicznyduch.invalid/';

function Button({ title, onPress, disabled }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={[styles.button, disabled && { opacity: .45 }]}>
    <Text style={styles.text}>{title}</Text>
  </Pressable>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [theme, setTheme] = useState('cosmos');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const web = useRef(null);
  const page = useRef(0);

  const saveOwnerKey = (device, ownerKey) =>
    SecureStore.setItemAsync(storageKey, JSON.stringify({ device, ownerKey }));

  async function connect(credentials) {
    setBusy(true);
    setMessage('');
    try {
      const stored = await SecureStore.getItemAsync(storageKey);
      const previous = stored ? JSON.parse(stored) : null;
      if (!credentials && !previous) return;
      const local = await Network.getIpAddressAsync();
      const device = await discover(local, previous?.device.host, previous?.device.deviceId);
      if (!device) throw new Error('Nie znaleziono słoja. Połącz telefon z jego siecią Wi-Fi lub tą samą siecią domową.');
      if (!device.ready) throw new Error('Słój wymaga konfiguracji przez producenta.');
      const api = client(device, previous?.ownerKey);
      const ownerKey = credentials ? await api.pair(credentials.login, credentials.password) : previous.ownerKey;
      const state = await api.state();
      if (state.deviceId !== device.deviceId || !Array.isArray(state.channels) || state.channels.length !== 5) {
        throw new Error('ESP02 nie odesłał stanu kanałów.');
      }
      await saveOwnerKey(device, ownerKey);
      page.current += 1;
      setSession({ device, api, saveOwnerKey });
      setPassword('');
    } catch (error) {
      setMessage(error.message || 'Nie udało się połączyć z ESP02.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    SecureStore.getItemAsync(appearanceKey).then(value => {
      if (themes.includes(value)) setTheme(value);
    }).catch(() => {});
    connect();
  }, []);

  async function onMessage(event) {
    let request;
    try { request = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!Number.isInteger(request?.id) || typeof request.url !== 'string' || !session) return;
    const generation = page.current;
    const reply = { id: request.id };
    try {
      reply.data = await clientPanelRequest(session, request.url, request.params);
    } catch (error) {
      reply.error = error.message || 'ESP02 nie wykonał polecenia.';
    }
    if (page.current !== generation) return;
    const encoded = JSON.stringify(reply);
    web.current?.injectJavaScript('window.rdClientReply(' + encoded + ');true;');
  }

  function cycleTheme() {
    const next = themes[(themes.indexOf(theme) + 1) % themes.length];
    page.current += 1;
    setTheme(next);
    SecureStore.setItemAsync(appearanceKey, next).catch(() => {});
  }

  return <SafeAreaView style={styles.screen}>
    {session && <View style={styles.bar}>
      <Text style={styles.heading}>Runiczny Duch</Text>
      <View style={styles.actions}>
        <Button title="Motyw" onPress={cycleTheme} disabled={busy} />
        <Button title="↻" onPress={() => connect()} disabled={busy} />
      </View>
    </View>}
    {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    {busy && <ActivityIndicator color="#a7e8e3" />}
    {session ? <WebView key={theme + ':' + page.current} ref={web}
      source={{ html: originalClientPanel, baseUrl: origin }}
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === origin}
      injectedJavaScript={buildWebAppearance(theme, 'pl')}
      onMessage={onMessage} style={styles.web} /> : <View style={styles.card}>
      <Text style={styles.heading}>Runiczny Duch Klient</Text>
      <Text style={styles.text}>Login klienta</Text>
      <TextInput accessibilityLabel="Login klienta" style={styles.input} value={login}
        onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.text}>Hasło klienta</Text>
      <TextInput accessibilityLabel="Hasło klienta" style={styles.input} value={password}
        onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Button title="Połącz ze słojem" disabled={busy || !login || !password}
        onPress={() => connect({ login, password })} />
      <Button title="Ustawienia Wi-Fi telefonu" onPress={() => Linking.sendIntent('android.settings.WIFI_SETTINGS')} />
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07111d', paddingTop: 25 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10 },
  actions: { flexDirection: 'row', gap: 6 },
  web: { flex: 1, backgroundColor: '#07111d' },
  card: { margin: 16, padding: 16, gap: 9, borderRadius: 12, backgroundColor: '#122333' },
  heading: { fontSize: 20, fontWeight: '700', color: '#f2dbab' },
  text: { color: '#e0f7fa', fontWeight: '600' },
  input: { backgroundColor: '#07111d', color: '#fff', padding: 10, borderRadius: 8 },
  button: { borderRadius: 8, borderWidth: 1, borderColor: '#4e8b92', backgroundColor: '#193849', padding: 9 },
  message: { color: '#ffd1d1', padding: 10 },
});
