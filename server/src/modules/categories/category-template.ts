export interface CategoryTemplateNode {
  name: string;
  children: string[];
}

/**
 * 系统预设分类模板。
 * 注册时复制为当前用户的分类记录，避免 userId 可空的权限分支。
 */
export const CATEGORY_TEMPLATE: Record<'income' | 'expense', CategoryTemplateNode[]> = {
  income: [
    { name: '工资', children: ['基本工资', '绩效奖金', '加班费'] },
    { name: '奖金', children: [] },
    { name: '利息', children: [] },
    { name: '分红', children: [] },
    { name: '其他收入', children: ['红包', '报销', '退款'] },
  ],
  expense: [
    { name: '住房', children: ['房租', '房贷', '物业费', '水电燃气'] },
    { name: '食品', children: ['日常餐饮', '外出就餐', '生鲜采购'] },
    { name: '交通', children: ['公共交通', '打车', '燃油', '车辆保养'] },
    { name: '教育', children: ['学费', '书籍', '培训课程'] },
    { name: '医疗', children: ['门诊', '药品', '体检', '保险医疗'] },
    { name: '保险', children: ['寿险', '健康险', '财产险'] },
    { name: '娱乐', children: ['影音订阅', '旅行', '运动健身'] },
    { name: '购物', children: ['服饰', '数码', '家居'] },
    { name: '其他支出', children: ['手续费', '捐赠'] },
  ],
};

export const DEFAULT_ACCOUNT_NAME = '默认现金账户';
