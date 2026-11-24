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

/** @typedef {{ id: string, text: string, createdAt: number, completed: boolean, completedAt?: number|null }} Todo */

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="app-header">
    <div class="app-meta" id="countMeta"></div>
  </header>
  <main class="paper-scroll" id="paper" aria-label="白纸待办">
    <div class="empty-state" id="empty">
      <div class="empty-glyph" aria-hidden="true"></div>
      <p class="empty-title">轻写下第一件事</p>
      <p class="empty-sub">点 + 新建 · 双击划线 · 长按菜单</p>
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

/** Floating long-press context menu — horizontal Android-style pill toolbar */
const ctxMenu = document.createElement('div')
ctxMenu.className = 'ctx-menu'
ctxMenu.hidden = true
ctxMenu.setAttribute('role', 'menu')
ctxMenu.innerHTML = `<button type="button" class="ctx-item" data-action="edit" role="menuitem">编辑</button>`
document.body.appendChild(ctxMenu)

/** Lightweight bottom toast (undo delete / backup feedback) */
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
  toastTimer = window.setTimeout(hideToast, durationMs)
}

toastEl.addEventListener('pointerdown', (e) => e.stopPropagation())
toastActionBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const fn = toastActionHandler
  hideToast()
  fn?.()
})

setupNativeChrome()

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
  const toggleLabel = done ? '取消完成' : '完成'
  ctxMenu.innerHTML =
    `<button type="button" class="ctx-item" data-action="edit" role="menuitem">编辑</button>` +
    `<button type="button" class="ctx-item" data-action="toggle" role="menuitem">${toggleLabel}</button>` +
    `<button type="button" class="ctx-item ctx-item-danger" data-action="delete" role="menuitem">删除</button>`
}

const todos = new Todos()
let reelRaf = 0
/** @type {string|null} */
let ctxTargetId = null
/** @type {WeakMap<HTMLTextAreaElement, () => void>} */
const enterEditByTa = new WeakMap()
/**
 * Per-row cached DOM references, gesture state, and last-written inline styles.
 * @type {WeakMap<HTMLLIElement, {
 *   id: string,
 *   face: HTMLElement,
 *   ta: HTMLTextAreaElement,
 *   timeEl: HTMLElement,
 *   editing: boolean,
 *   enterEdit: () => void,
 *   exitEdit: () => void,
 *   lockTextarea: () => void,
 *   lastTapAt: number,
 *   suppressClickUntil: number,
 *   lastTransform: string,
 *   lastFilter: string,
 *   lastOpacity: string,
 * }>}
 */
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
}

