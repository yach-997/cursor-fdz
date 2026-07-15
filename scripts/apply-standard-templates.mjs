const apiBase = (
  process.env.TEMPLATE_API_BASE || 'https://cursor-fdz.vercel.app/api'
).replace(/\/$/, '');
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD;

const entry = (id, name, description, order, optional = false) => ({
  id,
  name,
  description,
  isRequired: !optional,
  order,
  samplePhotos: [],
  checkType: 'photo',
  isOptionalModule: optional,
});

const cloudDescription =
  '拍照要求：上传完整、清晰的阳光云设备页面截图，必须包含设备序列号、在线状态、主要运行数据和截图时间。检查提示：核对截图序列号与当前巡检设备一致。合格判定：设备在线、关键数据无明显异常，序列号与巡检设备一致。';
const faultDescription =
  '拍照要求：上传历史故障记录和实时故障/告警页面截图，内容与时间须清晰可见。检查提示：重点查看未恢复告警、重复故障及近期高频故障。合格判定：无未处理严重告警；如有异常，须在备注中说明处置情况。';
const ringDescription =
  '拍照要求：拍摄柜体、开关位置、带电显示、压力/状态指示及安全标识。检查提示：检查柜门联锁、机构状态、绝缘部位和防误操作装置。合格判定：柜体完好、指示正常、联锁可靠，无放电痕迹、异响或异味。';
const transformerDescription =
  '可选模块（视现场情况开启）。拍照要求：拍摄变压器整体、铭牌、油位/温度、套管、接线和防护设施。检查提示：检查渗漏、温升、异响、异味、套管污染及接地。合格判定：运行声音和温度正常，无渗漏、破损、放电痕迹或异常气味。';

