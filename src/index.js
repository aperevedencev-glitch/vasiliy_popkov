// Сайт писателя Василия Попкова: публичные формы, CRM, бот, выдача EPUB
import { json, bad, clean, isEmail, tgHandle, track, sign, verify, safeEqual, cookie, today, rub, setting } from "./util.js";
import { createOrder, payAndDeliver, setStatus, makeDownload, getBook } from "./orders.js";
import { handleUpdate, broadcast, answerQuestion } from "./bot.js";
import { tg, esc, notifyAdmin } from "./telegram.js";

const EVENTS = new Set(["view", "shop", "book", "buy_open", "poem_open"]);

export default {
  async fetch(req, rawEnv, ctx) {
    // секреты, заданные через «wrangler secret put» из PowerShell, приходят с переводом строки
    const env = Object.assign({}, rawEnv);
    for (const k of ["CRM_PASSWORD", "SESSION_SECRET", "TG_TOKEN", "TG_WEBHOOK_SECRET", "BOT_USERNAME", "SITE_URL"])
      if (typeof env[k] === "string") env[k] = env[k].trim();
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/crm/")) return await crm(req, env, p.slice(9), url);
      if (p.startsWith("/api/")) return await publicApi(req, env, p.slice(5));
      if (p.startsWith("/d/")) return await download(env, p.slice(3));
      if (p.startsWith("/tg/")) return await webhook(req, env, ctx, p.slice(4));
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.log("error", p, e && e.stack);
      return bad("Ошибка сервера. Попробуйте ещё раз.", 500);
    }
  },
};

