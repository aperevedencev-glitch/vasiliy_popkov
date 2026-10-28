// Страница сайта: каталог, отрывки и песни из базы подставляются в шаблон на сервере
import { FORMAT_NAME, buyable } from "./orders.js";

const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Number(n).toLocaleString("ru-RU") + " ₽";
const SERIES = "«Сокровища заброшенных усадеб»";
const KIND_SHORT = { ebook: "Электронная", print: "Печатная", audio: "Аудио" };

export async function loadContent(env) {
  const q = async (sql) => (await env.DB.prepare(sql).all()).results;
  const [books, formats, excerpts, songs] = await Promise.all([
    q("SELECT * FROM books WHERE shown=1 ORDER BY featured DESC, sort, title"),
    q("SELECT * FROM formats WHERE active=1 ORDER BY sort, id"),
    q("SELECT id,book_id,title,body FROM excerpts WHERE published=1 ORDER BY sort, id DESC"),
    q("SELECT id,title,poem,lyrics,performer,music_by,note,file_key,file_name,file_type,ext_url FROM songs WHERE published=1 ORDER BY sort, id DESC"),
  ]);
  const byBook = new Map(books.map((b) => [b.id, { ...b, formats: [], excerpts: [] }]));
  for (const f of formats) byBook.get(f.book_id)?.formats.push(f);
  for (const e of excerpts) byBook.get(e.book_id)?.excerpts.push(e);
  return { books: [...byBook.values()], excerpts, songs, titles: new Map(books.map((b) => [b.id, b.title])) };
}

// кнопки форматов у книги: купить у автора, купить в магазине, послушать фрагмент
function formatButtons(b) {
  const out = [];
  for (const f of b.formats) {
    const name = KIND_SHORT[f.kind] || f.kind;
    const label = f.label ? ` · ${h(f.label)}` : "";
    if (buyable(f))
      out.push(`<button type="button" class="buy" data-format="${f.id}" data-kind="${f.kind}" data-title="${h(b.title)}" data-what="${h(FORMAT_NAME[f.kind])}${label}" data-price="${f.price}">${name}${label} · <span class="price">${money(f.price)}</span></button>`);
    if (f.shop_url)
      out.push(`<a class="fmt" href="${h(f.shop_url)}" target="_blank" rel="noopener" data-ev="shop" data-target="${h(f.shop_name || name)}">${name}${buyable(f) ? "" : label} — ${h(f.shop_name || "в магазине")}</a>`);
    if (f.sample_key)
      out.push(`<button type="button" class="listen" data-src="/media/${h(f.sample_key)}" data-title="${h(b.title)}">Слушать фрагмент</button>`);
  }
  for (const e of b.excerpts)
    out.push(`<button type="button" class="exc" data-ex="${e.id}">Отрывок${b.excerpts.length > 1 ? ": " + h(e.title) : ""}</button>`);
  return out.length ? `<div class="fmts">${out.join("")}</div>` : "";
}

function bookCard(b, n) {
  const kinds = [...new Set(b.formats.map((f) => f.kind))].join(" ");
  const read = b.read_url ? `<a class="go" href="${h(b.read_url)}" target="_blank" rel="noopener" data-ev="book" data-target="${h(b.jaaj_id || b.id)}">Читать на Jaaj.Club</a>` : "";
  const cover = b.cover ? `<img src="${h(b.cover)}" alt="Обложка книги «${h(b.title)}»" loading="lazy" width="420" height="630">` : `<span class="nocover">${h(b.title)}</span>`;
  return `<article class="book" id="book-${h(b.id)}" data-kind="${h(b.kind)}" data-formats="${kinds}">
  ${b.read_url ? `<a class="cover" href="${h(b.read_url)}" target="_blank" rel="noopener">${cover}</a>` : `<span class="cover">${cover}</span>`}
  <div class="meta">
    <p class="shelf">Дело № ${String(n).padStart(2, "0")}${b.genre ? " · " + h(b.genre) : ""}</p>
    <h3>${h(b.title)}</h3>${b.series ? `<span class="series">${SERIES} · книга ${h(b.series)}</span>` : ""}
    ${b.annotation ? `<p class="ann">${h(b.annotation)}</p>` : ""}
    ${formatButtons(b)}${read}
  </div>
</article>`;
}

function hero(b) {
  if (!b) return "";
  return `<aside class="feature">
    ${b.cover ? `<img src="${h(b.cover)}" alt="Обложка книги «${h(b.title)}»" width="420" height="630">` : ""}
    <p class="label">Дело № 01${b.genre ? " · " + h(b.genre) : ""}</p>
    <h2>${h(b.title)}</h2>
    ${b.annotation ? `<p>${h(b.annotation)}</p>` : ""}
    ${formatButtons(b)}
    ${b.read_url ? `<a class="btn" href="${h(b.read_url)}" target="_blank" rel="noopener" data-ev="book" data-target="${h(b.jaaj_id || b.id)}">Читать на Jaaj.Club</a>` : ""}
  </aside>`;
}

