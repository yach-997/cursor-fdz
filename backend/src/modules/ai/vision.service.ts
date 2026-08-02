import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckResult } from '../../common/enums';

export interface VisionCompareResult {
  status: CheckResult.PASS | CheckResult.FAIL | CheckResult.ERROR;
  confidence: number;
  reason: string;
  provider: 'siliconflow' | 'mock';
}

/** SiliconFlow / OpenAI 兼容多模态识图对比 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    return Boolean((this.config.get<string>('VISION_API_KEY') || '').trim());
  }

  async comparePhoto(
    photoUrlsInput: string | string[],
    samplePhotoUrls: string[],
    checkCriteria?: string,
    options?: { remark?: string },
  ): Promise<VisionCompareResult> {
    const apiKey = (this.config.get<string>('VISION_API_KEY') || '').trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: '视觉 AI 服务未配置，已转人工审核',
          provider: 'mock',
        };
      }
      return this.mockResult(samplePhotoUrls);
    }

    const baseUrl = (
      this.config.get<string>('VISION_BASE_URL') ||
      'https://api.siliconflow.cn/v1'
    ).replace(/\/$/, '');
    const model =
      this.config.get<string>('VISION_MODEL') || 'Qwen/Qwen3-VL-8B-Instruct';

    const fieldPhotos = (Array.isArray(photoUrlsInput) ? photoUrlsInput : [photoUrlsInput])
      .map((url) => String(url || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!fieldPhotos.length) {
      return {
        status: CheckResult.ERROR,
        confidence: 0,
        reason: '缺少现场照片，无法分析',
        provider: 'siliconflow',
      };
    }
    const samples = (samplePhotoUrls || []).filter(Boolean).slice(0, 3);

    try {
      // SiliconFlow 必须能直接下载图片。localhost/内网地址和证书异常的
      // 七牛测试域名都无法由模型服务读取，因此在服务端转为 data URL。
      const photoInputs = (
        await Promise.all(
          fieldPhotos.map(async (url) => {
            try {
              return await this.toImageDataUrl(url);
            } catch (err) {
              this.logger.warn(`现场图读取失败，已跳过: ${(err as Error).message}`);
              return null;
            }
          }),
        )
      ).filter((url): url is string => Boolean(url));
      if (!photoInputs.length) {
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: '现场照片无法读取，请重新上传后再分析',
          provider: 'siliconflow',
        };
      }

      const sampleInputs = (
        await Promise.all(
          samples.map(async (url) => {
            try {
              return await this.toImageDataUrl(url);
            } catch (err) {
              this.logger.warn(`样本图读取失败，已跳过: ${(err as Error).message}`);
              return null;
            }
          }),
        )
      ).filter((url): url is string => Boolean(url));

      const criteria = String(checkCriteria || '').trim();
      const remark = String(options?.remark || '').trim();
      const grounding = this.isGroundingCheck(criteria);
      const faultRecord = this.isFaultRecordCheck(criteria);
      const sungrowShot = this.isSungrowShotCheck(criteria);
      const mountFix = this.isMountFixCheck(criteria);
      const dcSide = this.isDcSideCheck(criteria);
      const acSide = this.isAcSideCheck(criteria);
      const hardItem =
        grounding || faultRecord || sungrowShot || mountFix || dcSide || acSide;

      // 故障记录：未凑齐至少 2 张就不调用模型，直接不合格
      if (faultRecord && photoInputs.length < 2) {
        return {
          status: CheckResult.FAIL,
          confidence: 0.98,
          reason:
            '须同时上传「实时故障」与「历史故障」两类截图（至少 2 张），当前张数不足，请补拍后再分析。',
          provider: 'siliconflow',
        };
      }

      // 安装固定：单张侧面无法证明整体牢固
      if (mountFix && photoInputs.length < 2) {
        return {
          status: CheckResult.FAIL,
          confidence: 0.96,
          reason:
            '安装固定检查至少需要 2 张不同角度照片（如正面+侧面，或支架螺栓特写+整机固定），仅一张侧面无法判定整体是否牢固。',
          provider: 'siliconflow',
        };
      }

      const content: Array<Record<string, unknown>> = [
        {
          type: 'text',
          text: [
            '你是光伏/储能设备现场巡检质检助手。',
            '请综合查看全部「现场照片」（可含多角度），并对照「合格样本图」与检查要求，给出一项总结论。',
            '判定原则：',
            '1) 多张现场照是互补证据：关键点可分布在不同照片中；',
            '2) 样本图是合格标准参照：现场须覆盖样本所展示的关键信息与防护状态；禁止把样本里的文字/告警当成现场证据；',
            hardItem
              ? '3) 【本项硬性否决】拿不准、画面不全、关键点不可见必须 fail，禁止“看起来大概合格就 pass”。'
              : '3) 仅当现场照片本身关键缺陷明确、或关键要求明显缺失时才判 fail；拿不准时优先 pass，并在 reason 说明存疑点；',
            '4) 证据越充分（多角度、完整画面）越应提高 confidence；证据不足时降低 confidence 并倾向 fail（硬性项）。',
            faultRecord ? this.faultRecordHardRules() : this.faultRecordSoftHint(),
            grounding ? this.groundingHardRules() : '',
            sungrowShot ? this.sungrowShotHardRules() : '',
            mountFix ? this.mountFixHardRules() : '',
            dcSide ? this.dcSideHardRules() : '',
            acSide ? this.acSideHardRules() : '',
            criteria ? `检查要求：\n${criteria}` : '未提供文字检查要求时，按通用现场质检规范判断。',
            remark ? `工程师备注：${remark}` : '工程师备注：无',
            '只输出 JSON（不要 Markdown）：',
            this.jsonSchemaHint({
              grounding,
              faultRecord,
              sungrowShot,
              mountFix,
              dcSide,
              acSide,
            }),
            sampleInputs.length
              ? hardItem
                ? '已提供合格样本：请逐项对照样本中的关键要素是否在现场图中可见；现场缺失样本中的关键防护/信息 → fail。'
                : '已提供合格样本，请作版式参考，不要过度苛刻。'
              : '无样本时根据检查要求与通用安装规范给出建议结论。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ];

      photoInputs.forEach((photoInput, i) => {
        content.push({
          type: 'text',
          text: this.fieldPhotoLabel({
            index: i,
            total: photoInputs.length,
            faultRecord,
            grounding,
            sungrowShot,
            mountFix,
            dcSide,
            acSide,
          }),
        });
        content.push({
          type: 'image_url',
          image_url: { url: photoInput },
        });
      });

      for (let i = 0; i < sampleInputs.length; i += 1) {
        const sampleLabel =
          (faultRecord || /故障|告警/.test(criteria)) && sampleInputs.length >= 2
            ? i === 0
              ? '【合格样本-实时故障页版式】'
              : i === 1
                ? '【合格样本-历史故障页版式】'
                : `【合格样本 ${i + 1}】`
            : sungrowShot
              ? `【合格样本-阳光云完整截图 ${i + 1}】请对照：现场截图是否同样完整`
              : dcSide
                ? `【合格样本-直流侧 ${i + 1}】请对照：未用端子防护盖是否齐全`
                : acSide
                  ? `【合格样本-交流侧 ${i + 1}】请对照：相线与 PE 是否齐全`
                  : mountFix
                    ? `【合格样本-安装固定 ${i + 1}】请对照：固定点/螺栓是否拍全`
                    : `【合格样本 ${i + 1}】`;
        content.push({ type: 'text', text: sampleLabel });
        content.push({
          type: 'image_url',
          image_url: { url: sampleInputs[i] },
        });
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 512,
          messages: [{ role: 'user', content }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        this.logger.warn(`Vision API ${resp.status}: ${errText.slice(0, 300)}`);
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: `视觉模型调用失败(${resp.status})，请人工判断`,
          provider: 'siliconflow',
        };
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseJsonResult(raw);
      if (!parsed) {
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: `模型返回无法解析：${raw.slice(0, 120)}`,
          provider: 'siliconflow',
        };
      }
      const enforced = grounding
        ? this.enforceGroundingResult(parsed, raw)
        : faultRecord
          ? this.enforceFaultRecordResult(parsed, raw, photoInputs.length)
          : sungrowShot
            ? this.enforceSungrowShotResult(parsed, raw, sampleInputs.length)
            : mountFix
              ? this.enforceMountFixResult(parsed, raw, photoInputs.length)
              : dcSide
                ? this.enforceDcSideResult(parsed, raw, sampleInputs.length)
                : acSide
                  ? this.enforceAcSideResult(parsed, raw)
                  : parsed;
      return { ...enforced, provider: 'siliconflow' };
    } catch (err) {
      this.logger.warn(`Vision 请求异常: ${(err as Error).message}`);
      return {
        status: CheckResult.ERROR,
        confidence: 0,
        reason: '视觉服务异常，请人工判断',
        provider: 'siliconflow',
      };
    }
  }

  /** DeepSeek 润色原因（可选） */
  async polishReason(reason: string, status: string): Promise<string> {
    const apiKey = (
      this.config.get<string>('DEEPSEEK_API_KEY') ||
      this.config.get<string>('VITE_DEEPSEEK_API_KEY') ||
      ''
    ).trim();
    if (!apiKey || !reason) return reason;

    const baseUrl = (
      this.config.get<string>('DEEPSEEK_BASE_URL') ||
      this.config.get<string>('VITE_DEEPSEEK_BASE_URL') ||
      'https://api.deepseek.com'
    ).replace(/\/$/, '');

    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          temperature: 0.2,
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content:
                '你是巡检报告文案助手。把质检结论改写成简洁专业的中文（不超过60字），不要添加新事实。',
            },
            {
              role: 'user',
              content: `结论=${status}；原文=${reason}`,
            },
          ],
        }),
      });
      if (!resp.ok) return reason;
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = (data.choices?.[0]?.message?.content || '').trim();
      return text || reason;
    } catch {
      return reason;
    }
  }

  private isGroundingCheck(criteria: string) {
    return /接地/.test(criteria);
  }

  private isFaultRecordCheck(criteria: string) {
    return /上传故障|故障记录|故障\/告警|实时故障|历史故障/.test(criteria);
  }

  private isSungrowShotCheck(criteria: string) {
    return /阳光云|上传阳光云/.test(criteria);
  }

  private isMountFixCheck(criteria: string) {
    return /安装固定|支架|墙挂固定|安装是否牢固/.test(criteria);
  }

  private isDcSideCheck(criteria: string) {
    return /直流侧/.test(criteria);
  }

  private isAcSideCheck(criteria: string) {
    return /交流侧/.test(criteria);
  }

  private jsonSchemaHint(flags: {
    grounding: boolean;
    faultRecord: boolean;
    sungrowShot: boolean;
    mountFix: boolean;
    dcSide: boolean;
    acSide: boolean;
  }) {
    if (flags.grounding) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"yellowGreenWire":true|false,"groundBarOrTerminal":true|false,"groundLabel":true|false}}';
    }
    if (flags.faultRecord) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"photoTypes":["realtime"|"historical"|"other"],"hasRealtimeFaultShot":true|false,"hasHistoricalFaultShot":true|false,"realtimeHasActiveAlarm":true|false}}';
    }
    if (flags.sungrowShot) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"screenshotComplete":true|false,"serialNumberVisible":true|false,"matchesSampleLayout":true|false}}';
    }
    if (flags.mountFix) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"multiAngleCoverage":true|false,"mountPointsVisible":true|false,"noObviousLooseness":true|false}}';
    }
    if (flags.dcSide) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"connectorsIntact":true|false,"unusedPortsCapped":true|false,"matchesSampleProtection":true|false}}';
    }
    if (flags.acSide) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"phaseWiresOk":true|false,"peWireConnected":true|false,"terminalsCoveredOrProtected":true|false}}';
    }
    return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明"}';
  }

  private fieldPhotoLabel(opts: {
    index: number;
    total: number;
    faultRecord: boolean;
    grounding: boolean;
    sungrowShot: boolean;
    mountFix: boolean;
    dcSide: boolean;
    acSide: boolean;
  }) {
    const n = `【现场照片 ${opts.index + 1}/${opts.total}】`;
    if (opts.faultRecord) {
      return `${n}请先判定本张属于：realtime(实时故障/告警页) / historical(历史故障/告警页) / other(其他)，并写入 evidence.photoTypes[${opts.index}]`;
    }
    if (opts.grounding) {
      return `${n}请仔细寻找黄绿双色线、PE/接地端子与 PE 丝印，即使线很细也要辨认`;
    }
    if (opts.sungrowShot) {
      return `${n}请严格对照样本：是否完整 App 截图（含设备头图/序列号），禁止只拍功率数字半截`;
    }
    if (opts.mountFix) {
      return `${n}请看抱箍/横担螺栓是否清晰；多张有侧面+特写或不同方位即可，勿因线管遮挡某一张就否决全部`;
    }
    if (opts.dcSide) {
      return `${n}已插电缆的 MC4/接头属于在用端子，不要求防尘盖；仅当空闲端口金属触点明显裸露无盖才不合格`;
    }
    if (opts.acSide) {
      return `${n}请检查相线与 PE 接地线是否接好；交流仓内 PE 空端子/未接 PE → 不合格`;
    }
    return opts.total > 1 ? n : '【现场照片】';
  }

  /** 非故障专项时的弱提示，避免误伤其他检查项 */
  private faultRecordSoftHint() {
    return [
      '若本项明显不是故障/告警截图检查，可忽略本段。',
      '若涉及故障页截图：请区分实时故障页与历史故障页；勿把历史告警当成当前告警。',
    ].join('\n');
  }

  private sungrowShotHardRules() {
    return [
      '【上传阳光云截图·硬性否决】',
      '必须严格对照合格样本的完整度，禁止“有几个功率数字就算完整”。',
      'screenshotComplete=true 的最低要求（现场照片像素内须同时具备）：',
      '1) 顶部设备信息区：机型/设备名、运行状态，且能读到序列号（S/N、序列号等）；',
      '2) 中部关键运行数据区；',
      '3) 能看出是完整 App 页面结构（如顶栏或底栏导航），不是从屏幕中间抠出来的局部卡片。',
      'screenshotComplete=false（必须 fail）典型情况：',
      '- 只有功率/电量四宫格数字，看不到序列号与设备头图；',
      '- 明显半截、左右或上下被裁切，与样本完整手机截图差很多；',
      '- 画面像局部放大/二次裁剪，缺少样本中同级的页面元素。',
      'serialNumberVisible：序列号必须在现场图中清晰可读，禁止根据样本或想象补全；看不见 → false。',
      'matchesSampleLayout：有合格样本时，现场完整度须与样本同级；样本是整屏而现场是半截/局部 → false。',
      '仅当 screenshotComplete、serialNumberVisible 均为 true，且（无样本或 matchesSampleLayout=true）才允许 pass。',
    ].join('\n');
  }

  private mountFixHardRules() {
    return [
      '【安装固定检查·硬性否决】',
      '至少 2 张照片。',
      'multiAngleCoverage=true：照片在方位或景别上有差异即可，例如「支架/螺栓特写 + 整机侧面」「左侧 + 背面/另一侧」。',
      '不必强求正面全身照；杆上逆变器常见以侧面+背面/抱箍特写即可。',
      '仅当多张照片构图几乎完全相同（同一侧连拍）时，multiAngleCoverage 才为 false。',
      'mountPointsVisible=true：只要任意一张能清晰看到抱箍、横担、螺栓螺母或墙挂固定件即可。',
      '个别照片被线管/电杆遮挡没关系，以拍清固定点的那张为准。',
      'noObviousLooseness：未见明显松动、倾斜、支架开裂则可 true。',
      '不要因为“不够完美的展览级多角度”而否决已经拍到抱箍螺栓的现场图。',
    ].join('\n');
  }

  private dcSideHardRules() {
    return [
      '【直流侧安装检查·硬性否决】',
      '重点区分「在用接头」与「空闲未用端子」，禁止把已插线的 MC4 当成未盖防护盖。',
      'connectorsIntact：可见的直流接头/MC4 已插接到位，线缆固定，无破损烧蚀进水 → true。',
      'unusedPortsCapped=true 的合法情况（满足其一即可）：',
      '1) 画面中所有可见空闲（未插线）直流端口都有防尘盖（蓝/红/黑等）；',
      '2) 画面中可见直流端口均已插接在用，没有空闲裸露端口；',
      '3) 角度有限看不清是否还有空闲端口，但已见接头插接正常、未见明显空闲金属触点裸露。',
      'unusedPortsCapped=false（必须 fail）仅当：能清楚看到空闲未插线的直流端口，且金属触点/端口明显裸露、没有防尘盖。',
      '禁止误判：黑色 MC4 塑料外壳、已插上的接头尾端、线缆护套 ≠ 未盖防护的裸露端子。',
      'matchesSampleProtection：仅在有合格样本时对比；无样本则忽略该项，不要因此 fail。',
      '拿不准时：若 connectorsIntact=true 且未见明确空闲裸露端口 → unusedPortsCapped=true，优先 pass。',
    ].join('\n');
  }

  private acSideHardRules() {
    return [
      '【交流侧安装检查·硬性否决】',
      '交流侧除相线外，必须看到 PE 接地线已可靠接入（黄绿双色线接到 PE 端子，或铜编织带接到 PE）。',
      'peWireConnected=false 的典型情况：只见 L1/L2/L3（黄/绿/红相线色环）而 PE 端子空着、无黄绿线/无接地编织带。',
      '未接 PE 属于明显安全缺陷，即使相线看起来整齐也必须 fail。',
      'terminalsCoveredOrProtected：可触及的带电端子应有透明罩/防护；严重裸露且无防护可 fail。',
      '仅当 phaseWiresOk 与 peWireConnected 均为 true 才允许 pass。',
    ].join('\n');
  }

  private enforceEvidencePass(
    parsed: Omit<VisionCompareResult, 'provider'>,
    missing: string[],
    passReason: string,
    reported: boolean,
  ): Omit<VisionCompareResult, 'provider'> {
    if (missing.length > 0) {
      const detail = reported
        ? `现场不满足：${missing.join('、')}`
        : `模型未逐项确认关键证据（视为缺失：${missing.join('、')}）`;
      return {
        status: CheckResult.FAIL,
        confidence: Math.min(parsed.confidence, 0.95),
        reason: `${detail}。`,
      };
    }
    return {
      status: CheckResult.PASS,
      confidence: Math.max(parsed.confidence, 0.88),
      reason:
        parsed.status === CheckResult.PASS && parsed.reason
          ? parsed.reason
          : passReason,
    };
  }

  private parseBoolEvidence(raw: string, keys: string[]): {
    values: Record<string, boolean>;
    reported: boolean;
  } {
    const values: Record<string, boolean> = {};
    for (const k of keys) values[k] = false;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { values, reported: false };
    try {
      const obj = JSON.parse(match[0]) as { evidence?: Record<string, unknown> };
      const ev = obj.evidence;
      if (!ev || typeof ev !== 'object') return { values, reported: false };
      const asBool = (v: unknown) =>
        v === true || v === 'true' || v === 1 || v === '1';
      for (const k of keys) values[k] = asBool(ev[k]);
      return { values, reported: true };
    } catch {
      return { values, reported: false };
    }
  }

  private enforceSungrowShotResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    sampleCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    const { values, reported } = this.parseBoolEvidence(raw, [
      'screenshotComplete',
      'serialNumberVisible',
      'matchesSampleLayout',
    ]);
    const text = `${parsed.reason || ''} ${raw}`;
    // 文案自相矛盾：一边说半截/裁切，一边又给 complete=true → 强制否决
    if (
      values.screenshotComplete &&
      /半截|裁切|不完整|只有.*数字|局部|差很多|看不到序列号|未见序列号/.test(text)
    ) {
      values.screenshotComplete = false;
    }
    const missing: string[] = [];
    if (!values.screenshotComplete) {
      missing.push('完整阳光云页面（不可半截/局部裁切）');
    }
    if (!values.serialNumberVisible) missing.push('清晰可读的设备序列号');
    if (sampleCount > 0 && !values.matchesSampleLayout) {
      missing.push('与合格样本同级的完整版式');
    }
    return this.enforceEvidencePass(
      parsed,
      missing,
      '阳光云截图完整、序列号清晰，且与样本版式匹配，合格。',
      reported,
    );
  }

  private enforceMountFixResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    photoCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    if (photoCount < 2) {
      return {
        status: CheckResult.FAIL,
        confidence: 0.96,
        reason:
          '安装固定检查至少需要 2 张照片（特写+侧面或不同方位），仅一张无法判定整体是否牢固。',
      };
    }
    const { values, reported } = this.parseBoolEvidence(raw, [
      'multiAngleCoverage',
      'mountPointsVisible',
      'noObviousLooseness',
    ]);
    const text = `${parsed.reason || ''} ${raw}`;
    const sameAngle =
      /构图相同|同一角度|几乎一样|重复拍摄|角度相同|连拍同侧/.test(text);
    const affirmsMount =
      /抱箍|横担|螺栓|螺母|支架|固定点|抱杆/.test(text) &&
      !/未见.*(?:抱箍|螺栓|支架|固定)|缺少.*(?:抱箍|螺栓|支架|固定)/.test(text);

    // 3 张及以上且未明确“同角度连拍”时，视为已具备多角度/多景别
    if (photoCount >= 3 && !sameAngle) {
      values.multiAngleCoverage = true;
    }
    // 文案已承认见到抱箍/螺栓时，纠正漏标
    if (!values.mountPointsVisible && affirmsMount) {
      values.mountPointsVisible = true;
    }
    // 2 张且固定点清晰时，不过度苛求“展览级多角度”
    if (
      photoCount >= 2 &&
      values.mountPointsVisible &&
      !sameAngle &&
      !values.multiAngleCoverage
    ) {
      values.multiAngleCoverage = true;
    }

    const missing: string[] = [];
    if (!values.multiAngleCoverage) {
      missing.push('不同方位或景别（勿同侧连拍相同构图）');
    }
    if (!values.mountPointsVisible) {
      missing.push('可见抱箍/螺栓/支架固定点');
    }
    if (reported && values.noObviousLooseness === false) {
      // 仅当模型明确给出 false 时才作为缺陷；缺省 false 在上面 parse 里不好区分
    }
    // noObviousLooseness：若 evidence 显式为 false（且 reported），加入缺失
    if (reported && /noObviousLooseness"\s*:\s*false/.test(raw)) {
      missing.push('存在明显松动/倾斜风险');
    }

    return this.enforceEvidencePass(
      parsed,
      missing,
      '已拍摄多张安装固定照片，抱箍/螺栓等固定点可见，未见明显松动，合格。',
      reported,
    );
  }

  private enforceDcSideResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    sampleCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    const { values, reported } = this.parseBoolEvidence(raw, [
      'connectorsIntact',
      'unusedPortsCapped',
      'matchesSampleProtection',
    ]);
    // 模型未给出结构化证据时，不因默认 false 硬否决（避免把在用 MC4 误杀）
    if (!reported) {
      if (parsed.status === CheckResult.FAIL) {
        const reason = parsed.reason || '';
        // 常见误杀话术：把已插接头说成「未使用防护盖」
        if (/防护盖|防尘盖|裸露/.test(reason) && !/空闲|未插|未使用端子/.test(reason)) {
          return {
            status: CheckResult.PASS,
            confidence: Math.max(parsed.confidence, 0.8),
            reason:
              '现场直流接头已插接，未见明确空闲裸露端口；已按在用端子规则放宽为合格。',
          };
        }
      }
      return parsed;
    }

    const missing: string[] = [];
    // 仅当模型明确给出 unusedPortsCapped=false 才否决
    if (reported && /unusedPortsCapped"\s*:\s*false/.test(raw)) {
      missing.push('空闲未用端子防护盖（明确裸露未盖）');
    }
    if (reported && /connectorsIntact"\s*:\s*false/.test(raw)) {
      missing.push('直流接头完好插接到位');
    }
    if (
      sampleCount > 0 &&
      reported &&
      /matchesSampleProtection"\s*:\s*false/.test(raw)
    ) {
      missing.push('与合格样本一致的端子防护状态');
    }
    return this.enforceEvidencePass(
      parsed,
      missing,
      '直流侧接头完好插接，未见空闲裸露端口，合格。',
      reported,
    );
  }

  private enforceAcSideResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
  ): Omit<VisionCompareResult, 'provider'> {
    const { values, reported } = this.parseBoolEvidence(raw, [
      'phaseWiresOk',
      'peWireConnected',
      'terminalsCoveredOrProtected',
    ]);
    const missing: string[] = [];
    if (!values.peWireConnected) missing.push('PE 接地线已接入');
    if (!values.phaseWiresOk) missing.push('相线接线正常');
    return this.enforceEvidencePass(
      parsed,
      missing,
      '交流侧相线与 PE 接地线接线完整，合格。',
      reported,
    );
  }

  private faultRecordHardRules() {
    return [
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
    ].join('\n');
  }

  /** 服务端强制：实时+历史双截图，缺一不可 */
  private enforceFaultRecordResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    photoCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    if (photoCount < 2) {
      return {
        status: CheckResult.FAIL,
        confidence: 0.98,
        reason:
          '须同时上传「实时故障」与「历史故障」两类截图（至少 2 张），当前张数不足，请补拍后再分析。',
      };
    }

    const evidence = this.parseFaultRecordEvidence(raw);
    const missing: string[] = [];
    if (!evidence.hasRealtimeFaultShot) missing.push('实时故障截图');
    if (!evidence.hasHistoricalFaultShot) missing.push('历史故障截图');

    if (missing.length > 0) {
      const detail = evidence.reported
        ? `现场未见：${missing.join('、')}${
            evidence.photoTypes.length
              ? `（各图判定：${evidence.photoTypes.join('、')}）`
              : ''
          }`
        : `模型未逐项确认双页截图（视为缺失：${missing.join('、')}）`;
      return {
        status: CheckResult.FAIL,
        confidence: Math.min(parsed.confidence, 0.95),
        reason: `${detail}。须各至少一张「实时故障」和「历史故障」页面截图；两张都是历史、或实时页未拍到，都不能合格。`,
      };
    }

    if (evidence.realtimeHasActiveAlarm) {
      return {
        status: CheckResult.FAIL,
        confidence: Math.max(parsed.confidence, 0.85),
        reason:
          parsed.reason ||
          '实时故障页仍有未恢复严重告警，判定不合格；请处理告警或在备注说明处置情况后重拍。',
      };
    }

    return {
      status: CheckResult.PASS,
      confidence: Math.max(parsed.confidence, 0.88),
      reason:
        parsed.status === CheckResult.PASS && parsed.reason
          ? parsed.reason
          : '已同时上传实时故障与历史故障截图；实时页无未恢复严重告警，合格。',
    };
  }

  private parseFaultRecordEvidence(raw: string): {
    hasRealtimeFaultShot: boolean;
    hasHistoricalFaultShot: boolean;
    realtimeHasActiveAlarm: boolean;
    photoTypes: string[];
    reported: boolean;
  } {
    const empty = {
      hasRealtimeFaultShot: false,
      hasHistoricalFaultShot: false,
      realtimeHasActiveAlarm: false,
      photoTypes: [] as string[],
      reported: false,
    };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    try {
      const obj = JSON.parse(match[0]) as {
        evidence?: Record<string, unknown>;
      };
      const ev = obj.evidence;
      if (!ev || typeof ev !== 'object') return empty;
      const asBool = (v: unknown) =>
        v === true || v === 'true' || v === 1 || v === '1';

      const rawTypes = Array.isArray(ev.photoTypes) ? ev.photoTypes : [];
      const photoTypes = rawTypes.map((t) => {
        const s = String(t || '').toLowerCase();
        if (/real|实时/.test(s)) return 'realtime';
        if (/hist|历史/.test(s)) return 'historical';
        return 'other';
      });

      let hasRealtimeFaultShot =
        asBool(ev.hasRealtimeFaultShot ?? ev.实时故障 ?? ev.实时故障截图) ||
        photoTypes.includes('realtime');
      let hasHistoricalFaultShot =
        asBool(ev.hasHistoricalFaultShot ?? ev.历史故障 ?? ev.历史故障截图) ||
        photoTypes.includes('historical');

      return {
        hasRealtimeFaultShot,
        hasHistoricalFaultShot,
        realtimeHasActiveAlarm: asBool(
          ev.realtimeHasActiveAlarm ?? ev.实时仍有告警 ?? ev.有未恢复告警,
        ),
        photoTypes,
        reported: true,
      };
    } catch {
      return empty;
    }
  }

  private groundingHardRules() {
    return [
      '【接地安装检查·硬性否决 — 覆盖通用“拿不准优先 pass”】',
      '现场照片中必须同时清晰看到以下三项，缺任何一项 → status 必须为 fail：',
      'A) 黄绿双色接地线：绝缘皮为黄绿相间双色。可细可短；可出现在箱内或箱外支架/机壳螺栓上；深色背景下的细黄绿线也要认出来。不是单独黄色/绿色相线，也不是线缆单色色环。',
      'B) 接地排或接地端子：接地铜排、汇流排、PE 螺栓端子、铜编织带接地点、机壳接地螺栓等。',
      'C) 接地标识：面板丝印/打印「PE」「GND」「EARTH」「接地」、接地符号或贴纸；字小也算。',
      '特别提醒：',
      '- 背板印刷的 PE = 有效接地标识，禁止判“标识缺失”；',
      '- 户外支架上的黄绿双色细线 = 有效黄绿接地线，禁止因“线细/在箱外”判缺失；',
      '- 铜编织带接到 PE 端子 = 有效接地端子。',
      '高压三角警示牌、仅箱门外壳、相线 L1/L2/L3 色环 ≠ 接地证据。',
      '仅当 evidence 三项均为 true 才允许 pass；否则 fail，并写明缺哪几项。',
    ].join('\n');
  }

  /** 服务端强制：接地三要素缺一不可；三项齐时不得因模型犹豫仍判不合格 */
  private enforceGroundingResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
  ): Omit<VisionCompareResult, 'provider'> {
    const evidence = this.parseGroundingEvidence(raw, parsed.reason);
    const missing: string[] = [];
    if (!evidence.yellowGreenWire) missing.push('黄绿双色接地线');
    if (!evidence.groundBarOrTerminal) missing.push('接地排/端子');
    if (!evidence.groundLabel) missing.push('接地标识');

    if (missing.length > 0) {
      const detail =
        evidence.reported
          ? `现场未见：${missing.join('、')}`
          : `模型未逐项确认接地证据（视为缺失：${missing.join('、')}）`;
      return {
        status: CheckResult.FAIL,
        confidence: Math.min(parsed.confidence, 0.92),
        reason: `${detail}。接地安装须同时具备黄绿双色接地线、接地排/端子与接地标识（含 PE 丝印），缺一不合格。`,
      };
    }

    // 三项证据齐全时强制合格，避免模型仍写「标识缺失」
    return {
      status: CheckResult.PASS,
      confidence: Math.max(parsed.confidence, 0.88),
      reason:
        parsed.status === CheckResult.PASS && parsed.reason
          ? parsed.reason
          : '已确认黄绿双色接地线、接地排/端子与接地标识（含 PE 等）均可见，符合要求。',
    };
  }

  private parseGroundingEvidence(
    raw: string,
    reason = '',
  ): {
    yellowGreenWire: boolean;
    groundBarOrTerminal: boolean;
    groundLabel: boolean;
    reported: boolean;
  } {
    const empty = {
      yellowGreenWire: false,
      groundBarOrTerminal: false,
      groundLabel: false,
      reported: false,
    };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    try {
      const obj = JSON.parse(match[0]) as {
        reason?: string;
        evidence?: {
          yellowGreenWire?: unknown;
          groundBarOrTerminal?: unknown;
          groundLabel?: unknown;
          黄绿双色接地线?: unknown;
          接地排?: unknown;
          接地端子?: unknown;
          接地标识?: unknown;
        };
      };
      const ev = obj.evidence;
      if (!ev || typeof ev !== 'object') return empty;
      const asBool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
      let yellowGreenWire = asBool(ev.yellowGreenWire ?? ev.黄绿双色接地线);
      let groundBarOrTerminal = asBool(
        ev.groundBarOrTerminal ?? ev.接地排 ?? ev.接地端子,
      );
      let groundLabel = asBool(ev.groundLabel ?? ev.接地标识);

      const text = `${obj.reason || ''} ${reason} ${raw}`;
      const deniesYellowGreen =
        /缺少黄绿|未见黄绿|无黄绿双色|没有黄绿|黄绿双色接地线缺失/.test(text);
      const affirmsYellowGreen =
        /黄绿双色|黄绿相间|黄绿(?:色)?(?:接地)?线/.test(text) &&
        /可见|有|存在|清晰|已确认|已看到/.test(text);

      // 文案承认见到黄绿线但 evidence 漏标 → 纠偏；纯“缺少黄绿”不纠偏
      if (!yellowGreenWire && affirmsYellowGreen && !deniesYellowGreen) {
        yellowGreenWire = true;
      }

      // 模型口头承认见到 PE/接地标识，但 evidence 漏标时纠偏
      if (
        !groundLabel &&
        /(?:可见|有|存在|标有|丝印|打印)?\s*PE\b|接地标识|接地符号|GND|EARTH/.test(
          text,
        ) &&
        !/PE\s*缺失|无\s*PE|未见\s*PE|没有\s*PE|标识缺失|未见接地标识/.test(text)
      ) {
        if (/\bPE\b|接地标识|接地符号|GND|EARTH/.test(text)) {
          groundLabel = true;
        }
      }
      if (
        /标识缺失|未见接地标识/.test(text) &&
        /(?:可见|清晰|有)\s*PE|\bPE\b.*(?:标识|丝印|字样)|PE\s*(?:标识|丝印|字样)/.test(
          text,
        )
      ) {
        groundLabel = true;
      }

      return {
        yellowGreenWire,
        groundBarOrTerminal,
        groundLabel,
        reported: true,
      };
    } catch {
      return empty;
    }
  }

  private toAbsoluteUrl(url: string) {
    if (/^https?:\/\//i.test(url)) return url;
    const publicBase = (
      this.config.get<string>('PUBLIC_ASSET_BASE') ||
      this.config.get<string>('QINIU_DOMAIN') ||
      ''
    ).replace(/\/$/, '');
    if (publicBase && url.startsWith('/')) return `${publicBase}${url}`;
    if (publicBase) return `${publicBase}/${url}`;
    return url;
  }

  private async toImageDataUrl(input: string): Promise<string> {
    if (/^data:image\//i.test(input)) return input;

    const absolute = this.toAbsoluteUrl(input);
    if (!/^https?:\/\//i.test(absolute)) {
      throw new Error('图片地址不是可下载的 HTTP(S) 地址');
    }

    const candidates = [absolute];
    // 七牛测试域名通常只支持 HTTP，其 HTTPS 证书会被 Node 和浏览器拒绝。
    if (/^https:\/\/[^/]+\.clouddn\.com\//i.test(absolute)) {
      candidates.push(absolute.replace(/^https:/i, 'http:'));
    }

    let lastError: Error | null = null;
    for (const url of candidates) {
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          redirect: 'follow',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const contentType = (resp.headers.get('content-type') || 'image/jpeg')
          .split(';')[0]
          .trim();
        if (!contentType.startsWith('image/')) {
          throw new Error(`响应不是图片: ${contentType}`);
        }

        const contentLength = Number(resp.headers.get('content-length') || 0);
        if (contentLength > 12 * 1024 * 1024) {
          throw new Error('图片超过 12MB');
        }
        const bytes = Buffer.from(await resp.arrayBuffer());
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) {
          throw new Error('图片为空或超过 12MB');
        }
        return `data:${contentType};base64,${bytes.toString('base64')}`;
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`图片下载失败: ${lastError?.message || '未知错误'}`);
  }

  private parseJsonResult(raw: string): Omit<VisionCompareResult, 'provider'> | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]) as {
        status?: string;
        confidence?: number;
        reason?: string;
      };
      const st = String(obj.status || '').toLowerCase();
      const status =
        st === 'pass' || st === '合格' || st === 'ok'
          ? CheckResult.PASS
          : st === 'fail' || st === '不合格' || st === 'ng'
            ? CheckResult.FAIL
            : null;
      if (!status) return null;
      const confidence = Math.max(
        0,
        Math.min(1, Number(obj.confidence ?? 0.7) || 0.7),
      );
      return {
        status,
        confidence: Number(confidence.toFixed(2)),
        reason: String(obj.reason || '').slice(0, 300) || '已完成图像对比',
      };
    } catch {
      return null;
    }
  }

  private mockResult(samplePhotoUrls: string[]): VisionCompareResult {
    const hasSample = (samplePhotoUrls || []).length > 0;
    return {
      status: hasSample ? CheckResult.PASS : CheckResult.FAIL,
      confidence: 0.75,
      reason: hasSample
        ? '未配置 VISION_API_KEY，返回模拟合格结果'
        : '未配置 VISION_API_KEY，且无样本图，返回模拟不合格',
      provider: 'mock',
    };
  }
}
