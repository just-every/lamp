import type { AppBindings } from './core/app/types';
import { seedDemoRecords } from './core/features/demo/repository';
import { senderEvidenceKey } from './core/features/overview/sender-check';
import { createApp } from './core/app/server';
import { notificationOrigin, prepareAppMailBindings } from './core/app/mail';

/** Base invokes this only in a disposable demo after establishing its owner. */
export async function seedDemo(env: AppBindings, context: { ownerEmail: string; now: Date }): Promise<void> {
  // Demo mail is a local transport, so the sender check's evidence is the local key.
  const readiness = { sender: await senderEvidenceKey(env.MAIL_FROM_ADDRESS, { local: true, provider: env.MAIL_PROVIDER ?? 'resend' }), publicOrigin: await notificationOrigin(env) };
  await seedDemoRecords(env.DB, { ...context, pageHost: env.LAMP_PAGE_HOST, from: env.MAIL_FROM_ADDRESS, readiness });
  // Build real retained public HTML/feed/widget artifacts in this demo's R2.
  await createApp(await prepareAppMailBindings(env, 'background'), 'background').services.publicSnapshots.rebuild();
}
