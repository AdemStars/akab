import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "http://127.0.0.1:4000"
DEMO_PREFIX = "DEMO AKAB LOCAL:"


def load_env(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def api_request(path, payload=None, token=None, method=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API {error.code} sur {path}: {details}") from error


def seed(env):
    login = api_request(
        "/api/auth/login",
        {
            "email": env.get("ADMIN_DEFAULT_EMAIL", "admin@akab.local"),
            "password": env.get("ADMIN_DEFAULT_PASSWORD", ""),
        },
    )
    token = login["token"]
    query = urlencode({"status": "validated", "search": DEMO_PREFIX})
    existing = api_request(f"/api/admin/signals?{query}", token=token)["signals"]
    existing_titles = {signal["title"] for signal in existing}

    now = datetime.now(timezone.utc)
    examples = [
        {
            "title": f"{DEMO_PREFIX} manifestation fictive",
            "description": "Exemple entièrement inventé pour essayer AKAB en local. Ne décrit aucun fait réel.",
            "incidentType": "violence_physique",
            "eventType": "demonstration",
            "eventName": "Mouvement fictif de démonstration",
            "victimAgeGroup": "minor",
            "latitude": 48.8566123,
            "longitude": 2.3522456,
            "city": "Paris",
            "department": "75",
        },
        {
            "title": f"{DEMO_PREFIX} rassemblement fictif",
            "description": "Données synthétiques locales sans lien avec une personne ou un événement réel.",
            "incidentType": "violence_verbale",
            "eventType": "rally",
            "eventName": "Rassemblement fictif",
            "latitude": 48.8588123,
            "longitude": 2.3493456,
            "city": "Paris",
            "department": "75",
        },
        {
            "title": f"{DEMO_PREFIX} mouvement fictif sans victime renseignée",
            "description": "Cas de démonstration sans donnée personnelle et sans média joint.",
            "incidentType": "autre",
            "eventType": "strike",
            "eventName": "Mouvement fictif de démonstration",
            "latitude": 48.8549123,
            "longitude": 2.3581456,
            "city": "Paris",
            "department": "75",
        },
    ]

    created_ids = []
    for index, example in enumerate(examples):
        if example["title"] in existing_titles:
            continue
        incident_date = (now - timedelta(days=index + 1)).isoformat()
        report = {
            **example,
            "incidentDate": incident_date,
            "victimAgeGroup": example.get("victimAgeGroup", "unknown"),
            "locationAccuracyMeters": 5.0 + index,
            "address": "Lieu fictif de démonstration",
            "gdprConsent": True,
        }
        result = api_request("/api/signals", report)
        signal_id = result["signalId"]
        api_request(
            f"/api/admin/signals/{signal_id}/validate",
            {"force": True},
            token,
            "PATCH",
        )
        created_ids.append(signal_id)

    if not created_ids:
        print(f"{len(existing)} exemple(s) de démonstration existent déjà ; aucun doublon créé.")
        return

    print("Exemples fictifs publiés pour les essais locaux :")
    for signal_id in created_ids:
        print(f"  {signal_id}")
    print("Ils sont repérables par le titre « DEMO AKAB LOCAL: ».")
    print("Pour les retirer sans toucher aux autres signalements : bash scripts/local.sh reset-demo")


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "seed":
        raise SystemExit("Usage : demo_data.py seed PATH_TO_ENV_FILE")
    seed(load_env(sys.argv[2]))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, KeyError) as error:
        print(f"Erreur pendant la préparation des exemples : {error}", file=sys.stderr)
        raise SystemExit(1)
