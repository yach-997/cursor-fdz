import { useMemo, useState, type CSSProperties } from 'react';
import { Button, Calendar, DatePicker, Grid, Modal, Space } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

type Props = {
  value?: string;
  onChange?: (next?: string) => void;
  placeholder?: string;
  title?: string;
  style?: CSSProperties;
  allowClear?: boolean;
};

/**
 * 桌面：普通 DatePicker。
 * 手机：点开后用居中 Modal + 完整月历，避免弹出层贴边被裁切。
 */
export default function DayDatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  title = '选择日期',
  style,
  allowClear = true,
}: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => (value ? dayjs(value) : null), [value]);
  const [draft, setDraft] = useState<Dayjs>(parsed || dayjs());

  if (!isMobile) {
    return (
      <DatePicker
        allowClear={allowClear}
        inputReadOnly
        value={parsed}
        onChange={(next) => onChange?.(next ? next.format('YYYY-MM-DD') : undefined)}
        placeholder={placeholder}
        title={title}
        style={style}
      />
    );
  }

  return (
    <>
      <DatePicker
        allowClear={allowClear}
        inputReadOnly
        open={false}
        value={parsed}
        placeholder={placeholder}
        title={title}
        style={style}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setDraft(parsed || dayjs());
            setOpen(true);
          }
        }}
        onChange={(next) => {
          if (!next) onChange?.(undefined);
        }}
      />
      <Modal
        open={open}
        title={title}
        centered
        width={Math.min(360, typeof window !== 'undefined' ? window.innerWidth - 24 : 360)}
        destroyOnClose
        onCancel={() => setOpen(false)}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button
              onClick={() => {
                onChange?.(dayjs().format('YYYY-MM-DD'));
                setOpen(false);
              }}
            >
              今天
            </Button>
            <Space>
              {allowClear ? (
                <Button
                  onClick={() => {
                    onChange?.(undefined);
                    setOpen(false);
                  }}
                >
                  清除
                </Button>
              ) : null}
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button
                type="primary"
                onClick={() => {
                  onChange?.(draft.format('YYYY-MM-DD'));
                  setOpen(false);
                }}
              >
                确定
              </Button>
            </Space>
          </Space>
        }
      >
        <div className="day-date-picker-calendar">
          <Calendar
            fullscreen={false}
            value={draft}
            onChange={(next) => setDraft(next)}
            onSelect={(next) => setDraft(next)}
          />
        </div>
      </Modal>
    </>
  );
}
