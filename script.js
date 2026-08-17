"use strict";

const STORAGE_KEY = "ink-draw-state-v1";
const DEFAULT_DATA_URL = "weapon-data.json";
const MODES = ["multi", "four", "single"];
const MODE_LABELS = { multi: "複数人", four: "4人", single: "1個" };

const state = {
  version: 1,
  items: [],
  mode: "multi",
  playerCount: 4,
  results: [],
  playerNames: []
};

const els = {};

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
  } catch (error) {
    showNotice(`データを読み込めませんでした。${error.message}`, "error");
    renderAll();
  }
}

function cacheElements() {
  ["import-input", "import-button", "export-button", "reset-data-button", "count-control",
    "count-down", "count-up", "count-output", "player-count", "draw-button", "active-count",
    "total-count", "notice", "exclude-results-button", "results-grid", "clear-exclusions-button",
    "category-list", "confirm-dialog"].forEach(id => { els[toCamel(id)] = document.getElementById(id); });
  els.modeTabs = [...document.querySelectorAll(".mode-tab")];
}

function bindEvents() {
  els.modeTabs.forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  els.playerCount.addEventListener("input", () => setPlayerCount(Number(els.playerCount.value)));
  els.countDown.addEventListener("click", () => setPlayerCount(state.playerCount - 1));
  els.countUp.addEventListener("click", () => setPlayerCount(state.playerCount + 1));
  els.drawButton.addEventListener("click", draw);
  els.excludeResultsButton.addEventListener("click", excludeCurrentFour);
  els.clearExclusionsButton.addEventListener("click", clearCurrentExclusions);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", importJson);
  els.exportButton.addEventListener("click", exportJson);
  els.resetDataButton.addEventListener("click", () => els.confirmDialog.showModal());
  els.confirmDialog.addEventListener("close", async () => {
    if (els.confirmDialog.returnValue === "confirm") await restoreDefaults();
  });
}

async function loadDefaultData() {
  const response = await fetch(DEFAULT_DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("初期JSONが見つかりません。");
  return validateAndNormalize(await response.json());
}

function validateAndNormalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JSONのルートはオブジェクトにしてください。");
  const sourceItems = Array.isArray(raw.items) ? raw.items : raw.version === undefined && Array.isArray(raw.weapons) ? raw.weapons : null;
  if (!sourceItems || sourceItems.length === 0) throw new Error("items配列に1件以上の項目が必要です。");
  if (raw.version !== undefined && raw.version !== 1) throw new Error("対応しているversionは1だけです。");

  const ids = new Set();
  const items = sourceItems.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${index + 1}件目の項目が不正です。`);
    for (const key of ["id", "name", "category"]) {
      if (typeof item[key] !== "string" || !item[key].trim()) throw new Error(`${index + 1}件目の${key}は空でない文字列にしてください。`);
    }
    if (ids.has(item.id)) throw new Error(`id「${item.id}」が重複しています。`);
    ids.add(item.id);

    let excluded;
    if (typeof item.excluded === "boolean") {
      excluded = { multi: item.excluded, four: item.excluded, single: item.excluded };
    } else {
      if (!item.excluded || typeof item.excluded !== "object" || MODES.some(mode => typeof item.excluded[mode] !== "boolean")) {
        throw new Error(`${index + 1}件目のexcludedにはmulti・four・singleの真偽値が必要です。`);
      }
      excluded = Object.fromEntries(MODES.map(mode => [mode, item.excluded[mode]]));
    }
    return { id: item.id, name: item.name.trim(), category: item.category.trim(), excluded };
  });
  return { version: 1, items };
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
  return state.mode === "multi" ? state.playerCount : state.mode === "four" ? 4 : 1;
}

function draw() {
  const pool = state.items.filter(item => !item.excluded[state.mode]);
  if (!pool.length) {
    showNotice("抽選対象がありません。リストから項目を戻すか、除外をすべて解除してください。", "error");
    return;
  }
  hideNotice();
  state.results = Array.from({ length: resultCount() }, () => pool[Math.floor(Math.random() * pool.length)].id);
  if (state.mode === "single") {
    const selected = findItem(state.results[0]);
    selected.excluded.single = true;
    saveState();
    renderItems();
    renderPoolCount();
  }
  renderResults(true);
}

function excludeCurrentFour() {
  if (state.mode !== "four" || state.results.some(id => !id)) return;
  new Set(state.results).forEach(id => { const item = findItem(id); if (item) item.excluded.four = true; });
  saveState();
  renderItems();
  renderPoolCount();
  els.excludeResultsButton.disabled = true;
  showNotice("表示中の項目を4人モードの抽選対象から除外しました。", "success");
}

function clearCurrentExclusions() {
  state.items.forEach(item => { item.excluded[state.mode] = false; });
  saveState();
  renderItems();
  renderPoolCount();
  hideNotice();
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
  showNotice("現在の抽選リストを書き出しました。", "success");
}

async function restoreDefaults() {
  try {
    state.items = (await loadDefaultData()).items;
    state.mode = "multi";
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
  els.countControl.hidden = state.mode !== "multi";
  els.playerCount.value = state.playerCount;
  els.countOutput.value = state.playerCount;
  els.countDown.disabled = state.playerCount === 1;
  els.countUp.disabled = state.playerCount === 10;
  els.excludeResultsButton.hidden = state.mode !== "four";
}

function renderResults(animate = false) {
  els.resultsGrid.replaceChildren();
  for (let index = 0; index < resultCount(); index++) {
    const card = document.createElement("article");
    card.className = `result-card${animate ? " is-drawing" : ""}`;
    const number = document.createElement("div");
    number.className = "result-card__number";
    number.textContent = String(index + 1).padStart(2, "0");
    const content = document.createElement("div");
    content.className = "result-card__content";
    const input = document.createElement("input");
    input.className = "player-name";
    input.type = "text";
    input.maxLength = 60;
    input.value = state.playerNames[index] || `Player ${index + 1}`;
    input.setAttribute("aria-label", `${index + 1}人目のプレイヤー名`);
    input.addEventListener("input", () => { state.playerNames[index] = input.value; });
    const result = document.createElement("p");
    result.className = "result-name";
    result.textContent = findItem(state.results[index])?.name || "—";
    content.append(input, result);
    card.append(number, content);
    els.resultsGrid.append(card);
  }
  els.excludeResultsButton.disabled = state.mode !== "four" || state.results.length !== 4 || state.results.some(id => !id);
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
    const heading = document.createElement("h3");
    heading.textContent = category;
    const count = document.createElement("span");
    count.textContent = `${items.filter(item => !item.excluded[state.mode]).length} / ${items.length}`;
    heading.append(count);
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
    section.append(heading, chips);
    els.categoryList.append(section);
  });
}

function renderPoolCount() {
  els.activeCount.textContent = state.items.filter(item => !item.excluded[state.mode]).length;
  els.totalCount.textContent = state.items.length;
}

function findItem(id) { return state.items.find(item => item.id === id); }
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function hideNotice() { els.notice.hidden = true; els.notice.textContent = ""; els.notice.className = "notice"; }
function showNotice(message, type = "") {
  els.notice.textContent = message;
  els.notice.className = `notice${type ? ` is-${type}` : ""}`;
  els.notice.hidden = false;
}
