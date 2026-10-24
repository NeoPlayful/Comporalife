import type { ReportType } from '@prisma/client';
import { buildCsv, buildXlsx, contentDisposition, sanitizeFilename, type CellValue, type CsvSection } from './export.serialize.js';

export interface ExportableReport {
  id: string;
  type: ReportType;
  title: string;
  rangeFrom: string;
  rangeTo: string;
  currency: string;
  basis: Record<string, unknown>;
  data: Record<string, unknown>;
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function cell(value: unknown): CellValue {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
}

function totalsSection(totals: Record<string, unknown> | undefined): CsvSection | null {
  if (!totals) return null;
  const rows = Object.entries(totals).map(([key, value]) => [key, cell(value)]);
  if (rows.length === 0) return null;
  return { header: ['指标', '数值'], rows };
}

/** 报表数据转成导出分区；每个分区对应一个 sheet 或 CSV 块 */
export function toSections(report: ExportableReport): CsvSection[] {
  const data = report.data;
  const sections: CsvSection[] = [];

  if (report.type === 'net_worth') {
    sections.push({
      title: '账户余额',
      header: ['账户', '类型', '币种', '账面余额', '基准币种金额', '是否负债'],
      rows: rowsOf(data.accounts).map((row) => [
        cell(row.name),
        cell(row.type),
        cell(row.currency),
        cell(row.balance),
        cell(row.baseBalance),
        row.isLiability ? '是' : '否',
      ]),
    });

    sections.push({
      title: '证券市值',
      header: ['组合', '市值', '价格日期', '是否过期'],
      rows: rowsOf(data.securities).map((row) => [
        cell(row.name),
        cell(row.marketValue),
        cell(row.priceDate),
        row.isStale ? '是' : '否',
      ]),
    });

    const totals = totalsSection(data.totals as Record<string, unknown> | undefined);
    if (totals) sections.push({ title: '汇总', ...totals });
  }

  if (report.type === 'cashflow') {
    sections.push({
      title: '月度现金流',
      header: ['期间', '收入', '支出', '净额', '数据完整'],
      rows: rowsOf(data.points).map((row) => [
        cell(row.period),
        cell(row.income),
        cell(row.expense),
        cell(row.net),
        row.isComplete ? '是' : '否',
      ]),
    });

    const totals = totalsSection(data.totals as Record<string, unknown> | undefined);
    if (totals) sections.push({ title: '汇总', ...totals });

    sections.push({
      title: '其他',
      header: ['指标', '数值'],
      rows: [['内部转账合计', cell(data.transferTotal)]],
    });
  }

  if (report.type === 'analytics') {
    const byCategory = (data.byCategory ?? {}) as Record<string, unknown>;

    sections.push({
      title: '支出分类',
      header: ['分类', '金额', '占比', '笔数'],
      rows: rowsOf(byCategory.expense).map((row) => [
        cell(row.name),
        cell(row.amount),
        cell(row.share),
        cell(row.count),
      ]),
    });

    sections.push({
      title: '收入分类',
      header: ['分类', '金额', '占比', '笔数'],
      rows: rowsOf(byCategory.income).map((row) => [
        cell(row.name),
        cell(row.amount),
        cell(row.share),
        cell(row.count),
      ]),
    });

    sections.push({
      title: '商户排行',
      header: ['商户', '金额', '笔数'],
      rows: rowsOf(data.byMerchant).map((row) => [cell(row.merchant), cell(row.amount), cell(row.count)]),
    });

    const uncategorized = (data.uncategorized ?? {}) as Record<string, unknown>;
    sections.push({
      title: '未归属',
      header: ['指标', '数值'],
      rows: [
        ['未标记商户笔数', cell(uncategorized.count)],
        ['未标记商户金额', cell(uncategorized.amount)],
      ],
    });
  }

  if (report.type === 'investment') {
    sections.push({
      title: '组合绩效',
      header: ['组合', '币种', '市值', 'TWR', 'XIRR', '估值日期', '是否过期'],
      rows: rowsOf(data.portfolios).map((row) => [
        cell(row.name),
        cell(row.currency),
        cell(row.marketValue),
        cell(row.twr),
        cell(row.xirr),
        cell(row.valuationDate),
        row.isStale ? '是' : '否',
      ]),
    });

    sections.push({
      title: '资产配置',
      header: ['维度', '类别', '市值', '权重'],
      rows: rowsOf(data.allocation).map((row) => [
        cell(row.dimension),
        cell(row.key),
        cell(row.marketValue),
        cell(row.weight),
      ]),
    });

    // TWR/XIRR 不可计算的原因必须随导出一起走，否则空单元格无法解释
    const reasons = rowsOf(data.portfolios).filter(
      (row) => row.twrUnavailableReason || row.xirrUnavailableReason,
    );
    if (reasons.length > 0) {
      sections.push({
        title: '收益不可计算原因',
        header: ['组合', 'TWR 原因', 'XIRR 原因'],
        rows: reasons.map((row) => [
          cell(row.name),
          cell(row.twrUnavailableReason),
          cell(row.xirrUnavailableReason),
        ]),
      });
    }
  }

  if (report.type === 'goals') {
    sections.push({
      title: '目标进度',
      header: ['目标', '类型', '目标金额', '当前金额', '进度', '缺口', '达成时间', '所需月供'],
      rows: rowsOf(data.goals).map((row) => [
        cell(row.name),
        cell(row.type),
        cell(row.targetAmount),
        cell(row.currentAmount),
        cell(row.progress),
        cell(row.gap),
        cell(row.achievedAt),
        cell(row.requiredMonthly),
      ]),
    });

    const summary = (data.summary ?? {}) as Record<string, unknown>;
    sections.push({
      title: '汇总',
      header: ['指标', '数值'],
      rows: [
        ['活跃目标数', cell(summary.activeCount)],
        ['总缺口', cell(summary.totalGap)],
        ['所需月供合计', cell(summary.requiredMonthlyTotal)],
      ],
    });
  }

  if (report.type === 'simulation') {
    sections.push({
      title: '复利方案（确定性计算）',
      header: ['方案', '年限', '年化收益', '模型版本'],
      rows: rowsOf(data.compound).map((row) => [
        cell(row.name),
        cell(row.years),
        cell(row.annualReturnRate),
        cell(row.modelVersion),
      ]),
    });

    sections.push({
      title: '蒙特卡罗运行（随机模拟）',
      header: ['方案', '种子', '路径数', '年限', 'P10', 'P50', 'P90', '亏损概率', '达标概率', '模型版本'],
      rows: rowsOf(data.monteCarlo).map((row) => {
        const terminal = (row.terminal ?? {}) as Record<string, unknown>;
        const probabilities = (row.probabilities ?? {}) as Record<string, unknown>;
        return [
          cell(row.scenarioName),
          cell(row.seed),
          cell(row.pathCount),
          cell(row.years),
          cell(terminal.p10),
          cell(terminal.p50),
          cell(terminal.p90),
          cell(probabilities.loss),
          cell(probabilities.target),
          cell(row.modelVersion),
        ];
      }),
    });
  }

  return sections;
}

/** 口径区块必须附在每一份导出末尾，脱离 basis 的数字无法解释 */
export function basisSection(basis: Record<string, unknown>): CsvSection {
  const completeness = (basis.completeness ?? {}) as Record<string, unknown>;
  const range = (basis.range ?? {}) as Record<string, unknown>;

  const rows: CellValue[][] = [
    ['统计区间', `${range.from ?? ''} ~ ${range.to ?? ''}`],
    ['基准币种', cell(basis.currency)],
    ['汇率日期', Array.isArray(basis.rateDates) ? (basis.rateDates as unknown[]).join(', ') : ''],
    ['账户范围', `${((basis.accountScope ?? {}) as Record<string, unknown>).accounts ?? 0} 个账户（全部）`],
    ['数据完整', completeness.isComplete ? '是' : '否'],
    ['缺失月份', Array.isArray(completeness.missingMonths) ? (completeness.missingMonths as unknown[]).join(', ') : ''],
    ['缺失汇率', Array.isArray(completeness.missingRates) ? (completeness.missingRates as unknown[]).join(', ') : ''],
    ['生成时间', cell(basis.generatedAt)],
  ];

  for (const [key, value] of Object.entries((basis.modelVersions ?? {}) as Record<string, string>)) {
    rows.push([`模型版本 ${key}`, value]);
  }

  for (const note of (basis.notes ?? []) as string[]) {
    rows.push(['说明', note]);
  }

  return { title: '口径说明', header: ['项目', '内容'], rows };
}

export function renderCsv(report: ExportableReport): string {
  return buildCsv([...toSections(report), basisSection(report.basis)]);
}

export function renderXlsx(report: ExportableReport): Buffer {
  const sections = toSections(report);
  const sheets = sections.map((section, index) => ({
    name: section.title ?? `表${index + 1}`,
    header: section.header,
    rows: section.rows,
  }));

  const basis = basisSection(report.basis);
  sheets.push({ name: basis.title ?? '口径说明', header: basis.header, rows: basis.rows });

  return buildXlsx(sheets);
}

export function reportFilename(report: ExportableReport, extension: 'csv' | 'xlsx'): {
  ascii: string;
  utf8: string;
} {
  const suffix = `${report.rangeFrom}_${report.rangeTo}`;
  return {
    ascii: sanitizeFilename(`report-${report.type}-${suffix}`).replace(/[^\x20-\x7e]/g, '-') + `.${extension}`,
    utf8: sanitizeFilename(`${report.title}-${suffix}`) + `.${extension}`,
  };
}

export function downloadHeaders(ascii: string, utf8: string, format: 'csv' | 'xlsx'): Record<string, string> {
  return {
    'content-type':
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': contentDisposition(ascii, utf8),
    'cache-control': 'no-store',
  };
}
