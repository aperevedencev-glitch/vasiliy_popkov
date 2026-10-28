// Файлы в хранилище R2: обложки, фрагменты аудиокниг, песни, файлы для покупателей

// открытые для всех папки; файлы для покупателей (epub/, files/) отдаются только по ссылке из заявки
export const PUBLIC_PREFIXES = ["covers/", "samples/", "songs/"];
export const UPLOAD_PREFIXES = ["covers", "samples", "songs", "files"];
export const MAX_UPLOAD = 95 * 1024 * 1024; // ограничение запроса Cloudflare — 100 МБ

const TYPES = {
  epub: "application/epub+zip", pdf: "application/pdf", fb2: "application/x-fictionbook+xml", zip: "application/zip",
  mp3: "audio/mpeg", m4a: "audio/mp4", m4b: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};
export const typeOf = (name) => TYPES[(String(name).match(/\.(\w+)$/) || [])[1]?.toLowerCase()] || "application/octet-stream";

// безопасное имя файла для ключа: латиница, цифры, точки, дефисы
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function slug(name) {
  const s = String(name).toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? "");
  const m = s.match(/^(.*?)(\.[a-z0-9]{1,5})?$/);
  const base = (m[1] || "file").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  return base + (m[2] || "");
}

export function attachment(name) {
  const ascii = slug(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/* Отдать объект R2 с поддержкой Range (перемотка в плеере). opts.download — скачать с именем файла */
export async function serveObject(req, env, key, opts = {}) {
  if (!env.BOOKS) return new Response("Хранилище файлов не подключено", { status: 503 });
  const obj = await env.BOOKS.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("Файл не найден", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.get("content-type")) headers.set("content-type", typeOf(key));
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", opts.cache || "public, max-age=86400");
  if (opts.download) headers.set("content-disposition", attachment(opts.download));
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  const r = obj.range;
  if (r && req.headers.get("range")) {
    const offset = "suffix" in r ? obj.size - r.suffix : r.offset || 0;
    const length = "suffix" in r ? r.suffix : r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// загрузка из CRM: тело запроса целиком идёт в R2
export async function upload(req, env, url) {
  if (!env.BOOKS) throw new Error("Хранилище файлов R2 не включено. Включите R2 в Cloudflare и запустите «Развернуть сайт.bat».");
  const prefix = url.searchParams.get("prefix");
  const name = (url.searchParams.get("name") || "file").slice(0, 200);
  if (!UPLOAD_PREFIXES.includes(prefix)) throw new Error("Неизвестная папка");
  const size = Number(req.headers.get("content-length") || 0);
  if (size > MAX_UPLOAD) throw new Error("Файл больше 95 МБ — разделите его на части или дайте ссылку на внешний сервис");
  const key = `${prefix}/${Date.now().toString(36)}-${slug(name)}`;
  const obj = await env.BOOKS.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") || typeOf(name) } });
  return { key, name, size: obj ? obj.size : size, type: typeOf(name) };
}

export async function removeObject(env, key) {
  if (env.BOOKS && key && !key.startsWith("epub/")) await env.BOOKS.delete(key);
}
