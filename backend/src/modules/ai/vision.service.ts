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

      const content: Array<Record<string, unknown>> = [
        {
          type: 'text',
          text: [
            '你是光伏/储能设备现场巡检质检助手。',
            '请综合查看全部「现场照片」（可含多角度），并参考「合格样本图」与检查要求，给出一项总结论。',
            '判定原则：',
            '1) 多张现场照是互补证据：某一张拍到关键信息即可，不必每张都与样本长得一模一样；',
            '2) 样本图只作版式/角度参考，禁止把样本图里的文字、告警、缺陷当成现场证据；',
            grounding || faultRecord
              ? '3) 【本项例外】硬性否决项：拿不准或缺证据必须 fail，禁止“看起来大概合格就 pass”。'
              : '3) 仅当现场照片本身关键缺陷明确、或关键要求明显缺失时才判 fail；拿不准时优先 pass，并在 reason 说明存疑点；',
            '4) 证据越充分（多角度覆盖）越应提高 confidence。',
            faultRecord ? this.faultRecordHardRules() : this.faultRecordSoftHint(),
            grounding ? this.groundingHardRules() : '',
            criteria ? `检查要求：\n${criteria}` : '未提供文字检查要求时，按通用现场质检规范判断。',
            remark ? `工程师备注：${remark}` : '工程师备注：无',
            '只输出 JSON（不要 Markdown）：',
            grounding
              ? '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"yellowGreenWire":true|false,"groundBarOrTerminal":true|false,"groundLabel":true|false}}'
              : faultRecord
                ? '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"photoTypes":["realtime"|"historical"|"other"],"hasRealtimeFaultShot":true|false,"hasHistoricalFaultShot":true|false,"realtimeHasActiveAlarm":true|false}}'
                : '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明"}',
            sampleInputs.length
              ? grounding
                ? '已提供合格样本，仅作角度/构图参考；现场照仍必须独立满足三项接地证据，不可因样本存在而放宽。'
                : faultRecord
                  ? '已提供合格样本，第1张多为实时页版式、第2张多为历史页版式；现场仍须各自上传对应截图，不可因样本存在而放宽。'
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
          text: faultRecord
            ? `【现场照片 ${i + 1}/${photoInputs.length}】请先判定本张属于：realtime(实时故障/告警页) / historical(历史故障/告警页) / other(其他)，并写入 evidence.photoTypes[${i}]`
            : grounding
              ? `【现场照片 ${i + 1}/${photoInputs.length}】请仔细寻找黄绿双色线、PE/接地端子与 PE 丝印，即使线很细也要辨认`
              : photoInputs.length > 1
                ? `【现场照片 ${i + 1}/${photoInputs.length}】`
                : '【现场照片】',
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

  /** 非故障专项时的弱提示，避免误伤其他检查项 */
  private faultRecordSoftHint() {
    return [
      '若本项明显不是故障/告警截图检查，可忽略本段。',
      '若涉及故障页截图：请区分实时故障页与历史故障页；勿把历史告警当成当前告警。',
    ].join('\n');
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
