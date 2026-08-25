"use strict";

const STORAGE_KEY = "ink-draw-state-v2";
const SETTINGS_STORAGE_KEY = "ink-draw-settings-v1";
const DEFAULT_DATA_URL = "weapon-list.json";
const DRAW_SHUFFLE_COUNT = 7;
const DRAW_SHUFFLE_INTERVAL = 100;
const MODES = ["private", "open", "unity"];

const state = {
  items: [],
  mode: "private",
  playerCount: 4,
  results: [],
  playerNames: [],
  settings: { drawAnimation: true }
};

const els = {};
let noticeTimerId = null;
let countAnimationTimerId = null;
let sidebarIconRollTimerId = null;
let drawShuffleTimerId = null;
let isDrawing = false;
const collapsedCategories = new Set();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.settings = loadSettings();
  cacheElements();
  bindEvents();
  applyResponsiveSidebarState();
  resetTransientState();
  try {
    const initial = await loadInitialData();
    state.items = initial.data.items;
    if (initial.shouldSave) saveState();
    collapseAllCategories();
    renderAll();
    if (document.fonts?.ready) document.fonts.ready.then(() => window.setTimeout(fitResultNames, 50));
    if (initial.notice) showNotice(initial.notice, "error", 5000);
  } catch (error) {
    showNotice(`データを読み込めませんでした。${error.message}`, "error");
    renderAll();
  }
}

function cacheElements() {
  ["sidebar-collapse-button", "sidebar-brand-icon-button", "draw-animation-toggle", "import-input", "import-button", "export-button", "reset-exclusions-button", "reset-data-button", "data-menu-button", "data-menu", "count-control", "excluded-count",
    "count-down", "count-up", "count-output", "player-count", "draw-button", "active-count",
    "total-count", "notice", "exclude-results-button", "results-grid", "exclude-all-button", "clear-exclusions-button",
    "items-toggle-button", "category-list", "confirm-dialog", "exclude-all-dialog"].forEach(id => { els[toCamel(id)] = document.getElementById(id); });
  els.modeTabs = [...document.querySelectorAll(".mode-tab")];
}

function bindEvents() {
  els.sidebarCollapseButton.addEventListener("click", toggleSidebar);
  els.sidebarBrandIconButton.addEventListener("click", rollSidebarIcon);
  els.drawAnimationToggle.addEventListener("change", () => {
    state.settings.drawAnimation = els.drawAnimationToggle.checked;
    saveSettings();
  });
  els.modeTabs.forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  els.playerCount.addEventListener("input", () => setPlayerCount(Number(els.playerCount.value)));
  els.countDown.addEventListener("click", () => setPlayerCount(state.playerCount - 1));
  els.countUp.addEventListener("click", () => setPlayerCount(state.playerCount + 1));
  els.drawButton.addEventListener("click", draw);
  els.excludeResultsButton.addEventListener("click", excludeCurrentOpen);
  els.excludeAllButton.addEventListener("click", () => {
    els.excludeAllDialog.showModal();
  });
  els.clearExclusionsButton.addEventListener("click", clearCurrentExclusions);
  els.itemsToggleButton.addEventListener("click", toggleItemsSection);
  els.dataMenuButton.addEventListener("click", toggleDataMenu);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", importJson);
  els.exportButton.addEventListener("click", () => {
    closeDataMenu();
    exportJson();
  });
  els.resetExclusionsButton.addEventListener("click", resetAllExclusions);
  els.resetDataButton.addEventListener("click", () => {
    closeDataMenu();
    els.confirmDialog.showModal();
  });
  els.confirmDialog.addEventListener("close", async () => {
    if (els.confirmDialog.returnValue === "confirm") await restoreDefaults();
  });
  els.excludeAllDialog.addEventListener("close", () => {
    if (els.excludeAllDialog.returnValue === "confirm") excludeAllItems();
    els.excludeAllButton.focus();
  });
  document.addEventListener("click", event => {
    if (!els.dataMenu.hidden && !els.dataMenu.contains(event.target) && !els.dataMenuButton.contains(event.target)) closeDataMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !els.dataMenu.hidden) {
      closeDataMenu();
      els.dataMenuButton.focus();
    }
  });
  window.addEventListener("resize", scheduleFitResultNames);
}

