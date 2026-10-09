// The app composition root is the single core-to-extension configuration mount.
import { lampConfig } from "../../ext/config";

import type { PageSettingsInput } from "../shared/schemas";

export const initialPageSettings: PageSettingsInput = lampConfig;