const templates = [
  {
    name: '组串式逆变器巡检',
    deviceType: 'string_inverter',
    entries: [
      entry('string-cloud', '上传阳光云截图', cloudDescription, 0),
      entry('string-fault', '上传故障记录', faultDescription, 1),
      entry(
        'string-mount',
        '安装固定检查',
        '拍照要求：拍摄设备整体、支架或挂墙点及主要紧固位置。检查提示：检查设备垂直度、支架、螺栓和防松措施。合格判定：安装牢固，无松动、倾斜、明显变形或异常振动。',
        2,
      ),
      entry(
        'string-dc',
        '直流侧安装检查',
        '拍照要求：拍摄直流端子、连接器、线缆走向、标识和防护部位。检查提示：检查正负极、端子紧固、防水接头、线缆破损及过热痕迹。合格判定：极性正确、连接可靠、标识清晰，无破损、松脱、烧蚀或进水。',
        3,
      ),
      entry(
        'string-ac',
        '交流侧安装检查',
        '拍照要求：拍摄交流端子、断路器、线缆走向和防护部位。检查提示：检查端子紧固、相序、线缆绝缘、桥架及封堵。合格判定：接线规范、连接可靠、相序及标识正确，无松动、破损、过热或裸露。',
        4,
      ),
      entry(
        'string-ground',
        '接地安装检查',
        '拍照要求：拍摄设备接地点、接地线全貌及接地标识。检查提示：检查接地线规格、连接紧固、防腐和等电位连接。合格判定：接地连续可靠、标识清晰，无松动、锈蚀或断裂。',
        5,
      ),
    ],
  },
  {
    name: '集中式逆变器巡检',
    deviceType: 'central_inverter',
    entries: [
      entry('central-cloud', '上传阳光云截图', cloudDescription, 0),
      entry('central-fault', '上传故障记录', faultDescription, 1),
      entry(
        'central-cabinet',
        '设备箱体检查',
        '拍照要求：拍摄箱体整体、柜门、门锁、密封条、通风口及内部环境。检查提示：检查变形、锈蚀、渗水、积尘、异物和防护封堵。合格判定：箱体完整、门锁和密封可靠，内部整洁，无进水、严重锈蚀或异物。',
        2,
      ),
      entry(
        'central-inverter',
        '逆变器检查',
        '拍照要求：拍摄逆变器本体、运行指示、显示界面、接线和散热部位。检查提示：检查运行状态、异响异味、温升、风机/滤网和端子。合格判定：运行正常，无异常告警、异响、异味、过热或接线松动。',
        3,
      ),
      entry(
        'central-lv',
        '低压配电柜检查',
        '拍照要求：拍摄柜体、开关状态、仪表、母排、端子及标识。检查提示：检查元器件状态、接线紧固、绝缘、防护隔板和过热痕迹。合格判定：开关及仪表状态正常，接线规范，无放电、烧蚀、松动或异常温升。',
        4,
      ),
      entry('central-ring', '环网柜检查', ringDescription, 5),
      entry(
        'central-transformer',
        '中压变压器检查',
        transformerDescription,
        6,
        true,
      ),
    ],
  },
  {
    name: '储能系统巡检',
    deviceType: 'energy_storage',
    entries: [
      entry(
        'storage-cabinet',
        '箱体检查',
        '拍照要求：拍摄储能箱体整体、柜门、门锁、密封、通风口和安全标识。检查提示：检查变形、锈蚀、渗水、积尘、封堵及周边通道。合格判定：箱体完整、密封可靠、通道畅通，无进水、严重锈蚀或结构损伤。',
        0,
      ),
      entry(
        'storage-battery',
        '电池箱检查',
        '拍照要求：拍摄电池柜/电池簇、连接件、BMS状态、温度和消防探测部位。检查提示：检查鼓包、变形、渗漏、松动、过热、异味及温差异常。合格判定：电池外观和连接正常，无鼓包、渗漏、过热、异味或异常告警。',
        1,
      ),
      entry(
        'storage-pcs',
        'PCS 检查',
        '拍照要求：拍摄 PCS 整体、运行界面、指示灯、交直流接线和散热部位。检查提示：检查运行参数、告警、风机/滤网、端子及异常温升。合格判定：PCS 运行正常，无异常告警、异响、异味、过热或接线松动。',
        2,
      ),
      entry('storage-ring', '环网柜检查', ringDescription, 3),
      entry(
        'storage-transformer',
        '中压变压器检查',
        transformerDescription,
        4,
        true,
      ),
      entry(
        'storage-other',
        '其它系统检查',
        '拍照要求：拍摄 EMS/BMS、消防、空调、通风、照明、通信和辅助电源等附属系统状态。检查提示：逐项确认运行指示、告警、环境温湿度及消防设施。合格判定：各附属系统运行正常、无告警，消防设施有效，环境条件符合运行要求。',
        5,
      ),
    ],
  },
];

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(templates));
  process.exit(0);
}

if (!password) {
  throw new Error('请通过 ADMIN_PASSWORD 环境变量提供管理员密码');
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const payload = await response.json();
  if (!response.ok || (payload.code && payload.code !== 200)) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

const login = await request('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ username, password, client: 'pc' }),
});
const headers = {
  Authorization: `Bearer ${login.accessToken}`,
  'Content-Type': 'application/json; charset=utf-8',
};
const current = await request('/templates', { headers });
const results = [];

for (const template of templates) {
  const existing = current.find(
    (item) => item.deviceType === template.deviceType && item.isGlobal,
  );
  const body = JSON.stringify({ ...template, isGlobal: true });
  const saved = existing
    ? await request(`/templates/${existing.id}`, { method: 'PUT', headers, body })
    : await request('/templates', { method: 'POST', headers, body });
  results.push({
    action: existing ? 'updated' : 'created',
    id: saved.id,
    name: saved.name,
    version: saved.version,
    entryCount: saved.entries.length,
    requiredCount: saved.entries.filter((item) => item.isRequired).length,
    optionalCount: saved.entries.filter((item) => item.isOptionalModule).length,
  });
}

console.log(JSON.stringify(results, null, 2));
