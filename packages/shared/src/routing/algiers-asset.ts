import roads from "../../assets/algiers-roads.json";
import type { RoadGraphAsset } from "./build";

/**
 * The committed Algiers road graph. A separate module on purpose: it is not exported from the package index,
 * so only code that really routes pays for the 0.9 MB file (the web app loads it lazily).
 */
export default roads as unknown as RoadGraphAsset;
