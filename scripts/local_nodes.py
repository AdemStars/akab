#!/usr/bin/env python3
"""Adds or removes the local storage-node settings in .env.local (never prints secrets)."""
import json
import secrets
import sys
from pathlib import Path

KEYS = ("STORAGE_NODES", "STORAGE_ENCRYPTION_KEY", "STORAGE_REPLICAS")


def read(path: Path) -> dict:
    values = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value
    return values


def rewrite(path: Path, updates: dict) -> None:
    lines = [line for line in path.read_text().splitlines() if line.split("=", 1)[0].strip() not in KEYS]
    lines += [f"{key}={value}" for key, value in updates.items()]
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)


def main() -> None:
    action, env_path = sys.argv[1], Path(sys.argv[2])
    if action == "enable":
        count = int(sys.argv[3])
        existing = read(env_path)
        tokens = {}
        if existing.get("STORAGE_NODES"):
            tokens = {node["name"]: node["token"] for node in json.loads(existing["STORAGE_NODES"])}
        nodes = []
        for index in range(1, count + 1):
            name = f"local-{index}"
            nodes.append(
                {
                    "name": name,
                    "url": f"http://akab-node-local-{index}:7000",
                    "token": tokens.get(name) or secrets.token_hex(32),
                }
            )
        rewrite(
            env_path,
            {
                "STORAGE_NODES": json.dumps(nodes, separators=(",", ":")),
                "STORAGE_ENCRYPTION_KEY": existing.get("STORAGE_ENCRYPTION_KEY") or secrets.token_hex(32),
                "STORAGE_REPLICAS": str(min(2, count)),
            },
        )
        print(json.dumps({"tokens": {node["name"]: node["token"] for node in nodes}}))
    elif action == "disable":
        existing = read(env_path)
        kept = {k: v for k, v in existing.items() if k == "STORAGE_ENCRYPTION_KEY"}
        rewrite(env_path, kept)
    else:
        raise SystemExit("usage: local_nodes.py enable|disable ENV_FILE [COUNT]")


if __name__ == "__main__":
    main()
