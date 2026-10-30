import type { SVGProps } from "react";

export type IconName = "plus" | "overview" | "page" | "incident" | "components" | "maintenance" | "subscribers" | "settings" | "external" | "arrow" | "back" | "chevron" | "check" | "warning" | "clock" | "close"
  | "bell" | "pen" | "brush" | "code" | "person" | "chart" | "arrow-in" | "refresh" | "shield" | "link" | "template";

const paths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  page: "M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01",
  incident: "M12 3 21 20H3L12 3Zm0 6v4m0 3h.01",
  components: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5zM10 7.5h4M7.5 10v4M16.5 10v4",
  maintenance: "M14.7 6.3a5 5 0 0 0-6.9 6.9L3 18l3 3 4.8-4.8a5 5 0 0 0 6.9-6.9l-3 3-2.4-2.4 2.4-3.6Z",
  subscribers: "M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 2 18.5V20m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1.5a3.5 3.5 0 0 1 0 6.8M22 20v-1.5a4.5 4.5 0 0 0-3-4.25",
  settings: "M12 15.3a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Zm0-12.3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
  external: "M14 4h6v6m0-6-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6",
  arrow: "m9 18 6-6-6-6M3 12h12",
  back: "m15 18-6-6 6-6",
  chevron: "m9 18 6-6-6-6",
  check: "m5 12 4 4L19 6",
  warning: "M12 3 21 20H3L12 3Zm0 6v4m0 3h.01",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  close: "m6 6 12 12M18 6 6 18",
  bell: "M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9Zm4.3 11a2 2 0 0 0 3.4 0",
  pen: "m14.5 5.5 4 4M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z",
  brush: "m9.5 12.5 8.6-8.6a2.1 2.1 0 1 1 3 3l-8.6 8.6M7 14.5c-1.7 0-3 1.4-3 3.1 0 1.4-1.5 1.6-1.5 2.1C3.6 20.8 5 21.5 6.5 21.5c2.2 0 4-1.8 4-4a3 3 0 0 0-3.5-3Z",
  code: "m17 16 4-4-4-4M7 8l-4 4 4 4M14 4l-4 16",
  person: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  chart: "M6 20v-6M12 20V6M18 20v-9",
  "arrow-in": "M3 12h13m-5-6 6 6-6 6M21 5v14",
  refresh: "M3 12a9 9 0 0 1 15.4-6.4L21 8m0-5v5h-5m5 4a9 9 0 0 1-15.4 6.4L3 16m0 5v-5h5",
  shield: "M12 3 4.5 6v5.5c0 4.6 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.9 7.5-9.5V6L12 3Z",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L11.8 5.2M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  template: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
