import secrets
import sys
from pathlib import Path


destination = Path(sys.argv[1])
existing_volume = sys.argv[2] == "true"
admin_password = (
    "AdminSecurePassword123!"
    if existing_volume
    else secrets.token_urlsafe(24)
)
jwt_secret = secrets.token_hex(32)

destination.write_text(
    "\n".join(
        [
            "PORT=4000",
            "NODE_ENV=development",
            f"JWT_SECRET={jwt_secret}",
            "CORS_ORIGIN=http://localhost:3000",
            "IPFS_FALLBACK_LOCAL=true",
            "ADMIN_DEFAULT_EMAIL=admin@akab.local",
            f"ADMIN_DEFAULT_PASSWORD={admin_password}",
            "ADMIN_DEFAULT_NAME=Admin AKAB",
            "",
        ]
    ),
    encoding="utf-8",
)

print(f"Configuration locale créée dans {destination}.")
print("Compte de test : admin@akab.local")
print(f"Mot de passe : {admin_password}")
if existing_volume:
    print(
        "Un volume de données existait déjà : le mot de passe affiché est celui "
        "du compte de démonstration initial. Si le compte a été modifié, adaptez "
        "ADMIN_DEFAULT_PASSWORD dans .env.local (cela ne réinitialise pas un compte existant)."
    )
else:
    print("Conservez ces identifiants ; le mot de passe n'est affiché qu'à la création.")
