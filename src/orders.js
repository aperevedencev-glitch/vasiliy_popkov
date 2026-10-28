// Заявки на книги: электронные, печатные и аудио. Создание, оплата, выдача ссылки на скачивание
import { randomToken, rub, track } from "./util.js";
import { tg, esc, notifyAdmin } from "./telegram.js";

export const LINK_HOURS = 72;
export const LINK_USES = 3;

export const FORMAT_NAME = { ebook: "Электронная книга", print: "Печатная книга", audio: "Аудиокнига" };
export const DIGITAL = new Set(["ebook", "audio"]);

export async function getBook(env, id) {
  return env.DB.prepare("SELECT * FROM books WHERE id=?").bind(id).first();
}

// формат вместе с названием книги
export async function getFormat(env, id) {
  return env.DB.prepare("SELECT f.*, b.title FROM formats f JOIN books b ON b.id=f.book_id WHERE f.id=?").bind(id).first();
}

// формат заявки: по format_id, а для старых заявок — электронная версия книги
export async function orderFormat(env, o) {
  if (o.format_id) {
    const f = await getFormat(env, o.format_id);
    if (f) return f;
  }
  const b = await getBook(env, o.book_id);
  return { kind: "ebook", label: "EPUB", file_key: b && b.epub_key, file_name: b && b.epub_name, title: b ? b.title : o.book_id };
}

export const buyable = (f) => !!(f && f.active && Number(f.price) > 0);

export function orderKeyboard(o, f) {
  const k = [];
  const print = f && f.kind === "print";
  if (o.status === "new" || o.status === "waiting")
    k.push([{ text: print ? "Оплачено" : "Оплачено — отправить книгу", callback_data: `paid:${o.id}` }]);
  if (print && o.status === "paid") k.push([{ text: "Книга отправлена", callback_data: `sent:${o.id}` }]);
  if (o.status === "new") k.push([{ text: "Ждёт оплаты", callback_data: `wait:${o.id}` }]);
  if (o.status !== "sent" && o.status !== "cancelled") k.push([{ text: "Отменить", callback_data: `cancel:${o.id}` }]);
  return k;
}

export function orderText(o, f) {
  const who = [o.name && esc(o.name), o.email && esc(o.email), o.telegram && esc(o.telegram), o.phone && esc(o.phone)]
    .filter(Boolean).join(" · ");
  const what = f ? `${esc(f.title)} — ${FORMAT_NAME[f.kind] || ""}${f.label ? ", " + esc(f.label) : ""}` : esc(o.book_id);
  return (
    `<b>Заявка №${o.id}</b> — ${what}, ${rub(o.price)}\n` +
    `${who || "контакт не указан"}${o.chat_id ? " · в боте" : ""}\n` +
    (o.address ? `Адрес доставки: ${esc(o.address)}\n` : "") +
    `Источник: ${o.source === "bot" ? "бот" : o.source === "crm" ? "CRM" : "сайт"}`
  );
}

export async function createOrder(env, { format_id, book_id, name, email, telegram, phone, address, chat_id, source }) {
  let f = null;
  if (format_id) f = await getFormat(env, Number(format_id));
  else if (book_id)
    f = await env.DB.prepare(
      "SELECT f.*, b.title FROM formats f JOIN books b ON b.id=f.book_id WHERE f.book_id=? AND f.kind='ebook' AND f.active=1 ORDER BY f.sort LIMIT 1"
    ).bind(book_id).first();
  if (!buyable(f)) throw new Error("Эта книга сейчас не продаётся");
  if (f.kind === "print" && (!phone || !address)) throw new Error("Для печатной книги укажите телефон и адрес доставки");
  const link_code = randomToken(6);
  const o = await env.DB.prepare(
    `INSERT INTO orders(book_id,format_id,price,name,email,telegram,phone,address,chat_id,link_code,source)
     VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING *`
  ).bind(f.book_id, f.id, f.price, name || null, email || null, telegram || null, phone || null, address || null,
    chat_id || null, link_code, source || "site").first();
  await track(env, "order", f.book_id);
  await notifyAdmin(env, "🆕 " + orderText(o, f), orderKeyboard(o, f));
  return { order: o, book: { id: f.book_id, title: f.title, price: f.price }, format: f };
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

/* «Оплачено»: отмечаем оплату.
   Электронная и аудио — создаём ссылку и, если покупатель в боте, отправляем ему книгу.
   Печатная — только отмечаем оплату, книгу автор отправляет почтой. */
export async function payAndDeliver(env, id) {
  let o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (!o) throw new Error("Заявка не найдена");
  if (o.status === "cancelled") throw new Error("Заявка отменена");
  const f = await orderFormat(env, o);
  if (o.status !== "paid" && o.status !== "sent") o = await setStatus(env, id, "paid");

  if (f.kind === "print") {
    if (o.chat_id)
      await tg(env, "sendMessage", { chat_id: o.chat_id, text: `Оплата за книгу «${f.title}» получена. Автор отправит её по указанному адресу.` });
    return { order: o, format: f, url: null, delivered: false, print: true };
  }
  if (!f.file_key) return { order: o, format: f, url: null, delivered: false, nofile: true };

  const url = await makeDownload(env, id);
  let delivered = false;
  if (o.chat_id) {
    const what = f.kind === "audio" ? "аудиокнига" : `книга в формате ${f.label || "EPUB"}`;
    const r = await tg(env, "sendMessage", {
      chat_id: o.chat_id,
      parse_mode: "HTML",
      text:
        `Спасибо за покупку! Ваша ${what} «${esc(f.title)}»:\n${url}\n\n` +
        `Ссылка действует ${LINK_HOURS} часа, скачать можно до ${LINK_USES} раз.`,
      reply_markup: { inline_keyboard: [[{ text: "Скачать", url }]] },
    });
    delivered = !!r.ok;
  }
  if (delivered) o = await setStatus(env, id, "sent");
  return { order: o, format: f, url, delivered };
}
