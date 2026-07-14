import { Typography } from 'antd';

/** 占位页面组件（Phase 后续实现业务） */
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <Typography.Title level={4}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        页面骨架已就绪，业务功能将在后续 Phase 实现。
      </Typography.Paragraph>
    </div>
  );
}
