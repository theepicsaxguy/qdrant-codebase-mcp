from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from qdrant_codebase_mcp_launcher.launcher import (
    RuntimeMetadata,
    SourceMetadata,
    build_project,
    compute_cache_key,
    git_commit_sha,
    prepare_source_checkout,
    require_command,
    runtime_metadata_path,
    resolve_source_metadata,
    sanitize_git_url,
)


class UvxLauncherTests(unittest.TestCase):
    def test_sanitize_git_url_removes_prefix(self) -> None:
        self.assertEqual(
            sanitize_git_url("git+https://github.com/example/repo.git"),
            "https://github.com/example/repo.git",
        )

    def test_require_command_raises_for_missing_binary(self) -> None:
        with patch("qdrant_codebase_mcp_launcher.launcher.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Required command not found"):
                require_command("node")

    def test_resolve_source_metadata_prefers_environment_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir)
        with patch.dict(
            "os.environ",
            {
                "QDRANT_CODEBASE_MCP_SOURCE_URL": "git+https://github.com/example/repo.git",
                "QDRANT_CODEBASE_MCP_SOURCE_COMMIT": "abc123",
            },
            clear=False,
        ):
            metadata = resolve_source_metadata(source_root)

        self.assertEqual(metadata, SourceMetadata("https://github.com/example/repo.git", "abc123"))

    def test_resolve_source_metadata_reads_direct_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir)
            direct_url = Path(temp_dir) / "direct_url.json"
            direct_url.write_text(
                json.dumps(
                    {
                        "url": "git+https://github.com/example/repo.git",
                        "vcs_info": {"commit_id": "def456"},
                    }
                ),
                encoding="utf-8",
            )

            with patch(
                "qdrant_codebase_mcp_launcher.launcher.find_direct_url_path",
                return_value=direct_url,
            ):
                metadata = resolve_source_metadata(source_root)

        self.assertEqual(metadata, SourceMetadata("https://github.com/example/repo.git", "def456"))

    def test_prepare_source_checkout_clones_and_checks_out_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir) / "cache"
            with patch("qdrant_codebase_mcp_launcher.launcher.subprocess.run") as run:
                source_dir = prepare_source_checkout(
                    cache_dir,
                    SourceMetadata("https://github.com/example/repo.git", "abc123"),
                    Path(temp_dir) / "source-root",
                )

        self.assertEqual(source_dir, cache_dir / "source")
        run.assert_any_call(
            ["git", "clone", "https://github.com/example/repo.git", str(cache_dir / "source")],
            check=True,
        )

    def test_compute_cache_key_uses_git_sha_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_dir = Path(temp_dir)
            (source_dir / ".git").mkdir()

            with patch(
                "qdrant_codebase_mcp_launcher.launcher.subprocess.run",
                return_value=unittest.mock.Mock(returncode=0, stdout="abc123\n"),
            ):
                self.assertEqual(git_commit_sha(source_dir), "abc123")
                self.assertEqual(compute_cache_key(source_dir), "abc123")

    def test_build_project_reuses_existing_dist(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_dir = Path(temp_dir)
            (source_dir / "node_modules").mkdir(exist_ok=True)
            entrypoint = source_dir / "dist" / "mcp-entry.js"
            entrypoint.parent.mkdir(parents=True, exist_ok=True)
            entrypoint.write_text("// built", encoding="utf-8")
            (source_dir / "package.json").write_text("{}", encoding="utf-8")
            (source_dir / "package-lock.json").write_text("{}", encoding="utf-8")
            (source_dir / "tsconfig.json").write_text("{}", encoding="utf-8")
            (source_dir / "src").mkdir(parents=True, exist_ok=True)
            (source_dir / "src" / "mcp-entry.ts").write_text("// source", encoding="utf-8")
            runtime_metadata_path(source_dir).write_text(
                '{"arch":"x64","node_modules_abi":"127","node_version":"v22.0.0","platform":"linux"}',
                encoding="utf-8",
            )

            with patch(
                "qdrant_codebase_mcp_launcher.launcher.resolve_runtime_metadata",
                return_value=RuntimeMetadata(
                    node_version="v22.0.0",
                    node_modules_abi="127",
                    platform="linux",
                    arch="x64",
                ),
            ):
                with patch("qdrant_codebase_mcp_launcher.launcher.subprocess.run") as run:
                    result = build_project(source_dir, "npm", "node")

        self.assertEqual(result, entrypoint)
        run.assert_not_called()

    def test_build_project_reinstalls_when_node_runtime_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_dir = Path(temp_dir)
            (source_dir / "node_modules").mkdir(exist_ok=True)
            entrypoint = source_dir / "dist" / "mcp-entry.js"
            entrypoint.parent.mkdir(parents=True, exist_ok=True)
            entrypoint.write_text("// built", encoding="utf-8")
            runtime_metadata_path(source_dir).write_text(
                '{"arch":"x64","node_modules_abi":"115","node_version":"v20.0.0","platform":"linux"}',
                encoding="utf-8",
            )

            def run_side_effect(*args, **kwargs):
                command = args[0]
                if command == ["npm", "ci"]:
                    (source_dir / "node_modules").mkdir(exist_ok=True)
                    return unittest.mock.Mock(returncode=0)
                if command == ["npm", "run", "build"]:
                    entrypoint.parent.mkdir(parents=True, exist_ok=True)
                    entrypoint.write_text("// rebuilt", encoding="utf-8")
                    return unittest.mock.Mock(returncode=0)
                return unittest.mock.Mock(returncode=0)

            with patch(
                "qdrant_codebase_mcp_launcher.launcher.resolve_runtime_metadata",
                return_value=RuntimeMetadata(
                    node_version="v22.0.0",
                    node_modules_abi="127",
                    platform="linux",
                    arch="x64",
                ),
            ):
                with patch(
                    "qdrant_codebase_mcp_launcher.launcher.subprocess.run",
                    side_effect=run_side_effect,
                ) as run:
                    result = build_project(source_dir, "npm", "node")
                    metadata = runtime_metadata_path(source_dir).read_text(encoding="utf-8")

            self.assertEqual(result, entrypoint)
            run.assert_any_call(["npm", "ci"], cwd=source_dir, check=True)
            run.assert_any_call(["npm", "run", "build"], cwd=source_dir, check=True)
            self.assertIn('"node_version": "v22.0.0"', metadata)


if __name__ == "__main__":
    unittest.main()
