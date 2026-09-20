import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFastModeExtension } from "../src/index";
import {
  DEFAULT_CONFIG,
  getProjectConfigPath,
  getUserConfigPath,
} from "../src/config";
import { STATUS_KEY } from "../src/types";

type FakePi = {
  events: ReturnType<typeof createEventBus>;
  registerFlag: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  getFlag: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

type RegisteredCommand = {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-openai-fast-mode-ext-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function createFakePi(fastFlag = false): {
  pi: FakePi;
  handlers: Map<string, Function[]>;
  commands: Map<string, RegisteredCommand>;
} {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, RegisteredCommand>();

  const pi: FakePi = {
    events: createEventBus(),
    registerFlag: vi.fn(),
    registerCommand: vi.fn((name: string, options: RegisteredCommand) => {
      commands.set(name, options);
    }),
    getFlag: vi.fn((name: string) => (name === "fast" ? fastFlag : undefined)),
    on: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
  };

  return { pi, handlers, commands };
}

function makeCtx(
  cwd: string,
  model: { provider: string; id: string } | undefined = undefined,
) {
  return {
    cwd,
    model,
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
    },
  };
}

type TestContext = ReturnType<typeof makeCtx>;

function expectFastIndicatorShown(ctx: TestContext): void {
  expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
  expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(
    STATUS_KEY,
    expect.any(Function),
    { placement: "belowEditor" },
  );

  const factory = ctx.ui.setWidget.mock.calls.at(-1)?.[1];
  expect(factory).toBeTypeOf("function");
  expect((factory as Function)().render(8)).toEqual(["    fast"]);
}

function expectFastIndicatorHidden(ctx: TestContext): void {
  expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(STATUS_KEY, undefined);
  expect(ctx.ui.setWidget).toHaveBeenLastCalledWith(STATUS_KEY, undefined, {
    placement: "belowEditor",
  });
}

async function runHandler(
  handlers: Map<string, Function[]>,
  eventName: string,
  event: unknown,
  ctx: unknown,
) {
  const handler = handlers.get(eventName)?.[0];
  expect(handler, `missing ${eventName} handler`).toBeTypeOf("function");
  return await handler!(event, ctx);
}

describe("piFastModeExtension registration", () => {
  it("registers the fast flag, fast command, and lifecycle hooks", () => {
    const { pi, handlers, commands } = createFakePi();

    createPiFastModeExtension({
      extensionDir: "/global/pi-openai-fast-mode/src",
      agentDir: "/agent",
    })(pi as any);

    expect(pi.registerFlag).toHaveBeenCalledWith("fast", {
      description: "Start with Fast Mode enabled",
      type: "boolean",
      default: false,
    });
    expect(commands.has("fast")).toBe(true);
    expect(commands.get("fast")?.description).toContain(
      "/fast [on|off|toggle]",
    );

    expect([...handlers.keys()].sort()).toEqual([
      "before_provider_request",
      "model_select",
      "session_shutdown",
      "session_start",
    ]);
  });
});

describe("piFastModeExtension runtime behavior", () => {
  it.each([true, false])("publishes live status with hasUI=%s", async (hasUI) => {
    const root = await makeTempDir();
    const agentDir = join(root, "agent");
    const { pi, handlers, commands } = createFakePi(true);
    const status = vi.fn();
    pi.events.on("pi-openai-fast-mode:status", status);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as unknown as ExtensionAPI);
    const ctx = { ...makeCtx(root, { provider: "openai", id: "gpt-5.4" }), hasUI };
    const active = {
      enabled: true, active: true, provider: "openai", model: "gpt-5.4",
    };

    // No default or stale state while startup has not completed.
    pi.events.emit("pi-openai-fast-mode:request-status", undefined);
    await runHandler(handlers, "model_select", { model: ctx.model }, ctx);
    expect(status).not.toHaveBeenCalled();

    await runHandler(handlers, "session_start", {}, ctx);
    expect(status).toHaveBeenCalledExactlyOnceWith(active);

    // Another process can change shared config without changing this session.
    await writeFile(
      getUserConfigPath(agentDir),
      JSON.stringify({ ...DEFAULT_CONFIG, enabled: false }),
    );
    status.mockClear();
    pi.events.emit("pi-openai-fast-mode:request-status", undefined);
    expect(status).toHaveBeenCalledExactlyOnceWith(active);

    await commands.get("fast")!.handler("off", ctx);
    expect(status).toHaveBeenLastCalledWith({
      ...active, enabled: false, active: false,
    });
    await commands.get("fast")!.handler("on", ctx);
    expect(status).toHaveBeenLastCalledWith(active);

    const unsupported = { provider: "openai", id: "gpt-4" };
    await runHandler(handlers, "model_select", { model: unsupported }, ctx);
    expect(status).toHaveBeenLastCalledWith({
      ...active, active: false, model: "gpt-4",
    });
    await runHandler(handlers, "model_select", { model: ctx.model }, ctx);
    expect(status).toHaveBeenLastCalledWith(active);
    await runHandler(handlers, "model_select", {}, { ...ctx, model: undefined });
    expect(status).toHaveBeenLastCalledWith({
      enabled: true, active: false, provider: undefined, model: undefined,
    });

    await runHandler(handlers, "session_shutdown", {}, ctx);
    status.mockClear();
    pi.events.emit("pi-openai-fast-mode:request-status", undefined);
    expect(status).not.toHaveBeenCalled();
    expect(ctx.ui.notify).not.toHaveBeenCalled();
    if (!hasUI) expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });

  it("refreshes persisted fast targets to priority on startup without changing enabled", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const configPath = getUserConfigPath(agentDir);
    await mkdir(join(agentDir, "extensions", "pi-openai-fast-mode"), {
      recursive: true,
    });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        enabled: true,
        targets: [
          { provider: "openai", model: "gpt-5.4", serviceTier: "fast" },
        ],
      }),
      "utf8",
    );

    const { pi, handlers } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      enabled: true,
      targets: DEFAULT_CONFIG.targets,
    });
    expect(
      await runHandler(
        handlers,
        "before_provider_request",
        { type: "before_provider_request", payload: { model: "gpt-5.4" } },
        ctx,
      ),
    ).toEqual({ model: "gpt-5.4", service_tier: "priority" });
  });

  it("--fast enables, persists, shows status, and mutates matching payloads", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expectFastIndicatorShown(ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });

    const mutated = await runHandler(
      handlers,
      "before_provider_request",
      {
        type: "before_provider_request",
        payload: { model: "gpt-5.4", messages: [] },
      },
      ctx,
    );

    expect(mutated).toEqual({
      model: "gpt-5.4",
      messages: [],
      service_tier: "priority",
    });
  });

  it("/fast, /fast on, and /fast toggle persist expected enabled states", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await commands.get("fast")!.handler("", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    expectFastIndicatorShown(ctx);

    await commands.get("fast")!.handler("toggle", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: false,
    });
    expectFastIndicatorHidden(ctx);

    await commands.get("fast")!.handler("on", ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    expectFastIndicatorShown(ctx);
  });

  it("/fast off persists disabled state and hides status", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await commands.get("fast")!.handler("off", ctx);

    expectFastIndicatorHidden(ctx);
    expect(
      JSON.parse(await readFile(getUserConfigPath(agentDir), "utf8")),
    ).toMatchObject({
      enabled: false,
    });

    const unchanged = await runHandler(
      handlers,
      "before_provider_request",
      { type: "before_provider_request", payload: { model: "gpt-5.4" } },
      ctx,
    );

    expect(unchanged).toBeUndefined();
  });

  it("invalid /fast arguments notify usage without changing state", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers, commands } = createFakePi(false);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );
    await commands.get("fast")!.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /fast [on|off|toggle]",
      "error",
    );
    expectFastIndicatorHidden(ctx);
  });

  it("project-local package installs persist to project state instead of user state", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    const extensionDir = join(cwd, ".pi", "npm", "pi-openai-fast-mode", "src");
    await mkdir(extensionDir, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({ extensionDir, agentDir })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai-codex", id: "gpt-5.5" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expect(
      JSON.parse(await readFile(getProjectConfigPath(cwd), "utf8")),
    ).toMatchObject({
      enabled: true,
    });
    await expect(
      readFile(getUserConfigPath(agentDir), "utf8"),
    ).rejects.toThrow();
  });

  it("model_select updates whether the status is visible", async () => {
    const root = await makeTempDir();
    const cwd = join(root, "project");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });

    const { pi, handlers } = createFakePi(true);
    createPiFastModeExtension({
      extensionDir: join(root, "global", "pi-openai-fast-mode", "src"),
      agentDir,
    })(pi as any);

    const ctx = makeCtx(cwd, { provider: "openai", id: "gpt-5.4" });
    await runHandler(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx,
    );

    await runHandler(
      handlers,
      "model_select",
      { type: "model_select", model: { provider: "openai", id: "gpt-4" } },
      { ...ctx, model: { provider: "openai", id: "gpt-4" } },
    );

    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      STATUS_KEY,
      expect.any(Function),
      { placement: "belowEditor" },
    );
    expectFastIndicatorHidden(ctx);
  });
});
