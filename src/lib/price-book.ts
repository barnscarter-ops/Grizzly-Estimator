import "server-only";

import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import type { PriceBookEntry } from "@/lib/types";

const DEFAULT_PRICE_BOOK_PATH =
  process.env.PRICE_BOOK_PATH ??
  "C:\\Users\\carte\\Documents\\Grizzly Business Documents\\2026 Price Book.csv";

const FALLBACK_PRICE_BOOK: PriceBookEntry[] = [
  {
    id: "add-new-receptacle",
    category: "Install",
    name: "Add New Receptacle",
    description:
      "Add new receptacle from existing circuit less than 15' away. Includes box, device, and trim.",
    price: 209,
    cost: 0,
    sourceLabel: "Fallback seed",
  },
  {
    id: "install-new-circuit",
    category: "Install",
    name: "Install New 15/20a Circuit (Up to 50')",
    description:
      "Install new branch circuit with breaker, cable, box, receptacle, and labor.",
    price: 397,
    cost: 182.25,
    sourceLabel: "Fallback seed",
  },
  {
    id: "replace-light-fixture",
    category: "Install",
    name: "Replace Light Fixture (owner provided fixture)",
    description:
      "Remove old fixture and install new owner-provided fixture in same location.",
    price: 119,
    cost: 0,
    sourceLabel: "Fallback seed",
  },
  {
    id: "ceiling-fan",
    category: "Install",
    name: "Ceiling Fan (up to 12' ceiling)",
    description: "Demo and install owner-provided ceiling fan at same location.",
    price: 199,
    cost: 0,
    sourceLabel: "Fallback seed",
  },
  {
    id: "wafer-light",
    category: "Install",
    name: "Install New LED Slim Can Light (Open Access)",
    description:
      "Install new slim can light with switchleg and fixture labor allowance.",
    price: 129,
    cost: 40,
    sourceLabel: "Fallback seed",
  },
];

function parseCurrency(value: string) {
  return Number(value.replaceAll("$", "").replaceAll(",", "").trim() || "0");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function loadFromCsv(csvPath: string) {
  const file = readFileSync(csvPath, "utf8");
  const [headerLine, ...rows] = file.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);

  return rows
    .map((row) => parseCsvLine(row))
    .map((values) => {
      const record = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );

      return {
        id: record.uuid,
        category: record.category,
        name: record.name,
        description: record.description,
        price: parseCurrency(record.price),
        cost: parseCurrency(record.cost),
        sourceLabel: "Grizzly price book",
      } satisfies PriceBookEntry;
    })
    .filter((entry) => entry.name);
}

export const getPriceBookEntries = cache(async () => {
  if (!existsSync(DEFAULT_PRICE_BOOK_PATH)) {
    return FALLBACK_PRICE_BOOK;
  }

  try {
    return loadFromCsv(DEFAULT_PRICE_BOOK_PATH);
  } catch {
    return FALLBACK_PRICE_BOOK;
  }
});
