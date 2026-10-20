import type { SVGProps } from "react";

type IconName = "plus" | "overview" | "page" | "incident" | "components" | "maintenance" | "subscribers" | "deliveries" | "settings" | "external" | "arrow" | "check" | "warning" | "clock" | "close";

const paths: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  page: "M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01",
  incident: "M12 3 21 20H3L12 3Zm0 6v4m0 3h.01",
  components: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5zM10 7.5h4M7.5 10v4M16.5 10v4",
  maintenance: "M14.7 6.3a5 5 0 0 0-6.9 6.9L3 18l3 3 4.8-4.8a5 5 0 0 0 6.9-6.9l-3 3-2.4-2.4 2.4-3.6Z",
  subscribers: "M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 2 18.5V20m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1.5a3.5 3.5 0 0 1 0 6.8M22 20v-1.5a4.5 4.5 0 0 0-3-4.25",
  deliveries: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  settings: "M12 15.3a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Zm0-12.3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6",
  external: "M14 4h6v6m0-6-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6",
  arrow: "m9 18 6-6-6-6M3 12h12",
  check: "m5 12 4 4L19 6",
  warning: "M12 3 21 20H3L12 3Zm0 6v4m0 3h.01",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  close: "m6 6 12 12M18 6 6 18",
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
