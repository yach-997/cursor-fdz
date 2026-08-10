import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User, InspectionTemplate, TemplateEntry } from '../entities';
import { UserRole, CommonStatus, DeviceType, CheckType } from '../common/enums';

type EntryDef = {
  name: string;
  description: string;
  isRequired?: boolean;
  isOptionalModule?: boolean;
};

/** 启动时种子数据：超级管理员 + 流程图标准全局模板 */
@Injectable()
export class DatabaseSeedService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(InspectionTemplate)
    private readonly templateRepo: Repository<InspectionTemplate>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      this.logger.log('Serverless 模式：跳过启动种子，使用现有 Supabase 数据');
      return;
    }
    await this.seedAdmin();
    await this.migrateUserRoles();
    await this.seedTemplates();
  }

  private async seedAdmin() {
    const username = this.configService.get<string>('ADMIN_USERNAME', 'admin');
    const existing = await this.userRepo.findOne({ where: { username } });

    if (existing) {
      this.logger.log(`超级管理员 [${username}] 已存在，跳过种子`);
      return;
    }

    const configuredPassword = this.configService.get<string>('ADMIN_PASSWORD');
    if (!configuredPassword && process.env.NODE_ENV === 'production') {
      throw new Error('生产环境首次启动前必须配置 ADMIN_PASSWORD');
    }
    const password = configuredPassword || 'admin123';
    if (!configuredPassword) {
      this.logger.warn('本地开发环境正在使用默认管理员密码，请勿用于生产环境');
    }
    const hashed = await bcrypt.hash(password, 10);

    const admin = this.userRepo.create({
      username,
      password: hashed,
      realName: this.configService.get<string>('ADMIN_REAL_NAME', '超级管理员'),
      phone: this.configService.get<string>('ADMIN_PHONE', '13800000000'),
      role: UserRole.SUPER_ADMIN,
      roles: [UserRole.SUPER_ADMIN],
      status: CommonStatus.ACTIVE,
    });

    await this.userRepo.save(admin);
    this.logger.log(`已创建超级管理员: ${username}`);
  }

  /** 将旧单 role 同步到 roles 多角色字段 */
  private async migrateUserRoles() {
    const users = await this.userRepo.find();
    let n = 0;
    for (const u of users) {
      if (!u.roles?.length && u.role) {
        u.roles = [u.role];
        await this.userRepo.save(u);
        n++;
      }
    }
    if (n) this.logger.log(`已同步 ${n} 个用户的多角色字段`);
  }

  /**
   * 按业务流程图写入/同步设备巡检模板，并补齐 PO 需求类型全局模板。
   */
  private async seedTemplates() {
    const defs: Array<{ name: string; deviceType: DeviceType; entries: EntryDef[] }> = [
      {
        name: '组串式逆变器',
        deviceType: DeviceType.STRING_INVERTER,
        entries: [
          {
            name: '上传阳光云截图',
            description:
              '必检硬性项。须上传与合格样本同级的完整阳光云页面截图（含设备信息与序列号，不可半截/只截功率数字）；半截图不合格。',
          },
          {
            name: '上传故障记录',
            description:
              '必检硬性项。须同时上传两类截图供 AI 分析：①实时故障/告警页；②历史故障/告警页。只传一张或只传同一类，判定不合格。',
          },
          {
            name: '安装固定检查',
            description:
              '必检硬性项。至少拍摄 2 个不同角度，须能看清支架/螺栓等固定点，证明安装牢固、无松动倾斜；单张侧面不合格。',
          },
          {
            name: '直流侧安装检查',
            description:
              '必检硬性项。已插线端子正常即可；未插线空闲孔须盖蓝色/红色/橙色防护盖，无盖呈黑洞裸露不合格。',
          },
          {
            name: '交流侧安装检查',
            description:
              '必检硬性项。检查交流侧接线与防护；相线之外必须看到 PE 接地线已接入，未接 PE 直接不合格。',
          },
          {
            name: '接地安装检查',
            description:
              '必检硬性项。现场照片须同时清晰看到：①黄绿双色接地线；②接地排或接地端子（含 PE 螺栓/铜编织带接地点）；③接地标识（含面板丝印 PE/GND/接地字样）。三样缺一样即不合格；高压警示牌与相线色环不算。',
          },
        ],
      },
      {
        name: '集中式逆变器',
        deviceType: DeviceType.CENTRAL_INVERTER,
        entries: [
          {
            name: '上传阳光云截图',
            description:
              '必检硬性项。须上传与合格样本同级的完整阳光云页面截图（含设备信息与序列号，不可半截/只截功率数字）；半截图不合格。',
          },
          {
            name: '上传故障记录',
            description:
              '必检硬性项。须同时上传两类截图供 AI 分析：①实时故障/告警页；②历史故障/告警页。只传一张或只传同一类，判定不合格。',
          },
          {
            name: '设备箱体检查',
            description: '必检。检查箱体外观、门锁、密封、防腐与内部整洁状况。',
          },
          {
            name: '逆变器检查',
            description: '必检。检查逆变器本体运行状态、指示灯、接线与散热情况。',
          },
          {
            name: '低压配电柜检查',
            description: '必检。检查低压配电柜内元器件、接线与标识是否正常。',
          },
          {
            name: '环网柜检查',
            description: '必检。检查环网柜外观、柜门、指示与安全防护状态。',
          },
          {
            name: '中压变压器检查',
            description:
              '可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏等。',
            isRequired: false,
            isOptionalModule: true,
          },
        ],
      },
      {
        name: '储能系统',
        deviceType: DeviceType.ENERGY_STORAGE,
        entries: [
          {
            name: '箱体检查',
            description: '必检。检查储能系统箱体外观、门锁、密封与标识。',
          },
          {
            name: '电池箱检查',
            description: '必检。检查电池箱外观、连接、温控/消防相关部件状态。',
          },
          {
            name: 'PCS 检查',
            description: '必检。检查 PCS 运行状态、指示、接线与散热情况。',
          },
          {
            name: '环网柜检查',
            description: '必检。检查环网柜外观、柜门、指示与安全防护状态。',
          },
          {
            name: '中压变压器检查',
            description:
              '可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏等。',
            isRequired: false,
            isOptionalModule: true,
          },
          {
            name: '其它系统检查',
            description: '必检。检查其它附属系统（通信、消防、空调等）是否异常。',
          },
        ],
      },
    ];

    for (const def of defs) {
      const entries = this.buildEntries(def.entries);
      const exists = await this.templateRepo.findOne({
        where: {
          deviceType: def.deviceType,
          isGlobal: true,
          siteId: IsNull(),
        },
      });

      if (exists) {
        // 与流程图不一致时同步更新（version+1，仅影响之后新建任务）
        const names = (exists.entries || []).map((e) => e.name).join('|');
        const nextNames = entries.map((e) => e.name).join('|');
        if (names === nextNames && exists.name === def.name) {
          continue;
        }
        exists.name = def.name;
        exists.entries = entries;
        exists.version = (exists.version || 1) + 1;
        await this.templateRepo.save(exists);
        this.logger.log(`已同步流程图模板: ${def.name} (v${exists.version})`);
        continue;
      }

      const tpl = this.templateRepo.create({
        name: def.name,
        deviceType: def.deviceType,
        isGlobal: true,
        siteId: null,
        version: 1,
        entries,
      } as Partial<InspectionTemplate>);

      await this.templateRepo.save(tpl);
      this.logger.log(`已创建流程图模板: ${def.name}`);
    }

    await this.seedDemandTypeTemplates();
  }

  /** PO 对齐的全局需求类型（与 Preview bootstrap 同清单） */
  private async seedDemandTypeTemplates() {
    const defs: Array<{
      name: string;
      assignMode: 'single' | 'multi';
      unitLabel: string;
    }> = [
      { name: '巡检', assignMode: 'multi', unitLabel: '台' },
      { name: '故障恢复', assignMode: 'single', unitLabel: '台' },
      { name: '整改', assignMode: 'multi', unitLabel: '台' },
      { name: '维护', assignMode: 'single', unitLabel: '台' },
      { name: '交付', assignMode: 'single', unitLabel: '台' },
    ];
    for (const def of defs) {
      const exists = await this.templateRepo.findOne({
        where: { name: def.name },
      });
      if (exists) continue;
      const tpl = this.templateRepo.create({
        name: def.name,
        deviceType: DeviceType.STRING_INVERTER,
        isGlobal: true,
        siteId: null,
        assignMode: def.assignMode,
        unitLabel: def.unitLabel,
        expenseEnabledDefault: false,
        version: 1,
        entries: this.buildEntries([
          {
            name: '现场作业记录',
            description:
              '请按该服务类型现场规范完成作业并上传凭证；可在「服务类型」中完善检查条目与样本图。',
          },
        ]),
      } as Partial<InspectionTemplate>);
      await this.templateRepo.save(tpl);
      this.logger.log(`已创建需求类型模板: ${def.name}`);
    }
  }

  private buildEntries(defs: EntryDef[]): TemplateEntry[] {
    return defs.map((item, order) => ({
      id: uuidv4(),
      name: item.name,
      description: item.description,
      isRequired: item.isRequired !== false,
      order,
      samplePhotos: [],
      checkType: CheckType.PHOTO,
      isOptionalModule: item.isOptionalModule || false,
    }));
  }
}
