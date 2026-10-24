import type { ReportType } from '@prisma/client';

export interface ReportBasis {
  range: { from: string; to: string };
  currency: string;
  rateDates: string[];
  accountScope: { mode: 'all'; accounts: number; excluded: string[] };
  completeness: {
    isComplete: boolean;
    missingMonths: string[];
    missingRates: string[];
    staleValuations: Array<{ portfolioId: string; priceDate: string | null }>;
    unpricedSymbols: string[];
  };
  modelVersions: Record<string, string>;
  generatedAt: string;
  notes: string[];
}

export interface ReportPayload {
  type: ReportType;
  title: string;
  rangeFrom: string;
  rangeTo: string;
  params: Record<string, unknown>;
  basis: ReportBasis;
  data: Record<string, unknown>;
  rowCount: number;
  modelVersions: Record<string, string>;
}

export const REPORT_ROW_COUNT_NOTE = 'row_count_counts_detail_rows';
