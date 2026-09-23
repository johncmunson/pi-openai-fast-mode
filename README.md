# pi-openai-fast-mode

Pi package that adds a Fast Mode toggle for OpenAI GPT 5.4 and newer models.

<img style="width: 100%; height: auto;" alt="fast mode" src="https://raw.githubusercontent.com/johncmunson/pi-openai-fast-mode/refs/heads/main/preview-img.png" />

## Features

- Registers `/fast [on|off|toggle]`.
- Registers `--fast` to enable Fast Mode at startup.
- Injects `service_tier: "priority"` into matching OpenAI/OpenAI-Codex provider payloads.
- Shows a compact right-aligned TUI `fast` indicator only when enabled and the current model is configured.
- Persists state in user or project scope depending on how the package is loaded.

> View on the [Pi Package Registry](https://pi.dev/packages/pi-openai-fast-mode)

## Install

```bash
pi install npm:pi-openai-fast-mode
# or project-local
pi install -l npm:pi-openai-fast-mode
```

For local development:

```bash
pi -e ./src/index.ts
```

## Usage

```text
/fast          # toggle
/fast toggle   # toggle
/fast on       # enable
/fast off      # disable
```

Start Pi with Fast Mode enabled and persisted:

```bash
pi --fast
```

## Default configuration

Fast Mode starts disabled and applies to OpenAI GPT model IDs version 5.4 or newer. The version rule includes named variants such as `gpt-6-luna` and `gpt-6-sol`, preview or dated variants, and future numbered GPT versions without requiring an extension update. It applies to the `openai` and `openai-codex` providers.

```json
{
  "enabled": false,
  "targets": [
    { "provider": "openai", "model": "gpt-5.4+", "serviceTier": "priority" },
    { "provider": "openai-codex", "model": "gpt-5.4+", "serviceTier": "priority" }
  ]
}
```

The `+` suffix denotes a GPT model version range: `gpt-5.4+` matches version 5.4 and later, including model-name suffixes. On startup, saved targets are refreshed to the current defaults, including `serviceTier: "priority"`, while preserving the enabled state.

User-scoped state is stored under `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`.
Project-scoped state is stored under `./.pi/pi-openai-fast-mode/config.json`.

## Development

```bash
npm install
npm run check
```
