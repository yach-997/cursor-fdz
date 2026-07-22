/** 专业指标事件考核细则（来源：现场工程师日常行为考核表） */
export interface AssessmentEventCatalogItem {
  id: string;
  category: string;
  content: string;
  unit: '次' | '天';
  /** null 表示自定义金额 */
  unitAmount: number | null;
  remark?: string;
}

export const ASSESSMENT_EVENT_CATALOG: AssessmentEventCatalogItem[] = [
  {
    id: 'fail_part_2d',
    category: '失效件提交及时性考核',
    content: '失效件、余料退回案例2天内未及时提交',
    unit: '次',
    unitAmount: 30,
  },
  {
    id: 'fail_part_warehouse',
    category: '失效件提交及时性考核',
    content: '物料已送达合肥仓库仍未提交失效件或余料退回案例',
    unit: '次',
    unitAmount: 50,
  },
  {
    id: 'fail_part_photo',
    category: '失效件提交及时性考核',
    content: '配件发货时，需拍摄包装箱粘贴标识卡的照片，并上传至对应工作案例。未按要求执行、资料缺失',
    unit: '次',
    unitAmount: 50,
  },
  {
    id: 'case_doc_rw_2d',
    category: '案例资料提报及时性考核',
    content: '保内（RW）案例工作完成超2天未完善案例信息',
    unit: '次',
    unitAmount: 50,
  },
  {
    id: 'case_doc_other_2d',
    category: '案例资料提报及时性考核',
    content: '除保内外工作完成超2天未完善案例信息',
    unit: '次',
    unitAmount: 30,
  },
  {
    id: 'case_doc_5d',
    category: '案例资料提报及时性考核',
    content: '所有相关案例工作完成超5天未完善案例填写',
    unit: '次',
    unitAmount: 80,
  },
  {
    id: 'case_doc_extra_day',
    category: '案例资料提报及时性考核',
    content: '案例资料提报及时性考核每增加1天',
    unit: '天',
    unitAmount: 20,
  },
  {
    id: 'expense_2d',
    category: '报销信息提报及时性考核',
    content: '工作结束之后超时2天未提交报销信息',
    unit: '次',
    unitAmount: 30,
  },
  {
    id: 'expense_5d',
    category: '报销信息提报及时性考核',
    content: '工作结束之后超时5天未提交报销信息',
    unit: '次',
    unitAmount: 50,
  },
  {
    id: 'expense_fake',
    category: '费用作假考核',
    content: '里程及其他额外费用作假',
    unit: '次',
    unitAmount: null,
  },
  {
    id: 'safety_damage',
    category: '现场作业安全管理考核',
    content:
      '员工现场作业未履行自查义务，因个人操作失误导致接错线、螺丝松动等问题，造成设备损坏的',
    unit: '次',
    unitAmount: 500,
    remark: '本月出现2次作出停单处理',
  },
  {
    id: 'safety_enter_exit',
    category: '现场作业安全管理考核',
    content: '进场和离场未和工程师沟通，擅自入场/离场导致现场窝工或投诉',
    unit: '次',
    unitAmount: 500,
    remark: '本月出现2次作出停单处理',
  },
  {
    id: 'safety_complaint',
    category: '现场作业安全管理考核',
    content: '现场客户对于个人违规作业做出投诉',
    unit: '次',
    unitAmount: 500,
    remark: '本月出现2次作出停单处理',
  },
  {
    id: 'safety_dingtalk',
    category: '现场作业安全管理考核',
    content: '钉钉打卡拍照不规范',
    unit: '次',
    unitAmount: 200,
  },
  {
    id: 'safety_ppe',
    category: '现场作业安全管理考核',
    content: '现场工作未正确穿戴PPE，被阳光电源或业主方投诉至公司',
    unit: '次',
    unitAmount: 1000,
  },
  {
    id: 'other_liability',
    category: '其他责任性考核',
    content: '涉及阳光责任性考核或业主处罚根据责任认定考核',
    unit: '次',
    unitAmount: null,
  },
];

export function rankRewardAmount(
  rankGroup: 'station_manager' | 'inspector',
  rankResult: string | null,
): number {
  if (rankResult === '优秀') return rankGroup === 'station_manager' ? 500 : 300;
  if (rankResult === '不称职') return rankGroup === 'station_manager' ? -500 : -300;
  return 0;
}
