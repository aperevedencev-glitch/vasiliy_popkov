// Telegram-бот: читатели и автор
import catalog from "./catalog.json";
import poems from "./poems.json";
import { safeEqual, rub, track, today, setting, setSetting, STATUS } from "./util.js";
import { tg, esc, adminChat, notifyAdmin } from "./telegram.js";
import { createOrder, payAndDeliver, setStatus, orderKeyboard, orderText, getBook } from "./orders.js";

const JAAJ = "https://jaaj.club/book.aspx?enname=romans&id=";

const MENU = {
  keyboard: [
    [{ text: "Книги" }, { text: "Купить EPUB" }],
    [{ text: "Стих дня" }, { text: "Новинки" }],
    [{ text: "Вопрос автору" }, { text: "Где купить" }],
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

function booksText() {
  const series = catalog.filter((b) => b.s).sort((a, b) => a.s - b.s);
  const romans = catalog.filter((b) => b.k === "roman" && !b.s);
  const other = catalog.filter((b) => b.k !== "roman");
  const line = (b) => `• <a href="${JAAJ}${b.id}">${esc(b.t)}</a> — ${esc(b.g.toLowerCase())}`;
  return (
    "<b>Серия «Сокровища заброшенных усадеб»</b>\n" +
    series.map((b) => `${b.s}. <a href="${JAAJ}${b.id}">${esc(b.t)}</a>`).join("\n") +
    "\n\n<b>Романы</b>\n" + romans.map(line).join("\n") +
    "\n\n<b>Рассказы, повести, стихи</b>\n" + other.map(line).join("\n")
  );
}

const SHOPS =
  "<b>Где читать и купить</b>\n" +
  '• <a href="https://jaaj.club/books.aspx?uid=60849">Jaaj.Club</a> — все книги\n' +
  '• <a href="https://ridero.ru/books/catalog/?q=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Ridero</a> — печатные книги\n' +
  '• <a href="https://www.litres.ru/search/?q=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Литрес</a> — все электронные и аудиокниги\n' +
  '• <a href="https://www.wildberries.ru/catalog/0/search.aspx?search=%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B8%D0%B9%20%D0%9F%D0%BE%D0%BF%D0%BA%D0%BE%D0%B2">Wildberries</a>\n' +
  '• <a href="https://proza.ru/avtor/petyavasechkin">Проза.ру</a> и <a href="https://stihi.ru/avtor/petyavasechkin">Стихи.ру</a>';

async function epubKeyboard(env) {
  const { results } = await env.DB.prepare("SELECT id,title,price FROM books WHERE active=1 ORDER BY price DESC, title").all();
  return results.map((b) => [{ text: `${b.title} — ${rub(b.price)}`, callback_data: `buy:${b.id}` }]);
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
      "Здесь можно посмотреть книги, купить электронную версию в EPUB, получить стих дня и подписаться на новинки.",
      { reply_markup: MENU });
  }

  // ждём текст вопроса
  const waiting = await setting(env, `ask:${chat}`);
  if (waiting && text && !["Книги", "Купить EPUB", "Стих дня", "Новинки", "Вопрос автору", "Где купить"].includes(text)) {
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
      return send(env, chat, booksText());
    case "Где купить":
      await track(env, "bot", "shops");
      return send(env, chat, SHOPS);
    case "Стих дня": {
      const p = poemOfDay();
      await track(env, "poem", p.t);
      return send(env, chat, poemText(p), { reply_markup: { inline_keyboard: [[{ text: "Ещё стихотворение", callback_data: "poem:rnd" }]] } });
    }
    case "Купить EPUB":
      await track(env, "bot", "buy");
      return send(env, chat, "Выберите книгу. После подтверждения оплаты автор пришлёт её сюда в формате EPUB.", {
        reply_markup: { inline_keyboard: await epubKeyboard(env) },
      });
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

  if (["paid", "wait", "cancel"].includes(cmd)) {
    if (chat !== admin) return answer("Только для автора");
    const id = Number(arg);
    try {
      let o, note;
      if (cmd === "paid") {
        const r = await payAndDeliver(env, id);
        o = r.order;
        note = r.delivered ? "Книга отправлена покупателю в Telegram." : `Покупатель не в боте. Отправьте ему ссылку:\n${r.url}`;
      } else {
        o = await setStatus(env, id, cmd === "wait" ? "waiting" : "cancelled");
      }
      const b = await getBook(env, o.book_id);
      await tg(env, "editMessageText", {
        chat_id: chat, message_id: q.message.message_id, parse_mode: "HTML", disable_web_page_preview: true,
        text: orderText(o, b) + `\nСтатус: <b>${STATUS[o.status]}</b>` + (note ? `\n\n${esc(note)}` : ""),
        reply_markup: { inline_keyboard: orderKeyboard(o) },
      });
      return answer(STATUS[o.status]);
    } catch (e) {
      return answer(e.message);
    }
  }

  if (cmd === "buy") {
    const name = [q.from.first_name, q.from.last_name].filter(Boolean).join(" ");
    try {
      const { order, book } = await createOrder(env, {
        book_id: arg, name, telegram: q.from.username ? "@" + q.from.username : "", chat_id: chat, source: "bot",
      });
      await answer("Заявка принята");
      return send(env, chat,
        `Заявка №${order.id} на книгу «${esc(book.title)}» (${rub(book.price)}) принята. ` +
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
