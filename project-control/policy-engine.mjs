import { PolicyEffect } from "./domain.mjs";

const PRECEDENCE = Object.freeze({
  [PolicyEffect.ALLOW]: 1,
  [PolicyEffect.REQUIRE_APPROVAL]: 2,
  [PolicyEffect.DENY]: 3,
});

/**
 * Small deterministic reference policy engine for G4.
 *
 * Rules are exact-match constraints over durable Command dimensions. Multiple
 * matching rules compose with DENY > REQUIRE_APPROVAL > ALLOW.
 * No match defaults to DENY.
 */
export class StaticPolicyEngine {
  constructor({
    version = "static-v1",
    defaultEffect = PolicyEffect.DENY,
    rules = [],
  } = {}) {
    if (typeof version !== "string" || version.trim() === "") {
      throw new Error("policy engine requires a non-empty version");
    }
    if (!Object.values(PolicyEffect).includes(defaultEffect)) {
      throw new Error(`unknown default policy effect: ${defaultEffect}`);
    }
    this.version = version;
    this.defaultEffect = defaultEffect;
    this.rules = rules.map((rule, index) => normalizeRule(rule, index));
  }

  evaluate({ command, target, context = {} } = {}) {
    if (!command?.id || !target?.id) throw new Error("policy evaluation requires command and target");

    const request = {
      subject: { id: command.requestedBy },
      command: {
        id: command.id,
        version: command.version,
        targetType: command.targetType,
        targetId: command.targetId,
        targetVersion: command.targetVersion,
        action: command.action,
        capability: command.capability,
        scope: command.scope,
        riskLevel: command.riskLevel,
      },
      resource: { currentVersion: target.version },
      context: structuredClone(context ?? {}),
      policyVersion: this.version,
    };

    const matched = this.rules.filter((rule) => matches(rule, request));
    const effect = matched.length
      ? matched.reduce(
          (winner, rule) => PRECEDENCE[rule.effect] > PRECEDENCE[winner] ? rule.effect : winner,
          PolicyEffect.ALLOW,
        )
      : this.defaultEffect;

    return {
      request,
      effect,
      policyVersion: this.version,
      reasons: matched.length
        ? matched.filter((rule) => rule.effect === effect).map((rule) => rule.reason)
        : ["no policy rule matched; default applied"],
      matchedRuleIds: matched.map((rule) => rule.id),
    };
  }
}

function normalizeRule(rule, index) {
  if (!rule || typeof rule !== "object") throw new Error(`policy rule ${index} must be an object`);
  const id = rule.id ?? `rule-${index + 1}`;
  if (typeof id !== "string" || id.trim() === "") throw new Error("policy rule requires id");
  if (!Object.values(PolicyEffect).includes(rule.effect)) {
    throw new Error(`policy rule ${id} has unknown effect: ${rule.effect}`);
  }
  return Object.freeze({
    id,
    effect: rule.effect,
    reason: typeof rule.reason === "string" && rule.reason.trim() ? rule.reason : `matched ${id}`,
    subjectId: rule.subjectId ?? null,
    targetType: rule.targetType ?? null,
    action: rule.action ?? null,
    capability: rule.capability ?? null,
    scope: rule.scope ?? null,
    riskLevel: rule.riskLevel ?? null,
  });
}

function matches(rule, request) {
  const command = request.command;
  return (
    (rule.subjectId == null || rule.subjectId === request.subject.id) &&
    (rule.targetType == null || rule.targetType === command.targetType) &&
    (rule.action == null || rule.action === command.action) &&
    (rule.capability == null || rule.capability === command.capability) &&
    (rule.scope == null || rule.scope === command.scope) &&
    (rule.riskLevel == null || rule.riskLevel === command.riskLevel)
  );
}
