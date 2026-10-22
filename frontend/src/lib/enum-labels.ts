import { useTranslation } from 'react-i18next';
import type { AccountType } from './accounts';
import type { CategoryKind } from './categories';
import type { TransactionType } from './transactions';

export const ACCOUNT_TYPES: AccountType[] = [
  'cash',
  'bank',
  'credit_card',
  'brokerage',
  'loan',
  'other',
];

export const TRANSACTION_TYPE_KEYS: TransactionType[] = ['income', 'expense', 'transfer', 'adjustment'];

export const CATEGORY_KINDS: CategoryKind[] = ['income', 'expense'];

/** 枚举值转当前语言标签，未知值原样返回，避免接口新增枚举时显示空白 */
export function useEnumLabels() {
  const { t } = useTranslation('enums');

  return {
    accountType: (value: string) => t(`account_type.${value}`, { defaultValue: value }),
    accountStatus: (value: string) => t(`account_status.${value}`, { defaultValue: value }),
    transactionType: (value: string) => t(`transaction_type.${value}`, { defaultValue: value }),
    categoryKind: (value: string) => t(`category_kind.${value}`, { defaultValue: value }),
    role: (value: string) => t(`role.${value}`, { defaultValue: value }),
    userStatus: (value: string) => t(`user_status.${value}`, { defaultValue: value }),
    importStatus: (value: string) => t(`import_status.${value}`, { defaultValue: value }),
    importRowStatus: (value: string) => t(`import_row_status.${value}`, { defaultValue: value }),
    theme: (value: string) => t(`theme.${value}`, { defaultValue: value }),
    contributionFrequency: (value: string) =>
      t(`contribution_frequency.${value}`, { defaultValue: value }),
    contributionTiming: (value: string) =>
      t(`contribution_timing.${value}`, { defaultValue: value }),
    assetClass: (value: string) => t(`asset_class.${value}`, { defaultValue: value }),
    tradeKind: (value: string) => t(`trade_kind.${value}`, { defaultValue: value }),
    cashflowKind: (value: string) => t(`cashflow_kind.${value}`, { defaultValue: value }),
    portfolioStatus: (value: string) => t(`portfolio_status.${value}`, { defaultValue: value }),
    allocationDimension: (value: string) =>
      t(`allocation_dimension.${value}`, { defaultValue: value }),
    performanceReason: (value: string) =>
      t(`performance_reason.${value}`, { defaultValue: value }),
  };
}
