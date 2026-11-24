import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { initSync, Edge, drag, Todos, meaningful, stamp, storage_key, reel, reel_batch } from '../src/generated/baizhi_core.js'

initSync({ module: readFileSync(new URL('../src/generated/baizhi_core_bg.wasm', import.meta.url)) })

// Golden peaks (px) and first settled frames measured from v25 animateInertialEdge.
// RAF timestamps are frame * 1000 / Hz. Both edges use the same absolute peak.
const golden = [
  [30, [[24, 24], [24.5, 25], [35, 25]]],
  [60, [[25.798194444444444, 36], [26.335656828703705, 36], [37.622366898148144, 36]]],
  [120, [[27.02248867047157, 65], [27.585457184439726, 65], [39.407795977771045, 103]]],
]
for (const [hz, values] of golden) {
  for (const [i, speed] of [181, 350, 500, 1500, 10000].entries()) {
    for (const sign of [-1, 1]) {
      test(`v25 ${hz} Hz, ${speed} px/s, direction ${sign}`, () => {
        const edge = new Edge()
        const boundary = sign === 1 ? 0 : 1000
        edge.sample_origin(boundary + sign * speed / 10, 0)
        const direction = edge.scroll(boundary, 1000, 100, false)
        assert.equal(direction, sign)
        let peak = sign * edge.start(direction, 100)
        let frame = 0
        while (!edge.settled() && frame < 500) {
          const offset = edge.step(100 + ++frame * 1000 / hz)
          peak = Math.max(peak, sign * offset)
        }
        const [expectedPeak, expectedFrame] = values[Math.min(i, 2)]
        assert.ok(Math.abs(peak - expectedPeak) < 1e-10)
        assert.equal(frame, expectedFrame)
        edge.free()
      })
    }
  }
}

test('v25 strict thresholds, sample window, active touch and mid-list drag', () => {
  const edge = new Edge()
  edge.sample_origin(18, 0)
  assert.equal(edge.scroll(0, 500, 100, false), 0)
  edge.sample_origin(50, 100)
  assert.equal(edge.scroll(0, 500, 220, false), 0)
  edge.sample_origin(10, 220)
  assert.equal(edge.scroll(0.51, 500, 230, false), 0)
  assert.equal(edge.scroll(0.5, 500, 230, true), 0)
  assert.equal(edge.scroll(0.5, 500, 350, false), 1)
  assert.ok(Number.isNaN(drag(10, 10, 500, false)))
  assert.equal(drag(50, 0, 500, false), 9)
  assert.equal(drag(200, 0, 500, false), 22)
  assert.equal(drag(-200, 500, 500, false), -22)
  edge.free()
})

test('v25 storage, draft edits, reload, timestamps and JS whitespace', () => {
  const key = 'baizhi.todos.v1'
  assert.equal(storage_key(), key)
  const legacy = { id: '旧', text: ' 写字📄\ud800 ', createdAt: 123, completed: true, completedAt: 124 }
  const raw = JSON.stringify([legacy, { id: 'blank', text: '\ufeff ' }, { text: 'missing id' }])
  const data = new Map([[key, raw]])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => data.get(k) ?? null, setItem: (k, value) => data.set(k, value),
  } })
  const store = new Todos()
  assert.deepEqual(store.items(true), [legacy])
  const draft = store.add()
  assert.deepEqual(store.drafts(), [draft.id])
  assert.equal(data.get(key), raw)
  store.edit(draft.id, '\ufeff\u00a0 ')
  assert.deepEqual(JSON.parse(data.get(key)), [legacy])
  assert.equal(meaningful('\u0085'), true)
  store.edit(draft.id, ' 第二条 ')
  assert.equal(store.toggle(legacy.id, 456).completedAt, null)
  assert.equal(store.toggle(legacy.id, 789).completedAt, 789)
  const reopened = new Todos()
  assert.deepEqual(reopened.items(false), [{ ...legacy, completedAt: 789 }, { ...draft, text: ' 第二条 ' }])
  assert.equal(reopened.remove(draft.id), true)
  assert.equal(JSON.parse(data.get(key)).length, 1)
  store.free(); reopened.free()
})

test('Hong Kong midnight across a year boundary', () => {
  const midnight = Date.parse('2025-12-31T16:00:00Z')
  assert.equal(stamp(midnight, midnight), '今天 00:00')
  assert.equal(stamp(midnight - 60000, midnight), '昨天 23:59')
  assert.equal(stamp(midnight - 86460000, midnight), '12-30 23:59')
})

test('v27 reel_batch matches single reel exactly', () => {
  const inputs = new Float64Array([0, 40, 0, 300, 60, 1, 690, 20, 0])
  const out = new Float64Array(18)
  reel_batch(10, 844, inputs, out)
  for (let i = 0; i < 3; i++) {
    const single = reel(10, 844, inputs[i * 3], inputs[i * 3 + 1], inputs[i * 3 + 2] !== 0)
    for (let j = 0; j < 6; j++) {
      assert.equal(out[i * 6 + j], single[j])
    }
  }
})

test('v27 set_text/flush, restore, export_json and leap-year stamp', () => {
  const key = 'baizhi.todos.v1'
  const data = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => data.get(k) ?? null, setItem: (k, value) => data.set(k, value),
  } })
  const store = new Todos()
  const t = store.add()
  assert.equal(store.set_text(t.id, '   '), false)
  assert.equal(data.has(key), false)
  assert.equal(store.set_text(t.id, 'hello'), true)
  assert.equal(data.has(key), false)
  store.flush()
  assert.equal(JSON.parse(data.get(key)).length, 1)
  assert.equal(store.export_json(), data.get(key))
  assert.equal(store.remove(t.id), true)
  assert.equal(JSON.parse(data.get(key)).length, 0)
  store.restore(t.id, 'hello', t.createdAt, true, 999)
  const restored = store.get(t.id)
  assert.equal(restored.text, 'hello')
  assert.equal(restored.completed, true)
  assert.equal(restored.completedAt, 999)
  // Leap day in HKT: 2024-02-29 08:30 HKT = 2024-02-29T00:30:00Z
  assert.equal(stamp(Date.parse('2024-02-29T00:30:00Z'), Date.parse('2024-03-05T00:00:00Z')), '02-29 08:30')
  store.free()
})
