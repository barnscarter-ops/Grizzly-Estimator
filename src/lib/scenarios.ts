import type { ProjectIntakeInput } from "@/lib/types";

export function getSeedProjectInputs(): ProjectIntakeInput[] {
  return [
    {
      id: "lakewood-patio-receptacles",
      title: "Back patio receptacle add with outdoor GFCI protection",
      customer: {
        name: "Lakewood Patio Residence",
        email: "patio@example.com",
        phone: "(214) 555-0146",
        address: "412 Lakewood Drive, Dallas, TX",
      },
      propertyType: "single_family",
      projectType: "residential",
      projectSubtype: "receptacle_add",
      scopeDescription:
        "Add two outdoor receptacles near the smoker station and replace one weathered device by the patio door.",
      blueprintIncluded: false,
      notes: [
        "Customer wants weather-resistant devices and covers.",
        "Keep trenching off this quote unless hidden damage is found.",
      ],
      attachments: [
        {
          id: "lakewood-video",
          kind: "video",
          name: "lakewood-patio-walkthrough.mov",
          sizeLabel: "128 MB",
          uploadStatus: "complete",
          progress: 100,
        },
        {
          id: "lakewood-note",
          kind: "note",
          name: "Customer note summary",
          sizeLabel: "2 KB",
          uploadStatus: "complete",
          progress: 100,
        },
      ],
      transcriptSegments: [
        {
          id: "lakewood-seg-1",
          speaker: "Estimator",
          timestamp: "00:08",
          text: "We need one new GFCI on the left wall by the smoker and another by the patio table.",
        },
        {
          id: "lakewood-seg-2",
          speaker: "Estimator",
          timestamp: "00:27",
          text: "The existing device at the back door looks weathered, so I want that replaced while we are here.",
        },
      ],
      requestedActions: [
        {
          id: "patio-gfci",
          area: "Patio",
          label: "Add new receptacle",
          quantity: 2,
          keywords: ["Add New Receptacle", "Replace GFCI Receptacle"],
        },
        {
          id: "back-door-device",
          area: "Patio Door",
          label: "Replace weathered device",
          quantity: 1,
          keywords: ["Replace Switch / Receptacle", "Replace GFCI Receptacle"],
        },
      ],
    },
    {
      id: "wilson-kitchen-remodel",
      title: "Kitchen + living room remodel rough-in and finish",
      customer: {
        name: "Wilson Remodel",
        email: "wilson@example.com",
        phone: "(469) 555-0194",
        address: "1038 Berkshire Lane, Frisco, TX",
      },
      propertyType: "single_family",
      projectType: "residential",
      projectSubtype: "full_remodel",
      scopeDescription:
        "Full kitchen remodel with new island receptacles, under-cabinet lighting prep, living room wafer lights, and one updated fan install.",
      blueprintIncluded: true,
      notes: [
        "Cabinet plan available from designer.",
        "Homeowner wants clean, customer-friendly proposal language.",
      ],
      attachments: [
        {
          id: "wilson-video",
          kind: "video",
          name: "wilson-remodel-walkthrough.mov",
          sizeLabel: "402 MB",
          uploadStatus: "complete",
          progress: 100,
        },
        {
          id: "wilson-blueprint",
          kind: "blueprint",
          name: "kitchen-revision-b.pdf",
          sizeLabel: "11 MB",
          uploadStatus: "complete",
          progress: 100,
        },
      ],
      transcriptSegments: [
        {
          id: "wilson-seg-1",
          speaker: "Estimator",
          timestamp: "00:14",
          text: "New island gets two pop-up receptacles, then we are adding six wafers in the living room and dining zone.",
        },
        {
          id: "wilson-seg-2",
          speaker: "Estimator",
          timestamp: "00:31",
          text: "Existing fan comes down and the new owner provided fan goes back up in the same location.",
        },
      ],
      requestedActions: [
        {
          id: "island-receptacles",
          area: "Kitchen",
          label: "Add island receptacles",
          quantity: 3,
          keywords: ["Add New Receptacle", "Replace Switch / Receptacle"],
        },
        {
          id: "living-wafer-lights",
          area: "Living Room",
          label: "Install new wafer lights",
          quantity: 8,
          needsMeasurement: true,
          keywords: ["Install New LED Slim Can Light", "Add New Switch and Fixture"],
        },
        {
          id: "dining-fixture-switch",
          area: "Dining",
          label: "Add fixture switchleg",
          quantity: 1,
          keywords: ["Add New Switch and Fixture", "Replace Light Fixture"],
        },
        {
          id: "fan-reinstall",
          area: "Primary Bedroom",
          label: "Replace ceiling fan",
          quantity: 1,
          ownerProvided: true,
          keywords: ["Ceiling Fan"],
        },
      ],
    },
    {
      id: "midtown-office-lighting",
      title: "Tenant office lighting refresh and controls cleanup",
      customer: {
        name: "Midtown Advisory Office",
        email: "office@example.com",
        phone: "(972) 555-0102",
        address: "1912 Commerce Street, Dallas, TX",
        company: "Midtown Advisory",
      },
      propertyType: "office",
      projectType: "commercial",
      projectSubtype: "lighting_install",
      scopeDescription:
        "Replace recessed fixtures with downlights, add a switched fixture in the conference room, and confirm spacing from reflected ceiling plan.",
      blueprintIncluded: true,
      notes: [
        "Office manager expects alternate schedule options after approval.",
      ],
      attachments: [
        {
          id: "midtown-video",
          kind: "video",
          name: "midtown-office.mov",
          sizeLabel: "266 MB",
          uploadStatus: "complete",
          progress: 100,
        },
        {
          id: "midtown-blueprint",
          kind: "blueprint",
          name: "lighting-plan.pdf",
          sizeLabel: "6 MB",
          uploadStatus: "complete",
          progress: 100,
        },
      ],
      transcriptSegments: [
        {
          id: "midtown-seg-1",
          speaker: "Estimator",
          timestamp: "00:11",
          text: "We have six existing cans in the open office and need to verify spacing before switching everything to wafers.",
        },
        {
          id: "midtown-seg-2",
          speaker: "Estimator",
          timestamp: "00:38",
          text: "Conference room gets one new switched fixture with an added switchleg from existing power.",
        },
      ],
      requestedActions: [
        {
          id: "office-downlights",
          area: "Open Office",
          label: "Replace recessed lighting with downlights",
          quantity: 6,
          needsMeasurement: true,
          keywords: ["Replace Recessed Lighting", "Install New LED Slim Can Light"],
        },
        {
          id: "conference-switchleg",
          area: "Conference Room",
          label: "Add switch and fixture",
          quantity: 1,
          needsMeasurement: true,
          keywords: ["Add New Switch and Fixture", "Replace Light Fixture"],
        },
      ],
    },
    {
      id: "breadline-oven-circuit",
      title: "Dedicated 60A oven circuit for light commercial bakery",
      customer: {
        name: "Breadline Bakery",
        email: "ops@breadline.example.com",
        phone: "(214) 555-0168",
        address: "611 Main Street, McKinney, TX",
        company: "Breadline Bakery",
      },
      propertyType: "restaurant",
      projectType: "commercial",
      projectSubtype: "circuit_add",
      scopeDescription:
        "Add a dedicated oven circuit from the rear electrical room to prep line equipment with disconnect review.",
      blueprintIncluded: false,
      notes: [
        "Equipment cut sheet still pending from vendor.",
      ],
      attachments: [
        {
          id: "breadline-video",
          kind: "video",
          name: "breadline-oven-circuit.mov",
          sizeLabel: "188 MB",
          uploadStatus: "complete",
          progress: 100,
        },
      ],
      transcriptSegments: [
        {
          id: "breadline-seg-1",
          speaker: "Estimator",
          timestamp: "00:18",
          text: "This oven is sixty amp, so we have to confirm breaker and conductor size before it can be sent out.",
        },
      ],
      requestedActions: [
        {
          id: "oven-circuit",
          area: "Prep Line",
          label: "Install dedicated oven circuit",
          quantity: 1,
          feet: 85,
          amps: 60,
          needsMeasurement: true,
          keywords: ["Install New 15/20a Circuit", "Replace Breaker", "Custom Job"],
        },
      ],
    },
  ];
}