function rollSidebarIcon() {
  const icon = els.sidebarBrandIconButton.querySelector(".app-title__icon");
  icon.classList.remove("is-rolling");
  void icon.offsetWidth;
  icon.classList.add("is-rolling");
  window.clearTimeout(sidebarIconRollTimerId);
  sidebarIconRollTimerId = window.setTimeout(() => icon.classList.remove("is-rolling"), 2700);
}

function applyResponsiveSidebarState() {
  const mobileQuery = window.matchMedia?.("(max-width: 900px)");
  if (!mobileQuery) return;
  const collapseOnMobile = () => {
    if (!mobileQuery.matches) return;
    const appShell = document.querySelector(".app-shell");
    appShell.classList.add("is-sidebar-collapsed");
    els.sidebarCollapseButton.classList.add("is-collapsed");
    els.sidebarCollapseButton.setAttribute("aria-expanded", "false");
    els.sidebarCollapseButton.setAttribute("aria-label", "サイドバーを開く");
  };
  collapseOnMobile();
  mobileQuery.addEventListener?.("change", collapseOnMobile);
}

function toggleSidebar() {
  const appShell = document.querySelector(".app-shell");
  const willCollapse = !appShell.classList.contains("is-sidebar-collapsed");
  if (willCollapse) closeDataMenu();
  appShell.classList.toggle("is-sidebar-collapsed", willCollapse);
  els.sidebarCollapseButton.classList.toggle("is-collapsed", willCollapse);
  els.sidebarCollapseButton.setAttribute("aria-expanded", String(!willCollapse));
  els.sidebarCollapseButton.setAttribute("aria-label", willCollapse ? "サイドバーを開く" : "サイドバーを閉じる");
  els.sidebarCollapseButton.querySelector(".ui-icon").setAttribute("aria-hidden", "true");
}

function toggleDataMenu() {
  const willOpen = els.dataMenu.hidden;
  els.dataMenu.hidden = !willOpen;
  els.dataMenuButton.setAttribute("aria-expanded", String(willOpen));
}

function closeDataMenu() {
  els.dataMenu.hidden = true;
  els.dataMenuButton.setAttribute("aria-expanded", "false");
}

function collapseAllCategories() {
  collapsedCategories.clear();
  state.items.forEach(item => collapsedCategories.add(item.category));
}

function setCategoryGroupCollapsed(section, content, toggleButton, category, categoryLabel, collapsed) {
  section.classList.toggle("is-collapsed", collapsed);
  content.inert = collapsed;
  content.setAttribute("aria-hidden", String(collapsed));
  toggleButton.setAttribute("aria-expanded", String(!collapsed));
  toggleButton.setAttribute("aria-label", `${categoryLabel}${collapsed ? "を開く" : "を閉じる"}`);
  if (collapsed) collapsedCategories.add(category);
  else {
    collapsedCategories.delete(category);
    loadDeferredImages(content);
  }
}

function loadDeferredImages(container) {
  container.querySelectorAll("img[data-src]").forEach(image => {
    image.src = image.dataset.src;
    delete image.dataset.src;
  });
}

function updateCategoryToggleSummary() {
  const groups = [...els.categoryList.querySelectorAll(".category-group")];
  const allCollapsed = groups.length > 0 && groups.every(group => group.classList.contains("is-collapsed"));
  els.itemsToggleButton.setAttribute("aria-expanded", String(!allCollapsed));
  els.itemsToggleButton.setAttribute("aria-label", allCollapsed ? "全カテゴリを開く" : "全カテゴリを閉じる");
}

