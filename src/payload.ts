import {
  DEFAULT_SERVICE_TIER,
  SUPPORTED_PROVIDERS,
  type FastModeConfig,
  type FastTarget,
  type ModelRef,
} from "./types";

const SUPPORTED_PROVIDER_SET = new Set<string>(SUPPORTED_PROVIDERS);
// Numbered aliases are runtime provider IDs; persisted targets stay canonical.
const NUMBERED_CODEX_PROVIDER = /^openai-codex-[0-9]+(?![\s\S])/;

function canonicalizeProvider(provider: string): string | undefined {
  if (SUPPORTED_PROVIDER_SET.has(provider)) return provider;
  if (NUMBERED_CODEX_PROVIDER.test(provider)) return "openai-codex";
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toModelRef(model: unknown): ModelRef | undefined {
  if (!isRecord(model)) return undefined;

  const { provider, id } = model;
  if (typeof provider !== "string" || typeof id !== "string") return undefined;
  if (!provider || !id) return undefined;

  return { provider, id };
}

export function isSupportedProvider(provider: string): boolean {
  return canonicalizeProvider(provider) !== undefined;
}

export function findMatchingTarget(
  model: ModelRef | undefined,
  targets: FastTarget[],
): FastTarget | undefined {
  if (!model) return undefined;

  const provider = canonicalizeProvider(model.provider);
  if (!provider) return undefined;

  return targets.find(
    (target) =>
      target.provider === provider &&
      target.model === model.id &&
      SUPPORTED_PROVIDER_SET.has(target.provider),
  );
}

export function applyFastModePayload(
  payload: unknown,
  serviceTier: string,
): unknown | undefined {
  if (!isRecord(payload)) return undefined;

  return {
    ...payload,
    service_tier: serviceTier || DEFAULT_SERVICE_TIER,
  };
}

export function getFastModePayload(
  config: FastModeConfig,
  model: ModelRef | undefined,
  payload: unknown,
): unknown | undefined {
  if (!config.enabled) return undefined;

  const target = findMatchingTarget(model, config.targets);
  if (!target) return undefined;

  return applyFastModePayload(
    payload,
    target.serviceTier ?? DEFAULT_SERVICE_TIER,
  );
}
