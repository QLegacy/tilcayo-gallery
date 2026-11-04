const $ = (id) => document.getElementById(id);
const SAFE_URL = /^(https:\/\/(t\.me|telegram\.me|telegram\.dog)\/|tg:\/\/)/;

let items = [];   // все картинки с пропорциями
let order = [];   // порядок как на экране (по нему листает карусель)
let current = 0;

const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- Загрузка списка ----------
function measure(item) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ ...item, ratio: im.naturalWidth / im.naturalHeight || 1 });
    im.onerror = () => resolve({ ...item, ratio: 1 });
    im.src = item.file;
  });
}

async function loadGallery() {
  try {
    const res = await fetch("gallery.json", { cache: "no-store" });
    if (!res.ok) throw new Error();
    items = await Promise.all((await res.json()).map(measure));
    layout();
  } catch {
    $("empty").hidden = false;
    $("empty").textContent = "Не удалось загрузить галерею. Проверь, что рядом лежит gallery.json.";
  }
}

// ---------- Раскладка ----------
// Сетка из четвертинок квадрата. Квадрат = 4×4.
// Два landscape в столбик = 4×5 (чуть выше квадрата), два portrait рядом = 5×4 (чуть шире).
const kind = (r) => (r > 1.15 ? "L" : r < 0.87 ? "P" : "S");

function sizeGrid() {
  const grid = $("grid");
  const width = grid.clientWidth - 20;
  const cols = Math.max(2, Math.floor(width / 230));
  grid.style.setProperty("--n", cols * 4);
  grid.style.setProperty("--h", width / (cols * 4) + "px");
}

function thumb(item, idx) {
  const btn = document.createElement("button");
  btn.className = "thumb";
  btn.type = "button";
  btn.dataset.file = item.file;
  btn.setAttribute("aria-label", item.title || "Открыть картинку");
  const img = document.createElement("img");
  img.src = item.file;
  img.alt = item.title || "";
  img.loading = "lazy";
  btn.append(img);
  btn.addEventListener("click", () => openViewer(idx));
  return btn;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// FLIP: запоминаем где картинки были, перестраиваем сетку и плавно "переезжаем" на новые места.
function layout(animate = false) {
  const grid = $("grid");
  const first = new Map();
  if (animate && !reducedMotion.matches) {
    for (const el of grid.querySelectorAll(".thumb")) first.set(el.dataset.file, el.getBoundingClientRect());
  }
  grid.replaceChildren();
  $("empty").hidden = items.length > 0;
  $("count").textContent = items.length ? `Картинок: ${items.length}` : "";
  $("shuffle").hidden = items.length < 2;
  sizeGrid();

  const g = { L: [], P: [], S: [] };
  shuffle(items).forEach((i) => g[kind(i.ratio)].push(i));

  const cells = [];
  for (const k of ["L", "P"]) {
    const list = g[k];
    const land = k === "L";
    while (list.length >= 2) {
      cells.push({ cls: land ? "pair-l" : "pair-p", w: land ? 4 : 5, h: land ? 5 : 4, list: list.splice(0, 2) });
    }
    if (list.length) cells.push({ cls: "single", w: land ? 8 : 5, h: land ? 5 : 8, list: list.splice(0, 1) });
  }
  g.S.forEach((i) => cells.push({ cls: "single", w: 4, h: 4, list: [i] }));

  order = [];
  for (const c of shuffle(cells)) {
    const cell = document.createElement("div");
    cell.className = "cell " + c.cls;
    cell.style.gridColumn = `span ${c.w}`;
    cell.style.gridRow = `span ${c.h}`;
    const inner = document.createElement("div");
    inner.className = "cell-inner";
    for (const item of c.list) inner.append(thumb(item, order.push(item) - 1));
    cell.append(inner);
    grid.append(cell);
  }

  let n = 0;
  for (const el of grid.querySelectorAll(".thumb")) {
    const a = first.get(el.dataset.file);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const from = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    el.style.zIndex = 2;
    const anim = el.animate(
      [{ transform: from, transformOrigin: "top left" }, { transform: "none", transformOrigin: "top left" }],
      { duration: 600, delay: Math.min(n++ * 12, 240), easing: "cubic-bezier(.2, 0, 0, 1)", fill: "backwards" }
    );
    anim.onfinish = anim.oncancel = () => { el.style.zIndex = ""; };
  }
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(sizeGrid, 100);
});
$("shuffle").addEventListener("click", () => layout(true));

// ---------- Карусель ----------
const viewer = $("viewer");

