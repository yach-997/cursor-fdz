import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
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
  private readonly imageDataCache = new Map<string, { dataUrl: string; expiresAt: number }>();
  private readonly imageDownloadInFlight = new Map<string, Promise<string>>();

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
      this.config.get<string>('VISION_BASE_URL') || 'https://api.siliconflow.cn/v1'
    ).replace(/\/$/, '');
    const model = this.config.get<string>('VISION_MODEL') || 'Qwen/Qwen3-VL-8B-Instruct';

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
      const hardItem = grounding || faultRecord || sungrowShot || mountFix || dcSide || acSide;

      // 关键检查项配置了标准图但读取失败时，禁止绕过标准继续自动判定。
      if (hardItem && samples.length > 0 && sampleInputs.length !== samples.length) {
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: '合格标准图读取不完整，已转人工判断，请稍后重新分析',
          provider: 'siliconflow',
        };
      }

      // 现场图与标准图逐张近乎一致时使用确定性结果，不再让模型把标准图本身误判为缺陷。
      // 必须数量相同、每张标准图均匹配不同现场图；存在额外现场图时仍交给 AI 全量检查。
      const sampleMatch = await this.matchExactSampleSet(photoInputs, sampleInputs);
      if (sampleMatch.matched) {
        return {
          status: CheckResult.PASS,
          confidence: 0.99,
          reason: `现场照片与合格标准图逐张一致（最低相似度 ${Math.round(
            sampleMatch.minSimilarity * 100,
          )}%），符合要求。`,
          provider: 'siliconflow',
        };
      }

      if (grounding && sampleInputs.length >= 2 && photoInputs.length < 2) {
        return {
          status: CheckResult.FAIL,
          confidence: 0.98,
          reason: '接地安装须分别上传箱内主PE连接和箱外机壳接地照片，当前照片不完整。',
          provider: 'siliconflow',
        };
      }

      // 接地检查使用专用的逐照片双连接点审核即可。此前先走通用识别、再走专用复核，
      // 会产生两次串行大模型请求，既增加等待时间，也放大上游偶发超时的概率。
      if (grounding) {
        const checked = await this.auditGroundingConnections({
          apiKey,
          baseUrl,
          model,
          photoInputs,
          sampleInputs,
        });
        return { ...checked, provider: 'siliconflow' };
      }

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
            faultRecord
              ? this.faultRecordHardRules(photoInputs.length)
              : this.faultRecordSoftHint(),
            grounding ? this.groundingHardRules(photoInputs.length, sampleInputs.length) : '',
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
            : grounding
              ? `【合格标准图·接地视角 ${i + 1}】请根据图像内容自行判断是箱内主PE还是箱外机壳接地，禁止按序号猜测`
              : sungrowShot
                ? `【合格样本-阳光云完整截图 ${i + 1}】请对照：现场截图是否同样完整`
                : dcSide
                  ? `【合格样本-直流侧 ${i + 1}】对照：未插线空闲孔均有蓝/红/橙盖；有盖=合格，无盖黑洞=不合格`
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

      const raw = await this.callVisionChat({
        apiKey,
        baseUrl,
        model,
        content,
        temperature: 0.1,
        maxTokens: 512,
        timeoutMs: 75_000,
        label: dcSide ? 'dc-main' : acSide ? 'ac-main' : 'vision-main',
      });
      const parsed = this.parseJsonResult(raw);
      if (!parsed) {
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: `模型返回无法解析：${raw.slice(0, 120)}`,
          provider: 'siliconflow',
        };
      }
      let enforced = grounding
        ? this.enforceGroundingResult(parsed, raw, photoInputs.length, sampleInputs.length)
        : faultRecord
          ? this.enforceFaultRecordResult(parsed, raw, photoInputs.length)
          : sungrowShot
            ? this.enforceSungrowShotResult(parsed, raw, sampleInputs.length)
            : mountFix
              ? this.enforceMountFixResult(parsed, raw, photoInputs.length)
              : dcSide
                ? this.enforceDcSideResult(parsed, raw, sampleInputs.length)
                : acSide
                  ? this.enforceAcSideResult(parsed, raw, sampleInputs.length)
                  : parsed;
      // 直流侧首轮合格时再做放大复核；复核服务异常时回退首轮结论，避免整项分析失败。
      if (dcSide && enforced.status === CheckResult.PASS) {
        enforced = await this.auditDcUnusedPorts({
          apiKey,
          baseUrl,
          model,
          photoInputs,
          original: enforced,
        });
      }
      return { ...enforced, provider: 'siliconflow' };
    } catch (err) {
      this.logger.warn(`Vision 请求异常: ${(err as Error).message}`);
      return {
        status: CheckResult.ERROR,
        confidence: 0,
        reason: '视觉服务异常，请人工判断或稍后点「重新分析」',
        provider: 'siliconflow',
      };
    }
  }

  /** 带重试的多模态调用（应对超时 / 429 / 5xx） */
  private async callVisionChat(args: {
    apiKey: string;
    baseUrl: string;
    model: string;
    content: Array<Record<string, unknown>>;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    label?: string;
  }): Promise<string> {
    const timeoutMs = args.timeoutMs ?? 60_000;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const resp = await fetch(`${args.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: args.model,
            temperature: args.temperature ?? 0.1,
            max_tokens: args.maxTokens ?? 512,
            messages: [{ role: 'user', content: args.content }],
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          const retryable = resp.status === 429 || resp.status >= 500;
          this.logger.warn(
            `Vision API ${args.label || ''} ${resp.status} (try ${attempt}): ${errText.slice(0, 200)}`,
          );
          if (!retryable || attempt >= 3) {
            throw new Error(`视觉模型调用失败(${resp.status})`);
          }
          await this.sleep(attempt * 800);
          continue;
        }
        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return data.choices?.[0]?.message?.content || '';
      } catch (err) {
        lastError = err as Error;
        const msg = lastError.message || '';
        const retryable =
          /timeout|aborted|ECONNRESET|ETIMEDOUT|fetch failed|429|5\d\d/i.test(msg) ||
          lastError.name === 'TimeoutError' ||
          lastError.name === 'AbortError';
        this.logger.warn(
          `Vision chat ${args.label || ''} try ${attempt} failed: ${msg.slice(0, 160)}`,
        );
        if (!retryable || attempt >= 3) throw lastError;
        await this.sleep(attempt * 800);
      }
    }
    throw lastError || new Error('视觉模型调用失败');
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
    const title = this.checkTitle(criteria);
    return /^(?:接地安装检查|接地检查)$/.test(title);
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
    return /直流侧/.test(this.checkTitle(criteria));
  }

  private isAcSideCheck(criteria: string) {
    return /交流侧/.test(this.checkTitle(criteria));
  }

  private checkTitle(criteria: string) {
    return String(criteria || '')
      .split(/\r?\n/, 1)[0]
      .trim();
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
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文，必须逐张说明","evidence":{"photoTypes":["internal_main_pe"|"external_chassis_ground"|"other"],"photoChecks":[{"photoIndex":1,"type":"internal_main_pe|external_chassis_ground|other","internalMainPeConnected":true|false,"externalGroundConnected":true|false,"wireAndTerminalVisibleInSamePhoto":true|false,"reason":"本张独立结论"}],"hasInternalMainPePhoto":true|false,"internalMainPeConnected":true|false,"hasExternalGroundPhoto":true|false,"externalGroundConnected":true|false,"matchesSampleViews":true|false}}';
    }
    if (flags.faultRecord) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"photoTypes":["realtime"|"historical"|"other"],"hasRealtimeFaultShot":true|false,"hasHistoricalFaultShot":true|false,"realtimeHasActiveAlarm":true|false}}';
    }
    if (flags.sungrowShot) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须写明缺失区域","evidence":{"screenshotComplete":true|false,"serialNumberVisible":true|false,"topSectionVisible":true|false,"bottomContentVisible":true|false,"requiredSectionsCovered":true|false,"croppedOrPartial":true|false,"matchesSampleLayout":true|false,"photoFindings":["第1张：实际可见区域"]}}';
    }
    if (flags.mountFix) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明","evidence":{"multiAngleCoverage":true|false,"mountPointsVisible":true|false,"noObviousLooseness":true|false}}';
    }
    if (flags.dcSide) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须写明照片序号和端口位置","evidence":{"connectorsIntact":true|false,"unusedPortsCapped":true|false,"allPortsIndividuallyAccountedFor":true|false,"visibleUnusedPortCount":0,"uncappedUnusedPortCount":0,"matchesSampleProtection":true|false,"photoFindings":["第1张：空闲孔及封盖情况"]}}';
    }
    if (flags.acSide) {
      return '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明，必须区分主PE铜芯线/铜编织带与柜门黄绿跳线","evidence":{"phaseWiresOk":true|false,"sampleRequiresCopperPe":true|false,"mainCopperPeConductorVisible":true|false,"mainCopperPeTerminationVisible":true|false,"mainPeConductorVisible":true|false,"mainPeTerminationVisible":true|false,"doorBondingJumperOnly":true|false,"peWireConnected":true|false,"terminalsCoveredOrProtected":true|false,"photoFindings":["第1张：主PE铜芯线或铜编织带及其压接位置"]}}';
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
      return `${n}必须只根据本张照片独立判断并写入 evidence.photoChecks[${opts.index}]：箱内主PE需看到铜芯线/铜编织带接入PE端；箱外接地需看到黄绿线实际连接机壳/支架。禁止跨照片拼接线、端子和PE标识。`;
    }
    if (opts.sungrowShot) {
      return `${n}请严格对照样本：是否完整 App 截图（含设备头图/序列号），禁止只拍功率数字半截`;
    }
    if (opts.mountFix) {
      return `${n}请看抱箍/横担螺栓是否清晰；多张有侧面+特写或不同方位即可，勿因线管遮挡某一张就否决全部`;
    }
    if (opts.dcSide) {
      return `${n}逐端口向下追踪：有电缆连续伸出才算在用；黑色接头末端呈圆形开口且无电缆仍是无盖空闲孔。有蓝/红/橙盖才算已封盖。`;
    }
    if (opts.acSide) {
      return `${n}重点检查主PE：寻找从主电缆引出并压接到“PE”端子的铜芯接地线/裸铜编织带。柜门上的细黄绿跳线只是门板等电位连接，不能替代主PE。`;
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
    ].join('\n');
  }

  private acSideHardRules() {
    return [
      '【交流侧安装检查·硬性否决】',
      '本项检查的是主保护接地：必须看到主电缆中的铜芯接地线/裸铜编织带，实际压接并紧固到标有“PE”的主接地端子。',
      '柜门右上角或门铰链附近的细黄绿跳线只是柜门等电位连接线，不能替代主PE；只看到该跳线时 doorBondingJumperOnly=true，必须 fail。',
      '合格样本若显示裸铜编织带接PE螺栓，则 sampleRequiresCopperPe=true，现场必须看到同类铜芯线/铜编织带及其PE端压接点。',
      '只看到 PE 字样、空螺栓、三根相线或柜门黄绿跳线，不算主PE已连接。',
      'peWireConnected=false 的典型情况：只见 L1/L2/L3，而PE标签旁螺栓为空，未见铜芯接地线/铜编织带接入。',
      '未接 PE 属于明显安全缺陷，即使相线看起来整齐也必须 fail。',
      'terminalsCoveredOrProtected：可触及的带电端子应有透明罩/防护；严重裸露且无防护可 fail。',
      'mainPeConductorVisible、mainPeTerminationVisible、peWireConnected 必须同时为 true；样本要求铜编织带时还必须同时满足 mainCopperPeConductorVisible、mainCopperPeTerminationVisible。',
      'reason 与 photoFindings 必须写明主PE铜芯线/铜编织带位于第几张照片及压接位置；缺失时必须写“未见铜芯接地线/铜编织带接入PE端子”，禁止写成“未见黄绿接地线”。',
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
      reason: parsed.status === CheckResult.PASS && parsed.reason ? parsed.reason : passReason,
    };
  }

  private parseBoolEvidence(
    raw: string,
    keys: string[],
  ): {
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
      const asBool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
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
      'topSectionVisible',
      'bottomContentVisible',
      'requiredSectionsCovered',
      'croppedOrPartial',
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
    if (!values.topSectionVisible) missing.push('页面顶部设备信息区');
    if (!values.bottomContentVisible) missing.push('页面下部完整内容（底部导航栏不能代替）');
    if (!values.requiredSectionsCovered) missing.push('标准要求的全部页面区域');
    if (values.croppedOrPartial) missing.push('截图不得只覆盖长页面的一部分');
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
    const sameAngle = /构图相同|同一角度|几乎一样|重复拍摄|角度相同|连拍同侧/.test(text);
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
    if (photoCount >= 2 && values.mountPointsVisible && !sameAngle && !values.multiAngleCoverage) {
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
      'allPortsIndividuallyAccountedFor',
      'matchesSampleProtection',
    ]);
    const reason = `${parsed.reason || ''} ${raw}`;
    const explicitOpenHole =
      /无盖|未盖|缺盖|没有盖|未加盖|未加防护|黑洞|空洞|金属触点裸|空闲孔.*裸|裸露无盖|未使用端子.*无/.test(
        reason,
      );
    const missing: string[] = [];
    const uncappedMatch = raw.match(/uncappedUnusedPortCount"\s*:\s*(\d+)/);
    const uncappedCount = uncappedMatch ? Number(uncappedMatch[1]) : null;
    if (!reported) missing.push('逐端口结构化检查结果');
    if (!values.connectorsIntact) missing.push('直流接头完好插接到位');
    if (!values.allPortsIndividuallyAccountedFor) missing.push('逐一清点全部可见端口');
    if (!values.unusedPortsCapped || explicitOpenHole || (uncappedCount ?? 0) > 0) {
      missing.push('所有空闲端口均须有蓝/红/橙防护盖，不得存在无盖孔');
    }
    if (sampleCount > 0 && !values.matchesSampleProtection) {
      missing.push('空闲端口防护状态须与合格样本一致');
    }

    return this.enforceEvidencePass(
      parsed,
      missing,
      '直流侧在用接头插接正常，空闲孔已盖蓝/红/橙防护盖，合格。',
      reported,
    );
  }

  /** 对准备判合格的直流侧照片做第二次、缺陷优先的放大复核。 */
  private async auditDcUnusedPorts(args: {
    apiKey: string;
    baseUrl: string;
    model: string;
    photoInputs: string[];
    original: Omit<VisionCompareResult, 'provider'>;
  }): Promise<Omit<VisionCompareResult, 'provider'>> {
    const crops = await this.createDcPortCrops(args.photoInputs);
    if (!crops.length) {
      // 裁剪失败不整项失败，保留首轮结论
      return {
        ...args.original,
        confidence: Math.min(args.original.confidence, 0.86),
        reason: `${args.original.reason || '首轮分析完成'}（端口放大复核跳过）`.slice(0, 300),
      };
    }

    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [
          '你是光伏逆变器直流端口安全复核员。以下均为现场照片的自动放大分块，不是合格样本。',
          '任务只有一个：找出任何“未插线且没有蓝色/红色/橙色防护盖”的空闲端口。',
          '判别时沿每个端口向下追踪：有电缆连续伸出才算在用；黑色接头末端呈圆形开口、且没有电缆继续伸出，仍是未封盖空闲端口。',
          '蓝色、红色或橙色堵头/盖子属于已封盖；红色/橙色大旋钮属于开关盖，不要误判。',
          '必须逐块从左到右检查。只要任一块发现一个无盖空孔，hasUncappedUnusedPort=true。',
          '只有明确看到无盖空孔才判 hasUncappedUnusedPort=true；局部遮挡但未见无盖孔时 allVisiblePortsVerified 可 true。',
          '只输出 JSON：',
          '{"hasUncappedUnusedPort":true|false,"allVisiblePortsVerified":true|false,"confidence":0~1,"reason":"中文，写明原图序号、左/中/右位置和数量","findings":[{"photoIndex":1,"area":"左/中/右","uncappedCount":1}]}',
        ].join('\n'),
      },
    ];
    for (const crop of crops) {
      content.push({ type: 'text', text: crop.label });
      content.push({ type: 'image_url', image_url: { url: crop.dataUrl } });
    }

    try {
      const raw = await this.callVisionChat({
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        content,
        temperature: 0,
        maxTokens: 384,
        timeoutMs: 55_000,
        label: 'dc-audit',
      });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('复核结果不是 JSON');
      const audit = JSON.parse(match[0]) as {
        hasUncappedUnusedPort?: unknown;
        allVisiblePortsVerified?: unknown;
        confidence?: unknown;
        reason?: unknown;
        findings?: unknown;
      };
      const asBool = (value: unknown) => value === true || value === 'true' || value === 1;
      const hasUncapped = asBool(audit.hasUncappedUnusedPort);
      const allVerified = asBool(audit.allVisiblePortsVerified);
      const confidence = Math.max(0, Math.min(1, Number(audit.confidence) || 0.9));
      const reason = String(audit.reason || '')
        .trim()
        .slice(0, 240);

      if (hasUncapped) {
        return {
          status: CheckResult.FAIL,
          confidence: Math.max(confidence, 0.95),
          reason: reason || '放大复核发现未插线且无蓝/红/橙防护盖的空闲直流端口。',
        };
      }
      if (!allVerified) {
        // 看不清时不再整项失败：保留首轮合格，略降置信度
        return {
          ...args.original,
          confidence: Math.min(args.original.confidence, confidence, 0.84),
          reason: reason || `${args.original.reason || '首轮合格'}（放大区局部不清，未推翻结论）`,
        };
      }
      return {
        ...args.original,
        confidence: Math.min(args.original.confidence, confidence, 0.95),
        reason: reason || args.original.reason,
      };
    } catch (error) {
      this.logger.warn(`DC safety audit parse failed: ${(error as Error).message}`);
      return {
        ...args.original,
        confidence: Math.min(args.original.confidence, 0.85),
        reason: `${args.original.reason || '首轮分析完成'}（二次复核未完成，以首轮为准）`.slice(
          0,
          300,
        ),
      };
    }
  }

  private async createDcPortCrops(
    photoInputs: string[],
  ): Promise<Array<{ label: string; dataUrl: string }>> {
    const crops: Array<{ label: string; dataUrl: string }> = [];
    for (let photoIndex = 0; photoIndex < Math.min(photoInputs.length, 2); photoIndex += 1) {
      try {
        const encoded = photoInputs[photoIndex].split(',', 2)[1];
        if (!encoded) continue;
        const source = Buffer.from(encoded, 'base64');
        const metadata = await sharp(source).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        if (width < 200 || height < 200) continue;

        // 每张最多 2 个裁块，边长控制在 900，避免二次复核 payload 过大超时
        const cropHeight = Math.max(160, Math.min(height, Math.round(height * 0.68)));
        const cropWidth = Math.max(160, Math.min(width, Math.round(width * 0.55)));
        const positions = [
          { name: '左侧放大区', left: 0 },
          { name: '右侧放大区', left: Math.max(0, width - cropWidth) },
        ];
        for (const position of positions) {
          const output = await sharp(source)
            .extract({ left: position.left, top: 0, width: cropWidth, height: cropHeight })
            .resize({ width: 900, withoutEnlargement: false })
            .jpeg({ quality: 78 })
            .toBuffer();
          crops.push({
            label: `【原现场照片 ${photoIndex + 1} · ${position.name}】请逐个检查黑色圆形端口是否有电缆或彩色防护盖`,
            dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
          });
        }
      } catch (error) {
        this.logger.warn(`DC crop failed for photo ${photoIndex + 1}: ${(error as Error).message}`);
      }
    }
    return crops;
  }

  private enforceAcSideResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    sampleCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    const { values, reported } = this.parseBoolEvidence(raw, [
      'phaseWiresOk',
      'sampleRequiresCopperPe',
      'mainCopperPeConductorVisible',
      'mainCopperPeTerminationVisible',
      'mainPeConductorVisible',
      'mainPeTerminationVisible',
      'doorBondingJumperOnly',
      'peWireConnected',
      'terminalsCoveredOrProtected',
    ]);
    const missing: string[] = [];
    const copperRequired = sampleCount > 0 && values.sampleRequiresCopperPe;
    if (
      !values.mainPeConductorVisible ||
      !values.mainPeTerminationVisible ||
      !values.peWireConnected ||
      values.doorBondingJumperOnly
    ) {
      missing.push('主PE铜芯接地线/铜编织带实际压接到PE端子（柜门黄绿跳线不能替代）');
    }
    if (
      copperRequired &&
      (!values.mainCopperPeConductorVisible || !values.mainCopperPeTerminationVisible)
    ) {
      missing.push('与合格样本一致的铜芯接地线/裸铜编织带及PE端压接点');
    }
    if (!values.phaseWiresOk) missing.push('相线接线正常');
    return this.enforceEvidencePass(
      parsed,
      missing,
      '交流侧相线正常，主PE铜芯接地线/铜编织带已可靠压接到PE端子，合格。',
      reported,
    );
  }

  private faultRecordHardRules(photoCount: number) {
    return [
      '【上传故障记录·硬性否决 — 覆盖通用“拿不准优先 pass”】',
      `本次共有 ${photoCount} 张现场故障截图（不包含后面的合格样本图）。`,
      photoCount >= 2
        ? '现场截图数量已经满足至少 2 张，禁止再输出“张数不足”；只需判断实时页与历史页是否各有一张。'
        : '当前现场截图确实少于 2 张，应判定张数不足。',
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

    const evidence = this.parseFaultRecordEvidence(raw, parsed.reason);
    const missing: string[] = [];
    if (!evidence.hasRealtimeFaultShot) missing.push('实时故障截图');
    if (!evidence.hasHistoricalFaultShot) missing.push('历史故障截图');

    if (missing.length > 0) {
      const detail = evidence.reported
        ? `现场未见：${missing.join('、')}${
            evidence.photoTypes.length ? `（各图判定：${evidence.photoTypes.join('、')}）` : ''
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

  private parseFaultRecordEvidence(
    raw: string,
    reason = '',
  ): {
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
      const asBool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';

      const candidateTypes = ev.photoTypes ?? ev.imageTypes ?? ev.types ?? ev.photos;
      const rawTypes = Array.isArray(candidateTypes) ? candidateTypes : [];
      const photoTypes = rawTypes.map((t) => {
        const value =
          t && typeof t === 'object'
            ? ((t as Record<string, unknown>).type ??
              (t as Record<string, unknown>).photoType ??
              (t as Record<string, unknown>).category ??
              '')
            : t;
        const s = String(value || '').toLowerCase();
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

      // 模型偶尔会在 reason 中明确逐图分类，却漏填 evidence；只接受明确的肯定句，
      // “需要/缺少实时与历史截图”之类要求性文案不能作为已上传证据。
      const affirmativePair =
        /(?:已|同时).{0,12}(?:上传|提供|识别|包含|看到).{0,20}(?:实时故障|实时告警|realtime).{0,30}(?:历史故障|历史告警|historical)/i.test(
          reason,
        ) ||
        /(?:第一张|图1|照片1).{0,20}(?:实时故障|实时告警|realtime).{0,40}(?:第二张|图2|照片2).{0,20}(?:历史故障|历史告警|historical)/i.test(
          reason,
        );
      if (affirmativePair && !/缺少|未见|未上传|未提供|未识别|不足/.test(reason)) {
        hasRealtimeFaultShot = true;
        hasHistoricalFaultShot = true;
      }

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

  private groundingHardRules(photoCount: number, sampleCount: number) {
    return [
      '【接地安装检查·逐照片硬性否决】',
      `本次有 ${photoCount} 张现场照片、${sampleCount} 张合格标准图。每张现场照片必须独立判断，禁止跨照片拼接证据。`,
      '本项包含两个彼此独立、缺一不可的连接点：',
      'A) internal_main_pe（箱内主PE）：必须在同一张照片里同时看到主电缆引出的铜芯接地线/裸铜编织带，以及它实际压接紧固到标有PE的端子。只有PE字样、空螺栓、L1/L2/L3相线或柜门黄绿跳线均不合格。',
      'B) external_chassis_ground（箱外机壳接地）：必须在同一张照片里看到黄绿接地线，以及它实际连接到设备机壳/安装支架接地点。线细可以，但必须能追踪到连接点。',
      '合格标准图分别展示箱内主PE铜编织带和箱外黄绿接地线；现场必须覆盖同样的两个视角。',
      '逐张填 photoTypes 和 photoChecks；wireAndTerminalVisibleInSamePhoto 只有“导体+对应连接点”在本张同时可见时才可 true。',
      '严禁把一张照片中的PE标签/空端子与另一张照片中的黄绿线合并为合格证据。',
      '只要任一现场照片展示了应接地位置但连接缺失，对应 connected 必须 false，整项 status 必须 fail。',
      '仅当 internalMainPeConnected=true、externalGroundConnected=true、matchesSampleViews=true，且逐照片证据完整时才允许 pass。',
    ].join('\n');
  }

  private enforceGroundingResult(
    parsed: Omit<VisionCompareResult, 'provider'>,
    raw: string,
    photoCount: number,
    sampleCount: number,
  ): Omit<VisionCompareResult, 'provider'> {
    const missing: string[] = [];
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      missing.push('逐照片接地检查结果');
      return this.enforceEvidencePass(parsed, missing, '', false);
    }
    try {
      const obj = JSON.parse(match[0]) as {
        evidence?: {
          photoTypes?: unknown;
          photoChecks?: unknown;
          hasInternalMainPePhoto?: unknown;
          internalMainPeConnected?: unknown;
          hasExternalGroundPhoto?: unknown;
          externalGroundConnected?: unknown;
          matchesSampleViews?: unknown;
        };
      };
      const evidence = obj.evidence;
      const asBool = (value: unknown) => value === true || value === 'true' || value === 1;
      const photoTypes = Array.isArray(evidence?.photoTypes) ? evidence.photoTypes : [];
      const checks = Array.isArray(evidence?.photoChecks)
        ? (evidence.photoChecks as Array<Record<string, unknown>>)
        : [];
      const internalChecks = checks.filter((item) => item.type === 'internal_main_pe');
      const externalChecks = checks.filter((item) => item.type === 'external_chassis_ground');

      if (photoTypes.length < photoCount || checks.length < photoCount) {
        missing.push('每张现场照片的独立分类和连接结论');
      }
      if (!asBool(evidence?.hasInternalMainPePhoto) || internalChecks.length === 0) {
        missing.push('箱内主PE连接照片');
      }
      if (
        !asBool(evidence?.internalMainPeConnected) ||
        internalChecks.some(
          (item) =>
            !asBool(item.internalMainPeConnected) ||
            !asBool(item.wireAndTerminalVisibleInSamePhoto),
        )
      ) {
        missing.push('箱内主PE铜芯线/铜编织带实际压接到PE端子');
      }
      if (!asBool(evidence?.hasExternalGroundPhoto) || externalChecks.length === 0) {
        missing.push('箱外机壳接地照片');
      }
      if (
        !asBool(evidence?.externalGroundConnected) ||
        externalChecks.some(
          (item) =>
            !asBool(item.externalGroundConnected) ||
            !asBool(item.wireAndTerminalVisibleInSamePhoto),
        )
      ) {
        missing.push('箱外黄绿接地线实际连接机壳/支架接地点');
      }
      if (sampleCount > 0 && !asBool(evidence?.matchesSampleViews)) {
        missing.push('与标准图一致的箱内、箱外两个接地视角');
      }

      return this.enforceEvidencePass(
        parsed,
        missing,
        '箱内主PE铜芯线/铜编织带及箱外黄绿接地线均已分别可靠连接，符合标准图要求。',
        true,
      );
    } catch {
      return this.enforceEvidencePass(parsed, ['可解析的逐照片接地证据'], '', false);
    }
  }

  /** 接地项目准备判合格时，再进行一次只关注“两处连接必须分别成立”的独立复核。 */
  private async auditGroundingConnections(args: {
    apiKey: string;
    baseUrl: string;
    model: string;
    photoInputs: string[];
    sampleInputs: string[];
  }): Promise<Omit<VisionCompareResult, 'provider'>> {
    const [fieldCrops, sampleCrops] = await Promise.all([
      this.createGroundingEvidenceCrops(args.photoInputs),
      this.createGroundingEvidenceCrops(args.sampleInputs),
    ]);
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [
          '你是接地安全复核员。请忽略上一轮结论，对每张现场照片单独检查，禁止跨照片拼接证据。无论上一轮合格或不合格，都必须重新独立判定。',
          '必须同时满足：①箱内主电缆的铜芯接地线/裸铜编织带实际压接到PE端子；②箱外黄绿接地线实际连接机壳或支架接地点。',
          '某张箱内照片中即使有PE字样，只要PE端子为空、无铜芯线/铜编织带，就必须 internalMainPeConnected=false。',
          '另一张照片的黄绿线只能证明箱外接地，绝不能弥补箱内主PE缺失。任一连接点不合格，总结论必须fail。',
          '标准图没有固定顺序：先根据每张标准图的画面内容识别其属于箱内主PE或箱外机壳接地，再与现场图配对；禁止假设标准图1一定是哪一类。',
          '只输出与下面格式完全一致的JSON：',
          '{"status":"pass"|"fail","confidence":0~1,"reason":"逐张说明","evidence":{"photoTypes":["internal_main_pe"|"external_chassis_ground"|"other"],"photoChecks":[{"photoIndex":1,"type":"internal_main_pe|external_chassis_ground|other","internalMainPeConnected":true|false,"externalGroundConnected":true|false,"wireAndTerminalVisibleInSamePhoto":true|false,"reason":"本张独立结论"}],"hasInternalMainPePhoto":true|false,"internalMainPeConnected":true|false,"hasExternalGroundPhoto":true|false,"externalGroundConnected":true|false,"matchesSampleViews":true|false}}',
        ].join('\n'),
      },
    ];
    args.photoInputs.forEach((dataUrl, index) => {
      content.push({ type: 'text', text: `【现场照片 ${index + 1}】只判断本张连接是否真实存在` });
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
      if (fieldCrops[index]) {
        content.push({
          type: 'text',
          text: `【现场照片 ${index + 1} · PE连接区域自动放大】重点看导体是否真正压接到端子`,
        });
        content.push({ type: 'image_url', image_url: { url: fieldCrops[index] } });
      }
    });
    args.sampleInputs.forEach((dataUrl, index) => {
      content.push({
        type: 'text',
        text: `【接地合格标准图 ${index + 1}】请按图像内容识别视角，不要按序号猜测`,
      });
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
      if (sampleCrops[index]) {
        content.push({
          type: 'text',
          text: `【标准图 ${index + 1} · 接地连接区域自动放大】`,
        });
        content.push({ type: 'image_url', image_url: { url: sampleCrops[index] } });
      }
    });

    try {
      const raw = await this.callVisionChat({
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
        model: args.model,
        content,
        temperature: 0,
        maxTokens: 512,
        timeoutMs: 70_000,
        label: 'grounding-audit',
      });
      const parsed = this.parseJsonResult(raw);
      if (!parsed) throw new Error('复核结果无法解析');
      return this.enforceGroundingResult(
        parsed,
        raw,
        args.photoInputs.length,
        args.sampleInputs.length,
      );
    } catch (error) {
      this.logger.warn(`Grounding safety audit failed: ${(error as Error).message}`);
      // 放大裁剪版失败时，退回「仅原图」再试一次，避免整项直接分析失败
      try {
        return await this.auditGroundingConnectionsSimple(args);
      } catch (fallbackError) {
        this.logger.warn(
          `Grounding simple audit also failed: ${(fallbackError as Error).message}`,
        );
        return {
          status: CheckResult.ERROR,
          confidence: 0,
          reason: '接地双连接点分析暂时失败，请点「重新分析」或人工判断',
        };
      }
    }
  }

  /** 接地轻量复核：不送自动放大图，降低超时概率 */
  private async auditGroundingConnectionsSimple(args: {
    apiKey: string;
    baseUrl: string;
    model: string;
    photoInputs: string[];
    sampleInputs: string[];
  }): Promise<Omit<VisionCompareResult, 'provider'>> {
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [
          '你是接地安全复核员。对每张现场照片单独检查，禁止跨照片拼接证据。',
          '必须同时满足：①箱内主PE铜芯线/铜编织带压接到PE端子；②箱外黄绿接地线连接机壳或支架。',
          '任一连接点不合格 → fail。只输出 JSON：',
          '{"status":"pass"|"fail","confidence":0~1,"reason":"逐张说明","evidence":{"photoTypes":["internal_main_pe"|"external_chassis_ground"|"other"],"hasInternalMainPePhoto":true|false,"internalMainPeConnected":true|false,"hasExternalGroundPhoto":true|false,"externalGroundConnected":true|false,"matchesSampleViews":true|false}}',
        ].join('\n'),
      },
    ];
    args.photoInputs.forEach((dataUrl, index) => {
      content.push({ type: 'text', text: `【现场照片 ${index + 1}】` });
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    });
    args.sampleInputs.slice(0, 2).forEach((dataUrl, index) => {
      content.push({ type: 'text', text: `【合格标准图 ${index + 1}】` });
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    });
    const raw = await this.callVisionChat({
      apiKey: args.apiKey,
      baseUrl: args.baseUrl,
      model: args.model,
      content,
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 60_000,
      label: 'grounding-simple',
    });
    const parsed = this.parseJsonResult(raw);
    if (!parsed) throw new Error('轻量复核结果无法解析');
    return this.enforceGroundingResult(
      parsed,
      raw,
      args.photoInputs.length,
      args.sampleInputs.length,
    );
  }

  private async createGroundingEvidenceCrops(inputs: string[]): Promise<Array<string | null>> {
    return Promise.all(
      inputs.map(async (input, index) => {
        try {
          const encoded = input.split(',', 2)[1];
          if (!encoded) return null;
          const source = Buffer.from(encoded, 'base64');
          const metadata = await sharp(source).metadata();
          const width = metadata.width || 0;
          const height = metadata.height || 0;
          if (width < 200 || height < 200) return null;
          const left = Math.round(width * 0.25);
          const output = await sharp(source)
            .extract({ left, top: 0, width: width - left, height })
            .resize({ width: 1100, withoutEnlargement: false })
            .jpeg({ quality: 88 })
            .toBuffer();
          return `data:image/jpeg;base64,${output.toString('base64')}`;
        } catch (error) {
          this.logger.warn(
            `Grounding crop failed for image ${index + 1}: ${(error as Error).message}`,
          );
          return null;
        }
      }),
    );
  }

  private async matchExactSampleSet(
    fieldInputs: string[],
    sampleInputs: string[],
  ): Promise<{ matched: boolean; minSimilarity: number }> {
    if (!sampleInputs.length || fieldInputs.length !== sampleInputs.length) {
      return { matched: false, minSimilarity: 0 };
    }
    try {
      const [fieldPrints, samplePrints] = await Promise.all([
        Promise.all(fieldInputs.map((item) => this.imageFingerprint(item))),
        Promise.all(sampleInputs.map((item) => this.imageFingerprint(item))),
      ]);
      const scores = samplePrints.map((sample) =>
        fieldPrints.map((field) => this.fingerprintSimilarity(sample, field)),
      );
      let bestMin = 0;
      const assign = (sampleIndex: number, used: Set<number>, currentMin: number) => {
        if (sampleIndex >= scores.length) {
          bestMin = Math.max(bestMin, currentMin);
          return;
        }
        for (let fieldIndex = 0; fieldIndex < fieldPrints.length; fieldIndex += 1) {
          if (used.has(fieldIndex)) continue;
          used.add(fieldIndex);
          assign(sampleIndex + 1, used, Math.min(currentMin, scores[sampleIndex][fieldIndex]));
          used.delete(fieldIndex);
        }
      };
      assign(0, new Set<number>(), 1);
      return { matched: bestMin >= 0.985, minSimilarity: bestMin };
    } catch (error) {
      this.logger.warn(`Sample image similarity failed: ${(error as Error).message}`);
      return { matched: false, minSimilarity: 0 };
    }
  }

  private async imageFingerprint(dataUrl: string): Promise<Buffer> {
    const encoded = dataUrl.split(',', 2)[1];
    if (!encoded) throw new Error('图片 data URL 无有效内容');
    return sharp(Buffer.from(encoded, 'base64'))
      .rotate()
      .resize(48, 48, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
  }

  private fingerprintSimilarity(left: Buffer, right: Buffer) {
    if (!left.length || left.length !== right.length) return 0;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference += Math.abs(left[index] - right[index]);
    }
    return 1 - difference / (left.length * 255);
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
    if (/^data:image\//i.test(input)) {
      try {
        const encoded = input.split(',', 2)[1];
        // 已是 data URL 但体积过大时仍压缩，避免模型超时
        if (encoded && encoded.length > 350_000) {
          return await this.compressToVisionDataUrl(Buffer.from(encoded, 'base64'), 'image/jpeg');
        }
      } catch {
        /* 保持原样 */
      }
      return input;
    }

    const absolute = this.toAbsoluteUrl(input);
    if (!/^https?:\/\//i.test(absolute)) {
      throw new Error('图片地址不是可下载的 HTTP(S) 地址');
    }

    const cached = this.imageDataCache.get(absolute);
    if (cached && cached.expiresAt > Date.now()) return cached.dataUrl;
    if (cached) this.imageDataCache.delete(absolute);

    // 同一实例内多个检查项经常共用标准图。合并并发下载，避免瞬间重复请求图床。
    const existing = this.imageDownloadInFlight.get(absolute);
    if (existing) return existing;

    const download = this.downloadImageDataUrl(absolute)
      .then((dataUrl) => {
        this.imageDataCache.set(absolute, {
          dataUrl,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
        // 防止长时间运行的实例无限增长；标准图数量通常远低于此上限。
        if (this.imageDataCache.size > 120) {
          const oldestKey = this.imageDataCache.keys().next().value as string | undefined;
          if (oldestKey) this.imageDataCache.delete(oldestKey);
        }
        return dataUrl;
      })
      .finally(() => this.imageDownloadInFlight.delete(absolute));
    this.imageDownloadInFlight.set(absolute, download);
    return download;
  }

  private async downloadImageDataUrl(absolute: string): Promise<string> {
    const candidates = [absolute];
    // 七牛测试域名通常只支持 HTTP，其 HTTPS 证书会被 Node 和浏览器拒绝。
    if (/^https:\/\/[^/]+\.clouddn\.com\//i.test(absolute)) {
      candidates.push(absolute.replace(/^https:/i, 'http:'));
    }

    let lastError: Error | null = null;
    // 图床连接、DNS 或 CDN 节点偶发抖动时自动恢复；此前单次失败就会转人工。
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      for (const url of candidates) {
        try {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
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
          // 压缩后再送模型：大幅降低超时与“视觉服务异常”
          return await this.compressToVisionDataUrl(bytes, contentType);
        } catch (err) {
          lastError = err as Error;
        }
      }
      if (attempt < 3) await this.sleep(attempt * 250);
    }
    throw new Error(`图片下载失败: ${lastError?.message || '未知错误'}`);
  }

  /** 统一压缩为 JPEG data URL，控制体积与边长 */
  private async compressToVisionDataUrl(bytes: Buffer, contentType: string): Promise<string> {
    try {
      const output = await sharp(bytes)
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      return `data:image/jpeg;base64,${output.toString('base64')}`;
    } catch (error) {
      this.logger.warn(`图片压缩失败，使用原图: ${(error as Error).message}`);
      const mime = contentType.startsWith('image/') ? contentType : 'image/jpeg';
      return `data:${mime};base64,${bytes.toString('base64')}`;
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
      const confidence = Math.max(0, Math.min(1, Number(obj.confidence ?? 0.7) || 0.7));
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