// абзацы текста: пустая строка — новый абзац, перевод строки — <br>
export const paragraphs = (t) =>
  String(t || "").trim().split(/\n\s*\n/).map((p) => `<p>${h(p).replace(/\n/g, "<br>")}</p>`).join("");

function excerptsHtml(list, titles) {
  if (!list.length) return "";
  return `<section id="excerpts"><div class="wrap">
  <div class="head"><div><p class="label">Из материалов дела</p><h2>Отрывки</h2></div></div>
  <div class="excerpts">
${list.map((e) => `    <article class="excerpt" id="excerpt-${e.id}">
      <p class="shelf">${e.book_id && titles.get(e.book_id) ? "«" + h(titles.get(e.book_id)) + "»" : "Отрывок"}</p>
      <h3>${h(e.title)}</h3>
      <div class="exbody">${paragraphs(e.body)}</div>
      <button type="button" class="exc" data-ex="${e.id}">Читать полностью</button>
    </article>`).join("\n")}
  </div>
</div></section>`;
}

function songsHtml(list) {
  if (!list.length) return "";
  return `<section id="songs"><div class="wrap">
  <div class="head"><div><p class="label">Песни на стихи автора</p><h2>Песни</h2></div></div>
  <div class="songs">
${list.map((s) => {
    const credits = [s.performer && `Исполняет: ${h(s.performer)}`, s.music_by && `Музыка: ${h(s.music_by)}`].filter(Boolean).join(" · ");
    const play = s.file_key
      ? `<audio controls preload="none" src="/song/${s.id}/play" data-song="${s.id}"></audio>
      <a class="btn small" href="/song/${s.id}/download" data-ev="song_dl" data-target="${s.id}">Скачать${s.file_name && /\.(\w+)$/.test(s.file_name) ? " " + h(s.file_name.match(/\.(\w+)$/)[1].toUpperCase()) : ""}</a>`
      : s.ext_url ? `<a class="btn small" href="${h(s.ext_url)}" target="_blank" rel="noopener" data-ev="song_dl" data-target="${s.id}">Слушать</a>` : "";
    return `    <article class="song" id="song-${s.id}">
      <h3>${h(s.title)}</h3>
      ${s.poem ? `<p class="shelf">на стихи «${h(s.poem)}»</p>` : ""}${credits ? `<p class="credits">${credits}</p>` : ""}
      ${s.note ? `<p class="note">${h(s.note)}</p>` : ""}
      <div class="player">${play}</div>
      ${s.lyrics ? `<details><summary>Текст песни</summary><div class="lyrics">${paragraphs(s.lyrics)}</div></details>` : ""}
    </article>`;
  }).join("\n")}
  </div>
</div></section>`;
}

// полные тексты отрывков для окна чтения
function excerptData(list, titles) {
  const data = Object.fromEntries(list.map((e) => [e.id, { t: e.title, b: e.book_id ? titles.get(e.book_id) || "" : "", h: paragraphs(e.body) }]));
  return `<script type="application/json" id="exData">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

export async function renderIndex(env, template) {
  const c = await loadContent(env);
  const feat = c.books.find((b) => b.featured) || null;
  const list = c.books.filter((b) => b !== feat);
  const kinds = new Set(c.books.flatMap((b) => b.formats.map((f) => f.kind)));
  const filters = [["ebook", "Электронные"], ["print", "Печатные"], ["audio", "Аудиокниги"]]
    .filter(([k]) => kinds.has(k))
    .map(([k, t]) => `<button type="button" id="f-${k}" data-f="${k}" aria-pressed="false">${t}</button>`).join("\n      ");
  const nav = [c.excerpts.length && `<li><a href="#excerpts">Отрывки</a></li>`, c.songs.length && `<li><a href="#songs">Песни</a></li>`].filter(Boolean).join("\n    ");
  return template
    .replace("<!--HERO-->", hero(feat))
    .replace("<!--BOOKS-->", list.map((b, i) => bookCard(b, i + (feat ? 2 : 1))).join("\n"))
    .replace("<!--FORMAT_FILTERS-->", filters)
    .replaceAll("<!--BOOK_COUNT-->", String(c.books.length))
    .replace("<!--CASES-->", plural(c.books.length, "дело", "дела", "дел"))
    .replace("<!--BOOKS_WORD-->", plural(c.books.length, "книга", "книги", "книг"))
    .replace("<!--NAV_EXTRA-->", nav)
    .replace("<!--EXCERPTS-->", excerptsHtml(c.excerpts, c.titles))
    .replace("<!--SONGS-->", songsHtml(c.songs))
    .replace("<!--EXCERPT_DATA-->", excerptData(c.excerpts, c.titles));
}
