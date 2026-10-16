const external = { target: "_blank", rel: "noreferrer" } as const;

/** Where the owner gets the webhook URL. Saving a URL sends nothing; Send test post checks it. */
export function ChannelSetupGuide({ kind }: { kind: "slack" | "teams" }) {
  return <details className="setup-guide">
    <summary>How to get the {kind === "slack" ? "Slack" : "Teams"} webhook URL</summary>
    {kind === "slack" ? <ol>
      <li>Open <a href="https://api.slack.com/apps" {...external}>Your Slack apps</a>. Choose <strong>Create New App</strong> → <strong>From scratch</strong>, name it (for example “Status updates”) and pick your workspace.</li>
      <li>In the app, open <strong>Incoming Webhooks</strong>, switch it on, then choose <strong>Add New Webhook</strong>. Pick the channel and choose <strong>Allow</strong>. Your workspace admin may need to approve it.</li>
      <li>Copy the URL that starts with <code>https://hooks.slack.com/services/</code> and paste it below. <a href="https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/" {...external}>Slack’s guide</a></li>
    </ol> : <ol>
      <li>In Teams, open the channel’s <strong>⋯</strong> menu, choose <strong>Workflows</strong>, and pick the template <strong>Send webhook alerts to a channel</strong>. Not the “from specific people” or “from people in an org” versions: Lamp cannot sign in to Microsoft.</li>
      <li>Choose the team and channel, then <strong>Save</strong>. Teams opens the workflow’s details page.</li>
      <li>Copy the webhook URL from that page and paste it below. <a href="https://support.microsoft.com/en-us/workflows/send-messages-in-teams-using-incoming-webhooks" {...external}>Microsoft’s guide</a></li>
    </ol>}
    <p>Then name the channel, choose its components, select <strong>Add channel</strong>, and use <strong>Send test post</strong> beside it. Success: a “Test post from Lamp” message appears in that channel.</p>
  </details>;
}
