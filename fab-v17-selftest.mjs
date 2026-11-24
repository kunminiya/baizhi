/**
 * v17 self-test: soft-float v5 baseline restored
 * 1) FAB creates editable focused textarea item
 * 2) typing persists to localStorage
 * 3) long-press toggles done (checkmark/strikethrough)
 * 4) no ctx menu / no dual-mode display / no draft guard globals
 * 5) empty state + soft-float helpers present
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const OUT = path.join(__dirname, 'fab-v17-selftest.json')

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
  const results = { ok: true, checks: [] }
  const check = (name, pass, detail = '') => {
    results.checks.push({ name, pass: !!pass, detail })
    if (!pass) results.ok = false
  }

  const { server, base } = await startServer()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=390,844'],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(12000)

  try {
    await page.goto(base + '/', { waitUntil: 'networkidle0' })
    await wait(300)

    const api = await page.evaluate(() => {
      const b = window.__baizhi || {}
      return {
        hasAdd: typeof b.addTodo === 'function',
        hasReel: typeof b.updateReel === 'function',
        hasSchedule: typeof b.scheduleReel === 'function',
        hasCtx: !!document.querySelector('.ctx-menu'),
        emptySub: document.querySelector('.empty-sub')?.textContent || '',
        storageKey: b.STORAGE_KEY || null,
      }
    })
    check('api.addTodo', api.hasAdd)
    check('api.updateReel', api.hasReel)
    check('api.scheduleReel', api.hasSchedule)
    check('no_ctx_menu', !api.hasCtx, api.hasCtx ? 'ctx-menu present' : 'absent')
    check('empty_hint_longpress', api.emptySub.includes('长按划线完成'), api.emptySub)

    await page.click('#fab')
    await wait(450)

    const afterFab = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const active = document.activeElement
      return {
        items: document.querySelectorAll('.todo-item').length,
        hasTextarea: !!ta,
        focused: active === ta,
        tag: active?.tagName || null,
        className: active?.className || null,
        stored: JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]'),
      }
    })
    check('fab_creates_item', afterFab.items === 1, JSON.stringify(afterFab))
    check('fab_uses_textarea', afterFab.hasTextarea)
    check('fab_focuses_textarea', afterFab.focused, JSON.stringify({ tag: afterFab.tag, className: afterFab.className }))

    await page.keyboard.type('恢复轻柔飘', { delay: 20 })
    await wait(200)
    const typed = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { value: ta?.value || '', storedText: stored[0]?.text || '', count: stored.length }
    })
    check('typing_in_textarea', typed.value === '恢复轻柔飘', typed.value)
    check('typing_persists_storage', typed.storedText === '恢复轻柔飘', typed.storedText)

    // blur via Enter
    await page.keyboard.press('Enter')
    await wait(200)
    const afterBlur = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { text: stored[0]?.text, completed: stored[0]?.completed }
    })
    check('enter_blur_keeps_text', afterBlur.text === '恢复轻柔飘', JSON.stringify(afterBlur))

    // long-press toggle done (~480ms in app)
    const box = await page.$('.todo-item')
    const rect = await box.boundingBox()
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    await page.touchscreen.touchStart(cx, cy)
    await wait(560)
    await page.touchscreen.touchEnd()
    await wait(250)

    const afterLong = await page.evaluate(() => {
      const el = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const cs = ta ? getComputedStyle(ta) : null
      return {
        hasDoneClass: el?.classList.contains('is-done') || false,
        completed: !!stored[0]?.completed,
        color: cs?.color || null,
        decoration: cs?.textDecorationLine || cs?.textDecoration || null,
      }
    })
    check('longpress_marks_done', afterLong.hasDoneClass && afterLong.completed, JSON.stringify(afterLong))
    check(
      'done_strikethrough_style',
      (afterLong.decoration || '').includes('line-through'),
      afterLong.decoration,
    )

    // soft-float helpers still callable
    const reelOk = await page.evaluate(() => {
      try {
        window.__baizhi.updateReel()
        return true
      } catch (e) {
        return String(e)
      }
    })
    check('updateReel_no_crash', reelOk === true, String(reelOk))

    // no draft-guard leftovers in source surface
    const leftover = await page.evaluate(() => {
      const src = document.documentElement.outerHTML
      return {
        armDraftGuard: src.includes('armDraftGuard'),
        ephemeral: src.includes('ephemeral'),
        todoDisplay: src.includes('todo-display'),
        dualMode: typeof window.__baizhi?.beginEdit === 'function',
      }
    })
    check('no_armDraftGuard_in_dom', !leftover.armDraftGuard)
    check('no_todo_display_mode', !leftover.todoDisplay && !leftover.dualMode, JSON.stringify(leftover))
  } catch (err) {
    results.ok = false
    results.error = String(err && err.stack ? err.stack : err)
  } finally {
    await browser.close()
    server.close()
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  process.exit(results.ok ? 0 : 1)
}

main()
