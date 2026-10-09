import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/incidents")({ component: Outlet });