function toggleItemsSection() {
  const groups = [...els.categoryList.querySelectorAll(".category-group")];
  const shouldCollapse = groups.some(group => !group.classList.contains("is-collapsed"));
  groups.forEach(section => {
    const category = section.dataset.category;
    const categoryLabel = section.dataset.categoryLabel || category.replace(/系$/, "");
    const content = section.querySelector(".category-group__content");
    const toggleButton = section.querySelector(".category-toggle-button");
    setCategoryGroupCollapsed(section, content, toggleButton, category, categoryLabel, shouldCollapse);
  });
  updateCategoryToggleSummary();
}

async function loadDefaultData() {
  const response = await fetch(DEFAULT_DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("初期JSONが見つかりません。");
  return validateAndNormalize(await response.json());
}

async function loadInitialData() {
  let stored;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      data: await loadDefaultData(),
      shouldSave: false,
      notice: "ブラウザの保存データを利用できないため、初期データで起動しました。"
    };
  }

  if (!stored) return { data: await loadDefaultData(), shouldSave: true, notice: "" };

  try {
    return { data: validateAndNormalize(JSON.parse(stored)), shouldSave: false, notice: "" };
  } catch {
    return {
      data: await loadDefaultData(),
      shouldSave: true,
      notice: "保存データを読み込めなかったため、初期データで復旧しました。"
    };
  }
}

function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return { drawAnimation: false };
    const parsed = JSON.parse(stored);
    return { drawAnimation: parsed?.drawAnimation !== false };
  } catch {
    return { drawAnimation: false };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    showNotice("設定を保存できませんでした。", "error");
  }
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
    const id = item.id.trim();
    if (ids.has(id)) throw new Error(`id「${id}」が重複しています。`);
    ids.add(id);

    const excluded = normalizeExcluded(item.excluded, index);
    return { id, name: item.name.trim(), category: item.category.trim(), excluded };
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
  if (isDrawing || !MODES.includes(mode) || mode === state.mode) return;
  state.mode = mode;
  const modeMinimum = 2;
  const modeMaximum = mode === "open" ? 4 : 10;
  state.playerCount = Math.max(modeMinimum, Math.min(modeMaximum, state.playerCount));
  resetTransientState();
  hideNotice();
  renderAll();
}

function resetTransientState() {
  const count = resultCount();
  state.results = Array(count).fill(null);
  state.playerNames = Array(count).fill("");
}

function setPlayerCount(count) {
  if (isDrawing) return;
  const minimum = 2;
  const maximum = state.mode === "open" ? 4 : 10;
  const next = Math.max(minimum, Math.min(maximum, count));
  if (next === state.playerCount) return;
  const previous = state.playerCount;
  const oldNames = state.playerNames;
  state.playerCount = next;
  state.results = Array(next).fill(null);
  state.playerNames = Array.from({ length: next }, (_, index) => oldNames[index] || "");
  hideNotice();
  renderControls();
  animatePlayerCount(previous, next);
  renderResults();
}

function resultCount() {
  return state.mode === "unity" ? 1 : state.playerCount;
}

function draw() {
  if (isDrawing) return;
  const pool = state.items.filter(item => !item.excluded[state.mode]);
  if (!pool.length) {
    showNotice("抽選対象がありません。リストから項目を戻すか、除外をすべて解除してください。", "error");
    return;
  }
  hideNotice();
  const finalResults = pickResults(pool);
  if (state.settings.drawAnimation) {
    animateDraw(pool, finalResults);
    return;
  }
  applyDrawResults(finalResults);
}

function pickResults(pool) {
  return Array.from({ length: resultCount() }, () => pool[Math.floor(Math.random() * pool.length)].id);
}

function applyDrawResults(results, shouldRender = true) {
  state.results = results;
  if (state.mode === "unity") {
    const selected = findItem(state.results[0]);
    selected.excluded.unity = true;
    saveState();
    renderItems();
    renderPoolCount();
  }
  if (shouldRender) renderResults();
}

