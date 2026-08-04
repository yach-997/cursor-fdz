import type {
  AiHardRuleCode,
  AiHardRuleEnforceMode,
  AiHardRuleMatchMode,
} from '../../entities/ai-hard-rule.entity';

export type HardRuleSeed = {
  code: AiHardRuleCode;
  name: string;
  matchMode: AiHardRuleMatchMode;
  matchPattern: string;
  promptText: string;
  jsonSchemaHint: string;
  enforceMode: AiHardRuleEnforceMode;
};

/** 内置默认硬规则（库缺失/读取失败时回退；种子写入库） */
export const HARD_RULE_DEFAULTS: HardRuleSeed[] = [
  {
    code: 'ac_side',
    name: '交流侧安装检查',
    matchMode: 'title_includes',
    matchPattern: '交流侧',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须区分主PE铜芯线/铜编织带与柜门黄绿跳线","evidence":{"phaseWiresOk":true|false,"sampleRequiresCopperPe":true|false,"mainCopperPeConductorVisible":true|false,"mainCopperPeTerminationVisible":true|false,"mainPeConductorVisible":true|false,"mainPeTerminationVisible":true|false,"doorBondingJumperOnly":true|false,"peWireConnected":true|false,"terminalsCoveredOrProtected":true|false,"photoFindings":["第1张：主PE铜芯线或铜编织带及其压接位置"]}}',
    promptText: [
      '【交流侧安装检查·主PE判定·易错点】',
      '先找背板上印有“PE”字样旁的那颗螺栓（通常在 L3 右侧）。',
      '合格：该 PE 螺栓螺母下压着独立裸铜编织带（铜辫）或铜芯接地线；同框可有柜门细黄绿跳线。',
      '不合格（必须 fail，禁止放行）：',
      '1) PE 标签旁螺栓空着（只有螺丝/垫片，没有铜线或铜编织带被压住）；',
      '2) 只有柜门右上角细黄绿跳线，PE 主端子无导体；',
      '3) 铜编织带/铜芯只是搭在旁边、悬空、未压进 PE 螺母下；',
      '4) 把相线线鼻子旁的屏蔽丝当成主PE。',
      'doorBondingJumperOnly=true：仅有柜门跳线、主PE端子空。此时 peWireConnected 必须 false。',
      'terminalsCoveredOrProtected：有透明罩/防护即可 true。',
    ].join('\n'),
  },
  {
    code: 'grounding',
    name: '接地安装检查',
    matchMode: 'title_exact',
    matchPattern: '接地安装检查|接地检查',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文，必须逐张说明","evidence":{"photoTypes":["internal_main_pe"|"external_chassis_ground"|"other"],"photoChecks":[{"photoIndex":1,"type":"internal_main_pe|external_chassis_ground|other","internalMainPeConnected":true|false,"externalGroundConnected":true|false,"wireAndTerminalVisibleInSamePhoto":true|false,"reason":"本张独立结论"}],"hasInternalMainPePhoto":true|false,"internalMainPeConnected":true|false,"hasExternalGroundPhoto":true|false,"externalGroundConnected":true|false,"matchesSampleViews":true|false}}',
    promptText: [
      '【接地安装检查·双连接点 · 任一点不合格则整项 fail】',
      '必须同时有：A) 箱内主PE照片；B) 箱外机壳接地照片。禁止用同一张箱内图冒充两点。',
      'A) 箱内：独立粗铜编织带/铜芯压在PE螺栓；相线屏蔽编织 ≠ 主PE；仅柜门黄绿跳线 ≠ 主PE。',
      'B) 箱外：机壳/抱杆侧照片上黄绿或黄色线接到机壳/支架；箱内开盖图不能证明箱外接地。',
      '拿不准 → 对应 connected=false。',
      '注意：上传顺序不定，可能先拍箱外后拍箱内，禁止按序号猜测视角。',
    ].join('\n'),
  },
  {
    code: 'dc_side',
    name: '直流侧安装检查',
    matchMode: 'title_includes',
    matchPattern: '直流侧',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须写明照片序号和端口位置","evidence":{"connectorsIntact":true|false,"unusedPortsCapped":true|false,"allPortsIndividuallyAccountedFor":true|false,"visibleUnusedPortCount":0,"uncappedUnusedPortCount":0,"matchesSampleProtection":true|false,"photoFindings":["第1张：空闲孔及封盖情况"]}}',
    promptText: [
      '【直流侧安装检查·硬性规则 · 覆盖通用“拿不准优先 pass”中与本项冲突的部分】',
      '判定对象只有两类端口：',
      'A) 在用端口：已插入黑色 MC4/电缆接头 → 一律合格，不要求再盖防尘盖。',
      'B) 空闲端口：没有插线的圆孔 → 必须看有没有防护盖。',
      '',
      '【空闲端口合格】满足任一即可 unusedPortsCapped=true：',
      '1) 空闲孔已盖蓝色防尘盖/堵头；',
      '2) 空闲孔已盖红色或橙色防尘盖/堵头（含带提手的大圆盖）；',
      '3) 空闲孔位置是红色/橙色旋钮盖、DC SWITCH 旋盖且处于盖合状态；',
      '4) 画面中可见直流口全部插满在用，没有空闲孔。',
      '',
      '【空闲端口不合格】只要看到未插线圆孔且没有蓝/红/橙防护盖，就必须 unusedPortsCapped=false；黑色孔口、空心插座或可见金属触点均属于未封盖。',
      '',
      '【严禁误判】',
      '- 蓝盖、红盖、橙盖本身 = 合格证据，禁止因“看见盖子颜色”而判 fail。',
      '- 黑色 MC4 塑料外壳、已插接头尾端、线缆护套 ≠ 裸露端子。',
      '- 必须逐张、从左到右清点可见空闲孔，写入 visibleUnusedPortCount、uncappedUnusedPortCount 和 photoFindings。',
      '- 任一端口被遮挡、过暗或无法区分“已插线/已封盖”时，allPortsIndividuallyAccountedFor=false，按证据不足 fail，禁止猜测合格。',
      '- 合格样本中未插线孔均有盖；现场若同样有蓝/红/橙盖，应判 pass。',
      '',
      'connectorsIntact：可见已插接头插接到位、无破损烧蚀进水 → true。',
      'matchesSampleProtection：有合格样本时，空闲孔防护方式与样本同级（有盖）→ true；无样本则忽略。',
      '拿不准时：unusedPortsCapped=false、allPortsIndividuallyAccountedFor=false，判 fail；禁止“未看清缺陷就当作没有缺陷”。',
    ].join('\n'),
  },
  {
    code: 'fault_record',
    name: '上传故障记录',
    matchMode: 'criteria_includes',
    matchPattern: '上传故障|故障记录|故障/告警|实时故障|历史故障',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"photoTypes":["realtime"|"historical"|"other"],"hasRealtimeFaultShot":true|false,"hasHistoricalFaultShot":true|false,"realtimeHasActiveAlarm":true|false}}',
    promptText: [
      '【上传故障记录·硬性否决 — 覆盖通用“拿不准优先 pass”】',
      '必须对每张现场照片单独分类，写入 evidence.photoTypes（与照片顺序一一对应）。',
      'A) realtime：实时故障/实时告警页。识别要点：标题或页签含「实时故障」「实时告警」「当前告警」；空列表、「暂无数据」「暂无故障」也算实时页（仍然合格证据）。',
      'B) historical：历史故障/历史告警页。识别要点：标题含「历史故障」「历史告警」「历史记录」；常见为带日期的告警列表。',
      'C) other：设备首页、发电量、阳光云总览等，不算实时也不算历史。',
      '硬性：photoTypes 中必须同时出现 realtime 与 historical，缺一类 → fail。',
      '注意：上传了 2 张不等于自动合格——若两张都是历史，或一张历史一张 other，仍 fail，并写明缺实时。',
      '若某张页签/标题能辨认「实时」但列表为空，hasRealtimeFaultShot 必须为 true，禁止因“暂无数据”判成未提供实时截图。',
      '两类都齐之后：实时页无未恢复严重告警 → 可 pass；历史有过往记录不单独不合格；实时仍有严重未恢复告警且备注未说明 → fail。',
      'hasRealtimeFaultShot / hasHistoricalFaultShot 必须与 photoTypes 一致。',
    ].join('\n'),
  },
  {
    code: 'sungrow',
    name: '上传阳光云截图',
    matchMode: 'criteria_includes',
    matchPattern: '阳光云|上传阳光云',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须写明缺失区域","evidence":{"screenshotComplete":true|false,"serialNumberVisible":true|false,"topSectionVisible":true|false,"bottomContentVisible":true|false,"requiredSectionsCovered":true|false,"croppedOrPartial":true|false,"matchesSampleLayout":true|false,"photoFindings":["第1张：实际可见区域"]}}',
    promptText: [
      '【上传阳光云截图·硬性否决】',
      '必须严格对照合格样本的完整度，禁止“有几个功率数字就算完整”。',
      'screenshotComplete=true 的最低要求（现场照片像素内须同时具备）：',
      '1) 顶部设备信息区：机型/设备名、运行状态，且能读到序列号（S/N、序列号等）；',
      '2) 中部关键运行数据区；',
      '3) 页面下部内容区也已覆盖；底部导航栏只能证明是整屏截图，不能证明长页面内容已截全。',
      '4) 若页面可上下滚动，必须由多张连续截图或长截图覆盖样本要求的全部区域；只拍顶部和部分 MPPT 表格仍是半截。',
      'screenshotComplete=false（必须 fail）典型情况：',
      '- 只有功率/电量四宫格数字，看不到序列号与设备头图；',
      '- 明显半截、左右或上下被裁切，与样本完整手机截图差很多；',
      '- 画面像局部放大/二次裁剪，缺少样本中同级的页面元素。',
      '- 虽有手机顶栏和底部导航，但中间长页面只展示到一半、后续表格/信息未覆盖。',
      'serialNumberVisible：序列号必须在现场图中清晰可读，禁止根据样本或想象补全；看不见 → false。',
      'topSectionVisible、bottomContentVisible、requiredSectionsCovered 必须逐项根据现场图确认；任一不可见/拿不准 → false。',
      'croppedOrPartial：只覆盖长页面的一部分、关键表格被截断、缺少样本中的下半部分 → true。',
      'matchesSampleLayout：有合格样本时，现场完整度须与样本同级；样本是整屏而现场是半截/局部 → false。',
      '仅当 screenshotComplete、serialNumberVisible、topSectionVisible、bottomContentVisible、requiredSectionsCovered 均为 true，croppedOrPartial=false，且（无样本或 matchesSampleLayout=true）才允许 pass。',
    ].join('\n'),
  },
  {
    code: 'mount_fix',
    name: '安装固定检查',
    matchMode: 'criteria_includes',
    matchPattern: '安装固定|支架|墙挂固定|安装是否牢固',
    enforceMode: 'strict',
    jsonSchemaHint:
      '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"multiAngleCoverage":true|false,"hasOverviewShot":true|false,"hasMountCloseup":true|false,"mountPointsVisible":true|false,"nearDuplicatePhotos":true|false,"matchesSampleViews":true|false,"noObviousLooseness":true|false}}',
    promptText: [
      '【安装固定检查·硬性否决】',
      '至少需要 2 张「有效且不重复」的照片。',
      '必须同时具备两类证据，缺一不可：',
      'A) 整机/安装关系概览：能看清设备与电杆/墙面/支架的相对位置（不是只拍机箱铭牌面）；',
      'B) 固定点特写：能看清把设备固定住的抱箍、U型螺栓、抱杆螺栓或膨胀螺栓锁紧点。',
      'multiAngleCoverage=true 仅当上述 A+B 都覆盖，或明确拍到不同侧面（如左侧+背面）。',
      '若多张照片构图几乎相同（同侧连拍/重复上传），视为无效重复，multiAngleCoverage 必须 false。',
      'mountPointsVisible=true：必须看到抱箍/U型螺栓/锁紧螺母本体；只见机箱外壳、线管、横担边缘但看不清锁紧点 → false。',
      '有合格标准图时：现场视角覆盖应与样本同级；样本展示了抱箍特写+整机侧面，现场只有机箱外观重复图 → fail。',
      'noObviousLooseness：未见明显松动、倾斜、支架开裂则可 true。',
      '拿不准是否拍全固定点时，按不合格处理，禁止放水合格。',
    ].join('\n'),
  },
];

export function getHardRuleDefault(code: string): HardRuleSeed | undefined {
  return HARD_RULE_DEFAULTS.find((item) => item.code === code);
}
