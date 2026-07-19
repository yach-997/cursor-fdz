import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { DownloadOutlined, EyeOutlined, UserAddOutlined } from '@ant-design/icons';
import { assignFinanceCase, fetchFinanceCase, fetchFinanceCases, fetchFinanceInspectors } from '../../../api/finance';
import type { FinanceCase, FinanceInspectorOption } from '../../../types/finance';
import ImportDialog from '../components/ImportDialog';

const statusLabel: Record<string, string> = {
  pending_assign: '待派单',
  assigned: '已派单',
  working: '作业中',
  finished: '已完工',
  settle_review: '待结算审核',
  settled: '已结算',
  month_locked: '已月结',
};
export default function FinanceCasesPage() {
  const [data, setData] = useState<FinanceCase[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [keyword, setKeyword] = useState(''),
    [status, setStatus] = useState<string>(),
    [loading, setLoading] = useState(false),
    [open, setOpen] = useState(false),
    [detail, setDetail] = useState<Record<string, any>>(),
    [assigning, setAssigning] = useState<FinanceCase>(),
    [inspectors, setInspectors] = useState<FinanceInspectorOption[]>([]),
    [inspectorId, setInspectorId] = useState<string>(),
    [assignReason, setAssignReason] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFinanceCases({ page, limit: 10, keyword, status });
      setData(r.list);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Card className="finance-card">
      <div className="finance-toolbar">
        <Input.Search
          allowClear
          placeholder="案例号或项目名称"
          onSearch={(v) => {
            setPage(1);
            setKeyword(v);
          }}
        />
        <Select
          allowClear
          placeholder="案例状态"
          value={status}
          onChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
          options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
        />
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => setOpen(true)}>
          导入案例
        </Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{ current: page, total, pageSize: 10, onChange: setPage }}
        scroll={{ x: 1000 }}
        columns={[
          { title: '案例号', dataIndex: 'gspCaseNo', width: 150 },
          { title: '项目名称', dataIndex: 'projectName' },
          { title: '省份', dataIndex: 'province', width: 80 },
          {
            title: '区域',
            dataIndex: 'region',
            width: 90,
            render: (v) => (v === 'yunnan' ? '云南' : '华南'),
          },
          { title: '服务类型', dataIndex: 'serviceType', width: 100 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v) => <Tag color="green">{statusLabel[v] || v}</Tag>,
          },
          {
            title: '案例收入',
            dataIndex: 'caseRevenue',
            width: 130,
            render: (v) => <span className="finance-money">¥ {Number(v).toFixed(2)}</span>,
          },
          {
            title: '操作',
            width: 170,
            render: (_, r) => (
              <Space>
                {r.status === 'pending_assign' && (
                  <Button
                    type="link"
                    icon={<UserAddOutlined />}
                    onClick={() => {
                      setAssigning(r);
                      setInspectorId(undefined);
                      setAssignReason('');
                      void fetchFinanceInspectors(r.id).then(setInspectors);
                    }}
                  >
                    派单
                  </Button>
                )}
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => void fetchFinanceCase(r.id).then(setDetail)}
                >
                  详情
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <ImportDialog
        open={open}
        kind="gsp"
        title="导入 GSP 案例"
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          void load();
        }}
      />
      <Modal
        open={!!assigning}
        title={`派单 · ${assigning?.gspCaseNo || ''}`}
        okText="确认派单"
        cancelText="取消"
        okButtonProps={{ disabled: !inspectorId }}
        onCancel={() => setAssigning(undefined)}
        onOk={async () => {
          if (!assigning || !inspectorId) return;
          const selected = inspectors.find((item) => item.id === inspectorId);
          if (selected?.region !== assigning.region && !assignReason.trim()) {
            message.warning('跨区域派单请填写特批原因');
            return;
          }
          await assignFinanceCase(assigning.id, inspectorId, assignReason || undefined);
          message.success('派单成功，巡检员可在手机端接单作业');
          setAssigning(undefined);
          await load();
        }}
      >
        <p>仅显示与案例同区域的巡检员；正在处理其他费用案例的人员不可选择。</p>
        <Select
          style={{ width: '100%' }}
          value={inspectorId}
          placeholder="选择空闲巡检员"
          onChange={setInspectorId}
          options={inspectors.map((item) => ({
            value: item.id,
            disabled: !item.available,
            label: `${item.realName}（${item.phone}）· ${item.region === 'yunnan' ? '云南' : '华南'}${item.available ? '' : ' · 作业中'}`,
          }))}
        />
        {inspectors.find((item) => item.id === inspectorId)?.region !== assigning?.region && inspectorId && (
          <Input.TextArea
            style={{ marginTop: 12 }}
            rows={3}
            value={assignReason}
            onChange={(event) => setAssignReason(event.target.value)}
            placeholder="跨区域派单特批原因（必填）"
          />
        )}
      </Modal>
      <Drawer
        width={760}
        open={!!detail}
        title={detail?.projectName || '案例详情'}
        onClose={() => setDetail(undefined)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              column={2}
              items={[
                { key: 'no', label: '案例号', children: detail.gspCaseNo },
                {
                  key: 'region',
                  label: '区域',
                  children: detail.region === 'yunnan' ? '云南' : '华南',
                },
                { key: 'province', label: '省份', children: detail.province || '-' },
                {
                  key: 'status',
                  label: '状态',
                  children: statusLabel[detail.status] || detail.status,
                },
              ]}
            />
            {detail.reconciliation?.warning && (
              <Alert
                className="finance-warning"
                style={{ marginTop: 16 }}
                type="warning"
                showIcon
                message={detail.reconciliation.warning}
                description={`PO总额 ¥${detail.reconciliation.poTotal}，已核算收入 ¥${detail.reconciliation.caseRevenue}`}
              />
            )}
            <div className="finance-detail-section">
              <h3>PO 与核算条目</h3>
              {(detail.orders || []).map((po: any) => (
                <Card
                  size="small"
                  key={po.id}
                  title={`${po.poNo} · ¥${po.poTotalAmount}`}
                  style={{ marginBottom: 10 }}
                >
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={po.items}
                    columns={[
                      {
                        title: '类别',
                        dataIndex: 'itemCategory',
                        render: (v) => (v === 'special' ? '专用' : '通用'),
                      },
                      { title: '条目', dataIndex: 'itemName' },
                      { title: '数量', dataIndex: 'qty' },
                      {
                        title: '结算单价',
                        dataIndex: 'settlePrice',
                        render: (v) => (v ? `¥${v}` : '待定价'),
                      },
                      { title: '收入', dataIndex: 'itemRevenue', render: (v) => `¥${v}` },
                    ]}
                  />
                </Card>
              ))}
            </div>
          </>
        )}
      </Drawer>
    </Card>
  );
}
