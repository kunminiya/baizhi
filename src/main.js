import './style.css'
import init, {
  Edge,
  Todos,
  drag,
  meaningful,
  reel_batch,
  stamp,
  storage_key,
  trim,
} from './generated/baizhi_core.js'
import wasmUrl from './generated/baizhi_core_bg.wasm?url'

import { Capacitor } from '@capacitor/core'

const IS_NATIVE = Capacitor.isNativePlatform()
const SYNC_KEY = 'baizhi.sync.v1'
/** @type {{ Haptics: any, ImpactStyle: any } | null} */
let hapticsMod = null
/** @type {{ StatusBar: any, Style: any } | null} */
let statusBarMod = null

function hapticLight() {
  if (!IS_NATIVE || !hapticsMod) return
  hapticsMod.Haptics.impact({ style: hapticsMod.ImpactStyle.Light }).catch(() => {})
}

async function syncStatusBar(dark) {
  if (!IS_NATIVE || !statusBarMod) return
  try {
    const { StatusBar, Style } = statusBarMod
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: dark ? '#0c0c0c' : '#f7f5f2' })
  } catch {}
}

async function setupNativeChrome() {
  if (!IS_NATIVE) return
  try {
    hapticsMod = await import('@capacitor/haptics')
  } catch {}
  try {
    statusBarMod = await import('@capacitor/status-bar')
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    await syncStatusBar(darkMq.matches)
    darkMq.addEventListener?.('change', (ev) => {
      syncStatusBar(ev.matches)
    })
  } catch {}
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {})
  } catch {}
  try {
    const { App } = await import('@capacitor/app')
    App.addListener('backButton', () => {
      if (!syncBackdrop.hidden) {
        closeSyncSheet()
        return
      }
      if (!searchWrap.hidden) {
        closeSearch()
        return
      }
      if (!ctxMenu.hidden) {
        hideCtxMenu()
        return
      }
      const ae = document.activeElement
      if (ae instanceof HTMLTextAreaElement && ae.classList.contains('todo-text')) {
        dismissMenuAndBlur({ blurActive: true })
        return
      }
      App.minimizeApp().catch(() => {})
    })
  } catch {}
}

await init({ module_or_path: wasmUrl })
const STORAGE_KEY = storage_key()
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const LONG_MS = 480
const DOUBLE_MS = 320
const SAVE_DEBOUNCE_MS = 120
const SYNC_DEBOUNCE_MS = 1500

