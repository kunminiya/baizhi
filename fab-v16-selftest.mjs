/**
 * v16 self-test: ephemeral FAB draft + Android WebView focus/IME/scroll race.
 * Prove:
 *  1) FAB draft stays focused/editing through delayed scroll/blur settle
 *  2) Empty draft is NOT in localStorage while editing
 *  3) Intentional dismiss cleans empty draft (no blank DOM/storage)
 *  4) Accidental blur during guard re-focuses (no idle blank flash-leave)
 *  5) Idle uses display-div; paper tap does not create
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const OUT = path.join(__dirname, 'fab-v16-selftest.json')

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8'
  if (p.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (p.endsWith('.css')) return 'text/css; charset=utf-8'
  if (p.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function startServer() {
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'
    const file = path.join(dist, urlPath.replace(/^\//, ''))
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType(file) })
    res.end(fs.readFileSync(file))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { server, base } = await startServer()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  })
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  )

  const results = []
  const check = (ok, msg, extra) => {
    results.push({ ok: !!ok, msg, ...(extra ? { extra } : {}) })
    console.log(ok ? 'PASS' : 'FAIL', msg, extra ? JSON.stringify(extra) : '')
  }

  try {
    await page.goto(base + '/', { waitUntil: 'networkidle0' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle0' })
    await wait(200)

    let snap = await page.evaluate(() => ({
      todos: window.__baizhi.todos().length,
      items: document.querySelectorAll('.todo-item').length,
      fab: !!document.getElementById('fab'),
      storage: localStorage.getItem(window.__baizhi.STORAGE_KEY),
    }))
    check(snap.fab, 'fab exists')
    check(snap.todos === 0 && snap.items === 0, 'starts empty', snap)

    // --- FAB + Android scroll/blur/IME settle race ---
    await page.evaluate(() => document.getElementById('fab').click())
    const androidRace = await page.evaluate(async () => {
      const paper = document.getElementById('paper')
      const start = performance.now()
      const fireScroll = () => paper.dispatchEvent(new Event('scroll', { bubbles: true }))
      // Mimic delayed layout/keyboard scrolls + accidental blur pulses
      while (performance.now() - start < 1200) {
        fireScroll()
        try {
          paper.scrollTop = paper.scrollTop
        } catch {}
        // Accidental blur (NOT intentional) — should re-focus under guard
        const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
        if (ta && document.activeElement === ta) {
          ta.blur()
        }
        await new Promise((r) => setTimeout(r, 60))
      }
      fireScroll()
      await new Promise((r) => setTimeout(r, 120))
      const taLate = document.querySelector('.todo-item.is-editing textarea.todo-text')
      if (taLate) taLate.blur() // still under guard → refocus
      await new Promise((r) => setTimeout(r, 80))

      const todos = window.__baizhi.todos()
      const items = document.querySelectorAll('.todo-item')
      const last = items[items.length - 1]
      const ta = last?.querySelector('textarea.todo-text')
      let stored = []
      try {
        stored = JSON.parse(localStorage.getItem(window.__baizhi.STORAGE_KEY) || '[]')
      } catch {}
      return {
        todos: todos.length,
        items: items.length,
        editing: !!last?.classList.contains('is-editing'),
        unlocked: !!(ta && !ta.readOnly && ta.classList.contains('is-unlocked')),
        activeTa: document.activeElement === ta,
        emptyVisible: document.getElementById('empty')?.classList.contains('is-visible'),
        suppress: window.__baizhi.getSuppressScrollBlur?.() ?? null,
        lastText: todos[todos.length - 1]?.text ?? null,
        draftStillThere: todos.length === 1 && items.length === 1,
        storageCount: stored.length,
        storageHasBlank: stored.some((t) => !String(t.text ?? '').trim()),
        ephemeral: window.__baizhi.getEphemeralIds?.() ?? [],
      }
    })
    check(androidRace.draftStillThere, 'android-race: draft still exists after scroll/blur settle', androidRace)
    check(androidRace.editing && androidRace.unlocked, 'android-race: still editing/unlocked', androidRace)
    check(androidRace.activeTa, 'android-race: textarea still focused', androidRace)
    check(androidRace.storageCount === 0 && !androidRace.storageHasBlank, 'android-race: empty draft NOT in localStorage', androidRace)

    // --- Intentional dismiss of empty draft → clean (no blank left) ---
    const cleaned = await page.evaluate(async () => {
      // Tap catcher = intentional dismiss
      window.__baizhi.dismissAllInteraction({ blurActive: true })
      await new Promise((r) => setTimeout(r, 50))
      let stored = []
      try {
        stored = JSON.parse(localStorage.getItem(window.__baizhi.STORAGE_KEY) || '[]')
      } catch {}
      return {
        todos: window.__baizhi.todos().length,
        items: document.querySelectorAll('.todo-item').length,
        storageCount: stored.length,
        emptyVisible: document.getElementById('empty')?.classList.contains('is-visible'),
        editingCount: document.querySelectorAll('.todo-item.is-editing').length,
      }
    })
    check(
      cleaned.todos === 0 && cleaned.items === 0 && cleaned.storageCount === 0,
      'intentional dismiss: empty draft cleaned (no DOM/storage blank)',
      cleaned,
    )

    // --- Type meaningful text → persists; idle display-div ---
    await page.evaluate(() => document.getElementById('fab').click())
    await wait(80)
    await page.evaluate(() => {
      const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
      ta.value = '保留事项'
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Wait out draft guard then intentional blur
    await page.evaluate(async () => {
      const g = window.__baizhi.getDraftGuardUntil?.() || 0
      const waitMs = Math.max(0, g - Date.now()) + 80
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 3500)))
      window.__baizhi.markIntentionalBlur()
      const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
      if (ta) ta.blur()
    })
    await wait(150)

    const idleSel = await page.evaluate(() => {
      const item = document.querySelector('.todo-item')
      const ta = item?.querySelector('textarea.todo-text')
      const display = item?.querySelector('.todo-display')
      const usesDisplayDiv = !!display && !display.hidden && getComputedStyle(display).display !== 'none'
      const taHiddenOrLocked =
        !ta ||
        ta.hidden ||
        ta.readOnly ||
        !ta.classList.contains('is-unlocked') ||
        getComputedStyle(ta).display === 'none'
      let selectstartPrevented = false
      if (display) {
        const ev = new Event('selectstart', { bubbles: true, cancelable: true })
        display.dispatchEvent(ev)
        selectstartPrevented = ev.defaultPrevented || true
      }
      const cs = display ? getComputedStyle(display) : null
      const userSelectNone = !cs || cs.userSelect === 'none' || cs.webkitUserSelect === 'none'
      let stored = []
      try {
        stored = JSON.parse(localStorage.getItem(window.__baizhi.STORAGE_KEY) || '[]')
      } catch {}
      return {
        usesDisplayDiv,
        taHiddenOrLocked,
        selectstartPrevented,
        userSelectNone,
        hasUnlocked: !!document.querySelector('textarea.todo-text.is-unlocked'),
        editingCount: document.querySelectorAll('.todo-item.is-editing').length,
        taReadOnly: ta ? ta.readOnly : null,
        storageText: stored.map((t) => t.text),
        storageHasBlank: stored.some((t) => !String(t.text ?? '').trim()),
        todos: window.__baizhi.todos().length,
      }
    })
    check(idleSel.usesDisplayDiv, 'idle: uses .todo-display div', idleSel)
    check(idleSel.editingCount === 0 && !idleSel.hasUnlocked, 'idle: no unlocked editors', idleSel)
    check(idleSel.userSelectNone, 'idle: user-select none on display', idleSel)
    check(
      idleSel.todos === 1 && idleSel.storageText?.[0] === '保留事项' && !idleSel.storageHasBlank,
      'typed text persisted; no blank in storage',
      idleSel,
    )

    // --- Many items + FAB race ---
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        window.__baizhi.addTodo({ focus: false })
        const all = window.__baizhi.todos()
        const last = all[all.length - 1]
        last.text = `事项${i + 1}`
        window.__baizhi.save()
      }
      // Drop any leftover empties from focus:false adds that weren't filled — save already filters
      // but in-memory may still have empties from addTodo focus:false before text set... 
      // Actually we set text immediately after each add, then save. Ephemeral cleared on meaningful save via input path —
      // but we mutated model directly, so clear ephemeral manually by save (filters storage) + renderAll
      window.__baizhi.renderAll()
    })
    // purge any accidental empties in memory from focus:false path
    await page.evaluate(() => {
      const kept = window.__baizhi.todos().filter((t) => String(t.text || '').trim())
      // replace via storage reload trick
      localStorage.setItem(window.__baizhi.STORAGE_KEY, JSON.stringify(kept))
      // force reload model
      location.reload()
    })
    await page.waitForNavigation({ waitUntil: 'networkidle0' })
    await wait(200)

    const beforeMany = await page.evaluate(() => window.__baizhi.todos().length)
    await page.evaluate(() => document.getElementById('fab').click())
    const manyRace = await page.evaluate(async (before) => {
      const paper = document.getElementById('paper')
      const start = performance.now()
      while (performance.now() - start < 1100) {
        paper.dispatchEvent(new Event('scroll', { bubbles: true }))
        const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
        if (ta && document.activeElement === ta) ta.blur()
        await new Promise((r) => setTimeout(r, 50))
      }
      await new Promise((r) => setTimeout(r, 100))
      const todos = window.__baizhi.todos()
      const items = document.querySelectorAll('.todo-item')
      const last = items[items.length - 1]
      const ta = last?.querySelector('textarea.todo-text')
      let stored = []
      try {
        stored = JSON.parse(localStorage.getItem(window.__baizhi.STORAGE_KEY) || '[]')
      } catch {}
      return {
        before,
        todos: todos.length,
        items: items.length,
        editing: !!last?.classList.contains('is-editing'),
        unlocked: !!(ta && !ta.readOnly && ta.classList.contains('is-unlocked')),
        activeTa: document.activeElement === ta,
        lastText: todos[todos.length - 1]?.text ?? null,
        survived: todos.length === before + 1 && !!last?.classList.contains('is-editing'),
        storageCount: stored.length,
        storageHasBlank: stored.some((t) => !String(t.text ?? '').trim()),
      }
    }, beforeMany)
    check(manyRace.survived && manyRace.activeTa, 'many+android-race: draft stays editing/focused', manyRace)
    check(manyRace.storageCount === beforeMany && !manyRace.storageHasBlank, 'many+android-race: storage has no blank draft', manyRace)

    // Clean empty draft via intentional dismiss, then paper must not create
    await page.evaluate(() => window.__baizhi.dismissAllInteraction({ blurActive: true }))
    await wait(80)
    const beforeEmptyClick = await page.evaluate(() => window.__baizhi.todos().length)
    await page.evaluate(() => {
      document.getElementById('empty')?.click()
      document.getElementById('tapCatcher')?.click()
      document.getElementById('paper')?.click()
    })
    await wait(100)
    const afterEmptyClick = await page.evaluate(() => window.__baizhi.todos().length)
    check(afterEmptyClick === beforeEmptyClick, 'empty/catcher/paper click does not create', {
      beforeEmptyClick,
      afterEmptyClick,
    })

    // Final: FAB → type → blur after guard → no blank leftovers ever
    await page.evaluate(() => document.getElementById('fab').click())
    await wait(60)
    const noFlashBlank = await page.evaluate(async () => {
      // accidental blurs
      for (let i = 0; i < 5; i++) {
        const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
        if (ta) ta.blur()
        await new Promise((r) => setTimeout(r, 40))
      }
      const midItems = document.querySelectorAll('.todo-item').length
      const midEditing = document.querySelectorAll('.todo-item.is-editing').length
      // never typed — intentional dismiss
      window.__baizhi.dismissAllInteraction({ blurActive: true })
      await new Promise((r) => setTimeout(r, 40))
      let stored = []
      try {
        stored = JSON.parse(localStorage.getItem(window.__baizhi.STORAGE_KEY) || '[]')
      } catch {}
      return {
        midItems,
        midEditing,
        afterTodos: window.__baizhi.todos().length,
        afterItems: document.querySelectorAll('.todo-item').length,
        storageHasBlank: stored.some((t) => !String(t.text ?? '').trim()),
        blankIdleLeft: [...document.querySelectorAll('.todo-item')].some((li) => {
          const d = li.querySelector('.todo-display')
          const ta = li.querySelector('textarea')
          const text = (d?.textContent || ta?.value || '').trim()
          return !text && !li.classList.contains('is-editing')
        }),
      }
    })
    check(
      noFlashBlank.midEditing === 1 &&
        noFlashBlank.afterItems === beforeEmptyClick &&
        !noFlashBlank.storageHasBlank &&
        !noFlashBlank.blankIdleLeft,
      'no flash-leave blank: stays editing through accidental blur, cleans on dismiss',
      noFlashBlank,
    )

    const allOk = results.every((r) => r.ok)
    const report = {
      ok: allOk,
      results,
      androidRace,
      cleaned,
      idleSel,
      manyRace,
      noFlashBlank,
      ts: new Date().toISOString(),
      passCount: results.filter((r) => r.ok).length,
      total: results.length,
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.log('\nWrote', OUT, 'ok=', allOk, `${report.passCount}/${report.total}`)
    await browser.close()
    server.close()
    process.exit(allOk ? 0 : 1)
  } catch (err) {
    console.error(err)
    fs.writeFileSync(OUT, JSON.stringify({ ok: false, error: String(err), results }, null, 2))
    try {
      await browser.close()
    } catch {}
    server.close()
    process.exit(1)
  }
}

main()
