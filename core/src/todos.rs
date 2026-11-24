use js_sys::{Array, Date, JsString, Object, Reflect, JSON};
use wasm_bindgen::{prelude::*, JsCast};

const KEY: &str = "baizhi.todos.v1";

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = localStorage, js_name = getItem, catch)]
    fn read(key: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_namespace = localStorage, js_name = setItem, catch)]
    fn write(key: &str, value: &JsString) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = JSON, js_name = parse, catch)]
    fn parse(raw: &JsString) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = String, catch)]
    fn string(value: &JsValue) -> Result<JsString, JsValue>;
    #[wasm_bindgen(js_name = Number, catch)]
    fn number(value: &JsValue) -> Result<f64, JsValue>;
}

#[wasm_bindgen]
pub fn storage_key() -> String {
    KEY.into()
}

// Use ECMAScript trim and UTF-16 strings for exact WebView input/storage semantics.
#[wasm_bindgen]
pub fn meaningful(text: &JsString) -> bool {
    text.trim().length() > 0
}
#[wasm_bindgen]
pub fn trim(text: &JsString) -> JsString {
    text.trim()
}

struct Todo {
    id: JsString,
    text: JsString,
    created: f64,
    updated: f64,
    done: bool,
    completed_at: JsValue,
    pinned: bool,
    deleted_at: JsValue,
}

impl Todo {
    fn is_deleted(&self) -> bool {
        !self.deleted_at.is_null() && !self.deleted_at.is_undefined()
    }

    /// Legacy 5-field snapshot (preserves exact compatibility with existing tests/storage).
    fn snapshot(&self) -> JsValue {
        let row = Object::new();
        for (key, value) in [
            ("id", self.id.clone().into()),
            ("text", self.text.clone().into()),
            ("createdAt", self.created.into()),
            ("completed", self.done.into()),
            ("completedAt", self.completed_at.clone()),
        ] {
            Reflect::set(&row, &key.into(), &value).unwrap();
        }
        if self.pinned {
            Reflect::set(&row, &"pinned".into(), &true.into()).unwrap();
        }
        row.into()
    }

    /// Full sync/storage snapshot including updatedAt, pinned, deletedAt.
    fn sync_snapshot(&self) -> JsValue {
        let row = Object::new();
        for (key, value) in [
            ("id", self.id.clone().into()),
            ("text", self.text.clone().into()),
            ("createdAt", self.created.into()),
            ("updatedAt", self.updated.into()),
            ("completed", self.done.into()),
            ("completedAt", self.completed_at.clone()),
            ("pinned", self.pinned.into()),
            ("deletedAt", self.deleted_at.clone()),
        ] {
            Reflect::set(&row, &key.into(), &value).unwrap();
        }
        row.into()
    }

    /// Storage snapshot: keeps legacy 5 fields, adds optional metadata only when present.
    fn storage_snapshot(&self) -> JsValue {
        let row = Object::new();
        for (key, value) in [
            ("id", self.id.clone().into()),
            ("text", self.text.clone().into()),
            ("createdAt", self.created.into()),
            ("completed", self.done.into()),
            ("completedAt", self.completed_at.clone()),
        ] {
            Reflect::set(&row, &key.into(), &value).unwrap();
        }
        if self.updated != self.created {
            Reflect::set(&row, &"updatedAt".into(), &self.updated.into()).unwrap();
        }
        if self.pinned {
            Reflect::set(&row, &"pinned".into(), &true.into()).unwrap();
        }
        if self.is_deleted() {
            Reflect::set(&row, &"deletedAt".into(), &self.deleted_at).unwrap();
        }
        row.into()
    }
}

fn parse_todo_obj(row: &JsValue, allow_deleted: bool) -> Result<Option<Todo>, JsValue> {
    if !row.is_object() || row.is_null() {
        return Ok(None);
    }
    let get = |key: &str| Reflect::get(row, &key.into());
    let Ok(id) = get("id")?.dyn_into::<JsString>() else {
        return Ok(None);
    };
    let deleted_at = get("deletedAt")?;
    let deleted_at = if deleted_at.is_undefined() {
        JsValue::NULL
    } else {
        deleted_at
    };
    let is_del = !deleted_at.is_null();
    if is_del && !allow_deleted {
        return Ok(None);
    }

    let text = get("text")?;
    let text = if text.is_null() || text.is_undefined() {
        JsString::from("")
    } else {
        string(&text)?
    };
    if !is_del && !meaningful(&text) {
        return Ok(None);
    }

    let created_raw = number(&get("createdAt")?)?;
    let created = if created_raw == 0.0 || created_raw.is_nan() {
        Date::now()
    } else {
        created_raw
    };
    let completed_at = get("completedAt")?;
    let completed_at = if completed_at.is_undefined() {
        JsValue::NULL
    } else {
        completed_at
    };
    let updated_val = get("updatedAt")?;
    let updated = if updated_val.is_undefined() || updated_val.is_null() {
        created
    } else {
        let u = number(&updated_val)?;
        if u == 0.0 || u.is_nan() { created } else { u }
    };

    Ok(Some(Todo {
        id,
        text,
        created,
        updated,
        done: get("completed")?.is_truthy(),
        completed_at,
        pinned: get("pinned")?.is_truthy(),
        deleted_at,
    }))
}