function clearDomSelection() {
  try {
    const sel = window.getSelection?.()
    sel?.removeAllRanges()
  } catch {}
  const ae = document.activeElement
  if (ae instanceof HTMLTextAreaElement || ae instanceof HTMLInputElement) {
    try {
      const end = ae.selectionEnd ?? ae.value.length
      ae.setSelectionRange(end, end)
    } catch {}
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  try {
    const tmp = document.createElement('textarea')
    tmp.value = text
    tmp.style.position = 'fixed'
    tmp.style.opacity = '0'
    document.body.appendChild(tmp)
    tmp.select()
    const ok = document.execCommand('copy')
    tmp.remove()
    return ok
  } catch {
    return false
  }
}

/** @typedef {{ id: string, text: string, createdAt: number, completed: boolean, completedAt?: number|null, pinned?: boolean }} Todo */

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="app-header">
    <div class="header-left">
      <button class="icon-btn" id="searchBtn" type="button" aria-label="搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <path d="M20 20l-3.5-3.5"/>
        </svg>
      </button>
      <div class="search-wrap" id="searchWrap" hidden>
        <input class="search-input" id="searchInput" type="search" placeholder="搜索待办…" autocomplete="off" />
        <button class="search-clear" id="searchClear" type="button" aria-label="清除搜索">×</button>
      </div>
    </div>
    <div class="header-right">
      <button class="sync-btn" id="syncBtn" type="button" data-state="idle" aria-label="云同步">
        <span class="sync-dot"></span>
      </button>
      <div class="app-meta" id="countMeta"></div>
    </div>
  </header>
  <main class="paper-scroll" id="paper" aria-label="白纸待办">
    <div class="empty-state" id="empty">
      <div class="empty-glyph" aria-hidden="true"></div>
      <p class="empty-title">轻写下第一件事</p>
      <p class="empty-sub">点 + 新建 · 长按 + 语音 · 双击划线 · 长按菜单</p>
    </div>
    <ul class="todo-list" id="list"></ul>
    <div class="tap-catcher" id="tapCatcher" aria-hidden="true"></div>
  </main>
  <button class="fab" id="fab" type="button" aria-label="新建">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  </button>
`

const listEl = /** @type {HTMLUListElement} */ (document.getElementById('list'))
const emptyEl = /** @type {HTMLElement} */ (document.getElementById('empty'))
const countMeta = /** @type {HTMLElement} */ (document.getElementById('countMeta'))
const paper = /** @type {HTMLElement} */ (document.getElementById('paper'))
const fab = /** @type {HTMLButtonElement} */ (document.getElementById('fab'))
const tapCatcher = /** @type {HTMLElement} */ (document.getElementById('tapCatcher'))
const searchBtn = /** @type {HTMLButtonElement} */ (document.getElementById('searchBtn'))
const searchWrap = /** @type {HTMLElement} */ (document.getElementById('searchWrap'))
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('searchInput'))
const searchClear = /** @type {HTMLButtonElement} */ (document.getElementById('searchClear'))
const syncBtn = /** @type {HTMLButtonElement} */ (document.getElementById('syncBtn'))

/** Floating long-press context menu — horizontal Android-style pill toolbar */
const ctxMenu = document.createElement('div')
ctxMenu.className = 'ctx-menu'
ctxMenu.hidden = true
ctxMenu.setAttribute('role', 'menu')
ctxMenu.innerHTML = `<button type="button" class="ctx-item" data-action="edit" role="menuitem">编辑</button>`
document.body.appendChild(ctxMenu)

/** Lightweight bottom toast (undo delete / voice / backup / sync feedback) */
const toastEl = document.createElement('div')
toastEl.className = 'toast'
toastEl.hidden = true
toastEl.setAttribute('role', 'status')
toastEl.setAttribute('aria-live', 'polite')
const toastTextEl = document.createElement('span')
const toastActionBtn = document.createElement('button')
toastActionBtn.type = 'button'
toastActionBtn.className = 'toast-action'
toastActionBtn.hidden = true
toastEl.append(toastTextEl, toastActionBtn)
document.body.appendChild(toastEl)

/** Minimal Cloud Sync Settings Sheet */
const syncBackdrop = document.createElement('div')
syncBackdrop.className = 'sync-backdrop'
syncBackdrop.hidden = true
syncBackdrop.innerHTML = `
  <div class="sync-sheet" role="dialog" aria-label="云同步设置">
    <h2 class="sync-title">云同步与备份</h2>
    <p class="sync-status-text" id="syncStatusText">未配置云同步</p>
    <label class="sync-field">
      <span>同步地址</span>
      <input id="syncUrlInput" type="url" placeholder="https://your-host:5986/baizhi" autocomplete="off" />
    </label>
    <label class="sync-field">
      <span>同步口令（Token）</span>
      <input id="syncTokenInput" type="password" placeholder="输入同步口令" autocomplete="off" />
    </label>
    <div class="sync-actions">
      <button type="button" class="sync-btn-primary" id="syncSaveBtn">保存并同步</button>
      <button type="button" class="sync-btn-secondary" id="syncBackupBtn">复制备份</button>
      <button type="button" class="sync-btn-secondary" id="syncCloseBtn">关闭</button>
    </div>
  </div>
`
document.body.appendChild(syncBackdrop)
const syncStatusText = /** @type {HTMLElement} */ (document.getElementById('syncStatusText'))
const syncUrlInput = /** @type {HTMLInputElement} */ (document.getElementById('syncUrlInput'))
const syncTokenInput = /** @type {HTMLInputElement} */ (document.getElementById('syncTokenInput'))
const syncSaveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('syncSaveBtn'))
const syncBackupBtn = /** @type {HTMLButtonElement} */ (document.getElementById('syncBackupBtn'))
const syncCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('syncCloseBtn'))

let toastTimer = 0
/** @type {(() => void) | null} */
let toastActionHandler = null

function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = 0
  }
  toastActionHandler = null
  toastActionBtn.hidden = true
  toastEl.hidden = true
}

function showToast(message, { actionLabel = '', onAction = null, durationMs = 3500 } = {}) {
  hideToast()
  toastTextEl.textContent = message
  if (actionLabel && onAction) {
    toastActionBtn.textContent = actionLabel
    toastActionBtn.hidden = false
    toastActionHandler = onAction
  }
  toastEl.hidden = false
  if (durationMs > 0) {
    toastTimer = window.setTimeout(hideToast, durationMs)
  }
}

toastEl.addEventListener('pointerdown', (e) => e.stopPropagation())
toastActionBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const fn = toastActionHandler
  hideToast()
  fn?.()
})

setupNativeChrome()

// Filter & search state
/** @type {'all' | 'open' | 'done'} */
let activeFilter = 'all'
let searchQuery = ''

// Cloud sync config
function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        url: String(parsed.url || '').trim(),
        token: String(parsed.token || '').trim(),
        lastSyncAt: Number(parsed.lastSyncAt || 0),
      }
    }
  } catch {}
  const defaultUrl =
    !IS_NATIVE && location.protocol.startsWith('http') && location.pathname.startsWith('/baizhi')
      ? `${location.origin}/baizhi`
      : ''
  return { url: defaultUrl, token: '', lastSyncAt: 0 }
}

let syncConfig = loadSyncConfig()
let syncTimer = 0
let syncInFlight = false

function saveSyncConfig() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(syncConfig))
  } catch {}
}

function isSyncConfigured() {
  return Boolean(syncConfig.url && syncConfig.token)
}

function setSyncState(state, detail = '') {
  syncBtn.dataset.state = state
  if (detail) {
    syncStatusText.textContent = detail
  } else if (!isSyncConfigured()) {
    syncStatusText.textContent = '未配置云同步（数据仅存本机）'
  } else if (syncConfig.lastSyncAt) {
    syncStatusText.textContent = `上次同步：${formatStamp(syncConfig.lastSyncAt)}`
  } else {
    syncStatusText.textContent = '已配置，等待同步'
  }
}

function syncEndpoint() {
  const base = syncConfig.url.replace(/\/+$/, '')
  return base.endsWith('/api/sync') ? base : `${base}/api/sync`
}

async function syncNow({ silent = true } = {}) {
  if (!isSyncConfigured() || syncInFlight) return false
  flushPendingSave()
  syncInFlight = true
  setSyncState('syncing', '正在同步…')
  try {
    const res = await fetch(syncEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${syncConfig.token}`,
      },
      body: todos.sync_payload(),
    })
    if (!res.ok) {
      throw new Error(res.status === 401 ? '口令错误' : `HTTP ${res.status}`)
    }
    const text = await res.text()
    const changed = todos.merge_remote(text)
    syncConfig.lastSyncAt = Date.now()
    saveSyncConfig()
    setSyncState('synced', `同步成功 · ${formatStamp(syncConfig.lastSyncAt)}`)
    if (changed) {
      const ae = document.activeElement
      const isEditingNow = ae instanceof HTMLTextAreaElement && ae.classList.contains('todo-text')
      if (!isEditingNow) renderAll()
      else updateMeta()
    }
    if (!silent) showToast('云同步完成', { durationMs: 2000 })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络异常'
    setSyncState('error', `同步失败：${msg}`)
    if (!silent) showToast(`同步失败：${msg}`, { durationMs: 2600 })
    return false
  } finally {
    syncInFlight = false
  }
}

function scheduleSync() {
  if (!isSyncConfigured()) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncTimer = 0
    syncNow({ silent: true })
  }, SYNC_DEBOUNCE_MS)
}

function openSyncSheet() {
  hideCtxMenu()
  syncUrlInput.value = syncConfig.url || ''
  syncTokenInput.value = syncConfig.token || ''
  setSyncState(syncBtn.dataset.state || (isSyncConfigured() ? 'synced' : 'idle'))
  syncBackdrop.hidden = false
}

function closeSyncSheet() {
  syncBackdrop.hidden = true
}

syncBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  openSyncSheet()
})
syncBackdrop.addEventListener('click', (e) => {
  if (e.target === syncBackdrop) closeSyncSheet()
})
syncCloseBtn.addEventListener('click', closeSyncSheet)
syncBackupBtn.addEventListener('click', () => {
  copyBackupJson()
})
syncSaveBtn.addEventListener('click', async () => {
  syncConfig.url = syncUrlInput.value.trim().replace(/\/+$/, '')
  syncConfig.token = syncTokenInput.value.trim()
  saveSyncConfig()
  if (!isSyncConfigured()) {
    setSyncState('idle', '已清除同步配置（仅本地保存）')
    showToast('已切换为仅本地模式', { durationMs: 2000 })
    closeSyncSheet()
    return
  }
  const ok = await syncNow({ silent: false })
  if (ok) closeSyncSheet()
})

// Small, touch-following edge resistance. Native scrolling remains in charge
// everywhere except a short drag past either real scroll boundary.
let edgeTouch = null
let edgeSettleTimer = 0
let edgeInertiaRaf = 0
const edge = new Edge()
function edgeOffset(y) {
  paper.style.setProperty('--edge-y', `${y.toFixed(2)}px`)
}
function settleEdge() {
  clearTimeout(edgeSettleTimer)
  paper.classList.add('edge-settling')
  edgeOffset(0)
  edgeSettleTimer = window.setTimeout(() => paper.classList.remove('edge-settling'), 260)
}
function animateInertialEdge(direction) {
  if (REDUCE_MOTION || edgeTouch?.active) return
  cancelAnimationFrame(edgeInertiaRaf)
  const initial = edge.start(direction, performance.now())
  const tick = (now) => {
    edgeOffset(edge.step(now))
    if (edge.settled()) {
      edgeOffset(0)
      edgeInertiaRaf = 0
      return
    }
    edgeInertiaRaf = requestAnimationFrame(tick)
  }
  edgeOffset(initial)
  edgeInertiaRaf = requestAnimationFrame(tick)
}

paper.addEventListener(
  'touchstart',
  (ev) => {
    if (REDUCE_MOTION || ev.touches.length !== 1) return
    cancelAnimationFrame(edgeInertiaRaf)
    edgeInertiaRaf = 0
    edge.sample_origin(paper.scrollTop, performance.now())
    edgeTouch = { y: ev.touches[0].clientY, active: false }
  },
  { passive: true },
)
paper.addEventListener(
  'touchmove',
  (ev) => {
    if (!edgeTouch || ev.touches.length !== 1) return
    const dy = ev.touches[0].clientY - edgeTouch.y
    const offset = drag(dy, paper.scrollTop, paper.scrollHeight - paper.clientHeight, edgeTouch.active)
    if (Number.isNaN(offset)) return
    edgeTouch.active = true
    ev.preventDefault()
    edgeOffset(offset)
  },
  { passive: false },
)
paper.addEventListener(
  'touchend',
  () => {
    if (edgeTouch?.active) settleEdge()
    edgeTouch = null
  },
  { passive: true },
)
paper.addEventListener(
  'touchcancel',
  () => {
    if (edgeTouch?.active) settleEdge()
    edgeTouch = null
  },
  { passive: true },
)

function fillCtxMenu(todo) {
  const done = Boolean(todo?.completed)
  const pinned = Boolean(todo?.pinned)
  const toggleLabel = done ? '取消完成' : '完成'
  const pinLabel = pinned ? '取消置顶' : '置顶'
  ctxMenu.innerHTML =
    `<button type="button" class="ctx-item" data-action="edit" role="menuitem">编辑</button>` +
    `<button type="button" class="ctx-item" data-action="toggle" role="menuitem">${toggleLabel}</button>` +
    `<button type="button" class="ctx-item" data-action="pin" role="menuitem">${pinLabel}</button>` +
    `<button type="button" class="ctx-item" data-action="copy" role="menuitem">复制</button>` +
    `<button type="button" class="ctx-item ctx-item-danger" data-action="delete" role="menuitem">删除</button>`
}

const todos = new Todos()
let reelRaf = 0
/** @type {string|null} */
let ctxTargetId = null
/** @type {WeakMap<HTMLTextAreaElement, () => void>} */
const enterEditByTa = new WeakMap()
const rowStateByEl = new WeakMap()

/** Timestamp until which blank-draft accidental blur must re-focus (FAB settle). */
let draftGuardUntil = 0
/** >0 while blur is an intentional dismiss (outside tap / Esc / Enter). */
let expectIntentionalBlur = 0

// Debounced persistence for typing
let saveTimer = 0
let saveDirty = false

function flushPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
  if (!saveDirty) return
  saveDirty = false
  try {
    todos.flush()
  } catch {}
  scheduleSync()
}

function scheduleSave() {
  saveDirty = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushPendingSave()
  else syncNow({ silent: true })
})
window.addEventListener('pagehide', flushPendingSave)

function isMeaningful(text) {
  return meaningful(String(text ?? ''))
}

function armDraftGuard(ms = 2800) {
  draftGuardUntil = Math.max(draftGuardUntil, Date.now() + ms)
}

function markIntentionalBlur() {
  expectIntentionalBlur += 1
  queueMicrotask(() => {
    expectIntentionalBlur = Math.max(0, expectIntentionalBlur - 1)
  })
}

function formatStamp(ms) {
  return stamp(ms, Date.now())
}

function formatTimeLabel(todo) {
  const base = formatStamp(todo.createdAt)
  return todo.pinned ? `置顶 · ${base}` : base
}

function applyFilters() {
  const q = searchQuery.trim().toLowerCase()
  const children = listEl.children
  for (let i = 0; i < children.length; i++) {
    const el = /** @type {HTMLLIElement} */ (children[i])
    const isDone = el.classList.contains('is-done')
    const isEditing = el.classList.contains('is-editing')
    let visible = true
    if (!isEditing) {
      if (activeFilter === 'open' && isDone) visible = false
      else if (activeFilter === 'done' && !isDone) visible = false
      if (visible && q) {
        const state = rowStateByEl.get(el)
        const txt = (state ? state.ta.value : el.textContent || '').toLowerCase()
        if (!txt.includes(q)) visible = false
      }
    }
    el.classList.toggle('is-hidden-filter', !visible)
  }
  scheduleReel()
}

