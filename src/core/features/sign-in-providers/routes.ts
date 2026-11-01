import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../app/types";
import type { SignInService } from "./service";
import { SIGN_IN_PROVIDERS, SignInError, type SignInProviderId } from "./types";

const person = z.object({ operatorId: z.string("person_invalid").min(1, "person_invalid").max(64, "person_invalid"), subject: z.string("person_invalid").max(255, "person_invalid") }).strict();
const clientId = z.string("client_id_required").trim().min(1, "client_id_required").max(512, "client_id_required");
const clientSecret = z.string("client_secret_required").max(4096, "client_secret_required").optional();
const googleInput = z.object({ clientId, clientSecret }).strict();
const oktaInput = z.object({ domain: z.string("domain_required").max(512, "domain_invalid"), clientId, clientSecret, people: z.array(person).max(200, "person_invalid") }).strict();
const peopleInput = z.object({ people: z.array(person).max(200, "person_invalid") }).strict();
const providerSchema = z.enum(SIGN_IN_PROVIDERS);

/** Every refusal is `{error: code}`. A Base refusal (`owner_required`, `step_up_required`) keeps its own code and
 * status; anything else is a plain 503 that carries no detail, so no value the owner typed can come back out. */
function refuse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof SignInError) return c.json({ error: error.code }, error.status);
  const base = error as { code?: unknown; status?: unknown };
  if (typeof base?.code === "string" && typeof base.status === "number" && base.status >= 400 && base.status < 600) return c.json({ error: base.code }, base.status as 400);
  return c.json({ error: "sign_in_unavailable" }, 503);
}

export function registerSignInRoutes(app: Hono<AppEnv>, service: SignInService) {
  const guarded = (c: Context<AppEnv>, run: () => Promise<unknown>) => run().then(async () => {
    c.header("Cache-Control", "no-store");
    return c.json(await service.status(c.req.raw));
  }, error => refuse(c, error));
  const provider = (c: Context<AppEnv>): SignInProviderId | null => {
    const parsed = providerSchema.safeParse(c.req.param("provider"));
    return parsed.success ? parsed.data : null;
  };
  const body = async <T extends z.ZodType>(c: Context<AppEnv>, schema: T) => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? { value: parsed.data as z.infer<T> } : { error: /^[a-z_]+$/.test(parsed.error.issues[0]?.message ?? "") ? parsed.error.issues[0].message : "invalid_input" };
  };

  app.get("/api/app/sign-in", c => guarded(c, async () => {}));
  app.put("/api/app/sign-in/google", async c => {
    const input = await body(c, googleInput);
    if ("error" in input) return c.json({ error: input.error }, 400);
    return guarded(c, () => service.save(c.req.raw, c.get("operator").id, "google", input.value));
  });
  app.put("/api/app/sign-in/okta", async c => {
    const input = await body(c, oktaInput);
    if ("error" in input) return c.json({ error: input.error }, 400);
    return guarded(c, () => service.save(c.req.raw, c.get("operator").id, "okta", input.value));
  });
  app.put("/api/app/sign-in/okta/people", async c => {
    const input = await body(c, peopleInput);
    if ("error" in input) return c.json({ error: input.error }, 400);
    return guarded(c, () => service.savePeople(c.req.raw, c.get("operator").id, "okta", input.value.people));
  });
  app.delete("/api/app/sign-in/:provider", c => {
    const id = provider(c);
    if (!id) return c.json({ error: "not_found" }, 404);
    return guarded(c, () => service.disconnect(c.req.raw, c.get("operator").id, id));
  });
}
