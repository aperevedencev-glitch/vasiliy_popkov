// Вызовы Telegram Bot API

export async function tg(env, method, body) {
  if (!env.TG_TOKEN) return { ok: false, description: "TG_TOKEN не задан" };
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ ok: false }));
  if (!data.ok) console.log("tg", method, data.description);
  return data;
}

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export async function adminChat(env) {
  const r = await env.DB.prepare("SELECT v FROM settings WHERE k='admin_chat'").first();
  return r ? Number(r.v) : null;
}

// сообщение автору (если он привязал чат командой /admin)
export async function notifyAdmin(env, text, keyboard) {
  const chat = await adminChat(env);
  if (!chat) return null;
  return tg(env, "sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}
