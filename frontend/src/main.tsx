import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { configureAuthBridge } from './lib/client';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import { Toaster } from './lib/toast';
import './i18n';
import { useAuthStore } from './stores/auth-store';
import './styles/index.css';

// 让请求层能读取内存中的 access token，并在刷新成功/会话失效时同步状态
configureAuthBridge({
  getAccessToken: () => useAuthStore.getState().accessToken,
  onRefreshed: (token) => {
    const { user } = useAuthStore.getState();
    if (user) useAuthStore.getState().setAuth(user, token);
  },
  onAuthLost: () => useAuthStore.getState().clear(),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* 命令式确认框要让页面内任意组件都能 await，因此挂在路由之内、页面之外 */}
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
        <Toaster
          position="top-right"
          gutter={8}
          containerStyle={{ zIndex: 90 }}
          toastOptions={{
            duration: 3500,
            className: 'cl-toast',
            // 走设计令牌而不是库自带的固定浅色底，否则深色主题下会浮出一块白卡
            style: {
              background: 'var(--color-surface-raised)',
              color: 'var(--color-content)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '0.625rem',
              padding: '10px 14px',
              fontSize: '14px',
              maxWidth: '420px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
            },
            success: { iconTheme: { primary: 'var(--color-positive)', secondary: 'var(--color-surface-raised)' } },
            error: { iconTheme: { primary: 'var(--color-negative)', secondary: 'var(--color-surface-raised)' } },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
