import json
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import StrictUndefined, TemplateError
from jinja2.sandbox import SandboxedEnvironment
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("MKPT_DATA_DIR", BASE_DIR / "data"))
MEDIA_DIR = DATA_DIR / "media"
DATABASE_PATH = DATA_DIR / "mkpt.sqlite3"
KINDS = {
    "characters": ("characters", "personnage"),
    "locations": ("locations", "lieu"),
    "actions": ("actions", "action"),
}
ALLOWED_IMAGES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_IMAGE_SIZE = 8 * 1024 * 1024
MEDIA_DIR.mkdir(parents=True, exist_ok=True)


class EntityInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    characteristics: str = Field(default="", max_length=10000)


class PromptTemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=30000)
    character_slots: int = Field(default=1, ge=0, le=20)
    location_slots: int = Field(default=1, ge=0, le=20)
    action_slots: int = Field(default=1, ge=0, le=20)


class PromptBuildInput(BaseModel):
    template_id: int
    character_ids: list[int] | None = None
    location_ids: list[int] | None = None
    action_ids: list[int] | None = None
    character_id: int | None = None
    location_id: int | None = None
    action_id: int | None = None


@contextmanager
def connect_db():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as db:
        for table in ("characters", "locations", "actions"):
            db.execute(
                f"""CREATE TABLE IF NOT EXISTS {table} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    characteristics TEXT NOT NULL DEFAULT '',
                    images TEXT NOT NULL DEFAULT '[]'
                )"""
            )
        db.execute(
            """CREATE TABLE IF NOT EXISTS prompt_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                character_slots INTEGER NOT NULL DEFAULT 1,
                location_slots INTEGER NOT NULL DEFAULT 1,
                action_slots INTEGER NOT NULL DEFAULT 1
            )"""
        )
        columns = {
            row["name"] for row in db.execute("PRAGMA table_info(prompt_templates)").fetchall()
        }
        for column in ("character_slots", "location_slots", "action_slots"):
            if column not in columns:
                db.execute(
                    f"ALTER TABLE prompt_templates ADD COLUMN {column} INTEGER NOT NULL DEFAULT 1"
                )
        existing = db.execute("SELECT COUNT(*) FROM prompt_templates").fetchone()[0]
        if existing == 0:
            db.execute(
                "INSERT INTO prompt_templates (name, content) VALUES (?, ?)",
                (
                    "Scène cinématographique",
                    "Un portrait de {{ character.name }}{% if character.characteristics %}, {{ character.characteristics }}{% endif %}. "
                    "La scène se déroule à {{ location.name }}{% if location.characteristics %}, {{ location.characteristics }}{% endif %}. "
                    "{{ action.name }}{% if action.characteristics %} : {{ action.characteristics }}{% endif %}. "
                    "Composition cinématographique, lumière soignée, grande richesse de détails.",
                ),
            )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_db()
    yield


app = FastAPI(title="Atelier de prompts", version="1.0.0", lifespan=lifespan)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/assets", StaticFiles(directory=BASE_DIR / "web"), name="assets")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(BASE_DIR / "web" / "index.html")


def validate_name(name: str):
    if not name.strip():
        raise HTTPException(status_code=422, detail="Le nom ne peut pas être vide.")
    return name.strip()


def entity_dict(row):
    result = dict(row)
    result["images"] = json.loads(result["images"])
    return result