fn load() -> Result<Vec<Todo>, JsValue> {
    let raw = read(KEY)?;
    let Ok(raw) = raw.dyn_into::<JsString>() else {
        return Ok(vec![]);
    };
    let parsed = parse(&raw)?;
    let mut rows = vec![];
    if !Array::is_array(&parsed) {
        return Ok(rows);
    }
    for row in Array::from(&parsed).iter() {
        if let Some(todo) = parse_todo_obj(&row, true)? {
            rows.push(todo);
        }
    }
    Ok(rows)
}

#[wasm_bindgen]
pub struct Todos {
    rows: Vec<Todo>,
}

impl Todos {
    fn serialize_storage(&self) -> Result<JsString, JsValue> {
        let rows: Array = self
            .rows
            .iter()
            .filter(|r| r.is_deleted() || meaningful(&r.text))
            .map(Todo::storage_snapshot)
            .collect();
        JSON::stringify(&rows)
    }

    fn serialize_export(&self) -> Result<JsString, JsValue> {
        let rows: Array = self
            .rows
            .iter()
            .filter(|r| !r.is_deleted() && meaningful(&r.text))
            .map(Todo::snapshot)
            .collect();
        JSON::stringify(&rows)
    }

    fn save(&self) -> Result<(), JsValue> {
        write(KEY, &self.serialize_storage()?)
    }
}

