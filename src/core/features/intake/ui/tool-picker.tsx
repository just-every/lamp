import { Button } from "../../../app/client/ui/button";
import { TOOLS, type ToolId } from "./tools";

/** "Connect a tool": the tools Lamp reads, by name. Choosing one opens only that tool's form. */
export function ToolPicker({ onPick }: { onPick: (tool: ToolId) => void }) {
  return <section className="data-card tool-picker" aria-labelledby="tool-picker-title">
    <h2 id="tool-picker-title">Connect a tool</h2>
    <ul className="tool-choices">{TOOLS.map(tool => <li key={tool.id}><Button type="button" variant="secondary" onClick={() => onPick(tool.id)}>{tool.pick}</Button></li>)}</ul>
  </section>;
}
