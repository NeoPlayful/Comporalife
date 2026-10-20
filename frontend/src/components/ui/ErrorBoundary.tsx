import type { ReactNode } from 'react';
import { Component, type ErrorInfo } from 'react';
import ErrorState from './ErrorState';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/** 捕获渲染异常，避免整页白屏；网络错误由各页面的 ErrorState 处理 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '页面渲染出错',
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 只记录错误类型与组件栈，不输出用户数据
    console.error('渲染异常', error.name, info.componentStack?.slice(0, 500));
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          message="页面出现异常"
          onRetry={() => {
            this.setState({ hasError: false, message: '' });
            window.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
