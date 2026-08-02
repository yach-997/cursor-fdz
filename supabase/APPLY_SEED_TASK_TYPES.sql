-- 在 Supabase SQL Editor 执行：按流程图写入/同步三种任务类型（全局）
-- 组串式逆变器 / 集中式逆变器 / 储能系统

-- 1) 组串式逆变器（6 项必检）
WITH updated AS (
  UPDATE public.inspection_templates
  SET
    name = '组串式逆变器',
    entries = $json$[
      {"id":"tt-si-1","name":"上传阳光云截图","description":"必检。须上传完整阳光云页面截图（含设备信息与序列号，不可半截）。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-si-2","name":"上传故障记录","description":"必检。须同时上传实时故障/告警页与历史故障/告警页。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-si-3","name":"安装固定检查","description":"必检。检查支架/螺栓等固定点，证明安装牢固、无松动倾斜。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-si-4","name":"直流侧安装检查","description":"必检。检查直流接线、端子与标识；未使用端子须有防护盖。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-si-5","name":"交流侧安装检查","description":"必检。检查交流侧接线与防护；须看到 PE 接地线已接入。","isRequired":true,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-si-6","name":"接地安装检查","description":"必检。须清晰看到黄绿接地线、接地排/端子、接地标识。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false}
    ]$json$::jsonb,
    version = COALESCE(version, 1) + 1
  WHERE device_type = 'string_inverter'
    AND is_global = true
    AND site_id IS NULL
  RETURNING id
)
INSERT INTO public.inspection_templates (id, name, device_type, entries, is_global, site_id, version)
SELECT
  '66666666-6666-6666-6666-666666666661',
  '组串式逆变器',
  'string_inverter',
  $json$[
    {"id":"tt-si-1","name":"上传阳光云截图","description":"必检。须上传完整阳光云页面截图（含设备信息与序列号，不可半截）。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-si-2","name":"上传故障记录","description":"必检。须同时上传实时故障/告警页与历史故障/告警页。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-si-3","name":"安装固定检查","description":"必检。检查支架/螺栓等固定点，证明安装牢固、无松动倾斜。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-si-4","name":"直流侧安装检查","description":"必检。检查直流接线、端子与标识；未使用端子须有防护盖。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-si-5","name":"交流侧安装检查","description":"必检。检查交流侧接线与防护；须看到 PE 接地线已接入。","isRequired":true,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-si-6","name":"接地安装检查","description":"必检。须清晰看到黄绿接地线、接地排/端子、接地标识。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false}
  ]$json$::jsonb,
  true,
  null,
  1
WHERE NOT EXISTS (SELECT 1 FROM updated)
  AND NOT EXISTS (
    SELECT 1 FROM public.inspection_templates
    WHERE device_type = 'string_inverter' AND is_global = true AND site_id IS NULL
  );

