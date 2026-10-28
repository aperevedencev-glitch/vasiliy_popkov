// Сайт писателя Василия Попкова: публичные формы, CRM, бот, выдача EPUB
import { json, bad, clean, isEmail, tgHandle, track, sign, verify, safeEqual, cookie, today, rub, setting } from "./util.js";
import { createOrder, payAndDeliver, setStatus, makeDownload, getBook, orderFormat, buyable } from "./orders.js";
import { renderIndex, loadContent } from "./render.js";
import TEMPLATE from "./home.html";
import poems from "./poems.json";
import { serveObject, upload, removeObject, PUBLIC_PREFIXES } from "./media.js";
import { handleUpdate, broadcast, answerQuestion } from "./bot.js";
import { tg, esc, notifyAdmin } from "./telegram.js";

const EVENTS = new Set(["view", "shop", "book", "buy_open", "poem_open", "excerpt", "song_play", "sample"]);

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
      if (p.startsWith("/media/")) return await media(req, env, decodeURIComponent(p.slice(7)));
      if (p.startsWith("/song/")) return await song(req, env, p.slice(6));
      if (p === "/" || p === "/index.html") return await home(req, env);
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
    const c = await loadContent(env);
    const books = c.books.map((b) => ({ id: b.id, title: b.title, kind: b.kind, read_url: b.read_url,
      formats: b.formats.map((f) => ({ id: f.id, kind: f.kind, label: f.label, price: buyable(f) ? f.price : null, shop_url: f.shop_url })) }));
    return json({ ok: true, books, bot: env.BOT_USERNAME || "" }, 200, { "cache-control": "max-age=60" });
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
    const phone = clean(body.phone, 40);
    const address = clean(body.address, 400);
    const print = body.kind === "print";
    if (!name) return bad("Укажите, как к вам обращаться");
    if (print && (!phone || !address)) return bad("Для печатной книги укажите телефон и адрес доставки с индексом");
    if (!print && !email && !telegram) return bad("Укажите e-mail или Telegram, чтобы автор мог прислать книгу");
    if (email && !isEmail(email)) return bad("Проверьте e-mail");
    if (!body.consent) return bad("Нужно согласие на обработку персональных данных");
    const { order, book, format } = await createOrder(env, {
      format_id: Number(body.format) || null, book_id: clean(body.book, 30), name, email, telegram,
      phone: print ? phone : "", address: print ? address : "", source: "site" });
    const bot = env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=o${order.id}_${order.link_code}` : "";
    return json({ ok: true, id: order.id, title: book.title, price: order.price, kind: format.kind, bot });
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
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(d.order_id).first();
  const f = await orderFormat(env, o);
  const obj = env.BOOKS && f.file_key ? await env.BOOKS.head(f.file_key) : null;
  if (!obj) return page("Файл временно недоступен", "Автор уже знает об этом и пришлёт книгу.");
  await env.DB.prepare("UPDATE downloads SET uses_left=uses_left-1 WHERE token=?").bind(token).run();
  await track(env, "download", o.book_id);
  const name = f.file_name || `${f.title}${(f.file_key.match(/\.\w+$/) || [".epub"])[0]}`;
  return serveObject(new Request("https://x/"), env, f.file_key, { download: name, cache: "no-store" });
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

  if (route === "upload" && req.method === "PUT") {
    try { return json({ ok: true, ...(await upload(req, env, url)) }); } catch (e) { return bad(e.message); }
  }
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
      const songs = await all("SELECT title,plays,downloads FROM songs ORDER BY downloads DESC, plays DESC LIMIT 10");
      const formatsSold = await all(
        `SELECT f.kind, COUNT(o.id) orders, SUM(CASE WHEN o.status IN ('paid','sent') THEN o.price ELSE 0 END) revenue
         FROM orders o LEFT JOIN formats f ON f.id=o.format_id WHERE date(o.created)>=? GROUP BY f.kind`, from);
      return json({ ok: true, from, days, series, shops, books, sales, funnel, counts, songs, formatsSold, r2: !!env.BOOKS, botLinked: !!(await setting(env, "admin_chat")) });
    }
    case "orders":
      return json({ ok: true, items: await all(
        `SELECT o.*, b.title, f.kind format_kind, f.label format_label, f.file_key IS NOT NULL has_file
         FROM orders o JOIN books b ON b.id=o.book_id LEFT JOIN formats f ON f.id=o.format_id ORDER BY o.id DESC LIMIT 500`) });
    case "order": {
      const id = Number(body.id);
      if (body.action === "deliver") {
        const r = await payAndDeliver(env, id);
        return json({ ok: true, order: r.order, url: r.url, delivered: r.delivered, print: !!r.print, nofile: !!r.nofile });
      }
      if (body.action === "link") return json({ ok: true, url: await makeDownload(env, id) });
      if (body.action === "status") {
        const allowed = ["new", "waiting", "paid", "sent", "cancelled"];
        if (!allowed.includes(body.status)) return bad("Неизвестный статус");
        return json({ ok: true, order: await setStatus(env, id, body.status, clean(body.note ?? "", 1000)) });
      }
      if (body.action === "create") {
        const { order } = await createOrder(env, { format_id: Number(body.format) || null, book_id: clean(body.book || "", 30), name: clean(body.name, 100), email: clean(body.email, 120),
          telegram: tgHandle(body.telegram || ""), phone: clean(body.phone || "", 40), address: clean(body.address || "", 400), source: "crm" });
        return json({ ok: true, order });
      }
      return bad("Неизвестное действие");
    }
    case "books": {
      // каталог целиком: книги, форматы, отрывки (для CRM)
      return json({ ok: true, r2: !!env.BOOKS,
        items: await all("SELECT * FROM books ORDER BY featured DESC, sort, title"),
        formats: await all("SELECT * FROM formats ORDER BY book_id, sort, id") });
    }
    case "book-save": {
      const title = clean(body.title, 200);
      if (!title) return bad("Укажите название");
      const kind = ["roman", "stories", "poetry"].includes(body.kind) ? body.kind : "roman";
      const f = [title, kind, clean(body.genre ?? "", 120) || null, clean(String(body.series ?? ""), 10) || null, clean(body.annotation ?? "", 4000) || null,
        clean(body.cover ?? "", 300) || null, clean(body.read_url ?? "", 300) || null, Math.round(Number(body.sort) || 100), body.shown ? 1 : 0, body.featured ? 1 : 0];
      let id = clean(body.id || "", 30);
      if (id) {
        await DB.prepare("UPDATE books SET title=?,kind=?,genre=?,series=?,annotation=?,cover=?,read_url=?,sort=?,shown=?,featured=? WHERE id=?").bind(...f, id).run();
      } else {
        id = "b" + Date.now().toString(36);
        await DB.prepare("INSERT INTO books(id,title,price,active,kind,genre,series,annotation,cover,read_url,sort,shown,featured) VALUES(?,?,0,0,?,?,?,?,?,?,?,?,?)").bind(id, ...f).run();
      }
      if (body.featured) await DB.prepare("UPDATE books SET featured=0 WHERE id<>?").bind(id).run();
      return json({ ok: true, id });
    }
    case "book-delete": {
      const id = clean(body.id, 30);
      const used = await DB.prepare("SELECT COUNT(*) n FROM orders WHERE book_id=?").bind(id).first();
      if (used.n) {
        await DB.prepare("UPDATE books SET shown=0 WHERE id=?").bind(id).run();
        return json({ ok: true, hidden: true });
      }
      for (const f of await all("SELECT file_key,sample_key FROM formats WHERE book_id=?", id)) { await removeObject(env, f.file_key); await removeObject(env, f.sample_key); }
      await DB.batch([DB.prepare("DELETE FROM formats WHERE book_id=?").bind(id), DB.prepare("UPDATE excerpts SET book_id=NULL WHERE book_id=?").bind(id), DB.prepare("DELETE FROM books WHERE id=?").bind(id)]);
      return json({ ok: true });
    }
    case "format-save": {
      const kind = ["ebook", "print", "audio"].includes(body.kind) ? body.kind : null;
      const book = clean(body.book_id, 30);
      if (!kind || !(await getBook(env, book))) return bad("Укажите книгу и вид издания");
      const price = body.price === "" || body.price == null ? null : Math.max(0, Math.round(Number(body.price) || 0));
      const f = [kind, clean(body.label ?? "", 120) || null, price, clean(body.file_key ?? "", 300) || null, clean(body.file_name ?? "", 200) || null,
        clean(body.shop_url ?? "", 500) || null, clean(body.shop_name ?? "", 80) || null, clean(body.sample_key ?? "", 300) || null,
        body.active ? 1 : 0, Math.round(Number(body.sort) || 0)];
      if (f[5] && !/^https?:\/\//.test(f[5])) return bad("Ссылка на магазин должна начинаться с https://");
      if (body.id) {
        const old = await DB.prepare("SELECT * FROM formats WHERE id=?").bind(Number(body.id)).first();
        if (old && old.file_key && old.file_key !== f[3]) await removeObject(env, old.file_key);
        if (old && old.sample_key && old.sample_key !== f[7]) await removeObject(env, old.sample_key);
        await DB.prepare("UPDATE formats SET kind=?,label=?,price=?,file_key=?,file_name=?,shop_url=?,shop_name=?,sample_key=?,active=?,sort=? WHERE id=?").bind(...f, Number(body.id)).run();
      } else {
        await DB.prepare("INSERT INTO formats(kind,label,price,file_key,file_name,shop_url,shop_name,sample_key,active,sort,book_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(...f, book).run();
      }
      // прежний код и бот: books.active/price отражают продажу EPUB у автора
      const eb = await DB.prepare("SELECT price,active,file_key,file_name FROM formats WHERE book_id=? AND kind='ebook' ORDER BY sort,id LIMIT 1").bind(book).first();
      await DB.prepare("UPDATE books SET price=?, active=?, epub_key=COALESCE(?,epub_key), epub_name=COALESCE(?,epub_name) WHERE id=?")
        .bind(eb && eb.price ? eb.price : 0, eb && eb.active && eb.price > 0 ? 1 : 0, eb ? eb.file_key : null, eb ? eb.file_name : null, book).run();
      return json({ ok: true });
    }
    case "format-delete": {
      const f = await DB.prepare("SELECT * FROM formats WHERE id=?").bind(Number(body.id)).first();
      if (!f) return json({ ok: true });
      const used = await DB.prepare("SELECT COUNT(*) n FROM orders WHERE format_id=?").bind(f.id).first();
      if (used.n) { await DB.prepare("UPDATE formats SET active=0 WHERE id=?").bind(f.id).run(); return json({ ok: true, hidden: true }); }
      await removeObject(env, f.file_key); await removeObject(env, f.sample_key);
      await DB.prepare("DELETE FROM formats WHERE id=?").bind(f.id).run();
      return json({ ok: true });
    }
    case "excerpts":
      if (req.method === "POST") {
        const title = clean(body.title, 200), text = clean(body.body, 60000);
        if (!title || !text) return bad("Нужны заголовок и текст");
        const f = [clean(body.book_id || "", 30) || null, title, text, body.published ? 1 : 0, Math.round(Number(body.sort) || 0)];
        if (body.id) await DB.prepare("UPDATE excerpts SET book_id=?,title=?,body=?,published=?,sort=?,updated=datetime('now') WHERE id=?").bind(...f, Number(body.id)).run();
        else await DB.prepare("INSERT INTO excerpts(book_id,title,body,published,sort) VALUES(?,?,?,?,?)").bind(...f).run();
      }
      return json({ ok: true, items: await all("SELECT * FROM excerpts ORDER BY sort, id DESC") });
    case "excerpt-delete":
      await DB.prepare("DELETE FROM excerpts WHERE id=?").bind(Number(body.id)).run();
      return json({ ok: true });
    case "songs":
      if (req.method === "POST") {
        const title = clean(body.title, 200);
        if (!title) return bad("Укажите название песни");
        const ext = clean(body.ext_url ?? "", 500) || null;
        if (ext && !/^https?:\/\//.test(ext)) return bad("Ссылка должна начинаться с https://");
        const f = [title, clean(body.poem ?? "", 200) || null, clean(body.lyrics ?? "", 20000) || null, clean(body.performer ?? "", 200) || null,
          clean(body.music_by ?? "", 200) || null, clean(body.note ?? "", 1000) || null, clean(body.file_key ?? "", 300) || null,
          clean(body.file_name ?? "", 200) || null, Number(body.file_size) || null, ext, body.published ? 1 : 0, Math.round(Number(body.sort) || 0)];
        if (body.id) {
          const old = await DB.prepare("SELECT file_key FROM songs WHERE id=?").bind(Number(body.id)).first();
          if (old && old.file_key && old.file_key !== f[6]) await removeObject(env, old.file_key);
          await DB.prepare("UPDATE songs SET title=?,poem=?,lyrics=?,performer=?,music_by=?,note=?,file_key=?,file_name=?,file_size=?,ext_url=?,published=?,sort=?,updated=datetime('now') WHERE id=?").bind(...f, Number(body.id)).run();
        } else {
          await DB.prepare("INSERT INTO songs(title,poem,lyrics,performer,music_by,note,file_key,file_name,file_size,ext_url,published,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(...f).run();
        }
      }
      return json({ ok: true, r2: !!env.BOOKS, items: await all("SELECT * FROM songs ORDER BY sort, id DESC") });
    case "song-delete": {
      const s = await DB.prepare("SELECT file_key FROM songs WHERE id=?").bind(Number(body.id)).first();
      if (s) await removeObject(env, s.file_key);
      await DB.prepare("DELETE FROM songs WHERE id=?").bind(Number(body.id)).run();
      return json({ ok: true });
    }
    case "poems": {
      // стихи с сайта — для выбора стихотворения у песни
      return json({ ok: true, items: poems.map((p) => p.t) });
    }
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
      const q = { orders: "SELECT o.id,o.created,b.title,f.kind format,f.label,o.price,o.name,o.email,o.telegram,o.phone,o.address,o.status,o.paid_at,o.sent_at,o.note FROM orders o JOIN books b ON b.id=o.book_id LEFT JOIN formats f ON f.id=o.format_id ORDER BY o.id",
        songs: "SELECT id,created,title,poem,performer,music_by,plays,downloads,published FROM songs ORDER BY id",
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

// ---------------------------------------------------------------- страница и файлы
async function home(req, env) {
  const html = await renderIndex(env, TEMPLATE);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}

async function media(req, env, key) {
  if (!PUBLIC_PREFIXES.some((p) => key.startsWith(p)) || key.includes("..")) return new Response("Не найдено", { status: 404 });
  return serveObject(req, env, key);
}

// /song/<id>/play — слушать на сайте, /song/<id>/download — скачать
async function song(req, env, rest) {
  const [id, action] = rest.split("/");
  const s = await env.DB.prepare("SELECT * FROM songs WHERE id=? AND published=1").bind(Number(id)).first();
  if (!s) return new Response("Песня не найдена", { status: 404 });
  if (!s.file_key) return s.ext_url ? Response.redirect(s.ext_url, 302) : new Response("Файл не загружен", { status: 404 });
  const range = req.headers.get("range");
  if (action === "download") {
    await env.DB.prepare("UPDATE songs SET downloads=downloads+1 WHERE id=?").bind(s.id).run();
    await track(env, "song_dl", String(s.id));
    const ext = (s.file_key.match(/\.\w+$/) || [".mp3"])[0];
    return serveObject(req, env, s.file_key, { download: s.file_name || `Василий Попков — ${s.title}${ext}` });
  }
  if (!range || /^bytes=0-/.test(range)) await env.DB.prepare("UPDATE songs SET plays=plays+1 WHERE id=?").bind(s.id).run();
  return serveObject(req, env, s.file_key);
}
