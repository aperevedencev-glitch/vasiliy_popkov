-- Сайт писателя Василия Попкова: CRM, продажи EPUB, аналитика

CREATE TABLE books (
  id         TEXT PRIMARY KEY,          -- короткий код книги
  jaaj_id    INTEGER,
  title      TEXT NOT NULL,
  price      INTEGER NOT NULL,          -- рубли
  epub_key   TEXT,                      -- ключ файла в R2
  epub_name  TEXT,                      -- имя файла для покупателя
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  updated    TEXT NOT NULL DEFAULT (datetime('now')),
  book_id    TEXT NOT NULL REFERENCES books(id),
  price      INTEGER NOT NULL,
  name       TEXT,
  email      TEXT,
  telegram   TEXT,
  chat_id    INTEGER,                   -- чат покупателя в боте
  link_code  TEXT,                      -- для привязки заявки к боту
  source     TEXT NOT NULL DEFAULT 'site',  -- site | bot | crm
  status     TEXT NOT NULL DEFAULT 'new',   -- new | waiting | paid | sent | cancelled
  paid_at    TEXT,
  sent_at    TEXT,
  note       TEXT
);
CREATE INDEX orders_status ON orders(status);

CREATE TABLE downloads (
  token      TEXT PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  expires    TEXT NOT NULL,
  uses_left  INTEGER NOT NULL DEFAULT 3,
  created    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  name       TEXT,
  email      TEXT UNIQUE,
  chat_id    INTEGER UNIQUE,
  source     TEXT NOT NULL DEFAULT 'site',
  active     INTEGER NOT NULL DEFAULT 1
);

-- обращения: вопросы автору и предложения о сотрудничестве
CREATE TABLE leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  kind       TEXT NOT NULL,              -- question | partner
  name       TEXT,
  contact    TEXT,
  org        TEXT,
  message    TEXT,
  chat_id    INTEGER,
  status     TEXT NOT NULL DEFAULT 'new',  -- new | answered | closed
  answer     TEXT
);

CREATE TABLE partners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  updated    TEXT NOT NULL DEFAULT (datetime('now')),
  name       TEXT NOT NULL,
  kind       TEXT,                       -- издательство | библиотека | конкурс | магазин | СМИ | другое
  contact    TEXT,
  stage      TEXT NOT NULL DEFAULT 'contact', -- contact | talks | agreed | active | paused
  next_step  TEXT,
  next_date  TEXT,
  note       TEXT
);

-- агрегированная аналитика без персональных данных
CREATE TABLE events (
  day        TEXT NOT NULL,
  type       TEXT NOT NULL,              -- view | shop | book | buy_open | order | subscribe | lead | download | bot_start | poem
  target     TEXT NOT NULL DEFAULT '',
  n          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, type, target)
);

CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);

INSERT INTO books (id, jaaj_id, title, price, epub_key, epub_name) VALUES
 ('zoloto',     432, 'Золото империи',          399, 'epub/zoloto-imperii.epub',          'Василий Попков — Золото империи.epub'),
 ('libereya',   418, 'Либерея. Печать молчания', 399, 'epub/libereya-pechat-molchaniya.epub', 'Василий Попков — Либерея. Печать молчания.epub'),
 ('morskaya',   431, 'Морская звезда',          399, 'epub/morskaya-zvezda.epub',         'Василий Попков — Морская звезда.epub'),
 ('inkognito',  435, 'Инкогнито',               399, 'epub/inkognito.epub',               'Василий Попков — Инкогнито.epub'),
 ('kristall',   414, 'Кристалл счастья',        399, 'epub/kristall-schastya.epub',       'Василий Попков — Кристалл счастья.epub'),
 ('sertifikat', 421, 'Сертификат гениальности', 399, 'epub/sertifikat-genialnosti.epub',  'Василий Попков — Сертификат гениальности.epub'),
 ('ispoved',    427, 'Исповедь',                199, 'epub/ispoved.epub',                 'Василий Попков — Исповедь. Рассказы ни о чём.epub');
