import type { SenderStatus } from "../../overview/live-status";
import { relativeTime } from "../../../app/client/ui/relative-time";

/** The mail sender, checked by Lamp on its own: shown as a fact, never as a task. */
export function SenderStatusLine({ sender }: { sender: SenderStatus | null }) {
  if (!sender) return null;
  if (sender.state === "local") return null;
  if (sender.state === "verified") return <p className="sender-status is-ok"><span className="live-dot" />Sender verified by your mail provider{sender.checkedAt ? `, checked ${relativeTime(sender.checkedAt)}` : ""}.</p>;
  if (sender.state === "failed") return <p className="sender-status is-failing" role="status"><span className="live-dot" />{sender.message}</p>;
  return <p className="sender-status">Lamp checks this sender with your mail provider after you confirm.</p>;
}
