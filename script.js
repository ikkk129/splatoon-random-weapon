"use strict";

const STORAGE_KEY = "ink-draw-state-v2";
const DEFAULT_DATA_URL = "weapon-list.json";
const MODES = ["private", "open", "unity"];

const state = {
  version: 1,
  items: [],
  mode: "private",
  playerCount: 4,
  results: [],
  playerNames: []
};

const els = {};
let noticeTimerId = null;
const iconPreloadCache = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  resetTransientState();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      state.items = validateAndNormalize(parsed).items;
    } else {
      state.items = (await loadDefaultData()).items;
      saveState();
    }
    renderAll();
    preloadWeaponIcons();
    if (document.fonts?.ready) document.fonts.ready.then(() => window.setTimeout(fitResultNames, 50));
  } catch (error) {
    showNotice(`データを読み込めませんでした。${error.message}`, "error");
    renderAll();
  }
}

function cacheElements() {
  ["import-input", "import-button", "export-button", "reset-data-button", "count-control",
    "count-down", "count-up", "count-output", "player-count", "draw-button", "active-count",
    "total-count", "notice", "exclude-results-button", "results-grid", "exclude-all-button", "clear-exclusions-button",
    "category-list", "confirm-dialog"].forEach(id => { els[toCamel(id)] = document.getElementById(id); });
  els.modeTabs = [...document.querySelectorAll(".mode-tab")];
  els.themeButtons = [...document.querySelectorAll(".theme-preview__button")];
}

function bindEvents() {
  els.modeTabs.forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  els.themeButtons.forEach(button => button.addEventListener("click", () => setPreviewTheme(button.dataset.theme)));
  els.playerCount.addEventListener("input", () => setPlayerCount(Number(els.playerCount.value)));
  els.countDown.addEventListener("click", () => setPlayerCount(state.playerCount - 1));
  els.countUp.addEventListener("click", () => setPlayerCount(state.playerCount + 1));
  els.drawButton.addEventListener("click", draw);
  els.excludeResultsButton.addEventListener("click", excludeCurrentOpen);
  els.excludeAllButton.addEventListener("click", excludeAllItems);
  els.clearExclusionsButton.addEventListener("click", clearCurrentExclusions);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", importJson);
  els.exportButton.addEventListener("click", exportJson);
  els.resetDataButton.addEventListener("click", () => els.confirmDialog.showModal());
  els.confirmDialog.addEventListener("close", async () => {
    if (els.confirmDialog.returnValue === "confirm") await restoreDefaults();
  });
  window.addEventListener("resize", scheduleFitResultNames);
}