#[wasm_bindgen]
impl Todos {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            rows: load().unwrap_or_default(),
        }
    }

    pub fn add(&mut self) -> JsValue {
        let prefix = js_sys::Number::from(Date::now()).to_string(36).unwrap();
        let suffix = js_sys::Number::from(js_sys::Math::random())
            .to_string(36)
            .unwrap()
            .slice(2, 9);
        let id = format!("{}-{}", String::from(prefix), String::from(suffix)).into();
        let created = Date::now();
        let row = Todo {
            id,
            text: "".into(),
            created,
            updated: created,
            done: false,
            completed_at: JsValue::NULL,
            pinned: false,
            deleted_at: JsValue::NULL,
        };
        let view = row.snapshot();
        self.rows.push(row);
        view
    }

    pub fn get(&self, id: JsString) -> JsValue {
        self.rows
            .iter()
            .find(|r| r.id == id && !r.is_deleted())
            .map(Todo::snapshot)
            .unwrap_or(JsValue::UNDEFINED)
    }

    pub fn edit(&mut self, id: JsString, text: JsString) -> Result<(), JsValue> {
        if let Some(row) = self.rows.iter_mut().find(|r| r.id == id && !r.is_deleted()) {
            row.text = text;
            row.updated = Date::now().max(row.updated + 1.0);
            self.save()?;
        }
        Ok(())
    }

    pub fn set_text(&mut self, id: JsString, text: JsString) -> bool {
        if let Some(row) = self.rows.iter_mut().find(|r| r.id == id && !r.is_deleted()) {
            let was_meaningful = meaningful(&row.text);
            let now_meaningful = meaningful(&text);
            row.text = text;
            row.updated = Date::now().max(row.updated + 1.0);
            return !was_meaningful && now_meaningful;
        }
        false
    }

    pub fn flush(&self) -> Result<(), JsValue> {
        self.save()
    }

    pub fn restore(
        &mut self,
        id: JsString,
        text: JsString,
        created: f64,
        done: bool,
        completed_at: JsValue,
    ) -> Result<JsValue, JsValue> {
        let now = Date::now();
        if let Some(row) = self.rows.iter_mut().find(|r| r.id == id) {
            row.text = text;
            row.created = created;
            row.done = done;
            row.completed_at = if completed_at.is_undefined() {
                JsValue::NULL
            } else {
                completed_at
            };
            row.deleted_at = JsValue::NULL;
            row.updated = now.max(row.updated + 1.0);
            let view = row.snapshot();
            self.save()?;
            return Ok(view);
        }
        let row = Todo {
            id,
            text,
            created,
            updated: now,
            done,
            completed_at: if completed_at.is_undefined() {
                JsValue::NULL
            } else {
                completed_at
            },
            pinned: false,
            deleted_at: JsValue::NULL,
        };
        let view = row.snapshot();
        self.rows.push(row);
        self.save()?;
        Ok(view)
    }

    pub fn export_json(&self) -> Result<JsString, JsValue> {
        self.serialize_export()
    }

    pub fn toggle(&mut self, id: JsString, now: f64) -> Result<JsValue, JsValue> {
        let Some(row) = self.rows.iter_mut().find(|r| r.id == id && !r.is_deleted()) else {
            return Ok(JsValue::UNDEFINED);
        };
        row.done = !row.done;
        row.completed_at = if row.done { now.into() } else { JsValue::NULL };
        if row.done {
            row.pinned = false;
        }
        row.updated = Date::now().max(row.updated + 1.0);
        let view = row.snapshot();
        self.save()?;
        Ok(view)
    }

    pub fn toggle_pin(&mut self, id: JsString, now: f64) -> Result<JsValue, JsValue> {
        let Some(row) = self.rows.iter_mut().find(|r| r.id == id && !r.is_deleted()) else {
            return Ok(JsValue::UNDEFINED);
        };
        row.pinned = !row.pinned;
        row.updated = now.max(row.updated + 1.0);
        let view = row.snapshot();
        self.save()?;
        Ok(view)
    }

    /// Removes a todo. Empty drafts are dropped outright; meaningful items become soft-delete
    /// tombstones if `keep_tombstone` is true (default via `remove_soft`), or dropped in `remove`.
    pub fn remove(&mut self, id: JsString) -> Result<bool, JsValue> {
        let Some(i) = self.rows.iter().position(|r| r.id == id && !r.is_deleted()) else {
            return Ok(false);
        };
        self.rows.remove(i);
        self.save()?;
        Ok(true)
    }

    /// Soft-delete a meaningful todo so cloud sync propagates deletion across devices.
    pub fn soft_remove(&mut self, id: JsString, now: f64) -> Result<bool, JsValue> {
        let Some(i) = self.rows.iter().position(|r| r.id == id && !r.is_deleted()) else {
            return Ok(false);
        };
        if !meaningful(&self.rows[i].text) {
            self.rows.remove(i);
        } else {
            let row = &mut self.rows[i];
            row.deleted_at = now.into();
            row.pinned = false;
            row.updated = now.max(row.updated + 1.0);
        }
        self.save()?;
        Ok(true)
    }

    /// Build JSON payload `{ "items": [...] }` for cloud sync (includes tombstones).
    pub fn sync_payload(&self) -> Result<JsString, JsValue> {
        let items: Array = self
            .rows
            .iter()
            .filter(|r| r.is_deleted() || meaningful(&r.text))
            .map(Todo::sync_snapshot)
            .collect();
        let wrapper = Object::new();
        Reflect::set(&wrapper, &"items".into(), &items.into())?;
        JSON::stringify(&wrapper)
    }

    /// Merge remote items (JSON array or `{ items: [...] }`) using Last-Write-Wins on `updatedAt`.
    /// Returns true if local state changed.
    pub fn merge_remote(&mut self, raw: &JsString) -> Result<bool, JsValue> {
        let parsed = parse(raw)?;
        let list_val = if Array::is_array(&parsed) {
            parsed
        } else if parsed.is_object() && !parsed.is_null() {
            Reflect::get(&parsed, &"items".into())?
        } else {
            return Ok(false);
        };
        if !Array::is_array(&list_val) {
            return Ok(false);
        }
        let mut changed = false;
        for entry in Array::from(&list_val).iter() {
            let Some(remote) = parse_todo_obj(&entry, true)? else {
                continue;
            };
            if let Some(local) = self.rows.iter_mut().find(|r| r.id == remote.id) {
                if remote.updated > local.updated {
                    *local = remote;
                    changed = true;
                }
            } else {
                self.rows.push(remote);
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(changed)
    }

    pub fn count(&self) -> usize {
        self.rows.iter().filter(|r| !r.is_deleted()).count()
    }

    pub fn done_count(&self) -> usize {
        self.rows.iter().filter(|r| !r.is_deleted() && r.done).count()
    }

    pub fn drafts(&self) -> Array {
        self.rows
            .iter()
            .filter(|r| !r.is_deleted() && !meaningful(&r.text))
            .map(|r| r.id.clone())
            .collect()
    }

    pub fn items(&self, ordered: bool) -> Array {
        let mut rows: Vec<_> = self.rows.iter().filter(|r| !r.is_deleted()).collect();
        if ordered {
            rows.sort_by(|a, b| {
                a.pinned
                    .cmp(&b.pinned)
                    .then_with(|| a.created.total_cmp(&b.created))
            });
        }
        rows.into_iter().map(Todo::snapshot).collect()
    }
}
