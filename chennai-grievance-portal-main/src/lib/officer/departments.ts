/**
 * Department officer dashboards: one template, configured per department.
 *
 * Name, head, organisation and escalation route come from the intelligence store
 * (`ref_departments`, built by the pipeline from district_intel/reference/departments.yaml).
 * This file holds only what the store does not: the short label used in card titles,
 * the portal department (users.department_id) that maps to the code, and an example
 * completion remark for the report form. A department missing here still gets a
 * dashboard with the defaults below. Safe to import from client components.
 */

export interface DeptConfig {
  /** short label for card titles, e.g. "SWM Grievance Map" */
  short: string;
  /** `departments.name` in the portal database, for officers registered through the portal */
  portalName?: string;
  /** example shown in the completion report's remarks box */
  remarkHint?: string;
}

export const DEPT_CONFIG: Record<string, DeptConfig> = {
  "GCC-SWD": { short: "SWD", portalName: "Storm Water Drain Department",
    remarkHint: "Surface water cleared with 2 suction pumps; storm-water drain inlet de-silted and road reopened to traffic." },
  "GCC-SWM": { short: "SWM", portalName: "Solid Waste Management Department",
    remarkHint: "Accumulated waste cleared (about 3 tonnes) and the area disinfected; pickup frequency raised to twice daily." },
  "GCC-ENG": { short: "Roads", portalName: "Engineering Department (Town Planning & Building Permissions)",
    remarkHint: "Pothole filled with hot-mix, surface compacted and the stretch reopened; barricades removed." },
  "GCC-ELE": { short: "Electrical", portalName: "Electrical Department",
    remarkHint: "Faulty fittings replaced on 12 poles; feeder pillar cable re-insulated and supply restored." },
  "GCC-HLT": { short: "Health", portalName: "Health Department",
    remarkHint: "Fever camp held, fogging done across 4 streets and blood samples sent for testing." },
  "GCC-PRK": { short: "Parks", portalName: "Parks & Play Fields Department",
    remarkHint: "Fallen tree cut and cleared; branches removed from the footpath and the road reopened." },
  "GCC-REV": { short: "Revenue", portalName: "Revenue Department" },
  "GCC-GAD": { short: "Admin", portalName: "General Administration" },
  "GCC-BRG": { short: "Bridges", portalName: "Bridges Department",
    remarkHint: "Subway pumped dry, expansion joint sealed and the subway reopened to traffic." },
  "GCC-EDU": { short: "Education", portalName: "Education Department" },
  "GCC-BLD": { short: "Buildings", portalName: "Buildings Department" },
  "GCC-MEC": { short: "Mechanical", portalName: "Mechanical Engineering Department" },
  "GCC-LND": { short: "Estate", portalName: "Land & Estate Department" },
  "GCC-FMU": { short: "FMU", portalName: "Financial Management Unit" },
  "GCC-CNL": { short: "Council", portalName: "Council Department" },
  "GCC-FWD": { short: "Family Welfare", portalName: "Family Welfare Department" },
  "POL-GCP": { short: "Police",
    remarkHint: "Signal repaired with the electricity team; traffic personnel deployed at peak hours." },
  "PWD-WRD": { short: "PWD",
    remarkHint: "Breach in the bund closed with sandbags; surplus course cleared and water level back below the warning mark." },
  "PWD-BLD": { short: "PWD Buildings" },
  "HLT-DMS": { short: "Hospitals",
    remarkHint: "Arranged 100 beds at the UPHC; additional doctors posted for the outpatient rush." },
  "CMWSSB": { short: "Metrowater",
    remarkHint: "Damaged pipeline section replaced; supply restored and water quality tested satisfactory." },
  "TANGEDCO": { short: "TANGEDCO",
    remarkHint: "Faulty cable joint replaced at the distribution transformer; supply restored to the street." },
  "TNPCB": { short: "TNPCB" },
  "DIST-DM": { short: "Disaster Mgmt",
    remarkHint: "Affected families shifted to the relief centre; food packets and relief kits issued." },
  "DIST-REV": { short: "Revenue",
    remarkHint: "Site inspected by the VAO; debris cleared, affected families shifted and relief issued." }
};

export const DEFAULT_REMARK_HINT =
  "What was done on site, by whom, and what the residents will notice now (e.g. debris cleared and the road reopened).";

export function deptConfig(code: string): DeptConfig & { remarkHint: string } {
  const c = DEPT_CONFIG[code];
  return { short: c?.short ?? code.replace(/^(GCC|PWD|POL|HLT|DIST)-/, ""), portalName: c?.portalName, remarkHint: c?.remarkHint ?? DEFAULT_REMARK_HINT };
}

/** Intelligence-store code for an officer registered in the portal with a GCC department. */
export function codeForPortalDept(portalName: string | null | undefined): string | null {
  if (!portalName) return null;
  const hit = Object.entries(DEPT_CONFIG).find(([, c]) => c.portalName === portalName);
  return hit ? hit[0] : null;
}

/** Tunables of the officer console, in one place. */
export const OFFICER = {
  /** period shown when the console opens (daily | weekly | monthly | quarterly) */
  defaultPeriod: "monthly",
  newsItems: 8,
  feedbackItems: 8,
  areaBars: 6,
  mapPins: 300,
  minRemarks: 5,
  maxRemarks: 2000,
  maxPhotos: 8,
  /** after resizing in the browser a photo is ~150 KB; this is the server's hard limit per file */
  maxPhotoBytes: 5 * 1024 * 1024,
  /** longest side of an uploaded photo after resizing in the browser */
  photoMaxPx: 1280,
  pollMs: 60_000
} as const;