function animateDraw(pool, finalResults) {
  isDrawing = true;
  els.drawButton.disabled = true;
  els.drawButton.setAttribute("aria-busy", "true");
  els.drawButton.classList.add("is-drawing");
  els.drawButton.querySelector("strong").textContent = "ガチャ中…";
  els.resultsGrid.classList.add("is-drawing");
  let shuffleCount = 0;
  const finish = () => {
    window.clearInterval(drawShuffleTimerId);
    drawShuffleTimerId = null;
    els.resultsGrid.classList.remove("is-drawing");
    els.drawButton.classList.remove("is-drawing");
    els.drawButton.disabled = false;
    els.drawButton.removeAttribute("aria-busy");
    els.drawButton.querySelector("strong").textContent = "ガチャを回す";
    isDrawing = false;
  };
  const shuffle = () => {
    shuffleCount += 1;
    if (shuffleCount === DRAW_SHUFFLE_COUNT) applyDrawResults(finalResults, false);
    else state.results = pickResults(pool);
    renderResults();
    els.resultsGrid.classList.add("is-drawing");
    if (shuffleCount >= DRAW_SHUFFLE_COUNT) {
      finish();
    }
  };
  shuffle();
  if (shuffleCount < DRAW_SHUFFLE_COUNT) {
    drawShuffleTimerId = window.setInterval(shuffle, DRAW_SHUFFLE_INTERVAL);
  }
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

function resetAllExclusions() {
  state.items.forEach(item => MODES.forEach(mode => { item.excluded[mode] = false; }));
  saveState();
  renderItems();
  renderPoolCount();
  closeDataMenu();
  showNotice("すべてのモードの除外をリセットしました。", "success", 3000);
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
  closeDataMenu();
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("ファイルサイズは5MB以下にしてください。");
    const validated = validateAndNormalize(JSON.parse(await file.text()));
    state.items = validated.items;
    collapseAllCategories();
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
    collapseAllCategories();
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
  renderControls();
  renderResults();
  renderItems();
  renderPoolCount();
}

function renderControls() {
  document.body.dataset.mode = state.mode;
  els.drawAnimationToggle.checked = state.settings.drawAnimation;
  els.modeTabs.forEach(tab => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.countControl.hidden = state.mode === "unity";
  const minimum = 2;
  const maximum = state.mode === "open" ? 4 : 10;
  els.playerCount.min = String(minimum);
  els.playerCount.max = String(maximum);
  els.playerCount.value = state.playerCount;
  els.countOutput.value = String(state.playerCount);
  els.countOutput.textContent = String(state.playerCount);
  els.countDown.disabled = state.playerCount <= minimum;
  els.countUp.disabled = state.playerCount >= maximum;
  els.excludeResultsButton.hidden = state.mode !== "open";
}

function animatePlayerCount(previous, next) {
  if (previous === next) return;
  const output = els.countOutput;
  const stepper = output.closest(".count-stepper");
  if (!stepper) return;

  const direction = next > previous ? "up" : "down";
  stepper.dataset.direction = direction;
  output.classList.remove("is-count-changing", "is-count-increasing", "is-count-decreasing");
  void output.offsetWidth;
  output.classList.add("is-count-changing", direction === "up" ? "is-count-increasing" : "is-count-decreasing");

  if (countAnimationTimerId !== null) clearTimeout(countAnimationTimerId);
  countAnimationTimerId = window.setTimeout(() => {
    output.classList.remove("is-count-changing", "is-count-increasing", "is-count-decreasing");
    stepper.dataset.direction = "idle";
    countAnimationTimerId = null;
  }, 360);
}

function renderResults() {
  els.resultsGrid.replaceChildren();
  for (let index = 0; index < resultCount(); index++) {
    const card = document.createElement("article");
    card.className = `result-card${state.mode === "unity" ? " result-card--unity" : ""}`;
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
      input.value = state.playerNames[index] || "";
      input.placeholder = `Player ${index + 1}`;
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
      card.append(content, icon);
    }
    els.resultsGrid.append(card);
  }
  els.excludeResultsButton.disabled = state.mode !== "open" || state.results.length !== state.playerCount || state.results.some(id => !id);
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
  let categoryIndex = 0;
  groups.forEach((items, category) => {
    const categoryLabel = category.replace(/系$/, "");
    const isCollapsed = collapsedCategories.has(category);
    const section = document.createElement("section");
    section.className = `category-group${isCollapsed ? " is-collapsed" : ""}`;
    section.dataset.category = category;
    section.dataset.categoryLabel = categoryLabel;
    const header = document.createElement("div");
    header.className = "category-group__header";
    const heading = document.createElement("h3");
    heading.textContent = categoryLabel;
    const count = document.createElement("span");
    count.textContent = `${items.filter(item => !item.excluded[state.mode]).length} / ${items.length}`;
    heading.append(count);
    const controls = document.createElement("div");
    controls.className = "category-group__controls";
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
    const contentId = `category-content-${categoryIndex++}`;
    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "category-toggle-button";
    toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
    toggleButton.setAttribute("aria-controls", contentId);
    toggleButton.setAttribute("aria-label", `${categoryLabel}を${isCollapsed ? "開く" : "閉じる"}`);
    toggleButton.innerHTML = '<svg class="ui-icon category-toggle-button__arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>';
    controls.append(actions, toggleButton);
    header.append(heading, controls);
    const chips = document.createElement("div");
    chips.className = "item-chips";
    items.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `item-chip${item.excluded[state.mode] ? " is-excluded" : ""}`;
      const icon = document.createElement("span");
      icon.className = "item-chip__icon";
      const iconFile = window.WEAPON_ICONS?.[item.name];
      if (iconFile) {
        const image = document.createElement("img");
        const iconUrl = `_images/MainWeapons/${encodeURIComponent(iconFile)}`;
        if (isCollapsed) image.dataset.src = iconUrl;
        else image.src = iconUrl;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("error", () => { image.hidden = true; });
        icon.append(image);
      }
      const name = document.createElement("span");
      name.className = "item-chip__name";
      name.textContent = item.name;
      button.append(icon, name);
      button.setAttribute("aria-pressed", String(item.excluded[state.mode]));
      button.setAttribute("aria-label", `${item.name}を${item.excluded[state.mode] ? "抽選対象に戻す" : "除外する"}`);
      button.addEventListener("click", () => toggleItem(item.id));
      chips.append(button);
    });
    const content = document.createElement("div");
    content.id = contentId;
    content.className = "category-group__content";
    content.setAttribute("aria-hidden", String(isCollapsed));
    content.inert = isCollapsed;
    const contentInner = document.createElement("div");
    contentInner.className = "category-group__content-inner";
    contentInner.append(chips);
    content.append(contentInner);
    toggleButton.addEventListener("click", () => {
      const willOpen = section.classList.contains("is-collapsed");
      setCategoryGroupCollapsed(section, content, toggleButton, category, categoryLabel, !willOpen);
      updateCategoryToggleSummary();
    });
    section.append(header, content);
    els.categoryList.append(section);
  });
  updateCategoryToggleSummary();
}

function renderPoolCount() {
  const activeCount = state.items.filter(item => !item.excluded[state.mode]).length;
  els.activeCount.textContent = activeCount;
  els.totalCount.textContent = state.items.length;
  els.excludedCount.textContent = state.items.length - activeCount;
}

function findItem(id) { return state.items.find(item => item.id === id); }
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
function showNotice(message, type = "", duration = type === "success" ? 3000 : 0) {
  if (noticeTimerId !== null) clearTimeout(noticeTimerId);
  els.notice.textContent = message;
  els.notice.className = `notice${type ? ` is-${type}` : ""}`;
  els.notice.hidden = false;
  noticeTimerId = duration > 0 ? window.setTimeout(hideNotice, duration) : null;
}
