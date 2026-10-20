import { escapeHtml } from "./format";

export function publicNavigation(current?: "status" | "history" | "subscribe") {
  return `<nav class="status-utilities" aria-label="Status page"><a href="/"${current === "status" ? ' aria-current="page"' : ""}>Status</a><a href="/history"${current === "history" ? ' aria-current="page"' : ""}>History</a><a class="subscribe-link" href="/#subscribe"${current === "subscribe" ? ' aria-current="page"' : ""}>Subscribe</a></nav>`;
}

export function publicMasthead(pageName: string, current?: "status" | "history" | "subscribe", tagline = "") {
  return `<header class="masthead"><div class="masthead-brand"><a class="brand" href="/"><img class="brand-logo" src="/assets/mark.svg" alt=""><span>${escapeHtml(pageName)}</span></a>${tagline ? `<p class="tagline">${escapeHtml(tagline)}</p>` : ""}</div>${publicNavigation(current)}</header>`;
}
