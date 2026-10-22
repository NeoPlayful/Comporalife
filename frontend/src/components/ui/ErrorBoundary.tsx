import type { ReactNode } from 'react';
import { Component, type ErrorInfo } from 'react';
import i18n from '@/i18n';
import ErrorState from './ErrorState';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** 捕获渲染异常，避免整页白屏；网络错误由各页面的 ErrorState 处理 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // 只记录错误类型与组件栈，不输出用户数据
    console.error('渲染异常', error.name, info.componentStack?.slice(0, 500));
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          message={i18n.t('common:state.render_error')}
          onRetry={() => {
            this.setState({ hasError: false });
            window.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
