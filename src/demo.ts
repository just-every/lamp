import type { AppBindings } from './core/app/types';
import { seedDemoRecords } from './core/features/demo/repository';
import { createApp } from './core/app/server';
import { prepareAppMailBindings } from './core/app/mail';

/** Base invokes this only in a disposable demo after establishing its owner. */
export async function seedDemo(env: AppBindings, context: { ownerEmail: string; now: Date }): Promise<void> {
  await seedDemoRecords(env.DB, { ...context, pageHost: env.LAMP_PAGE_HOST, from: env.MAIL_FROM_ADDRESS });
  // Build real retained public HTML/feed/widget artifacts in this demo's R2.
  await createApp(await prepareAppMailBindings(env, 'background'), 'background').services.publicSnapshots.rebuild();
}
