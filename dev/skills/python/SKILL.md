---
name: python
description: Opinionated Python development conventions. Use when writing, editing, reviewing, or explaining Python code, package structure, type hints, docstrings, imports, comments, formatting, ruff/black configuration, pyproject.toml, or tests in Python repositories.
---

# Python Development

Use this skill for Python code and Python package work. Prefer existing project conventions when they conflict with these defaults.

## General Style

- Prefer procedural, modular code: small composable functions over large classes.
- Favor the standard library and lightweight dependencies over heavy frameworks.
- Use `pathlib` over `os.path`.
- Use `subprocess.run` over `os.system`.
- Prefer `match` statements over long `if`/`elif` chains when pattern matching and the project targets Python 3.10+.

## Type Hints

- Use strict type hints compatible with mypy/pyright.
- Annotate return types explicitly, including `-> None`.
- Use `from __future__ import annotations` when helpful for compatibility.
- Prefer built-in generics such as `list[int]` and `dict[str, Any]` over `typing.List` and `typing.Dict`.
- Use `Optional[X]` or `Union[X, Y]` instead of `X | None` or `X | Y` when the project needs older-version compatibility.

## Docstrings

- Use Google-style docstrings for public functions, classes, and modules.
- Skip docstrings on trivial private helpers.
- Do not generate boilerplate docstrings that only restate the signature.
- Include `Args`, `Returns`, `Raises`, and `Examples` only when they add useful information.

```python
from pathlib import Path


def render_frame(scene: Path, frame: int, *, output_dir: Path) -> Path:
    """Render a single frame of a scene.

    Args:
        scene: Path to the scene file.
        frame: Frame number to render.
        output_dir: Directory where the rendered image is written.

    Returns:
        Path to the rendered image.

    Raises:
        RenderError: If the render fails.
    """
```

## Comments

- Use comments to explain why, not what.
- Avoid trailing comments that restate the code.
- Avoid comments like `# Loop through items` or `# Return result`.
- Use `###### Comment` only as a sparse section separator between large, logically distinct blocks of code.
- Never use `######` for line-level explanation or small groups of statements.
- Do not mix separator styles: no `# ---`, `# === TITLE ===`, or banner boxes.

## Imports

- Group imports as built-in, third-party, then internal.
- Use absolute imports inside packages.
- Do not use wildcard imports.
- Import-group comments are allowed when they match the local style; otherwise prefer standard blank-line grouping.

## Formatting And Tooling

- Use `ruff` for linting and `black` for formatting.
- Use line length 80 unless the project config says otherwise.
- Use double quotes for strings, single quotes only when the string contains `"`.
- Treat `pyproject.toml` as the single source of truth for build and tool configuration when present.

## Project Layout

- Prefer `src/` layout for installable packages.
- Put tests in `tests/`, mirroring the package structure.

## Things To Avoid

- Do not add emojis to code, comments, commit messages, or logs.
- Do not add French accents to identifiers, paths, or filenames.
- Do not generate boilerplate docstrings that restate the signature.
- Do not pepper code with spacer comments or section banners.
- Do not add helpful extras that were not requested: unused imports, unused stubs, or example usage blocks.

