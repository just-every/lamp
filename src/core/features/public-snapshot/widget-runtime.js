function widgetRuntime(initial, allowedOrigins, defaultVariant) {
  const script = document.currentScript;
  if (!script || !allowedOrigins.includes(window.location.origin)) return;
  const variant = ["banner", "floating", "dot"].includes(script.dataset.variant ?? "")
    ? script.dataset.variant : defaultVariant;
  const position = ["top-left", "top-right", "bottom-left", "bottom-right"].includes(script.dataset.position ?? "")
    ? script.dataset.position : "bottom-right";
  const validColor = (value) => value && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value : null;
  const background = validColor(script.dataset.background);
  const color = validColor(script.dataset.color);
  const hideOperational = script.dataset.hideOperational === "true";
  const root = document.createElement("section");
  const dot = document.createElement("span");
  const label = document.createElement("strong");
  const detail = document.createElement("span");
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.style.cssText = 'box-sizing:border-box;font:400 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;border:1px solid rgba(24,45,36,.14);border-radius:12px;padding:14px 16px;color:#182d24;background:#fff;box-shadow:0 1px 2px rgba(24,45,36,.05);overflow-wrap:anywhere;text-align:left';
  dot.style.cssText = "flex:0 0 8px;width:8px;height:8px;border-radius:50%;align-self:center";
  dot.setAttribute("aria-hidden", "true");
  label.style.cssText = "font-weight:600";
  if (variant === "floating") {
    root.style.position = "fixed";
    root.style.zIndex = "2147483647";
    root.style.width = "min(360px, calc(100vw - 32px))";
    root.style.maxHeight = "calc(100vh - 32px)";
    root.style.overflowY = "auto";
    root.style.setProperty(position.startsWith("top") ? "top" : "bottom", "16px");
    root.style.setProperty(position.endsWith("left") ? "left" : "right", "16px");
  } else if (variant === "dot") {
    root.style.display = "inline-flex";
    root.style.padding = "4px 0";
    root.style.border = "0";
    root.style.borderRadius = "0";
    root.style.boxShadow = "none";
    root.style.background = "transparent";
  }
  if (background) root.style.backgroundColor = background;
  if (color) root.style.color = color;
  root.appendChild(dot);
  root.appendChild(label);
  root.appendChild(detail);

  const draw = (data) => {
    const incident = data.incident && data.incident.lifecycle !== "Resolved" ? data.incident : null;
    const maintenance = data.maintenance?.state === "In progress" ? data.maintenance : null;
    const active = Boolean(incident || maintenance);
    root.style.display = (variant === "floating" && !active) || (hideOperational && data.overall === "Operational")
      ? "none" : variant === "dot" ? "inline-flex" : "flex";
    dot.style.backgroundColor = ({ Operational: "#19865a", "Under maintenance": "#4f6fa8", "Degraded performance": "#c98a12" })[data.overall] ?? "#b44432";
    if (label.textContent !== data.overall) label.textContent = data.overall;
    const message = variant === "dot" ? "" : incident ? incident.message.replace(/\n\n+/g, "\n")
      : maintenance ? `${maintenance.reference}: ${maintenance.title}\n${maintenance.state}` : "";
    detail.style.cssText = message ? "flex:1 1 100%;min-width:0;margin-top:2px;border-top:1px solid rgba(24,45,36,.1);padding-top:10px;color:#44544c;white-space:pre-line" : "display:none";
    if (color) detail.style.color = color;
    if (detail.textContent !== message) detail.textContent = message;
  };
  draw(initial);
  script.parentNode?.insertBefore(root, script.nextSibling);
  const statusUrl = new URL("/api/public/status", script.src);
  let pending = false;
  const timer = window.setInterval(async () => {
    if (!root.isConnected) { window.clearInterval(timer); return; }
    if (pending) return;
    pending = true;
    try {
      const response = await fetch(statusUrl, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.version !== 1 || typeof data.overall !== "string") return;
      if (data.incident && (typeof data.incident.lifecycle !== "string" || typeof data.incident.message !== "string")) return;
      if (data.maintenance && (typeof data.maintenance.reference !== "string" || typeof data.maintenance.title !== "string" || typeof data.maintenance.state !== "string")) return;
      draw(data);
    } catch {
      // The last public snapshot remains visible when the public host cannot answer.
    } finally { pending = false; }
  }, 30_000);
}
