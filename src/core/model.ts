export type TransactionDirection = "in" | "out";

export type Transaction = {
  id: string;
  date: Date | null;
  rawDate: string;
  amount: number;
  currency: string | null;
  direction: TransactionDirection;
  counterparty: string | null;
  name: string | null;
  title: string | null;
  message: string | null;
  reference: string | null;
  payer: string | null;
  payee: string | null;
  raw: Record<string, string>;
};

export type ParserResult = {
  transactions: Transaction[];
  warnings: string[];
};

export type RecurringFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type RecurringGroup = {
  key: string;
  direction: TransactionDirection;
  counterparty: string;
  amount: number;
  currency: string | null;
  occurrences: number;
  dates: Date[];
  firstDate: Date;
  lastDate: Date;
  amountMin: number;
  amountMax: number;
  amountSpreadPct: number;
  dayOfMonthMin: number;
  dayOfMonthMax: number;
  monthKeys: string[];
  activeMonths: number;
  spanMonths: number;
  coveragePct: number;
  avgGapDays: number;
  frequency: RecurringFrequency;
  confidence: number;
  totalAmount: number;
  nextExpected: Date;
};