// ---------------------------------------------------------------- публичное
async function publicApi(req, env, route) {
  if (route === "catalog" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id,jaaj_id,title,price FROM books WHERE active=1").all();
    return json({ ok: true, books: results, bot: env.BOT_USERNAME || "" }, 200, { "cache-control": "max-age=60" });
  }
  if (req.method !== "POST") return bad("Метод не поддерживается", 405);
  const body = await req.json().catch(() => ({}));
  if (body.website) return json({ ok: true }); // ловушка для ботов

  if (route === "event") {
    if (EVENTS.has(body.type)) await track(env, body.type, clean(body.target, 60));
    return json({ ok: true });
  }

  if (route === "order") {
    const name = clean(body.name, 100);
    const email = clean(body.email, 120).toLowerCase();
    const telegram = tgHandle(body.telegram || "");
    if (!name) return bad("Укажите, как к вам обращаться");
    if (!email && !telegram) return bad("Укажите e-mail или Telegram, чтобы автор мог прислать книгу");
    if (email && !isEmail(email)) return bad("Проверьте e-mail");
    if (!body.consent) return bad("Нужно согласие на обработку персональных данных");
    const { order, book } = await createOrder(env, { book_id: clean(body.book, 30), name, email, telegram, source: "site" });
    const bot = env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=o${order.id}_${order.link_code}` : "";
    return json({ ok: true, id: order.id, title: book.title, price: book.price, bot });
  }

  if (route === "subscribe") {
    const email = clean(body.email, 120).toLowerCase();
    if (!isEmail(email)) return bad("Проверьте e-mail");
    if (!body.consent) return bad("Нужно согласие на обработку персональных данных");
    const r = await env.DB.prepare(
      "INSERT INTO subscribers(email,name,source) VALUES(?,?,'site') ON CONFLICT(email) DO UPDATE SET active=1 RETURNING id"
    ).bind(email, clean(body.name, 100)).first();
    await track(env, "subscribe", "site");
    await notifyAdmin(env, `🔔 Подписка на новинки с сайта: ${esc(email)}`);
    return json({ ok: true, id: r.id });
  }

  if (route === "lead") {
    const kind = body.kind === "partner" ? "partner" : "question";
    const name = clean(body.name, 100), contact = clean(body.contact, 150), message = clean(body.message, 2000);
    if (!name || !contact || !message) return bad("Заполните имя, контакт и сообщение");
    if (!body.consent) return bad("Нужно согласие на обработку персональных данных");
    const r = await env.DB.prepare("INSERT INTO leads(kind,name,contact,org,message) VALUES(?,?,?,?,?) RETURNING id")
      .bind(kind, name, contact, clean(body.org, 150), message).first();
    await track(env, "lead", kind);
    await notifyAdmin(env,
      `${kind === "partner" ? "🤝 <b>Сотрудничество</b>" : "❓ <b>Вопрос с сайта</b>"} №${r.id}\n` +
      `${esc(name)}${body.org ? ", " + esc(clean(body.org, 150)) : ""} · ${esc(contact)}\n\n${esc(message)}`);
    return json({ ok: true, id: r.id });
  }
  return bad("Не найдено", 404);
}

// ---------------------------------------------------------------- скачивание
async function download(env, token) {
  const d = await env.DB.prepare(
    "SELECT d.*, o.book_id, o.status FROM downloads d JOIN orders o ON o.id=d.order_id WHERE d.token=?"
  ).bind(token).first();
  const page = (title, text) => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
    `<body style="font:17px/1.6 Georgia,serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#1C2430;background:#ECEDE6">` +
    `<h1 style="font-weight:400">${title}</h1><p>${text}</p><p><a href="/">На сайт автора</a></p>`,
    { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!d || d.status === "cancelled") return page("Ссылка недействительна", "Проверьте ссылку или напишите автору.");
  if (new Date(d.expires) < new Date() || d.uses_left <= 0)
    return page("Срок ссылки истёк", "Напишите автору — он пришлёт новую ссылку.");
  const book = await getBook(env, d.book_id);
  const obj = await env.BOOKS.get(book.epub_key);
  if (!obj) return page("Файл временно недоступен", "Автор уже знает об этом и пришлёт книгу.");
  await env.DB.prepare("UPDATE downloads SET uses_left=uses_left-1 WHERE token=?").bind(token).run();
  await track(env, "download", book.id);
  return new Response(obj.body, {
    headers: {
      "content-type": "application/epub+zip",
      "content-disposition": `attachment; filename="book.epub"; filename*=UTF-8''${encodeURIComponent(book.epub_name)}`,
      "cache-control": "no-store",
      ...(obj.size ? { "content-length": String(obj.size) } : {}),
    },
  });
}

// ---------------------------------------------------------------- бот
async function webhook(req, env, ctx, secret) {
  if (!env.TG_WEBHOOK_SECRET || !safeEqual(secret, env.TG_WEBHOOK_SECRET) ||
      !safeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", env.TG_WEBHOOK_SECRET))
    return new Response("forbidden", { status: 403 });
  const update = await req.json().catch(() => null);
  if (update) ctx.waitUntil(handleUpdate(env, update).catch((e) => console.log("bot", e && e.stack)));
  return new Response("ok");
}

// ---------------------------------------------------------------- CRM
const SESSION_DAYS = 30;

async function authed(req, env) {
  const payload = await verify(env.SESSION_SECRET, cookie(req, "crm"));
  return payload && Number(payload.split(":")[1]) > Date.now();
}

async function crm(req, env, route, url) {
  if (!env.CRM_PASSWORD || !env.SESSION_SECRET) return bad("CRM не настроена: задайте CRM_PASSWORD и SESSION_SECRET", 503);
  if (route === "login" && req.method === "POST") {
    const { password } = await req.json().catch(() => ({}));
    await new Promise((r) => setTimeout(r, 400)); // замедлить перебор
    if (!safeEqual(String(password || ""), env.CRM_PASSWORD)) return bad("Неверный пароль", 401);
    const exp = Date.now() + SESSION_DAYS * 864e5;
    const token = await sign(env.SESSION_SECRET, `crm:${exp}`);
    return json({ ok: true }, 200, {
      "set-cookie": `crm=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
    });
  }
  if (route === "logout") return json({ ok: true }, 200, { "set-cookie": "crm=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" });
  if (!(await authed(req, env))) return bad("Нужно войти", 401);

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const DB = env.DB;
  const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;

  switch (route) {
    case "summary": {
      const days = Math.min(365, Number(url.searchParams.get("days")) || 30);
      const from = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
      const series = await all("SELECT day,type,SUM(n) n FROM events WHERE day>=? GROUP BY day,type ORDER BY day", from);
      const shops = await all("SELECT target,SUM(n) n FROM events WHERE day>=? AND type='shop' GROUP BY target ORDER BY n DESC", from);
      const books = await all("SELECT target,SUM(n) n FROM events WHERE day>=? AND type IN ('book','buy_open') GROUP BY target ORDER BY n DESC LIMIT 12", from);
      const sales = await all(
        `SELECT b.id,b.title,COUNT(o.id) orders,SUM(CASE WHEN o.status IN ('paid','sent') THEN 1 ELSE 0 END) sold,
                SUM(CASE WHEN o.status IN ('paid','sent') THEN o.price ELSE 0 END) revenue
         FROM books b LEFT JOIN orders o ON o.book_id=b.id AND date(o.created)>=? GROUP BY b.id ORDER BY revenue DESC, orders DESC`, from);
      const funnel = await all("SELECT status,COUNT(*) n FROM orders GROUP BY status");
      const counts = await DB.prepare(
        `SELECT (SELECT COUNT(*) FROM orders WHERE status IN ('new','waiting')) open_orders,
                (SELECT COUNT(*) FROM leads WHERE status='new') new_leads,
                (SELECT COUNT(*) FROM subscribers WHERE active=1) subscribers,
                (SELECT COUNT(*) FROM partners WHERE stage NOT IN ('paused')) partners`).first();
      return json({ ok: true, from, days, series, shops, books, sales, funnel, counts, botLinked: !!(await setting(env, "admin_chat")) });
    }
    case "orders":
      return json({ ok: true, items: await all(
        "SELECT o.*, b.title FROM orders o JOIN books b ON b.id=o.book_id ORDER BY o.id DESC LIMIT 500") });
    case "order": {
      const id = Number(body.id);
      if (body.action === "deliver") {
        const r = await payAndDeliver(env, id);
        return json({ ok: true, order: r.order, url: r.url, delivered: r.delivered });
      }
      if (body.action === "link") return json({ ok: true, url: await makeDownload(env, id) });
      if (body.action === "status") {
        const allowed = ["new", "waiting", "paid", "sent", "cancelled"];
        if (!allowed.includes(body.status)) return bad("Неизвестный статус");
        return json({ ok: true, order: await setStatus(env, id, body.status, clean(body.note ?? "", 1000)) });
      }
      if (body.action === "create") {
        const { order } = await createOrder(env, { book_id: body.book, name: clean(body.name, 100), email: clean(body.email, 120), telegram: tgHandle(body.telegram || ""), source: "crm" });
        return json({ ok: true, order });
      }
      return bad("Неизвестное действие");
    }
    case "books":
      if (req.method === "POST") {
        await DB.prepare("UPDATE books SET price=?, active=? WHERE id=?")
          .bind(Math.max(0, Math.round(Number(body.price) || 0)), body.active ? 1 : 0, clean(body.id, 30)).run();
      }
      return json({ ok: true, items: await all("SELECT * FROM books ORDER BY title") });
    case "subscribers":
      if (req.method === "POST" && body.id) await DB.prepare("UPDATE subscribers SET active=? WHERE id=?").bind(body.active ? 1 : 0, Number(body.id)).run();
      return json({ ok: true, items: await all("SELECT * FROM subscribers ORDER BY id DESC") });
    case "broadcast": {
      const text = clean(body.text, 3500);
      if (!text) return bad("Пустое сообщение");
      return json({ ok: true, ...(await broadcast(env, esc(text))) });
    }
    case "leads":
      if (req.method === "POST" && body.id) {
        if (body.answer) return json(await answerQuestion(env, Number(body.id), clean(body.answer, 3500)));
        await DB.prepare("UPDATE leads SET status=? WHERE id=?").bind(clean(body.status, 20), Number(body.id)).run();
      }
      return json({ ok: true, items: await all("SELECT * FROM leads ORDER BY id DESC LIMIT 500") });
    case "partners":
      if (req.method === "POST") {
        const f = ["name", "kind", "contact", "stage", "next_step", "next_date", "note"].map((k) => clean(body[k] ?? "", 1000));
        if (!f[0]) return bad("Укажите название");
        if (body.id) {
          await DB.prepare("UPDATE partners SET name=?,kind=?,contact=?,stage=?,next_step=?,next_date=?,note=?,updated=datetime('now') WHERE id=?")
            .bind(...f, Number(body.id)).run();
        } else {
          await DB.prepare("INSERT INTO partners(name,kind,contact,stage,next_step,next_date,note) VALUES(?,?,?,?,?,?,?)").bind(...f).run();
        }
      }
      return json({ ok: true, items: await all("SELECT * FROM partners ORDER BY CASE WHEN next_date IS NULL OR next_date='' THEN 1 ELSE 0 END, next_date, id DESC") });
    case "partner-delete":
      await DB.prepare("DELETE FROM partners WHERE id=?").bind(Number(body.id)).run();
      return json({ ok: true });
    case "export": {
      const t = url.searchParams.get("t");
      const q = { orders: "SELECT o.id,o.created,b.title,o.price,o.name,o.email,o.telegram,o.status,o.paid_at,o.sent_at,o.note FROM orders o JOIN books b ON b.id=o.book_id ORDER BY o.id",
        subscribers: "SELECT id,created,name,email,chat_id,source,active FROM subscribers ORDER BY id",
        leads: "SELECT id,created,kind,name,contact,org,message,status FROM leads ORDER BY id",
        partners: "SELECT id,created,name,kind,contact,stage,next_step,next_date,note FROM partners ORDER BY id" }[t];
      if (!q) return bad("Неизвестная таблица");
      const rows = await all(q);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = "﻿" + [cols.map(cell).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\r\n");
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${t}-${today()}.csv"` } });
    }
  }
  return bad("Не найдено", 404);
}
