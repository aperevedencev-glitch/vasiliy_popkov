// Общие помощники: ответы, подписи, даты, проверка ввода

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

export const today = () => new Date().toISOString().slice(0, 10);

const enc = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sign(secret, payload) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verify(secret, token) {
  if (!token || !token.includes(".")) return null;
  const i = token.lastIndexOf(".");
  const payload = token.slice(0, i);
  const expected = await sign(secret, payload);
  return safeEqual(expected, token) ? payload : null;
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const randomToken = (bytes = 18) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export function cookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// текст из формы: обрезать, ограничить длину
export const clean = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// @username или ссылка t.me/username → @username
export function tgHandle(v) {
  const s = clean(v, 64).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,32}$/.test(s) ? "@" + s : "";
}

export async function track(env, type, target = "") {
  try {
    await env.DB.prepare(
      "INSERT INTO events(day,type,target,n) VALUES(?,?,?,1) ON CONFLICT(day,type,target) DO UPDATE SET n=n+1"
    ).bind(today(), type, String(target).slice(0, 60)).run();
  } catch (e) {
    console.log("track", e);
  }
}

export async function setting(env, k) {
  const r = await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first();
  return r ? r.v : null;
}

export async function setSetting(env, k, v) {
  await env.DB.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run();
}

export const rub = (n) => `${Number(n).toLocaleString("ru-RU")} ₽`;

export const STATUS = {
  new: "Новая",
  waiting: "Ждёт оплаты",
  paid: "Оплачена",
  sent: "Книга отправлена",
  cancelled: "Отменена",
};
