-- Каталог на сайте из базы: форматы (электронные, печатные, аудио), отрывки, песни.
-- Совместимо с прежним кодом: books.active по-прежнему означает «EPUB продаётся».

ALTER TABLE books ADD COLUMN kind TEXT NOT NULL DEFAULT 'roman';   -- roman | stories | poetry
ALTER TABLE books ADD COLUMN genre TEXT;
ALTER TABLE books ADD COLUMN series TEXT;                           -- номер в серии «Сокровища заброшенных усадеб»
ALTER TABLE books ADD COLUMN annotation TEXT;
ALTER TABLE books ADD COLUMN cover TEXT;                            -- /covers/…jpg или /media/covers/…
ALTER TABLE books ADD COLUMN read_url TEXT;                         -- где читать онлайн (Jaaj.Club)
ALTER TABLE books ADD COLUMN sort INTEGER NOT NULL DEFAULT 100;
ALTER TABLE books ADD COLUMN shown INTEGER NOT NULL DEFAULT 1;      -- показывать на сайте
ALTER TABLE books ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;   -- главная книга в шапке

CREATE TABLE formats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    TEXT NOT NULL REFERENCES books(id),
  kind       TEXT NOT NULL,              -- ebook | print | audio
  label      TEXT,                       -- «EPUB», «Твёрдый переплёт, 320 с.», «MP3, 9 ч»
  price      INTEGER,                    -- цена у автора; пусто — продаётся только в магазине
  file_key   TEXT,                       -- файл в R2 для выдачи после оплаты
  file_name  TEXT,                       -- имя файла для покупателя
  shop_url   TEXT,                       -- ссылка на магазин
  shop_name  TEXT,
  sample_key TEXT,                       -- фрагмент аудиокниги в R2 (слушать на сайте)
  active     INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX formats_book ON formats(book_id);

ALTER TABLE orders ADD COLUMN format_id INTEGER;
ALTER TABLE orders ADD COLUMN phone TEXT;
ALTER TABLE orders ADD COLUMN address TEXT;

CREATE TABLE excerpts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  updated    TEXT NOT NULL DEFAULT (datetime('now')),
  book_id    TEXT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  published  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE songs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created    TEXT NOT NULL DEFAULT (datetime('now')),
  updated    TEXT NOT NULL DEFAULT (datetime('now')),
  title      TEXT NOT NULL,
  poem       TEXT,                       -- на какое стихотворение
  lyrics     TEXT,
  performer  TEXT,
  music_by   TEXT,
  note       TEXT,
  file_key   TEXT,                       -- аудио в R2
  file_name  TEXT,
  file_type  TEXT,
  file_size  INTEGER,
  ext_url    TEXT,                       -- или ссылка на внешний сервис
  published  INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  plays      INTEGER NOT NULL DEFAULT 0,
  downloads  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j445', 445, 'Петля Козырева', 0, 0, 'roman', 'Мистический триллер', NULL, 'Гениальный разработчик нейроинтерфейсов Алексей покупает старый особняк. Прежний владелец — профессор астрофизики — покончил с собой при странных обстоятельствах. В круглой спальне остались зеркала Козырева — пять вогнутых алюминиевых панелей, которые, по слухам, улавливают «энергию времени». В подвале Алексей запускает систему «Гипнос», превращающую энергию ночных кошмаров в электричество. Доза растёт. Дом требует боль.', '/covers/445.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=445', 1, 1, 1);
