"""Сборка статичных страниц сайта.

Главная страница собирается сервером из базы (src/home.html + каталог, отрывки, песни),
здесь собирается только страница стихов assets/stihi.html из src/poems.json.
"""
import html, json, pathlib

D = pathlib.Path(__file__).parent
ROOT = D.parent
poems = json.loads((ROOT / "src" / "poems.json").read_text(encoding="utf-8"))
poems.sort(key=lambda p: p["t"].lower().lstrip("«\"…. "))


def poem_html(i, p):
    stanzas, cur = [], []
    for line in p["l"] + [""]:
        if line.strip():
            cur.append(html.escape(line))
        elif cur:
            stanzas.append("<br>".join(cur))
            cur = []
    body = "".join(f"<p>{s}</p>" for s in stanzas)
    return (f'<article class="poem" id="p{i}" data-t="{html.escape(p["t"].lower())}">'
            f'<h2>{html.escape(p["t"])}</h2><div class="txt">{body}</div>'
            f'<p class="d">{html.escape(p.get("d", ""))}</p></article>')


index = "".join(f'<li><a href="#p{i}">{html.escape(p["t"])}</a></li>' for i, p in enumerate(poems))
items = "\n".join(poem_html(i, p) for i, p in enumerate(poems))

page = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Стихи — Василий Попков</title>
<meta name="description" content="Стихотворения Василия Попкова: {len(poems)} стихотворений о любви, памяти и пути к себе.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Prata&family=Literata:ital,opsz,wght@0,7..72,400;1,7..72,400&family=PT+Mono&display=swap">
<style>
:root{{--bg:#ECEDE6;--paper:#F7F7F2;--ink:#1C2430;--muted:#5A6270;--rule:#C9CBC0;--stamp:#5B4A8B;--brass:#8C6D24;
  --display:"Prata",Georgia,serif;--body:"Literata",Georgia,serif;--mono:"PT Mono",ui-monospace,monospace}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#141922;--paper:#1B212C;--ink:#E4E3DA;--muted:#9CA3AF;--rule:#2E3644;--stamp:#A898DA;--brass:#D2B266;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#141922;--paper:#1B212C;--ink:#E4E3DA;--muted:#9CA3AF;--rule:#2E3644;--stamp:#A898DA;--brass:#D2B266;color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 var(--body)}}
a{{color:inherit}}
.wrap{{max-width:1100px;margin:0 auto;padding:0 16px}}
nav{{border-bottom:1px solid var(--rule)}}
nav .wrap{{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-block:14px;flex-wrap:wrap}}
nav a{{font-family:var(--mono);font-size:13px;color:var(--muted);text-decoration:none}}
nav .who{{font-family:var(--display);font-size:20px;color:var(--ink)}}
header{{padding-block:40px 24px}}
h1{{font:400 clamp(34px,5vw,52px)/1.1 var(--display);margin:0 0 10px}}
.label{{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}}
.tools{{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:18px 0 0}}
.tools input{{font:inherit;font-size:16px;color:var(--ink);background:var(--paper);border:1px solid var(--rule);border-radius:2px;padding:9px 12px;width:min(420px,100%)}}
.tools span{{font-family:var(--mono);font-size:12.5px;color:var(--muted)}}
.layout{{display:grid;grid-template-columns:260px minmax(0,1fr);gap:36px;align-items:start;padding-bottom:60px}}
.toc{{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;font-size:14px;border-right:1px solid var(--rule);padding-right:14px}}
.toc ul{{list-style:none;margin:0;padding:0}}
.toc li{{margin:0 0 4px}}
.toc a{{text-decoration:none;color:var(--muted)}}
.toc a:hover{{color:var(--ink)}}
.poem{{background:var(--paper);border:1px solid var(--rule);padding:24px 26px;margin-bottom:22px;scroll-margin-top:12px}}
.poem h2{{font:400 24px/1.25 var(--display);margin:0 0 12px}}
.poem .txt p{{margin:0 0 1em;font-style:italic}}
.poem .d{{font-family:var(--mono);font-size:12px;color:var(--muted);margin:0}}
footer{{border-top:1px solid var(--rule);padding-block:24px 40px;color:var(--muted);font-size:14px}}
:focus-visible{{outline:2px solid var(--stamp);outline-offset:3px}}
@media (max-width:820px){{.layout{{grid-template-columns:1fr}}.toc{{display:none}}}}
</style>
</head>
<body>
<nav><div class="wrap"><a class="who" href="/">Василий Попков</a><a href="/#books">← Книги автора</a></div></nav>
<header><div class="wrap">
  <p class="label">Избранное · {len(poems)} стихотворений</p>
  <h1>Стихи</h1>
  <div class="tools"><input id="q" type="search" placeholder="Найти по названию или строке" aria-label="Поиск по стихам"><span id="cnt"></span></div>
</div></header>
<div class="wrap layout">
  <aside class="toc" aria-label="Содержание"><ul>{index}</ul></aside>
  <main id="list">
{items}
  </main>
</div>
<footer><div class="wrap">© Василий Попков · <a href="/">На главную</a></div></footer>
<script>
(function(){{
  const q=document.getElementById('q'),cnt=document.getElementById('cnt'),all=[...document.querySelectorAll('.poem')];
  const toc=[...document.querySelectorAll('.toc li')];
  const upd=()=>{{const s=q.value.trim().toLowerCase();let n=0;all.forEach((p,i)=>{{const ok=!s||p.textContent.toLowerCase().includes(s);p.hidden=!ok;if(toc[i])toc[i].hidden=!ok;if(ok)n++}});cnt.textContent=s?('Найдено: '+n):''}};
  q.addEventListener('input',upd);
  try{{navigator.sendBeacon('/api/event',new Blob([JSON.stringify({{type:'poem_open',target:'page'}})],{{type:'application/json'}}))}}catch(e){{}}
}})();
</script>
</body>
</html>
"""
(ROOT / "assets" / "stihi.html").write_text(page, encoding="utf-8")
print("stihi.html", len(page), "стихотворений:", len(poems))
