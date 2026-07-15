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
    photoUrl: string,
    samplePhotoUrls: string[],
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

    const samples = (samplePhotoUrls || []).filter(Boolean).slice(0, 3);

    try {
      // SiliconFlow 必须能直接下载图片。localhost/内网地址和证书异常的
      // 七牛测试域名都无法由模型服务读取，因此在服务端转为 data URL。
      const photoInput = await this.toImageDataUrl(photoUrl);
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

      const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [
          '你是光伏/储能设备现场巡检质检助手。请对比「现场照片」与「合格样本图」。',
          '重点看：安装完整性、接线端子、标识、防护、明显缺损或脏污、与样本规范是否一致。',
          '只输出 JSON（不要 Markdown）：',
          '{"status":"pass"|"fail","confidence":0~1,"reason":"中文简短说明"}',
          samples.length
            ? '已提供合格样本，请严格参照样本判断。'
            : '无样本时根据通用安装规范给出建议结论。',
        ].join('\n'),
      },
      { type: 'text', text: '【现场照片】' },
      {
        type: 'image_url',
        image_url: { url: photoInput },
      },
      ];

    for (let i = 0; i < sampleInputs.length; i += 1) {
      content.push({ type: 'text', text: `【合格样本 ${i + 1}】` });
      content.push({
        type: 'image_url',
        image_url: { url: sampleInputs[i] },
      });
    }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
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
