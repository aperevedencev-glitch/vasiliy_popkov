// Telegram-бот: читатели и автор
import poems from "./poems.json";
import { safeEqual, rub, track, today, setting, setSetting, STATUS } from "./util.js";
import { tg, esc, adminChat, notifyAdmin } from "./telegram.js";
import { createOrder, payAndDeliver, setStatus, orderKeyboard, orderText, getBook, orderFormat } from "./orders.js";


const MENU = {
  keyboard: [
    [{ text: "Книги" }, { text: "Купить книгу" }],
    [{ text: "Стих дня" }, { text: "Песни" }],
    [{ text: "Новинки" }, { text: "Где купить" }],
    [{ text: "Вопрос автору" }],
  ],
  resize_keyboard: true,
};

const send = (env, chat_id, text, extra = {}) =>
  tg(env, "sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

export function poemOfDay(date = today()) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return poems[h % poems.length];
}

function poemText(p) {
  return `<b>${esc(p.t)}</b>\n\n${esc(p.l.join("\n"))}\n\n<i>${esc(p.d)}</i>`;
}

const site = (env) => (env.SITE_URL || "").replace(/\/$/, "");

async function booksText(env) {
  const { results } = await env.DB.prepare(
    "SELECT b.*, (SELECT GROUP_CONCAT(DISTINCT f.kind) FROM formats f WHERE f.book_id=b.id AND f.active=1) kinds FROM books b WHERE b.shown=1 ORDER BY b.sort, b.title"
  ).all();
  const link = (b) => (b.read_url ? `<a href="${esc(b.read_url)}">${esc(b.title)}</a>` : esc(b.title));
  const marks = (b) => (b.kinds || "").split(",").filter(Boolean).map((k) => ({ ebook: "📱", print: "📖", audio: "🎧" }[k])).join("");
  const line = (b) => `• ${link(b)}${b.genre ? " — " + esc(b.genre.toLowerCase()) : ""} ${marks(b)}`.trimEnd();
  const series = results.filter((b) => b.series).sort((a, b) => Number(a.series) - Number(b.series));
  const romans = results.filter((b) => b.kind === "roman" && !b.series);
  const other = results.filter((b) => b.kind !== "roman");
  return (
    (series.length ? "<b>Серия «Сокровища заброшенных усадеб»</b>\n" + series.map((b) => `${esc(b.series)}. ${link(b)} ${marks(b)}`.trimEnd()).join("\n") + "\n\n" : "") +
    "<b>Романы</b>\n" + romans.map(line).join("\n") +
    (other.length ? "\n\n<b>Рассказы, повести, стихи</b>\n" + other.map(line).join("\n") : "") +
    "\n\n📱 электронная · 📖 печатная · 🎧 аудио"
  );
}

const SHOPS =
  "<b>Где читать и купить</b>\n" +
  '• <a href="https://jaaj.club/books.aspx?uid=60849">Jaaj.Club</a> — все книги\n' +
  '• <a href="https://ridero.ru/books/catalog/?q=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Ridero</a> — печатные книги\n' +
  '• <a href="https://www.litres.ru/search/?q=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Литрес</a> — все электронные и аудиокниги\n' +
  '• <a href="https://www.wildberries.ru/catalog/0/search.aspx?search=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Wildberries</a>\n' +
  "• Электронные, печатные и аудиоверсии можно заказать у автора — кнопка «Купить книгу».";

