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
      const content: Array<Record<string, unknown>> = [
        {
          type: 'text',
          text: [
            '你是光伏/储能设备现场巡检质检助手。',
            '请综合查看全部「现场照片」（可含多角度），并参考「合格样本图」与检查要求，给出一项总结论。',
            '判定原则：',
            '1) 多张现场照是互补证据：某一张拍到关键信息即可，不必每张都与样本长得一模一样；',
            '2) 样本图只作版式/角度参考，禁止把样本图里的文字、告警、缺陷当成现场证据；',
            '3) 仅当现场照片本身关键缺陷明确、或关键要求明显缺失时才判 fail；拿不准时优先 pass，并在 reason 说明存疑点；',
            '4) 证据越充分（多角度覆盖）越应提高 confidence。',
            '故障/告警截图专项（本项通常需要「实时故障」+「历史故障」两类截图）：',
            '- 先识别现场图分别属于：实时故障页 / 历史故障页 / 其他；两类都有时综合判定，缺一类可在 reason 提示补拍，但不因此直接 fail；',
            '- 合格主依据是「实时故障」：显示「暂无数据」、空列表或无未恢复严重告警 → 应判 pass；',
            '- 「历史故障」样本/现场图里出现过的历史告警文字，仅说明曾有记录，不单独构成不合格；',
            '- 仅当实时页仍有未恢复的严重告警，且工程师备注未说明处置时，才可判 fail；',
            '- 样本图：第1张常为实时合格示例，第2张常为历史页版式示例；严禁把样本中的告警内容当成现场正在告警。',
            criteria ? `检查要求：\n${criteria}` : '未提供文字检查要求时，按通用现场质检规范判断。',
            remark ? `工程师备注：${remark}` : '工程师备注：无',
            '只输出 JSON（不要 Markdown）：',
            '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明"}',
            sampleInputs.length
              ? '已提供合格样本，请作版式参考，不要过度苛刻。'
              : '无样本时根据检查要求与通用安装规范给出建议结论。',
          ].join('\n'),
        },
      ];

      photoInputs.forEach((photoInput, i) => {
        content.push({
          type: 'text',
          text: photoInputs.length > 1 ? `【现场照片 ${i + 1}/${photoInputs.length}】` : '【现场照片】',
        });
        content.push({
          type: 'image_url',
          image_url: { url: photoInput },
        });
      });

      for (let i = 0; i < sampleInputs.length; i += 1) {
        const sampleLabel =
          /故障|告警/.test(criteria) && sampleInputs.length >= 2
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
      return { ...parsed, provider: 'siliconflow' };
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