-- 2) 集中式逆变器（6 必检 + 中压变压器可选）
WITH updated AS (
  UPDATE public.inspection_templates
  SET
    name = '集中式逆变器',
    entries = $json$[
      {"id":"tt-ci-1","name":"上传阳光云截图","description":"必检。须上传完整阳光云页面截图（含设备信息与序列号）。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-2","name":"上传故障记录","description":"必检。须同时上传实时与历史故障/告警截图。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-3","name":"设备箱体检查","description":"必检。检查箱体外观、门锁、密封、防腐与内部整洁。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-4","name":"逆变器检查","description":"必检。检查逆变器本体运行状态、指示灯、接线与散热。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-5","name":"低压配电柜检查","description":"必检。检查低压配电柜内元器件、接线与标识。","isRequired":true,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-6","name":"环网柜检查","description":"必检。检查环网柜外观、柜门、指示与安全防护。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-ci-7","name":"中压变压器检查","description":"可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏。","isRequired":false,"order":6,"samplePhotos":[],"checkType":"photo","isOptionalModule":true}
    ]$json$::jsonb,
    version = COALESCE(version, 1) + 1
  WHERE device_type = 'central_inverter'
    AND is_global = true
    AND site_id IS NULL
  RETURNING id
)
INSERT INTO public.inspection_templates (id, name, device_type, entries, is_global, site_id, version)
SELECT
  '66666666-6666-6666-6666-666666666663',
  '集中式逆变器',
  'central_inverter',
  $json$[
    {"id":"tt-ci-1","name":"上传阳光云截图","description":"必检。须上传完整阳光云页面截图（含设备信息与序列号）。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-2","name":"上传故障记录","description":"必检。须同时上传实时与历史故障/告警截图。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-3","name":"设备箱体检查","description":"必检。检查箱体外观、门锁、密封、防腐与内部整洁。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-4","name":"逆变器检查","description":"必检。检查逆变器本体运行状态、指示灯、接线与散热。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-5","name":"低压配电柜检查","description":"必检。检查低压配电柜内元器件、接线与标识。","isRequired":true,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-6","name":"环网柜检查","description":"必检。检查环网柜外观、柜门、指示与安全防护。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-ci-7","name":"中压变压器检查","description":"可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏。","isRequired":false,"order":6,"samplePhotos":[],"checkType":"photo","isOptionalModule":true}
  ]$json$::jsonb,
  true,
  null,
  1
WHERE NOT EXISTS (SELECT 1 FROM updated)
  AND NOT EXISTS (
    SELECT 1 FROM public.inspection_templates
    WHERE device_type = 'central_inverter' AND is_global = true AND site_id IS NULL
  );

-- 3) 储能系统（5 必检 + 中压变压器可选）
WITH updated AS (
  UPDATE public.inspection_templates
  SET
    name = '储能系统',
    entries = $json$[
      {"id":"tt-es-1","name":"箱体检查","description":"必检。检查储能系统箱体外观、门锁、密封与标识。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-es-2","name":"电池箱检查","description":"必检。检查电池箱外观、连接、温控/消防相关部件。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-es-3","name":"PCS 检查","description":"必检。检查 PCS 运行状态、指示、接线与散热。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-es-4","name":"环网柜检查","description":"必检。检查环网柜外观、柜门、指示与安全防护。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
      {"id":"tt-es-5","name":"中压变压器检查","description":"可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏。","isRequired":false,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":true},
      {"id":"tt-es-6","name":"其它系统检查","description":"必检。检查其它附属系统（通信、消防、空调等）是否异常。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false}
    ]$json$::jsonb,
    version = COALESCE(version, 1) + 1
  WHERE device_type = 'energy_storage'
    AND is_global = true
    AND site_id IS NULL
  RETURNING id
)
INSERT INTO public.inspection_templates (id, name, device_type, entries, is_global, site_id, version)
SELECT
  '66666666-6666-6666-6666-666666666662',
  '储能系统',
  'energy_storage',
  $json$[
    {"id":"tt-es-1","name":"箱体检查","description":"必检。检查储能系统箱体外观、门锁、密封与标识。","isRequired":true,"order":0,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-es-2","name":"电池箱检查","description":"必检。检查电池箱外观、连接、温控/消防相关部件。","isRequired":true,"order":1,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-es-3","name":"PCS 检查","description":"必检。检查 PCS 运行状态、指示、接线与散热。","isRequired":true,"order":2,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-es-4","name":"环网柜检查","description":"必检。检查环网柜外观、柜门、指示与安全防护。","isRequired":true,"order":3,"samplePhotos":[],"checkType":"photo","isOptionalModule":false},
    {"id":"tt-es-5","name":"中压变压器检查","description":"可选项（视情况）。现场有中压变压器时检查外观、油位/温升、异响与渗漏。","isRequired":false,"order":4,"samplePhotos":[],"checkType":"photo","isOptionalModule":true},
    {"id":"tt-es-6","name":"其它系统检查","description":"必检。检查其它附属系统（通信、消防、空调等）是否异常。","isRequired":true,"order":5,"samplePhotos":[],"checkType":"photo","isOptionalModule":false}
  ]$json$::jsonb,
  true,
  null,
  1
WHERE NOT EXISTS (SELECT 1 FROM updated)
  AND NOT EXISTS (
    SELECT 1 FROM public.inspection_templates
    WHERE device_type = 'energy_storage' AND is_global = true AND site_id IS NULL
  );

-- 校验
SELECT name, device_type, jsonb_array_length(entries) AS entry_count, version, is_global
FROM public.inspection_templates
WHERE is_global = true
  AND site_id IS NULL
  AND device_type IN ('string_inverter', 'central_inverter', 'energy_storage')
ORDER BY device_type;
