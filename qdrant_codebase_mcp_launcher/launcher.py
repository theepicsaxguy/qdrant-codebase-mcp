from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceMetadata:
    url: str | None
    commit: str


@dataclass(frozen=True)
class RuntimeMetadata:
    node_version: str
    node_modules_abi: str | None
    platform: str
    arch: str


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] in {"-h", "--help"}:
        print("Usage: qdrant-codebase-mcp")
        print("Builds the Node source checkout and runs dist/mcp-entry.js.")
        return 0

    node = require_command("node")
    npm = require_command("npm")
    source_root = resolve_bundled_source_root()
    source = resolve_source_metadata(source_root)
    source_dir = prepare_source_checkout(resolve_cache_dir(source.commit), source, source_root)
    entrypoint = build_project(source_dir, npm, node)

    if os.environ.get("QDRANT_CODEBASE_MCP_LAUNCHER_DRY_RUN") == "1":
        print(json.dumps({"entrypoint": str(entrypoint), "source": asdict(source)}, sort_keys=True))
        return 0

    os.execvpe(node, [node, str(entrypoint)], os.environ.copy())


def require_command(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"Required command not found on PATH: {name}")

    return path


def resolve_bundled_source_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "package.json").exists() and (parent / "src" / "mcp-entry.ts").exists():
            return parent

    raise RuntimeError("Could not locate bundled Node source")


def resolve_source_metadata(source_root: Path | None = None) -> SourceMetadata:
    bundled_source_root = source_root or resolve_bundled_source_root()
    env_url = os.environ.get("QDRANT_CODEBASE_MCP_SOURCE_URL")
    env_commit = os.environ.get("QDRANT_CODEBASE_MCP_SOURCE_COMMIT")
    if env_url and env_commit:
        return SourceMetadata(url=sanitize_git_url(env_url), commit=env_commit)

    direct_url_path = find_direct_url_path()
    if direct_url_path is None:
        return SourceMetadata(url=None, commit=compute_cache_key(bundled_source_root))

    payload = json.loads(direct_url_path.read_text(encoding="utf-8"))
    url = payload.get("url")
    vcs_info = payload.get("vcs_info")
    commit = vcs_info.get("commit_id") if isinstance(vcs_info, dict) else None
    if not isinstance(url, str) or not isinstance(commit, str):
        return SourceMetadata(url=None, commit=compute_cache_key(bundled_source_root))

    return SourceMetadata(url=sanitize_git_url(url), commit=commit)


def find_direct_url_path() -> Path | None:
    dist_root = Path(__file__).resolve().parent.parent
    candidates = sorted(dist_root.glob("qdrant_codebase_mcp-*.dist-info/direct_url.json"))
    return candidates[0] if candidates else None


def sanitize_git_url(url: str) -> str:
    return url.removeprefix("git+")


def resolve_cache_dir(commit: str) -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "qdrant-codebase-mcp" / "uvx" / commit


def prepare_source_checkout(
    cache_dir: Path,
    source: SourceMetadata,
    source_root: Path | None = None,
) -> Path:
    source_dir = cache_dir / "source"
    if source.url is None:
        return prepare_local_copy(source_root or resolve_bundled_source_root(), source_dir)

    return prepare_git_checkout(source_dir, source)


def prepare_local_copy(source_root: Path, source_dir: Path) -> Path:
    if source_dir.exists():
        return source_dir

    source_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix="qdrant-codebase-mcp-", dir=source_dir.parent))
    try:
        shutil.copytree(source_root, staging_dir / "source", dirs_exist_ok=True)
        os.replace(staging_dir / "source", source_dir)
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)

    return source_dir


def prepare_git_checkout(source_dir: Path, source: SourceMetadata) -> Path:
    if source.url is None:
        raise RuntimeError("Git checkout requires a source URL")

    if not (source_dir / ".git").exists():
        source_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", source.url, str(source_dir)], check=True)

    subprocess.run(["git", "fetch", "origin", source.commit, "--depth", "1"], cwd=source_dir, check=True)
    subprocess.run(["git", "checkout", "--force", source.commit], cwd=source_dir, check=True)
    return source_dir


def build_project(source_dir: Path, npm: str, node: str) -> Path:
    entrypoint = source_dir / "dist" / "mcp-entry.js"
    runtime_metadata = resolve_runtime_metadata(node)
    if should_refresh_cached_runtime(source_dir, runtime_metadata):
        shutil.rmtree(source_dir / "node_modules", ignore_errors=True)
        shutil.rmtree(source_dir / "dist", ignore_errors=True)
        subprocess.run([npm, "ci"], cwd=source_dir, check=True)

    if not entrypoint.exists():
        subprocess.run([npm, "run", "build"], cwd=source_dir, check=True)

    if not entrypoint.exists():
        raise RuntimeError(f"Build completed without producing {entrypoint}")

    write_runtime_metadata(source_dir, runtime_metadata)
    return entrypoint


def compute_cache_key(source_root: Path) -> str:
    commit = git_commit_sha(source_root)
    if commit:
        return commit

    digest = hashlib.sha256()
    for relative_path in relevant_files():
        file_path = source_root / relative_path
        digest.update(relative_path.encode("utf-8"))
        digest.update(file_path.read_bytes())
    return digest.hexdigest()[:16]


def git_commit_sha(source_root: Path) -> str | None:
    if not (source_root / ".git").exists():
        return None

    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=source_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None

    return result.stdout.strip() or None


def relevant_files() -> list[str]:
    return ["package.json", "package-lock.json", "tsconfig.json", "src/mcp-entry.ts"]


def runtime_metadata_path(source_dir: Path) -> Path:
    return source_dir / ".qdrant-codebase-mcp-runtime.json"


def resolve_runtime_metadata(node: str) -> RuntimeMetadata:
    result = subprocess.run(
        [
            node,
            "-p",
            "JSON.stringify({nodeVersion:process.version,nodeModulesAbi:process.versions.modules ?? null,platform:process.platform,arch:process.arch})",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    return RuntimeMetadata(
        node_version=payload["nodeVersion"],
        node_modules_abi=payload["nodeModulesAbi"],
        platform=payload["platform"],
        arch=payload["arch"],
    )


def read_runtime_metadata(source_dir: Path) -> RuntimeMetadata | None:
    metadata_path = runtime_metadata_path(source_dir)
    if not metadata_path.exists():
        return None

    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    required_keys = {"node_version", "node_modules_abi", "platform", "arch"}
    if not isinstance(payload, dict) or not required_keys.issubset(payload):
        return None

    return RuntimeMetadata(
        node_version=payload["node_version"],
        node_modules_abi=payload["node_modules_abi"],
        platform=payload["platform"],
        arch=payload["arch"],
    )


def should_refresh_cached_runtime(source_dir: Path, current: RuntimeMetadata) -> bool:
    if not (source_dir / "node_modules").exists():
        return True

    cached = read_runtime_metadata(source_dir)
    return cached != current


def write_runtime_metadata(source_dir: Path, metadata: RuntimeMetadata) -> None:
    runtime_metadata_path(source_dir).write_text(
        json.dumps(asdict(metadata), sort_keys=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
