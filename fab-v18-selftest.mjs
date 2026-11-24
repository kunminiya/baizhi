/**
 * v18 self-test: soft-float v17 + double-tap complete + long-press ctx menu
 * 1) FAB creates focused textarea; typing persists; Enter keeps text
 * 2) Double-tap marks done + strikethrough
 * 3) Long-press opens .ctx-menu with 编辑/完成|取消完成/删除; does not toggle done by itself
 * 4) Menu 编辑 focuses textarea; 删除 removes; 完成 toggles
 * 5) No armDraftGuard leftovers; updateReel no crash
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const OUT = path.join(__dirname, 'fab-v18-selftest.json')

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

async function shortTap(page, x, y) {
  await page.touchscreen.touchStart(x, y)
  await wait(40)
  await page.touchscreen.touchEnd()
}

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
        hasRemove: typeof b.removeTodo === 'function',
        hasToggle: typeof b.toggleDone === 'function',
        hasCtx: !!document.querySelector('.ctx-menu'),
        emptySub: document.querySelector('.empty-sub')?.textContent || '',
        storageKey: b.STORAGE_KEY || null,
      }
    })
    check('api.addTodo', api.hasAdd)
    check('api.updateReel', api.hasReel)
    check('api.removeTodo', api.hasRemove)
    check('api.toggleDone', api.hasToggle)
    check('ctx_menu_present', api.hasCtx)
    check(
      'empty_hint_v18',
      api.emptySub.includes('双击划线') && api.emptySub.includes('长按菜单'),
      api.emptySub,
    )

    // 1) FAB creates focused textarea; typing persists; Enter keeps text
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
        unlocked: ta?.classList.contains('is-unlocked') || false,
        readonly: ta?.readOnly ?? null,
      }
    })
    check('fab_creates_item', afterFab.items === 1, JSON.stringify(afterFab))
    check('fab_uses_textarea', afterFab.hasTextarea)
    check('fab_focuses_textarea', afterFab.focused, JSON.stringify(afterFab))

    await page.keyboard.type('双击菜单测试', { delay: 20 })
    await wait(200)
    const typed = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { value: ta?.value || '', storedText: stored[0]?.text || '', count: stored.length }
    })
    check('typing_in_textarea', typed.value === '双击菜单测试', typed.value)
    check('typing_persists_storage', typed.storedText === '双击菜单测试', typed.storedText)

    await page.keyboard.press('Enter')
    await wait(250)
    const afterBlur = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const ta = document.querySelector('.todo-text')
      return {
        text: stored[0]?.text,
        completed: stored[0]?.completed,
        focused: document.activeElement === ta,
        readonly: ta?.readOnly ?? null,
      }
    })
    check('enter_blur_keeps_text', afterBlur.text === '双击菜单测试', JSON.stringify(afterBlur))
    check('enter_exits_edit', !afterBlur.focused && afterBlur.readonly === true, JSON.stringify(afterBlur))

    const box = await page.$('.todo-item')
    const rect = await box.boundingBox()
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2

    // 2) Double-tap marks done + strikethrough
    await shortTap(page, cx, cy)
    await wait(80)
    await shortTap(page, cx, cy)
    await wait(300)

    const afterDouble = await page.evaluate(() => {
      const el = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const cs = ta ? getComputedStyle(ta) : null
      const menu = document.querySelector('.ctx-menu')
      return {
        hasDoneClass: el?.classList.contains('is-done') || false,
        completed: !!stored[0]?.completed,
        decoration: cs?.textDecorationLine || cs?.textDecoration || null,
        menuHidden: menu?.hidden ?? null,
      }
    })
    check('doubletap_marks_done', afterDouble.hasDoneClass && afterDouble.completed, JSON.stringify(afterDouble))
    check(
      'done_strikethrough_style',
      (afterDouble.decoration || '').includes('line-through'),
      afterDouble.decoration,
    )

    // Untoggle via double-tap again so next long-press tests start incomplete? Keep done for menu 取消完成
    // Actually we want incomplete for "完成" label — double-tap again to undo
    await shortTap(page, cx, cy)
    await wait(80)
    await shortTap(page, cx, cy)
    await wait(250)
    const undone = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { completed: !!stored[0]?.completed }
    })
    check('doubletap_untoggles', !undone.completed, JSON.stringify(undone))

    // 3) Long-press opens ctx-menu; does NOT toggle done by itself
    await page.touchscreen.touchStart(cx, cy)
    await wait(560)
    await page.touchscreen.touchEnd()
    await wait(250)

    const afterLong = await page.evaluate(() => {
      const menu = document.querySelector('.ctx-menu')
      const labels = [...(menu?.querySelectorAll('[data-action]') || [])].map((b) => ({
        action: b.getAttribute('data-action'),
        text: b.textContent.trim(),
      }))
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const el = document.querySelector('.todo-item')
      return {
        menuHidden: menu?.hidden ?? true,
        menuOpenClass: menu?.classList.contains('is-open') || false,
        labels,
        completed: !!stored[0]?.completed,
        hasDoneClass: el?.classList.contains('is-done') || false,
        itemMenuOpen: el?.classList.contains('is-menu-open') || false,
      }
    })
    check('longpress_opens_menu', !afterLong.menuHidden && afterLong.menuOpenClass, JSON.stringify(afterLong))
    check(
      'longpress_does_not_toggle',
      !afterLong.completed && !afterLong.hasDoneClass,
      JSON.stringify(afterLong),
    )
    const labelTexts = afterLong.labels.map((l) => l.text).join('|')
    check(
      'menu_has_edit_toggle_delete',
      afterLong.labels.some((l) => l.action === 'edit' && l.text === '编辑') &&
        afterLong.labels.some((l) => l.action === 'toggle' && (l.text === '完成' || l.text === '取消完成')) &&
        afterLong.labels.some((l) => l.action === 'delete' && l.text === '删除'),
      labelTexts,
    )

    // 4a) Menu 编辑 focuses textarea
    await page.click('.ctx-menu [data-action="edit"]')
    await wait(300)
    const afterEdit = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const menu = document.querySelector('.ctx-menu')
      return {
        focused: document.activeElement === ta,
        unlocked: ta?.classList.contains('is-unlocked') || false,
        readonly: ta?.readOnly ?? null,
        editing: document.querySelector('.todo-item')?.classList.contains('is-editing') || false,
        menuHidden: menu?.hidden ?? true,
      }
    })
    check('menu_edit_focuses_textarea', afterEdit.focused && afterEdit.unlocked && !afterEdit.readonly, JSON.stringify(afterEdit))
    check('menu_closes_after_edit', afterEdit.menuHidden === true)

    // blur to exit edit for next menu actions
    await page.keyboard.press('Enter')
    await wait(200)

    // open menu again for 完成
    await page.touchscreen.touchStart(cx, cy)
    await wait(560)
    await page.touchscreen.touchEnd()
    await wait(250)
    await page.click('.ctx-menu [data-action="toggle"]')
    await wait(250)
    const afterToggle = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const el = document.querySelector('.todo-item')
      return {
        completed: !!stored[0]?.completed,
        hasDoneClass: el?.classList.contains('is-done') || false,
        menuHidden: document.querySelector('.ctx-menu')?.hidden ?? true,
      }
    })
    check('menu_toggle_marks_done', afterToggle.completed && afterToggle.hasDoneClass, JSON.stringify(afterToggle))

    // open menu again — should say 取消完成; then 删除
    await page.touchscreen.touchStart(cx, cy)
    await wait(560)
    await page.touchscreen.touchEnd()
    await wait(250)
    const cancelLabel = await page.evaluate(() => {
      const btn = document.querySelector('.ctx-menu [data-action="toggle"]')
      return btn?.textContent?.trim() || ''
    })
    check('menu_toggle_label_cancel', cancelLabel === '取消完成', cancelLabel)

    await page.click('.ctx-menu [data-action="delete"]')
    await wait(250)
    const afterDelete = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return {
        items: document.querySelectorAll('.todo-item').length,
        storedCount: stored.length,
        emptyVisible: document.querySelector('.empty-state')?.classList.contains('is-visible') || false,
      }
    })
    check('menu_delete_removes', afterDelete.items === 0 && afterDelete.storedCount === 0, JSON.stringify(afterDelete))

    // blank paper must NOT create
    await page.click('#paper')
    await wait(200)
    const noCreate = await page.evaluate(() => document.querySelectorAll('.todo-item').length)
    check('blank_paper_no_create', noCreate === 0, String(noCreate))

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

    // 5) no draft-guard leftovers
    const leftover = await page.evaluate(() => {
      const src = document.documentElement.outerHTML
      const scripts = [...document.scripts].map((s) => s.textContent || '').join('\n')
      const blob = src + '\n' + scripts
      return {
        armDraftGuard: blob.includes('armDraftGuard'),
        ephemeral: blob.includes('ephemeralIds') || blob.includes('ephemeral'),
        todoDisplay: blob.includes('todo-display'),
        dualMode: typeof window.__baizhi?.beginEdit === 'function',
      }
    })
    // Also check built module text via fetching main asset
    const moduleLeftover = await page.evaluate(async () => {
      const scripts = [...document.querySelectorAll('script[src]')]
      let text = ''
      for (const s of scripts) {
        try {
          text += await (await fetch(s.src)).text()
        } catch {}
      }
      return {
        armDraftGuard: text.includes('armDraftGuard'),
        ephemeralIds: text.includes('ephemeralIds'),
        todoDisplay: text.includes('todo-display'),
      }
    })
    check(
      'no_armDraftGuard',
      !leftover.armDraftGuard && !moduleLeftover.armDraftGuard,
      JSON.stringify({ leftover, moduleLeftover }),
    )
    check(
      'no_todo_display_mode',
      !leftover.todoDisplay && !leftover.dualMode && !moduleLeftover.todoDisplay,
      JSON.stringify({ leftover, moduleLeftover }),
    )
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