function scheduleSave() {
  saveDirty = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushPendingSave()
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

function updateMeta() {
  const total = todos.count()
  const done = todos.done_count()
  const open = total - done
  if (total === 0) {
    countMeta.textContent = ''
  } else {
    countMeta.innerHTML = `<span class="meta-open">未完成 ${open}</span><span class="meta-sep">·</span><span class="meta-done">已完成 ${done}</span>`
  }
  emptyEl.classList.toggle('is-visible', total === 0)
}

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
/** @type {Array<{ el: HTMLLIElement, state: any }>} */
const visibleRows = []
/** @type {Array<{ el: HTMLLIElement, state: any }>} */
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

  // 1) Read geometry together before writing styles: no per-row layout flush.
  for (let i = 0; i < len; i++) {
    const el = /** @type {HTMLLIElement} */ (children[i])
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

  // 2) Single Wasm call for all visible rows
  const visCount = visibleRows.length
  if (visCount > 0) {
    reel_batch(
      paperRect.top,
      paperRect.height,
      reelIn.subarray(0, visCount * 3),
      reelOut.subarray(0, visCount * 6),
    )
  }

  // 3) Write only changed inline styles
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
    st.lastTapAt = 0 // cancel pending double-tap
    clearPressVisual(li)
    hapticLight()
    // Long-press alone: show menu ONLY — never unlock / focus / open keyboard / toggle done / select text
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
    // Real scroll/drag — abort long-press
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
    // Single tap: dismiss menu only (never open keyboard)
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

// Capture phase ensures even non-bubbling synthetic pointercancel on <li> is caught.
// Android WebView often fires pointercancel during long-press (selection gesture);
// keep pressActive + activeLongTimer so the menu can still fire (scroll cancels it).
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

// Touch fallback: ensures end even if pointerup is lost after cancel
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

// Single merged scroll handler: inertial edge + reel + menu dismiss + cancel phantom long-press
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
  li.className = `todo-item${todo.completed ? ' is-done' : ''}${animate ? ' is-entering' : ''}`
  li.dataset.id = todo.id
  li.dataset.createdAt = String(todo.createdAt)
  li.innerHTML = `
    <div class="todo-face">
      <div class="todo-body">
        <time class="todo-time" datetime="${new Date(todo.createdAt).toISOString()}">${formatStamp(todo.createdAt)}</time>
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

  // Locked text is not hit-tested; keep a defensive guard for synthetic pointer events.
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
      // Hard block: locked items must never keep focus / open IME
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

    // Accidental blur from scroll / IME / viewport settle during FAB draft:
    // re-focus instead of discarding mid-settle.
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

    // Blank / whitespace-only → discard completely (DOM + model + storage)
    if (!isMeaningful(trimmed)) {
      removeTodo(todo.id)
      return
    }

    todos.set_text(todo.id, trimmed)
    saveDirty = true
    flushPendingSave()
    ta.value = trimmed
    autoSize(ta)
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
  scheduleReel()
}

function toggleDone(id) {
  flushPendingSave()
  const t = todos.toggle(id, Date.now())
  if (!t) return
  const safe = id.replace(/"/g, '')
  const el = listEl.querySelector(`[data-id="${safe}"]`)
  if (el) {
    el.classList.toggle('is-done', t.completed)
    el.classList.remove('is-state-bounce')
    requestAnimationFrame(() => el.classList.add('is-state-bounce'))
    el.addEventListener('animationend', () => el.classList.remove('is-state-bounce'), { once: true })
    updateMeta()
    scheduleReel()
  } else {
    renderAll()
  }
}

function removeTodo(id, { allowUndo = false } = {}) {
  flushPendingSave()
  const prev = allowUndo ? todos.get(id) : null
  if (!todos.remove(id)) return
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
        renderAll()
      },
    })
  }
}

/** @param {{ focus?: boolean }} [opts] */
function addTodo({ focus = true } = {}) {
  hapticLight()
  /** @type {Todo} */
  const todo = todos.add()
  // Do NOT save empty draft — never persist blank rows until first non-whitespace
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

function activateFab(e) {
  e?.preventDefault?.()
  e?.stopPropagation?.()
  hideCtxMenu()
  addTodo({ focus: true })
}

fab.addEventListener('pointerdown', (e) => {
  // Keep the current editor / IME focused until the new editor is ready.
  e.preventDefault()
  e.stopPropagation()
})
fab.addEventListener('click', activateFab)

// Hidden backup export: long-press (600ms) or double-click on top-right countMeta
async function copyBackupJson() {
  flushPendingSave()
  const json = todos.export_json()
  const count = todos.items(false).filter((t) => isMeaningful(t.text)).length
  let copied = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json)
      copied = true
    }
  } catch {}
  if (!copied) {
    try {
      const tmp = document.createElement('textarea')
      tmp.value = json
      tmp.style.position = 'fixed'
      tmp.style.opacity = '0'
      document.body.appendChild(tmp)
      tmp.select()
      copied = document.execCommand('copy')
      tmp.remove()
    } catch {}
  }
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

// Blank paper / catcher: dismiss menu + discard blank draft — FAB is the sole create path
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
ctxMenu.addEventListener('click', (e) => {
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
  } else if (action === 'delete' && id) {
    hapticLight()
    removeTodo(id, { allowUndo: true })
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
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
    const next = stamp(createdAt, now)
    if (timeEl.textContent !== next) timeEl.textContent = next
  }
}, 60_000)

renderAll()

window.__baizhi = {
  addTodo,
  removeTodo,
  toggleDone,
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
}
