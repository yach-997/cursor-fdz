import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, ILike, FindOptionsWhere } from 'typeorm';
import ExcelJS from 'exceljs';
import { Device, Site, InspectionTask, InspectionRecord } from '../../entities';
import { DeviceType, DeviceStatus, UserRole, CommonStatus } from '../../common/enums';
import { CurrentUserContext } from '../../common/interfaces';
import { CreateDeviceDto, UpdateDeviceDto, QueryDeviceDto } from './dto/device.dto';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(InspectionTask)
    private readonly taskRepo: Repository<InspectionTask>,
    @InjectRepository(InspectionRecord)
    private readonly recordRepo: Repository<InspectionRecord>,
  ) {}

  /** 设备列表（含数据隔离） */
  async findAll(query: QueryDeviceDto, currentUser: CurrentUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;

    const where: FindOptionsWhere<Device> = {};

    // 数据隔离
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      where.siteId = In(currentUser.managedSiteIds);
    } else if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.length) {
        return { list: [], total: 0, page, limit };
      }
      where.siteId = In(currentUser.memberSiteIds);
    }

    if (query.siteId) {
      this.assertSiteAccess(query.siteId, currentUser);
      where.siteId = query.siteId;
    }
    if (query.deviceType) {
      where.deviceType = query.deviceType;
    }
    if (query.serialNumber) {
      where.serialNumber = ILike(`%${query.serialNumber}%`);
    }
    if (query.status) {
      where.status = query.status;
    }

    const [list, total] = await this.deviceRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    await this.attachSites(list);

    return {
      list: list.map((d) => this.toSafeDevice(d)),
      total,
      page,
      limit,
    };
  }

  /** 设备详情 */
  async findOne(id: string, currentUser: CurrentUserContext) {
    const device = await this.deviceRepo.findOne({ where: { id } });
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    this.assertSiteAccess(device.siteId, currentUser);
    await this.attachSites([device]);
    return this.toSafeDevice(device);
  }

  /** 创建设备 */
  async create(dto: CreateDeviceDto, currentUser: CurrentUserContext) {
    this.assertSiteAccess(dto.siteId, currentUser);
    await this.ensureSiteExists(dto.siteId);

    const exists = await this.deviceRepo.findOne({
      where: { serialNumber: dto.serialNumber },
    });
    if (exists) {
      throw new ConflictException('设备序列号已存在，全局唯一不可重复');
    }

    const device = this.deviceRepo.create({
      siteId: dto.siteId,
      serialNumber: dto.serialNumber,
      deviceType: dto.deviceType,
      model: dto.model || undefined,
      manufacturer: dto.manufacturer || undefined,
      installDate: dto.installDate ? new Date(dto.installDate) : undefined,
      status: DeviceStatus.ACTIVE,
    } as Partial<Device>);

    const saved = await this.deviceRepo.save(device);
    return this.findOne(saved.id, currentUser);
  }

  /** 更新设备 */
  async update(id: string, dto: UpdateDeviceDto, currentUser: CurrentUserContext) {
    const device = await this.deviceRepo.findOne({ where: { id } });
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    this.assertSiteAccess(device.siteId, currentUser);

    if (dto.siteId && dto.siteId !== device.siteId) {
      this.assertSiteAccess(dto.siteId, currentUser);
      await this.ensureSiteExists(dto.siteId);
    }

    if (dto.serialNumber && dto.serialNumber !== device.serialNumber) {
      const exists = await this.deviceRepo.findOne({
        where: { serialNumber: dto.serialNumber },
      });
      if (exists) {
        throw new ConflictException('设备序列号已存在，全局唯一不可重复');
      }
    }

    Object.assign(device, {
      ...(dto.siteId !== undefined && { siteId: dto.siteId }),
      ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
      ...(dto.deviceType !== undefined && { deviceType: dto.deviceType }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
      ...(dto.installDate !== undefined && {
        installDate: dto.installDate ? new Date(dto.installDate) : null,
      }),
      ...(dto.status !== undefined && { status: dto.status }),
    });

    await this.deviceRepo.save(device);
    return this.findOne(id, currentUser);
  }

  /** 删除设备 */
  async remove(id: string, currentUser: CurrentUserContext) {
    const device = await this.deviceRepo.findOne({ where: { id } });
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    this.assertSiteAccess(device.siteId, currentUser);

    // 有进行中任务时禁止删除
    const activeTaskCount = await this.taskRepo
      .createQueryBuilder('task')
      .where('task.device_id = :id', { id })
      .andWhere('task.status IN (:...statuses)', {
        statuses: ['pending', 'in_progress', 'submitted'],
      })
      .getCount();

    if (activeTaskCount > 0) {
      throw new BadRequestException(
        `该设备仍有 ${activeTaskCount} 个未完成任务，无法删除`,
      );
    }

    await this.deviceRepo.remove(device);
    return { success: true };
  }

  /**
   * 批量导入 Excel
   * 表头：site_code, serial_number, device_type, model, manufacturer, install_date
   */
  async batchImport(file: Express.Multer.File, currentUser: CurrentUserContext) {
    if (!file) {
      throw new BadRequestException('请上传 Excel 文件');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('Excel 文件为空');
    }

    const headers = worksheet.getRow(1).values as ExcelJS.CellValue[];
    const rows: Record<string, unknown>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item: Record<string, unknown> = {};
      for (let column = 1; column < headers.length; column++) {
        const header = String(headers[column] ?? '').trim();
        if (!header) continue;
        const value = row.getCell(column).value;
        item[header] =
          value instanceof Date
            ? value.toISOString().slice(0, 10)
            : typeof value === 'object' && value && 'text' in value
              ? value.text
              : value ?? '';
      }
      if (Object.values(item).some((value) => String(value).trim())) rows.push(item);
    });

    if (!rows.length) {
      throw new BadRequestException('导入表格中没有数据行');
    }

    const success: unknown[] = [];
    const failed: { row: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 含表头

      try {
        const siteCode = String(
          row.site_code || row.siteCode || row['站点编码'] || '',
        ).trim();
        const serialNumber = String(
          row.serial_number || row.serialNumber || row['序列号'] || '',
        ).trim();
        const deviceTypeRaw = String(
          row.device_type || row.deviceType || row['设备类型'] || '',
        ).trim();
        const model = String(row.model || row['型号'] || '').trim() || undefined;
        const manufacturer =
          String(row.manufacturer || row['制造商'] || '').trim() || undefined;
        const installDateRaw = String(
          row.install_date || row.installDate || row['安装日期'] || '',
        ).trim();

        if (!siteCode || !serialNumber || !deviceTypeRaw) {
          throw new Error('站点编码、序列号、设备类型为必填');
        }

        const deviceType = this.parseDeviceType(deviceTypeRaw);
        const site = await this.siteRepo.findOne({
          where: { code: siteCode, deletedAt: IsNull() },
        });
        if (!site) {
          throw new Error(`站点编码不存在: ${siteCode}`);
        }
        if (site.status !== CommonStatus.ACTIVE) {
          throw new Error(`站点已停用: ${siteCode}`);
        }

        this.assertSiteAccess(site.id, currentUser);

        const exists = await this.deviceRepo.findOne({
          where: { serialNumber },
        });
        if (exists) {
          throw new Error(`序列号已存在: ${serialNumber}`);
        }

        const device = this.deviceRepo.create({
          siteId: site.id,
          serialNumber,
          deviceType,
          model: model || undefined,
          manufacturer: manufacturer || undefined,
          installDate: installDateRaw ? new Date(installDateRaw) : undefined,
          status: DeviceStatus.ACTIVE,
        } as Partial<Device>);
        const saved = await this.deviceRepo.save(device);
        success.push(this.toSafeDevice(saved));
      } catch (e) {
        failed.push({
          row: rowNum,
          reason: e instanceof Error ? e.message : '未知错误',
        });
      }
    }

    return {
      successCount: success.length,
      failCount: failed.length,
      success,
      failed,
    };
  }

  /** 设备巡检历史 */
  async getHistory(id: string, currentUser: CurrentUserContext) {
    const device = await this.deviceRepo.findOne({ where: { id } });
    if (!device) {
      throw new NotFoundException('设备不存在');
    }
    this.assertSiteAccess(device.siteId, currentUser);

    const tasks = await this.taskRepo.find({
      where: { deviceId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const taskIds = tasks.map((t) => t.id);
    let records: InspectionRecord[] = [];
    if (taskIds.length) {
      records = await this.recordRepo
        .createQueryBuilder('record')
        .where('record.task_id IN (:...taskIds)', { taskIds })
        .orderBy('record.createdAt', 'DESC')
        .getMany();
    }

    return {
      device: this.toSafeDevice(device),
      tasks: tasks.map((t) => ({
        id: t.id,
        taskName: t.taskName,
        status: t.status,
        inspectorId: t.inspectorId,
        plannedDate: t.plannedDate,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
      })),
      records: records.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        status: r.status,
        submittedAt: r.submittedAt,
        approvedAt: r.approvedAt,
        createdAt: r.createdAt,
      })),
    };
  }

  private parseDeviceType(raw: string): DeviceType {
    const map: Record<string, DeviceType> = {
      string_inverter: DeviceType.STRING_INVERTER,
      central_inverter: DeviceType.CENTRAL_INVERTER,
      energy_storage: DeviceType.ENERGY_STORAGE,
      组串逆变器: DeviceType.STRING_INVERTER,
      组串式逆变器: DeviceType.STRING_INVERTER,
      集中式逆变器: DeviceType.CENTRAL_INVERTER,
      储能设备: DeviceType.ENERGY_STORAGE,
      储能系统: DeviceType.ENERGY_STORAGE,
      储能: DeviceType.ENERGY_STORAGE,
    };
    const type = map[raw] || map[raw.toLowerCase()];
    if (!type) {
      throw new Error(
        `设备类型无效：${raw}（可选：组串式逆变器、集中式逆变器、储能系统）`,
      );
    }
    return type;
  }

  /** 批量挂载站点，避免 join + orderBy 触发 TypeORM databaseName 错误 */
  private async attachSites(devices: Device[]) {
    if (!devices.length) return;
    const siteIds = [...new Set(devices.map((d) => d.siteId).filter(Boolean))];
    if (!siteIds.length) return;

    const sites = await this.siteRepo.findBy({ id: In(siteIds) });
    const siteMap = new Map(sites.map((s) => [s.id, s]));
    for (const device of devices) {
      device.site = siteMap.get(device.siteId)!;
    }
  }

  private async ensureSiteExists(siteId: string) {
    const site = await this.siteRepo.findOne({
      where: { id: siteId, deletedAt: IsNull() },
    });
    if (!site) {
      throw new NotFoundException('站点不存在');
    }
    return site;
  }

  private assertSiteAccess(siteId: string, currentUser: CurrentUserContext) {
    if (currentUser.role === UserRole.SUPER_ADMIN) {
      return;
    }
    if (currentUser.role === UserRole.SITE_MANAGER) {
      if (!currentUser.managedSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权操作该站点下的设备');
      }
      return;
    }
    if (currentUser.role === UserRole.INSPECTOR) {
      if (!currentUser.memberSiteIds.includes(siteId)) {
        throw new ForbiddenException('无权访问该站点下的设备');
      }
    }
  }

  private toSafeDevice(device: Device) {
    return {
      id: device.id,
      siteId: device.siteId,
      serialNumber: device.serialNumber,
      deviceType: device.deviceType,
      model: device.model,
      manufacturer: device.manufacturer,
      installDate: device.installDate,
      status: device.status,
      createdAt: device.createdAt,
      site: device.site
        ? {
            id: device.site.id,
            name: device.site.name,
            code: device.site.code,
          }
        : undefined,
    };
  }
}
