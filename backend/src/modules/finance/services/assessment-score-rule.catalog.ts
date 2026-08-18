/** 月度考核打分规则（来源：月度考核打分表） */

export type AssessmentScoreItemKind = 'base' | 'bonus' | 'deduct';

export type AssessmentScoreRuleItem = {
  id: string;
  /** 维度：工作业绩 / 工作能力 / 工作态度 / 加分项 / 扣分项 */
  category: string;
  /** 分项标题 */
  title: string;
  /** 满分；扣分项可为较大上限表示「不限」 */
  maxScore: number;
  /** 评分说明 */
  description: string;
  sort: number;
  kind: AssessmentScoreItemKind;
  enabled?: boolean;
};

export const DEFAULT_ASSESSMENT_SCORE_RULES: AssessmentScoreRuleItem[] = [
  {
    id: 'perf_complete',
    category: '工作业绩（60分）',
    title: '工作完成度',
    maxScore: 15,
    description:
      '按期、保质、保量完成岗位本职工作及领导交办任务，无拖延、无积压；未按时完成每次扣3-5分',
    sort: 10,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'perf_quality',
    category: '工作业绩（60分）',
    title: '工作质量',
    maxScore: 15,
    description:
      '工作成果规范、准确、合规，无差错、无返工、无资料漏洞；出现一般差错扣2-4分，严重差错本项不得分',
    sort: 20,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'perf_efficiency',
    category: '工作业绩（60分）',
    title: '工作效率',
    maxScore: 15,
    description:
      '流程推进高效，台账更新及时，资料上报准时，不滞后、不延误；出现滞后一次扣2分',
    sort: 30,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'perf_hard',
    category: '工作业绩（60分）',
    title: '重难点工作推进',
    maxScore: 15,
    description:
      '主动推进岗位重难点、遗留问题、闭环工作，有效解决现场及管理问题；推诿、不作为酌情扣分',
    sort: 40,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'ability_tech',
    category: '工作能力（20分）',
    title: '专业技术能力',
    maxScore: 7,
    description: '熟练掌握本岗位专业知识、规范流程、岗位技能，能独立处理岗位专业问题',
    sort: 50,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'ability_comm',
    category: '工作能力（20分）',
    title: '沟通协调能力',
    maxScore: 7,
    description: '对内对外沟通顺畅，对接高效，问题反馈及时，配合度高，无沟通纠纷',
    sort: 60,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'ability_learn',
    category: '工作能力（20分）',
    title: '学习与改进能力',
    maxScore: 6,
    description: '主动学习新规、新工艺、新流程，能总结问题、优化工作方法',
    sort: 70,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'attitude_duty',
    category: '工作态度（20分）',
    title: '责任心',
    maxScore: 7,
    description: '履职尽责，主动担当，无敷衍、无推诿，出现问题主动闭环整改',
    sort: 80,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'attitude_discipline',
    category: '工作态度（20分）',
    title: '纪律考勤',
    maxScore: 7,
    description: '遵守公司及项目管理制度，考勤正常，无迟到早退、无旷工、无违规违纪',
    sort: 90,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'attitude_team',
    category: '工作态度（20分）',
    title: '团队协作',
    maxScore: 6,
    description: '配合部门及同事工作，主动协同补位，积极参与项目各项工作',
    sort: 100,
    kind: 'base',
    enabled: true,
  },
  {
    id: 'bonus',
    category: '加分项',
    title: '加分',
    maxScore: 5,
    description: '主动攻坚、获得客户表扬、优化流程降本增效、专项工作突出，酌情加分',
    sort: 110,
    kind: 'bonus',
    enabled: true,
  },
  {
    id: 'deduct',
    category: '扣分项',
    title: '扣分',
    maxScore: 100,
    description:
      '出现安全隐患、质量问题、资料重大失误、投诉、违纪、工作严重滞后、现场成本偏高（填正数表示扣除）',
    sort: 120,
    kind: 'deduct',
    enabled: true,
  },
];
