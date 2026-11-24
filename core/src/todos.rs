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
    done: bool,
    completed_at: JsValue,
}

impl Todo {
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
        row.into()
    }
}

fn load() -> Result<Vec<Todo>, JsValue> {
    let raw = read(KEY)?;
    // Parse directly in the host to preserve all UTF-16 code units in legacy JSON.
    let Ok(raw) = raw.dyn_into::<JsString>() else {
        return Ok(vec![]);
    };
    let parsed = parse(&raw)?;
    let mut rows = vec![];
    if !Array::is_array(&parsed) {
        return Ok(rows);
    }
    for row in Array::from(&parsed)
        .iter()
        .filter(|r| r.is_object() && !r.is_null())
    {
        let get = |key: &str| Reflect::get(&row, &key.into());
        let Ok(id) = get("id")?.dyn_into::<JsString>() else {
            continue;
        };
        let text = get("text")?;
        let text = if text.is_null() || text.is_undefined() {
            JsString::from("")
        } else {
            string(&text)?
        };
        if !meaningful(&text) {
            continue;
        }
        let created = number(&get("createdAt")?)?;
        let completed_at = get("completedAt")?;
        rows.push(Todo {
            id,
            text,
            created: if created == 0.0 || created.is_nan() {
                Date::now()
            } else {
                created
            },
            done: get("completed")?.is_truthy(),
            completed_at: if completed_at.is_undefined() {
                JsValue::NULL
            } else {
                completed_at
            },
        });
    }
    Ok(rows)
}

#[wasm_bindgen]
pub struct Todos {
    rows: Vec<Todo>,
}

impl Todos {
    fn serialize_meaningful(&self) -> Result<JsString, JsValue> {
        let rows: Array = self
            .rows
            .iter()
            .filter(|r| meaningful(&r.text))
            .map(Todo::snapshot)
            .collect();
        JSON::stringify(&rows)
    }

    fn save(&self) -> Result<(), JsValue> {
        write(KEY, &self.serialize_meaningful()?)
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
            done: false,
            completed_at: JsValue::NULL,
        };
        let view = row.snapshot();
        self.rows.push(row);
        view
    }
    pub fn get(&self, id: JsString) -> JsValue {
        self.rows
            .iter()
            .find(|r| r.id == id)
            .map(Todo::snapshot)
            .unwrap_or(JsValue::UNDEFINED)
    }
    /// Update text in memory and immediately persist (keeps exact legacy API contract).
    pub fn edit(&mut self, id: JsString, text: JsString) -> Result<(), JsValue> {
        if let Some(row) = self.rows.iter_mut().find(|r| r.id == id) {
            row.text = text;
            self.save()?;
        }
        Ok(())
    }
    /// Update text in memory without immediate localStorage write (for debounced typing).
    /// Returns true if the row transitioned from blank/non-meaningful to meaningful.
    pub fn set_text(&mut self, id: JsString, text: JsString) -> bool {
        if let Some(row) = self.rows.iter_mut().find(|r| r.id == id) {
            let was_meaningful = meaningful(&row.text);
            let now_meaningful = meaningful(&text);
            row.text = text;
            return !was_meaningful && now_meaningful;
        }
        false
    }
    /// Flush current meaningful todos to localStorage.
    pub fn flush(&self) -> Result<(), JsValue> {
        self.save()
    }
    /// Restore a previously deleted todo (preserving original id, createdAt, completed state).
    pub fn restore(
        &mut self,
        id: JsString,
        text: JsString,
        created: f64,
        done: bool,
        completed_at: JsValue,
    ) -> Result<JsValue, JsValue> {
        if self.rows.iter().any(|r| r.id == id) {
            return Ok(self.get(id));
        }
        let row = Todo {
            id,
            text,
            created,
            done,
            completed_at: if completed_at.is_undefined() {
                JsValue::NULL
            } else {
                completed_at
            },
        };
        let view = row.snapshot();
        self.rows.push(row);
        self.save()?;
        Ok(view)
    }
    pub fn export_json(&self) -> Result<JsString, JsValue> {
        self.serialize_meaningful()
    }
    pub fn toggle(&mut self, id: JsString, now: f64) -> Result<JsValue, JsValue> {
        let Some(row) = self.rows.iter_mut().find(|r| r.id == id) else {
            return Ok(JsValue::UNDEFINED);
        };
        row.done = !row.done;
        row.completed_at = if row.done { now.into() } else { JsValue::NULL };
        let view = row.snapshot();
        self.save()?;
        Ok(view)
    }
    pub fn remove(&mut self, id: JsString) -> Result<bool, JsValue> {
        let Some(i) = self.rows.iter().position(|r| r.id == id) else {
            return Ok(false);
        };
        self.rows.remove(i);
        self.save()?;
        Ok(true)
    }
    pub fn count(&self) -> usize {
        self.rows.len()
    }
    pub fn done_count(&self) -> usize {
        self.rows.iter().filter(|r| r.done).count()
    }
    pub fn drafts(&self) -> Array {
        self.rows
            .iter()
            .filter(|r| !meaningful(&r.text))
            .map(|r| r.id.clone())
            .collect()
    }
    pub fn items(&self, ordered: bool) -> Array {
        let mut rows: Vec<_> = self.rows.iter().collect();
        if ordered {
            rows.sort_by(|a, b| a.created.total_cmp(&b.created));
        }
        rows.into_iter().map(Todo::snapshot).collect()
    }
}
