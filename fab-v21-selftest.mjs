/**
 * v21 self-test (v19 suite + no selection on long-press): empty-draft discard + double-tap done + long-press ctx menu (no keyboard / no toggle)
 * 1) FAB empty then blur/outside → 0 items / no blank in storage
 * 2) FAB with text persists; Enter keeps text
 * 3) Double-tap toggles done + strikethrough
 * 4) Long-press (~500ms+) opens .ctx-menu; does NOT toggle done; does NOT focus textarea
 * 5) Long-press survives simulated pointercancel (Android WebView)
 * 6) Menu 编辑 focuses; 删除 removes; 完成 toggles
 * 7) Soft-float helpers still callable; no todo-display dual-mode leftovers
 * 8) Locked items: user-select/touch-callout none; long-press leaves no text selection
 * 9) Soft-float knobs match v19 (horizon 0.82 / scale 0.58 / opacity 0.92 / blur 0.45*3.4)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const OUT = path.join(__dirname, 'fab-v21-selftest.json')

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

async function longPress(page, x, y, holdMs = 560) {
  await page.touchscreen.touchStart(x, y)
  await wait(holdMs)
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
        hasEphemeral: typeof b.getEphemeralIds === 'function',
      }
    })
    check('api.addTodo', api.hasAdd)
    check('api.updateReel', api.hasReel)
    check('api.removeTodo', api.hasRemove)
    check('api.toggleDone', api.hasToggle)
    check('ctx_menu_present', api.hasCtx)
    check(
      'empty_hint_v19',
      api.emptySub.includes('双击划线') && api.emptySub.includes('长按菜单'),
      api.emptySub,
    )

    // —— 1) FAB empty then outside blur → 0 items / no blank in storage ——
    await page.click('#fab')
    await wait(500)

    const afterEmptyFab = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const eph = window.__baizhi?.getEphemeralIds?.() || []
      return {
        items: document.querySelectorAll('.todo-item').length,
        focused: document.activeElement === ta,
        storedCount: stored.length,
        blankInStorage: stored.some((t) => !String(t.text || '').trim()),
        ephemeralCount: eph.length,
      }
    })
    check('fab_empty_creates_ui_item', afterEmptyFab.items === 1, JSON.stringify(afterEmptyFab))
    check('fab_empty_focuses', afterEmptyFab.focused, JSON.stringify(afterEmptyFab))
    check(
      'fab_empty_not_in_storage',
      afterEmptyFab.storedCount === 0 && !afterEmptyFab.blankInStorage,
      JSON.stringify(afterEmptyFab),
    )

    // Wait past draftGuard (~2.8s) then tap outside to intentional-blur/discard
    await wait(3000)
    await page.click('#tapCatcher')
    await wait(400)

    const afterDiscard = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return {
        items: document.querySelectorAll('.todo-item').length,
        storedCount: stored.length,
        blankInStorage: stored.some((t) => !String(t.text || '').trim()),
        emptyVisible: document.querySelector('.empty-state')?.classList.contains('is-visible') || false,
        ephemeral: window.__baizhi?.getEphemeralIds?.() || [],
      }
    })
    check(
      'fab_empty_outside_discards',
      afterDiscard.items === 0 && afterDiscard.storedCount === 0 && !afterDiscard.blankInStorage,
      JSON.stringify(afterDiscard),
    )
    check('fab_empty_shows_empty_state', afterDiscard.emptyVisible, JSON.stringify(afterDiscard))

    // Esc path: FAB empty → Esc → discard
    await page.click('#fab')
    await wait(500)
    await wait(3000)
    await page.keyboard.press('Escape')
    await wait(350)
    const afterEsc = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return {
        items: document.querySelectorAll('.todo-item').length,
        storedCount: stored.length,
        blankInStorage: stored.some((t) => !String(t.text || '').trim()),
      }
    })
    check(
      'fab_empty_esc_discards',
      afterEsc.items === 0 && afterEsc.storedCount === 0 && !afterEsc.blankInStorage,
      JSON.stringify(afterEsc),
    )

    // —— 2) FAB with text persists ——
    await page.click('#fab')
    await wait(450)
    await page.keyboard.type('双击菜单测试', { delay: 18 })
    await wait(200)
    const typed = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { value: ta?.value || '', storedText: stored[0]?.text || '', count: stored.length }
    })
    check('typing_in_textarea', typed.value === '双击菜单测试', typed.value)
    check('typing_persists_storage', typed.storedText === '双击菜单测试' && typed.count === 1, typed.storedText)

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

    // —— 3) Double-tap toggles done ——
    await shortTap(page, cx, cy)
    await wait(80)
    await shortTap(page, cx, cy)
    await wait(300)

    const afterDouble = await page.evaluate(() => {
      const el = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const cs = ta ? getComputedStyle(ta) : null
      return {
        hasDoneClass: el?.classList.contains('is-done') || false,
        completed: !!stored[0]?.completed,
        decoration: cs?.textDecorationLine || cs?.textDecoration || null,
        focused: document.activeElement === ta,
      }
    })
    check('doubletap_marks_done', afterDouble.hasDoneClass && afterDouble.completed, JSON.stringify(afterDouble))
    check(
      'done_strikethrough_style',
      (afterDouble.decoration || '').includes('line-through'),
      afterDouble.decoration,
    )
    check('doubletap_no_focus', !afterDouble.focused, JSON.stringify(afterDouble))

    // Untoggle
    await shortTap(page, cx, cy)
    await wait(80)
    await shortTap(page, cx, cy)
    await wait(250)
    const undone = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      return { completed: !!stored[0]?.completed }
    })
    check('doubletap_untoggles', !undone.completed, JSON.stringify(undone))

    // —— 4) Long-press opens menu; no toggle; no focus ——
    await longPress(page, cx, cy, 560)
    await wait(250)

    const afterLong = await page.evaluate(() => {
      const menu = document.querySelector('.ctx-menu')
      const labels = [...(menu?.querySelectorAll('[data-action]') || [])].map((b) => ({
        action: b.getAttribute('data-action'),
        text: b.textContent.trim(),
      }))
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const el = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      return {
        menuHidden: menu?.hidden ?? true,
        menuOpenClass: menu?.classList.contains('is-open') || false,
        labels,
        completed: !!stored[0]?.completed,
        hasDoneClass: el?.classList.contains('is-done') || false,
        itemMenuOpen: el?.classList.contains('is-menu-open') || false,
        focused: document.activeElement === ta,
        editing: el?.classList.contains('is-editing') || false,
        zIndex: menu ? getComputedStyle(menu).zIndex : null,
      }
    })
    check('longpress_opens_menu', !afterLong.menuHidden && afterLong.menuOpenClass, JSON.stringify(afterLong))
    check(
      'longpress_does_not_toggle',
      !afterLong.completed && !afterLong.hasDoneClass,
      JSON.stringify(afterLong),
    )
    check(
      'longpress_does_not_focus',
      !afterLong.focused && !afterLong.editing,
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
    check('ctx_menu_z_index_high', Number(afterLong.zIndex) >= 40, String(afterLong.zIndex))

    // Dismiss menu for next test
    await page.click('#tapCatcher')
    await wait(200)

    // —— 5) Long-press survives pointercancel (Android WebView) ——
    const cancelSurvive = await page.evaluate(async (coords) => {
      const li = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      if (!li) return { ok: false, reason: 'no-li' }
      const completedBefore = !!JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')[0]?.completed

      li.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: coords.x,
          clientY: coords.y,
          buttons: 1,
        }),
      )
      // Simulate WebView cancel mid-press
      await new Promise((r) => setTimeout(r, 120))
      li.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: coords.x,
          clientY: coords.y,
        }),
      )
      await new Promise((r) => setTimeout(r, 450))
      const menu = document.querySelector('.ctx-menu')
      const stored = JSON.parse(localStorage.getItem('baizhi.todos.v1') || '[]')
      const result = {
        menuOpen: menu && !menu.hidden && menu.classList.contains('is-open'),
        completed: !!stored[0]?.completed,
        completedBefore,
        focused: document.activeElement === ta,
        editing: li.classList.contains('is-editing'),
      }
      // release
      li.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
          clientX: coords.x,
          clientY: coords.y,
        }),
      )
      return result
    }, { x: cx, y: cy })
    await wait(200)
    check(
      'longpress_survives_pointercancel',
      cancelSurvive.menuOpen === true,
      JSON.stringify(cancelSurvive),
    )
    check(
      'pointercancel_longpress_no_toggle',
      cancelSurvive.completed === cancelSurvive.completedBefore && !cancelSurvive.completed,
      JSON.stringify(cancelSurvive),
    )
    check(
      'pointercancel_longpress_no_focus',
      !cancelSurvive.focused && !cancelSurvive.editing,
      JSON.stringify(cancelSurvive),
    )

    // —— 6) Menu 编辑 focuses ——
    // Ensure menu open
    const menuOpenNow = await page.evaluate(() => {
      const menu = document.querySelector('.ctx-menu')
      return menu && !menu.hidden
    })
    if (!menuOpenNow) {
      await longPress(page, cx, cy, 560)
      await wait(250)
    }

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
    check(
      'menu_edit_focuses_textarea',
      afterEdit.focused && afterEdit.unlocked && !afterEdit.readonly && afterEdit.editing,
      JSON.stringify(afterEdit),
    )
    check('menu_closes_after_edit', afterEdit.menuHidden === true)

    await page.keyboard.press('Enter')
    await wait(200)

    // Menu 完成
    await longPress(page, cx, cy, 560)
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

    await longPress(page, cx, cy, 560)
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

    const reelOk = await page.evaluate(() => {
      try {
        window.__baizhi.updateReel()
        return true
      } catch (e) {
        return String(e)
      }
    })
    check('updateReel_no_crash', reelOk === true, String(reelOk))

    // no dual-mode leftovers
    const moduleLeftover = await page.evaluate(async () => {
      const scripts = [...document.querySelectorAll('script[src]')]
      let text = ''
      for (const s of scripts) {
        try {
          text += await (await fetch(s.src)).text()
        } catch {}
      }
      return {
        todoDisplay: text.includes('todo-display'),
        beginEdit: typeof window.__baizhi?.beginEdit === 'function',
      }
    })
    check(
      'no_todo_display_mode',
      !moduleLeftover.todoDisplay && !moduleLeftover.beginEdit,
      JSON.stringify(moduleLeftover),
    )

    // —— 8) Locked textarea: no user-select; long-press leaves no selection ——
    await page.click('#fab')
    await wait(450)
    await page.keyboard.type('禁选测试条目', { delay: 16 })
    await wait(150)
    await page.keyboard.press('Enter')
    await wait(250)

    const lockedSelect = await page.evaluate(() => {
      const el = document.querySelector('.todo-item')
      const ta = document.querySelector('.todo-text')
      if (!el || !ta) return { ok: false, reason: 'missing' }
      const cs = getComputedStyle(ta)
      return {
        editing: el.classList.contains('is-editing'),
        unlocked: ta.classList.contains('is-unlocked'),
        readonly: !!ta.readOnly,
        userSelect: cs.userSelect || cs.webkitUserSelect || '',
        webkitUserSelect: cs.webkitUserSelect || '',
        touchCallout: cs.webkitTouchCallout || '',
      }
    })
    check(
      'locked_textarea_not_editing',
      lockedSelect.ok !== false && !lockedSelect.editing && !lockedSelect.unlocked && lockedSelect.readonly,
      JSON.stringify(lockedSelect),
    )
    const us = String(lockedSelect.userSelect || lockedSelect.webkitUserSelect || '').toLowerCase()
    check(
      'locked_textarea_user_select_none',
      us.includes('none'),
      JSON.stringify(lockedSelect),
    )
    const callout = String(lockedSelect.touchCallout || '').toLowerCase()
    check(
      'locked_textarea_touch_callout_none',
      !callout || callout.includes('none'),
      JSON.stringify(lockedSelect),
    )

    const box2 = await page.$('.todo-item')
    const rect2 = await box2.boundingBox()
    const cx2 = rect2.x + rect2.width / 2
    const cy2 = rect2.y + rect2.height / 2

    await page.click('#tapCatcher')
    await wait(150)
    await longPress(page, cx2, cy2, 580)
    await wait(250)
    const afterRealLp = await page.evaluate(() => {
      const ta = /** @type {HTMLTextAreaElement} */ (document.querySelector('.todo-text'))
      const el = document.querySelector('.todo-item')
      const menu = document.querySelector('.ctx-menu')
      const sel = window.getSelection?.()
      const selText = sel?.toString?.() || ''
      return {
        menuOpen: !!(menu && !menu.hidden && menu.classList.contains('is-open')),
        focused: document.activeElement === ta,
        editing: el?.classList.contains('is-editing') || false,
        selectionCollapsed: ta.selectionStart === ta.selectionEnd,
        selText,
        hasRange: !!(sel && sel.rangeCount > 0 && selText.length > 0),
        userSelect: getComputedStyle(ta).userSelect,
      }
    })
    check(
      'longpress_no_text_selection',
      afterRealLp.selectionCollapsed && !afterRealLp.hasRange && !afterRealLp.selText,
      JSON.stringify(afterRealLp),
    )
    check(
      'longpress_menu_only_no_select',
      afterRealLp.menuOpen && !afterRealLp.focused && !afterRealLp.editing,
      JSON.stringify(afterRealLp),
    )

    // editing path still allows select
    await page.click('.ctx-menu [data-action="edit"]')
    await wait(300)
    const editingSelect = await page.evaluate(() => {
      const ta = document.querySelector('.todo-text')
      const el = document.querySelector('.todo-item')
      const cs = ta ? getComputedStyle(ta) : null
      return {
        editing: el?.classList.contains('is-editing') || false,
        userSelect: cs?.userSelect || '',
      }
    })
    check(
      'editing_allows_user_select_text',
      editingSelect.editing && String(editingSelect.userSelect).toLowerCase().includes('text'),
      JSON.stringify(editingSelect),
    )
    await page.keyboard.press('Enter')
    await wait(200)

    // —— 9) Soft-float knobs must match v19 (NOT v20 eased values) ——
    const reelSrc = await page.evaluate(async () => {
      const scripts = [...document.querySelectorAll('script[src]')]
      let text = ''
      for (const s of scripts) {
        try {
          text += await (await fetch(s.src)).text()
        } catch {}
      }
      return text
    })
    const cssText = await page.evaluate(async () => {
      const links = [...document.querySelectorAll('link[rel=stylesheet]')]
      let text = ''
      for (const l of links) {
        try {
          text += await (await fetch(l.href)).text()
        } catch {}
      }
      return text
    })
    check(
      'softfloat_v19_horizon_0_82',
      reelSrc.includes('*0.82') || reelSrc.includes('*.82') || reelSrc.includes('* 0.82') || reelSrc.includes('0.82'),
      'horizonFrac=0.82',
    )
    check(
      'softfloat_v19_scale_0_58',
      reelSrc.includes('*0.58') || reelSrc.includes('*.58') || reelSrc.includes('* 0.58'),
      'scaleDrop=0.58',
    )
    check(
      'softfloat_v19_opacity_0_92',
      reelSrc.includes('*0.92') || reelSrc.includes('*.92') || reelSrc.includes('* 0.92'),
      'opacityDrop=0.92',
    )
    check(
      'softfloat_v19_no_vanishTop_neg',
      !reelSrc.includes('*-.16') && !reelSrc.includes('-0.16') && !reelSrc.includes('vanishTop'),
      'no v20 vanishTop',
    )
    check(
      'softfloat_v19_list_padding_56',
      cssText.includes('56px 0 28px') || cssText.includes('padding:56px 0 28px'),
      'list padding-top 56px',
    )
    check(
      'softfloat_v19_mask_28',
      cssText.includes('28%') && !cssText.includes('#000 16% 100%'),
      'CSS mask ~28%',
    )

  } catch (err) {
    results.ok = false
    results.error = String(err && err.stack ? err.stack : err)
  } finally {
    await browser.close()
    server.close()
  }

  const passed = results.checks.filter((c) => c.pass).length
  const total = results.checks.length
  results.passed = passed
  results.total = total
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  console.log(`PASS ${passed}/${total}`)
  process.exit(results.ok ? 0 : 1)
}

main()