function updateMeta() {
  const total = todos.count()
  const done = todos.done_count()
  const open = total - done
  if (total === 0) {
    countMeta.textContent = ''
  } else {
    countMeta.innerHTML =
      `<button type="button" class="meta-chip meta-open${activeFilter === 'open' ? ' is-active' : ''}" data-filter="open">未完成 ${open}</button>` +
      `<span class="meta-sep">·</span>` +
      `<button type="button" class="meta-chip meta-done${activeFilter === 'done' ? ' is-active' : ''}" data-filter="done">已完成 ${done}</button>`
  }
  emptyEl.classList.toggle('is-visible', total === 0)
}

countMeta.addEventListener('click', (e) => {
  const chip = /** @type {HTMLElement | null} */ (
    e.target instanceof HTMLElement ? e.target.closest('[data-filter]') : null
  )
  if (!chip) return
  e.stopPropagation()
  const target = /** @type {'open' | 'done'} */ (chip.dataset.filter)
  activeFilter = activeFilter === target ? 'all' : target
  hapticLight()
  updateMeta()
  applyFilters()
})

// Minimal header search
function openSearch() {
  hideCtxMenu()
  searchBtn.hidden = true
  searchWrap.hidden = false
  searchInput.focus()
}

function closeSearch() {
  searchQuery = ''
  searchInput.value = ''
  searchWrap.hidden = true
  searchBtn.hidden = false
  applyFilters()
}

searchBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  openSearch()
})
searchClear.addEventListener('click', (e) => {
  e.stopPropagation()
  closeSearch()
})
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value
  applyFilters()
})
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  }
})
searchInput.addEventListener('blur', () => {
  if (!searchInput.value.trim()) {
    window.setTimeout(() => {
      if (document.activeElement !== searchInput && !searchInput.value.trim()) {
        closeSearch()
      }
    }, 120)
  }
})

function autoSize(ta) {
  ta.style.height = 'auto'
  ta.style.height = `${ta.scrollHeight}px`
}

function hideCtxMenu() {
  ctxMenu.hidden = true
  ctxMenu.classList.remove('is-open')
  ctxTargetId = null
  document.querySelectorAll('.todo-item.is-menu-open').forEach((el) => {
    el.classList.remove('is-menu-open')
  })
}

function showCtxMenu(li, clientX, clientY) {
  hideCtxMenu()
  ctxTargetId = li.dataset.id || null
  const todo = todos.get(ctxTargetId)
  fillCtxMenu(todo)
  li.classList.add('is-menu-open')
  ctxMenu.hidden = false
  ctxMenu.classList.add('is-open')
  const pad = 10
  const vvTop = window.visualViewport?.offsetTop || 0
  ctxMenu.style.left = '0px'
  ctxMenu.style.top = '0px'
  const mw = Math.max(ctxMenu.offsetWidth || 160, 120)
  const mh = Math.max(ctxMenu.offsetHeight || 40, 36)
  let left = clientX - mw / 2
  let top = clientY - mh - 14
  if (top < pad + vvTop) top = clientY + 14
  left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad))
  top = Math.max(pad + vvTop, Math.min(top, window.innerHeight - mh - pad))
  ctxMenu.style.left = `${left}px`
  ctxMenu.style.top = `${top}px`
}

function dismissMenuAndBlur({ blurActive = false } = {}) {
  hideCtxMenu()
  if (!blurActive) return
  const ae = document.activeElement
  if (ae instanceof HTMLTextAreaElement && ae.classList.contains('todo-text')) {
    markIntentionalBlur()
    ae.blur()
  }
}

// Reveal only the editor, never the trailing tap-catcher/padding. No smooth
// scroll or delayed focus may compete with a finger gesture or keyboard resize.
function revealEditor(ta) {
  const row = ta.closest('.todo-item').getBoundingClientRect()
  const bounds = paper.getBoundingClientRect()
  const vv = window.visualViewport
  const bottom = Math.min(bounds.bottom, vv ? vv.offsetTop + vv.height : innerHeight)
  const top = bounds.top + bounds.height * 0.28
  const lower = bottom - 28
  if (row.bottom > lower) paper.scrollTop += row.bottom - lower
  else if (row.top < top) paper.scrollTop -= Math.min(top - row.top, lower - row.bottom)
  scheduleReel()
}

// Reusable typed buffers for single-call Wasm reel_batch
let reelCap = 64
let reelIn = new Float64Array(reelCap * 3)
let reelOut = new Float64Array(reelCap * 6)
const visibleRows = []
const offscreenRows = []

function ensureReelCapacity(n) {
  if (n <= reelCap) return
  reelCap = Math.max(n, reelCap * 2)
  reelIn = new Float64Array(reelCap * 3)
  reelOut = new Float64Array(reelCap * 6)
}

