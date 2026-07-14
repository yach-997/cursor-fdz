import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from 'react-vant';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** H5 错误边界 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[H5 ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center', minHeight: '100vh' }}>
          <h3>页面加载出错</h3>
          <p style={{ color: '#888' }}>请返回重试或刷新页面</p>
          <Button type="primary" round onClick={() => window.location.reload()}>
            刷新
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
