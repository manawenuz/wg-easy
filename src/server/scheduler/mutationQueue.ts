import debug from 'debug';
import { getEngine } from '../engines/registry';

const MQ_DEBUG = debug('MutationQueue');

export async function enqueueMutation(
  interfaceId: string,
  clientId: number | undefined,
  payload: object
) {
  await Database.pendingMutations.enqueue(interfaceId, 'syncInterface', payload, clientId);
}

export async function runMutationQueue() {
  const now = new Date();
  const due = await Database.pendingMutations.getDue(now);
  if (due.length === 0) return;

  MQ_DEBUG(`Processing ${due.length} pending mutation(s)`);

  for (const mutation of due) {
    const newAttempts = mutation.attempts + 1;
    try {
      const iface = await Database.interfaces.get();
      const engine = getEngine(iface.engineType);
      const clients = await Database.clients.getAll();
      await engine.syncInterface(iface, clients);

      await Database.pendingMutations.markSuccess(mutation.id);
      await Database.auditLogs.create({
        action: 'engine.mutation.retry',
        target: { mutationId: mutation.id, interfaceId: mutation.interfaceId, attempts: newAttempts },
        result: 'ok',
      });
      MQ_DEBUG(`Mutation ${mutation.id} succeeded after ${newAttempts} attempt(s)`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      MQ_DEBUG(`Mutation ${mutation.id} failed (attempt ${newAttempts}): ${error}`);

      if (newAttempts >= Database.pendingMutations.maxAttempts) {
        await Database.pendingMutations.delete(mutation.id);
        await Database.auditLogs.create({
          action: 'engine.mutation.giveUp',
          target: { mutationId: mutation.id, interfaceId: mutation.interfaceId, attempts: newAttempts, error },
          result: 'error',
        });
        MQ_DEBUG(`Mutation ${mutation.id} gave up after ${newAttempts} attempts`);
      } else {
        await Database.pendingMutations.markFailure(mutation.id, newAttempts, error);
        await Database.auditLogs.create({
          action: 'engine.mutation.retry',
          target: { mutationId: mutation.id, interfaceId: mutation.interfaceId, attempts: newAttempts, error },
          result: 'error',
        });
      }
    }
  }
}
