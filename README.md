# pi-openai-fast-mode

Pi package that adds a Fast Mode toggle for GPT-6-Astra, GPT-5.6, GPT-5.5, and GPT-5.4.

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

## Status events

Other extensions can read this session's live state through `pi.events`, without reading shared config files:

```ts
pi.events.on("pi-openai-fast-mode:status", (status) => {
  // Consume { enabled, active, provider, model } here.
});

pi.on("session_start", () => {
  pi.events.emit("pi-openai-fast-mode:request-status", undefined);
});
```

- `enabled`: whether the Fast Mode toggle is on.
- `active`: whether it is on **and** the current model matches a configured target.
- `provider` and `model`: current provider and model ID, or `undefined` when no model is selected.

Status is published after startup, successful `/fast` commands, model changes, and status requests, including without a TUI. Requests before initialization or after shutdown receive no response; unavailable status is not the same as disabled. Register the listener during extension setup so it receives the startup event regardless of session-handler order.

## Default configuration

Fast Mode starts disabled and only applies to exact configured provider/model pairs:

```json
{
  "enabled": false,
  "targets": [
    { "provider": "openai", "model": "gpt-5.4", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-5.5", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-5.6", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-5.6-sol", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-5.6-terra", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-5.6-luna", "serviceTier": "priority" },
    { "provider": "openai", "model": "gpt-6-astra", "serviceTier": "priority" },
    {
      "provider": "openai-codex",
      "model": "gpt-5.4",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-5.5",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-5.6",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-5.6-terra",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "serviceTier": "priority"
    },
    {
      "provider": "openai-codex",
      "model": "gpt-6-astra",
      "serviceTier": "priority"
    }
  ]
}
```

On startup, saved targets are refreshed to the current defaults, including `serviceTier: "priority"`, while preserving the enabled state.

User-scoped state is stored under `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`.
Project-scoped state is stored under `./.pi/pi-openai-fast-mode/config.json`.

## Development

```bash
npm install
npm run check
```