function show(i, dir) {
  current = (i + order.length) % order.length;
  const item = order[current];
  const img = $("viewer-img");
  img.src = item.file;
  img.alt = item.title || "Тилькайо";
  img.classList.remove("go-next", "go-prev");
  if (dir) { void img.offsetWidth; img.classList.add(dir > 0 ? "go-next" : "go-prev"); }

  $("viewer-title").textContent = item.title || "";
  $("viewer-desc").textContent = item.description || "";

  const credit = $("credit");
  const a = item.author;
  if (a && SAFE_URL.test(a.url)) {
    $("credit-text").textContent = a.label;
    credit.href = a.url;
  } else {
    $("credit-text").textContent = "Автор неизвестен";
    credit.removeAttribute("href");
  }

  const multi = order.length > 1;
  $("prev").hidden = $("next").hidden = !multi;
  $("counter").textContent = multi ? `${current + 1} / ${order.length}` : "";
  if (multi) { // подгружаем соседей
    new Image().src = order[(current + 1) % order.length].file;
    new Image().src = order[(current - 1 + order.length) % order.length].file;
  }
}

function openViewer(idx) { show(idx, 0); viewer.showModal(); }

$("next").addEventListener("click", () => show(current + 1, 1));
$("prev").addEventListener("click", () => show(current - 1, -1));
$("viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") show(current + 1, 1);
  if (e.key === "ArrowLeft") show(current - 1, -1);
});

let startX = null;
$("stage").addEventListener("pointerdown", (e) => { startX = e.clientX; });
$("stage").addEventListener("pointerup", (e) => {
  if (startX === null) return;
  const dx = e.clientX - startX;
  startX = null;
  if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
});

for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
}

// ---------- Загрузка ----------
const uploader = $("uploader");
const fileInput = $("file");
const drop = $("drop");

const fields = ["title", "author"].map((id) => ({
  id,
  box: $(id).closest(".field"),
  help: $(id + "-help"),
  text: $(id + "-help").textContent,
}));
const fieldOf = (id) => fields.find((f) => f.id === id);

function setInvalid(id, msg) {
  if (id === "image") { drop.classList.add("invalid"); return; }
  const f = fieldOf(id);
  if (!f) return;
  f.box.classList.add("invalid");
  if (msg) f.help.textContent = msg;
}

function clearInvalid() {
  drop.classList.remove("invalid");
  for (const f of fields) { f.box.classList.remove("invalid"); f.help.textContent = f.text; }
}

for (const f of fields) {
  $(f.id).addEventListener("input", () => {
    f.box.classList.remove("invalid");
    f.help.textContent = f.text;
  });
}

$("fab").addEventListener("click", () => { resetForm(); uploader.showModal(); });
$("cancel").addEventListener("click", () => uploader.close());

function resetForm() {
  $("form").reset();
  $("preview").hidden = true;
  $("drop-text").hidden = false;
  clearInvalid();
}

function showPreview(file) {
  if (!file || !file.type.startsWith("image/")) return;
  $("preview").src = URL.createObjectURL(file);
  $("preview").hidden = false;
  $("drop-text").hidden = true;
  drop.classList.remove("invalid");
}

fileInput.addEventListener("change", () => showPreview(fileInput.files[0]));
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    showPreview(fileInput.files[0]);
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearInvalid();
  let ok = true;
  if (!fileInput.files.length) { setInvalid("image"); ok = false; }
  if (!$("title").value.trim()) { setInvalid("title", "Назови мем"); ok = false; }
  if (!$("author").value.trim()) { setInvalid("author", "Укажи автора: юзернейм или ссылку"); ok = false; }
  if (!ok) return;

  const btn = $("submit");
  btn.disabled = true;
  btn.textContent = "Загружаю…";
  try {
    const res = await fetch("api/upload", { method: "POST", body: new FormData($("form")) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.field) setInvalid(data.field, data.field === "image" ? "" : data.error);
      throw new Error(data.error || "Не получилось загрузить.");
    }
    uploader.close();
    toast("Опубликовано");
    loadGallery();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Опубликовать";
  }
});

// ---------- Snackbar ----------
let timer;
function toast(text) {
  const el = $("snackbar");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("show"), 4000);
}

loadGallery();

// Кнопка «Добавить» нужна только при запущенном server.py.
// На GitHub Pages (статика) этого API нет, и кнопка остаётся скрытой.
fetch("api/status")
  .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
  .then(() => { $("fab").hidden = false; })
  .catch(() => {});

// ---------- Ripple (как в Android) ----------
const RIPPLE_HOSTS = ".btn, .fab, .nav, .chip, .thumb, .drop";

document.addEventListener("pointerdown", (e) => {
  const host = e.target.closest(RIPPLE_HOSTS);
  if (!host || host.disabled || reducedMotion.matches) return;

  const r = host.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const radius = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));

  const dot = document.createElement("span");
  dot.className = "ripple";
  Object.assign(dot.style, {
    width: radius * 2 + "px",
    height: radius * 2 + "px",
    left: x - radius + "px",
    top: y - radius + "px",
  });
  host.append(dot);

  const grow = dot.animate(
    [{ transform: "scale(0)", opacity: 0.32 }, { transform: "scale(1)", opacity: 0.32 }],
    { duration: 450, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "forwards" }
  );
  const release = () => {
    document.removeEventListener("pointerup", release);
    document.removeEventListener("pointercancel", release);
    grow.finished.then(() =>
      dot.animate([{ opacity: 0.32 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished
    ).then(() => dot.remove());
  };
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
});
