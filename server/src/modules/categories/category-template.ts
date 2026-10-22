import { SUPPORTED_LANGUAGES } from '../../config/constants.js';

export type TemplateLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface CategoryTemplateNode {
  names: Record<TemplateLanguage, string>;
  children: Array<Record<TemplateLanguage, string>>;
}

/**
 * 系统预设分类模板。
 * 注册时按用户界面语言复制为分类记录，落库后即视为用户数据，不再随界面语言变化。
 */
const zh: TemplateLanguage = 'zh-CN';
const en: TemplateLanguage = 'en-US';

export const CATEGORY_TEMPLATE: Record<'income' | 'expense', CategoryTemplateNode[]> = {
  income: [
    { names: { [zh]: '工资', [en]: 'Salary' }, children: [{ [zh]: '基本工资', [en]: 'Base salary' }, { [zh]: '绩效奖金', [en]: 'Performance bonus' }, { [zh]: '加班费', [en]: 'Overtime pay' }] },
    { names: { [zh]: '奖金', [en]: 'Bonus' }, children: [] },
    { names: { [zh]: '利息', [en]: 'Interest' }, children: [] },
    { names: { [zh]: '分红', [en]: 'Dividends' }, children: [] },
    {
      names: { [zh]: '其他收入', [en]: 'Other income' },
      children: [{ [zh]: '红包', [en]: 'Red packet' }, { [zh]: '报销', [en]: 'Reimbursement' }, { [zh]: '退款', [en]: 'Refund' }],
    },
  ],
  expense: [
    {
      names: { [zh]: '住房', [en]: 'Housing' },
      children: [{ [zh]: '房租', [en]: 'Rent' }, { [zh]: '房贷', [en]: 'Mortgage' }, { [zh]: '物业费', [en]: 'Property fee' }, { [zh]: '水电燃气', [en]: 'Utilities' }],
    },
    {
      names: { [zh]: '食品', [en]: 'Food' },
      children: [{ [zh]: '日常餐饮', [en]: 'Daily meals' }, { [zh]: '外出就餐', [en]: 'Dining out' }, { [zh]: '生鲜采购', [en]: 'Groceries' }],
    },
    {
      names: { [zh]: '交通', [en]: 'Transport' },
      children: [{ [zh]: '公共交通', [en]: 'Public transit' }, { [zh]: '打车', [en]: 'Taxi' }, { [zh]: '燃油', [en]: 'Fuel' }, { [zh]: '车辆保养', [en]: 'Car maintenance' }],
    },
    {
      names: { [zh]: '教育', [en]: 'Education' },
      children: [{ [zh]: '学费', [en]: 'Tuition' }, { [zh]: '书籍', [en]: 'Books' }, { [zh]: '培训课程', [en]: 'Courses' }],
    },
    {
      names: { [zh]: '医疗', [en]: 'Medical' },
      children: [{ [zh]: '门诊', [en]: 'Outpatient' }, { [zh]: '药品', [en]: 'Medicine' }, { [zh]: '体检', [en]: 'Checkup' }, { [zh]: '保险医疗', [en]: 'Medical insurance' }],
    },
    {
      names: { [zh]: '保险', [en]: 'Insurance' },
      children: [{ [zh]: '寿险', [en]: 'Life insurance' }, { [zh]: '健康险', [en]: 'Health insurance' }, { [zh]: '财产险', [en]: 'Property insurance' }],
    },
    {
      names: { [zh]: '娱乐', [en]: 'Entertainment' },
      children: [{ [zh]: '影音订阅', [en]: 'Subscriptions' }, { [zh]: '旅行', [en]: 'Travel' }, { [zh]: '运动健身', [en]: 'Fitness' }],
    },
    {
      names: { [zh]: '购物', [en]: 'Shopping' },
      children: [{ [zh]: '服饰', [en]: 'Clothing' }, { [zh]: '数码', [en]: 'Electronics' }, { [zh]: '家居', [en]: 'Home' }],
    },
    {
      names: { [zh]: '其他支出', [en]: 'Other expenses' },
      children: [{ [zh]: '手续费', [en]: 'Fees' }, { [zh]: '捐赠', [en]: 'Donation' }],
    },
  ],
};
