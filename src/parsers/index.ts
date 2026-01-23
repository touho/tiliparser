import type { ParserResult } from "../core/model";
import { parseNordeaCsv } from "./nordea";

export type SupportedBank = "nordea";

export function parseTransactions(bank: SupportedBank, text: string): ParserResult {
  switch (bank) {
    case "nordea":
      return parseNordeaCsv(text);
    default:
      return { transactions: [], warnings: [`Unsupported bank: ${bank}`] };
  }
}
