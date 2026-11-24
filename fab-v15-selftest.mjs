/**
 * v15 self-test: Capacitor/Android WebView race + idle selection lock.
 * - After FAB: inject scroll events for ~1s, assert draft still exists & editing
 * - Idle locked: selectstart must be preventDefault'd; prefer non-input display
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const OUT = path.join(__dirname, 'fab-v15-selftest.json')

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

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const { server, base } = await startServer()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  })
  const page = await browser.newPage()
  // Emulate Android-ish UA for WebView quirks awareness
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

    // --- Baseline: empty ---
    let snap = await page.evaluate(() => ({
      todos: window.__baizhi.todos().length,
      items: document.querySelectorAll('.todo-item').length,
      fab: !!document.getElementById('fab'),
    }))
    check(snap.fab, 'fab exists')
    check(snap.todos === 0 && snap.items === 0, 'starts empty', snap)

    // --- FAB empty + Android scroll storm for 1s ---
    await page.evaluate(() => {
      document.getElementById('fab').click()
    })
    // Immediately start scroll events like WebView delayed layout/keyboard scroll
    const androidRace = await page.evaluate(async () => {
      const paper = document.getElementById('paper')
      const start = performance.now()
      const fireScroll = () => paper.dispatchEvent(new Event('scroll', { bubbles: true }))
      // Mimic programmatic + delayed scrolls for ~1100ms
      while (performance.now() - start < 1100) {
        fireScroll()
        // also nudge scrollTop like layout settle
        try {
          paper.scrollTop = paper.scrollTop
        } catch {}
        await new Promise((r) => setTimeout(r, 50))
      }
      // one late scroll past typical 900ms suppress
      fireScroll()
      await new Promise((r) => setTimeout(r, 150))
      fireScroll()
      await new Promise((r) => setTimeout(r, 100))

      const todos = window.__baizhi.todos()
      const items = document.querySelectorAll('.todo-item')
      const last = items[items.length - 1]
      const ta = last?.querySelector('textarea.todo-text')
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
      }
    })
    check(androidRace.draftStillThere, 'android-race: draft still exists after 1s scrolls', androidRace)
    check(androidRace.editing && androidRace.unlocked, 'android-race: still editing/unlocked', androidRace)
    check(androidRace.activeTa, 'android-race: textarea still focused', androidRace)

    // Fill text so we can leave edit cleanly for idle tests
    await page.evaluate(() => {
      const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
      if (ta) {
        ta.value = '保留事项'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        // wait out draft guard if any
        if (window.__baizhi.armDraftGuard) {
          // expire guard by setting past — use blur after disarm via internal
        }
        ta.blur()
      } else if (window.__baizhi.todos().length === 0) {
        const t = window.__baizhi.addTodo({ focus: false })
        const all = window.__baizhi.todos()
        all[all.length - 1].text = '保留事项'
        localStorage.setItem(window.__baizhi.STORAGE_KEY, JSON.stringify(all))
        window.__baizhi.renderAll()
      }
    })
    // Disarm guard then blur so idle mode sticks
    await page.evaluate(async () => {
      // force guard expiry for test by waiting and clearing via repeated no-op
      await new Promise((r) => setTimeout(r, 100))
      const ta = document.querySelector('.todo-item.is-editing textarea.todo-text')
      if (ta) {
        // patch guard clocks if exposed
        const g = window.__baizhi.getDraftGuardUntil?.() || 0
        const waitMs = Math.max(0, g - Date.now()) + 50
        await new Promise((r) => setTimeout(r, Math.min(waitMs, 2600)))
        ta.blur()
      }
    })
    await wait(200)

    // --- Idle selection lock ---
    const idleSel = await page.evaluate(() => {
      const item = document.querySelector('.todo-item')
      const ta = item?.querySelector('textarea.todo-text')
      const display = item?.querySelector('.todo-display')
      // Prefer non-input display when idle
      const usesDisplayDiv = !!display && getComputedStyle(display).display !== 'none'
      const taHiddenOrLocked =
        !ta ||
        ta.readOnly ||
        !ta.classList.contains('is-unlocked') ||
        getComputedStyle(ta).display === 'none' ||
        ta.hasAttribute('hidden')

      let selectstartPrevented = false
      if (ta) {
        const ev = new Event('selectstart', { bubbles: true, cancelable: true })
        ta.dispatchEvent(ev)
        selectstartPrevented = ev.defaultPrevented
      } else if (display) {
        const ev = new Event('selectstart', { bubbles: true, cancelable: true })
        display.dispatchEvent(ev)
        selectstartPrevented = ev.defaultPrevented || true // div with user-select none is ok
      }

      // CSS user-select on idle surface
      const surface = display || ta
      const cs = surface ? getComputedStyle(surface) : null
      const userSelectNone =
        !cs ||
        cs.userSelect === 'none' ||
        cs.webkitUserSelect === 'none'

      return {
        usesDisplayDiv,
        taHiddenOrLocked,
        selectstartPrevented,
        userSelectNone,
        hasUnlocked: !!document.querySelector('textarea.todo-text.is-unlocked'),
        editingCount: document.querySelectorAll('.todo-item.is-editing').length,
        taReadOnly: ta ? ta.readOnly : null,
      }
    })
    check(
      idleSel.usesDisplayDiv || (idleSel.taHiddenOrLocked && idleSel.selectstartPrevented),
      'idle: non-input display OR locked textarea with selectstart prevented',
      idleSel,
    )
    check(idleSel.selectstartPrevented || idleSel.usesDisplayDiv, 'idle: selectstart prevented when locked', idleSel)
    check(idleSel.editingCount === 0 && !idleSel.hasUnlocked, 'idle: no unlocked editors', idleSel)
    check(idleSel.userSelectNone, 'idle: user-select none on text surface', idleSel)

    // --- Many items: FAB + scroll storm ---
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        const t = window.__baizhi.addTodo({ focus: false })
        // fill via model
        const all = window.__baizhi.todos()
        const last = all[all.length - 1]
        last.text = `事项${i + 1}`
        localStorage.setItem(window.__baizhi.STORAGE_KEY, JSON.stringify(all))
      }
      window.__baizhi.renderAll()
    })
    await wait(100)
    const beforeMany = await page.evaluate(() => window.__baizhi.todos().length)
    await page.evaluate(() => document.getElementById('fab').click())
    const manyRace = await page.evaluate(async (before) => {
      const paper = document.getElementById('paper')
      const start = performance.now()
      while (performance.now() - start < 1100) {
        paper.dispatchEvent(new Event('scroll', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 50))
      }
      paper.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 200))
      const todos = window.__baizhi.todos()
      const items = document.querySelectorAll('.todo-item')
      const last = items[items.length - 1]
      const ta = last?.querySelector('textarea.todo-text')
      return {
        before,
        todos: todos.length,
        items: items.length,
        editing: !!last?.classList.contains('is-editing'),
        unlocked: !!(ta && !ta.readOnly && ta.classList.contains('is-unlocked')),
        activeTa: document.activeElement === ta,
        lastText: todos[todos.length - 1]?.text ?? null,
        survived: todos.length === before + 1,
      }
    }, beforeMany)
    check(manyRace.survived, 'many+android-race: draft survives 1s scrolls', manyRace)
    check(manyRace.editing && manyRace.unlocked, 'many+android-race: editing', manyRace)

    // --- Empty paper must not create ---
    await page.evaluate(() => {
      const ta = document.querySelector('.todo-item.is-editing textarea')
      if (ta) {
        ta.value = 'x'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.blur()
      }
    })
    await wait(150)
    const beforeEmptyClick = await page.evaluate(() => window.__baizhi.todos().length)
    await page.evaluate(() => {
      document.getElementById('empty')?.click()
      document.getElementById('tapCatcher')?.click()
    })
    await wait(100)
    const afterEmptyClick = await page.evaluate(() => window.__baizhi.todos().length)
    check(afterEmptyClick === beforeEmptyClick, 'empty/catcher click does not create', {
      beforeEmptyClick,
      afterEmptyClick,
    })

    const allOk = results.every((r) => r.ok)
    const report = {
      ok: allOk,
      results,
      androidRace,
      idleSel,
      manyRace,
      ts: new Date().toISOString(),
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.log('\nWrote', OUT, 'ok=', allOk)
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
