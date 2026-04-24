import type {
  ProjectSubtype,
  ProjectType,
  PropertyType,
  RequestedAction,
} from "@/lib/types";

export const PROJECT_TYPE_OPTIONS: Array<{
  value: ProjectType;
  label: string;
}> = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial / light commercial" },
];

export const PROPERTY_TYPE_OPTIONS: Array<{
  value: PropertyType;
  label: string;
}> = [
  { value: "single_family", label: "Single-family home" },
  { value: "townhome", label: "Townhome / condo" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "restaurant", label: "Restaurant" },
];

export const PROJECT_SUBTYPE_TEMPLATES: Array<{
  value: ProjectSubtype;
  label: string;
  description: string;
}> = [
  {
    value: "full_remodel",
    label: "Full remodel",
    description: "Multi-area rough-in, trim, and fixture scope",
  },
  {
    value: "circuit_add",
    label: "Circuit addition",
    description: "New branch circuit, feeder, or dedicated equipment circuit",
  },
  {
    value: "receptacle_add",
    label: "Receptacle addition",
    description: "Add or replace plugs, GFCIs, and related device work",
  },
  {
    value: "lighting_install",
    label: "Lighting install",
    description: "Wafer lights, new fixtures, replacement lighting, and controls",
  },
  {
    value: "fan_replace",
    label: "Fan removal / install",
    description: "Replace or add owner-provided fan assemblies",
  },
];

export function buildTemplateActions(subtype: ProjectSubtype): RequestedAction[] {
  switch (subtype) {
    case "receptacle_add":
      return [
        {
          id: "new-receptacle",
          area: "Primary Area",
          label: "Add new receptacle",
          quantity: 2,
          keywords: ["Add New Receptacle", "Replace GFCI Receptacle"],
        },
      ];
    case "lighting_install":
      return [
        {
          id: "lighting-run",
          area: "Primary Area",
          label: "Install new lighting fixture",
          quantity: 6,
          needsMeasurement: true,
          keywords: ["Install New LED Slim Can Light", "Replace Recessed Lighting"],
        },
      ];
    case "fan_replace":
      return [
        {
          id: "fan-swap",
          area: "Primary Area",
          label: "Replace ceiling fan",
          quantity: 1,
          ownerProvided: true,
          keywords: ["Ceiling Fan"],
        },
      ];
    case "circuit_add":
      return [
        {
          id: "new-circuit",
          area: "Electrical Room",
          label: "Install dedicated circuit",
          quantity: 1,
          feet: 50,
          amps: 20,
          needsMeasurement: true,
          keywords: ["Install New 15/20a Circuit", "Replace Breaker"],
        },
      ];
    case "full_remodel":
    default:
      return [
        {
          id: "kitchen-receptacles",
          area: "Kitchen",
          label: "Add receptacles and trim devices",
          quantity: 5,
          keywords: ["Add New Receptacle", "Replace Switch / Receptacle"],
        },
        {
          id: "wafer-lights",
          area: "Living Room",
          label: "Install new wafer lights",
          quantity: 6,
          needsMeasurement: true,
          keywords: ["Install New LED Slim Can Light", "Add New Switch and Fixture"],
        },
      ];
  }
}
