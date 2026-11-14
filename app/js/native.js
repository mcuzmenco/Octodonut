// Native Android features, available when the app runs inside the Capacitor shell.
// On the website `isNative` is false and every function is a harmless no-op,
// so the same code runs in both places.

const cx = globalThis.capacitorExports;
export const isNative = Boolean(cx?.Capacitor?.isNativePlatform?.());

const plugin = (name) => (isNative ? cx.registerPlugin(name) : null);
const Notifications = plugin('LocalNotifications');
const App = plugin('App');
const IncomingText = plugin('IncomingText');
const Filesystem = plugin('Filesystem');
const Share = plugin('Share');

const CHANNEL = 'daily-reminder';
const FIRST_ID = 1000;
const LAST_ID = 1099;

/** Text shared to the app or picked from another app's selection menu. */
export function onIncomingText(cb) {
  IncomingText?.addListener('incoming', cb);
}

export function onResume(cb) {
  App?.addListener('resume', cb);
}

export function onPause(cb) {
  App?.addListener('pause', cb);
}

export function onNotificationTap(cb) {
  Notifications?.addListener('localNotificationActionPerformed', (e) => cb(e?.notification?.extra || {}));
}

/** 'granted' | 'denied' | 'prompt' | 'unsupported'. Asks the user only when `ask` is true. */
export async function notificationPermission({ ask = false } = {}) {
  if (!Notifications) return 'unsupported';
  let { display } = await Notifications.checkPermissions();
  if (ask && display.startsWith('prompt')) ({ display } = await Notifications.requestPermissions());
  return display.startsWith('prompt') ? 'prompt' : display;
}

let channelReady = false;
async function ensureChannel() {
  if (channelReady) return;
  await Notifications.createChannel({
    id: CHANNEL,
    name: 'Daily reminder',
    description: 'Tells you when words are due for review',
    importance: 4,
  });
  channelReady = true;
}

/**
 * Replace all scheduled reminders with `items` ([{ at: Date, title, body }]).
 * Silently does nothing without notification permission.
 */
export async function setReminders(items) {
  if (!Notifications) return;
  const { notifications: pending } = await Notifications.getPending();
  const ours = pending.filter((n) => n.id >= FIRST_ID && n.id <= LAST_ID);
  if (ours.length) await Notifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  if (!items.length || (await notificationPermission()) !== 'granted') return;

  await ensureChannel();
  // USE_EXACT_ALARM is granted at install, so this is normally exact. If not, schedule
  // inexact (may arrive a little late) rather than opening the system settings screen.
  let exact = true;
  try {
    exact = (await Notifications.checkExactNotificationSetting()).exact_alarm === 'granted';
  } catch {
    /* older Android: always exact */
  }
  await Notifications.schedule({
    notifications: items.slice(0, LAST_ID - FIRST_ID + 1).map((it, i) => ({
      id: FIRST_ID + i,
      title: it.title,
      body: it.body,
      channelId: CHANNEL,
      autoCancel: true,
      isExactNotification: exact,
      schedule: { at: it.at, allowWhileIdle: true },
      extra: { route: 'review' },
    })),
  });
}

/** Save a text file through the Android share sheet (Drive, Files, email…). */
export async function shareFile(name, text) {
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await Share.share({ title: name, files: [uri], dialogTitle: 'Save your WordRecall backup' });
}
