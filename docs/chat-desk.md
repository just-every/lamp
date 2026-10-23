# Incident commands in Slack and Teams

The incident desk accepts signed Slack commands and Teams activities from a linked operator. Drafts stay private. Preview shows the same update text as the operator app; Publish update is a separate action, attributed to the linked operator. Publishing sends the update to the status page. It does not select subscriber notifications.

## Connect your chat identity

The Settings control is not yet available. The signed-in operator's chat-link door can create a one-time code, list that operator's links and remove a link. A code expires after ten minutes. Send `/lamp link CODE` privately to the Slack app, or `link CODE` privately to the Teams bot. Lamp never links people by matching email addresses. Revoking an operator also removes their chat links.

## Prepare your own app

The repository includes [a Slack app manifest](chat-desk/slack-manifest.json) and [a Teams app manifest](chat-desk/teams-manifest.json). Replace the example hostname and the app identifier with your installation's values before registering them. Supply the Slack signing secret and the Teams bot app identifier through the installation's private configuration. A missing value leaves its command door unavailable.

Slack replies use the command's private HTTP response. Teams replies use an Adaptive Card invoke response. Lamp stores no Slack bot token and makes no Slack Web API call. The Teams password is reserved for registration; the incoming command desk does not use it.

## Current limits

These commands have been exercised with recorded request shapes and locally signed examples. No live Slack workspace or Teams tenant has been used. Workspace installation and the Settings control still need their own checks. Every linked operator currently has the same owner access as the operator app.

Link codes, preview approvals and replay receipts expire after ten minutes. Before transferring an installation, wait for them to expire. Chat links themselves travel with the installation's operator records; a restored operator must have active access before a chat action is accepted.
