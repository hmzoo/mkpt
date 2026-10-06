# Atelier — Fabrique à prompts

Une application locale pour gérer des personnages, des lieux, des actions et des templates Jinja2, puis assembler ces éléments en un prompt prêt à copier.

## Démarrer

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Pour démarrer l'application après l'installation, lancez `./start.sh`. Pour l'arrêter, lancez `./stop.sh`. Le journal et le PID sont conservés dans `.run/`. Par défaut, le serveur écoute sur `127.0.0.1:8000` ; les variables `HOST` et `PORT` permettent de choisir une autre adresse et un autre port.

Ouvrez ensuite <http://127.0.0.1:8000>. La base SQLite et les images sont enregistrées dans `data/`. Le chemin de stockage peut être remplacé en définissant `MKPT_DATA_DIR`.

L'application est prévue pour un usage local : aucune authentification n'est configurée. Ne l'exposez pas sur un réseau public sans ajouter une couche d'authentification et de contrôle d'accès.

## Templates Jinja2

```jinja2
{{ character_1.name }}{% if character_1.characteristics %}, {{ character_1.characteristics }}{% endif %}
Dans {{ location_1.name }}, {{ action_1.name }}.
```

Dans l'éditeur de templates, définissez le nombre d'emplacements de personnages, de lieux et d'actions. Cliquez sur les boutons de variables pour les insérer dans le texte ; le générateur affichera ensuite un sélecteur par emplacement. Les variables sont nommées `character_1`, `character_2`, `location_1`, `action_1`, etc. Chaque objet propose `name`, `characteristics` et `images` (une liste contenant `filename` et `url`). Les anciens templates peuvent toujours utiliser les alias `character`, `location` et `action`, qui désignent le premier élément de leur catégorie.

Le nombre d'emplacements peut aller de 0 à 20 par catégorie. Les erreurs Jinja2 (syntaxe incorrecte ou variable manquante) sont signalées dans l'interface au lieu de produire un résultat incomplet.

## API

- `GET/POST /api/characters`, `GET/PUT/DELETE /api/characters/{id}`
- Les mêmes routes pour `locations` et `actions`
- `POST /api/{characters|locations|actions}/{id}/images` pour ajouter une image
- `DELETE /api/{characters|locations|actions}/{id}/images/{filename}` pour retirer une image
- `GET/POST /api/templates`, `PUT/DELETE /api/templates/{id}`
- `POST /api/build` avec `template_id` et les tableaux `character_ids`, `location_ids`, `action_ids` (dans l'ordre des emplacements)

Les images acceptées sont JPG, PNG, WEBP et GIF (8 Mo maximum).
