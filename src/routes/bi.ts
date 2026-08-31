import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { BI_BEACON_PATH, handleBiBeacon } from "../bi";

const biRoutes = new Hono<AppEnv>();
biRoutes.post(BI_BEACON_PATH, handleBiBeacon);
export default biRoutes;