// что можно купить у автора прямо в боте: электронные и аудио (печатные — на сайте, нужен адрес)
async function buyKeyboard(env) {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.kind, f.label, f.price, b.title FROM formats f JOIN books b ON b.id=f.book_id
     WHERE f.active=1 AND f.price>0 AND f.kind IN ('ebook','audio') AND b.shown=1 ORDER BY b.sort, f.sort`
  ).all();
  return results.map((f) => [{ text: `${f.kind === "audio" ? "🎧 " : ""}${f.title}${f.label ? " · " + f.label : ""} — ${rub(f.price)}`.slice(0, 64), callback_data: `bf:${f.id}` }]);
}

async function songsText(env) {
  const { results } = await env.DB.prepare("SELECT id,title,poem,performer,file_key,ext_url FROM songs WHERE published=1 ORDER BY sort, id DESC LIMIT 30").all();
  if (!results.length) return "Песен на стихи автора пока нет — подпишитесь на новинки, чтобы не пропустить.";
  return "<b>Песни на стихи Василия Попкова</b>\n\n" + results.map((s) => {
    const url = s.file_key ? `${site(env)}/song/${s.id}/download` : s.ext_url;
    return `🎵 <b>${esc(s.title)}</b>${s.poem ? ` — на стихи «${esc(s.poem)}»` : ""}${s.performer ? `\nИсполняет: ${esc(s.performer)}` : ""}` +
      (url ? `\n<a href="${esc(url)}">${s.file_key ? "Скачать" : "Слушать"}</a> · <a href="${site(env)}/#song-${s.id}">на сайте</a>` : "");
  }).join("\n\n");
}

export async function handleUpdate(env, u) {
  if (u.callback_query) return onCallback(env, u.callback_query);
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== "private") return;
  const chat = m.chat.id;
  const text = (m.text || "").trim();
  const admin = await adminChat(env);
  const isAdmin = admin === chat;

  // автор отвечает на вопрос читателя ответом на уведомление
  if (isAdmin && m.reply_to_message) {
    const q = (m.reply_to_message.text || "").match(/Вопрос №(\d+)/);
    if (q) return answerQuestion(env, Number(q[1]), text, chat);
  }

  if (text.startsWith("/admin")) {
    const pass = text.slice(6).trim();
    if (env.CRM_PASSWORD && safeEqual(pass, env.CRM_PASSWORD)) {
      await setSetting(env, "admin_chat", chat);
      return send(env, chat, "Готово: уведомления о заявках, подписках и вопросах будут приходить сюда.");
    }
    return send(env, chat, "Неверный пароль.");
  }

  if (text.startsWith("/start")) {
    await track(env, "bot_start", "");
    const arg = text.split(" ")[1] || "";
    const mo = arg.match(/^o(\d+)_([A-Za-z0-9_-]+)$/);
    if (mo) {
      const o = await env.DB.prepare("SELECT * FROM orders WHERE id=? AND link_code=?").bind(Number(mo[1]), mo[2]).first();
      if (o) {
        await env.DB.prepare("UPDATE orders SET chat_id=?, updated=datetime('now') WHERE id=?").bind(chat, o.id).run();
        const b = await getBook(env, o.book_id);
        await notifyAdmin(env, `Покупатель по заявке №${o.id} открыл бота — книгу можно отправить прямо в Telegram.`);
        const tail = o.status === "sent" || o.status === "paid"
          ? "Заявка уже оплачена — если ссылка не пришла, напишите «Вопрос автору»."
          : "Как только оплата будет подтверждена, книга придёт сюда.";
        return send(env, chat, `Заявка №${o.id} на книгу «${esc(b.title)}» привязана к этому чату. ${tail}`, { reply_markup: MENU });
      }
    }
    return send(env, chat,
      "Здравствуйте! Это бот писателя <b>Василия Попкова</b> — автора интеллектуальных триллеров и историко-детективных романов.\n\n" +
      "Здесь можно посмотреть книги, купить электронную или аудиоверсию, послушать песни на стихи автора, получить стих дня и подписаться на новинки.",
      { reply_markup: MENU });
  }

  // ждём текст вопроса
  const waiting = await setting(env, `ask:${chat}`);
  if (waiting && text && !["Книги", "Купить книгу", "Купить EPUB", "Стих дня", "Песни", "Новинки", "Вопрос автору", "Где купить"].includes(text)) {
    await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(`ask:${chat}`).run();
    const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(" ");
    const contact = m.from.username ? "@" + m.from.username : "";
    const lead = await env.DB.prepare(
      "INSERT INTO leads(kind,name,contact,message,chat_id) VALUES('question',?,?,?,?) RETURNING id"
    ).bind(name, contact, text.slice(0, 2000), chat).first();
    await track(env, "lead", "question");
    await notifyAdmin(env, `❓ <b>Вопрос №${lead.id}</b> от ${esc(name)} ${esc(contact)}\n\n${esc(text)}\n\n<i>Ответьте на это сообщение — ответ уйдёт читателю.</i>`);
    return send(env, chat, "Спасибо! Вопрос передан автору, ответ придёт сюда.", { reply_markup: MENU });
  }

  switch (text) {
    case "Книги":
      await track(env, "bot", "books");
      return send(env, chat, await booksText(env));
    case "Где купить":
      await track(env, "bot", "shops");
      return send(env, chat, SHOPS);
    case "Стих дня": {
      const p = poemOfDay();
      await track(env, "poem", p.t);
      return send(env, chat, poemText(p), { reply_markup: { inline_keyboard: [[{ text: "Ещё стихотворение", callback_data: "poem:rnd" }]] } });
    }
    case "Купить книгу":
    case "Купить EPUB": {
      await track(env, "bot", "buy");
      const kb = await buyKeyboard(env);
      if (!kb.length) return send(env, chat, "Сейчас у автора нет книг для покупки в боте. Загляните в «Где купить».");
      return send(env, chat, "Выберите книгу. После подтверждения оплаты автор пришлёт её сюда. Печатные книги заказываются на сайте — там можно указать адрес.", {
        reply_markup: { inline_keyboard: kb },
      });
    }
    case "Песни":
      await track(env, "bot", "songs");
      return send(env, chat, await songsText(env));
    case "Новинки": {
      const s = await env.DB.prepare("SELECT active FROM subscribers WHERE chat_id=?").bind(chat).first();
      const on = s && s.active;
      return send(env, chat, on ? "Вы подписаны на новинки." : "Подписаться на новости о новых книгах?", {
        reply_markup: { inline_keyboard: [[on ? { text: "Отписаться", callback_data: "sub:off" } : { text: "Подписаться", callback_data: "sub:on" }]] },
      });
    }
    case "Вопрос автору":
      await setSetting(env, `ask:${chat}`, Date.now());
      return send(env, chat, "Напишите вопрос одним сообщением — я передам его автору.");
    default:
      return send(env, chat, "Выберите пункт меню ниже.", { reply_markup: MENU });
  }
}

async function onCallback(env, q) {
  const chat = q.message.chat.id;
  const [cmd, arg] = (q.data || "").split(":");
  const admin = await adminChat(env);
  const answer = (text) => tg(env, "answerCallbackQuery", { callback_query_id: q.id, text });

  if (["paid", "wait", "cancel", "sent"].includes(cmd)) {
    if (chat !== admin) return answer("Только для автора");
    const id = Number(arg);
    try {
      let o, note;
      if (cmd === "paid") {
        const r = await payAndDeliver(env, id);
        o = r.order;
        note = r.print ? "Оплата отмечена. После отправки книги нажмите «Книга отправлена»."
          : r.nofile ? "Оплата отмечена. Файл книги не загружен в CRM — отправьте его покупателю сами."
          : r.delivered ? "Книга отправлена покупателю в Telegram." : `Покупатель не в боте. Отправьте ему ссылку:\n${r.url}`;
      } else {
        o = await setStatus(env, id, cmd === "wait" ? "waiting" : cmd === "sent" ? "sent" : "cancelled");
      }
      const f = await orderFormat(env, o);
      await tg(env, "editMessageText", {
        chat_id: chat, message_id: q.message.message_id, parse_mode: "HTML", disable_web_page_preview: true,
        text: orderText(o, f) + `\nСтатус: <b>${STATUS[o.status]}</b>` + (note ? `\n\n${esc(note)}` : ""),
        reply_markup: { inline_keyboard: orderKeyboard(o, f) },
      });
      return answer(STATUS[o.status]);
    } catch (e) {
      return answer(e.message);
    }
  }

  if (cmd === "buy" || cmd === "bf") {
    const name = [q.from.first_name, q.from.last_name].filter(Boolean).join(" ");
    try {
      const { order, book, format } = await createOrder(env, {
        ...(cmd === "bf" ? { format_id: Number(arg) } : { book_id: arg }), name, telegram: q.from.username ? "@" + q.from.username : "", chat_id: chat, source: "bot",
      });
      await answer("Заявка принята");
      return send(env, chat,
        `Заявка №${order.id}: ${format.kind === "audio" ? "аудиокнига" : "книга"} «${esc(book.title)}» (${rub(order.price)}) принята. ` +
        "Автор свяжется с вами здесь, чтобы договориться об оплате, и после неё пришлёт книгу.");
    } catch (e) {
      return answer(e.message);
    }
  }

  if (cmd === "sub") {
    const on = arg === "on" ? 1 : 0;
    await env.DB.prepare(
      "INSERT INTO subscribers(chat_id,name,source,active) VALUES(?,?,'bot',?) ON CONFLICT(chat_id) DO UPDATE SET active=excluded.active"
    ).bind(chat, q.from.first_name || "", on).run();
    if (on) {
      await track(env, "subscribe", "bot");
      await notifyAdmin(env, `🔔 Новый подписчик в боте: ${esc(q.from.first_name || "")} ${q.from.username ? "@" + esc(q.from.username) : ""}`);
    }
    await answer(on ? "Вы подписаны" : "Подписка отключена");
    return tg(env, "editMessageText", { chat_id: chat, message_id: q.message.message_id, text: on ? "Вы подписаны на новинки. Спасибо!" : "Подписка отключена." });
  }

  if (cmd === "poem") {
    const p = poems[Math.floor(Math.random() * poems.length)];
    await track(env, "poem", p.t);
    await answer("");
    return send(env, chat, poemText(p), { reply_markup: { inline_keyboard: [[{ text: "Ещё стихотворение", callback_data: "poem:rnd" }]] } });
  }
  return answer("");
}

export async function answerQuestion(env, id, text, adminChatId) {
  const lead = await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(id).first();
  if (!lead || !lead.chat_id) {
    if (adminChatId) await send(env, adminChatId, "Этому читателю нельзя ответить через бота.");
    return { ok: false };
  }
  const r = await send(env, lead.chat_id, `<b>Ответ автора:</b>\n\n${esc(text)}`);
  if (r.ok) await env.DB.prepare("UPDATE leads SET status='answered', answer=? WHERE id=?").bind(text, id).run();
  if (adminChatId) await send(env, adminChatId, r.ok ? `Ответ на вопрос №${id} отправлен.` : "Не удалось отправить ответ.");
  return { ok: !!r.ok };
}

// рассылка подписчикам бота
export async function broadcast(env, text) {
  const { results } = await env.DB.prepare("SELECT chat_id FROM subscribers WHERE active=1 AND chat_id IS NOT NULL").all();
  let ok = 0;
  for (const s of results) {
    const r = await send(env, s.chat_id, text);
    if (r.ok) ok++;
    else if (r.error_code === 403) await env.DB.prepare("UPDATE subscribers SET active=0 WHERE chat_id=?").bind(s.chat_id).run();
    await new Promise((res) => setTimeout(res, 40));
  }
  return { sent: ok, total: results.length };
}
