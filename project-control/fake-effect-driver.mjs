import { EffectObservation } from "./domain.mjs";

/**
 * Deterministic external-effect seam for G3 tests.
 *
 * mode:
 *   success   -> confirmed external success
 *   no_effect -> confirmed that no external mutation happened
 *   unknown   -> outcome cannot be established
 *   throw     -> transport/process failure; Controller must persist UNKNOWN
 */
export class FakeEffectDriver {
  constructor({
    mode = "success",
    reconcileOutcome = EffectObservation.UNKNOWN,
    provider = "fake-provider",
  } = {}) {
    this.modes = Array.isArray(mode) ? [...mode] : [mode];
    this.reconcileOutcome = reconcileOutcome;
    this.provider = provider;
    this.dispatched = [];
    this.reconciled = [];
  }

  async dispatch(effect) {
    this.dispatched.push({
      effectId: effect.id,
      status: effect.status,
      dispatchCount: effect.dispatchCount,
      idempotencyKey: effect.idempotencyKey,
    });
    const mode = this.modes.length > 1 ? this.modes.shift() : this.modes[0];

    if (mode === "throw") {
      throw new Error("fake effect transport failure");
    }
    if (mode === "unknown") {
      return { outcome: EffectObservation.UNKNOWN };
    }
    if (mode === "no_effect") {
      return {
        outcome: EffectObservation.CONFIRMED_NO_EFFECT,
        observationRef: `fake-observation://${effect.id}/no-effect`,
      };
    }
    return {
      outcome: EffectObservation.CONFIRMED_SUCCEEDED,
      observationRef: `fake-observation://${effect.id}/success`,
      receipt: {
        provider: this.provider,
        receiptId: `receipt-${effect.id}-${effect.dispatchCount}`,
        resultRef: `fake-result://${effect.id}`,
      },
    };
  }

  async reconcile(effect) {
    this.reconciled.push({
      effectId: effect.id,
      status: effect.status,
      dispatchCount: effect.dispatchCount,
    });

    if (this.reconcileOutcome === EffectObservation.CONFIRMED_SUCCEEDED) {
      return {
        outcome: EffectObservation.CONFIRMED_SUCCEEDED,
        observationRef: `fake-reconcile://${effect.id}/success`,
        receipt: {
          provider: this.provider,
          receiptId: `reconciled-${effect.id}`,
          resultRef: `fake-result://${effect.id}/reconciled`,
        },
      };
    }
    if (this.reconcileOutcome === EffectObservation.CONFIRMED_NO_EFFECT) {
      return {
        outcome: EffectObservation.CONFIRMED_NO_EFFECT,
        observationRef: `fake-reconcile://${effect.id}/no-effect`,
      };
    }
    return {
      outcome: EffectObservation.UNKNOWN,
      observationRef: `fake-reconcile://${effect.id}/unknown`,
    };
  }
}
