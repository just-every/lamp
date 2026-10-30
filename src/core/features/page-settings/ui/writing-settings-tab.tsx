import type { SettingsForm } from "./settings-form";
import { AiAssistanceCard, type AiStatus } from "./ai-assistance-card";
import { WordingSettings } from "./wording-settings";

export function WritingSettingsTab({ settings, aiStatus, update }: {
  settings: SettingsForm; aiStatus: { data: AiStatus | null; loading: boolean; error: string | null };
  update: <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => void;
}) {
  return <>
    <AiAssistanceCard toneInstructions={settings.aiToneInstructions} status={aiStatus.data} loading={aiStatus.loading} error={aiStatus.error} onToneInstructionsChange={value => update("aiToneInstructions", value)} />
    <WordingSettings terms={settings.wordingBlockedTerms} friendlyLength={settings.wordingFriendlyLength} onTermsChange={value => update("wordingBlockedTerms", value)} onLengthChange={value => update("wordingFriendlyLength", value)} />
  </>;
}