function setPreviewTheme(theme) {
  document.body.dataset.theme = theme;
  els.themeButtons.forEach(button => {
    const active = button.dataset.theme === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function loadDefaultData() {
  const response = await fetch(DEFAULT_DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("初期JSONが見つかりません。");
  return validateAndNormalize(await response.json());
}

function validateAndNormalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JSONのルートはオブジェクトにしてください。");
  const sourceItems = Array.isArray(raw.items) ? raw.items : null;
  if (!sourceItems || sourceItems.length === 0) throw new Error("items配列に1件以上の項目が必要です。");
  if (raw.version !== 1) throw new Error("対応しているversionは1だけです。");

  const ids = new Set();
  const items = sourceItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${index + 1}件目の項目が不正です。`);
    for (const key of ["id", "name", "category"]) {
      if (typeof item[key] !== "string" || !item[key].trim()) throw new Error(`${index + 1}件目の${key}は空でない文字列にしてください。`);
    }
    if (ids.has(item.id)) throw new Error(`id「${item.id}」が重複しています。`);
    ids.add(item.id);

    const excluded = normalizeExcluded(item.excluded, index);
    return { id: item.id, name: item.name.trim(), category: item.category.trim(), excluded };
  });
  return { version: 1, items };
}

function normalizeExcluded(rawExcluded, index) {
  if (!rawExcluded || typeof rawExcluded !== "object" || Array.isArray(rawExcluded)) {
    throw new Error(`${index + 1}件目のexcludedにはprivate・open・unityの真偽値が必要です。`);
  }

  if (MODES.some(mode => typeof rawExcluded[mode] !== "boolean")) {
    throw new Error(`${index + 1}件目のexcludedにはprivate・open・unityの真偽値が必要です。`);
  }
  return Object.fromEntries(MODES.map(mode => [mode, rawExcluded[mode]]));
}

function setMode(mode) {
  if (!MODES.includes(mode) || mode === state.mode) return;
  state.mode = mode;
  resetTransientState();
  hideNotice();
  renderAll();
}

function resetTransientState() {
  const count = resultCount();
  state.results = Array(count).fill(null);
  state.playerNames = Array.from({ length: count }, (_, index) => `Player ${index + 1}`);
}

function setPlayerCount(count) {
  const next = Math.max(1, Math.min(10, count));
  if (next === state.playerCount) return;
  const oldNames = state.playerNames;
  state.playerCount = next;
  state.results = Array(next).fill(null);
  state.playerNames = Array.from({ length: next }, (_, index) => oldNames[index] || `Player ${index + 1}`);
  hideNotice();
  renderControls();
  renderResults();
}

function resultCount() {
  return state.mode === "private" ? state.playerCount : state.mode === "open" ? 4 : 1;
}

function draw() {
  const pool = state.items.filter(item => !item.excluded[state.mode]);
  if (!pool.length) {
    showNotice("抽選対象がありません。リストから項目を戻すか、除外をすべて解除してください。", "error");
    return;
  }
  hideNotice();
  state.results = Array.from({ length: resultCount() }, () => pool[Math.floor(Math.random() * pool.length)].id);
  if (state.mode === "unity") {
    const selected = findItem(state.results[0]);
    selected.excluded.unity = true;
    saveState();
    renderItems();
    renderPoolCount();
  }
  renderResults();
}

function excludeCurrentOpen() {
  if (state.mode !== "open" || state.results.some(id => !id)) return;
  new Set(state.results).forEach(id => { const item = findItem(id); if (item) item.excluded.open = true; });
  saveState();
  renderItems();
  renderPoolCount();
  showNotice("表示中のブキをオープンマッチモードの抽選対象から除外しました。", "success", 3000);
}

function clearCurrentExclusions() {
  state.items.forEach(item => { item.excluded[state.mode] = false; });
  saveState();
  renderItems();
  renderPoolCount();
  hideNotice();
}

function excludeAllItems() {
  state.items.forEach(item => { item.excluded[state.mode] = true; });
  saveState();
  renderItems();
  renderPoolCount();
}

function excludeCategory(category) {
  state.items.filter(item => item.category === category).forEach(item => { item.excluded[state.mode] = true; });
  saveState();
  renderItems();
  renderPoolCount();
}

function includeCategory(category) {
  state.items.filter(item => item.category === category).forEach(item => { item.excluded[state.mode] = false; });
  saveState();
  renderItems();
  renderPoolCount();
}

function toggleItem(id) {
  const item = findItem(id);
  if (!item) return;
  item.excluded[state.mode] = !item.excluded[state.mode];
  saveState();
  renderItems();
  renderPoolCount();
}

async function importJson(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("ファイルサイズは5MB以下にしてください。");
    const validated = validateAndNormalize(JSON.parse(await file.text()));
    state.items = validated.items;
    resetTransientState();
    saveState();
    renderAll();
    showNotice(`${state.items.length}件の項目を読み込みました。`, "success");
  } catch (error) {
    showNotice(`JSONを適用できません。${error.message}`, "error");
  }
}

function exportJson() {
  const json = JSON.stringify({ version: 1, items: state.items }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ink-draw-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showNotice("現在のブキリストを書き出しました。", "success");
}

async function restoreDefaults() {
  try {
    state.items = (await loadDefaultData()).items;
    state.mode = "private";
    state.playerCount = 4;
    resetTransientState();
    saveState();
    renderAll();
    showNotice("初期データに戻しました。", "success");
  } catch (error) {
    showNotice(`初期データに戻せませんでした。${error.message}`, "error");
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: state.items }));
  } catch {
    showNotice("ブラウザに状態を保存できませんでした。", "error");
  }
}

function renderAll() {
  document.body.dataset.mode = state.mode;
  renderControls();
  renderResults();
  renderItems();
  renderPoolCount();
}

function renderControls() {
  document.body.dataset.mode = state.mode;
  els.modeTabs.forEach(tab => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.countControl.hidden = state.mode !== "private";
  els.playerCount.value = state.playerCount;
  els.countOutput.value = state.playerCount;
  els.countDown.disabled = state.playerCount === 1;
  els.countUp.disabled = state.playerCount === 10;
  els.excludeResultsButton.hidden = state.mode !== "open";
}

function renderResults() {
  els.resultsGrid.replaceChildren();
  for (let index = 0; index < resultCount(); index++) {
    const card = document.createElement("article");
    card.className = `result-card${state.mode === "unity" ? " result-card--unity" : ""}`;
    const number = document.createElement("div");
    number.className = "result-card__number";
    number.textContent = String(index + 1).padStart(2, "0");
    const content = document.createElement("div");
    content.className = "result-card__content";
    const result = document.createElement("p");
    result.className = "result-name";
    const selectedItem = findItem(state.results[index]);
    result.textContent = selectedItem?.name || "—";
    if (state.mode !== "unity") {
      const input = document.createElement("input");
      input.className = "player-name";
      input.type = "text";
      input.maxLength = 60;
      input.value = state.playerNames[index] || `Player ${index + 1}`;
      input.setAttribute("aria-label", `${index + 1}人目のプレイヤー名`);
      input.addEventListener("input", () => { state.playerNames[index] = input.value; });
      content.append(input);
    }
    content.append(result);
    const icon = document.createElement("div");
    icon.className = "result-card__icon";
    if (selectedItem) {
      const image = document.createElement("img");
      const iconFile = window.WEAPON_ICONS?.[selectedItem.name];
      image.src = iconFile ? `_images/MainWeapons/${encodeURIComponent(iconFile)}` : "";
      image.alt = `${selectedItem.name}のアイコン`;
      if (!iconFile) image.hidden = true;
      image.addEventListener("error", () => { image.hidden = true; });
      icon.append(image);
    }
    if (state.mode === "unity") {
      const selection = document.createElement("div");
      selection.className = "result-card__selection";
      selection.append(content, icon);
      card.append(selection);
    } else {
      card.append(number, content, icon);
    }
    els.resultsGrid.append(card);
  }
  els.excludeResultsButton.disabled = state.mode !== "open" || state.results.length !== 4 || state.results.some(id => !id);
  fitResultNames();
  // Web fonts can finish loading just after the cards are painted; measure once more then.
  window.setTimeout(fitResultNames, 350);
}

// Keep weapon names legible while preventing long names from escaping their result card.
// The base size comes from CSS; only cards that need more room are condensed.
function fitResultNames() {
  els.resultsGrid.querySelectorAll(".result-name").forEach(name => {
    const baseSize = Number.parseFloat(name.dataset.baseSize) || Number.parseFloat(getComputedStyle(name).fontSize);
    if (!baseSize || name.clientWidth <= 0) return;
    name.dataset.baseSize = String(baseSize);

    const minimumSize = Math.max(18, baseSize * 0.62);
    // Keep an already-condensed size so a later font/layout measurement never grows the text.
    let size = Number.parseFloat(name.style.fontSize) || baseSize;
    while (name.scrollWidth > name.clientWidth + 1 && size > minimumSize) {
      size -= 1;
      name.style.fontSize = `${size}px`;
    }
    name.classList.toggle("is-condensed", size < baseSize);
  });
}

let fitResultNamesFrame = null;
function scheduleFitResultNames() {
  if (fitResultNamesFrame !== null) cancelAnimationFrame(fitResultNamesFrame);
  fitResultNamesFrame = requestAnimationFrame(() => {
    fitResultNamesFrame = null;
    fitResultNames();
  });
}

function renderItems() {
  els.categoryList.replaceChildren();
  const groups = new Map();
  state.items.forEach(item => {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  });
  groups.forEach((items, category) => {
    const section = document.createElement("section");
    section.className = "category-group";
    const header = document.createElement("div");
    header.className = "category-group__header";
    const heading = document.createElement("h3");
    heading.textContent = category.replace(/系$/, "");
    const count = document.createElement("span");
    count.textContent = `${items.filter(item => !item.excluded[state.mode]).length} / ${items.length}`;
    heading.append(count);
    const actions = document.createElement("div");
    actions.className = "category-group__actions";
    const includeButton = document.createElement("button");
    includeButton.type = "button";
    includeButton.className = "category-action-button";
    includeButton.textContent = "すべて含める";
    includeButton.disabled = items.every(item => !item.excluded[state.mode]);
    includeButton.setAttribute("aria-label", `${category}のブキをすべて抽選対象に含める`);
    includeButton.addEventListener("click", () => includeCategory(category));
    const excludeButton = document.createElement("button");
    excludeButton.type = "button";
    excludeButton.className = "category-action-button";
    excludeButton.textContent = "すべて除外";
    excludeButton.disabled = items.every(item => item.excluded[state.mode]);
    excludeButton.setAttribute("aria-label", `${category}のブキをすべて除外`);
    excludeButton.addEventListener("click", () => excludeCategory(category));
    actions.append(includeButton, excludeButton);
    header.append(heading, actions);
    const chips = document.createElement("div");
    chips.className = "item-chips";
    items.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `item-chip${item.excluded[state.mode] ? " is-excluded" : ""}`;
      button.textContent = item.name;
      button.setAttribute("aria-pressed", String(item.excluded[state.mode]));
      button.setAttribute("aria-label", `${item.name}を${item.excluded[state.mode] ? "抽選対象に戻す" : "除外する"}`);
      button.addEventListener("click", () => toggleItem(item.id));
      chips.append(button);
    });
    section.append(header, chips);
    els.categoryList.append(section);
  });
}

function renderPoolCount() {
  els.activeCount.textContent = state.items.filter(item => !item.excluded[state.mode]).length;
  els.totalCount.textContent = state.items.length;
}

function findItem(id) { return state.items.find(item => item.id === id); }
function preloadWeaponIcons() {
  const start = () => {
    const files = [...new Set(Object.values(window.WEAPON_ICONS || {}))];
    files.forEach(file => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.src = `_images/MainWeapons/${encodeURIComponent(file)}`;
      iconPreloadCache.push(image);
    });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(start, { timeout: 1200 });
  else window.setTimeout(start, 200);
}
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function hideNotice() {
  if (noticeTimerId !== null) {
    clearTimeout(noticeTimerId);
    noticeTimerId = null;
  }
  els.notice.hidden = true;
  els.notice.textContent = "";
  els.notice.className = "notice";
}
function showNotice(message, type = "", duration = 0) {
  if (noticeTimerId !== null) clearTimeout(noticeTimerId);
  els.notice.textContent = message;
  els.notice.className = `notice${type ? ` is-${type}` : ""}`;
  els.notice.hidden = false;
  noticeTimerId = duration > 0 ? window.setTimeout(hideNotice, duration) : null;
}