@app.get("/api/{kind}")
def list_entities(kind: str):
    if kind == "templates":
        with connect_db() as db:
            rows = db.execute(
                """SELECT id, name, content, character_slots, location_slots, action_slots
                   FROM prompt_templates ORDER BY name COLLATE NOCASE"""
            ).fetchall()
        return [dict(row) for row in rows]
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Type d'élément inconnu.")
    table, _label = KINDS[kind]
    with connect_db() as db:
        rows = db.execute(
            f"SELECT id, name, characteristics, images FROM {table} ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return [entity_dict(row) for row in rows]


@app.post("/api/templates", status_code=201)
def create_template(payload: PromptTemplateInput):
    with connect_db() as db:
        cursor = db.execute(
            """INSERT INTO prompt_templates
               (name, content, character_slots, location_slots, action_slots)
               VALUES (?, ?, ?, ?, ?)""",
            (
                validate_name(payload.name), payload.content, payload.character_slots,
                payload.location_slots, payload.action_slots,
            ),
        )
        row = db.execute(
            """SELECT id, name, content, character_slots, location_slots, action_slots
               FROM prompt_templates WHERE id = ?""",
            (cursor.lastrowid,),
        ).fetchone()
    return dict(row)


@app.put("/api/templates/{template_id}")
def update_template(template_id: int, payload: PromptTemplateInput):
    with connect_db() as db:
        cursor = db.execute(
            """UPDATE prompt_templates
               SET name = ?, content = ?, character_slots = ?, location_slots = ?, action_slots = ?
               WHERE id = ?""",
            (
                validate_name(payload.name), payload.content, payload.character_slots,
                payload.location_slots, payload.action_slots, template_id,
            ),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Template introuvable.")
        row = db.execute(
            """SELECT id, name, content, character_slots, location_slots, action_slots
               FROM prompt_templates WHERE id = ?""",
            (template_id,),
        ).fetchone()
    return dict(row)


@app.delete("/api/templates/{template_id}", status_code=204)
def delete_template(template_id: int):
    with connect_db() as db:
        cursor = db.execute("DELETE FROM prompt_templates WHERE id = ?", (template_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Template introuvable.")


@app.post("/api/build")
def build_prompt(payload: PromptBuildInput):
    with connect_db() as db:
        template = db.execute(
            """SELECT content, character_slots, location_slots, action_slots
               FROM prompt_templates WHERE id = ?""",
            (payload.template_id,),
        ).fetchone()
        if template is None:
            raise HTTPException(status_code=404, detail="Template introuvable.")

        entities = {}
        for kind, singular, count_field in (
            ("characters", "character", "character_slots"),
            ("locations", "location", "location_slots"),
            ("actions", "action", "action_slots"),
        ):
            entity_ids = getattr(payload, f"{singular}_ids")
            if entity_ids is None:
                legacy_id = getattr(payload, f"{singular}_id")
                entity_ids = [] if legacy_id is None else [legacy_id]
            expected_count = template[count_field]
            if len(entity_ids) != expected_count:
                raise HTTPException(
                    status_code=422,
                    detail=f"Ce template attend {expected_count} élément(s) de type {KINDS[kind][1]}.",
                )
            table, _label = KINDS[kind]
            entities[kind] = []
            for entity_id in entity_ids:
                row = db.execute(
                    f"SELECT id, name, characteristics, images FROM {table} WHERE id = ?",
                    (entity_id,),
                ).fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail=f"Élément introuvable : {kind}.")
                entities[kind].append(entity_dict(row))

    context = {}
    for kind, singular in (
        ("characters", "character"),
        ("locations", "location"),
        ("actions", "action"),
    ):
        context[kind] = entities[kind]
        for index, entity in enumerate(entities[kind], start=1):
            context[f"{singular}_{index}"] = entity
        if entities[kind]:
            context[singular] = entities[kind][0]
    try:
        prompt = SandboxedEnvironment(undefined=StrictUndefined, autoescape=False).from_string(
            template["content"]
        ).render(**context)
    except TemplateError as error:
        raise HTTPException(status_code=422, detail=f"Erreur dans le template Jinja2 : {error}")
    return {"prompt": prompt.strip()}


@app.post("/api/{kind}", status_code=201)
def create_entity(kind: str, payload: EntityInput):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Type d'élément inconnu.")
    table, _label = KINDS[kind]
    with connect_db() as db:
        cursor = db.execute(
            f"INSERT INTO {table} (name, characteristics) VALUES (?, ?)",
            (validate_name(payload.name), payload.characteristics.strip()),
        )
        row = db.execute(f"SELECT * FROM {table} WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return entity_dict(row)


@app.put("/api/{kind}/{item_id}")
def update_entity(kind: str, item_id: int, payload: EntityInput):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Type d'élément inconnu.")
    table, _label = KINDS[kind]
    with connect_db() as db:
        cursor = db.execute(
            f"UPDATE {table} SET name = ?, characteristics = ? WHERE id = ?",
            (validate_name(payload.name), payload.characteristics.strip(), item_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Élément introuvable.")
        row = db.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    return entity_dict(row)


@app.delete("/api/{kind}/{item_id}", status_code=204)
def delete_entity(kind: str, item_id: int):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Type d'élément inconnu.")
    table, _label = KINDS[kind]
    with connect_db() as db:
        row = db.execute(f"SELECT images FROM {table} WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Élément introuvable.")
        db.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
    for image in json.loads(row["images"]):
        (MEDIA_DIR / image["filename"]).unlink(missing_ok=True)


@app.post("/api/{kind}/{item_id}/images", status_code=201)
async def upload_image(kind: str, item_id: int, file: UploadFile = File(...)):
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Type d'élément inconnu.")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_IMAGES or file.content_type != ALLOWED_IMAGES[extension]:
        raise HTTPException(status_code=415, detail="Format accepté : JPG, PNG, WEBP ou GIF.")
    contents = await file.read(MAX_IMAGE_SIZE + 1)
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="L'image ne doit pas dépasser 8 Mo.")

    table, _label = KINDS[kind]
    filename = f"{uuid.uuid4().hex}{extension}"
    image = {"filename": filename, "url": f"/media/{filename}"}
    image_path = MEDIA_DIR / filename
    try:
        with connect_db() as db:
            row = db.execute(f"SELECT images FROM {table} WHERE id = ?", (item_id,)).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Élément introuvable.")
            images = json.loads(row["images"])
            images.append(image)
            image_path.write_bytes(contents)
            db.execute(
                f"UPDATE {table} SET images = ? WHERE id = ?", (json.dumps(images), item_id)
            )
    except Exception:
        image_path.unlink(missing_ok=True)
        raise
    return image


@app.delete("/api/{kind}/{item_id}/images/{filename}", status_code=204)
def delete_image(kind: str, item_id: int, filename: str):
    if kind not in KINDS or Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="Image introuvable.")
    table, _label = KINDS[kind]
    with connect_db() as db:
        row = db.execute(f"SELECT images FROM {table} WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Élément introuvable.")
        images = json.loads(row["images"])
        updated = [image for image in images if image["filename"] != filename]
        if len(updated) == len(images):
            raise HTTPException(status_code=404, detail="Image introuvable.")
        db.execute(
            f"UPDATE {table} SET images = ? WHERE id = ?", (json.dumps(updated), item_id)
        )
    (MEDIA_DIR / filename).unlink(missing_ok=True)