UPDATE books SET title='Инкогнито', kind='roman', genre='Роман-расследование', series=NULL, annotation='Чудов монастырь, 1601 год. Беглый инок Григорий Отрепьев на цепи, в бреду, видит то, чего не мог знать: Углич, кровь на снегу, лицо убитого царевича. Спустя двадцать лет архивариус Корецкий найдёт в пыльных свитках улики, за которые убивают. Двойная подмена, три неразличимых ребёнка и мать, не знающая, кого она похоронила.', cover='/covers/435.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=435', sort=2, shown=1, featured=0 WHERE id='inkognito';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j459', 459, 'Люди из леса', 0, 0, 'roman', 'Интеллектуальный детектив', '6', 'Лишённые имён, прошлого и привычной жизни, Илья Прохоров и его друзья вынуждены скрываться от всевидящей «Алетейи». Случайная находка выводит их на след человека, стоявшего у истоков могущественной системы, и раскрывает замысел, способный изменить всё человечество.', '/covers/459.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=459', 3, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j458', 458, 'Конец белого лотоса', 0, 0, 'roman', 'Интеллектуальный детектив', '5', 'Исчезновение швейцарского учёного выводит команду «Архивной правды» на след тайного проекта, способного управлять человеческой памятью и переписывать историю. Расследование ведёт от секретов советских спецслужб к арктическим базам и загадочному «Белому Лотосу».', '/covers/458.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=458', 4, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j457', 457, 'Общество посвящённых', 0, 0, 'roman', 'Интеллектуальный детектив', '4', 'Поиски загадочного «Ломоносовского кодекса» выводят команду «Архивной правды» на след тайного Общества, чьи корни уходят в глубину веков. Главная загадка — не в том, как обрести знание, а в том, имеет ли кто-нибудь право им воспользоваться.', '/covers/457.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=457', 5, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j442', 442, 'Протокол «Мёртвая петля»', 0, 0, 'roman', 'Историко-детективный роман', NULL, 'Они искали золото Российской империи. Вместо него нашли протокол «Мёртвая петля» — план исчезновения казны, который использовали и в 1918-м, и в 1991-м. Следователь, блогерша и хакер пускаются в гонку со временем, но каждый шестой шаг оборачивается ловушкой.', '/covers/442.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=442', 6, 1, 0);
UPDATE books SET title='Золото империи', kind='roman', genre='Историко-детективный роман', series=NULL, annotation='В ноябре 1919 года бесследно исчезает литерный эшелон с частью золотого запаса Российской империи. Спустя сто лет на дне Байкала находят один из его вагонов, но вместо золота внутри — свинец. За расследование берётся бывший аналитик Интерпола Алексей Романов.', cover='/covers/432.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=432', sort=7, shown=1, featured=0 WHERE id='zoloto';
UPDATE books SET title='Морская звезда', kind='roman', genre='Психологический детектив', series=NULL, annotation='Архитектор Анна Ковалёва, пятнадцать лет назад уехавшая из приморского города Железный мыс, получает известие о гибели отца — владельца местной верфи. Город словно договорился держаться одной версии, а в памяти Анны всплывает страшная ночь у старого маяка.', cover='/covers/431.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=431', sort=8, shown=1, featured=0 WHERE id='morskaya';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j426', 426, 'Тайна янтарной комнаты', 0, 0, 'roman', 'Военный детектив', NULL, 'Осень 1944 года. Медсестра Анна получает от умирающего разведчика записку, ведущую к тайне исчезнувшей Янтарной комнаты. Вместе с лейтенантом Марком она отправляется в разрушенный Ленинград, чтобы найти тайник с именами предателей.', '/covers/426.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=426', 9, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j424', 424, 'Эра равновесия', 0, 0, 'roman', 'Философская фантастика', NULL, 'Что, если правда станет источником энергии, а ложь — преступлением? Утопия, основанная на честности, оборачивается адом: искусство, любовь и дипломатия исчезают, а человечество ищет спасения в «Клубах Лжи». Финал переворачивает всё с ног на голову.', '/covers/424.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=424', 10, 1, 0);
UPDATE books SET title='Сертификат гениальности', kind='roman', genre='Интеллектуальный триллер', series=NULL, annotation='Искусствовед Анна Фальк становится свидетельницей загадочной сделки на крупнейшем аукционе мира. Расследование приводит её к тайной организации, которая превращает человеческое безумие в источник миллиардов и решает, кого считать гением.', cover='/covers/421.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=421', sort=11, shown=1, featured=0 WHERE id='sertifikat';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j420', 420, 'Крушение империи', 0, 0, 'roman', 'Историко-детективный роман', NULL, 'Историк Михаил Кузьмин-Караваев находит дневник прадеда — протоколиста тайного общества, готовившего отречение Николая II. Забытые документы ведут к тайне последних дней Российской империи, которая не должна была пережить свой век.', '/covers/420.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=420', 12, 1, 0);
UPDATE books SET title='Тайна Либереи', kind='roman', genre='Историко-детективный роман', series=NULL, annotation='При реставрации в Грановитой палате находят загадочный перстень и зашифрованный пергамент, связанные с библиотекой Ивана Грозного. Бывший следователь Сергей Воронов понимает: за артефактом охотятся не только историки.', cover='/covers/418.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=418', sort=13, shown=1, featured=0 WHERE id='libereya';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j416', 416, 'Тридцать шестая буква', 0, 0, 'roman', 'Историко-детективный роман', NULL, 'Осенью 1796 года умирающая Екатерина II тайными чернилами вписывает на полях «Кормчей книги» свои сокровенные и весьма смелые мысли — «Тридцать шестую букву». Книгу она прячет в тайник. В последующие два века за ней охотились, из-за неё убивали и предавали.', '/covers/416.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=416', 14, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j415', 415, 'Хранитель тени', 0, 0, 'roman', 'Интеллектуальный детектив', '2', 'Архивариус Илья Прохоров получает заказ разобрать документы старинной усадьбы рода Орловых и находит записи о череде загадочных смертей, преследовавших семью много поколений. Расследование затягивает его в паутину лжи, шантажа и родового проклятия.', '/covers/415.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=415', 15, 1, 0);
UPDATE books SET title='Кристалл счастья', kind='roman', genre='Интеллектуальный детектив', series='3', annotation='В сердце Санкт-Петербурга загадочная гибель скромного сотрудника музея приводит агентство «Архивная правда» к расследованию. Команда выходит на след секрета, за который убивают спустя столетия. Что, если величайшее открытие Ломоносова так и не было забыто?', cover='/covers/414.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=414', sort=16, shown=1, featured=0 WHERE id='kristall';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j413', 413, 'Чудь белоглазая', 0, 0, 'roman', 'Историко-мистический роман', NULL, 'XVIII век, Урал. Никита Демидов получает земли, богатые рудой, но первые шахты вскрывают не только серебряные жилы, но и древнюю тайну — легенды о «чуди белоглазой» и духе-хранительнице гор Тоуме. Сын Демидова Акинфий понимает: за мифами скрывается реальная сила, с которой можно заключить сделку.', '/covers/413.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=413', 17, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j417', 417, 'Источник жизни', 0, 0, 'roman', 'Интеллектуальный детектив', '1', 'Архивариус Алексей Белых обнаруживает след утраченного наследия Михаила Ломоносова. Вместе с журналисткой Еленой Соколовой он ищет тайник, не подозревая, что за ним уже охотятся тайное общество и могущественная корпорация.', '/covers/417.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=417', 18, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j441', 441, 'Сезон дождей для двоих', 0, 0, 'stories', 'Сборник рассказов', NULL, 'Философские размышления о пройденном пути, любви, судьбе и вере. Рассказы о правде и лжи — двух сторонах реальности, где гибель одной ведёт к краху обеих.', '/covers/441.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=441', 19, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j439', 439, 'Зимовка бабочек', 0, 0, 'stories', 'Сборник рассказов', NULL, 'Рассказы о любви, семье и отношениях. О людях, которые учатся понимать себя, говорить о чувствах и отличать настоящую близость от привычки и красивых иллюзий.', '/covers/439.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=439', 20, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j434', 434, 'Свет, который считали вечным', 0, 0, 'stories', 'Сборник рассказов', NULL, 'Иногда достаточно одного честного разговора, чтобы изменить целую жизнь. Герои сталкиваются с обидами, страхами и одиночеством, учатся защищать свои границы, прощать и вновь доверять.', '/covers/434.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=434', 21, 1, 0);
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j438', 438, 'Чемодан без ручки', 0, 0, 'stories', 'Повесть', NULL, 'Он писал этот рассказ только для себя — способ упорядочить хаос памяти и разложить по полочкам прошлое. С каждой строчкой туман невысказанных обид рассеивался, уступая место горьковатой самоиронии.', '/covers/438.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=438', 22, 1, 0);
UPDATE books SET title='Исповедь', kind='stories', genre='Проза', series=NULL, annotation='Разговор автора с читателем о том, что он считает самым важным в жизни.', cover='/covers/427.jpg', read_url='https://jaaj.club/book.aspx?enname=romans&id=427', sort=23, shown=1, featured=0 WHERE id='ispoved';
INSERT INTO books (id, jaaj_id, title, price, active, kind, genre, series, annotation, cover, read_url, sort, shown, featured) VALUES ('j455', 455, 'Душа нараспашку', 0, 0, 'poetry', 'Стихи и рассказы', NULL, 'Стихи и рассказы о любви, боли и пути к себе. О том, что после самых тёмных моментов всегда наступает просвет.', '/covers/455.jpg', 'https://jaaj.club/book.aspx?enname=romans&id=455', 24, 1, 0);

INSERT INTO formats (book_id, kind, label, price, file_key, file_name, active, sort)
  SELECT id, 'ebook', 'EPUB', price, epub_key, epub_name, active, 0 FROM books WHERE epub_key IS NOT NULL;
UPDATE orders SET format_id = (SELECT f.id FROM formats f WHERE f.book_id = orders.book_id AND f.kind = 'ebook') WHERE format_id IS NULL;
