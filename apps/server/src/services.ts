import { createAuth } from "@solvex-dergana/auth";
import { createDb } from "@solvex-dergana/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
