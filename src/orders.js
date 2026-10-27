// Заявки на электронные книги: создание, оплата, выдача ссылки на скачивание
import { randomToken, rub, track } from "./util.js";
import { tg, esc, notifyAdmin } from "./telegram.js";

export const LINK_HOURS = 72;
export const LINK_USES = 3;

export async function getBook(env, id) {
  return env.DB.prepare("SELECT * FROM books WHERE id=?").bind(id).first();
}

export function orderKeyboard(o) {
  const k = [];
  if (o.status === "new" || o.status === "waiting")
    k.push([{ text: "Оплачено — отправить книгу", callback_data: `paid:${o.id}` }]);
  if (o.status === "new") k.push([{ text: "Ждёт оплаты", callback_data: `wait:${o.id}` }]);
  if (o.status !== "sent" && o.status !== "cancelled") k.push([{ text: "Отменить", callback_data: `cancel:${o.id}` }]);
  return k;
}

export function orderText(o, book) {
  const who = [o.name && esc(o.name), o.email && esc(o.email), o.telegram && esc(o.telegram)].filter(Boolean).join(" · ");
  return (
    `<b>Заявка №${o.id}</b> — ${esc(book ? book.title : o.book_id)}, ${rub(o.price)}\n` +
    `${who || "контакт не указан"}${o.chat_id ? " · в боте" : ""}\n` +
    `Источник: ${o.source === "bot" ? "бот" : o.source === "crm" ? "CRM" : "сайт"}`
  );
}

export async function createOrder(env, { book_id, name, email, telegram, chat_id, source }) {
  const book = await getBook(env, book_id);
  if (!book || !book.active) throw new Error("Эта книга сейчас не продаётся");
  const link_code = randomToken(6);
  const o = await env.DB.prepare(
    `INSERT INTO orders(book_id,price,name,email,telegram,chat_id,link_code,source)
     VALUES(?,?,?,?,?,?,?,?) RETURNING *`
  ).bind(book.id, book.price, name || null, email || null, telegram || null, chat_id || null, link_code, source || "site").first();
  await track(env, "order", book.id);
  await notifyAdmin(env, "🆕 " + orderText(o, book), orderKeyboard(o));
  return { order: o, book };
}

export async function setStatus(env, id, status, note) {
  const extra = status === "paid" ? ", paid_at=datetime('now')" : status === "sent" ? ", sent_at=datetime('now')" : "";
  return env.DB.prepare(
    `UPDATE orders SET status=?, updated=datetime('now')${extra}${note !== undefined ? ", note=?" : ""} WHERE id=? RETURNING *`
  ).bind(...(note !== undefined ? [status, note, id] : [status, id])).first();
}

export async function makeDownload(env, orderId) {
  const token = randomToken(18);
  const expires = new Date(Date.now() + LINK_HOURS * 3600e3).toISOString();
  await env.DB.prepare("INSERT INTO downloads(token,order_id,expires,uses_left) VALUES(?,?,?,?)")
    .bind(token, orderId, expires, LINK_USES).run();
  return `${env.SITE_URL.replace(/\/$/, "")}/d/${token}`;
}

// «Оплачено»: отмечаем оплату, создаём ссылку и, если покупатель в боте, отправляем ему книгу
export async function payAndDeliver(env, id) {
  let o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (!o) throw new Error("Заявка не найдена");
  if (o.status === "cancelled") throw new Error("Заявка отменена");
  const book = await getBook(env, o.book_id);
  if (o.status !== "paid" && o.status !== "sent") o = await setStatus(env, id, "paid");
  const url = await makeDownload(env, id);
  let delivered = false;
  if (o.chat_id) {
    const r = await tg(env, "sendMessage", {
      chat_id: o.chat_id,
      parse_mode: "HTML",
      text:
        `Спасибо за покупку! Ваша книга «${esc(book.title)}» в формате EPUB:\n${url}\n\n` +
        `Ссылка действует ${LINK_HOURS} часа, скачать можно до ${LINK_USES} раз.`,
      reply_markup: { inline_keyboard: [[{ text: "Скачать EPUB", url }]] },
    });
    delivered = !!r.ok;
  }
  if (delivered) o = await setStatus(env, id, "sent");
  return { order: o, book, url, delivered };
}