/** Soft-float reel / vanish — v5 soft-float motion (batched Wasm + diffed writes) */
function updateReel() {
  reelRaf = 0
  const children = listEl.children
  const len = children.length
  if (len === 0) return

  if (REDUCE_MOTION) {
    for (let i = 0; i < len; i++) {
      const el = /** @type {HTMLLIElement} */ (children[i])
      if (el.classList.contains('is-hidden-filter')) continue
      const state = rowStateByEl.get(el)
      const face = state ? state.face : el.querySelector('.todo-face')
      if (face) {
        if (!state || state.lastTransform !== '') {
          face.style.transform = ''
          if (state) state.lastTransform = ''
        }
        if (!state || state.lastFilter !== '') {
          face.style.filter = ''
          if (state) state.lastFilter = ''
        }
      }
      const nextOp = el.classList.contains('is-done') ? '0.88' : '1'
      if (!state || state.lastOpacity !== nextOp) {
        el.style.opacity = nextOp
        if (state) state.lastOpacity = nextOp
      }
    }
    return
  }

  const paperRect = paper.getBoundingClientRect()
  const minY = paperRect.top - 100
  const maxY = paperRect.bottom + 100
  visibleRows.length = 0
  offscreenRows.length = 0

  for (let i = 0; i < len; i++) {
    const el = /** @type {HTMLLIElement} */ (children[i])
    if (el.classList.contains('is-hidden-filter')) continue
    const state = rowStateByEl.get(el)
    const box = el.getBoundingClientRect()
    if (box.bottom < minY || box.top > maxY) {
      offscreenRows.push({ el, state })
      continue
    }
    const idx = visibleRows.length
    ensureReelCapacity(idx + 1)
    const base = idx * 3
    reelIn[base] = box.top
    reelIn[base + 1] = box.height
    reelIn[base + 2] = el.classList.contains('is-done') ? 1 : 0
    visibleRows.push({ el, state })
  }

  const visCount = visibleRows.length
  if (visCount > 0) {
    reel_batch(
      paperRect.top,
      paperRect.height,
      reelIn.subarray(0, visCount * 3),
      reelOut.subarray(0, visCount * 6),
    )
  }

  for (let i = 0; i < offscreenRows.length; i++) {
    const { el, state } = offscreenRows[i]
    if (!state || state.lastOpacity !== '0') {
      el.style.opacity = '0'
      if (state) state.lastOpacity = '0'
    }
  }

  for (let i = 0; i < visCount; i++) {
    const { el, state } = visibleRows[i]
    const face = state ? state.face : el.querySelector('.todo-face') || el
    const o = i * 6
    const y = reelOut[o]
    const z = reelOut[o + 1]
    const rotX = reelOut[o + 2]
    const scale = reelOut[o + 3]
    const blur = reelOut[o + 4]
    const opacity = reelOut[o + 5]

    const nextTransform = `translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${rotX.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    const nextFilter = blur > 0.04 ? `blur(${blur.toFixed(2)}px)` : ''
    const nextOpacity = opacity.toFixed(3)

    if (!state || state.lastTransform !== nextTransform) {
      face.style.transform = nextTransform
      if (state) state.lastTransform = nextTransform
    }
    if (!state || state.lastFilter !== nextFilter) {
      face.style.filter = nextFilter
      if (state) state.lastFilter = nextFilter
    }
    if (!state || state.lastOpacity !== nextOpacity) {
      el.style.opacity = nextOpacity
      if (state) state.lastOpacity = nextOpacity
    }
  }
}

function scheduleReel() {
  reelRaf ||= requestAnimationFrame(updateReel)
}

// Delegated row gesture state (single active press at a time across listEl)
/** @type {HTMLLIElement | null} */
let activePressLi = null
let activeLongTimer = 0
let pressStartX = 0
let pressStartY = 0
let pressStartScrollTop = 0
let pressActive = false
let longFired = false

function clearPressVisual(li) {
  li?.classList.remove('is-longpressing', 'is-pressing')
}

function clearPressTimer() {
  if (activeLongTimer) {
    clearTimeout(activeLongTimer)
    activeLongTimer = 0
  }
}

function endPressCleanup() {
  clearPressTimer()
  clearPressVisual(activePressLi)
  pressActive = false
  activePressLi = null
}

function beginPress(li, clientX, clientY, pointerId) {
  const st = rowStateByEl.get(li)
  if (!st || st.editing || document.activeElement === st.ta) return false
  endPressCleanup()
  activePressLi = li
  pressActive = true
  longFired = false
  pressStartX = clientX
  pressStartY = clientY
  pressStartScrollTop = paper.scrollTop
  li.classList.add('is-pressing', 'is-longpressing')
  activeLongTimer = window.setTimeout(() => {
    activeLongTimer = 0
    if (!pressActive || activePressLi !== li || !li.isConnected) return
    longFired = true
    st.lastTapAt = 0
    clearPressVisual(li)
    hapticLight()
    st.lockTextarea()
    clearDomSelection()
    if (document.activeElement === st.ta) {
      try {
        st.ta.blur()
      } catch {}
    }
    try {
      st.ta.setSelectionRange(0, 0)
    } catch {}
    showCtxMenu(li, pressStartX, pressStartY)
    st.suppressClickUntil = performance.now() + 700
  }, LONG_MS)
  if (pointerId != null) {
    try {
      li.setPointerCapture(pointerId)
    } catch {}
  }
  return true
}

function movePress(clientX, clientY) {
  if (!pressActive || !activeLongTimer) return
  const dx = clientX - pressStartX
  const dy = clientY - pressStartY
  if (dx * dx + dy * dy > 64) {
    endPressCleanup()
  }
}

function finishPress(li) {
  if ((!pressActive && !longFired) || (activePressLi && li && activePressLi !== li)) {
    return
  }
  const targetLi = activePressLi || li
  const st = targetLi ? rowStateByEl.get(targetLi) : null
  const wasLong = longFired
  const isShortTap = !!activeLongTimer && pressActive
  endPressCleanup()
  longFired = false
  if (!st) return
  if (wasLong) {
    st.suppressClickUntil = Math.max(st.suppressClickUntil, performance.now() + 500)
    return
  }
  if (!isShortTap || st.editing || document.activeElement === st.ta) return
  const now = performance.now()
  if (st.lastTapAt && now - st.lastTapAt < DOUBLE_MS) {
    st.lastTapAt = 0
    hideCtxMenu()
    hapticLight()
    toggleDone(st.id)
  } else {
    st.lastTapAt = now
    hideCtxMenu()
  }
}

function rowFromEvent(ev) {
  const t = ev.target
  return /** @type {HTMLLIElement | null} */ (t instanceof Element ? t.closest('.todo-item') : null)
}

listEl.addEventListener('pointerdown', (ev) => {
  const li = rowFromEvent(ev)
  if (!li) return
  const st = rowStateByEl.get(li)
  if (!st || st.editing || document.activeElement === st.ta) return
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  beginPress(li, ev.clientX, ev.clientY, ev.pointerId)
})

listEl.addEventListener('pointermove', (ev) => {
  if (!pressActive) return
  movePress(ev.clientX, ev.clientY)
})

listEl.addEventListener('pointerup', (ev) => {
  finishPress(rowFromEvent(ev))
})

listEl.addEventListener(
  'pointercancel',
  (ev) => {
    const li = rowFromEvent(ev) || activePressLi
    clearPressVisual(li)
  },
  { capture: true },
)

listEl.addEventListener(
  'pointerleave',
  (ev) => {
    if (ev.pointerType === 'mouse' && activePressLi && ev.target === activePressLi) {
      endPressCleanup()
    }
  },
  { capture: true },
)

listEl.addEventListener(
  'touchstart',
  (ev) => {
    const li = rowFromEvent(ev)
    if (!li) return
    const st = rowStateByEl.get(li)
    if (!st || st.editing || document.activeElement === st.ta) return
    if (ev.touches.length !== 1) return
    if (pressActive || activeLongTimer) return
    const t = ev.touches[0]
    beginPress(li, t.clientX, t.clientY, null)
  },
  { passive: true },
)

listEl.addEventListener(
  'touchmove',
  (ev) => {
    if (!pressActive || !activeLongTimer || ev.touches.length !== 1) return
    const t = ev.touches[0]
    movePress(t.clientX, t.clientY)
  },
  { passive: true },
)

listEl.addEventListener(
  'touchend',
  (ev) => {
    if (!pressActive && !longFired) return
    finishPress(rowFromEvent(ev))
  },
  { passive: true },
)

listEl.addEventListener('touchcancel', endPressCleanup, { passive: true })

listEl.addEventListener('click', (ev) => {
  const li = rowFromEvent(ev)
  if (!li) return
  const st = rowStateByEl.get(li)
  if (st && !st.editing && performance.now() < st.suppressClickUntil) {
    ev.preventDefault()
  }
})

listEl.addEventListener('contextmenu', (ev) => {
  const li = rowFromEvent(ev)
  if (!li) return
  const st = rowStateByEl.get(li)
  if (st && !st.editing) ev.preventDefault()
})

// Single merged scroll handler
paper.addEventListener(
  'scroll',
  () => {
    const top = paper.scrollTop
    const direction = edge.scroll(
      top,
      paper.scrollHeight - paper.clientHeight,
      performance.now(),
      Boolean(edgeTouch?.active),
    )
    if (direction) animateInertialEdge(direction)
    if (pressActive && Math.abs(top - pressStartScrollTop) > 2) {
      endPressCleanup()
    }
    scheduleReel()
    if (!ctxMenu.hidden) hideCtxMenu()
  },
  { passive: true },
)

/**
 * @param {Todo} todo
 * @param {{ animate?: boolean, startEditing?: boolean }} [opts]
 */
function createItemEl(todo, { animate = false, startEditing = false } = {}) {
  const li = document.createElement('li')
  li.className = `todo-item${todo.completed ? ' is-done' : ''}${todo.pinned ? ' is-pinned' : ''}${animate ? ' is-entering' : ''}`
  li.dataset.id = todo.id
  li.dataset.createdAt = String(todo.createdAt)
  li.innerHTML = `
    <div class="todo-face">
      <div class="todo-body">
        <time class="todo-time" datetime="${new Date(todo.createdAt).toISOString()}">${formatTimeLabel(todo)}</time>
        <textarea class="todo-text" rows="1" maxlength="280" placeholder="" enterkeyhint="done" readonly></textarea>
      </div>
    </div>
  `

  const face = /** @type {HTMLElement} */ (li.querySelector('.todo-face'))
  const timeEl = /** @type {HTMLElement} */ (li.querySelector('.todo-time'))
  const ta = /** @type {HTMLTextAreaElement} */ (li.querySelector('.todo-text'))
  ta.value = todo.text
  autoSize(ta)

  const lockTextarea = () => {
    ta.readOnly = true
    ta.tabIndex = -1
    ta.setAttribute('readonly', '')
    ta.classList.remove('is-unlocked')
  }

  const unlockTextarea = () => {
    ta.readOnly = false
    ta.tabIndex = 0
    ta.removeAttribute('readonly')
    ta.classList.add('is-unlocked')
  }

  const state = {
    id: todo.id,
    face,
    ta,
    timeEl,
    editing: false,
    enterEdit: () => {},
    exitEdit: () => {},
    lockTextarea,
    lastTapAt: 0,
    suppressClickUntil: 0,
    lastTransform: '',
    lastFilter: '',
    lastOpacity: '',
  }

  const enterEdit = () => {
    if (state.editing || !li.isConnected) return
    hideCtxMenu()
    document.querySelectorAll('.todo-item.is-editing').forEach((other) => {
      if (other === li) return
      const otherTa = other.querySelector('.todo-text')
      if (otherTa instanceof HTMLTextAreaElement) {
        markIntentionalBlur()
        otherTa.blur()
      }
    })
    state.editing = true
    unlockTextarea()
    li.classList.add('is-editing')
    try {
      ta.focus({ preventScroll: true })
    } catch {
      ta.focus()
    }
    const len = ta.value.length
    ta.setSelectionRange(len, len)
    revealEditor(ta)
  }

  const exitEdit = () => {
    state.editing = false
    lockTextarea()
    li.classList.remove('is-editing')
  }

  state.enterEdit = enterEdit
  state.exitEdit = exitEdit
  rowStateByEl.set(li, state)
  enterEditByTa.set(ta, enterEdit)
  li.addEventListener('baizhi:enter-edit', () => enterEdit())

  lockTextarea()
  if (startEditing) {
    requestAnimationFrame(() => enterEdit())
  }

  ta.addEventListener('pointerdown', (ev) => {
    if (state.editing) return
    ev.preventDefault()
    clearDomSelection()
  })

  ta.addEventListener('selectstart', (ev) => {
    if (state.editing) return
    ev.preventDefault()
  })

  ta.addEventListener('focus', () => {
    if (!state.editing) {
      try {
        ta.blur()
      } catch {}
      clearDomSelection()
    }
  })

  ta.addEventListener('input', () => {
    autoSize(ta)
    const becameMeaningful = todos.set_text(todo.id, ta.value)
    if (becameMeaningful) {
      saveDirty = true
      flushPendingSave()
    } else {
      scheduleSave()
    }
    scheduleReel()
  })

  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      markIntentionalBlur()
      ta.blur()
      hideCtxMenu()
      return
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      markIntentionalBlur()
      ta.blur()
    }
  })

  ta.addEventListener('blur', () => {
    const t = todos.get(todo.id)
    if (!t) {
      exitEdit()
      return
    }

    const intentional = expectIntentionalBlur > 0
    const trimmed = trim(ta.value)

    if (!intentional && Date.now() < draftGuardUntil && !isMeaningful(trimmed)) {
      state.editing = true
      unlockTextarea()
      li.classList.add('is-editing')
      requestAnimationFrame(() => {
        try {
          ta.focus({ preventScroll: true })
        } catch {}
      })
      return
    }

    exitEdit()

    if (!isMeaningful(trimmed)) {
      removeTodo(todo.id)
      return
    }

    todos.set_text(todo.id, trimmed)
    saveDirty = true
    flushPendingSave()
    ta.value = trimmed
    autoSize(ta)
    applyFilters()
    scheduleReel()
  })

  if (animate) {
    li.addEventListener(
      'animationend',
      () => {
        li.classList.remove('is-entering')
        scheduleReel()
      },
      { once: true },
    )
  }

  return li
}

function renderAll() {
  listEl.replaceChildren()
  const ordered = todos.items(true)
  const frag = document.createDocumentFragment()
  for (const t of ordered) frag.appendChild(createItemEl(t))
  listEl.appendChild(frag)
  updateMeta()
  applyFilters()
  scheduleReel()
}

function toggleDone(id) {
  flushPendingSave()
  const prev = todos.get(id)
  const wasPinned = Boolean(prev?.pinned)
  const t = todos.toggle(id, Date.now())
  if (!t) return
  scheduleSync()
  if (wasPinned && t.completed) {
    renderAll()
    return
  }
  const safe = id.replace(/"/g, '')
  const el = listEl.querySelector(`[data-id="${safe}"]`)
  if (el) {
    el.classList.toggle('is-done', t.completed)
    el.classList.toggle('is-pinned', Boolean(t.pinned))
    el.classList.remove('is-state-bounce')
    requestAnimationFrame(() => el.classList.add('is-state-bounce'))
    el.addEventListener('animationend', () => el.classList.remove('is-state-bounce'), { once: true })
    updateMeta()
    applyFilters()
    scheduleReel()
  } else {
    renderAll()
  }
}

function togglePin(id) {
  flushPendingSave()
  const t = todos.toggle_pin(id, Date.now())
  if (!t) return
  scheduleSync()
  renderAll()
  showToast(t.pinned ? '已置顶' : '已取消置顶', { durationMs: 1600 })
}

function removeTodo(id, { allowUndo = false } = {}) {
  flushPendingSave()
  const prev = allowUndo ? todos.get(id) : null
  const removed = isSyncConfigured() ? todos.soft_remove(id, Date.now()) : todos.remove(id)
  if (!removed) return
  scheduleSync()
  const safe = id.replace(/"/g, '')
  const li = listEl.querySelector(`.todo-item[data-id="${safe}"]`)
  if (li) li.remove()
  updateMeta()
  scheduleReel()
  if (allowUndo && prev && isMeaningful(prev.text)) {
    showToast('已删除', {
      actionLabel: '撤销',
      onAction: () => {
        todos.restore(
          prev.id,
          prev.text,
          prev.createdAt,
          Boolean(prev.completed),
          prev.completedAt ?? null,
        )
        scheduleSync()
        renderAll()
      },
    })
  }
}

/** @param {{ focus?: boolean }} [opts] */
function addTodo({ focus = true } = {}) {
  hapticLight()
  if (activeFilter === 'done') {
    activeFilter = 'all'
  }
  /** @type {Todo} */
  const todo = todos.add()
  if (focus) armDraftGuard(2800)
  emptyEl.classList.remove('is-visible')

  const el = createItemEl(todo, { animate: true })
  listEl.appendChild(el)
  updateMeta()
  const ta = el.querySelector('.todo-text')
  autoSize(ta)
  if (focus) enterEditByTa.get(ta)?.()
  scheduleReel()
  return todo
}

// Voice quick capture (long-press FAB)
/** @type {any} */
let activeRecognition = null

function stopVoiceCapture() {
  fab.classList.remove('is-recording')
  if (activeRecognition) {
    try {
      activeRecognition.stop()
    } catch {}
    activeRecognition = null
  }
}

function startVoiceCapture() {
  hideCtxMenu()
  const SpeechRec = /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition
  if (!SpeechRec) {
    addTodo({ focus: true })
    showToast('已打开输入框（可直接点键盘语音）', { durationMs: 2400 })
    return
  }
  stopVoiceCapture()
  hapticLight()
  fab.classList.add('is-recording')
  showToast('正在聆听…', { actionLabel: '停止', onAction: stopVoiceCapture, durationMs: 0 })

  let finalTranscript = ''
  let latestTranscript = ''
  const rec = new SpeechRec()
  rec.lang = 'zh-CN'
  rec.interimResults = true
  rec.continuous = false
  activeRecognition = rec

  rec.onresult = (ev) => {
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const chunk = ev.results[i][0]?.transcript || ''
      if (ev.results[i].isFinal) finalTranscript += chunk
      else interim += chunk
    }
    latestTranscript = (finalTranscript + interim).trim()
    if (latestTranscript) {
      showToast(`🎙 ${latestTranscript}`, { actionLabel: '完成', onAction: stopVoiceCapture, durationMs: 0 })
    }
  }

  rec.onerror = () => {
    stopVoiceCapture()
    hideToast()
    addTodo({ focus: true })
    showToast('无法直录语音，已打开输入框', { durationMs: 2400 })
  }

  rec.onend = () => {
    fab.classList.remove('is-recording')
    activeRecognition = null
    const text = trim(finalTranscript || latestTranscript)
    hideToast()
    if (isMeaningful(text)) {
      const todo = todos.add()
      todos.set_text(todo.id, text)
      saveDirty = true
      flushPendingSave()
      renderAll()
      paper.scrollTop = paper.scrollHeight
      showToast('语音已记下', { durationMs: 1800 })
    }
  }

  try {
    rec.start()
  } catch {
    stopVoiceCapture()
    addTodo({ focus: true })
    showToast('已打开输入框（可直接点键盘语音）', { durationMs: 2400 })
  }
}

let fabPressTimer = 0
let suppressFabClickUntil = 0

function cancelFabPress() {
  if (fabPressTimer) {
    clearTimeout(fabPressTimer)
    fabPressTimer = 0
  }
}

function activateFab(e) {
  e?.preventDefault?.()
  e?.stopPropagation?.()
  if (performance.now() < suppressFabClickUntil) return
  if (activeRecognition) {
    stopVoiceCapture()
    return
  }
  hideCtxMenu()
  addTodo({ focus: true })
}

fab.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (activeRecognition) return
  cancelFabPress()
  fabPressTimer = window.setTimeout(() => {
    fabPressTimer = 0
    suppressFabClickUntil = performance.now() + 800
    startVoiceCapture()
  }, LONG_MS)
})
fab.addEventListener('pointerup', cancelFabPress)
fab.addEventListener('pointercancel', cancelFabPress)
fab.addEventListener('pointerleave', cancelFabPress)
fab.addEventListener('click', activateFab)

// Hidden backup export
async function copyBackupJson() {
  flushPendingSave()
  const json = todos.export_json()
  const count = todos.items(false).filter((t) => isMeaningful(t.text)).length
  const copied = await copyText(json)
  hapticLight()
  showToast(copied ? `已复制备份（${count} 条）` : '备份复制失败', { durationMs: 2200 })
}

let metaPressTimer = 0
countMeta.addEventListener('pointerdown', () => {
  clearTimeout(metaPressTimer)
  metaPressTimer = window.setTimeout(() => {
    metaPressTimer = 0
    copyBackupJson()
  }, 600)
})
const cancelMetaPress = () => {
  if (metaPressTimer) {
    clearTimeout(metaPressTimer)
    metaPressTimer = 0
  }
}
countMeta.addEventListener('pointerup', cancelMetaPress)
countMeta.addEventListener('pointercancel', cancelMetaPress)
countMeta.addEventListener('pointerleave', cancelMetaPress)
countMeta.addEventListener('dblclick', () => {
  cancelMetaPress()
  copyBackupJson()
})

// Blank paper / catcher
tapCatcher.addEventListener('click', (e) => {
  e.stopPropagation()
  dismissMenuAndBlur({ blurActive: true })
})

paper.addEventListener('pointerdown', (e) => {
  const t = /** @type {HTMLElement} */ (e.target)
  if (t === paper || t === tapCatcher || t === emptyEl || t.classList?.contains('todo-list')) {
    dismissMenuAndBlur({ blurActive: true })
  } else if (!t.closest?.('.todo-item') && !t.closest?.('.ctx-menu') && t !== fab && !fab.contains(t)) {
    dismissMenuAndBlur({ blurActive: true })
  }
})

paper.addEventListener('click', (e) => {
  if (e.target === paper || e.target === emptyEl || emptyEl.contains(/** @type {Node} */ (e.target))) {
    dismissMenuAndBlur({ blurActive: true })
  }
})

ctxMenu.addEventListener('pointerdown', (e) => e.stopPropagation())
ctxMenu.addEventListener('click', async (e) => {
  e.stopPropagation()
  const btn = /** @type {HTMLElement|null} */ (
    e.target instanceof HTMLElement ? e.target.closest('[data-action]') : null
  )
  if (!btn) return
  const action = btn.dataset.action
  const id = ctxTargetId
  const safe = id ? id.replace(/"/g, '') : ''
  const li = safe ? listEl.querySelector(`.todo-item[data-id="${safe}"]`) : null
  hideCtxMenu()
  if (action === 'edit' && li) {
    li.dispatchEvent(new CustomEvent('baizhi:enter-edit'))
  } else if (action === 'toggle' && id) {
    hapticLight()
    toggleDone(id)
  } else if (action === 'pin' && id) {
    hapticLight()
    togglePin(id)
  } else if (action === 'copy' && id) {
    const todo = todos.get(id)
    if (todo) {
      hapticLight()
      const ok = await copyText(todo.text)
      showToast(ok ? '已复制' : '复制失败', { durationMs: 1600 })
    }
  } else if (action === 'delete' && id) {
    hapticLight()
    removeTodo(id, { allowUndo: true })
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!syncBackdrop.hidden) {
      closeSyncSheet()
      return
    }
    if (!searchWrap.hidden) {
      closeSearch()
      return
    }
    dismissMenuAndBlur({ blurActive: true })
  }
})

let viewportRaf = 0
function onViewportResize() {
  scheduleReel()
  if (viewportRaf) return
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = 0
    const ta = document.activeElement
    if (ta instanceof HTMLTextAreaElement && ta.closest('.is-editing')) revealEditor(ta)
  })
}
window.addEventListener('resize', onViewportResize, { passive: true })
window.visualViewport?.addEventListener('resize', onViewportResize, { passive: true })

setInterval(() => {
  if (document.hidden) return
  const now = Date.now()
  const children = listEl.children
  for (let i = 0; i < children.length; i++) {
    const el = /** @type {HTMLLIElement} */ (children[i])
    const createdAt = Number(el.dataset.createdAt)
    if (!Number.isFinite(createdAt)) continue
    const state = rowStateByEl.get(el)
    const timeEl = state ? state.timeEl : el.querySelector('.todo-time')
    if (!timeEl) continue
    const base = stamp(createdAt, now)
    const next = el.classList.contains('is-pinned') ? `置顶 · ${base}` : base
    if (timeEl.textContent !== next) timeEl.textContent = next
  }
}, 60_000)

setSyncState(isSyncConfigured() ? 'synced' : 'idle')
renderAll()
if (isSyncConfigured()) {
  syncNow({ silent: true })
}

window.__baizhi = {
  addTodo,
  removeTodo,
  toggleDone,
  togglePin,
  todos: () => todos.items(false),
  formatStamp,
  renderAll,
  STORAGE_KEY,
  updateReel,
  scheduleReel,
  hideCtxMenu,
  showCtxMenu,
  getEphemeralIds: () => todos.drafts(),
  getDraftGuardUntil: () => draftGuardUntil,
  isMeaningful,
  flushPendingSave,
  copyBackupJson,
  syncNow,
  openSyncSheet,
}
