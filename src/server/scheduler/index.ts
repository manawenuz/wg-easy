import debug from 'debug';
import { runExpirationEnforcer } from './expirationEnforcer';
import { runUsagePoller } from './usagePoller';
import { runQuotaEvaluator } from './quotaEvaluator';
import { runPeriodResetter } from './periodResetter';
import { runUsageRollup } from './usageRollup';
import { runReconciler } from './reconciler';
import { runMutationQueue } from './mutationQueue';

const SCHEDULER_DEBUG = debug('Scheduler');

function setIntervalImmediately(callback: () => void | Promise<void>, ms: number) {
  void callback();
  return setInterval(() => {
    void callback();
  }, ms);
}

export function startScheduler() {
  SCHEDULER_DEBUG('Starting scheduler...');

  // Poll usage every 60 seconds
  setIntervalImmediately(async () => {
    try {
      await runUsagePoller();
      // Run quota evaluator immediately after polling
      await runQuotaEvaluator();
    } catch (err) {
      SCHEDULER_DEBUG('Usage poller/evaluator error:', err);
    }
  }, 60_000);

  // Reset expired quota periods every 60 seconds
  setIntervalImmediately(async () => {
    try {
      await runPeriodResetter();
    } catch (err) {
      SCHEDULER_DEBUG('Period resetter error:', err);
    }
  }, 60_000);

  // Auto-disable expired clients every 60 seconds
  setIntervalImmediately(async () => {
    try {
      await runExpirationEnforcer();
    } catch (err) {
      SCHEDULER_DEBUG('Expiration enforcer error:', err);
    }
  }, 60_000);

  // Roll up old usage samples every hour
  setIntervalImmediately(async () => {
    try {
      await runUsageRollup();
    } catch (err) {
      SCHEDULER_DEBUG('Usage rollup error:', err);
    }
  }, 60 * 60_000);

  // Drain mutation retry queue every 15 seconds
  setIntervalImmediately(async () => {
    try {
      await runMutationQueue();
    } catch (err) {
      SCHEDULER_DEBUG('Mutation queue error:', err);
    }
  }, 15_000);

  // Reconcile engine state every 5 minutes
  setIntervalImmediately(async () => {
    try {
      await runReconciler();
    } catch (err) {
      SCHEDULER_DEBUG('Reconciler error:', err);
    }
  }, 300_000);

  SCHEDULER_DEBUG('Scheduler started');
}
