/** Helpers PWA + Web Push no cliente. */

const DEVICE_KEY = "farol_device_id";

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export function canInstallPwa() {
  return "serviceWorker" in navigator;
}

export async function subscribePush(themes: string[], keywords: string[], uf = "PE") {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Service Worker indisponível neste navegador");
  if (!("PushManager" in window)) {
    throw new Error(
      "Web Push não disponível aqui. No iPhone: adicione à Tela de Início e abra pelo ícone (iOS 16.4+)."
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permissão de notificação negada nas configurações do aparelho.");
  }

  const vapid = await fetch("/api/push/vapid-public-key").then((r) => r.json());
  if (!vapid.publicKey) throw new Error(vapid.error || "VAPID ausente");

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    throw new Error(
      msg.includes("push service") || msg.includes("denied")
        ? "Falha ao registrar push. No iPhone use o app da Tela de Início e permita notificações."
        : msg
    );
  }
  const json = sub.toJSON();
  const body = {
    deviceId: getDeviceId(),
    endpoint: json.endpoint,
    keys: json.keys,
    uf,
    themes,
    keywords,
  };
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return { subscription: sub, profile: data };
}

export async function unsubscribePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const endpoint = sub?.endpoint;
  if (sub) await sub.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, deviceId: getDeviceId() }),
  });
}

export async function testPush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: getDeviceId(),
      endpoint: sub?.endpoint,
      matchedOn: "teste",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
